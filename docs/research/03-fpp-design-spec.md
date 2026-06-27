---
feature_id: F-FPP (Feature Progress Graph)
topics: [architecture, workflow, ball-custody, sop]
doc_kind: design-spec
status: proposed
created: 2026-06-26
decisions: [ADR-FPP-1, ADR-FPP-2, ADR-FPP-3, ADR-FPP-4, ADR-FPP-5, ADR-FPP-6]
architecture_cell: feat-progress-graph (new)
related_cells: [ball-custody, identity-session, memory]
---

# Feature Progress Graph（FPP）— 无 Boss 的 Feature 推进图

> **一句话**：把 ball-custody 的事件溯源架构，从"单球责任追踪"上移一层，做成"feature 进度图"——
> **顶层、有状态、推进 feature**，但**没有 Boss**。它是所有猫共享读写的协调黑板，不是 lead 独占的控制台。

---

## 0. TL;DR

| 问题 | 解法 | 不做什么 |
|------|------|---------|
| 现在协作是"对话气泡流"，复杂 feature 推进不可见、失败整体重来 | 顶层、有状态、可重试的 Feature Progress Graph | ❌ 不引入 openteams 式 lead 独占写 + `assigned_agent_id` 分派的层级 DAG |
| 球权引擎只追踪"球在谁手里"，不追踪"feature 到第几 phase" | 复用 ball-custody 三件法宝（事件流/投影/纯函数状态机），subjectKey 从 `ball:thread/task` 上移到 `feat:{F号}` | ❌ 不新建第二套状态机，照搬 ball-custody 模式 |
| 谁来写图 / 谁来干 | append-only 事件流（任何猫+人 append）+ 节点不 assign（仍走 @mention 接/退/升） | ❌ 不让任何 agent 成为 Boss |

**核心隐喻**：爵士乐的**曲式（chord chart）**——顶层共享结构图让即兴不变噪音，但曲式不规定每个音符、没有任何人是指挥。FPP 是曲式，不是指挥。

---

## 1. 背景与动机

### 1.1 Clowder 现有的两个"种子"

Clowder 已经有两块拼图，但没拼起来：

**① ball-custody（F233）——去中心化的工作推进状态机**
- append-only 事件流（`BallCustodyEventLog`，唯一真相）+ 可重建投影（`BallCustodyProjection`）
- 7 态纯函数状态机（表驱动 `STATIC_TABLE` / `DYNAMIC_TABLE`，INV-10 穷举测试）
- subjectKey 从现有痕迹派生：`ball:thread:{id}` / `ball:task:{id}`（KD-1 不引入球 ID 新原语）
- projector 零外部副作用（rebuild 安全的铁律）

**但它追踪的是"球现在在谁手里"（即时责任归属），不是"feature 整体到第几 phase 了"（宏观进度）。**

**② SOP（F042）——5 步流程定义**
- `sop-definitions/development.yaml` 定义 6 个 phase：`design_gate → impl → quality_gate → review → merge → vision_guard`
- 每个 phase 有 `suggested_skill` + `hard_rules`（predicate 机器校验）+ `pitfalls`
- **但 phase 之间的推进靠猫手动跑 skill + 猫/人判断，没有持久化、可查询、可视化的"feature 当前在哪个 phase"状态。**

**③ concierge / duty cat（F229）—— 无 Boss 但有牵头的先例**

Clowder 进入会话时确实有"选主理人"的操作，但它是 **concierge（迎宾猫）/ duty cat（值班猫）**，不是 leader 选举。这一点是 FPP"无 Boss"哲学的事实锚点，必须先讲清：

- concierge cell 文档的明确定义：**"The concierge cat is an 岗位 (duty post) not a new agent class"**——值班猫是一个**岗位**，不是一个新的 agent 等级。
- 它是怎么"选"出来的？`resolveDefaultDutyCatProfileId()` 是**配置/默认值解析**，不是选举：优先级 `gemini35 → 第一个可用 → sonnet`。
- 它的核心能力是 **relay（转接）**——`concierge-target-cats-resolver.ts` 决定把话转给谁（显式 @ > thread 参与者 > feat_index 归属 > 让用户选）。**它是前台/总机，不是 boss。**
- roster 里的 `lead: true` 同理，是**描述性画像标记**（影响 prompt 标签 + reviewer 配对优先级），不是"运行时指挥权"。

> **Clowder 的精确哲学：有"牵头的人"，没有"发号施令的 boss"。** duty cat 牵头接待、opus 牵头架构，但它们都没有"分配权/指挥权"。谁来干活，永远由 @mention 的接/退/升决定。FPP 继承这个哲学：有"牵头进入某 phase 的猫"（`phase.entered` 的 `by`），但没有任何猫拥有 feature 的指挥权。

### 1.2 缺口（FPP 要补的）

