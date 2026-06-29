// packages/agents/src/index.ts — @fireit/agents re-export

export { composeSystemPrompt, type AdapterSpec } from './base-adapter.js';
export { claudeCodeSpec } from './adapters/claude-code.js';
export { codexSpec } from './adapters/codex.js';
export { geminiSpec } from './adapters/gemini-cli.js';
export {
  normalizeLine,
  normalizeClaudeLine,
  normalizeCodexLine,
  normalizeGeminiLine,
  parseNdjsonLine,
} from './normalize.js';
export { AgentRunner, specFor, type SpawnFn } from './runner.js';
export { checkHealth, type HealthProbe } from './health.js';
export { makeAdapter } from './adapter.js';
