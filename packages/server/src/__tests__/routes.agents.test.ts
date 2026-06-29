// packages/server/src/__tests__/routes.agents.test.ts
// agent 生命周期路由:create/edit/delete/restart/reset-session/full-reset(对齐 design §API)

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TeamRegistry } from '@fireit/core';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { type DbHandle, openDb } from '../db/index.js';
import { registerAgentRoutes } from '../routes/agents.js';
import { AgentService } from '../services/agent-service.js';

let db: DbHandle;
const TMP = join(process.cwd(), '.fireit-test-routes');

afterEach(() => {
  db?.close();
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

function makeApp() {
  db = openDb({ path: ':memory:' });
  const registry = new TeamRegistry();
  const agentService = new AgentService({ db, registry, workspaceRoot: TMP });
  const app = Fastify();
  registerAgentRoutes(app, { registry, db, agentService });
  return { app, agentService };
}

describe('agent lifecycle routes', () => {
  it('POST /agents 创建 → 201 + body', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        handle: '@zed',
        name: 'Zed',
        role: '前端',
        specialties: ['fe'],
        restrictions: [],
        adapterType: 'claude-code',
        modelFamily: 'claude',
        roles: ['member'],
        color: '#000',
        personality: '干脆',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().handle).toBe('@zed');
    await app.close();
  });

  it('POST /agents 缺 handle → 400', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/agents', payload: { name: 'X' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('PATCH /agents/:id 改 personality', async () => {
    const { app, agentService } = makeApp();
    const a = await agentService.createAgent({
      handle: '@p',
      name: 'P',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/agents/${a.agentId}`,
      payload: { personality: '变了' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().personality).toBe('变了');
    await app.close();
  });

  it('DELETE /agents/:id → 204;再 GET /agents 不含它', async () => {
    const { app, agentService } = makeApp();
    const a = await agentService.createAgent({
      handle: '@d',
      name: 'D',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const res = await app.inject({ method: 'DELETE', url: `/agents/${a.agentId}` });
    expect(res.statusCode).toBe(204);
    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.find((x: { agentId: string }) => x.agentId === a.agentId)).toBeUndefined();
    await app.close();
  });

  it('POST /agents/:id/reset-session → 204;resumeId 清空', async () => {
    const { app, agentService } = makeApp();
    const a = await agentService.createAgent({
      handle: '@r',
      name: 'R',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    agentService.bindSessionId(a.agentId, 'old-cli');
    const res = await app.inject({ method: 'POST', url: `/agents/${a.agentId}/reset-session` });
    expect(res.statusCode).toBe(204);
    expect(agentService.getResumeId(a.agentId)).toBeUndefined();
    await app.close();
  });

  it('POST /agents/:id/full-reset → 204', async () => {
    const { app, agentService } = makeApp();
    const a = await agentService.createAgent({
      handle: '@f',
      name: 'F',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const res = await app.inject({ method: 'POST', url: `/agents/${a.agentId}/full-reset` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('POST /agents/:id/restart → 204(no-op;下次自然 resume)', async () => {
    const { app, agentService } = makeApp();
    const a = await agentService.createAgent({
      handle: '@rs',
      name: 'RS',
      role: 'r',
      specialties: [],
      restrictions: [],
      adapterType: 'codex',
      modelFamily: 'gpt',
      roles: ['member'],
    });
    const res = await app.inject({ method: 'POST', url: `/agents/${a.agentId}/restart` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