| 已解决（ball-custody） | 未解决（FPP 补） |
|----------------------|----------------|
| "这个球现在谁拿着" | "这个 feature 整体到哪了" |
| "球卡住了/dead/zombie 了" | "design_gate 做完了吗，能不能开 impl" |
| "谁该对当前这一步行动"（单点） | "phase 间依赖、整体推进路径"（宏观） |

> 类比：ball-custody 是 Git 的**单个 commit**（谁在改这行），FPP 是 **PR 视图**（这个改动整体到哪了、由哪些 commit 组成）。FPP 不替代 ball-custody，而是聚合它。

### 1.3 为什么不照搬 openteams Workflow

openteams 的 Workflow 确实解决了"可控性"问题，但它的解法**与"有性格的 peer 团队"相悖**：

| | openteams Workflow（不照搬） | FPP（要做） |
|---|---|---|
| 谁写图 | lead 独占写 plan JSON | append-only 事件流，任何猫+人 append |
| 节点语义 | 指令（`assigned_agent_id` 分派给谁） | 工作单元（What + 验收），**不 assign** |
| 谁决定谁干 | lead 写死 | 节点 ready 时仍走 **@mention 接/退/升** |
| 控制流 | 确定性 DAG 拓扑执行 | phase 推进由**事件驱动** |
| retry | 系统控制重置节点 | **一次事件提议**，猫自选接不接 |
| Boss | lead 是 Boss | **没有 Boss** |

详见 `org2-openteams-learnings.md` 与对话记录中的分析。

---

## 2. 设计原则（6 条，带 ADR）

### ADR-FPP-1: 曲式，不是指挥（No Boss）

FPP 是共享协调黑板，不是控制台。没有 agent 拥有图的"唯一写入权"，没有 agent 能把工作"分派"给另一只猫。
> 注：本条讲的是"无指挥权"，ADR-FPP-6 进一步精确化为"牵头 ≠ 统治"——无指挥权不等于无牵头人。

- 节点是**工作单元**（What + 验收标准），不是**指令**
- "谁来做"永远走现有 @mention 的接/退/升，FPP 不碰
- 呼应 Clowder VISION.md："没有 Boss Agent，三只猫各有视角"

### ADR-FPP-2: 复用 ball-custody 架构，不另起炉灶

照搬 ball-custody 三件法宝：
- ① append-only 事件流（唯一真相，幂等去重）
- ② 可重建投影（rebuild = replay，零漂移）
- ③ 表驱动纯函数状态机（`STATIC_TABLE` + `DYNAMIC_TABLE`，穷举测试）

**不新建第二套事件溯源基础设施。** subjectKey 从 `ball:thread/task` 换成 `feat:{F号}`，状态机换一套转移表，架构同构。

### ADR-FPP-3: 图不 assign，进度是事件驱动

phase 之间的推进**不是**一个调度器按拓扑执行，而是**事件驱动**：前 phase `done` → 依赖满足 → 后 phase `unblocked` → 后 phase 的球放出 → 猫自选接。

依赖关系**从 SOP 定义派生**（`sop-definitions/development.yaml`），不硬编码进事件流。这让 FPP 与 SOP 单一真相源保持同步。

### ADR-FPP-4: retry 是事件，不是控制

"重试 quality_gate" = 发一条 `phase.retried` 事件 → 状态机把 quality_gate 重置回 `active` → 球重新放出 → 猫自选接不接。**改变的是球的状态，不是夺走自主权。** 这是从 openteams 借鉴的最有价值的东西，且和协调模型正交。

### ADR-FPP-5: 变更权分层（A 自由 append 为主 + B 高风险转移需 approve）

防止图被搞乱不靠"只有 lead 能写"，而靠**事件校验 + 状态机 reject 非法转移**（像 ball-custody 的 `invalid_transition`）。但对少数高风险转移，要求 propose→approve：

| 事件 | 权限 | 理由 |
|------|------|------|
| `phase.entered` / `phase.completed` | 任意猫自由 append | 正常推进，状态机守门 |
| `phase.blocked` / `phase.retried` | 任意猫自由 append | 自报告，状态机守门 |
| `phase.skipped`（跳过某 phase） | **需 approve**（CVO 或非作者猫） | 跳步是高风险，防误推进 |
| `feat.accepted`（最终验收） | **必须 CVO** | 呼应 openteams 不变量 "final acceptance is a user decision" + Clowder "愿景守护猫≠作者≠reviewer" |

### ADR-FPP-6: 牵头 ≠ 统治（Coordination ≠ Command）

FPP 允许"牵头"——某只猫 `phase.entered` 进入某 phase、成为该 phase 的主理人——但**牵头只是事实记录，不授予指挥权**。这条原则直接来自 Clowder 已验证的 duty cat 设计。

**背景事实**（见 §1.1 ③）：Clowder 的 concierge/duty cat 证明，一个协作系统可以"有牵头的人"而"没有发号施令的 boss"。值班猫牵头接待、opus 牵头架构，但都没有分配权/指挥权。

