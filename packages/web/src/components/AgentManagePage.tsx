// packages/web/src/components/AgentManagePage.tsx
// agent 管理页:卡片列表(INFO + RUNTIME CONFIG + ACTIONS)+ 新建表单(对齐 design §Web)

import { useState } from 'react';
import { useChatStore } from '../stores/chat-store.js';

const ADAPTERS = ['claude-code', 'codex', 'gemini-cli'] as const;
const FAMILIES = ['claude', 'gpt', 'gemini'] as const;
const PALETTE = ['#5B5BD6', '#E07B39', '#16A6A6', '#D6416B', '#3B82F6', '#22C55E'];

export function AgentManagePage() {
  const team = useChatStore((s) => s.team);
  const createAgent = useChatStore((s) => s.createAgent);
  const deleteAgent = useChatStore((s) => s.deleteAgent);
  const agentLifecycle = useChatStore((s) => s.agentLifecycle);
  const setShowManage = useChatStore((s) => s.setShowManage);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    handle: '',
    name: '',
    role: '',
    specialties: '',
    adapterType: 'codex' as (typeof ADAPTERS)[number],
    modelFamily: 'gpt' as (typeof FAMILIES)[number],
    color: PALETTE[0] ?? '#5B5BD6',
    personality: '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.handle.trim() || !form.name.trim()) return;
    await createAgent({
      handle: form.handle.startsWith('@') ? form.handle : `@${form.handle}`,
      name: form.name,
      role: form.role,
      specialties: form.specialties
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      adapterType: form.adapterType,
      modelFamily: form.modelFamily,
      color: form.color,
      personality: form.personality,
    });
    setCreating(false);
    setForm({
      handle: '',
      name: '',
      role: '',
      specialties: '',
      adapterType: 'codex',
      modelFamily: 'gpt',
      color: PALETTE[0] ?? '#5B5BD6',
      personality: '',
    });
  }

  return (
    <div className="agent-manage">
      <div className="am-header">
        <span className="am-title">Agents</span>
        <div className="am-actions">
          <button type="button" className="am-btn primary" onClick={() => setCreating((v) => !v)}>
            {creating ? '取消' : '+ 新建'}
          </button>
          <button type="button" className="am-btn" onClick={() => setShowManage(false)}>
            返回
          </button>
        </div>
      </div>

      {creating && (
        <div className="am-form">
          <div className="am-form-row">
            <input
              className="am-input"
              placeholder="@handle"
              value={form.handle}
              onChange={(e) => set('handle', e.target.value)}
            />
            <input
              className="am-input"
              placeholder="名字"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            <input
              className="am-input"
              placeholder="角色(如 后端实现)"
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
            />
          </div>
          <div className="am-form-row">
            <input
              className="am-input"
              placeholder="专长(逗号分隔)"
              value={form.specialties}
              onChange={(e) => set('specialties', e.target.value)}
            />
            <select
              className="am-select"
              value={form.adapterType}
              onChange={(e) => set('adapterType', e.target.value as (typeof ADAPTERS)[number])}
            >
              {ADAPTERS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="am-select"
              value={form.modelFamily}
              onChange={(e) => set('modelFamily', e.target.value as (typeof FAMILIES)[number])}
            >
              {FAMILIES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="am-form-row">
            <input
              className="am-input"
              placeholder="性格描述"
              value={form.personality}
              onChange={(e) => set('personality', e.target.value)}
            />
            <div className="am-swatches">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`am-swatch ${form.color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                />
              ))}
            </div>
          </div>
          <button type="button" className="am-btn primary" onClick={submit}>
            创建
          </button>
        </div>
      )}

      <div className="am-list">
        {team.map((a) => (
          <div
            key={a.agentId}
            className="am-card"
            style={{ borderLeftColor: a.color ?? '#5B5BD6' }}
          >
            <div className="am-card-head">
              <span className="msg-avatar" style={{ background: a.color ?? '#5B5BD6' }}>
                {a.name.slice(0, 1)}
              </span>
              <div className="am-card-title">
                <span className="am-card-name">{a.name}</span>
                <span className="am-card-handle">{a.handle}</span>
                <span className={`am-card-status st-${a.status ?? 'idle'}`}>
                  {a.status ?? 'idle'}
                </span>
              </div>
            </div>
            <div className="am-card-body">
              <div className="am-card-meta">
                <span className="am-meta-label">INFO</span>
                <span>
                  引擎 {a.adapterType} · 模型 {a.modelFamily} · {a.roles.join('/')}
                </span>
                <span className="am-created">
                  {a.createdBy ?? 'system'} ·{' '}
                  {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="am-card-meta">
                <span className="am-meta-label">性格</span>
                <span>
                  {a.personality ?? '未设定'} · {a.role}
                </span>
              </div>
            </div>
            <div className="am-card-actions">
              <button
                type="button"
                className="am-act"
                onClick={() => agentLifecycle(a.agentId, 'restart')}
                title="保留 session,下次自然 resume"
              >
                重启
              </button>
              <button
                type="button"
                className="am-act"
                onClick={() => agentLifecycle(a.agentId, 'reset-session')}
                title="清 session 留文件"
              >
                重置会话
              </button>
              <button
                type="button"
                className="am-act danger"
                onClick={() => agentLifecycle(a.agentId, 'full-reset')}
                title="清 session + 清文件"
              >
                完全重置
              </button>
              <button
                type="button"
                className="am-act danger"
                onClick={() => {
                  if (confirm(`删除 ${a.name}?`)) deleteAgent(a.agentId);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
