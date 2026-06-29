// packages/web/src/App.tsx
// fireit —— chat 驱动范式主界面
// Sidebar(会话管理) + 顶栏(agent 在场) + ModeBanner + PhaseGraph + ChatFlow + MessageInput

import { useEffect } from 'react';
import { AgentDetail } from './components/AgentDetail.js';
import { AgentManagePage } from './components/AgentManagePage.js';
import { ChatFlow } from './components/ChatFlow.js';
import { MessageInput } from './components/MessageInput.js';
import { ModeBanner } from './components/ModeBanner.js';
import { PhaseGraph } from './components/PhaseGraph.js';
import { Sidebar } from './components/Sidebar.js';
import { useChatStore } from './stores/chat-store.js';

export function App() {
  const connect = useChatStore((s) => s.connect);
  const connected = useChatStore((s) => s.connected);
  const task = useChatStore((s) => s.task);
  const team = useChatStore((s) => s.team);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const setDetailAgent = useChatStore((s) => s.setDetailAgent);
  const showManage = useChatStore((s) => s.showManage);
  const setShowManage = useChatStore((s) => s.setShowManage);

  useEffect(() => {
    void connect();
  }, [connect]);

  if (showManage) {
    return (
      <div className="app">
        <Sidebar />
        <div className="app-main">
          <AgentManagePage />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-brand">🔥 fireit</div>
          <div className="topbar-team">
            {team.map((a) => {
              const st = agentStatus[a.agentId]?.status ?? 'idle';
              const detail = agentStatus[a.agentId]?.detail;
              return (
                <span
                  key={a.agentId}
                  className={`team-chip st-${st} clickable`}
                  title={`${a.name} · ${a.role} · ${a.adapterType}${detail ? ` · ${detail}` : ''} · 点击查看详情`}
                  onClick={() => setDetailAgent(a)}
                >
                  <span className="team-dot" style={{ background: a.color ?? undefined }} />
                  {a.handle}
                  {st !== 'idle' && (
                    <span className="team-status">{st === 'thinking' ? '思考' : '执行'}</span>
                  )}
                </span>
              );
            })}
            <button
              type="button"
              className="topbar-manage-btn"
              onClick={() => setShowManage(true)}
              title="管理 agent"
            >
              ⚙ Agents
            </button>
          </div>
          <span className={`conn ${connected ? 'on' : 'off'}`}>
            {connected ? '● 在线' : '○ 连接中'}
          </span>
        </header>

        <ModeBanner />

        {task && <PhaseGraph task={task} />}

        <main className="main">
          <ChatFlow />
          <MessageInput />
        </main>
      </div>
      <AgentDetail />
    </div>
  );
}
