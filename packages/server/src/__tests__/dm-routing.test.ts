// packages/server/src/__tests__/dm-routing.test.ts
// DM thread 路由测试:消息只发给绑定的单个 agent(不走 posture/全量候选)
//   - createThread('dm', agentId) → mode=dm, dmAgentId 持久化
//   - sendMessage → invoker 只被调用 1 次,且 agentId 是 dmAgentId
//   - 其他 agent 不被触发(对比 brainstorm 会判全员)

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamRegistry } from '@fireit/core';
import { describe, expect, it } from 'vitest';

// sendMessage 内部用 void 启异步处理链(runAgent 落库),需等它落定再断言/关库
const flushAsync = () => new Promise((r) => setImmediate(r));
import { openDb } from '../db/index.js';
import { ChatService } from '../services/chat-service.js';
import { TaskService } from '../services/task-service.js';
import { StubIdentity, StubInvoker } from './helpers.js';

function makeServices(dbPath: string, agentIds: string[]) {
  const db = openDb({ path: dbPath });
  const identity = new StubIdentity();
  const invoker = new StubInvoker();
  const registry = new TeamRegistry();
  for (const id of agentIds) {
    registry.register({
      agentId: id,
      handle: `@${id.replace('agent_', '')}`,
      name: id.replace('agent_', ''),
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
      available: true,
    });
    identity.register(id, `你是 ${id}`, 'codex');
  }
  const taskService = new TaskService(db, null, identity, invoker);
  const chatService = new ChatService({
    db,
    broadcaster: null,
    registry,
    identity,
    invoker,
    taskService,
  });
  return { db, chatService, invoker, registry };
}

function tempDbPath(): string {
  return join(tmpdir(), `fireit-dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

describe('DM thread 单 agent 路由', () => {
  it('createThread("dm", agentId) → mode=dm, dmAgentId 持久化', () => {
    const path = tempDbPath();
    const { db, chatService } = makeServices(path, ['agent_atlas', 'agent_forge']);
    const tid = chatService.createThread('dm', 'agent_atlas');
    expect(chatService.getMode(tid)).toBe('dm');
    expect(chatService.getDmAgentId(tid)).toBe('agent_atlas');
    // listThreads 也带 dmAgentId
    const list = chatService.listThreads();
    expect(list[0]?.mode).toBe('dm');
    expect(list[0]?.dmAgentId).toBe('agent_atlas');
    db.close();
    rmSync(path, { force: true });
  });

  it('sendMessage → invoker 只被调用 1 次,且发给 dmAgentId', async () => {
    const path = tempDbPath();
    const { db, chatService, invoker } = makeServices(path, ['agent_atlas', 'agent_forge', 'agent_nova']);
    invoker.nextChunks = [{ kind: 'done', summary: 'ok' }];
    const tid = chatService.createThread('dm', 'agent_atlas');
    await chatService.sendMessage(tid, '你好');
    await flushAsync();
    // DM 只调用 1 次(对比 brainstorm 会判全员)
    expect(invoker.calls.length).toBe(1);
    expect(invoker.calls[0]?.agentId).toBe('agent_atlas');
    db.close();
    rmSync(path, { force: true });
  });

  it('DM 模式不触发其他 agent(只 dmAgentId 在消息流里出现)', async () => {
    const path = tempDbPath();
    const { db, chatService } = makeServices(path, ['agent_atlas', 'agent_forge']);
    const tid = chatService.createThread('dm', 'agent_atlas');
    await chatService.sendMessage(tid, '测试');
    await flushAsync();
    const msgs = chatService.getMessages(tid);
    // agent 消息的 sender 只能是 agent_atlas,不能有 forge
    const agentSenders = msgs.filter((m) => m.kind === 'streaming' || m.kind === 'agent').map((m) => m.sender);
    expect(agentSenders.every((s) => s === 'agent_atlas')).toBe(true);
    expect(agentSenders.some((s) => s === 'agent_forge')).toBe(false);
    db.close();
    rmSync(path, { force: true });
  });

  it('dmAgentId 跨重启持久化(关库重开仍读得回)', () => {
    const path = tempDbPath();
    const tid = (() => {
      const { db, chatService } = makeServices(path, ['agent_atlas']);
      const t = chatService.createThread('dm', 'agent_atlas');
      db.close();
      return t;
    })();
    // 重开:缓存空,从 DB 读
    const { db, chatService } = makeServices(path, ['agent_atlas']);
    expect(chatService.getDmAgentId(tid)).toBe('agent_atlas');
    expect(chatService.getMode(tid)).toBe('dm');
    db.close();
    rmSync(path, { force: true });
  });
});
