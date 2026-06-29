// packages/web/src/components/AgentDetail.tsx
// agent 详情面板:身份信息 + 该 agent 的完整事件流(跨会话,观测用)

import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/chat-store.js';

interface AgentEvent {
  threadId: string;
  kind: string;
  at: number;
  summary: string;
  toolCount: number;
  done: boolean;
}

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export function AgentDetail() {
  const detailAgent = useChatStore((s) => s.detailAgent);
  const setDetailAgent = useChatStore((s) => s.setDetailAgent);
  const agentLifecycle = useChatStore((s) => s.agentLifecycle);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [session, setSession] = useState<{
    sessionId: string | null;
    status: string;
    createdAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!detailAgent) {
      setEvents([]);
      setSession(null);
      return;
    }
    setLoading(true);
    fetch(`/api/agents/${detailAgent.agentId}/events`)
      .then((r) => r.json())
      .then((data: { events: AgentEvent[] }) => setEvents(data.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
    fetch(`/api/agents/${detailAgent.agentId}/session`)
      .then((r) => r.json())
      .then((d) =>
        setSession({
          sessionId: d.sessionId ?? null,
          status: d.status ?? '',
          createdAt: d.createdAt ?? 0,
        }),
      )
      .catch(() => setSession(null));
  }, [detailAgent]);

  if (!detailAgent) return null;

  return (
    <div className="agent-detail-overlay" onClick={() => setDetailAgent(null)}>
      <div className="agent-detail" onClick={(e) => e.stopPropagation()}>
        <div className="ad-header">
          <span
            className="msg-avatar"
            style={{
              background: detailAgent.color ?? '#5B5BD6',
              width: 40,
              height: 40,
              fontSize: 16,
            }}
          >
            {detailAgent.name.slice(0, 1)}
          </span>
          <div className="ad-name-block">
            <div className="ad-name">{detailAgent.name}</div>
            <div className="ad-handle">{detailAgent.handle}</div>
          </div>
          <button type="button" className="ad-close" onClick={() => setDetailAgent(null)}>
            ×
          </button>
        </div>

        <div className="ad-section">
          <div className="ad-label">性格</div>
          <div className="ad-value personality">{detailAgent.personality ?? '未设定'}</div>
        </div>
        <div className="ad-section">
          <div className="ad-label">角色 / 专长</div>
          <div className="ad-value">{detailAgent.role}</div>
          <div className="ad-tags">
            {detailAgent.specialties.map((s) => (
              <span key={s} className="ad-tag">
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="ad-section ad-tech">
          <span className="ad-tech-item">引擎: {detailAgent.adapterType}</span>
          <span className="ad-tech-item">模型族: {detailAgent.modelFamily}</span>
        </div>

        {/* 事件流(跨会话观测) */}
        <div className="ad-section ad-events">
          <div className="ad-label">事件流(跨会话,最近 {events.length} 条)</div>
          {loading && <div className="ad-event-empty">加载中…</div>}
          {!loading && events.length === 0 && <div className="ad-event-empty">还没有事件记录</div>}
          {events.map((e, i) => (
            <div key={i} className="ad-event">
              <span className="ad-event-time">{fmtTime(e.at)}</span>
              <span className={`ad-event-kind ${e.kind}`}>
                {e.kind === 'streaming' ? (e.done ? '回复' : '执行中') : e.kind}
              </span>
              {e.toolCount > 0 && <span className="ad-event-tools">{e.toolCount}步</span>}
              <span className="ad-event-summary">{e.summary || '(无内容)'}</span>
            </div>
          ))}
        </div>

        {/* 当前 session(运行时层)+ 生命周期操作 */}
        <div className="ad-section">
          <div className="ad-label">当前 session</div>
          <div className="ad-value">
            {session
              ? `${session.sessionId ? `${session.sessionId.slice(0, 8)}…` : '(待绑定)'} · ${session.status}`
              : '加载中…'}
          </div>
          <div className="ad-lifecycle">
            <button
              type="button"
              className="am-act"
              onClick={() => detailAgent && agentLifecycle(detailAgent.agentId, 'restart')}
            >
              重启
            </button>
            <button
              type="button"
              className="am-act"
              onClick={() => detailAgent && agentLifecycle(detailAgent.agentId, 'reset-session')}
            >
              重置会话
            </button>
            <button
              type="button"
              className="am-act danger"
              onClick={() => detailAgent && agentLifecycle(detailAgent.agentId, 'full-reset')}
            >
              完全重置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
