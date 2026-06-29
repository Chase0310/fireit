// packages/web/src/stores/chat-store.ts
// 新 store —— chat 驱动范式。消息流是一等公民,WS 事件驱动消息追加。

import type {
  Agent,
  StepSpec,
  TaskId,
  TaskProjection,
  ThreadId,
  ThreadMessage,
  ThreadMode,
} from '@fireit/shared';
import { create } from 'zustand';

const API_BASE = '/api';

export interface ThreadListItem {
  threadId: ThreadId;
  mode: ThreadMode;
  dmAgentId: string | null; // DM 模式绑定的 agent;非 DM 为 null
  title: string | null;
  messageCount: number;
  updatedAt: number;
}

export interface ChatState {
  threadId: ThreadId | null;
  threadList: ThreadListItem[];
  mode: ThreadMode;
  dmAgentId: string | null; // 当前 thread 若是 DM,绑定的 agent
  messages: ThreadMessage[];
  task: TaskProjection | null;
  connected: boolean;
  team: Agent[];
  agentStatus: Record<string, { status: 'idle' | 'thinking' | 'executing'; detail?: string }>;
  detailAgent: Agent | null;
  agentSession: { sessionId: string | null; status: string; createdAt: number } | null;
  showManage: boolean;
  manageEditId: string | null;
  _ws: WebSocket | null;

  connect(): Promise<void>;
  setConnected(v: boolean): void;
  setMode(m: ThreadMode): void;
  setDetailAgent(a: Agent | null): void;
  ingestEvent(event: { type: string; [k: string]: unknown }): void;

  refreshThreadList(): Promise<void>;
  newThread(): Promise<void>;
  newDmThread(agentId: string): Promise<void>; // 建或切换到某 agent 的 DM
  selectThread(tid: ThreadId): Promise<void>;
  deleteThread(tid: ThreadId): Promise<void>;

  sendMessage(text: string): Promise<void>;
  transitionToDirected(input: {
    title: string;
    vision: string;
    leadAgentId: string;
    plan: StepSpec[];
  }): Promise<void>;
  resolveIntervention(
    messageId: string,
    verdict: 'approve' | 'reject' | 'retry',
    instruction?: string,
  ): Promise<void>;

  refreshTeam(): Promise<void>;
  createAgent(input: {
    handle: string;
    name: string;
    role?: string;
    specialties?: string[];
    adapterType: 'claude-code' | 'codex' | 'gemini-cli';
    modelFamily?: 'claude' | 'gpt' | 'gemini';
    color?: string;
    personality?: string;
    effort?: 'minimal' | 'low' | 'medium' | 'high';
  }): Promise<void>;
  editAgent(agentId: string, patch: Record<string, unknown>): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  agentLifecycle(agentId: string, op: 'restart' | 'reset-session' | 'full-reset'): Promise<void>;
  setShowManage(v: boolean): void;
  setManageEditId(id: string | null): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  threadId: null,
  threadList: [],
  mode: 'brainstorm',
  dmAgentId: null,
  messages: [],
  task: null,
  connected: false,
  team: [],
  agentStatus: {},
  detailAgent: null,
  agentSession: null,
  showManage: false,
  manageEditId: null,
  _ws: null,