**对 FPP 的具体约束：**

| 概念 | FPP 怎么处理 | 不怎么处理 |
|------|------------|-----------|
| **牵头进入 phase** | `phase.entered` 的 `by` 字段记录是哪只猫——像 duty cat 记录"谁接了门铃"，是**事实记录** | ❌ 不因为 `by=X` 就授予 X 对该 phase 或 feature 的指挥权 |
| **牵头猫的权力** | 像 duty cat 的 relay：可以建议 "@砚砚来 review 这个"，但转不转得看砚砚自己（接/退/升） | ❌ 牵头猫不能把工作"分配"给另一只猫、不能强制某人接活 |
| **`by` 字段的用途** | 问责（谁做的这步）+ 协作上下文（"这步是宪宪做的"）+ Raft "名字=问责" | ❌ 不是"该 phase 的 owner 有权决定下一步谁干" |
| **能否换主理人** | 能——另一只猫 `phase.entered` 同一 phase，`by` 更新。像值班交接，不是篡位 | ❌ 不需要"释放指挥权"仪式，因为从来没有指挥权 |

**与 openteams lead 的对照（再次钉死边界）：**

| | openteams lead | FPP 的牵头猫 |
|---|---|---|
| 产生方式 | lead agent 角色（图的控制者） | `phase.entered` 事实记录（谁先进了 phase） |
| 核心动作 | design plan + write `assigned_agent_id` | 建议转接（像 relay），不强制 |
| 能否被绕过 | ❌ 它是图的控制者 | ✅ 任何猫都能 `phase.entered` 同一 phase |
| "谁干"由谁定 | lead 写死在节点 | @mention 的接/退/升 |
| 类比 | 项目经理 | 公司前台 / 值班接待 |

> **一句话**：duty cat 是"谁先听到门铃"，不是"谁是老板"。FPP 的 `by` 是"谁先进入了这个 phase"，同样不是"谁是这个 feature 的老板"。**牵头是协调行为，统治是控制行为；FPP 只要前者，拒绝后者。**

---

## 3. 数据模型

全部对齐 `packages/shared/src/types/ball-custody.ts` 的写法。

### 3.1 事件类型（append-only canonical）

```typescript
// packages/shared/src/types/feat-progress.ts

/**
 * F-FPP — Feature Progress Event Types
 *
 * 照 BallCustodyEvent（F233）结构：append-only、幂等去重（sourceEventId）、
 * 可重建投影。subjectKey 从 ball:thread/task 上移到 feat:{F号}（ADR-FPP-2）。
 */

// ---------------------------------------------------------------------------
// Event kinds
// ---------------------------------------------------------------------------

export type FeatProgressEventKind =
  | 'feat.kickoff'        // feature 立项（payload: { vision, by, byRole })
  | 'phase.entered'       // 某猫/人进入某 phase（payload: { phase, by, byRole })
  | 'phase.completed'     // 某 phase 完成，带证据（payload: { phase, evidence, by })
  | 'phase.blocked'       // 某 phase 卡住（payload: { phase, reason, by })
  | 'phase.unblocked'     // 阻塞解除（payload: { phase, by })
  | 'phase.retried'       // 步骤级 retry：重置某 phase 回 active（payload: { phase, reason, by })
  | 'phase.skipped'       // 跳过某 phase【ADR-FPP-5: 需 approve】（payload: { phase, reason, approver })
  | 'feat.accepted';      // 最终验收【ADR-FPP-5: 必须 CVO】（payload: { by: 'cvo' })

export type FeatProgressClassification = 'state-changing' | 'informational';

// ---------------------------------------------------------------------------
// Core event record（照 BallCustodyEvent）
// ---------------------------------------------------------------------------

export interface FeatProgressEvent {
  /** 幂等/去重键，规范：
   * - feat.kickoff: `kickoff:{featId}`
   * - phase.*: `phase:{featId}:{phase}:{kind}:{at}`
   * - feat.accepted: `accepted:{featId}:{at}` */
  sourceEventId: string;
  /** 派生标识：`feat:{F号}`（如 feat:F233） */
  subjectKey: string;
  kind: FeatProgressEventKind;
  classification: FeatProgressClassification;
  payload: FeatProgressEventPayload;
  /** Unix timestamp (ms) */
  at: number;
}

export type FeatPhaseId =
  | 'design_gate'
  | 'impl'
  | 'quality_gate'
  | 'review'
  | 'merge'
  | 'vision_guard';

export interface FeatProgressEventPayload {
  phase?: FeatPhaseId;
  vision?: string;        // feat.kickoff
  by?: string;            // catId 或 'cvo'
  byRole?: 'author' | 'reviewer' | 'guardian' | 'cvo';
  evidence?: string;      // phase.completed 的证据引用
  reason?: string;        // blocked/retried/skipped 的原因
  approver?: string;      // phase.skipped 的审批人（ADR-FPP-5）
}
```

