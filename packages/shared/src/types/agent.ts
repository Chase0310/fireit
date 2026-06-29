// packages/shared/src/types/agent.ts
// agent 身份契约（对齐 subsystems.md §1.1）

export type AgentId = string; // 机器可读，如 "agent_atlas"
export type AgentHandle = string; // @mention，如 "@atlas"

export type AdapterType = 'claude-code' | 'codex' | 'gemini-cli';
export type ModelFamily = 'claude' | 'gpt' | 'gemini';

export type AgentRole = 'member' | 'reviewer' | 'lead';
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'stopped';

// 思考等级:两个 CLI 的档位对齐(claude --effort / codex model_reasoning_effort)。
// minimal=快速直答;low/medium/high=递增思考;codex 用 'high' 时还会带 detailed summary。
export type AgentEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface Agent {
  agentId: AgentId;
  handle: AgentHandle;
  name: string; // 显示名
  role: string; // 角色描述
  specialties: string[];
  restrictions: string[];
  adapterType: AdapterType;
  modelFamily: ModelFamily;
  roles: AgentRole[];
  available: boolean;
  color?: string; // 身份色(消息气泡/头像用),如 "#5B5BD6"
  personality?: string; // 性格(社交/寒暄/团队氛围判断用),如 "温柔但有主见"
  effort?: AgentEffort; // 思考等级(claude --effort / codex model_reasoning_effort)
  // 生命周期(定义层持久化)
  createdAt?: number;
  createdBy?: string; // 'system' | 'web'
  status?: AgentStatus;
}

// seed 定义(启动时把硬编码 team 写进 DB;对齐 design 定义层)
export interface SeedSpec {
  agentId: AgentId;
  handle: AgentHandle;
  name: string;
  role: string;
  specialties: string[];
  restrictions: string[];
  adapterType: AdapterType;
  modelFamily: ModelFamily;
  roles: AgentRole[];
  available: boolean;
  color: string;
  personality: string;
  effort: AgentEffort; // 思考等级(运行时可改;下次 invoke 生效)
  identityPrompt: string; // seed 时也记下 identity(dev.ts 用)
}
