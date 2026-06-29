// packages/web/src/components/MessageInput.tsx
// 底部输入框 —— 唯一交互入口
// @ 触发 agent 候选浮层:键盘 ↑↓ 选择,Enter/Tab 选中,Esc 关闭

import type { Agent } from '@fireit/shared';
import { useMemo, useRef, useState } from 'react';
import { useChatStore } from '../stores/chat-store.js';

export function MessageInput() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const connected = useChatStore((s) => s.connected);
  const team = useChatStore((s) => s.team);
  const mode = useChatStore((s) => s.mode);
  const dmAgentId = useChatStore((s) => s.dmAgentId);
  const [text, setText] = useState('');
  const [selIdx, setSelIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // DM 模式:提示只这一个 agent 回;否则群聊可 @ 全员
  const dmAgent = dmAgentId ? team.find((a) => a.agentId === dmAgentId) : null;
  const placeholder = !connected
    ? '连接中…'
    : mode === 'dm' && dmAgent
      ? `发消息给 ${dmAgent.name}(只 TA 回)`
      : '说点什么… 输入 @ 选择厨师';

  // 解析当前光标位置是否处于 @ 触发态,以及已输入的 query
  const mention = useMemo(() => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    // 行首或空格后的 @,后跟非空白字符
    const m = before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
    if (!m) return null;
    return { query: m[1] ?? '', atStart: (m.index ?? 0) + (m[0].startsWith('@') ? 0 : 1) };
  }, [text]);

  const candidates: Agent[] = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const pool = team.filter((a) => a.available);
    return q === ''
      ? pool
      : pool.filter((a) => a.handle.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [mention, team]);

  const showPopover = mention !== null && candidates.length > 0;
  const safeSel = Math.min(selIdx, Math.max(0, candidates.length - 1));

  const insertMention = (agent: Agent) => {
    if (!mention) return;
    const before = text.slice(0, mention.atStart);
    const after = text.slice(inputRef.current?.selectionStart ?? text.length);
    // 插入 handle(不含 @,@ 在 before 里) + 一个空格
    setText(`${before}${agent.handle} ${after}`);
    setSelIdx(0);
    // 聚焦并把光标移到末尾
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = `${before}${agent.handle} `.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSend = async () => {
    if (!text.trim()) return;
    const t = text;
    setText('');
    setSelIdx(0);
    await sendMessage(t);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法 composition 期间(isComposing 或 keyCode 229)的 Enter 是确认候选词,不发送/不导航
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    // 候选浮层导航(composing 时也不触发)
    if (showPopover && !composing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelIdx((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelIdx((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = candidates[safeSel];
        if (pick) insertMention(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelIdx(0);
        return;
      }
    }
    // 发送:Enter(非 composition)+ 非候选浮层导航时才发送
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="msg-input-wrap">
      <div className="msg-input-inner">
        <input
          ref={inputRef}
          className="msg-input"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSelIdx(0);
          }}
          onKeyDown={onKeyDown}
          disabled={!connected}
        />
        {showPopover && (
          <div className="mention-pop">
            {candidates.map((a, i) => (
              <div
                key={a.agentId}
                className={`mention-item ${i === safeSel ? 'sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(a);
                }}
                onMouseEnter={() => setSelIdx(i)}
              >
                <span className="mention-handle">{a.handle}</span>
                <span className="mention-name">{a.name}</span>
                <span className="mention-role">{a.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="msg-send"
        onClick={handleSend}
        disabled={!connected || !text.trim()}
      >
        ↑
      </button>
    </div>
  );
}
