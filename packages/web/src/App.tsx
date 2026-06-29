// packages/web/src/App.tsx
// fireit —— IM 风格主界面
// Sidebar(群聊/单聊/在场状态) + ChatHeader(标题/模式/连接) + ModeBanner + PhaseGraph + ChatFlow + MessageInput

import { useEffect } from 'react';
import { AgentDetail } from './components/AgentDetail.js';
import { AgentManagePage } from './components/AgentManagePage.js';
import { ChatFlow } from './components/ChatFlow.js';
import { MessageInput } from './components/MessageInput.js';
import { ModeBanner } from './components/ModeBanner.js';
import { PhaseGraph } from './components/PhaseGraph.js';
import { Sidebar } from './components/Sidebar.js';
import { useChatStore } from './stores/chat-store.js';

function modeLabel(mode: string, dmAgentName: string | null): string {
  if (mode === 'dm') return `单聊 · ${dmAgentName ?? ''}`;
  if (mode === 'directed') return '🎯 有向协作';
  return '💡 头脑风暴';
}

export function App() {
  const connect = useChatStore((s) => s.connect);
  const connected = useChatStore((s) => s.connected);
  const task = useChatStore((s) => s.task);
  const team = useChatStore((s) => s.team);
  const mode = useChatStore((s) => s.mode);
  const dmAgentId = useChatStore((s) => s.dmAgentId);
  const threadId = useChatStore((s) => s.threadId);
  const threadList = useChatStore((s) => s.threadList);
  const showManage = useChatStore((s) => s.showManage);

  useEffect(() => {
    void connect();
  }, [connect]);

  // 当前 thread 标题
  const current = threadList.find((t) => t.threadId === threadId);
  const dmAgentName = dmAgentId ? team.find((a) => a.agentId === dmAgentId)?.name ?? null : null;
  const headerTitle = mode === 'dm' ? dmAgentName ?? '单聊' : current?.title ?? '新会话';

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
        <header className="chat-header">
          <span className="chat-header-title">{headerTitle}</span>
          <span className={`chat-header-mode mode-${mode}`}>{modeLabel(mode, dmAgentName)}</span>
          <span className={`conn ${connected ? 'on' : 'off'}`}>
            {connected ? '● 在线' : '○ 连接中'}
          </span>
        </header>

        {mode !== 'dm' && <ModeBanner />}

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