  async connect() {
    if (get()._ws) return;

    // 拉 team 列表(@ 候选 + 顶栏用)
    try {
      const team = (await fetch(`${API_BASE}/agents`).then((x) => x.json())) as Agent[];
      set({ team });
    } catch {
      /* 拉不到就用空,不阻塞 */
    }

    // 拉会话列表;若空则建一个新会话
    await get().refreshThreadList();
    let tid = get().threadId;
    if (!tid) {
      const list = get().threadList;
      if (list.length > 0) {
        tid = list[0]!.threadId;
        await get().selectThread(tid);
      } else {
        await get().newThread();
        tid = get().threadId;
      }
    }

    const ws = new WebSocket('ws://localhost:3140/ws');
    ws.onopen = () => get().setConnected(true);
    ws.onclose = () => get().setConnected(false);
    ws.onerror = () => get().setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        get().ingestEvent(evt);
      } catch {
        /* ignore */
      }
    };
    set({ _ws: ws });
  },

  setConnected(v) {
    set({ connected: v });
  },

  setMode(m) {
    set({ mode: m });
  },

  setDetailAgent(a) {
    set({ detailAgent: a });
  },

  async refreshThreadList() {
    try {
      const list = (await fetch(`${API_BASE}/threads`).then((x) => x.json())) as ThreadListItem[];
      set({ threadList: list });
    } catch {
      /* ignore */
    }
  },

  async newThread() {
    const r = (await fetch(`${API_BASE}/threads`, { method: 'POST' }).then((x) => x.json())) as {
      threadId: ThreadId;
    };
    set({ threadId: r.threadId, messages: [], mode: 'brainstorm', dmAgentId: null, task: null, agentStatus: {} });
    await get().refreshThreadList();
  },

  // 建或切换到某 agent 的 DM。若已有该 agent 的 DM thread → 切过去;否则新建。
  async newDmThread(agentId: string) {
    const existing = get().threadList.find((t) => t.mode === 'dm' && t.dmAgentId === agentId);
    if (existing) {
      await get().selectThread(existing.threadId);
      return;
    }
    const r = (await fetch(`${API_BASE}/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dmAgentId: agentId }),
    }).then((x) => x.json())) as { threadId: ThreadId };
    set({ threadId: r.threadId, messages: [], mode: 'dm', dmAgentId: agentId, task: null, agentStatus: {} });
    await get().refreshThreadList();
  },

  async selectThread(tid: ThreadId) {
    set({ threadId: tid, messages: [], agentStatus: {} });
    const data = (await fetch(`${API_BASE}/threads/${tid}/messages`).then((x) => x.json())) as {
      mode: ThreadMode;
      taskId: TaskId | null;
      dmAgentId: string | null;
      messages: ThreadMessage[];
    };
    set({ mode: data.mode, dmAgentId: data.dmAgentId ?? null, messages: data.messages });
    if (data.taskId) {
      const proj = (await fetch(`${API_BASE}/tasks/${data.taskId}`).then((x) =>
        x.json(),
      )) as TaskProjection;
      set({ task: proj });
    } else {
      set({ task: null });
    }
  },

  async deleteThread(tid: ThreadId) {
    await fetch(`${API_BASE}/threads/${tid}`, { method: 'DELETE' });
    await get().refreshThreadList();
    // 删的是当前会话 → 切到第一个或新建
    if (get().threadId === tid) {
      const list = get().threadList;
      if (list.length > 0) {
        await get().selectThread(list[0]!.threadId);
      } else {
        await get().newThread();
      }
    }
  },

  ingestEvent(event) {
    switch (event.type) {
      case 'message.appended': {
        const msg = event.message as ThreadMessage;
        if (msg.threadId !== get().threadId) break;
        set((s) => ({ messages: upsertMessage(s.messages, msg) }));
        break;
      }
      case 'message.updated': {
        const msg = event.message as ThreadMessage;
        if (msg.threadId !== get().threadId) break;
        set((s) => ({ messages: upsertMessage(s.messages, msg) }));
        break;
      }
      case 'task.created':
        set({ task: event.task as TaskProjection });
        break;
      case 'step.stateChanged': {
        const step = event.step as TaskProjection['steps'][number];
        set((s) => {
          if (!s.task) return {};
          return {
            task: {
              ...s.task,
              steps: s.task.steps.map((x) => (x.stepId === step.stepId ? step : x)),
            },
          };
        });
        break;
      }
      case 'intervention.needed': {
        // 介入决策已在 ChatService 端转成 intervention 消息推送;此处兜底
        break;
      }
      case 'agent.statusChanged': {
        const agentId = event.agentId as string;
        const status = event.status as 'idle' | 'thinking' | 'executing';
        const detail = event.detail as string | undefined;
        set((s) => ({ agentStatus: { ...s.agentStatus, [agentId]: { status, detail } } }));
        break;
      }
      default:
        break;
    }
  },

  async sendMessage(text) {
    const tid = get().threadId;
    if (!tid) return;
    await fetch(`${API_BASE}/threads/${tid}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    // 刷新列表(标题/消息数更新)
    void get().refreshThreadList();
  },

  async transitionToDirected(input) {
    const tid = get().threadId;
    if (!tid) return;
    const res = await fetch(`${API_BASE}/threads/${tid}/direct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      set({ mode: 'directed' });
      // 拉 task 投影
      const data = (await res.json()) as { taskId: TaskId };
      const proj = (await fetch(`${API_BASE}/tasks/${data.taskId}`).then((r) =>
        r.json(),
      )) as TaskProjection;
      set({ task: proj });
    }
  },

  async resolveIntervention(messageId, verdict, instruction) {
    // approve: 直接放行; reject/retry: 发一条改指令的 chat 消息
    if (verdict === 'approve') {
      await get().sendMessage('approve');
    } else {
      const text = instruction?.trim() ? `重做:${instruction}` : '打回重做';
      await get().sendMessage(text);
    }
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.kind === 'intervention' ? { ...m, resolved: true } : m,
      ),
    }));
  },

  setShowManage(v) {
    set({ showManage: v });
  },
  setManageEditId(id) {
    set({ manageEditId: id });
  },

  async refreshTeam() {
    try {
      const team = (await fetch(`${API_BASE}/agents`).then((x) => x.json())) as Agent[];
      set({ team });
    } catch {
      /* ignore */
    }
  },

  async createAgent(input) {
    await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    await get().refreshTeam();
  },

  async editAgent(agentId, patch) {
    await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await get().refreshTeam();
  },

  async deleteAgent(agentId) {
    await fetch(`${API_BASE}/agents/${agentId}`, { method: 'DELETE' });
    await get().refreshTeam();
  },

  async agentLifecycle(agentId, op) {
    await fetch(`${API_BASE}/agents/${agentId}/${op}`, { method: 'POST' });
    await get().refreshTeam();
  },
}));

function upsertMessage(msgs: ThreadMessage[], msg: ThreadMessage): ThreadMessage[] {
  const idx = msgs.findIndex((m) => m.id === msg.id);
  if (idx === -1) return [...msgs, msg];
  const copy = [...msgs];
  copy[idx] = msg;
  return copy;
}

void (null as unknown as TaskId);