### 3.2 投影（rebuildable read model）

```typescript
// ---------------------------------------------------------------------------
// Projection（照 BallCustodyProjection，可重建）
// ---------------------------------------------------------------------------

export type FeatPhaseStatus =
  | 'pending'     // 未到（依赖未满足）
  | 'active'      // 进行中
  | 'blocked'     // 卡住
  | 'done'        // 完成
  | 'skipped'     // 跳过
  | 'retried';    // 被 retry 重置（瞬态，立即转 active）

export interface FeatProgressProjection {
  subjectKey: string;        // feat:{F号}
  featId: string;            // F233
  vision: string;            // 愿景（feat.kickoff 写入）
  /** feature 整体状态（由 phaseStatus 派生） */
  state: 'new' | 'in_progress' | 'accepted';
  currentPhase: FeatPhaseId | null;
  /** 每个 phase 的状态 */
  phaseStatus: Record<FeatPhaseId, FeatPhaseStatus>;
  /** 每个 phase 的 retry 次数（粒度 retry 计数） */
  retryCount: Record<FeatPhaseId, number>;
  /** 每个 phase 当前关联的球（复用 ball-custody，不另起炉灶） */
  phaseBalls: Record<FeatPhaseId, string[]>;
  /** 进入当前 phase 的时刻（ageMs = now - currentPhaseEnteredAt，纯派生不存） */
  currentPhaseEnteredAt: number | null;
  lastStateChangeAt: number;
  lastEventAt: number;
  appliedEventCount: number;       // rebuild 一致性校验
  lastRejectedEvent: FeatProgressEvent | null;  // observability
  acceptedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
```

### 3.3 状态机（表驱动纯函数）

照搬 `ball-custody-state-machine.ts` 的 `STATIC_TABLE` + `DYNAMIC_TABLE` 模式。

