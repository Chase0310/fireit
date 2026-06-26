# 打造「有性格的多 Agent 团队」— 项目调研与设计总报告

> **项目目标**：打造一个有身份性格、能跨模型互审、像真实团队（有性格 + 可控 + 可审计）的多 agent 协作系统。
>
> **底座选择**：以 **Clowder AI + Raft 理念**为身份/协作底座，吸收 **ORG2** 的可审计性和 **openteams** 的执行可控性（但拒绝其层级式编排）。
>
> 本报告是整套调研与设计的**入口枢纽**：导航 + 执行摘要 + 决策日志。详细内容在四份子文档中（单一真相源，不重复）。

---

## 0. 文档地图（怎么读）

| # | 文档 | 性质 | 一句话 |
|---|------|------|--------|
| **00** | **`00-总报告.md`（本文）** | 导航 + 摘要 + 决策 | 从这里开始 |
| 01 | `clowder-ai-analysis.md` | 实现剖析 + 文章摘要 | Clowder AI 怎么实现的 + Raft 五篇文章内容摘要 |
| 02 | `org2-openteams-learnings.md` | 竞品借鉴 | 从 ORG2 / openteams 各学什么 |
| 03 | `fpp-design-spec.md` | 设计方案 | 无 Boss 的 Feature 推进图（核心新设计） |
| 04 | `raft-design-philosophy.md` | **设计哲学沉淀** | Raft 式 agent 团队的 5 条哲学（对比式） |

**推荐阅读顺序**：
- 想快速了解全貌 → 读本文 §1-§3
- 想理解底座 → 读 01
- 想知道借鉴了什么 → 读 02
- 要动手实现 → 读 03（§3 数据模型 + §9 落地路线）
- **想理解"为什么这么设计"→ 读 04（设计哲学，是所有决策的理论根基）**

**阅读路径图**：

```
        本文（00）
       ╱  户型图   ╲
      ╱             ╲
   01 底座        03 设计
   （Clowder）    （FPP，核心）
      │  ╲           ▲
   文章摘要 哲学沉淀  │ 受约束
      │    ╲         │
      ▼     ▼        │
   04 设计哲学 ───────┘
  （Raft 5条哲学）
        │
        │ 借鉴
        ▼
      02 竞品
   （ORG2/openteams）
```

---

## 1. 定位对照：四个项目各擅长什么

一句话先抓住本质（避免重复造轮子）：

| 项目 | 核心隐喻 | 最强能力 |
|------|---------|---------|
| **Clowder AI**（底座） | 猫群团队 | 持久身份性格、A2A `@mention`、跨模型互审、SOP 纪律 |
| **Raft**（理念参考） | 持续在场队友 | 名字/身份、room-aware posture、AX 设计 |
| **ORG2**（借鉴可审计性） | 可审计的组织 | 执行轨迹可回放、agent 可读性、资源/在场感知、组织对齐 |
| **openteams**（借鉴可控性，拒编排） | 可视工作流图 | 步骤级 review/retry、执行图可视化、worktree 隔离 |

**核心结论**：四者**高度互补**。
- Clowder 解决了"agent 是谁、怎么协作"（身份 + A2A + 互审）
- ORG2 补"可审计性/可读性"（轨迹回放、agent 可读）
- openteams 补"执行可控性"（粒度 retry、执行图），**但它的解法（top-down orchestration）不适合 peer 团队，只借其正交副产品**

---

## 2. Clowder 底座：实现要点（详见 01）

### 2.1 三层架构
> *"Models set the ceiling. The platform sets the floor."*

| Layer | 负责 | 不负责 |
|-------|------|--------|
| Model | 推理/生成/理解 | 长期记忆、纪律 |
| Agent CLI | 工具调用/文件操作/命令 | 团队协调、review |
| Platform (Clowder) | 身份/协作/纪律/审计 | 推理 |

### 2.2 六大核心机制

