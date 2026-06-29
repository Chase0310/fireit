// packages/server/src/dev.ts
// 开发/验收用启动入口:预置 Atlas/Forge/Nova 三个 agent(真实 CLI)+ per-agent workspace
// 用法:pnpm --filter @fireit/server dev:full
// 区别于默认 dev(NullIdentity,无 agent)

import { makeAdapter } from '@fireit/agents';
import { TeamRegistry } from '@fireit/core';
import type { AdapterType, AgentInvokeInput, SeedSpec } from '@fireit/shared';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './index.js';

// 路径统一:相对 fireit 项目根解析(不依赖启动时 cwd)。
// 本文件在 packages/server/src/,项目根在上 3 级。
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const FIREIT_DIR = join(PROJECT_ROOT, '.fireit');

// 兼容旧 playground env(ChatService 兜底 cwd;per-agent workspace 由 AgentService 管)
process.env.FIREIT_PLAYGROUND_CWD = join(FIREIT_DIR, 'playground');

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
    effort: 'high',
    identityPrompt:
      '你是 Atlas,全栈工程师。直接执行,简短回复。完成时说 DONE。\n你可以用 @forge/@nova 点名队友回答(如"@forge 这个后端接口你来"),被点名的人会被强制拉进来。但别滥用——能自己答的直接答,只在确实需要别人专长时才 @。',
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
    effort: 'medium',
    identityPrompt:
      '你是 Forge,后端工程师。直接执行,简短回复。完成时说 DONE。\n你可以用 @atlas/@nova 点名队友回答,被点名的人会被强制拉进来。但别滥用——能自己答的直接答,只在确实需要别人专长时才 @。',
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
    effort: 'high',
    identityPrompt:
      '你是 Nova,代码审查员。检查后给结论:通过 或 有问题(说明原因)。\n你可以用 @atlas/@forge 点名队友回答,被点名的人会被强制拉进来。但别滥用——能自己答的直接答,只在确实需要别人专长时才 @。',
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
  dbPath: join(FIREIT_DIR, 'fireit.db'),
  registry,
  seeds: SEEDS,
  workspaceRoot: join(FIREIT_DIR, 'agents'),
  identity,
  invoker,
});
console.log('🔥 fireit dev server (full, 3 agents) ready');
console.log('   REST: http://127.0.0.1:3140');
console.log('   WS:   ws://127.0.0.1:3140/ws');
console.log(`   data root: ${FIREIT_DIR}/`);
console.log('   在 http://localhost:5170 用 @atlas/@forge/@nova 验收');
