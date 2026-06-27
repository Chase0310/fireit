# M1 task 引擎实现方案

> 业务核心：task/step 的状态机 + 事件 + 投影。纯逻辑，零 IO，可独立测试。

| 字段 | 值 |
|------|-----|
| 里程碑 | M1 |
| 位置 | `packages/core/src/task/` |
| 前置 | M0a 完成（core 包依赖 shared） |
| 验收 | 穷举测试全绿（5 态 × 6 事件每格确定 + rebuild 零漂移 + 7 条不变量） |

---

## 0. 设计收敛（已拍板）

**状态机 5 态持久 + ready 派生**：

- 5 个持久状态：`pending / running / blocked / completed / skipped`（事件驱动，存投影）
- `ready` 是 projector 派生属性（pending + 依赖全满足），不是持久状态，不进转移表
- `retried` 是事件名（`step.retried`），不是状态；效果是 completed/blocked → running

---

## 1. 要实现什么

```
packages/core/src/task/
├── state-machine.ts        # transition() 纯函数 + STATIC_TABLE 转移表
├── projector.ts            # applyEvent() + rebuild() + deriveReady()
├── events.ts               # buildXxxEvent 纯函数（事件构造器）
├── index.ts                # re-export
└── __tests__/
    ├── state-machine.test.ts   # 穷举测试（INV-T1）
    ├── projector.test.ts       # rebuild 一致性（INV-T2）+ ready 派生
    └── invariants.test.ts      # INV-T3~T7
```

M1 不含 server 接线、不含 SQLite 持久化、不含 WS。纯逻辑。

---

## 2. 关键实现规格

### 2.1 state-machine.ts

```typescript
// 表驱动转移（5 态 × 6 事件）
const STATIC_TABLE: Partial<Record<TaskEventKind, {
  from: Set<StepStatus>;
  to: StepStatus;
}>> = {
  'step.started':   { from: set('pending', 'running'),     to: 'running' },
  'step.completed': { from: set('running'),                 to: 'completed' },
  'step.blocked':   { from: set('running'),                 to: 'blocked' },
  'step.unblocked': { from: set('blocked'),                 to: 'running' },
  'step.retried':   { from: set('completed', 'blocked'),    to: 'running' },
  'step.skipped':   { from: set('pending', 'blocked'),      to: 'skipped' },
};

export function transition(current, event, snapshot): TransitionResult {
  // 1. started：检查依赖（snapshot.allStepStatus 里依赖全 completed/skipped）
  // 2. skipped：检查 approver 必填
  // 3. 查 STATIC_TABLE，from 不含 current → reject invalid_transition
}
```

**复用决策**：照 subsystems.md §2.1 转移表（已修正为 5 态版）。

### 2.2 projector.ts

```typescript
export function applyEvent(proj: TaskProjection, event: TaskEvent): TaskProjection {
  // 1. 对应 step 的 transition() 判断
  // 2. ok → 更新 step.status（持久状态）
  // 3. 重新计算 readySteps（deriveReady）
  // 4. retried → retryCount += 1
  // 零外部副作用
}

export function deriveReady(steps, dependencies): Set<StepId> {
  // pending + 依赖全 ∈ {completed, skipped} → ready
}

export function rebuild(events: TaskEvent[]): TaskProjection {
  // 从空投影 replay 所有事件 → 最终投影（INV-T2 零漂移）
}
```

### 2.3 events.ts（事件构造器）

```typescript
// 每种事件的纯构造函数，生成 eventId（幂等键）+ 填充 payload
export function buildStepStarted(taskId, stepId, agentId, at): TaskEvent;
export function buildStepCompleted(taskId, stepId, agentId, evidence, at): TaskEvent;
export function buildStepBlocked(taskId, stepId, reason, at): TaskEvent;
export function buildStepRetried(taskId, stepId, reason, at): TaskEvent;
export function buildStepSkipped(taskId, stepId, reason, approver, at): TaskEvent;
export function buildTaskAccepted(taskId, at): TaskEvent;
// ...
```

---

## 3. 穷举测试策略（INV-T1）

```typescript
// state-machine.test.ts
// 全 5 状态 × 全 6 事件的 30 格，每格断言：转移 or reject + reason
describe('穷举转移表', () => {
  for (const status of ALL_STEP_STATUSES) {        // 5 态
    for (const eventKind of ALL_STEP_EVENT_KINDS) { // 6 事件
      it(`${status} + ${eventKind}`, () => {
        const result = transition(status, mockEvent(eventKind), snapshot);
        // 断言对照 STATIC_TABLE 的预期
      });
    }
  }
});
```

### 特殊守卫测试（非穷举部分）

| 测试 | 内容 |
|------|------|
| `started 依赖未满足` | 依赖有 pending → reject `dependency_not_satisfied` |
| `skipped 无 approver` | payload.approver 缺失 → reject `unauthorized` |
| `accepted 非 user` | by ≠ 'user' → reject `unauthorized` |
| `retried 加 retryCount` | completed + retried → running, retryCount=1 |
| `ready 派生` | pending + 依赖满足 → ready=true；依赖未满足 → ready=false |

---

## 4. 不变量验证（INV-T2~T7）

| INV | 测试 |
|-----|------|
| T2 rebuild 零漂移 | 随机生成事件序列 → applyEvent 逐条 vs rebuild 整体重放 → 投影逐字段相等 |
| T3 事件不可变 | 事件对象 deep-frozen（Object.freeze）|
| T4 started 前置依赖 | 见特殊守卫测试 |
| T5 accepted 必须 user 且全 closed | 任一 step 非 completed/skipped → reject |
| T6 skipped 必须 approver | 见特殊守卫测试 |
| T7 projector 零副作用 | applyEvent 返回新对象，不改原 proj（不可变）|

---

## 5. M1 验收清单

- [ ] `packages/core` 包创建，依赖 `@fireit/shared`
- [ ] `transition()` 实现，5 态 × 6 事件穷举测试 30 格全绿
- [ ] `applyEvent()` + `rebuild()` 实现，rebuild 零漂移测试通过
- [ ] `deriveReady()` 实现，ready 派生测试通过
- [ ] 事件构造器（buildXxxEvent）实现
- [ ] INV-T2~T7 测试全绿
- [ ] `pnpm test` 无业务逻辑依赖外部 IO（纯函数可独立跑）

---

## 6. M1 不做

- ❌ server 接线（M3 才把 task 引擎接到 REST/WS）
- ❌ SQLite 持久化（M3 才加 EventStore）
- ❌ agent 执行（M2 才有适配器）
- ❌ 介入判断逻辑（M3/M4 才接 review）
- ❌ UI

---

## 7. 依赖

**core**：`@fireit/shared`（类型）、`vitest`（测试）、`typescript`
无运行时依赖（纯逻辑）。

---

*本方案是 M1 task 引擎的实现依据。完成后进 M2（agent 适配器）。*