| 机制 | 实现 | 代码锚点 |
|------|------|---------|
| **持久身份（Anti-Compression）** | 四层人格模型（breed/instance/user/relationship）+ L0 编译时注入（每次调用注入，抗压缩） | `cat-template.json`, `compile-system-prompt-l0.mjs`, `SystemPromptBuilder.ts` |
| **A2A `@mention` 路由** | 六层流水线（前 5 层机械 + 第 6 层 LLM「接/退/升」涌现行为）| `a2a-mentions.ts`, `AgentRouter.ts`, `ContextAssembler.ts` |
| **跨模型互审** | SOP 铁律（reviewer≠author）+ 六维画像配对（跨 family 优先） | `sop-definitions/development.yaml`, `docs/team/cat-dossier.md` |
| **共享记忆/证据** | `IEvidenceStore` + pull-mode 检索（与 push-mode 身份胶囊分离） | `domains/memory/*` |
| **SOP 守护** | 机器可校验 YAML（predicate：git_state/command_pattern/handle_check） | `sop-definitions/development.yaml` |
| **Skills + MCP Bridge** | 50+ 按需 skill + callback bridge（非 Claude 模型拿 MCP） | `cat-cafe-skills/`, `packages/mcp-server/` |

### 2.3 一个关键澄清：Clowder 的"主理人"是岗位不是 boss

Clowder 进入会话有"选主理人"（concierge / duty cat），但：
- 源码明确定义 **"岗位，不是 agent 等级"**
- `resolveDefaultDutyCatProfileId()` 是**配置解析**，不是选举
- 核心能力是 **relay（转接）**，不是指挥
- **精确哲学：有牵头的人，没有发号施令的 boss**

> 这一发现成为 FPP「ADR-FPP-6: 牵头 ≠ 统治」的事实锚点。

---

## 2b. 设计哲学根基（详见 04）

整个项目的所有设计决策（底座选型、FPP、借鉴取舍）都受 **Raft 式 agent 团队的 5 条设计哲学**约束。每条哲学是一组**观念转变**（不是文章摘要）：

| 哲学 | 旧思维 → Raft 式新思维 | 约束了什么 |
|------|----------------------|-----------|
| **一·身份** | agent 是「调用」→ agent 是「持续身份」 | 身份必须 push-mode 抗压缩（Clowder 底座成立） |
| **二·名字** | 名字是 UI 装饰 → 名字是「路由+历史+信任」三合一基础设施 | 拒绝把 agent 降格为匿名 worker（否决 openteams lead） |
| **三·克制** | chaos→减少 agent → chaos→给 agent 克制能力 | 沉默是一等协作行为（FPP 的 blocked 是克制） |
| **四·纪律** | 纪律=控制 → 纪律=地平线（Hard Rails + Soft Power） | FPP 设护栏不调度，retry 是事件不是控制 |
| **五·AX** | 只管 UX → UX 之外还有 AX（Agent Experience） | 事件 payload 要带 next action（五件套交接） |

**一句话内核**：
> 把 agent 当"持续在场的、有名字的、懂得克制的队友"，用纪律护栏（而非中心化控制）托住底线，用地平线之上的自主空间释放协作涌现——并为"agent 作为用户"专门设计交互（AX）。

这 5 条哲学是**评审一切设计的标尺**：任何新设计如果违反其中某条，要么改设计，要么论证为什么可以例外。

---

## 3. 借鉴要点（详见 02）

### 3.1 从 ORG2 借鉴（可审计性）

| 能力 | 价值 | 借鉴方式 |
|------|------|---------|
| **执行轨迹可回放** ⭐ | 互审时能回放作者猫的推理过程 | 三层 tier 模型（meta/details/trajectory）旁路记录 |
| **Agent 可读性** | 工作像 PR 一样可读 | 每只猫输出加结构化"工作摘要" |
| **资源/在场感知** ⭐ | CVO 状态切换协作模式 | presence 作为上下文字段注入（不破坏机械路由） |
| **组织对齐 + AI blame** | 任务↔影响面↔归属绑定 | git blame 追溯到具体猫/session |

### 3.2 从 openteams 借鉴（可控性，只借正交部分）