```typescript
// packages/api/src/domains/feat-progress/feat-progress-state-machine.ts

/**
 * F-FPP — Feature Progress State Machine（transition 纯函数）
 *
 * 照 ball-custody-state-machine 的表驱动模式。纯函数 — 零 IO、零副作用。
 * INV-FPP-1（完整性）：全 phase 状态 × 全 event 的每格行为确定，穷举测试钉死。
 */

import type {
  FeatPhaseId, FeatPhaseStatus, FeatProgressEvent, FeatProgressProjection,
} from '@cat-cafe/shared';

export const ALL_FEAT_PHASES: FeatPhaseId[] = [
  'design_gate', 'impl', 'quality_gate', 'review', 'merge', 'vision_guard',
];

/** phase 依赖（从 SOP 定义派生，ADR-FPP-3）。不做任意 DAG，只做线性 + vision_guard 收口。 */
export const PHASE_DEPENDENCIES: Record<FeatPhaseId, FeatPhaseId[]> = {
  design_gate: [],                          // 第一步
  impl: ['design_gate'],                    // impl 依赖 design_gate done
  quality_gate: ['impl'],
  review: ['quality_gate'],
  merge: ['review'],
  vision_guard: ['merge'],                  // 收口
};

/** phase 线性顺序（用于推导 currentPhase）。 */
export const PHASE_ORDER: FeatPhaseId[] = [
  'design_gate', 'impl', 'quality_gate', 'review', 'merge', 'vision_guard',
];

export type FeatTransitionReject =
  | 'invalid_transition'        // 非法状态转移
  | 'dependency_not_satisfied'  // 前置 phase 未 done
  | 'bad_payload'
  | 'unauthorized';             // ADR-FPP-5: phase.skipped 无 approver / feat.accepted 非 cvo

export type FeatTransitionResult =
  | { ok: true; phaseEffects: Partial<Record<FeatPhaseId, FeatPhaseStatus>>; featState?: 'in_progress' | 'accepted' }
  | { ok: false; reason: FeatTransitionReject };

// ─── 复杂守卫 resolver ────────────────────────────────────────────────────

/** 检查 phase 依赖是否满足（前置 phase 全 done 或 skipped）。 */
function dependenciesSatisfied(
  phase: FeatPhaseId,
  phaseStatus: Record<FeatPhaseId, FeatPhaseStatus>,
): boolean {
  return PHASE_DEPENDENCIES[phase].every(
    dep => phaseStatus[dep] === 'done' || phaseStatus[dep] === 'skipped',
  );
}

/** ADR-FPP-5: 高风险转移的权限校验。 */
function authorizeHighRiskEvent(event: FeatProgressEvent): boolean {
  if (event.kind === 'phase.skipped') {
    return typeof event.payload.approver === 'string';  // 需 approve
  }
  if (event.kind === 'feat.accepted') {
    return event.payload.by === 'cvo';                  // 必须 CVO
  }
  return true;
}

// ─── 转移（纯函数）─────────────────────────────────────────────────────

/**
 * 纯函数转移。projection + event → phase 状态变更 or reject。
 * 字段 effect（retryCount / phaseBalls / 时间戳）由 projector 在 apply 时处理，不在此。
 */
export function transition(
  proj: FeatProgressProjection,
  event: FeatProgressEvent,
): FeatTransitionResult {
  // ADR-FPP-5: 高风险转移权限校验
  if (!authorizeHighRiskEvent(event)) {
    return { ok: false, reason: 'unauthorized' };
  }

  const ps = proj.phaseStatus;

  switch (event.kind) {
    case 'feat.kickoff':
      // 已 accepted 的 feature 不再 kickoff
      if (proj.state === 'accepted') return { ok: false, reason: 'invalid_transition' };
      return { ok: true, phaseEffects: {}, featState: 'in_progress' };

    case 'phase.entered': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      // 依赖必须满足（或当前 phase 已 active）
      if (!dependenciesSatisfied(phase, ps) && ps[phase] !== 'active' && ps[phase] !== 'retried') {
        return { ok: false, reason: 'dependency_not_satisfied' };
      }
      if (ps[phase] === 'done' || ps[phase] === 'skipped') {
        return { ok: false, reason: 'invalid_transition' };
      }
      return { ok: true, phaseEffects: { [phase]: 'active' }, featState: 'in_progress' };
    }

    case 'phase.completed': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      if (ps[phase] !== 'active' && ps[phase] !== 'blocked') {
        return { ok: false, reason: 'invalid_transition' };
      }
      return { ok: true, phaseEffects: { [phase]: 'done' }, featState: 'in_progress' };
    }

    case 'phase.blocked': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      if (ps[phase] !== 'active') return { ok: false, reason: 'invalid_transition' };
      return { ok: true, phaseEffects: { [phase]: 'blocked' } };
    }

    case 'phase.unblocked': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      if (ps[phase] !== 'blocked') return { ok: false, reason: 'invalid_transition' };
      return { ok: true, phaseEffects: { [phase]: 'active' } };
    }

    case 'phase.retried': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      // 只能 retry 已做过（done/blocked/failed）的 phase
      if (ps[phase] === 'pending' || ps[phase] === 'active') {
        return { ok: false, reason: 'invalid_transition' };
      }
      // retry 把 phase 重置回 active（步骤级 retry！）
      return { ok: true, phaseEffects: { [phase]: 'active' } };
    }

    case 'phase.skipped': {
      const phase = event.payload.phase;
      if (!phase) return { ok: false, reason: 'bad_payload' };
      // 不能跳过 vision_guard（收口必须走）
      if (phase === 'vision_guard') return { ok: false, reason: 'invalid_transition' };
      if (ps[phase] === 'done') return { ok: false, reason: 'invalid_transition' };
      return { ok: true, phaseEffects: { [phase]: 'skipped' } };
    }

    case 'feat.accepted':
      // 所有 phase 必须 done 或 skipped，且 vision_guard 必须 done
      const allClosed = ALL_FEAT_PHASES.every(p => ps[p] === 'done' || ps[p] === 'skipped');
      if (!allClosed) return { ok: false, reason: 'invalid_transition' };
      if (ps['vision_guard'] !== 'done') return { ok: false, reason: 'invalid_transition' };
      return { ok: true, phaseEffects: {}, featState: 'accepted' };

    default:
      return { ok: false, reason: 'invalid_transition' };
  }
}
```

### 3.4 Projector（照搬 BallCustodyProjector）

```typescript
// packages/api/src/domains/feat-progress/FeatProgressProjector.ts
//
// 照 BallCustodyProjector（F233）：apply(event) = read projection → transition()
// → 字段 effect + save；rebuild = delete + replay。
// 零外部副作用（rebuild 安全）。

function createInitialProjection(subjectKey: string, featId: string, now: number): FeatProgressProjection {
  return {
    subjectKey,
    featId,
    vision: '',
    state: 'new',
    currentPhase: null,
    phaseStatus: { design_gate: 'pending', impl: 'pending', quality_gate: 'pending',
                   review: 'pending', merge: 'pending', vision_guard: 'pending' },
    retryCount: { design_gate: 0, impl: 0, quality_gate: 0, review: 0, merge: 0, vision_guard: 0 },
    phaseBalls: { design_gate: [], impl: [], quality_gate: [], review: [], merge: [], vision_guard: [] },
    currentPhaseEnteredAt: null,
    lastStateChangeAt: now,
    lastEventAt: now,
    appliedEventCount: 0,
    lastRejectedEvent: null,
    acceptedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** accepted transition 后应用字段 effect（mutate proj）。retryCount / phaseBalls / 时间戳。 */
function applyFieldEffects(proj: FeatProgressProjection, event: FeatProgressEvent, now: number): void {
  const p = event.payload;
  switch (event.kind) {
    case 'feat.kickoff':
      if (typeof p.vision === 'string') proj.vision = p.vision;
      break;
    case 'phase.entered':
      if (p.phase) {
        proj.currentPhase = p.phase;
        proj.currentPhaseEnteredAt = now;
      }
      break;
    case 'phase.retried':
      // 粒度 retry 计数 + 重新设当前 phase
      if (p.phase) {
        proj.retryCount[p.phase] += 1;
        proj.currentPhase = p.phase;
        proj.currentPhaseEnteredAt = now;
      }
      break;
    case 'feat.accepted':
      proj.acceptedAt = now;
      proj.currentPhase = null;
      break;
  }
  proj.lastEventAt = now;
}
```

