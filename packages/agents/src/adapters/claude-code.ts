// packages/agents/src/adapters/claude-code.ts
// Claude Code 适配器：stream-json 输出（对齐 m2-agent-adapters.md §3.1）
//   命令：claude -p "<prompt>" --output-format stream-json --verbose

import type { AdapterSpec } from '../base-adapter.js';

export const claudeCodeSpec: AdapterSpec = {
  type: 'claude-code',
  binary: 'claude',
  promptViaStdin: false,
  buildArgs(prompt, opts) {
    // --dangerously-skip-permissions：自主 agent 场景，跳过逐工具审批（fireit 自己的介入机制是替代品）
    const base = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];
    if (opts?.resumeId) {
      base.splice(1, 0, '--resume', opts.resumeId);
    }
    return base;
  },
};
