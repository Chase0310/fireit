// packages/server/src/index.ts
// 启动流程（对齐 m0-skeleton.md §3.3 + m3-task-flow.md §1 接线）：
// 1. 端口占用检测（3140 被占 → 报错退出）
// 2. Fastify 启动，注册 /health 路由 + task/step 路由
// 3. 挂载 WS server（路径 /ws）
// 4. 客户端连接后，推送一条 server.hello

import { AgentRunner, makeAdapter } from '@fireit/agents';
import { TeamRegistry } from '@fireit/core';
import type { SeedSpec, SkeletonEvent } from '@fireit/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { type WebSocket, WebSocketServer } from 'ws';
import { type DbHandle, openDb } from './db/index.js';
import { SERVER_PORT, ensurePortFreeOrExit, healthSnapshot } from './health.js';
import { RealtimeBroadcaster } from './realtime.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerStepRoutes } from './routes/steps.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerThreadRoutes } from './routes/threads.js';
import { AgentService } from './services/agent-service.js';
import { ChatService } from './services/chat-service.js';
import { PostureEngine, makeDefaultPostureJudge } from './services/posture-engine.js';
import { ReviewService } from './services/review-service.js';
import { type AgentInvoker, type IdentityProvider, TaskService } from './services/task-service.js';

export interface ServerHandle {
  fastify: FastifyInstance;
  wss: WebSocketServer;
  broadcaster: RealtimeBroadcaster;
  db: DbHandle;
  service: TaskService;
  reviewService: ReviewService;
  chatService: ChatService;
  postureEngine: PostureEngine;
  agentService: AgentService;
  registry: TeamRegistry;
  close: () => Promise<void>;
}

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  broadcaster?: RealtimeBroadcaster | null;
  identity?: IdentityProvider;
  invoker?: AgentInvoker;
  registry?: TeamRegistry;
  seeds?: SeedSpec[]; // 启动时 seed 进 DB 的 agent(dev.ts 提供 Atlas/Forge/Nova)
  workspaceRoot?: string; // 默认 '.fireit/agents'
}

// 默认 IdentityProvider：无 agent 注册时返回 null（M3 最小；agent 注册留后续）
class NullIdentityProvider implements IdentityProvider {
  getIdentity() {
    return null;
  }
}

