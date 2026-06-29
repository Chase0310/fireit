// packages/agents/src/__tests__/resume-args.test.ts
// buildArgs 在 resumeId 有/无时的分支（对齐 design 三档重启的 RESTART/RESET SESSION）

import { describe, expect, it } from 'vitest';
import { claudeCodeSpec } from '../adapters/claude-code.js';
import { codexSpec } from '../adapters/codex.js';

describe('AdapterSpec.buildArgs resumeId', () => {
  it('claude-code: 无 resumeId → 不带 --resume', () => {
    const args = claudeCodeSpec.buildArgs('hi');
    expect(args).not.toContain('--resume');
    expect(args).toEqual([
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]);
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

describe('AdapterSpec.buildArgs effort(思考等级)', () => {
  it('claude-code: effort → --effort <level>', () => {
    const args = claudeCodeSpec.buildArgs('hi', { effort: 'high' });
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });

  it('codex: effort → -c model_reasoning_effort=<level>', () => {
    const args = codexSpec.buildArgs('hi', { effort: 'low' });
    const i = args.indexOf('-c');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('model_reasoning_effort=low');
  });

  it('无 effort → 不注入思考等级参数(用 CLI 默认)', () => {
    expect(claudeCodeSpec.buildArgs('hi')).not.toContain('--effort');
    expect(codexSpec.buildArgs('hi')).not.toContain('-c');
  });

  it('effort + resumeId 可同时生效', () => {
    const args = codexSpec.buildArgs('hi', { effort: 'medium', resumeId: 'abc' });
    expect(args[1]).toBe('resume');
    expect(args).toContain('model_reasoning_effort=medium');
  });
});

describe('AdapterSpec.buildArgs systemPrompt(身份走 system/developer role)', () => {
  it('claude-code: systemPrompt → --append-system-prompt(保留默认人格,追加身份)', () => {
    const args = claudeCodeSpec.buildArgs('当前任务', {
      systemPrompt: '你是 Atlas,全栈工程师。',
    });
    expect(args).toContain('--append-system-prompt');
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('你是 Atlas,全栈工程师。');
    // user prompt 只剩任务,不含身份
    expect(args[args.indexOf('-p') + 1]).toBe('当前任务');
  });

  it('codex: systemPrompt → -c developer_instructions=(developer role)', () => {
    const args = codexSpec.buildArgs('当前任务', {
      systemPrompt: '你是 Forge,后端工程师。',
    });
    const i = args.indexOf('-c');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('developer_instructions=你是 Forge,后端工程师。');
  });

  it('无 systemPrompt → 不注入身份参数(纯 user prompt)', () => {
    expect(claudeCodeSpec.buildArgs('hi')).not.toContain('--append-system-prompt');
    expect(codexSpec.buildArgs('hi').some((a) => a.startsWith('developer_instructions'))).toBe(false);
  });

  it('systemPrompt + effort + resumeId 三者共存', () => {
    const args = codexSpec.buildArgs('任务', {
      systemPrompt: '身份',
      effort: 'high',
      resumeId: 'sid-1',
    });
    expect(args[1]).toBe('resume');
    expect(args).toContain('developer_instructions=身份');
    expect(args).toContain('model_reasoning_effort=high');
  });
});