| 能力 | 借不借 | 理由 |
|------|--------|------|
| **步骤级 retry** ⭐ | ✅ 借 | 和协调模型正交，最有价值的可控性 |
| **执行图可见性** | ✅ 借（但用 peer 兼容方式） | 见 FPP 设计 |
| **Lead-agent 规划** | ⚠️ 改造 | lead 只能"提议"计划，不能"分派" |
| **Worktree 隔离** | ✅ 借 | 多猫并行改代码不踩踏 |
| **完整 top-down Workflow** | ❌ 不借 | 和"无 Boss"相悖 |

### 3.3 关键判断：Workflow 执行图 ≠ 多 agent 协作的对立面

这是调研中最重要的一个修正。**相悖的不是"执行图"本身，而是"Boss"**——openteams 把执行图和 Boss 绑死了，所以看起来冲突。一个顶层有状态的执行图，完全可以没有一个 Boss 拥有它。

→ 这个判断催生了 FPP 设计。

---

## 4. 核心设计：Feature Progress Graph（FPP）（详见 03）

### 4.1 一句话

> 把 Clowder 的 ball-custody（球权引擎）事件溯源架构，从"单球责任追踪"上移一层，做成"feature 进度图"——**顶层、有状态、推进 feature，但没有 Boss**。它是共享协调黑板，不是控制台。

### 4.2 六条设计原则（ADR）

| ADR | 原则 | 核心 |
|-----|------|------|
| **FPP-1** | 曲式，不是指挥 | 图是共享黑板，无唯一写入权、无分派 |
| **FPP-2** | 复用 ball-custody，不另起炉灶 | 照搬事件流/投影/纯函数状态机 |
| **FPP-3** | 图不 assign，进度是事件驱动 | 前 phase done → 后 phase ready → 猫自选接 |
| **FPP-4** | retry 是事件，不是控制 | 重置球状态，不夺走自主权 |
| **FPP-5** | 变更权分层 | 自由 append 为主 + 高风险转移需 approve（验收必须 CVO） |
| **FPP-6** | 牵头 ≠ 统治 | `phase.entered` 的 `by` 是事实记录，不授予指挥权（来自 duty cat 先例） |

### 4.3 数据模型骨架（照 ball-custody 同构）

```
FeatProgressEvent（append-only 唯一真相）
    ↓ 纯函数 transition()
FeatProgressProjection（可重建投影）
```

- **8 种事件**：`feat.kickoff / phase.entered / phase.completed / phase.blocked / phase.unblocked / phase.retried / phase.skipped / feat.accepted`
- **6 phase**（从 SOP 派生）：`design_gate → impl → quality_gate → review → merge → vision_guard`
- **状态机**：表驱动纯函数，零副作用（rebuild 安全），穷举测试钉死

### 4.4 三条保留"有性格"的设计

1. 节点仍是猫——`phase.entered` 的 `by` 是 catId，进度图能看到"design_gate 是宪宪做的、review 是砚砚审的"
2. retry 带 reason——"砚砚 review 指出竞态，所以 impl retry"，保留协作上下文
3. vision_guard 不可跳过——保住"愿景守护猫≠作者≠reviewer"的质量纪律

### 4.5 三个开放问题的决策（已拍板）

| OQ | 问题 | 决策 | 理由 |
|----|------|------|------|
| **OQ-1** | phase 依赖支持并行？ | **线性** | 先上线线性版；并行用 phaseBalls 多球表达 |
| **OQ-2** | 要不要 best-effort 唤醒？ | **不做** | 进度是猫推的，不是系统催的 |
| **OQ-3** | thread 能否挂多 feature？ | **解耦** | phaseBalls 关联多 thread |

---

## 5. 决策日志（关键转折点）

按时间顺序记录调研中的关键判断转折，便于回溯"为什么这么决定"：

