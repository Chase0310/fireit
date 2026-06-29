// packages/web/src/components/Sidebar.tsx
// IM 风格侧栏:群聊 / 单聊 / 在场状态 三段式(对齐 design IM 布局)
//   群聊:brainstorm/directed 的 thread
//   单聊:dm thread + 点 agent 建/切 DM
//   在场状态:所有 agent 实时状态(头像 + 名 + 空闲/思考/执行)

import type { Agent } from '@fireit/shared';
import { useChatStore } from '../stores/chat-store.js';

function statusLabel(st: 'idle' | 'thinking' | 'executing'): string {
  if (st === 'thinking') return '思考';
  if (st === 'executing') return '执行';
  return '空闲';
}

export function Sidebar() {
  const threadList = useChatStore((s) => s.threadList);
  const threadId = useChatStore((s) => s.threadId);
  const newThread = useChatStore((s) => s.newThread);
  const selectThread = useChatStore((s) => s.selectThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const newDmThread = useChatStore((s) => s.newDmThread);
  const team = useChatStore((s) => s.team);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const setShowManage = useChatStore((s) => s.setShowManage);
  const setDetailAgent = useChatStore((s) => s.setDetailAgent);

  const groupThreads = threadList.filter((t) => t.mode !== 'dm');
  const dmThreads = threadList.filter((t) => t.mode === 'dm');

  // team 里没建过 DM 的 agent(用于单聊区列出可发起 DM 的)
  const dmAgentIds = new Set(dmThreads.map((t) => t.dmAgentId));
  const agentsWithoutDm = team.filter((a) => !dmAgentIds.has(a.agentId));

  function renderThreadItem(t: { threadId: string; mode: string; title: string | null; messageCount: number }) {
    return (
      <div
        key={t.threadId}
        className={`sidebar-item ${t.threadId === threadId ? 'active' : ''}`}
        onClick={() => void selectThread(t.threadId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void selectThread(t.threadId);
        }}
        role="button"
        tabIndex={0}
      >
        <span className={`sidebar-mode ${t.mode}`}>{t.mode === 'brainstorm' ? '💡' : t.mode === 'directed' ? '🎯' : '💬'}</span>
        <div className="sidebar-item-body">
          <div className="sidebar-item-title">{t.title ?? '新会话'}</div>
          <div className="sidebar-item-meta">{t.messageCount} 条</div>
        </div>
        <button
          type="button"
          className="sidebar-del"
          title="删除"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('删除这个会话?')) void deleteThread(t.threadId);
          }}
        >
          ×
        </button>
      </div>
    );
  }

  function renderDmItem(agent: Agent | undefined, tid: string) {
    if (!agent) return null;
    const st = agentStatus[agent.agentId]?.status ?? 'idle';
    return (
      <div
        key={tid}
        className={`sidebar-item dm ${tid === threadId ? 'active' : ''}`}
        onClick={() => void selectThread(tid)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void selectThread(tid);
        }}
        role="button"
        tabIndex={0}
      >
        <span className={`msg-avatar dm-avatar st-${st}`} style={{ background: agent.color ?? '#5B5BD6' }}>
          {agent.name.slice(0, 1)}
        </span>
        <div className="sidebar-item-body">
          <div className="sidebar-item-title">{agent.name}</div>
          <div className="sidebar-item-meta">{agent.handle}</div>
        </div>
        <button
          type="button"
          className="sidebar-del"
          title="删除"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`删除和 ${agent.name} 的单聊?`)) void deleteThread(tid);
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <button type="button" className="sidebar-new" onClick={() => void newThread()}>
        + 群聊
      </button>

      {/* 群聊区 */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">群聊</div>
        <div className="sidebar-list">
          {groupThreads.length === 0 && <div className="sidebar-empty">暂无群聊</div>}
          {groupThreads.map((t) => renderThreadItem(t))}
        </div>
      </div>

      {/* 单聊区 */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">单聊</div>
        <div className="sidebar-list">
          {dmThreads.length === 0 && agentsWithoutDm.length === 0 && (
            <div className="sidebar-empty">无 agent</div>
          )}
          {dmThreads.map((t) => {
            const agent = team.find((a) => a.agentId === t.dmAgentId);
            return renderDmItem(agent, t.threadId);
          })}
          {agentsWithoutDm.map((a) => (
            <div
              key={a.agentId}
              className="sidebar-item dm-new"
              onClick={() => void newDmThread(a.agentId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void newDmThread(a.agentId);
              }}
              role="button"
              tabIndex={0}
              title={`和 ${a.name} 单聊`}
            >
              <span className="msg-avatar dm-avatar" style={{ background: a.color ?? '#5B5BD6' }}>
                {a.name.slice(0, 1)}
              </span>
              <div className="sidebar-item-body">
                <div className="sidebar-item-title">{a.name}</div>
                <div className="sidebar-item-meta">{a.handle}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 在场状态区(固定底部) */}
      <div className="sidebar-presence">
        <div className="sidebar-section-label">在场</div>
        <div className="presence-list">
          {team.map((a) => {
            const st = agentStatus[a.agentId]?.status ?? 'idle';
            const detail = agentStatus[a.agentId]?.detail;
            return (
              <div
                key={a.agentId}
                className={`presence-item st-${st}`}
                title={`${a.name} · ${statusLabel(st)}${detail ? ` · ${detail}` : ''}`}
                onClick={() => setDetailAgent(a)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setDetailAgent(a);
                }}
                role="button"
                tabIndex={0}
              >
                <span className={`presence-dot st-${st}`} style={{ borderColor: a.color ?? '#5B5BD6' }} />
                <span className="presence-name">{a.name}</span>
                <span className={`presence-status st-${st}`}>{statusLabel(st)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <button type="button" className="sidebar-manage" onClick={() => setShowManage(true)}>
        ⚙ Agents
      </button>
    </aside>
  );
}