---

## 4. 运行时数据流

### 4.1 一个 feature 的完整生命周期（时序）

```
CVO: "做个 GitHub 同步功能" (F-NEW)
  │
  ├─ feat.kickoff { vision: "用户能一键同步 issue", by: cvo }
  │     → state: new → in_progress; design_gate 仍 pending
  │
  ├─ [design_gate 依赖为空，自动 ready]
  ├─ 宪宪 @自己进入 design_gate
  │     → phase.entered { phase: design_gate, by: 宪宪 }
  │     → design_gate: pending → active; currentPhase = design_gate
  │
  ├─ 宪宪和 CVO 讨论设计，产出 spec
  ├─ 宪宪: phase.completed { phase: design_gate, evidence: "spec.md" }
  │     → design_gate: active → done
  │     → [依赖满足] impl 自动变 ready（但状态机不自动 active，等猫 enter）
  │
  ├─ 宪宪进入 impl
  │     → phase.entered { phase: impl, by: 宪宪 }
  │     → impl: pending → active
  │     → 此时 impl 的球放出，可关联 ball:thread:{id}
  │
  ├─ [impl 遇到阻塞]
  ├─ 宪宪: phase.blocked { phase: impl, reason: "GitHub API 限流" }
  │     → impl: active → blocked
  │
  ├─ [阻塞解除]
  ├─ 宪宪: phase.unblocked { phase: impl }
  │     → impl: blocked → active
  │
  ├─ 宪宪: phase.completed { phase: impl, evidence: "diff" }
  │     → impl: active → done
  │
  ├─ [进入 quality_gate → review，砚砚 review（跨模型互审）]
  │     ... review phase ...
  │
  ├─ [review 失败！砚砚 reject]
  │     → 这是步骤级 retry 的场景：
  ├─ 宪宪: phase.retried { phase: impl, reason: "砚砚 review 指出竞态" }
  │     → impl: done → active   ← 只重试 impl，其余不动！
  │     → retryCount.impl += 1
  │     → 球重新放出，宪宪（或别的猫）自选接不接
  │
  ├─ [impl 重做 → quality_gate → review 通过 → merge]
  │
  ├─ [vision_guard：烁烁做愿景三问（守护猫≠作者≠reviewer）]
  ├─ 烁烁: phase.completed { phase: vision_guard, evidence: "守护报告" }
  │     → vision_guard: active → done
  │
  ├─ [最终验收 — 必须 CVO，ADR-FPP-5]
  ├─ CVO: feat.accepted { by: 'cvo' }
  │     → state: in_progress → accepted
  │     → acceptedAt = now
  │
  └─ feature 闭环 ✓
```

### 4.2 关键不变量（照 ball-custody INV 系列）

| ID | 不变量 | 校验方式 |
|----|--------|---------|
| INV-FPP-1 | 全 phase 状态 × 全 event 每格行为确定，无未定义 | 穷举测试（照 INV-10） |
| INV-FPP-2 | rebuild(replay) 逐字段相同 projection，零漂移 | 照 INV-2 |
| INV-FPP-3 | 事件永不从 log 删除，facts immutable | 照 ball-custody |
| INV-FPP-4 | phase.entered 前依赖必须满足（dependency_not_satisfied reject） | transition 守卫 |
| INV-FPP-5 | feat.accepted 必须所有 phase done/skipped + vision_guard done | transition 守卫 |
| INV-FPP-6 | projector 零外部副作用（无唤醒/投递/通知） | 照 ball-custody，副作用在 scheduler tick |
| INV-FPP-7 | vision_guard 不可 skipped（收口必走） | transition 守卫 |
| INV-FPP-8 | phase.skipped 必须有 approver；feat.accepted 必须 by='cvo' | authorizeHighRiskEvent |

---

## 5. 架构边界（Architecture Cell）

### 5.1 新 cell：`feat-progress-graph`

