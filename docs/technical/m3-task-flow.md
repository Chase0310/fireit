# M3 task 流程实现方案

> 把 M1（task 引擎）+ M2（agent 适配器）+ M0（骨架）接线，让 task 从创建到验收端到端跑通。

| 字段 | 值 |
|------|-----|
| 里程碑 | M3 |
| 位置 | `packages/server/src/`（接线层） |
| 前置 | M0a + M1 + M2 完成 |
| 验收 | PRD 场景一端到端跑通（task→step→review→retry→accepted） |

---

## 0. 关键决策（已拍板）

**事件存储：事件 + 物化投影双写**
- 事件 append 到 SQLite `task_events` 表（真相源，可 rebuild）
- 投影存 `tasks`/`steps` 表，每次事件追加后同步更新投影行（查询快）
- rebuild 能力保留（从 task_events 重放可重建投影，用于校验/修复）

---

## 1. M3 要接线什么

M3 是**接线层**，本身不多写新业务逻辑（逻辑在 M1/M2），而是把三者串起来：

```
user 请求 ──▶ server 路由 ──▶ EventStore（append 事件 + 更新投影）
                                  │
                                  ▼
                            task 引擎（M1: transition/projector）
                                  │
                                  ▼
                            AgentRunner（M2: spawn CLI + 流式）
                                  │
                                  ▼
                            RealtimeBroadcaster（M0: WS 推送）
```

### 要新增/实现的模块

```
packages/server/src/
├── db/
│   ├── schema.ts              # Drizzle 表定义（tasks/steps/task_events/agents）
│   ├── migrate.ts             # 迁移
│   └── index.ts               # better-sqlite3 连接
├── stores/
│   ├── event-store.ts         # ★ append 事件 + 双写投影
│   └── projection-store.ts    # 读投影（tasks/steps）
├── routes/
│   ├── tasks.ts               # ★ task REST 路由
│   └── steps.ts               # step 操作路由
├── services/
│   └── task-service.ts        # ★ 编排：路由 → 事件 → 引擎 → 适配器 → 推送
└── realtime.ts                # M0 已有，扩展为 WorkspaceEvent
```

---

## 2. 事件存储双写（核心）

```typescript
// stores/event-store.ts
class TaskEventStore {
  // 双写：append 事件 + 更新投影
  async append(event: TaskEvent): Promise<void> {
    // 1. INSERT INTO task_events（append-only，幂等 by eventId）
    // 2. 读该 step 当前投影状态
    // 3. 调 M1 的 transition(current, event, snapshot)
    // 4. ok → UPDATE steps.status（投影同步）
    // 5. ok → 重算 readySteps（deriveReady）
    // 6. reject → 不写投影，返回错误（事件仍记录用于审计）
  }

  // rebuild：从事件重放重建投影（校验/修复用）
  async rebuild(taskId: TaskId): Promise<void>;

  // 读事件流
  async getEvents(taskId: TaskId): Promise<TaskEvent[]>;
}

// stores/projection-store.ts
class ProjectionStore {
  async getTask(taskId: TaskId): Promise<TaskProjection>;  // 读投影表 + 派生 ready
  async listTasks(): Promise<TaskProjection[]>;
}
```

**双写不变量**：`task_events` 是真相源；`tasks`/`steps` 是派生投影。任何时候 `rebuild(taskId)` 的结果必须与投影表一致（INV-T2）。

---

## 3. task-service 编排（端到端流程）

