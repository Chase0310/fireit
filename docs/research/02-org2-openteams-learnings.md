# ORG2 + openteams 可借鉴能力分析

> **目标**：你正在打造一个「有性格的多 agent 团队」，底座是 **Clowder AI + Raft 理念**（身份持久化、跨模型互审、团队文化）。
> 本文档分析 **ORG2** 和 **openteams** 各自有哪些 Clowder **没有**或**做得更强**的差异化机制值得借鉴，并给出落地建议。
>
> 生成日期：2026-06-26
> 配套文档：`clowder-ai-analysis.md`（Clowder 实现记录 + Raft 经验总结）

---

## 目录

- [定位对照：四个项目各擅长什么](#定位对照四个项目各擅长什么)
- [第一部分：从 ORG2 可借鉴的能力](#第一部分从-org2-可借鉴的能力)
- [第二部分：从 openteams 可借鉴的能力](#第二部分从-openteams-可借鉴的能力)
- [第三部分：能力缺口矩阵与落地优先级](#第三部分能力缺口矩阵与落地优先级)
- [第四部分：建议的技术融合路线](#第四部分建议的技术融合路线)

---

## 定位对照：四个项目各擅长什么

一句话先抓住本质（避免重复造轮子）：

| 项目 | 核心隐喻 | 最强能力（Clowder 是否已覆盖） |
|------|---------|------------------------------|
| **Clowder AI**（你的底座） | 猫群团队 | 持久身份性格、A2A `@mention`、跨模型互审、SOP 纪律 ✅ 已覆盖 |
| **Raft**（理念参考） | 持续在场队友 | 名字/身份、room-aware posture、AX 设计 ✅ 理念已吸收 |
| **ORG2** | 可审计的组织 | **执行轨迹可回放、agent 可读性、资源/在场感知、组织对齐** ⚠️ Clowder 弱 |
| **openteams** | 可视工作流图 | **步骤级 review/retry、执行图可视化、worktree 隔离、lead-agent 规划** ⚠️ Clowder 弱 |

**关键结论（先说重点）**：
- **Clowder 解决了"agent 是谁、怎么协作"**（身份 + A2A + 互审），但**协作过程是"对话流"形态，缺乏结构化的执行可控性和可审计性**。
- **ORG2 补的是"可审计性/可读性"**：让 agent 的工作像 PR 一样可回放、可审计、可交接——"一个你无法审计的 agent 是一个你无法信任的 agent"。
- **openteams 补的是"执行可控性"**：把复杂任务变成可见、可逐步审批/重试的执行图——"真正的杠杆不是更多 agent，而是编排它们"。
- 这三者**高度互补**，不冲突。一个理想的「有性格 + 可控 + 可审计」的 agent 团队 = Clowder 的身份底座 + ORG2 的轨迹可读性 + openteams 的执行图控制。

---

# 第一部分：从 ORG2 可借鉴的能力

ORG2 自称 **ADE（Agentic Development Environment）**，核心哲学是："agents 是一等公民的 actor，而人类的工具"。它最强的差异化在**可审计性（auditability）和可读性（readability）**。

## 1.1 执行轨迹可回放（Session Livestream & Replay）⭐ 最值得借鉴

> *"An agent you cannot audit is an agent you cannot trust."*

这是 ORG2 最独特的卖点，Clowder 完全没有。

### 实现机制

**三层遥测模型**（`packages/orgtrack/src/index.ts`）——`.orgtrack/` 目录，按数据粒度分三层：

```typescript
export type OrgtrackTier = "meta" | "details" | "trajectory";
```

| Tier | 内容 | 用途 |
|------|------|------|
| **meta** | 会话级摘要（SessionRecord）——标题/状态/workspace/branch/parentSession/agent metadata | 会话列表、组织对齐 |
| **details** | 文件级变更（FileChangeRecord）——filePath/pathHash/functionName/startLine/endLine/linesAdded | impact 分析、可读性 |
| **trajectory** | 事件流（ActivityRecord）——按 ActivityKind 分类的完整事件序列 | 回放、审计 |

**ActivityKind**（trajectory 层的事件类型）——这是回放的"原子"：
```
heartbeat | tool_call | file_edit | file_create | file_delete |
terminal_command | agent_action | message | import_event |
focus_gained | focus_lost
```

**核心架构（SessionCore + Simulator 两个引擎）**：
- **SessionCore**（`src/engines/SessionCore/`）—— 中央数据引擎：
  - `ingestion/` → 通过 Tauri IPC 调 Rust 的 `es_process_chunks` 把原始 `ActivityChunk` 标准化为 `SessionEvent[]`。**关键不变量：所有 chunk 标准化都在 Rust 里做，TS 层不做本地归一化**
  - `sync/` → WebSocket / Tauri Channel 订阅，支持 livestream（实时流）和 replay（回放）两种模式
  - `hooks/replay/` → `useReplayState` / `useStepState` / `useRecentFiles`
  - `storage/` → SQLite + IndexedDB 双持久化
- **Simulator**（`src/engines/Simulator/`）—— 把 agent 会话**回放成一整套"应用"**，而非一个个孤立的事件组件：
  - `utils/findIndexAtTime.ts` → 规范的二分查找定位回放游标
  - `utils/eventSegments.ts` → 时间轴分段计算
  - 按 `functionName` 路由到不同 App 视图（见下表）

**App-type 路由（把轨迹可视化为"应用"）**——这是 ORG2 最巧妙的设计：

| AppType | 组件 | 由哪些 functionName 触发 |
|---------|------|------------------------|
| `CODE_EDITOR` | SimulatorCodeEditor | read_file / edit_file / run_shell / code_search / list_dir |
| `CHANNELS` | SimulatorMessages | assistant / send_message / think / **consult_agent** |
| `BROWSER` | SimulatorBrowser | browser_action / navigate_browser / screenshot |
| `DB_MANAGER` | SimulatorDatabase | db_query / sql_execute |
| `STORY_MANAGER` | SimulatorProject | project_overview |
| `TRAJECTORY` | SimulatorTrajectory | 全局视图 |

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 1：给每只"猫"的工作加一个可回放的轨迹层。**
Clowder 现在的协作是"对话气泡流"，工作过程随对话滚走就找不回了。借鉴 ORG2：
- 在 A2A 消息之外，**并行记录一条 trajectory 事件流**（每只猫的每个 tool_call / file_edit / agent_action 都是一条可回放的 ActivityRecord）
- 这样跨模型互审时，reviewer 猫不只看到"最终 diff"，还能**回放作者猫的完整工作过程**——审"怎么做的"比只审"做出来什么"更深
- 这直接强化 Clowder 的「跨模型互审」：砚砚 review 宪宪的代码时，能回放宪宪的推理轨迹，看到"宪宪为什么绕了弯路"

**💡 借鉴 2：三层 tier 模型解决"记录多少"的取舍。**
不要全量记录所有事件（烧存储/隐私），而是分级：
- meta（总是记录）+ details（按需）+ trajectory（仅审查/交接时展开）
- 这和 Clowder 的 `l0RosterSummary`（中性摘要层，避免偏见）是同一个哲学：**分层暴露，按需展开**

---

## 1.2 Agent 可读性（Agent Readability）⭐

ORG2 明确把"会话可读性"作为一等目标，和 Clowder 的"性格化"形成互补。

### 核心理念

> *"A session that produces correct output but is opaque is a liability — you cannot trust it, improve it, or hand it off."*

- 人类可读的 **turn summaries**（每轮工作摘要）——让 agent 工作像 PR 一样可读
- 结构化的会话持久化 + 执行模式 + 回放字幕（captioned with what the agent said and did at each step）
- "看 agent 工作应该像真实的 peer-coding——像 Zoom 上看一个有经验的人实时解决问题"

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 3：让每只猫的输出有"工作摘要"+ "工作过程"两个层次。**
- Clowder 现在注重"性格表达"（怎么说话），ORG2 注重"工作可读"（做了什么、为什么）
- 融合点：**每只猫回复时既保持性格语气，又附带结构化的"本轮工作摘要"**（类似 ORG2 的 turn summary）
- 这也呼应 Raft 文章 5 的 AX 理念：交接信息要对消费方（其他猫/人）"可直接行动"

---

## 1.3 资源/在场感知（Presence-Aware Execution）⭐

ORG2 会根据**人是否在场**改变行为——这是 Clowder 完全没有的维度。

### 实现理念（来自 DESIGN_PHILOSOPHY.md §5）

> *"ORGII factors in your presence. Like a status in a chat or office app — available, in a meeting, away — the platform can behave differently depending on whether you are actively watching."*

- **人在场**（available/watching）：agent 主动浮现关键决策点，**等待你的输入**
- **人离开**（away）：agent 继续做委派的工作，把需要你审查的东西**排队**
- 状态不只是社交信号，而是**塑造系统如何在你和 agent 之间路由工作**
- 时间管理：知道什么时候**在监督下和 agent 协作**，什么时候**让它们独自跑任务**

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 4：给 CVO（人）加一个"在场状态"，影响猫群的协作模式。**
- 这和 Clowder 的 CVO 理念天然契合，但更进一步：**CVO 的状态不只是情绪表达，而是触发协作模式切换**
  - CVO "available" → 猫主动 @ CVO 做决策门（design gate / 冲突仲裁）
  - CVO "away/focus" → 猫自主推进委派任务，把需审批的堆到 approval hub（Clowder 已有 Approval Index cell！可直接复用）
- 这呼应 Raft 文章 3/4 的 posture 理念：**不仅 agent 有 posture（silent/speak-up），人也该有 presence 状态，两者共同决定协作节奏**

**💡 借鉴 5：focus_gained / focus_lost 作为事件。**
ORG2 的 ActivityKind 里把 `focus_gained`/`focus_lost` 当作一等事件。借鉴：记录"人何时在看哪个会话"，可用于：
- 决定何时推送关键决策（人在看时推，不在看时排队）
- 猫的画像里可以积累"这个人通常什么时候活跃"的节奏感知

---

## 1.4 组织对齐与 AI Blame（Org-Level Alignment）⚠️ WIP 但理念领先

### 实现现状

ORG2 的组织对齐还在 WIP，但已有可见的骨架：
- **KanbanBoard**（`src/features/KanbanBoard/`）+ **TaskImpactLine** 组件——把每个任务和它的 **orgtrack 元数据**关联（filesChanged / linesAdded / linesRemoved / relatedCommits / committedRatePercent）
- **TeamCollaboration**（`src/features/TeamCollaboration/`）+ 协作元数据同步
- **Git Blame 集成**（`src/api/http/git/blame.ts` / `src/hooks/git/useGitBlame.ts`）——把代码归属追溯到具体 agent/会话
- **ADE Manager**——一个内置的 **meta-agent**，能 spawn/monitor/coordinate 其他会话，并通过结构化 action system 驱动 UI（不是 computer-use，是 purpose-built UI actions）

### 对「有性格多 agent 囏队」的可借鉴点

**💡 借鉴 6：把"任务 ↔ 影响面 ↔ 责任归属"三者绑定。**
- Clowder 的愿景守护（守护猫≠作者≠reviewer）已经体现了"责任分离"，但没有把责任**可视化到代码行级**
- 借鉴 ORG2：每个 feature/任务关联 orgtrack 元数据（改了哪些文件、几行、关联哪些 commit、提交率），让"哪只猫对哪部分代码负责"可追溯
- **这强化问责**（呼应 Raft 文章 2：名字让 agent 可被问责）——出问题时，git blame 能直接定位到"这段是宪宪在 session X 里改的"

**💡 借鉴 7：考虑一个 meta-agent（ADE Manager）来协调多会话。**
- Clowder 是"扁平的猫群协作"，没有"管理其他会话的会话"
- ORG2 的 ADE Manager 思路：一个 meta-agent 能 spawn/监控/协调其他 session，并驱动 UI
- 谨慎借鉴：Clowder 明确"没有 Boss Agent"（VISION.md），但可以借鉴"meta-agent 做协调/监控/UI 驱动"而非"做决策"——把它定位成**值班管家**而非 boss

---

# 第二部分：从 openteams 可借鉴的能力

openteams 的核心差异化是**执行可控性**：把复杂任务变成可见、可逐步控制的执行图。这是 Clowder 的"对话流协作"完全不具备的结构化能力。

## 2.1 Workflow 引擎 + 步骤级控制（Step-Level Review/Retry）⭐ 最值得借鉴

这是 openteams 最强的能力，也是 Clowder 最大的结构性缺口。

### 实现机制

**五层架构**（`crates/services/src/services/workflow/`）：

```
1. Truth Source (DB) → 2. Compiler → 3. Orchestrator → 4. Reducer/Projector → 5. Frontend
```

**第 1 层 真相源**：`chat_workflow_plans` + `chat_workflow_plan_revisions` 存 React Flow 的 plan JSON（nodes/edges/viewport/loops/policies）。**关键约束：plan JSON 只能由 lead/system 代码路径写，不允许任意用户 JSON 写入。**

**第 2 层 Compiler**（`workflow/compiler/compiler.rs`）：
- 把 plan JSON 的**图**（React Flow nodes+edges）**编译成可执行图**（CompiledGraph）
- 做拓扑排序（`topological_sort`）确定执行顺序
- 节点类型：`task` / `review` / `result`
- 每步有 `step_key`（稳定标识）+ `max_retry` + `interruptible` + `acceptance`（验收标准）+ `assigned_agent_id`
- **自动发现 loops**：从 `reviewScope` 声明中发现循环依赖并回填 `loop_key`

**第 3 层 Orchestrator**（`workflow/orchestrator/`）—— 核心调度：
- `step_executor.rs` —— 步骤执行 + lead review 反馈循环 + protocol message 处理
- `retry_resume.rs` —— 重试/恢复/最终评审不变量（`retry_step()`）
- `plan_control.rs` —— 计划控制（运行中调整）
- 检测 **active frontier workspace conflicts**（多个运行中步骤争抢同一 workspace）

**第 4 层 Reducer**（`workflow/orchestrator/reducer.rs`）—— **唯一合法的状态写入者**：
- 所有 workflow 状态变更必须经过 reducer（transition validation + audit-event emission）
- 用 `TransitionError` 防止非法迁移：`IllegalExecutionTransition` / `IllegalStepTransition` / `StaleTransition`（乐观锁，防并发）
- 每次有意义的状态转换都产生一条 typed `chat_workflow_events` 行（审计）

**WorkflowStep 的丰富状态机**（13 态）——这是步骤级控制的根基：
```
pending → ready → running → pre_completed
                  ↓
         waiting_input | waiting_review | blocked | revising
                  ↓
         completed | failed | skipped | interrupted | interrupt_requested
```

配合 `WorkflowExecutionStatus`（7态）、`WorkflowRoundStatus`（5态）、`WorkflowLoopStatus`（8态）。

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 8：给复杂任务加一个"执行图"模式，与"自由对话"模式并列。**
- Clowder 现在只有对话流（A2A @mention），复杂任务（多阶段、有依赖）只能在对话里线性推进，**失败要整体重来**
- 借鉴 openteams 的双模式：**Free Chat（轻量 @协作）+ Workflow（结构化执行图）**
- 这正是 openteams 自己的定位："像 Claude Code 的 Plan/Build 模式，但是给多 agent 团队用的"

**💡 借鉴 9：步骤级 retry 是革命性的可控性。**
- openteams 的杀手锏：`Integration Tests` 失败了，**只重试那一步**，其余工作流不动
- 对比 Clowder：现在 review 失败要重开整个会话/feature
- 借鉴：把每个猫承担的子任务变成**可独立 retry 的步骤节点**，状态机管理（pending→running→waiting_review→completed/failed）

**💡 借鉴 10：Reducer 单一写入者 + 审计事件流。**
- openteams 强制所有 workflow 状态变更走 reducer + 每次转换发 typed event
- 这和 Clowder 的 ownership cell 哲学一致（防止状态变更散落），但 openteams 在**执行态**上做得更彻底
- 借鉴：给"任务执行"引入 reducer 模式 + 事件溯源，让执行过程可观测、可审计（和 ORG2 的 trajectory 互补）

---

## 2.2 Lead-Agent 规划（Planning Phase）⭐

### 实现机制

- Lead agent 驱动**规划阶段**：澄清需求 → 设计方案 → 定义执行计划 → 分配任务给合适的 agent
- 产出是**可见的 workflow**（React Flow 图），带步骤/依赖/审查点/重试/验收
- 用户可在**运行前** refine/reorder/reassign
- `build_step_execution_prompt_with_schema` / `build_lead_review_prompt_with_schema` / `build_step_revision_prompt_with_schema` —— 结构化的 prompt 模板
- `parse_review_protocol_output` —— lead agent 的 review 输出有**协议化的 JSON schema**解析（带重试：`WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES`）

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 11：让"架构师猫"担任 lead，产出可审批的执行计划图。**
- Clowder 已有 `opus`（lead=true, architect 角色）和 SOP 的 Design Gate，但计划是**文本形态**，没有可视化的依赖图
- 借鉴：lead 猫把 feature 分解成**带依赖的步骤图**（哪些可并行、哪些串行、review 点在哪），CVO 在运行前审批
- 这把 Clowder 的"愿景守护"从"事后检查"升级为"事前可控规划"
- 关键：lead agent 只能 summarize/review，**最终验收必须是用户决策**（openteams 明确的不变量：`Final acceptance is a user decision`）——这和 Clowder 的 CVO 理念一致

---

## 2.3 Session Worktree 隔离（Per-Session Git Isolation）⭐

### 实现机制

这是 openteams 解决"多 agent 改同一批文件冲突"的方案，非常工程化：

- `ChatSession.worktree_mode`：`inherit | disabled | isolated`（opt-in）
- 每个会话可选**独立的 git worktree**，agent 的改动可单独 merge/discard/cleanup
- **严格的状态机**（9态）：`creating → active → dirty → merging → needs_conflict_resolution → merged → cleanup_pending → cleanup_failed → archived`
- **SessionWorktreeService 是唯一 reducer**，compare-and-swap 写入（`WHERE id = ? AND status = ?`，防竞态）
- wire 值必须 snake_case，禁止 `format!("{:?}", status).to_lowercase()`
- 自动 cleanup **不能删除未 merge 的 worktree**

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 12：多猫并行改代码时，用 worktree 隔离避免互相踩踏。**
- Clowder 现在的 A2A 协作里，如果宪宪在改分支 A，砚砚同时开始改同一批文件 → 合并冲突/代码丢失（这正是 ORG2 at-mention 文档里"退"要解决的场景之一）
- 借鉴 openteams：**每个猫（或每个子任务）一个隔离 worktree**，改动独立，最后再 merge
- Clowder 已有 `worktree` skill，但可以深化为**自动化的、状态机驱动的**隔离机制（不只是手动开 worktree）
- 这是让多 agent 团队**真正能并行干活**（而不只是接力）的工程基础

---

## 2.4 共享上下文 + 团队协议（Shared Context + Team Protocol）⭐

### 实现机制

- **共享上下文**：同一 session 内所有 agent 共享一个 context（`.openteams/context/<session_id>/messages.jsonl`），不用反复重述
- **ChatMessageQueue**：排队成员工作，处理 continuation/backpressure（背压）——agent 忙时排队
- **team_protocol 字段**（在 ChatSession 上）：定义谁做什么、怎么交接、遵循什么标准
- **protocol_messages**（`chat_runner/protocol_messages.rs`）：agent 间结构化协议消息
- **ChatRun**：每次执行有 run index / run dir / log / output / token-model 元数据 / **file-change capture**

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 13：引入显式的 team_protocol 定义 + 消息队列背压。**
- Clowder 的协作纪律现在主要靠 SOP YAML（流程层）+ skills（提示词层），但**没有运行时的消息队列/背压**
- 借鉴：
  - 给每只猫的消息队列（ChatMessageQueue 模式）——agent 忙时新任务排队，避免乒乓（Clowder 有乒乓检测但没队列）
  - team_protocol 作为一等配置（团队定义"谁做什么、怎么交接"），而非散在 skill 里
- ChatRun 的 **file-change capture** 值得借鉴：每次 agent 运行自动捕获改了哪些文件——和 ORG2 的 orgtrack details 层互补

---

## 2.5 双模式切换（Free Chat ↔ Workflow）

openteams 明确区分两种模式，因为"不是每个任务都需要同样的结构"：

| 模式 | 适用 | 形态 |
|------|------|------|
| **Free Chat** | 小修、快速 review、探索性讨论 | `@` 轻量协作，agent 自由传消息 |
| **Workflow** | 需要拆解、可观测进度、可控执行 | 有状态执行图，步骤/依赖/审查/重试 |

### 对「有性格多 agent 团队」的可借鉴点

**💡 借鉴 14：明确"轻量协作"和"结构化工作流"的分界。**
- 这对 Clowder 尤其重要：猫群的"性格化协作"很适合 Free Chat（聊天、陪伴、小修），但**严肃的 feature 开发需要 Workflow 的可控性**
- 不要强求所有任务都走重流程（Clowder 的 SOP 已经有"trivial 跳过 Design Gate"的例外路径，理念一致）
- 关键：**让模式可切换，且性格在两种模式下都保持**（这是 Clowder 相对 openteams 的优势——openteams 的 agent 没性格，你的猫在 workflow 里也该有性格）

---

# 第三部分：能力缺口矩阵与落地优先级

把"可借鉴点"按 **对『有性格多 agent 团队』的价值 × 实现成本** 排优先级：

| # | 可借鉴能力 | 来源 | 价值 | 成本 | 优先级 | 理由 |
|---|-----------|------|------|------|--------|------|
| 8 | **执行图模式（Workflow）** | openteams | 🔴极高 | 🔴高 | **P0** | 补 Clowder 最大结构性缺口；复杂任务可控 |
| 9 | **步骤级 retry** | openteams | 🔴极高 | 🟡中 | **P0** | Workflow 的核心价值，retry_step 已有参考实现 |
| 1 | **执行轨迹可回放** | ORG2 | 🟡高 | 🔴高 | **P1** | 强化互审深度，但工程量大；可先做 trajectory 事件记录 |
| 12 | **Worktree 隔离** | openteams | 🟡高 | 🟡中 | **P1** | 让多猫能真正并行；Clowder 已有 worktree skill 可深化 |
| 4 | **在场感知（presence）** | ORG2 | 🟡高 | 🟢低 | **P1** | CVO 状态切换协作模式；可复用 Clowder 的 Approval Index |
| 11 | **Lead-agent 规划图** | openteams | 🟡高 | 🟡中 | **P1** | opus 当 lead 产可视化计划；和 Workflow（#8）配套 |
| 6 | **任务↔影响面↔归属绑定** | ORG2 | 🟡中 | 🟡中 | **P2** | 强化问责；需和 orgtrack 元数据绑定 |
| 10 | **Reducer 单写者+事件溯源** | openteams | 🟡中 | 🟡中 | **P2** | 执行态可观测/可审计；和 ownership cell 一致 |
| 3 | **工作摘要（turn summary）** | ORG2 | 🟡中 | 🟢低 | **P2** | 提升 AX；每只猫输出加结构化摘要 |
| 13 | **消息队列背压** | openteams | 🟢中 | 🟡中 | **P2** | 防乒乓升级版；Clowder 有乒乓检测可演进 |
| 7 | **Meta-agent 协调** | ORG2 | 🟢中 | 🔴高 | **P3** | 谨慎；Clowder 明确"无 Boss"，定位为管家非决策者 |
| 2 | **三层 tier 记录模型** | ORG2 | 🟢中 | 🟢低 | **P3** | 设计参考，配合 #1 用 |
| 5 | **focus 事件记录** | ORG2 | 🟢低 | 🟢低 | **P3** | 配合 #4 presence 用 |

**建议的三阶段路线**：
- **Phase 1（P0，最大杠杆）**：引入 Workflow 执行图模式 + 步骤级 retry（#8、#9）——补可控性缺口
- **Phase 2（P1）**：Worktree 隔离 + 在场感知 + Lead 规划图（#12、#4、#11）——让团队真正并行且人机节奏对齐
- **Phase 3（P2）**：轨迹回放 + 归属绑定 + Reducer 审计（#1、#6、#10）——补可审计性

---

# 第四部分：建议的技术融合路线

## 4.1 融合后的理想形态

一个「有性格 + 可控 + 可审计」的多 agent 团队：

```
                    ┌─────────────────────────────────────┐
                    │   CVO（人）+ presence 状态           │  ← ORG2 #4
                    │   available / focus / away          │
                    └────────────────┬────────────────────┘
                                     │
           ┌─────────────────────────┼──────────────────────────┐
           ▼                         ▼                          ▼
   ┌───────────────┐        ┌────────────────┐        ┌──────────────────┐
   │  身份层(Cloud) │        │ 协作层(Cloud)   │        │  执行层(新增)     │
   │  四层人格模型  │        │  A2A @mention  │        │  Workflow 执行图  │  ← openteams #8
   │  anti-compress│        │  接/退/升       │        │  步骤级 retry    │  ← openteams #9
   │  跨模型互审    │        │  SOP 纪律      │        │  Lead 规划图     │  ← openteams #11
   └───────────────┘        │  worktree 隔离  │        │  Reducer 单写者  │  ← openteams #10
                            └────────────────┘        └────────┬─────────┘
                                                               │
                                                    ┌──────────▼───────────┐
                                                    │  审计层(新增)         │
                                                    │  trajectory 事件流   │  ← ORG2 #1
                                                    │  三层 tier 模型      │  ← ORG2 #2
                                                    │  任务↔影响↔归属      │  ← ORG2 #6
                                                    │  可回放 Simulator    │  ← ORG2 #1
                                                    └──────────────────────┘
```

## 4.2 关键设计决策（融合时的取舍）

1. **性格必须在所有层保持**（Clowder 相对其他两者的最大优势）：
   - Workflow 执行图里的每个步骤节点，仍由"有名字、有性格的猫"承担，不是匿名 worker
   - 轨迹回放里能看到"宪宪当时是怎么想的"（性格 + 推理），不只是"哪个 tool 被调了"

2. **双模式保留 Clowder 的对话优势**：
   - Free Chat 模式 = Clowder 现有的 A2A 对话（性格化、陪伴、小修）
   - Workflow 模式 = openteams 的执行图（结构化、可控），但**节点仍是猫**
   - 模式切换不丢上下文（共享 session context，借鉴 openteams 的 messages.jsonl）

3. **可审计性叠加，不替换协作**：
   - trajectory 是**旁路记录**（不影响对话流），只在审查/交接/回放时展开
   - 这和 Clowder 的"记忆是 pull-mode"哲学一致：轨迹也是 pull-mode（按需检索回放）

4. **presence 影响路由，但不破坏"机械路由+智能代理"原则**：
   - CVO presence 状态作为**上下文字段**注入（像 directMessageFrom 那样），让猫的第 6 层判断自己决定是否升级给人
   - **不要**在路由层硬编码"away 时禁止 @人"——保持 Clowder 的机械路由哲学

## 4.3 风险与注意事项

- **Workflow 引入复杂度高**：openteams 的 workflow 有 13 态步骤状态机 + reducer + 事件溯源，是重型工程。建议先实现**最小可用**版本（task/review 两类节点 + pending/running/waiting_review/completed/failed 五态 + retry），再迭代
- **避免"无 Boss"原则被破坏**：lead-agent 只做规划和 summarize，不做最终决策（openteams 的 `Final acceptance is a user decision` 不变量必须保留）
- **轨迹记录的隐私/成本**：借鉴 ORG2 的三层 tier，默认只记 meta，details/trajectory 按需——不要全量记录烧存储
- **worktree 在 Windows 上的坑**：openteams 的 AGENTS.md 特别提到 PowerShell 下 `pnpm run dev` 不能跑，worktree 操作要测跨平台

---

## 附录：关键代码锚点速查

### ORG2
| 能力 | 锚点 |
|------|------|
| 三层遥测模型 | `packages/orgtrack/src/index.ts`（OrgtrackTier / ActivityKind / ActivityRecord） |
| 轨迹标准化（Rust） | SessionCore 的 `es_process_chunks` Tauri IPC |
| 可视化回放 | `src/engines/Simulator/`（findIndexAtTime / eventSegments / app-type routing） |
| livestream/replay | `src/engines/SessionCore/`（sync/ + hooks/replay/） |
| 组织对齐 | `src/features/KanbanBoard/`（TaskImpactLine + orgtrackMetadata） |
| AI blame | `src/api/http/git/blame.ts` / `src/hooks/git/useGitBlame.ts` |
| 设计哲学 | `docs/contributing/DESIGN_PHILOSOPHY.md` |

### openteams
| 能力 | 锚点 |
|------|------|
| Workflow 五层架构 | `crates/services/src/services/workflow/`（compiler/orchestrator/runtime/loop_executor/iteration） |
| 步骤状态机 | `crates/db/src/models/workflow_types.rs`（13 态 WorkflowStepStatus） |
| Reducer 单写者 | `crates/services/src/services/workflow/orchestrator/reducer.rs` |
| 步骤级 retry | `crates/services/src/services/workflow/orchestrator/retry_resume.rs`（`retry_step()`） |
| Compiler 图编译 | `crates/services/src/services/workflow/compiler/compiler.rs`（topological_sort + discover_loops） |
| Worktree 隔离 | `crates/services/src/services/session_worktree.rs`（9 态状态机 + CAS 写入） |
| 共享上下文 | `.openteams/context/<session_id>/messages.jsonl` |
| 团队协议 | `crates/services/src/services/chat_runner/protocol*.rs` |
| 架构总览 | `AGENTS.md`（极完整的架构文档） |

---

*本文档基于对 ORG2（orgtrack/Simulator/SessionCore/DESIGN_PHILOSOPHY）和 openteams（workflow 五层架构/AGENTS.md）的深度源码与文档阅读整理而成，与 `clowder-ai-analysis.md` 配套使用。*
