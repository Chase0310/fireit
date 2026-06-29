// packages/server/src/__tests__/agent-mention.test.ts
// agent@agent 链式触发测试(对齐 design:被@强制回答 + 三层防循环)
//   - A 回复含 @B → B 被触发
//   - 自指 @A → 忽略
//   - spoken 去重:A@B→B@A 时 A 不二次触发
//   - 链长 >= 3 → reminder 注入

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamRegistry } from '@fireit/core';
import type { AgentInvokeInput, AgentOutputChunk } from '@fireit/shared';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index.js';
import { ChatService } from '../services/chat-service.js';
import { TaskService } from '../services/task-service.js';
import { StubIdentity } from './helpers.js';

// 按 agentId 定制输出的 invoker:可让某 agent 回复里含 @mention
class ScriptedInvoker {
  calls: { agentId: string }[] = [];
  // agentId → 该 agent 吐出的 chunks
  scripts: Record<string, AgentOutputChunk[]> = {};
  async *run(input: AgentInvokeInput): AsyncIterable<AgentOutputChunk> {
    this.calls.push({ agentId: input.agentId });
    const chunks = this.scripts[input.agentId] ?? [{ kind: 'done', summary: 'ok' }];
    for (const c of chunks) yield c;
  }
}

function makeServices(
  dbPath: string,
  agentIds: string[],
  invoker: ScriptedInvoker,
  opts: { speakFirst?: string } = {},
) {
  const db = openDb({ path: dbPath });
  const identity = new StubIdentity();
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
  // 有 speakFirst:只让指定 agent 首批发言(其余 silent),这样 agent@agent 链才真实传递
  const judge = opts.speakFirst
    ? async ({ agent }: { agent: { agentId: string } }) =>
        agent.agentId === opts.speakFirst
          ? ({ decision: 'participate' as const, reason: '首发' })
          : ({ decision: 'silent' as const, reason: '等被@' })
    : undefined;
  const chatService = new ChatService({
    db,
    broadcaster: null,
    registry,
    identity,
    invoker,
    taskService,
    ...(judge ? { brainstormPostureJudge: judge as never } : {}),
  });
  return { db, chatService, invoker };
}

const flushAsync = () => new Promise((r) => setImmediate(r));
function tempDbPath(): string {
  return join(tmpdir(), `fireit-mention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

describe('agent@agent 链式触发', () => {
  it('A 回复含 @B → B 被强制触发(invoker 调用 2 次,A 和 B)', async () => {
    const path = tempDbPath();
    const invoker = new ScriptedInvoker();
    // Atlas 回复里 @forge
    invoker.scripts['agent_atlas'] = [
      { kind: 'text', content: '这个后端的事 @forge 你来搞' },
      { kind: 'done', summary: 'ok' },
    ];
    invoker.scripts['agent_forge'] = [{ kind: 'text', content: '好的我接' }, { kind: 'done', summary: 'ok' }];
    // nova 默认 done(不参与)
    const { db, chatService } = makeServices(path, ['agent_atlas', 'agent_forge', 'agent_nova'], invoker, {
      speakFirst: 'agent_atlas',
    });

    const tid = chatService.createThread('brainstorm');
    await chatService.sendMessage(tid, '谁来做后端?');
    await flushAsync();

    const called = invoker.calls.map((c) => c.agentId);
    expect(called).toContain('agent_atlas');
    expect(called).toContain('agent_forge');
    db.close();
    rmSync(path, { force: true });
  });

  it('自指 @自己 → 忽略(不会重复触发自己)', async () => {
    const path = tempDbPath();
    const invoker = new ScriptedInvoker();
    invoker.scripts['agent_atlas'] = [
      { kind: 'text', content: '我来吧 @atlas 自己搞定' },
      { kind: 'done', summary: 'ok' },
    ];
    const { db, chatService } = makeServices(path, ['agent_atlas'], invoker, {
      speakFirst: 'agent_atlas',
    });
    const tid = chatService.createThread('brainstorm');
    await chatService.sendMessage(tid, 'hi');
    await flushAsync();
    // atlas 只被调用 1 次(自指不触发)
    const atlasCalls = invoker.calls.filter((c) => c.agentId === 'agent_atlas').length;
    expect(atlasCalls).toBe(1);
    db.close();
    rmSync(path, { force: true });
  });

  it('spoken 去重:A@B→B@A → A 不二次触发', async () => {
    const path = tempDbPath();
    const invoker = new ScriptedInvoker();
    invoker.scripts['agent_atlas'] = [
      { kind: 'text', content: '@forge 你来' },
      { kind: 'done', summary: 'ok' },
    ];
    // forge 回头 @atlas(想踢回去)
    invoker.scripts['agent_forge'] = [
      { kind: 'text', content: '@atlas 还是你来吧' },
      { kind: 'done', summary: 'ok' },
    ];
    const { db, chatService } = makeServices(path, ['agent_atlas', 'agent_forge'], invoker, {
      speakFirst: 'agent_atlas',
    });
    const tid = chatService.createThread('brainstorm');
    await chatService.sendMessage(tid, 'go');
    await flushAsync();
    // atlas 只被调用 1 次(已被 spoken,forge @它也不触发)
    expect(invoker.calls.filter((c) => c.agentId === 'agent_atlas').length).toBe(1);
    expect(invoker.calls.filter((c) => c.agentId === 'agent_forge').length).toBe(1);
    db.close();
    rmSync(path, { force: true });
  });

  it('链长 >= 3 → reminder system 消息注入', async () => {
    const path = tempDbPath();
    const invoker = new ScriptedInvoker();
    invoker.scripts['agent_atlas'] = [{ kind: 'text', content: '@forge' }, { kind: 'done', summary: 'ok' }];
    invoker.scripts['agent_forge'] = [{ kind: 'text', content: '@nova' }, { kind: 'done', summary: 'ok' }];
    invoker.scripts['agent_nova'] = [{ kind: 'text', content: '我做' }, { kind: 'done', summary: 'ok' }];
    const { db, chatService } = makeServices(path, ['agent_atlas', 'agent_forge', 'agent_nova'], invoker, {
      speakFirst: 'agent_atlas',
    });
    const tid = chatService.createThread('brainstorm');
    await chatService.sendMessage(tid, 'go');
    await flushAsync();
    const msgs = chatService.getMessages(tid);
    const hasReminder = msgs.some(
      (m) => m.kind === 'system' && (m as { text: string }).text.includes('reminder'),
    );
    expect(hasReminder).toBe(true);
    // 三个都被触发
    expect(invoker.calls.map((c) => c.agentId)).toEqual(
      expect.arrayContaining(['agent_atlas', 'agent_forge', 'agent_nova']),
    );
    db.close();
    rmSync(path, { force: true });
  });
});