```typescript
// services/task-service.ts
class TaskService {
  // 创建 task（含 plan）
  async createTask(input: { title; vision; plan: StepSpec[]; leadAgentId }): Promise<Task> {
    // 1. INSERT tasks（status=pending）
    // 2. INSERT steps（全 pending，dependencies 来自 StepSpec）
    // 3. append task.created 事件
    // 4. broadcast task.created（WS）
  }

  // 审批 plan
  async approvePlan(taskId: TaskId): Promise<void> {
    // 1. append task.planApproved 事件
    // 2. 派生 readySteps（无依赖的 step → ready）
    // 3. broadcast step.stateChanged
  }

  // 开始一个 step（拉起 agent）
  async startStep(taskId: TaskId, stepId: StepId, agentId: AgentId): Promise<void> {
    // 1. append step.started（transition 校验依赖）
    // 2. 构造 AgentInvokeInput（identity + context + task）
    // 3. AgentRunner.run() → 流式 broadcast agent.streaming
    // 4. agent done → append step.completed（带 evidence）
  }

  // retry 一个 step
  async retryStep(taskId: TaskId, stepId: StepId, reason: string): Promise<void> {
    // 1. append step.retried（transition: completed/blocked → running）
    // 2. retryCount += 1
    // 3. 重新拉起 agent
  }

  // 最终验收
  async acceptTask(taskId: TaskId): Promise<void> {
    // 1. 校验所有 step ∈ {completed, skipped}
    // 2. append task.accepted（by: 'user'，非 user → reject unauthorized）
    // 3. UPDATE tasks.status = accepted
  }
}
```

---

## 4. REST 路由（对齐 subsystems.md §6.1）

```typescript
// routes/tasks.ts
POST   /tasks                       // createTask
GET    /tasks/:id                   // getTask（投影）
POST   /tasks/:id/approve-plan
POST   /tasks/:id/accept            // 最终验收（必须 user）

// routes/steps.ts
POST   /tasks/:id/steps/:sid/start
POST   /tasks/:id/steps/:sid/complete
POST   /tasks/:id/steps/:sid/block
POST   /tasks/:id/steps/:sid/retry
POST   /tasks/:id/steps/:sid/skip   // 需 approver
```

每个路由 → `TaskService` 对应方法 → EventStore 双写 → broadcast。

---

## 5. SQLite Schema（Drizzle）

```typescript
// db/schema.ts（对齐 subsystems.md §6.2）
tasks        (id, title, vision, status, lead_agent_id, created_at, accepted_at)
steps        (id, task_id, title, instruction, acceptance, assigned_agent_id,
              dependencies_json, status, retry_count, order_idx)
agents       (id, handle, name, role, specialties_json, restrictions_json,
              adapter_type, model_family, roles_json, available)
task_events  (id, task_id, kind, classification, payload_json, at)  -- append-only
runs         (id, task_id, step_id, agent_id, status, log_path, token_usage, at)
```

better-sqlite3 数据库文件：`.fireit/fireit.db`（gitignored）。

---

## 6. M3 验收清单（PRD 场景一端到端）

- [ ] SQLite + Drizzle 接好，迁移能跑
- [ ] `POST /tasks` 创建 task + steps（全 pending）
- [ ] `POST /tasks/:id/approve-plan` → readySteps 派生正确
- [ ] `POST /steps/:sid/start` → 拉起真实 agent（M2 适配器）+ 流式 WS 推送
- [ ] agent 完成 → step.completed，下一依赖 step 变 ready
- [ ] `POST /steps/:sid/retry` → 只重置该 step，其他不动
- [ ] `POST /tasks/:id/accept` → 最终验收（非 user 调用被拒）
- [ ] rebuild(taskId) 结果与投影表一致（INV-T2）
- [ ] WS 实时推送 task/step 状态变化

---

## 7. M3 不做

- ❌ 互审 + 介入判断（M4 才接 review）
- ❌ A2A @mention 路由（M4）
- ❌ free chat 模式
- ❌ UI（M5）
- ❌ 在场感知（V1.5）

> M3 验收时，"开始 step"由手动指定 agent（POST 带 agentId），不经过 @mention 路由。互审/介入留 M4。

---

## 8. 依赖

**server** 新增：`drizzle-orm`、`better-sqlite3`、`@fireit/core`（task 引擎）、`@fireit/agents`（适配器）

---

*本方案是 M3 task 流程的实现依据。完成后进 M4（A2A 协作 + 互审 + 介入）。*