| # | 决策 | 转折点 | 影响文档 |
|---|------|--------|---------|
| D1 | 选 Clowder 为底座 | 用户明确要"有性格、跨模型互审、像真实团队" | 全部 |
| D2 | ORG2/openteams 各有可学 | 三个项目都涉及 multi-agent 但定位不同 | 02 |
| D3 | **修正：Workflow 不是 P0** | 用户质疑"Workflow 是否和 multi-agent 相悖"——发现相悖的是 Boss 不是执行图 | 02, 03 |
| D4 | **顶层执行图可以无 Boss** | 用户追问"有没有可能有顶层有状态执行图"——区分了执行图(数据结构)与 Boss(智能体) | 03 |
| D5 | **复用 ball-custody** | 发现 Clowder 已有事件溯源的"种子"，FPP 是上移而非新建 | 03 §1.1, §3 |
| D6 | **牵头 ≠ 统治** | 用户发现 Clowder 有"选主理人"——核实源码确认是岗位不是 boss，成为 FPP-6 依据 | 03 §1.1③, ADR-FPP-6 |
| D7 | OQ-1/2/3 拍板 | 用户授权"按你的理解来" | 03 §8 |
| D8 | **沉淀 Raft 设计哲学** | 用户指出"博客的设计哲学你没有沉淀"——区分了"文章摘要"与"哲学沉淀"，提炼成 5 条对比式哲学作为所有决策的理论根基 | 04 |

---

## 6. 能力缺口矩阵（落地优先级）

把所有可借鉴能力按 **价值 × 成本** 排序，FPP 是当前最高优先级：

| 能力 | 来源 | 价值 | 成本 | 优先级 | 落地形态 |
|------|------|------|------|--------|---------|
| **FPP（feature 推进图 + 粒度 retry）** | openteams（改造）| 🔴极高 | 🟡中 | **P0** | `fpp-design-spec.md` 已设计 |
| 执行轨迹可回放 | ORG2 | 🟡高 | 🔴高 | P1 | 先做 trajectory 事件记录 |
| Worktree 隔离 | openteams | 🟡高 | 🟡中 | P1 | 深化现有 worktree skill |
| 在场感知 presence | ORG2 | 🟡高 | 🟢低 | P1 | 复用 Approval Index |
| 任务↔归属绑定 | ORG2 | 🟡中 | 🟡中 | P2 | orgtrack 元数据绑定 |
| 工作摘要 turn summary | ORG2 | 🟡中 | 🟢低 | P2 | 每只猫输出加摘要 |

---

## 7. 落地路线（FPP 的 5 个 Phase）

照 Clowder 自己的 SOP 风格拆分（详见 `fpp-design-spec.md` §9）：

| Phase | 内容 | 验收 |
|-------|------|------|
| **P0 骨架** | shared types + 状态机 + projector + 内存 store + 穷举测试 | INV-FPP-1/2 全绿 |
| **P1 事件接线** | FeatProgressIngest + Redis 持久化 + kickoff/entered/completed | feature 能 kickoff→accepted |
| **P2 retry** | phase.retried + retryCount + 球重新放出 | 步骤级 retry 可用 |
| **P3 可见性** | 前端 phase 卡片流 + blocked 聚合 | CVO 能在 Hub 看进度图 |
| **P4 高风险守门** | phase.skipped approve + feat.accepted CVO 校验 | INV-FPP-8 测试过 |

---

## 8. 一页纸总结

**要做什么**：在 Clowder 的"有性格猫群"底座上，加一层**无 Boss 的 Feature 推进图（FPP）**，让复杂任务变得可见、可粒度重试，但不引入层级式编排。

**怎么做**：复用 Clowder 已有的 ball-custody 事件溯源架构（不另起炉灶），把 subjectKey 从单球上移到 feature，节点只描述工作不 assign，retry/推进都是事件而非控制。

**核心哲学**：
> **爵士乐的曲式，不是交响乐的指挥。** 顶层共享结构图让即兴不变噪音，但曲式不规定每个音符、没有任何人是指挥。FPP 是曲式，不是指挥。
>
> **无 Boss ≠ 无牵头。** 有牵头的人（duty cat / phase 主理人），没有发号施令的 boss——这是 Clowder 用 duty cat 已验证过的模式。

**一句话**：你要的是"可控的自主"，不是"被编排的服从"。

---

*本总报告整合自 `clowder-ai-analysis.md`、`org2-openteams-learnings.md`、`fpp-design-spec.md` 三份子文档。子文档是单一真相源，本报告做导航与决策回溯。*
