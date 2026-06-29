// packages/agents/src/__tests__/resume-args.test.ts
// buildArgs 在 resumeId 有/无时的分支（对齐 design 三档重启的 RESTART/RESET SESSION）

import { describe, expect, it } from 'vitest';
import { claudeCodeSpec } from '../adapters/claude-code.js';
import { codexSpec } from '../adapters/codex.js';

describe('AdapterSpec.buildArgs resumeId', () => {
  it('claude-code: 无 resumeId → 不带 --resume', () => {
    const args = claudeCodeSpec.buildArgs('hi');
    expect(args).not.toContain('--resume');
    expect(args).toEqual(['-p', 'hi', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions']);
  });

  it('claude-code: 有 resumeId → 插入 --resume <id>', () => {
    const args = claudeCodeSpec.buildArgs('hi', { resumeId: 'abc-123' });
    expect(args).toContain('--resume');
    const i = args.indexOf('--resume');
    expect(args[i + 1]).toBe('abc-123');
  });

  it('codex: 无 resumeId → exec 子命令', () => {
    const args = codexSpec.buildArgs('hi');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('codex: 有 resumeId → exec resume 子命令 + id', () => {
    const args = codexSpec.buildArgs('hi', { resumeId: '019f1239' });
    // codex exec resume <id> <prompt>(非交互;--json 流式输出)
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args).toContain('019f1239');
    expect(args).toContain('--json');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
  });
});