```yaml
cell_id: feat-progress-graph
title: Feature Progress Graph
summary: >
  feature 级进度的事件溯源：append-only 事件流、可重建投影、phase 状态机。
  复用 ball-custody 架构但上移到 feature 粒度。无 Boss——图是共享协调黑板，
  节点不 assign，谁干仍走 @mention 接/退/升。
canonical_features: [F-FPP]
code_anchors:
  - packages/shared/src/types/feat-progress.ts
  - packages/api/src/domains/feat-progress/FeatProgressEventLog.ts
  - packages/api/src/domains/feat-progress/FeatProgressProjector.ts
  - packages/api/src/domains/feat-progress/feat-progress-state-machine.ts
  - packages/api/src/domains/feat-progress/FeatProgressProjectionStore.ts
  - packages/api/src/domains/feat-progress/feat-progress-keys.ts
  - packages/api/src/domains/feat-progress/FeatProgressIngest.ts
static_scan_hints: [FeatProgressEvent, FeatProgressProjection, feat-progress, phase.entered, phase.retried, feat.accepted]
```

### 5.2 Do NOT Unify With（划清边界，照 ball-custody cell 风格）

- **`feat-progress-graph` is not `ball-custody`。** FPP 追踪 feature 整体 phase 进度（宏观）；ball-custody 追踪单个球/任务的责任归属（微观）。FPP 的 `phaseBalls` 字段**引用** ball-custody 的 subjectKey，但**不拥有**球的真相。球的真相永远在 BallCustodyEventLog。
- **FPP 不做工作分派。** 节点是工作单元不是指令；"谁来做"走 @mention，FPP 不碰 identity-agent 的路由。
- **FPP 不做确定性调度。** phase 推进是事件驱动（前 phase done → 后 phase ready），不是调度器按拓扑执行。无 scheduler loop（ball-custody 的 ProbeScheduler 是 best-effort 观测，FPP 连这个都不需要——进度是猫推的，不是系统催的）。
- **FPP 不替代 SOP 定义。** phase 列表和依赖从 `sop-definitions/development.yaml` 派生（ADR-FPP-3），FPP 不另存一份 phase 真相。SOP 改了，FPP 的 PHASE_DEPENDENCIES 同步。
- **不为 feature 进度加第二个 canonical store。** FeatProgressEventLog 是唯一真相；FeatProgressProjectionStore 是可重建投影。

### 5.3 与现有 cell 的关系

```
                    ┌─────────────────────────┐
                    │   feat-progress-graph   │  ← 本提案（宏观：feature 到第几 phase）
                    │   (NEW, F-FPP)          │
                    └───────────┬─────────────┘
                                │ phaseBalls 引用（不拥有）
                                ▼
                    ┌─────────────────────────┐
                    │     ball-custody        │  ← 现有（微观：球在谁手里）
                    │     (F233)              │
                    └─────────────────────────┘
                                ▲
                                │ @mention 路由决定谁接球
                                ▼
                    ┌─────────────────────────┐
                    │    identity-session     │  ← 现有（猫的身份/路由）
                    │    (F032/F231)          │
                    └────────────┬────────────┘
                                 │ 会话入口"谁来牵头接待"是
                                 │ concierge 的事，FPP 不碰
                                 ▼
                    ┌─────────────────────────┐
                    │   concierge / duty cat  │  ← 现有（迎宾/转接，F229）
                    │   (F229)                │  ← ADR-FPP-6 的先例依据
                    └─────────────────────────┘
```

---

## 6. 可见性（投影怎么呈现）

FPP 的投影天然是一个**进度图视图**。前端从 FeatProgressProjection 渲染：

- **phase 卡片流**（不是 openteams 的复杂 DAG，而是 SOP 的线性 phase + 收口）
  - 每个 phase 一张卡：状态色（pending 灰 / active 蓝 / blocked 红 / done 绿）
  - 显示 retryCount（重试过的 phase 标角标）
  - 显示关联球（点了能看到 ball-custody 里球在谁手里）
- **当前 phase 高亮** + ageMs（这个 phase 卡了多久）
- **blocked 球聚合**（哪些 phase 卡住了，reason 是什么）

关键：**这个视图是 read-only 的投影渲染**，操作（enter/complete/retry）仍通过猫发消息触发，不是点按钮调 API（虽然也可加按钮，但按钮背后还是发事件）。

---

## 7. 与"有性格"的融合（FPP 相对 openteams 的关键优势）

openteams 的 Workflow 里，节点是匿名 worker；**FPP 的节点仍是猫**。融合点：

1. **phase.entered 的 `by` 是猫的 catId**——进度图里能看到"design_gate 是宪宪做的，review 是砚砚审的"，呼应 Raft "Agents Need Names"（名字=问责）。
2. **retry 事件带 reason**——重试不是冷冰冰的"重置节点"，而是"砚砚 review 指出竞态，所以 impl retry"，保留了协作上下文。
3. **性格在两种模式都保持**——Free Chat（轻量 @协作）和 FPP（结构化 phase）共享 session context，猫的性格在 phase 推进时同样表达。
4. **vision_guard 是 Clowder 独有的收口**——openteams 没有"愿景守护猫≠作者≠reviewer"这一步，FPP 把它作为不可跳过的收口 phase（INV-FPP-7），保住了"有性格团队"的质量纪律。

