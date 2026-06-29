// packages/server/src/routes/agents.ts
// agent 名册路由 —— 给 UI 拉 team 列表(@ 候选 + 顶栏)+ agent 事件流观测

import type { TeamRegistry } from '@fireit/core';
import type { FastifyInstance } from 'fastify';
import type { DbHandle } from '../db/index.js';
import type { AgentService } from '../services/agent-service.js';

export interface AgentRoutesDeps {
  registry: TeamRegistry;
  db: DbHandle;
  agentService: AgentService;
}

// 把 Agent 映射成给前端用的 DTO(含生命周期字段)
function toAgentDto(a: ReturnType<TeamRegistry['list']>[number]) {
  return {
    agentId: a.agentId,
    handle: a.handle,
    name: a.name,
    role: a.role,
    specialties: a.specialties,
    restrictions: a.restrictions,
    adapterType: a.adapterType,
    modelFamily: a.modelFamily,
    roles: a.roles,
    available: a.available,
    color: a.color,
    personality: a.personality,
    createdAt: a.createdAt,
    createdBy: a.createdBy,
    status: a.status,
  };
}

export function registerAgentRoutes(app: FastifyInstance, deps: AgentRoutesDeps): void {
  // GET /agents —— 返回所有 agent(@ 候选 + 顶栏用)
  app.get('/agents', async () => {
    return deps.registry.list().map(toAgentDto);
  });

  // GET /agents/:id/events —— 某 agent 的完整事件流(跨所有会话,观测用)
  app.get('/agents/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    // 该 agent 参与过的所有消息(streaming 的取最终文本/工具数,system 的取提到它的)
    const agentMsgs = deps.db.raw
      .prepare(
        'SELECT thread_id, kind, sender, data_json, at FROM thread_messages WHERE sender = ? ORDER BY at DESC',
      )
      .all(id) as Array<{
      thread_id: string;
      kind: string;
      sender: string;
      data_json: string;
      at: number;
    }>;
    // 提到该 agent 的系统消息(silent 原因等)
    const sysMentions = deps.db.raw
      .prepare(
        "SELECT thread_id, data_json, at FROM thread_messages WHERE sender = 'system' AND data_json LIKE ? ORDER BY at DESC",
      )
      .all(`%${id}%`) as Array<{ thread_id: string; data_json: string; at: number }>;

    const events = [
      ...agentMsgs.map((r) => {
        const m = JSON.parse(r.data_json);
        let summary = '';
        let toolCount = 0;
        if (m.kind === 'streaming') {
          toolCount = (m.chunks ?? []).filter(
            (c: { kind: string }) => c.kind === 'tool_call' || c.kind === 'file_change',
          ).length;
          summary =
            (m.chunks ?? [])
              .filter((c: { kind: string }) => c.kind === 'text')
              .map((c: { content: string }) => c.content)
              .join('') || '(无文本输出)';
        } else if (m.kind === 'agent') {
          summary = m.text ?? '';
        }
        return {
          threadId: r.thread_id,
          kind: m.kind as string,
          at: r.at,
          summary: summary.slice(0, 120),
          toolCount,
          done: m.done ?? true,
        };
      }),
    ];
    return { agentId: id, events };
  });

  // POST /agents —— 创建 agent(写 DB + workspace 种子)
  app.post('/agents', async (req, reply) => {
    const b = req.body as Record<string, unknown> | null;
    if (!b || typeof b.handle !== 'string' || typeof b.name !== 'string') {
      return reply.code(400).send({ error: 'handle and name required' });
    }
    try {
      const ag = await deps.agentService.createAgent({
        handle: b.handle,
        name: b.name,
        role: typeof b.role === 'string' ? b.role : '',
        specialties: Array.isArray(b.specialties) ? (b.specialties as string[]) : [],
        restrictions: Array.isArray(b.restrictions) ? (b.restrictions as string[]) : [],
        adapterType: (b.adapterType as 'claude-code' | 'codex' | 'gemini-cli') ?? 'codex',
        modelFamily: (b.modelFamily as 'claude' | 'gpt' | 'gemini') ?? 'gpt',
        roles: Array.isArray(b.roles)
          ? (b.roles as ('member' | 'reviewer' | 'lead')[])
          : ['member'],
        color: typeof b.color === 'string' ? b.color : undefined,
        personality: typeof b.personality === 'string' ? b.personality : undefined,
        createdBy: 'web',
      });
      return reply.code(201).send(toAgentDto(ag));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // PATCH /agents/:id —— 编辑定义层(runtime/model/性格/role 等)
  app.patch('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body as Record<string, unknown>) ?? {};
    const ag = await deps.agentService.editAgent(id, {
      name: typeof b.name === 'string' ? b.name : undefined,
      role: typeof b.role === 'string' ? b.role : undefined,
      specialties: Array.isArray(b.specialties) ? (b.specialties as string[]) : undefined,
      restrictions: Array.isArray(b.restrictions) ? (b.restrictions as string[]) : undefined,
      adapterType: b.adapterType as 'claude-code' | 'codex' | 'gemini-cli' | undefined,
      modelFamily: b.modelFamily as 'claude' | 'gpt' | 'gemini' | undefined,
      roles: Array.isArray(b.roles) ? (b.roles as ('member' | 'reviewer' | 'lead')[]) : undefined,
      color: typeof b.color === 'string' ? b.color : undefined,
      personality: typeof b.personality === 'string' ? b.personality : undefined,
      available: typeof b.available === 'boolean' ? b.available : undefined,
      status: b.status as 'idle' | 'thinking' | 'executing' | 'stopped' | undefined,
    });
    if (!ag) return reply.code(404).send({ error: 'agent not found' });
    return reply.code(200).send(toAgentDto(ag));
  });

  // DELETE /agents/:id —— 删除(DB + workspace + session)
  app.delete('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deps.agentService.deleteAgent(id);
    if (!ok) return reply.code(404).send({ error: 'agent not found' });
    return reply.code(204).send();
  });

  // POST /agents/:id/restart —— RESTART:保留 session(resume 回去),no-op
  app.post('/agents/:id/restart', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.registry.get(id)) return reply.code(404).send({ error: 'agent not found' });
    return reply.code(204).send();
  });

  // POST /agents/:id/reset-session —— RESET SESSION:标当前 session sealed(留 workspace)
  app.post('/agents/:id/reset-session', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.registry.get(id)) return reply.code(404).send({ error: 'agent not found' });
    deps.agentService.resetSession(id);
    return reply.code(204).send();
  });

  // POST /agents/:id/full-reset —— FULL RESET:git checkout 清工作区 + 轮转 session
  app.post('/agents/:id/full-reset', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.registry.get(id)) return reply.code(404).send({ error: 'agent not found' });
    await deps.agentService.fullReset(id);
    return reply.code(204).send();
  });

  // GET /agents/:id/session —— 当前绑定的 session 信息(详情面板用)
  app.get('/agents/:id/session', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.registry.get(id)) return reply.code(404).send({ error: 'agent not found' });
    const s = deps.agentService.getOrCreateActiveSession(id);
    return {
      agentId: id,
      sessionId: s.cliSessionId,
      status: s.status,
      createdAt: s.createdAt,
      sealedAt: s.sealedAt,
    };
  });
}
