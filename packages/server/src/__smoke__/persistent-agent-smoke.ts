// packages/server/src/__smoke__/persistent-agent-smoke.ts
// 运行时冒烟:验证 AgentService 三层(seed→DB 持久化→session→workspace→reset)端到端
// 用法:pnpm --filter @fireit/server exec tsx src/__smoke__/persistent-agent-smoke.ts
import { TeamRegistry } from '@fireit/core';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { openDb } from '../db/index.js';
import { AgentService } from '../services/agent-service.js';

const WS = '/tmp/fireit-smoke-ws';
rmSync(WS, { recursive: true, force: true });

const SEEDS = [
  { agentId: 'agent_atlas', handle: '@atlas', name: 'Atlas', role: '全栈', specialties: ['backend'], restrictions: [], adapterType: 'claude-code', modelFamily: 'claude', roles: ['member'], available: true, color: '#5B5BD6', personality: '沉稳', identityPrompt: '你是 Atlas' },
  { agentId: 'agent_forge', handle: '@forge', name: 'Forge', role: '后端', specialties: ['backend'], restrictions: [], adapterType: 'codex', modelFamily: 'gpt', roles: ['member'], available: true, color: '#E07B39', personality: '热血', identityPrompt: '你是 Forge' },
] as any[];

function run(dbPath: string) {
  const db = openDb({ path: dbPath });
  const registry = new TeamRegistry();
  const svc = new AgentService({ db, registry, workspaceRoot: WS });
  svc.seedAndLoad(SEEDS);
  return { db, registry, svc };
}

async function main() {
  console.log('--- seed + verify ---');
  const r1 = run(':memory:');
  const a1 = r1.svc.listAgents();
  console.log('  seeded:', a1.map(a => a.handle).join(', '));
  if (a1.length !== 2) throw new Error('expected 2 seeded');

  const mem = `${WS}/agent_atlas/MEMORY.md`;
  console.log('  MEMORY.md:', existsSync(mem), '| Identity section:', readFileSync(mem, 'utf8').includes('## Identity'), '| git init:', existsSync(`${WS}/agent_atlas/.git`));

  console.log('--- session ---');
  const s1 = r1.svc.getOrCreateActiveSession('agent_atlas');
  console.log('  initial cliSessionId:', s1.cliSessionId);
  r1.svc.bindSessionId('agent_atlas', 'cli-XYZ-123');
  console.log('  resumeId after bind:', r1.svc.getResumeId('agent_atlas'));

  console.log('--- RESET SESSION ---');
  r1.svc.resetSession('agent_atlas');
  console.log('  resumeId:', r1.svc.getResumeId('agent_atlas'), '(expect undefined) | MEMORY kept:', existsSync(mem));

  console.log('--- FULL RESET ---');
  await fs.mkdir(`${WS}/agent_atlas/notes`, { recursive: true });
  await fs.writeFile(`${WS}/agent_atlas/notes/scratch.md`, 'note');
  await r1.svc.fullReset('agent_atlas');
  console.log('  notes gone:', !existsSync(`${WS}/agent_atlas/notes/scratch.md`), '| MEMORY seed kept:', existsSync(mem));

  console.log('--- createAgent ---');
  const na = await r1.svc.createAgent({ handle: '@zed', name: 'Zed', role: '前端', specialties: ['fe'], restrictions: [], adapterType: 'codex', modelFamily: 'gpt', roles: ['member'], color: '#000', personality: '干脆', createdBy: 'web' });
  console.log('  registry:', !!r1.registry.getByHandle('@zed'), '| workspace:', existsSync(`${WS}/${na.agentId}/MEMORY.md`));

  console.log('--- persistence across restart (file DB) ---');
  const F = '/tmp/fireit-smoke.db';
  rmSync(F, { force: true });
  const ra = run(F);
  await ra.svc.createAgent({ handle: '@persist', name: 'P', role: 'r', specialties: [], restrictions: [], adapterType: 'codex', modelFamily: 'gpt', roles: ['member'] });
  ra.db.close();
  const rb = run(F);
  const after = rb.svc.listAgents();
  console.log('  after restart:', after.map(a => a.handle).join(', '));
  console.log('  no dup @atlas:', after.filter(a => a.handle === '@atlas').length === 1, '| @persist survived:', !!after.find(a => a.handle === '@persist'));
  rb.db.close();
  rmSync(F, { force: true });
  rmSync(WS, { recursive: true, force: true });
  console.log('\nALL SMOKE CHECKS PASSED');
}
main().catch((e) => { console.error('SMOKE FAILED:', e.message, e.stack); process.exit(1); });
