// packages/server/src/dev.ts
// 开发/验收用启动入口:预置 Atlas/Forge/Nova 三个 agent(真实 CLI)+ per-agent workspace
// 用法:pnpm --filter @fireit/server dev:full
// 区别于默认 dev(NullIdentity,无 agent)

import { makeAdapter } from '@fireit/agents';
import { TeamRegistry } from '@fireit/core';
import type { AdapterType, AgentInvokeInput, SeedSpec } from '@fireit/shared';
import { startServer } from './index.js';

// 兼容旧 playground env(ChatService 兜底 cwd;per-agent workspace 由 AgentService 管)
process.env.FIREIT_PLAYGROUND_CWD = '.fireit/playground';

const registry = new TeamRegistry();

const SEEDS: SeedSpec[] = [
  {
    agentId: 'agent_atlas',
    handle: '@atlas',
    name: 'Atlas',
    role: '全栈实现',
    specialties: ['backend', 'frontend', 'implementation'],
    restrictions: [],
    adapterType: 'claude-code',
    modelFamily: 'claude',
    roles: ['member', 'lead'],
    available: true,
    color: '#5B5BD6',
    personality: '沉稳可靠,话不多但每句到位,被点名会很投入',
    identityPrompt: '你是 Atlas,全栈工程师。直接执行,简短回复。完成时说 DONE。',
  },
  {
    agentId: 'agent_forge',
    handle: '@forge',
    name: 'Forge',
    role: '后端实现',
    specialties: ['backend', 'api', 'database'],
    restrictions: [],
    adapterType: 'codex',
    modelFamily: 'gpt',
    roles: ['member'],
    available: true,
    color: '#E07B39',
    personality: '热血奔放,精力旺盛,爱抢话但心思细',
    identityPrompt: '你是 Forge,后端工程师。直接执行,简短回复。完成时说 DONE。',
  },
  {
    agentId: 'agent_nova',
    handle: '@nova',
    name: 'Nova',
    role: '验收/审查',
    specialties: ['review', 'test', 'quality'],
    restrictions: ['禁写生产代码'],
    adapterType: 'codex',
    modelFamily: 'gpt',
    roles: ['reviewer'],
    available: true,
    color: '#16A6A6',
    personality: '严谨温和,不爱插嘴,但看到问题会认真说',
    identityPrompt: '你是 Nova,代码审查员。检查后给结论:通过 或 有问题(说明原因)。',
  },
];

const identity = {
  getIdentity(id: string) {
    const found = SEEDS.find((s) => s.agentId === id);
    if (!found) return null;
    return { identityPrompt: found.identityPrompt, adapterType: found.adapterType as AdapterType };
  },
};
const invoker = {
  async *run(input: AgentInvokeInput, type: AdapterType) {
    yield* makeAdapter(type).invoke(input);
  },
};

await startServer({
  port: 3140,
  dbPath: '.fireit/fireit.db',
  registry,
  seeds: SEEDS,
  identity,
  invoker,
});
console.log('🔥 fireit dev server (full, 3 agents) ready');
console.log('   REST: http://127.0.0.1:3140');
console.log('   WS:   ws://127.0.0.1:3140/ws');
console.log('   per-agent workspace: .fireit/agents/<id>/');
console.log('   在 http://localhost:5170 用 @atlas/@forge/@nova 验收');
