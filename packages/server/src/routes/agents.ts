// packages/server/src/routes/agents.ts
// agent 名册路由 —— 给 UI 拉 team 列表(@ 候选 + 顶栏)+ agent 事件流观测

import type { TeamRegistry } from '@fireit/core';
import type { FastifyInstance } from 'fastify';
import type { AgentService } from '../services/agent-service.js';
import type { DbHandle } from '../db/index.js';

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
}
