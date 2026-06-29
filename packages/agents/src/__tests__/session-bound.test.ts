// packages/agents/src/__tests__/session-bound.test.ts
// 首行 session_meta/system.init → session_bound chunk(对齐 design:从 stream 首行抓回 session id)

import { describe, expect, it } from 'vitest';
import { normalizeLine } from '../normalize.js';

describe('session_bound capture', () => {
  it('claude system/init → session_bound', () => {
    const raw = { type: 'system', subtype: 'init', session_id: '24a9834e-abc', cwd: '/x' };
    const chunks = normalizeLine('claude-code', raw);
    expect(chunks).toEqual([{ kind: 'session_bound', sessionId: '24a9834e-abc' }]);
  });

  it('claude line with top-level session_id (no subtype) → session_bound', () => {
    const raw = { type: 'system', session_id: 'zzz-1' };
    const chunks = normalizeLine('claude-code', raw);
    expect(chunks).toEqual([{ kind: 'session_bound', sessionId: 'zzz-1' }]);
  });

  it('claude assistant line (no session info) → no session_bound', () => {
    const raw = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    const chunks = normalizeLine('claude-code', raw);
    expect(chunks.find((c) => c.kind === 'session_bound')).toBeUndefined();
  });

  it('codex session_meta → session_bound', () => {
    const raw = {
      type: 'session_meta',
      payload: { session_id: '019f1239-e956', id: '019f1239-e956', cwd: '/c' },
    };
    const chunks = normalizeLine('codex', raw);
    expect(chunks).toEqual([{ kind: 'session_bound', sessionId: '019f1239-e956' }]);
  });

  it('codex turn.completed → done (no session_bound)', () => {
    const raw = { type: 'turn.completed' };
    const chunks = normalizeLine('codex', raw);
    expect(chunks.find((c) => c.kind === 'session_bound')).toBeUndefined();
    expect(chunks.find((c) => c.kind === 'done')).toBeDefined();
  });
});
