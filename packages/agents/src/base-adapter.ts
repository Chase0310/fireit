// packages/agents/src/base-adapter.ts
// 适配器配置描述：每个 CLI 怎么 spawn、怎么归一化（对齐 m2-agent-adapters.md §2 §4）

import type { AdapterType, AgentEffort } from '@fireit/shared';

// 每个 CLI 的 spawn 命令规格
export interface AdapterSpec {
  type: AdapterType;
  // 二进制名（spawn 的命令）
  binary: string;
  // 拼 CLI 参数。
  //   prompt   = user-role 内容(当前这一句任务/消息)
  //   opts.systemPrompt = system/developer-role 内容(身份 + 上下文;压缩免疫)
  //   opts 携带运行时可调项(resumeId/effort)
  buildArgs(
    prompt: string,
    opts?: { resumeId?: string; effort?: AgentEffort; systemPrompt?: string },
  ): string[];
  // 是否把 prompt 通过 stdin 传入（而非命令行参数），避免长 prompt 超限 / 转义问题
  promptViaStdin: boolean;
  // 归一化函数（来自 normalize.ts）
}

// 把 identity + context 拼成 system/developer-role 内容(压缩免疫;对齐 Slock/clowder 身份注入)。
// 这是 agent 持久的身份上下文,不应被 CLI 的上下文压缩丢弃。
export function composeSystemPrompt(input: {
  identityPrompt: string;
  context: string;
}): string {
  return [input.identityPrompt, input.context]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n---\n\n');
}