export async function startServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  const port = opts.port ?? SERVER_PORT;
  // 1. 端口占用检测（固定端口，占用即报错退出，M0-D2）
  await ensurePortFreeOrExit(port);

  const fastify = Fastify({ logger: false });
  const broadcaster = opts.broadcaster ?? new RealtimeBroadcaster();
  const db = openDb({ path: opts.dbPath ?? '.fireit/fireit.db' });
  const identity = opts.identity ?? new NullIdentityProvider();
  const invoker =
    opts.invoker ??
    ({
      async *run(input, type) {
        const adapter = makeAdapter(type);
        yield* adapter.invoke(input);
      },
    } satisfies AgentInvoker);

  const service = new TaskService(db, broadcaster, identity, invoker);
  const registry = opts.registry ?? new TeamRegistry();
  // AgentService:agent 三层状态(定义层 DB↔registry / 运行时 session / 工作区文件)
  const agentService = new AgentService({
    db,
    registry,
    workspaceRoot: opts.workspaceRoot ?? '.fireit/agents',
  });
  if (opts.seeds && opts.seeds.length > 0) {
    agentService.seedAndLoad(opts.seeds);
  }
  const reviewService = new ReviewService({
    db,
    broadcaster,
    registry,
    identity,
    invoker,
    taskService: service,
  });
  const chatService = new ChatService({
    db,
    broadcaster,
    registry,
    identity,
    invoker,
    taskService: service,
    agentService,
    // 头脑风暴 posture judge:性格驱动,像真人队友感知房间(Clowder 风格)
    brainstormPostureJudge: async ({ agent, userMessage, recentHistory }) => {
      const ident = identity.getIdentity(agent.agentId);
      if (!ident) return { decision: 'silent', reason: '未配置 identity' };
      const personality = agent.personality ?? '友善随和';
      // 你最近是否刚发过言(决定寒暄时要不要抢话)
      const youRecentlySpoke =
        /(\[agent_[a-z]+\][^\n]*\n){0,4}\[agent_[a-z]+\]/i.test(
          (recentHistory ?? '').slice(-200),
        ) && (recentHistory ?? '').slice(-120).includes(agent.agentId);

      const prompt = [
        `你是 ${agent.name}(${agent.handle})。`,
        `性格:${personality}`,
        `角色:${agent.role},专长:${agent.specialties.join('、')}`,
        youRecentlySpoke ? '(你刚才已经发过言了)' : '(你最近没说话)',
        '',
        '# 最近对话',
        recentHistory || '(刚开始)',
        '',
        '# 用户刚说',
        userMessage,
        '',
        '# 你怎么反应(凭你的性格自然判断,别机械套规则)',
        '- 寒暄/问候:有人在场就该有人回应。按你的性格——你若是会主动打招呼的人就 participate,若你刚说过话就让别人回(silent)',
        '- 聊团队/氛围:按性格参与,活跃的就接,内向的就听',
        '- 工作讨论:看你专长和有没有实质补充',
        '- 关键:像真人,不像客服。该接就接,不用每条都分析"是不是我专长"',
        '',
        '只回一行:participate 或 silent,后接简短原因(符合你的性格语气)。',
      ].join('\n');
      let text = '';
      let sawError = false;
      try {
        for await (const chunk of invoker.run(
          {
            agentId: agent.agentId,
            identityPrompt: ident.identityPrompt,
            context: '',
            task: prompt,
          },
          ident.adapterType,
        )) {
          if (chunk.kind === 'error') sawError = true;
          if (chunk.kind === 'text') text += chunk.content;
        }
      } catch {
        sawError = true;
      }
      // API 错误(限流/过载/超时)→ 友好提示,标记暂时不可用
      const apiErr = /API Error|529|overloaded|rate.?limit|timeout|连接|访问量/i.test(text);
      if (sawError || apiErr) {
        const reason = apiErr
          ? `${agent.adapterType} API 暂时过载/限流,稍后会恢复`
          : '暂时连不上(CLI 调用失败)';
        return { decision: 'silent', reason };
      }
      const lower = text.toLowerCase();
      const reason =
        text
          .replace(/^.*?(participate|silent|参与)?\s*/, '')
          .trim()
          .slice(0, 30) || '无说明';
      if (
        lower.includes('participate') ||
        /^(参与|我说|我补充|我接|我有|回个|招呼|嗨|你好|嘿)/.test(text.trim())
      ) {
        return { decision: 'participate', reason };
      }
      return { decision: 'silent', reason };
    },
  });
  // PostureEngine:agent 自治唤醒(phase.ready → posture 判断 → 先到先得 enter)
  const postureEngine = new PostureEngine({
    registry,
    taskService: service,
    judge: makeDefaultPostureJudge(identity, invoker),
    broadcaster,
  });
  // 挂载:TaskService 检测到 step ready 时,触发 PostureEngine 自治唤醒
  service.onStepReady = (taskId, stepId) => {
    void postureEngine.onStepReady(taskId, stepId);
  };

  // 2. /health 路由
  fastify.get('/health', async () => healthSnapshot(port));

  // 注册 task / step / review / thread / agents 路由
  registerTaskRoutes(fastify, { service });
  registerStepRoutes(fastify, { service });
  registerReviewRoutes(fastify, { reviewService });
  registerThreadRoutes(fastify, { chatService });
  registerAgentRoutes(fastify, { registry, db, agentService });

  await fastify.listen({ port, host: '127.0.0.1' });
  console.log(`[fireit/server] Fastify listening on http://127.0.0.1:${port}`);

  // 3. WS server（路径 /ws）
  const wss = new WebSocketServer({ noServer: true });
  fastify.server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (url.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    broadcaster.subscribe(ws);
    // 4. 推送 server.hello
    const hello: SkeletonEvent = {
      type: 'server.hello',
      message: 'fireit server ready 🔥',
      at: Date.now(),
    };
    broadcaster.send(ws, hello);

    ws.on('message', (raw) => {
      try {
        const evt = JSON.parse(raw.toString()) as { type?: string; at?: number };
        // M0 只回显 client.ping（验证双向通）
        if (evt?.type === 'client.ping') {
          broadcaster.send(ws, { type: 'client.ping', at: evt.at ?? Date.now() });
        }
      } catch {
        // 忽略无法解析的帧
      }
    });
  });

  console.log(`[fireit/server] WS ready at ws://127.0.0.1:${port}/ws`);

  const close = async () => {
    for (const client of wss.clients) {
      client.close();
    }
    wss.close();
    await fastify.close();
    db.close();
  };

  return {
    fastify,
    wss,
    broadcaster,
    db,
    service,
    reviewService,
    chatService,
    postureEngine,
    agentService,
    registry,
    close,
  };
}

// 直接运行入口
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('[fireit/server] failed to start:', err);
    process.exit(1);
  });
}

// 保留 AgentRunner 引用（CLI 默认 invoker 走 makeAdapter；AgentRunner 供需要细控时使用）
void AgentRunner;
