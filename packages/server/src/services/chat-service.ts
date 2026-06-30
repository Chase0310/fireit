// packages/server/src/services/chat-service.ts
// ChatService —— chat 驱动范式的编排核心,两模式:
//   brainstorm(头脑风暴):全员在场,消息来→每个 agent 跑 posture 判断要不要发言(克制)
//   directed(有向协作):绑 task,phase 驱动 + @ 强制路由(无 @ 时智能选相关 agent)
//
// 过渡:transitionToDirected(plan, lead) → createTask → 切模式

import { type TeamRegistry, parseAnyMentions, parseMentions, resolveTargets } from '@fireit/core';
import type {
  Agent,
  AgentId,
  AgentInvokeInput,
  StepSpec,
  TaskId,
  ThreadId,
  ThreadMessage,
  ThreadMode,
} from '@fireit/shared';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/index.js';
import { threadMessages, threads } from '../db/schema.js';
import type { RealtimeBroadcaster } from '../realtime.js';
import type { AgentService } from './agent-service.js';
import type { AgentInvoker, IdentityProvider, TaskService } from './task-service.js';

let msgSeq = 0;
function newMsgId(prefix: string): string {
  msgSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${msgSeq.toString(36)}`;
}

// 头脑风暴 posture 上下文(讨论场景,非 phase)
export interface BrainstormPostureContext {
  agent: Agent;
  userMessage: string;
  recentHistory: string;
}

// 头脑风暴 posture 判断器:返回决定 + 原因(silent 时原因透明给用户)
export type BrainstormPostureResult = { decision: 'participate' | 'silent'; reason: string };
export type BrainstormPostureJudge = (
  ctx: BrainstormPostureContext,
) => Promise<BrainstormPostureResult>;

export interface ChatServiceDeps {
  db: DbHandle;
  broadcaster: RealtimeBroadcaster | null;
  registry: TeamRegistry;
  identity: IdentityProvider;
  invoker: AgentInvoker;
  taskService: TaskService;
  // posture 判断器(头脑风暴模式用);不传则退化为全员发言
  brainstormPostureJudge?: BrainstormPostureJudge;
  agentService?: AgentService; // 运行时 session + per-agent cwd
}

export interface ThreadSummary {
  threadId: ThreadId;
  mode: ThreadMode;
  taskId: TaskId | null;
  dmAgentId: AgentId | null; // DM 模式绑定的 agent;非 DM 为 null
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// 一轮对话上下文:贯穿"用户消息 → 首批发言 → agent@agent 链式传递"全过程。
// 用于 agent@agent 防循环:spoken 去重(一个 agent 一轮一次);chain 记传递路径,触发 reminder。
interface TurnCtx {
  spoken: Set<AgentId>; // 本轮已发过言的 agent(去重;硬防循环)
  chain: AgentId[]; // 链式传递路径(首批 agent + 被传递的),用于判断是否触发 reminder
}

export class ChatService {
  // threadId → messages(内存缓存,DB 是真相源)
  private threadsCache = new Map<ThreadId, ThreadMessage[]>();
  // threadId → taskId(缓存)
  private threadTask = new Map<ThreadId, TaskId>();
  // threadId → mode(缓存)
  private threadMode = new Map<ThreadId, ThreadMode>();
  // threadId → DM 绑定 agent(缓存;DM 模式专用)
  private threadDmAgent = new Map<ThreadId, AgentId>();

  constructor(private deps: ChatServiceDeps) {}

  // ── 会话生命周期 ──────────────────────────────────────
  // 创建会话(持久化到 DB)。dmAgentId 仅 dm 模式用:绑定单 agent
  createThread(mode: ThreadMode = 'brainstorm', dmAgentId?: AgentId): ThreadId {
    const tid = `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    this.deps.db.db
      .insert(threads)
      .values({
        id: tid,
        mode,
        dmAgentId: mode === 'dm' ? (dmAgentId ?? null) : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.threadMode.set(tid, mode);
    if (mode === 'dm' && dmAgentId) this.threadDmAgent.set(tid, dmAgentId);
    this.threadsCache.set(tid, []);
    return tid;
  }

  // 列出所有会话(摘要)
  listThreads(): ThreadSummary[] {
    const rows = this.deps.db.db.select().from(threads).all();
    return rows
      .map((r) => {
        const msgCount = this.deps.db.raw
          .prepare('SELECT COUNT(*) as c FROM thread_messages WHERE thread_id = ?')
          .get(r.id) as { c: number };
        return {
          threadId: r.id,
          mode: r.mode as ThreadMode,
          taskId: (r.taskId ?? null) as TaskId | null,
          dmAgentId: (r.dmAgentId ?? null) as AgentId | null,
          title: r.title ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          messageCount: msgCount.c,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // 删除会话(连消息一起)
  deleteThread(threadId: ThreadId): void {
    this.deps.db.raw.prepare('DELETE FROM thread_messages WHERE thread_id = ?').run(threadId);
    this.deps.db.raw.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
    this.threadsCache.delete(threadId);
    this.threadMode.delete(threadId);
    this.threadTask.delete(threadId);
    this.threadDmAgent.delete(threadId);
  }

  // ── 模式查询/切换 ──────────────────────────────────────
  getMode(threadId: ThreadId): ThreadMode {
    // 缓存优先,否则查 DB
    if (this.threadMode.has(threadId)) return this.threadMode.get(threadId) ?? 'brainstorm';
    const row = this.deps.db.db.select().from(threads).where(eq(threads.id, threadId)).get();
    const mode = (row?.mode ?? 'brainstorm') as ThreadMode;
    this.threadMode.set(threadId, mode);
    return mode;
  }

  getTaskId(threadId: ThreadId): TaskId | null {
    if (this.threadTask.has(threadId)) return this.threadTask.get(threadId) ?? null;
    const row = this.deps.db.db.select().from(threads).where(eq(threads.id, threadId)).get();
    const tid = (row?.taskId ?? null) as TaskId | null;
    if (tid) this.threadTask.set(threadId, tid);
    return tid;
  }

  // DM 绑定的 agent(dm 模式专用;非 dm 返回 null)
  getDmAgentId(threadId: ThreadId): AgentId | null {
    if (this.threadDmAgent.has(threadId)) return this.threadDmAgent.get(threadId) ?? null;
    const row = this.deps.db.db.select().from(threads).where(eq(threads.id, threadId)).get();
    const aid = (row?.dmAgentId ?? null) as AgentId | null;
    if (aid) this.threadDmAgent.set(threadId, aid);
    return aid;
  }

  getMessages(threadId: ThreadId): ThreadMessage[] {
    if (this.threadsCache.has(threadId)) return this.threadsCache.get(threadId) ?? [];
    // 从 DB 加载
    const rows = this.deps.db.db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.threadId, threadId))
      .all();
    const msgs = rows.map((r) => JSON.parse(r.dataJson) as ThreadMessage);
    this.threadsCache.set(threadId, msgs);
    return msgs;
  }

  linkTask(threadId: ThreadId, taskId: TaskId) {
    this.threadTask.set(threadId, taskId);
    this.deps.db.db
      .update(threads)
      .set({ taskId, updatedAt: Date.now() })
      .where(eq(threads.id, threadId))
      .run();
  }

  // 头脑风暴 → 有向协作:用 plan + 负责人创建 task,切换模式
  async transitionToDirected(
    threadId: ThreadId,
    plan: StepSpec[],
    meta: { title: string; vision: string; leadAgentId: AgentId },
  ): Promise<TaskId> {
    const task = await this.deps.taskService.createTask({
      title: meta.title,
      vision: meta.vision,
      plan,
      leadAgentId: meta.leadAgentId,
    });
    this.threadTask.set(threadId, task.taskId);
    this.threadMode.set(threadId, 'directed');
    this.deps.db.db
      .update(threads)
      .set({ mode: 'directed', taskId: task.taskId, updatedAt: Date.now() })
      .where(eq(threads.id, threadId))
      .run();
    // approve plan(触发 PostureEngine 自治唤醒第一个 phase)
    await this.deps.taskService.approvePlan(task.taskId);
    this.appendSystem(
      threadId,
      `📋 讨论结束,进入有向协作。Task「${meta.title}」,负责人 ${meta.leadAgentId}`,
    );
    return task.taskId;
  }

  // ── 发送消息 ──────────────────────────────────────────
  async sendMessage(threadId: ThreadId, text: string, sender: 'user' = 'user') {
    const userMsg: ThreadMessage = {
      id: newMsgId('msg'),
      threadId,
      kind: 'user',
      sender,
      text,
      at: Date.now(),
    };
    this.appendMessage(threadId, userMsg);

    if (sender === 'user') {
      const mode = this.getMode(threadId);
      void (
        mode === 'brainstorm'
          ? this.handleBrainstormMessage(threadId, text)
          : mode === 'directed'
            ? this.handleDirectedMessage(threadId, text)
            : this.handleDmMessage(threadId, text)
      ).catch((e) => {
        this.appendSystem(threadId, `⚠ 执行出错: ${(e as Error).message}`);
      });
    }
    return userMsg;
  }

  // ── 头脑风暴模式:全员 posture 判断要不要发言 ──────────
  private async handleBrainstormMessage(threadId: ThreadId, text: string) {
    const { registry } = this.deps;
    const judge = this.deps.brainstormPostureJudge;
    const history = this.getMessages(threadId);

    // 若有 @ → @ 的人强制发言(即便在头脑风暴,@ 仍是硬路由)
    const handles = parseMentions(text);
    const { targets } = resolveTargets(handles, registry);
    const forced = new Set(targets);

    const candidates = registry.listAvailable();
    const recentHistory = history
      .slice(-6)
      .map((m) => `[${m.sender}] ${m.kind === 'user' || m.kind === 'agent' ? m.text : ''}`)
      .join('\n');

    // 对每个候选决定要不要发言:@排他 —— 若有人被 @,只有被@的强制发言,其余一律 silent(不走 judge)
    const willSpeak: AgentId[] = [];
    const silentReasons: string[] = [];
    const hasMention = forced.size > 0;
    if (hasMention) {
      // @排他:被@的参与,其他人直接静默(类似 DM 语义:用户点名了就只听 TA)
      for (const agent of candidates) {
        if (forced.has(agent.agentId)) {
          willSpeak.push(agent.agentId);
        } else {
          silentReasons.push(`${agent.name}: 用户 @了别人,这轮我不参与`);
        }
      }
    } else if (judge) {
      // 每个 agent 先进入 thinking(posture 判断中,顶栏观测)
      for (const a of candidates) {
        this.broadcastStatus(a.agentId, 'thinking', '判断要不要发言');
      }
      const decisions = await Promise.all(
        candidates.map(async (agent) => judge({ agent, userMessage: text, recentHistory })),
      );
      candidates.forEach((agent, i) => {
        const d = decisions[i];
        if (!d) return;
        if (d.decision === 'participate') {
          willSpeak.push(agent.agentId);
        } else {
          // silent:回空闲 + 把原因透明给用户(解决"为什么 X 不说话"黑盒)
          this.broadcastStatus(agent.agentId, 'idle');
          silentReasons.push(`${agent.name}: ${d.reason}`);
        }
      });
    } else {
      // 无 judge:退化为全员发言(测试/兜底)
      for (const a of candidates) willSpeak.push(a.agentId);
    }

    // silent 说明:只在有部分人发言时逐条透明展示(便于理解为何某人没说);
    // 全员 silent 时合并成一条,避免寒暄场景刷一屏"🤫 只是寒暄"
    if (willSpeak.length > 0) {
      for (const r of silentReasons) {
        this.appendSystem(threadId, `🤫 ${r}`);
      }
    } else if (silentReasons.length > 0) {
      // 全员 silent:合并一条,原因去重
      const uniqueReasons = [...new Set(silentReasons.map((r) => r.split(': ')[1] ?? r))];
      this.appendSystem(threadId, `大家都没接话(${uniqueReasons.join(' / ')})`);
    }

    if (willSpeak.length === 0) {
      return;
    }

    // 一轮上下文:首批发言者先记入 spoken/chain,之后 agent@agent 链式传递共用它(防循环)
    const turnCtx: TurnCtx = { spoken: new Set(willSpeak), chain: [...willSpeak] };

    // 并发发言(讨论不抢 phase,都允许说)。各 agent 回复里的 @mention 链串行触发,共用 turnCtx 去重。
    await Promise.all(
      willSpeak.map((agentId) => this.runAgent(threadId, agentId, text, turnCtx)),
    );
  }

  // ── 有向协作模式:@ 强制路由,无 @ 智能选 1 个 ──────────
  private async handleDirectedMessage(threadId: ThreadId, text: string) {
    const { registry } = this.deps;
    const handles = parseMentions(text);
    const { targets, warnings } = resolveTargets(handles, registry);

    let routed = targets;
    if (routed.length === 0) {
      // 无 @ → 智能选最相关的 1 个
      const picked = this.routeByContent(text, registry);
      if (picked === null) {
        const available = registry
          .listAvailable()
          .map((a) => a.handle)
          .join(' / ');
        this.appendSystem(threadId, `你说的是哪方面?用 ${available} 指定会更准`);
        for (const w of warnings) this.appendSystem(threadId, w.detail);
        return;
      }
      routed = [picked];
    }

    for (const agentId of routed) {
      await this.runAgent(threadId, agentId, text);
    }
  }

  // ── DM 模式:消息只路由给绑定的单个 agent(不走 posture/@/content-routing)──────────
  private async handleDmMessage(threadId: ThreadId, text: string) {
    const agentId = this.getDmAgentId(threadId);
    if (!agentId) {
      this.appendSystem(threadId, '⚠ 这个单聊没有绑定 agent');
      return;
    }
    // 确认 agent 仍存在且可用
    const agent = this.deps.registry.get(agentId);
    if (!agent) {
      this.appendSystem(threadId, `⚠ ${agentId} 已不存在`);
      return;
    }
    await this.runAgent(threadId, agentId, text);
  }

  // 按消息内容 vs agent 专长,选最相关的 1 个(无匹配返回 null)
  private routeByContent(text: string, registry: TeamRegistry): AgentId | null {
    const lower = text.toLowerCase();
    const available = registry.listAvailable();
    let best: Agent | null = null;
    let bestScore = 0;
    for (const a of available) {
      const score = a.specialties.reduce(
        (acc, s) => acc + (lower.includes(s.toLowerCase()) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return bestScore > 0 ? (best?.agentId ?? null) : null;
  }

  // ── 拉起单个 agent 执行 + 流式回写 ────────────────────
  // turnCtx:若提供,agent 回复后解析其 @mention,链式触发被@的队友(防循环)。
  private async runAgent(
    threadId: ThreadId,
    agentId: AgentId,
    userText: string,
    turnCtx?: TurnCtx,
  ) {
    const { identity, taskService } = this.deps;
    const agent = this.deps.registry.get(agentId);
    const ident = identity.getIdentity(agentId);
    if (!agent || !ident) {
      this.appendSystem(threadId, `${agentId} 没有配置 identity,跳过`);
      return;
    }

    // agent 状态:执行中(顶栏观测)
    this.broadcastStatus(agentId, 'executing', '正在响应');

    const taskId = this.threadTask.get(threadId) ?? null;
    const context = taskId ? taskService.assembleContext(taskId) : '';

    // 运行时层:取该 agent 当前 active session 的 resumeId(无 → 新 session)
    // 工作区层:cwd 指向该 agent 的目录(per-agent MEMORY.md/notes)
    const agentSvc = this.deps.agentService;
    const resumeId = agentSvc?.getResumeId(agentId);
    const cwd = agentSvc?.cwdFor(agentId) ?? process.env.FIREIT_PLAYGROUND_CWD;

    const streamMsg: ThreadMessage = {
      id: newMsgId('msg'),
      threadId,
      kind: 'streaming',
      sender: agentId,
      chunks: [],
      done: false,
      at: Date.now(),
    };
    this.appendMessage(threadId, streamMsg);

    const input: AgentInvokeInput = {
      agentId,
      identityPrompt: ident.identityPrompt,
      context,
      task: this.stripMention(userText),
      cwd,
      resumeId,
      effort: agent.effort,
    };

    let finalText = '';
    let hadError = false;
    for await (const chunk of this.deps.invoker.run(input, ident.adapterType)) {
      if (chunk.kind === 'error') hadError = true;
      if (chunk.kind === 'session_bound') {
        agentSvc?.bindSessionId(agentId, chunk.sessionId);
      }
      // session_bound 不进 UI trace(它是元信息,不是 agent 输出)
      if (chunk.kind !== 'session_bound') {
        streamMsg.chunks = [...streamMsg.chunks, chunk];
        this.updateMessage(threadId, streamMsg);
      }
      if (chunk.kind === 'text') finalText += chunk.content;
    }
    streamMsg.done = true;
    this.updateMessage(threadId, streamMsg);

    // API 错误(限流/过载)→ 友好提示,不让原始 API Error 当回复
    const apiErr = /API Error|529|overloaded|rate.?limit|timeout|访问量/i.test(finalText);
    if (hadError || apiErr) {
      const friendly = apiErr
        ? `${agent.name} 的 ${ident.adapterType} API 暂时过载/限流,稍后再试`
        : `${agent.name} 执行时出错,稍后再试`;
      this.appendSystem(threadId, `⚠ ${friendly}`);
      // 广播 agent 回空闲
      this.broadcastStatus(agentId, 'idle');
      return;
    }

    // agent 状态:回到空闲
    this.broadcastStatus(agentId, 'idle');

    if (finalText.trim()) {
      this.appendAgent(threadId, agentId, finalText.trim());
    }

    // ── agent@agent 链式触发(仅 brainstorm/directed 有 turnCtx)──────────
    // agent 回复里若 @了队友,且该队友本轮未发言 → 强制拉进来回答。
    if (turnCtx && finalText.trim()) {
      await this.triggerMentionedAgents(threadId, agentId, finalText, turnCtx);
    }
  }

  // 解析 agent 输出里的 @mention → 被点名的队友(排除自指 & 已发言者)。
  private extractMentionedTargets(
    text: string,
    selfId: AgentId,
    spoken: Set<AgentId>,
  ): AgentId[] {
    const handles = parseAnyMentions(text);
    const { targets } = resolveTargets(handles, this.deps.registry);
    return targets.filter((id) => id !== selfId && !spoken.has(id));
  }

  // 链式触发:对每个被@且未发言的 agent,串行 runAgent;链长>=2 时注入 reminder。
  private async triggerMentionedAgents(
    threadId: ThreadId,
    fromId: AgentId,
    fromText: string,
    turnCtx: TurnCtx,
  ) {
    const targets = this.extractMentionedTargets(fromText, fromId, turnCtx.spoken);
    if (targets.length === 0) return;

    for (const targetId of targets) {
      // 防并发竞态:二次确认未发言(并发批次可能刚把 target 加进去)
      if (turnCtx.spoken.has(targetId)) continue;
      turnCtx.spoken.add(targetId);
      turnCtx.chain.push(targetId);

      const chainLen = turnCtx.chain.length;
      const fromName = this.deps.registry.get(fromId)?.name ?? fromId;
      const targetAgent = this.deps.registry.get(targetId);

      // reminder:链长 >= 3(已传递 2 次)→ 提醒别再踢皮球
      let taskPrefix = '';
      if (chainLen >= 3) {
        const reminder = `⚠ [reminder] 讨论已经传递 ${chainLen - 1} 次了(${turnCtx.chain
          .map((id) => this.deps.registry.get(id)?.name ?? id)
          .join(' → ')})。请直接给出结论,或明确指出到底该谁接手,不要再互相 @ 踢皮球。`;
        this.appendSystem(threadId, reminder);
        taskPrefix = `${reminder}\n\n`;
      }

      // 被点名的提示(让目标 agent 知道是被谁、为何点名)
      const mentionHint = targetAgent
        ? `${fromName} 在讨论中 @了你,需要你回应。下面是 ${fromName} 的原话:\n\n`
        : '';
      await this.runAgent(threadId, targetId, `${taskPrefix}${mentionHint}${fromText}`, turnCtx);
    }
  }

  // ── 内部:消息落库 + 广播 ──────────────────────────────
  private appendMessage(threadId: ThreadId, msg: ThreadMessage) {
    const list = this.threadsCache.get(threadId) ?? [];
    list.push(msg);
    this.threadsCache.set(threadId, list);
    // 持久化到 DB
    this.deps.db.db
      .insert(threadMessages)
      .values({
        id: msg.id,
        threadId,
        kind: msg.kind,
        sender: msg.sender,
        dataJson: JSON.stringify(msg),
        at: msg.at,
      })
      .run();
    // 更新 thread 的 updatedAt + title(首条用户消息作为标题)
    const updates: { updatedAt: number; title?: string } = { updatedAt: Date.now() };
    if (msg.kind === 'user') {
      const row = this.deps.db.db.select().from(threads).where(eq(threads.id, threadId)).get();
      if (row && !row.title) {
        updates.title = msg.text.slice(0, 40);
      }
    }
    this.deps.db.db.update(threads).set(updates).where(eq(threads.id, threadId)).run();
    this.broadcastMessage(threadId, msg);
  }

  // 更新已存在的消息(流式 streaming 消息持续追加 chunks 时用)——持久化最新版
  private updateMessage(threadId: ThreadId, msg: ThreadMessage) {
    const list = this.threadsCache.get(threadId) ?? [];
    const idx = list.findIndex((m) => m.id === msg.id);
    if (idx >= 0) list[idx] = msg;
    this.threadsCache.set(threadId, list);
    this.deps.db.raw
      .prepare('UPDATE thread_messages SET data_json = ? WHERE id = ?')
      .run(JSON.stringify(msg), msg.id);
    this.deps.broadcaster?.broadcast({ type: 'message.updated', threadId, message: msg });
  }

  private appendAgent(threadId: ThreadId, agentId: AgentId, text: string) {
    this.appendMessage(threadId, {
      id: newMsgId('msg'),
      threadId,
      kind: 'agent',
      sender: agentId,
      text,
      at: Date.now(),
    });
  }

  appendSystem(threadId: ThreadId, text: string) {
    this.appendMessage(threadId, {
      id: newMsgId('msg'),
      threadId,
      kind: 'system',
      sender: 'system',
      text,
      at: Date.now(),
    });
  }

  private broadcastMessage(threadId: ThreadId, msg: ThreadMessage) {
    this.deps.broadcaster?.broadcast({ type: 'message.appended', threadId, message: msg });
  }

  // agent 状态广播(顶栏观测用):idle 空闲 / thinking posture 判断中 / executing 执行中
  private broadcastStatus(
    agentId: AgentId,
    status: 'idle' | 'thinking' | 'executing',
    detail?: string,
  ) {
    this.deps.broadcaster?.broadcast({ type: 'agent.statusChanged', agentId, status, detail });
  }

  private stripMention(text: string): string {
    return text
      .split('\n')
      .map((l) => l.replace(/^@[a-zA-Z0-9_][\w-]*\s*/, '').trim())
      .filter((l) => l.length > 0)
      .join('\n');
  }
}
