// packages/shared/src/types/agent-output.ts
// coding agent 适配器统一输出契约（对齐 subsystems.md §5.1）

import type { AgentId } from './agent.js';
import type { AdapterType } from './agent.js';

export type AgentOutputChunk =
  | { kind: 'text'; content: string }
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_call'; tool: string; input: unknown; toolUseId?: string }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { kind: 'file_change'; path: string; diff: string }
  | { kind: 'session_bound'; sessionId: string } // CLI 报回的真实 session id(首行)
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };

export interface AgentInvokeInput {
  agentId: AgentId;
  identityPrompt: string; // 身份注入（"你是 Atlas，角色..."）
  context: string; // 对话历史 + team 名册 + task 上下文
  task: string; // 当前 step 指令
  cwd?: string; // 工作目录（agent 在此真实写文件）
  resumeId?: string; // CLI session id;有则 --resume,否则新 session
  effort?: import('./agent.js').AgentEffort; // 思考等级(claude --effort / codex -c model_reasoning_effort)
}

export interface HealthStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
}

export interface AgentAdapter {
  type: AdapterType;
  invoke(input: AgentInvokeInput): AsyncIterable<AgentOutputChunk>;
  healthCheck(): Promise<HealthStatus>;
}
