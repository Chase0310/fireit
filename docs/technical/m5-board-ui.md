# M5 board UI 实现方案

> 把后端能力呈现给 user。两个支柱在 UI 上的最终落地点。

| 字段 | 值 |
|------|-----|
| 里程碑 | M5 |
| 位置 | `packages/web/src/` |
| 前置 | M3 + M4 完成（task 流程 + 互审 + 介入已通） |
| 验收 | V1 可用——PRD 场景一全流程通过 UI 完成 |

---

## 0. M5 要实现什么

```
packages/web/src/
├── components/
│   ├── Board/                # ★ 共享工作空间视图（支柱一载体）
│   ├── TaskView/             # 单 task 的 plan + step 列表
│   ├── PlanEditor/           # plan 审批/编辑（执行前调整）
│   ├── ReviewCard/           # 互审结果展示
│   ├── InterventionCard/     # ★ 介入卡（支柱二载体，带完整上下文）
│   ├── FreeChat/             # free chat 模式
│   └── AgentProfile/         # agent 身份展示
├── stores/
│   └── board-store.ts        # Zustand：订阅 WS + 派生视图
├── hooks/
│   ├── useWorkspace.ts       # WS 连接（M0 已有，扩展）
│   └── useStreaming.ts       # agent 流式输出订阅
└── App.tsx
```

---

## 1. 核心组件规格（对齐 subsystems.md §7）

### 1.1 Board（支柱一：共享工作空间）

```typescript
// 所有 task/step 的共享看板
<Board>
  // 数据来源：board-store.tasks（从 WS 订阅的 TaskProjection[]）
  // 渲染：
  //   - task 卡片列表（状态色：pending 灰/in_progress 蓝/accepted 绿）
  //   - 每个 task 展开看 step 进度条
  //   - blocked step 红色标记 + reason
  //   - ready step 高亮（可点击开始）
</Board>
```

**支柱一落地**：board 是共享状态面，user 和所有 agent 看到的是同一份实时状态——不用互相问"那道菜到哪了"。

### 1.2 InterventionCard（支柱二：必要时刻介入）

```typescript
// 介入卡——必须带完整上下文（VISION §3 约束）
<InterventionCard
  stepId={step.stepId}
  title={step.title}              // 哪个 step
  diff={run.diff}                 // 改了什么
  reviewFindings={review.findings} // 互审分歧点
  trigger={decision.trigger}      // 为什么叫你（分歧/危险）
  basis={decision.basis}          // 决策依据
  actions={['approve', 'reject', 'retry']}
  onResolve={(verdict) => resolveIntervention(stepId, verdict)}
/>
```

**支柱二落地**：叫 user 时带完整上下文（diff + 分歧点 + 为什么叫你），user 只在必要时介入，approve/reject/retry 三选一。

### 1.3 PlanEditor（执行前审批）

```typescript
// user 在执行前调整 plan
<PlanEditor
  plan={task.steps}
  onChange={(steps) => updatePlan(steps)}  // 改顺序/改派 agent
  onApprove={() => approvePlan(taskId)}
/>
```

### 1.4 FreeChat

```typescript
// 轻量 @ 协作（不走 task 流程）
<FreeChat
  onSend={(text) => sendMessage(threadId, text)}  // 含 @mention
  messages={thread.messages}
  streaming={streamingChunks}  // agent 流式输出
/>
```

---

## 2. 状态 store（对齐 subsystems.md §7.2）

```typescript
// stores/board-store.ts
interface BoardStore {
  tasks: TaskProjection[];
  streamingChunks: Record<AgentId, AgentOutputChunk[]>;
  pendingInterventions: InterventionDecision[];

  // actions（调 server REST）
  createTask(input): Promise<void>;
  approvePlan(taskId): Promise<void>;
  startStep(taskId, stepId, agentId): Promise<void>;
  retryStep(taskId, stepId): Promise<void>;
  resolveIntervention(stepId, verdict): Promise<void>;
  acceptTask(taskId): Promise<void>;
}

// WS 订阅 → 更新 store
//   task.created / step.stateChanged → 更新 tasks
//   agent.streaming → 追加 streamingChunks
//   intervention.needed → 追加 pendingInterventions
```

---

## 3. 数据流（UI 视角）

```
user 点"开始 step"
  → board-store.startStep()
  → POST /tasks/:id/steps/:sid/start
  → server 拉起 agent + 流式 WS 推送
  → WS event: agent.streaming
  → store 追加 streamingChunks
  → FreeChat/TaskView 渲染流式输出
  → agent 完成
  → WS event: step.stateChanged（completed 或 intervention.needed）
  → 若 intervention.needed → 弹 InterventionCard
  → user 处理 → resolveIntervention()
```

---

## 4. M5 验收清单（V1 可用）

- [ ] Board 展示所有 task/step 实时状态（从 WS 订阅）
- [ ] 创建 task → PlanEditor 审批 → approve-plan
- [ ] start step → agent 流式输出实时渲染
- [ ] step 状态变化实时反映在 board
- [ ] retry step → 只该 step 重置
- [ ] InterventionCard 弹出（互审分歧/危险）→ user approve/reject/retry
- [ ] 最终验收 → acceptTask（必须 user 操作）
- [ ] FreeChat：@mention 发消息 + agent 回复
- [ ] **P0 验收**：完成场景一时，user 不需复制粘贴上下文（支柱一）
- [ ] **P0 验收**：user 不需持续监控（支柱二）

---

## 5. M5 不做

- ❌ 在场感知 UI（V1.5）
- ❌ 性格养成 UI（V1.5）
- ❌ 执行轨迹回放（V2）
- ❌ 多人协作（V2）

---

## 6. 依赖

**web** 新增：zustand、tailwindcss v4、@fireit/shared（类型）
已有：react、react-dom、vite

---

## 7. V1 完成标志

M5 完成 = V1 可用。对照 PRD §9 成功指标：

| 指标 | M5 验收点 |
|------|----------|
| P0-1 零传话 | board 共享状态 + agent 从工作空间取上下文 |
| P0-2 必要时刻介入 | InterventionCard 四类触发 |
| 核心场景跑通 | 场景一端到端 |
| step 级 retry | retryStep 只重置该 step |
| 介入机制 | 四类触发 + 决策依据保留 |
| 跨模型互审 | M4 已实现，UI 展示互审结果 |

---

*本方案是 M5 board UI 的实现依据。M5 完成 = V1 可用。*
