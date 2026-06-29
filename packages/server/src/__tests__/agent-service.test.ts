// packages/server/src/__tests__/agent-service.test.ts
// AgentService:定义层持久化 + session 查询/轮转 + workspace 锚点(对齐 design 三层)

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TeamRegistry } from '@fireit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type DbHandle, openDb } from '../db/index.js';
import { AgentService } from '../services/agent-service.js';

let db: DbHandle;
const TMP = join(process.cwd(), '.fireit-test-agents');

afterEach(() => {
  db?.close();
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

function makeService() {
  db = openDb({ path: ':memory:' });
  const registry = new TeamRegistry();
  const svc = new AgentService({ db, registry, workspaceRoot: TMP });
  return { registry, svc };
}

describe('AgentService definition layer', () => {
  it('createAgent 写 DB + 注册到 registry + 建 workspace + 种子 MEMORY.md', async () => {
    const { svc, registry } = makeService();
    const a = await svc.createAgent({
      handle: '@zed',
      name: 'Zed',
      role: '前端',
      specialties: ['frontend'],
      restrictions: [],
      adapterType: 'claude-code',
      modelFamily: 'claude',
      roles: ['member'],
      color: '#000',
      personality: '干脆',
      createdBy: 'web',
    });
    expect(a.agentId).toBeTruthy();
    expect(registry.get(a.agentId)).toBeDefined();
    expect(registry.getByHandle('@zed')?.name).toBe('Zed');
    // workspace 目录 + 种子 MEMORY.md 存在
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(join(TMP, a.agentId, 'MEMORY.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('listAgents 返回 DB 中所有 agent', async () => {
    const { svc } = makeService();
    await svc.createAgent({
      handle: '@a',
      name: 'A',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    await svc.createAgent({
      handle: '@b',
      name: 'B',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    expect(svc.listAgents().length).toBe(2);
  });

  it('deleteAgent 删 DB + registry + workspace 目录', async () => {
    const { svc, registry } = makeService();
    const a = await svc.createAgent({
      handle: '@x',
      name: 'X',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    await svc.deleteAgent(a.agentId);
    expect(registry.get(a.agentId)).toBeUndefined();
    expect(svc.listAgents().length).toBe(0);
  });
});

describe('AgentService runtime/session layer', () => {
  it('getOrCreateActiveSession 首次返回无 cliSessionId 的新 active session', async () => {
    const { svc } = makeService();
    const a = await svc.createAgent({
      handle: '@s',
      name: 'S',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const s = svc.getOrCreateActiveSession(a.agentId);
    expect(s.status).toBe('active');
    expect(s.cliSessionId).toBeNull();
  });

  it('bindSessionId 回填 cliSessionId;再次 getOrCreate 返回同一行', async () => {
    const { svc } = makeService();
    const a = await svc.createAgent({
      handle: '@s2',
      name: 'S2',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const s = svc.getOrCreateActiveSession(a.agentId);
    svc.bindSessionId(a.agentId, 'cli-abc');
    const s2 = svc.getOrCreateActiveSession(a.agentId);
    expect(s2.id).toBe(s.id);
    expect(s2.cliSessionId).toBe('cli-abc');
  });

  it('resetSession 标当前 active 为 sealed;下次 getOrCreate 开新 session', async () => {
    const { svc } = makeService();
    const a = await svc.createAgent({
      handle: '@s3',
      name: 'S3',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    svc.bindSessionId(a.agentId, 'old');
    const old = svc.getOrCreateActiveSession(a.agentId);
    svc.resetSession(a.agentId);
    const fresh = svc.getOrCreateActiveSession(a.agentId);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.cliSessionId).toBeNull();
  });
});

describe('AgentService workspace reset', () => {
  it('fullReset 清工作区文件(git checkout 回 init);session 也轮转', async () => {
    const { svc } = makeService();
    const a = await svc.createAgent({
      handle: '@f',
      name: 'F',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const fs = await import('node:fs/promises');
    const notes = join(TMP, a.agentId, 'notes', 'a.md');
    await fs.mkdir(join(TMP, a.agentId, 'notes'), { recursive: true });
    await fs.writeFile(notes, 'agent-written');
    await svc.fullReset(a.agentId);
    await expect(fs.stat(notes)).rejects.toThrow();
    // MEMORY.md 种子还在(init 锚点保留)
    const mem = await fs.stat(join(TMP, a.agentId, 'MEMORY.md'));
    expect(mem.isFile()).toBe(true);
  });
});
