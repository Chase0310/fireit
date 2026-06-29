// packages/agents/src/base-adapter.ts
// 适配器配置描述：每个 CLI 怎么 spawn、怎么归一化（对齐 m2-agent-adapters.md §2 §4）

import type { AdapterType } from '@fireit/shared';

// 每个 CLI 的 spawn 命令规格
export interface AdapterSpec {
  type: AdapterType;
  // 二进制名（spawn 的命令）
  binary: string;
  // 把完整 prompt 拼成 CLI 参数
  buildArgs(prompt: string, opts?: { resumeId?: string }): string[];
  // 是否把 prompt 通过 stdin 传入（而非命令行参数），避免长 prompt 超限 / 转义问题
  promptViaStdin: boolean;
  // 归一化函数（来自 normalize.ts）
}

// 把 identity + context + task 拼成完整 prompt（对齐 m2-agent-adapters.md §4 身份注入方式）
export function composePrompt(input: {
  identityPrompt: string;
  context: string;
  task: string;
}): string {
  return [input.identityPrompt, input.context, `# 当前任务\n${input.task}`]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n---\n\n');
}
