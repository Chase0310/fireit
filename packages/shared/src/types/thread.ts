// packages/shared/src/types/thread.ts
// thread / message 契约 —— chat 驱动范式的核心数据结构
// 一个 thread 承载一段协作对话;message 是不可变的事件流单元。

import type { AgentOutputChunk } from './agent-output.js';
import type { AgentId } from './agent.js';
import type { InterventionDecision } from './review.js';
import type { StepId, TaskId } from './task.js';

export type ThreadId = string;
export type MessageId = string;

// 消息发送者:user 或某个 agent
export type Sender = 'user' | AgentId;

// 消息种类(对应 UI 的 4+ 变体)
//   user:      用户发的普通消息
//   agent:     agent 的普通回复(最终文本)
//   streaming: agent 执行中的工具流(终端式,等宽低对比)
//   intervention: 护栏触发的介入消息(内嵌 diff + Edit 改指令)
//   system:    系统提示(phase 推进、phase ready 等)
export type MessageKind = 'user' | 'agent' | 'streaming' | 'intervention' | 'system';

export interface BaseMessage {
  id: MessageId;
  threadId: ThreadId;
  kind: MessageKind;
  sender: Sender;
  at: number;
}

export interface UserMessage extends BaseMessage {
  kind: 'user';
  sender: 'user';
  text: string; // 自然语言,可能含 @mention
}

export interface AgentMessage extends BaseMessage {
  kind: 'agent';
  sender: AgentId;
  text: string; // agent 最终回复
}

export interface StreamingMessage extends BaseMessage {
  kind: 'streaming';
  sender: AgentId;
  chunks: AgentOutputChunk[]; // 工具调用流(终端式渲染)
  done: boolean; // 是否已结束
}

export interface InterventionMessage extends BaseMessage {
  kind: 'intervention';
  sender: 'system';
  decision: InterventionDecision;
  stepId: StepId;
  taskId: TaskId;
  diff?: string; // 改动 diff(可展开)
  reviewFindings?: Array<{ severity: string; description: string }>;
  resolved: boolean; // 用户是否已处理
}

export interface SystemMessage extends BaseMessage {
  kind: 'system';
  sender: 'system';
  text: string; // "phase 实现已完成,质控 ready" 之类
}

export type ThreadMessage =
  | UserMessage
  | AgentMessage
  | StreamingMessage
  | InterventionMessage
  | SystemMessage;

// thread 投影
export interface Thread {
  threadId: ThreadId;
  taskId: TaskId | null; // 关联的 task(若已创建)
  messages: ThreadMessage[];
  dmAgentId: AgentId | null; // DM 模式绑定的单 agent(非 DM 为 null)
  createdAt: number;
}

// thread 模式:头脑风暴(全员讨论) vs 有向协作(phase 驱动) vs 单聊
//   brainstorm: 消息来 → 所有在场 agent 跑 posture 判断要不要发言(克制)
//   directed:   绑 task 后,phase 驱动 + @ 强制路由
//   dm:         单 agent 路由(不走 posture/@/content-routing;只 dmAgentId 回)
export type ThreadMode = 'brainstorm' | 'directed' | 'dm';

// 发送消息的请求
export interface SendMessageRequest {
  text: string;
  taskId?: TaskId; // 若已有 task,消息关联到它;否则可能是"创建 task"意图
}

export interface SendMessageResponse {
  messageId: MessageId;
  threadId: ThreadId;
  taskId: TaskId | null; // 若触发了 task 创建
}