---

## 8. 开放问题（需后续 Design Gate 拍板）

### OQ-1: phase 依赖要不要支持并行？

当前 `PHASE_DEPENDENCIES` 是严格线性（SOP 定义就是线性的）。但 openteams 能"Sync Engine 和 Frontend 并行"。
- **选项 A**：保持线性（最简，对齐 SOP 现状）
- **选项 B**：支持 phase 内并行子任务（impl 下挂多个并行球，但 phase 本身仍是一个状态）
- **倾向 A**：先上线线性版，并行需求用 phaseBalls 多球表达（一个 impl phase 可挂多个并行球），不引入子 phase 概念。

### OQ-2: FPP 要不要做"best-effort 唤醒"（像 ball-custody 的 ProbeScheduler）？

ball-custody 有 ProbeScheduler 在 blocked 球上发唤醒。FPP 的 phase.blocked 要不要类似机制？
- **倾向不做**：进度是猫推的，不是系统催的（ADR-FPP-3）。blocked phase 的解除靠猫/人发 phase.unblocked，不需要系统 tick。值班简报横切读 projection 即可发现卡住的 feature。

### OQ-3: 一个 thread 能不能挂多个 feature？

ball-custody 的 subjectKey 是 `ball:thread:{id}`（一个 thread 一个球）。FPP 的 `feat:{F号}` 是 feature 粒度。
- 一个 thread 可能在讨论多个 feature，或一个 feature 跨多个 thread。
- **倾向**：FPP 与 thread 解耦，`phaseBalls` 关联多个 `ball:thread:{id}`。一个 feature 的不同 phase 可在不同 thread 推进。

---

## 9. 落地路线（Phase 拆分，照 Clowder SOP）

| Phase | 内容 | 验收 |
|-------|------|------|
| **P0 骨架** | shared types + state machine + projector + 内存 store + 穷举测试 | INV-FPP-1/2 全绿；rebuild 一致性测试过 |
| **P1 事件接线** | FeatProgressIngest + Redis 持久化 + feat.kickoff/phase.entered/completed 接线 | 一个 feature 能从 kickoff 走到 accepted |
| **P2 retry** | phase.retried + retryCount + 球重新放出 | 步骤级 retry 可用，retry 后球重新放出 |
| **P3 可见性** | 前端 phase 卡片流渲染 + blocked 聚合 | CVO 能在 Hub 看到 feature 进度图 |
| **P4 高风险守门** | phase.skipped approve + feat.accepted CVO 校验 | INV-FPP-8 测试过 |

---

## 附录 A：与 ball-custody 的架构对照

| | ball-custody (F233) | FPP (本提案) |
|---|---|---|
| 追踪粒度 | 单球责任（微观） | feature phase 进度（宏观） |
| subjectKey | `ball:thread:{id}` / `ball:task:{id}` | `feat:{F号}` |
| 事件数 | 16 种 | 8 种 |
| 状态数 | 7 态（球） | 6 态（phase）× 3 态（feature） |
| 状态机 | 表驱动纯函数 | 表驱动纯函数（同构） |
| 投影 | BallCustodyProjection | FeatProgressProjection |
| 副作用 | ProbeScheduler 唤醒（best-effort） | 无（进度是猫推的） |
| Boss | 无 | 无 |
| 关系 | 微观真相 | 引用 ball-custody，不拥有 |

## 附录 B：关键代码锚点（实现时对齐）

| 要新建的文件 | 对齐的 ball-custody 参考 |
|-------------|------------------------|
| `packages/shared/src/types/feat-progress.ts` | `packages/shared/src/types/ball-custody.ts` |
| `packages/api/src/domains/feat-progress/feat-progress-state-machine.ts` | `ball-custody-state-machine.ts` |
| `packages/api/src/domains/feat-progress/FeatProgressProjector.ts` | `BallCustodyProjector.ts` |
| `packages/api/src/domains/feat-progress/FeatProgressEventLog.ts` | `BallCustodyEventLog.ts` |
| `packages/api/src/domains/feat-progress/FeatProgressIngest.ts` | `BallCustodyIngest.ts` |
| `packages/api/src/domains/feat-progress/feat-progress-keys.ts` | `ball-custody-keys.ts` |

---

*本设计基于 Clowder ball-custody（F233）已验证的事件溯源架构，吸收 openteams 的"粒度 retry"正交能力，刻意回避其"lead 独占写 + assign 分派"的层级控制。与 `clowder-ai-analysis.md`（Clowder 实现）和 `org2-openteams-learnings.md`（竞品分析）配套。*
