# M4 A2A 协作实现方案

> agent 间 @mention 路由 + 跨模型互审 + 介入判断。对应 VISION 支柱二（必要时刻介入）。

| 字段 | 值 |
|------|-----|
| 里程碑 | M4 |
| 位置 | `packages/core/src/a2a/` + `packages/core/src/review/` |
| 前置 | M3 完成（task 流程已通） |
| 验收 | 两个 agent 能互审；介入机制四类触发正确 |

---

## 0. M4 要实现什么

两个子系统：

**① A2A 路由**（`core/a2a/`）：agent 间靠 @mention 协调
**② review + 介入**（`core/review/`）：互审 + 判断是否叫人

```
M3 里 start step 是手动指定 agent
M4 里：step 完成后自动触发互审 → 介入判断 → 决定是否叫 user
```

---

## 1. A2A 路由（六层流水线）

位置：`packages/core/src/a2a/`

### 1.1 实现

```
packages/core/src/a2a/
├── mention-parser.ts     # 第1层：行首 @ 解析
├── target-resolver.ts    # 第2层：handle → agentId + 校验 available
├── fallback.ts           # 第3层：无显式 @ 的回退梯级
├── dispatcher.ts         # 第4层：串行/并行分发 + 去重
├── context-assembler.ts  # 第5层：对话历史 + team 名册 + identity 组装
├── guards.ts             # 护栏：深度/乒乓/超时
└── __tests__/
```

### 1.2 关键纯函数签名（对齐 subsystems.md §4）

```typescript
// 第1层：只认行首 @（去代码块/URL/引号内）
function parseMentions(text: string): AgentHandle[];

// 第2层：handle → agentId，校验 available
function resolveTargets(handles: AgentHandle[], registry: TeamRegistry): RouteResult;

// 第3层：无显式 @ 时的 fallback 链
function applyFallback(input: RouteInput, history: Message[]): RouteResult;

// 第5层：组装上下文（身份 + 名册 + 历史 + directMessageFrom）
function assembleContext(target: AgentId, thread: ThreadContext): AssembledContext;
```

### 1.3 第 6 层（LLM 判断）—— 不是代码

接/退/升（join/peel/escalate）是 **prompt 约束的涌现行为**，不是代码逻辑。在 identityPrompt 里注入路由规范，agent 自己判断。M4 实现 prompt 模板。

---

## 2. review + 介入机制

位置：`packages/core/src/review/`

### 2.1 实现

```
packages/core/src/review/
├── reviewer-matcher.ts       # 互审配对（M1 identity 已设计，这里实现）
├── intervention.ts           # ★ 介入判断（四类触发）
├── review-record.ts          # review 结果记录
└── __tests__/
```

### 2.2 介入判断（核心，对齐 VISION §3 支柱二）

```typescript
// intervention.ts
function decideIntervention(
  review: ReviewRecord,
  isDangerousOp: boolean,
): InterventionDecision {
  // VISION 四类触发：
  if (isDangerousOp) {
    return { needsHuman: true, trigger: 'dangerous_op', basis: '不可逆操作' };
  }
  if (review.verdict === 'approved') {
    return { needsHuman: false, trigger: 'review_consensus', basis: review.decisionBasis };
  }
  if (review.verdict === 'rejected' || review.verdict === 'needs_human') {
    return { needsHuman: true, trigger: 'review_disagreement', basis: '互审分歧' };
  }
}
```

**最终验收介入**（`final_acceptance`）：在 TaskService.acceptTask 时触发（M3 已有），M4 不重复。

### 2.3 危险操作判定

```typescript
// 哪些算危险操作（必须叫人，无论互审是否一致）
function isDangerousOp(step: Step, changes: FileChange[]): boolean {
  // - 删除文件
  // - 修改鉴权/安全相关文件（如 auth、credentials）
  // - 数据库 schema 变更
  // - 依赖变更（package.json）
  // （M4 先用规则匹配，后续可配置化）
}
```

---

## 3. review 编排（接到 M3 的 task 流程）

M3 的 `startStep` 里 agent 完成后直接 `step.completed`。M4 改为：

```
agent 完成 step
  ↓
触发互审（reviewer-matcher 选 reviewer）
  ↓
reviewer agent 执行 review（用 M2 适配器拉起）
  ↓
产出 ReviewRecord（verdict + findings + decisionBasis）
  ↓
decideIntervention(review, isDangerousOp)
  ↓
needsHuman=false → step.completed（自动通过）
needsHuman=true  → 创建 InterventionDecision，等 user（不自动 complete）
```

### TaskService 扩展

```typescript
// M4 在 M3 的 TaskService 上加：
async requestReview(taskId, stepId): Promise<ReviewRecord> {
  // 1. matchReviewer(authorAgentId)
  // 2. 构造 review prompt（含 diff + acceptance）
  // 3. AgentRunner.run() 拉起 reviewer
  // 4. 解析 review 结果 → ReviewRecord
  // 5. decideIntervention() → 存 InterventionDecision
}

async resolveIntervention(stepId, verdict: 'approve'|'reject'|'retry'): Promise<void> {
  // user 处理介入卡：
  // approve → step.completed
  // reject/retry → step.retried
}
```

---

## 4. 护栏（对齐 subsystems.md §4.3）

```typescript
// guards.ts
const GUARD_CONFIG = {
  maxMentionTargets: 2,        // 每条消息最多 2 个 @ 目标
  maxA2ADepth: 10,             // agent 调用链深度上限
  pingPongThreshold: 3,        // 同对来回 3 轮警告
  mentionTimeoutMs: 20 * 60_000,  // 20 分钟
};
```

---

## 5. M4 验收清单

- [ ] A2A 路由：行首 @ 解析 + handle→agentId 解析 + 回退梯级
- [ ] 互审：reviewer-matcher 选 reviewer（跨 family 优先，禁自审）
- [ ] 介入判断：四类触发正确（一致免介入/分歧介入/危险必介入/终局必介入）
- [ ] 危险操作检测：删文件/改鉴权/schema 变更 → 必叫人
- [ ] 介入卡：`resolveIntervention` 接 user 决策（approve/reject/retry）
- [ ] 护栏：乒乓检测 + 深度限制
- [ ] 所有决策保留 decisionBasis（VISION 约束）

---

## 6. M4 不做

- ❌ free chat 模式的 @mention（M5 随 UI 一起）
- ❌ 在场感知（V1.5）
- ❌ 性格养成（V1.5）

---

## 7. 依赖

**core** 新增模块：`a2a/`、`review/`（纯逻辑）
**server**：TaskService 扩展 review 编排

---

*本方案是 M4 A2A 协作的实现依据。完成后进 M5（board UI）。*
