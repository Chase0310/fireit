// packages/agents/src/adapters/codex.ts
// Codex 适配器：NDJSON 输出（对齐 m2-agent-adapters.md §3.2 §0）
//   命令：codex exec --json --skip-git-repo-check "<prompt>"
// prompt 通过 stdin 传入（codex 支持 "Reading additional input from stdin..."）

import type { AdapterSpec } from '../base-adapter.js';

export const codexSpec: AdapterSpec = {
  type: 'codex',
  binary: 'codex',
  promptViaStdin: true,
  buildArgs(_prompt, opts) {
    // 非交互 + 自主执行(跳过逐操作审批)
    const common = [
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
    ];
    // 有 resumeId → exec resume <id>(复用 CLI 对话记忆);否则 exec 新会话
    // 注:resume 子命令的 prompt 经 stdin(`-`)+ promptViaStdin;id 作位置参数
    if (opts?.resumeId) {
      return ['exec', 'resume', opts.resumeId, ...common];
    }
    return ['exec', ...common];
  },
};
