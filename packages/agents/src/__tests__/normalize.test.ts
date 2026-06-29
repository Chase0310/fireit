// packages/agents/src/__tests__/normalize.test.ts
// 归一化测试：每个 CLI 的真实 NDJSON fixture 行 → 正确 AgentOutputChunk（对齐 testing.md §1.3）

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  normalizeClaudeLine,
  normalizeCodexLine,
  normalizeGeminiLine,
  parseNdjsonLine,
} from '../normalize.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '__fixtures__');

function loadLines(name: string): unknown[] {
  const raw = readFileSync(join(fixtures, name), 'utf8');
  return raw
    .split('\n')
    .map((l) => parseNdjsonLine(l))
    .filter((x): x is unknown => x !== null);
}

describe('Claude Code 归一化（真实 fixture）', () => {
  const lines = loadLines('claude-code-stream.jsonl');

  it('system/init 行 → session_bound(抓回 CLI session id)', () => {
    expect(normalizeClaudeLine(lines[0])).toEqual([
      { kind: 'session_bound', sessionId: '93d99c92' },
    ]);
  });

  it('assistant thinking → thinking chunk', () => {
    const out = normalizeClaudeLine(lines[1]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('thinking');
    if (out[0]?.kind === 'thinking') {
      expect(out[0].content).toContain('Read');
    }
  });

  it('assistant tool_use(Read) → tool_call chunk 带 input + toolUseId', () => {
    const out = normalizeClaudeLine(lines[2]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('tool_call');
    if (out[0]?.kind === 'tool_call') {
      expect(out[0].tool).toBe('Read');
      expect(out[0].input).toEqual({ file_path: '/tmp/math.js' });
      expect(out[0].toolUseId).toBe('call_abc123');
    }
  });

  it('user message 的 tool_result → tool_result chunk 带内容', () => {
    const out = normalizeClaudeLine(lines[3]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('tool_result');
    if (out[0]?.kind === 'tool_result') {
      expect(out[0].toolUseId).toBe('call_abc123');
      expect(out[0].content).toContain('add(a, b)');
    }
  });

  it('assistant 文本 → text chunk', () => {
    const out = normalizeClaudeLine(lines[4]);
    expect(out).toContainEqual({ kind: 'text', content: '该文件导出了 add(a,b) 函数。' });
  });

  it('result 行 → done chunk', () => {
    const out = normalizeClaudeLine(lines[5]);
    expect(out).toEqual([{ kind: 'done', summary: '该文件导出了 add(a,b) 函数。' }]);
  });
});

describe('Codex 归一化（真实 fixture）', () => {
  const lines = loadLines('codex-ndjson.jsonl');

  it('thread.started / turn.started 被忽略', () => {
    expect(normalizeCodexLine(lines[0])).toEqual([]);
    expect(normalizeCodexLine(lines[1])).toEqual([]);
  });

  it('reasoning → thinking chunk', () => {
    const out = normalizeCodexLine(lines[2]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('thinking');
    if (out[0]?.kind === 'thinking') {
      expect(out[0].content).toContain('pong');
    }
  });

  it('agent_message → text chunk', () => {
    const out = normalizeCodexLine(lines[3]);
    expect(out).toEqual([{ kind: 'text', content: 'pong' }]);
  });

  it('command_execution(started) → tool_call, 无输出', () => {
    const out = normalizeCodexLine(lines[4]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('tool_call');
    if (out[0]?.kind === 'tool_call') {
      expect(out[0].tool).toBe('shell');
    }
  });

  it('command_execution(completed) → tool_call + tool_result(带输出)', () => {
    const out = normalizeCodexLine(lines[5]);
    expect(out.length).toBe(2);
    expect(out[0]?.kind).toBe('tool_call');
    expect(out[1]?.kind).toBe('tool_result');
    if (out[1]?.kind === 'tool_result') {
      expect(out[1].content).toContain('hi');
      expect(out[1].isError).toBeFalsy();
    }
  });

  it('turn.completed → done chunk', () => {
    const out = normalizeCodexLine(lines[6]);
    expect(out).toEqual([{ kind: 'done', summary: 'codex turn completed' }]);
  });
});

describe('Gemini CLI 归一化（fixture）', () => {
  const lines = loadLines('gemini-jsonl.jsonl');

  it('open 行被忽略', () => {
    expect(normalizeGeminiLine(lines[0])).toEqual([]);
  });

  it('text → text chunk', () => {
    expect(normalizeGeminiLine(lines[1])).toEqual([{ kind: 'text', content: 'pong' }]);
  });

  it('functionCall(edit_file) → file_change chunk', () => {
    const out = normalizeGeminiLine(lines[2]);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('file_change');
    if (out[0]?.kind === 'file_change') {
      expect(out[0].path).toBe('/tmp/app.ts');
    }
  });

  it('turnComplete → done chunk', () => {
    expect(normalizeGeminiLine(lines[3])).toEqual([
      { kind: 'done', summary: 'gemini turn completed' },
    ]);
  });
});

describe('parseNdjsonLine', () => {
  it('空行 → null', () => {
    expect(parseNdjsonLine('')).toBeNull();
    expect(parseNdjsonLine('   ')).toBeNull();
  });
  it('非法 JSON → null', () => {
    expect(parseNdjsonLine('{not json')).toBeNull();
  });
});
