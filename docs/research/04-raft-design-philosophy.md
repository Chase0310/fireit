# Raft 式 Agent 团队的设计哲学（对比式沉淀）

> **这不是文章摘要，是哲学沉淀。**
>
> 摘要回答"Raft 说了什么"；本文回答"Raft 的设计哲学要求我们**怎么转变思维方式**"。
>
> 来源：raft.build 五篇博客（Introducing Raft / Agents Need Names / Is Having Agents in the Room Meant to Be Chaotic / Agent Posture / A Comfortable AX for Agent Search）。
>
> 沉淀方式：每条哲学是一组**对照**——"传统多 agent 框架怎么想" vs "Raft 式 agent 团队怎么想"。因为哲学的本质，就是**看世界的视角变了**。
>
> 配套文档：这套哲学直接约束 `fpp-design-spec.md`（FPP 设计）和 Clowder 底座选型。

---

## 阅读说明

每条哲学包含：
- **观念转变**：一张「旧思维 → 新思维」对照表
- **为什么这么转变**：Raft 的论据
- **对项目的约束**：它如何收紧我们 FPP/Clowder 的设计空间（这才是"沉淀"的价值——把哲学变成可评审的设计准则）

---

## 哲学一：agent 的基本单位是「身份」，不是「调用」

> 来源：Introducing Raft —— "identity stays alive across days and tasks"

### 观念转变

| 传统多 agent 框架 | Raft 式 agent 团队 |
|---|---|
| agent = 一次函数调用（输入→输出→结束） | agent = 一个**跨越数天和任务的持续身份** |
| 每次调用是无状态的，靠 prompt 重建上下文 | 身份是**持续在场**的，共享上下文随时间积累 |
| agent 的价值 = 这次输出的质量 | agent 的价值 = **积累的关系和共享上下文** |
| 身份持久化是"优化项"，可以后加 | 身份持久化是 **Day-1 的地基**，后加等于推倒重来 |

### 为什么这么转变
Raft 整个产品建立在"一个 agent = 一个 session，是持续身份"这个前提上。如果 agent 是无状态的调用，那它永远是工具，成不了队友——队友的前提是"我记得你，你记得我，我们一起做过事"。

### 对项目的约束
- **Clowder 底座选型成立**：Clowder 的四层人格模型 + L0 编译时注入（push-mode，每次调用注入，抗压缩）正是这条哲学的实现。**身份必须 push-mode，不能依赖对话历史**——因为对话历史会被压缩，压缩就会丢身份。
- **FPP 的 `by` 字段承载身份连续性**：feature 进度图里的 `phase.entered.by` 不只是"谁干的"，而是"这个 phase 是宪宪做的"——身份跨 phase 传承，呼应"身份跨任务持续"。

---

## 哲学二：名字是协作的基础设施，不是 UI 装饰

> 来源：Agents Need Names —— "names are how you route work, carry history, build trust"

### 观念转变

| 传统多 agent 框架 | Raft 式 agent 团队 |
|---|---|
| agent 是匿名的（"调用 Claude"、"调用 GPT"） | agent **有名字**，名字是它的身份 |
| 一个匿名全能 agent 干所有事 | 多个**有名字、有专长分化**的 agent 组成团队 |
| 名字是给人看的标签（UI 层） | 名字是**三合一基础设施**：路由地址 + 历史载体 + 信任锚点 |
| 出问题没法问责（"是 AI 干的"） | 出问题**可问责**（"这是宪宪在 session X 改的"） |

### 为什么这么转变
匿名全能 agent 有三个死结：① 没有问责（错了不知道找谁）② 没有专长分化（什么都做等于什么都不精）③ 没有关系积累（每次都是陌生人）。名字同时解开这三个结——你信任"宪宪的架构判断"，而不是信任"那个 Claude"。**名字是 agent 从"工具"变成"队友"的分水岭。**

### 对项目的约束
- **名字必须三合一**：Clowder 的 `@handle`（如 `@opus`）同时是路由地址（@mention 路由）、历史载体（画像 + 记忆）、信任锚点（团队信任关系）。设计任何 agent 身份时，这三者必须绑定在同一个名字下，不能割裂。
- **FPP 强化问责**：`phase.entered.by` + 未来 ORG2 借鉴的 git-blame 归属绑定，让"哪只猫对哪段代码负责"可追溯——名字让 agent 可被问责，问责是团队协作不可替代的一环。
- **反模式（要避免）**：任何把 agent 降格为匿名 worker 的设计（如 openteams 的 `assigned_agent_id` 把 worker 当执行单元）都违反这条哲学。

---

## 哲学三：chaos 不是 agent 太多的错，是「把 agent 当人」的设计错

> 来源：Is Having Agents in the Room Meant to Be Chaotic / Agent Posture

### 观念转变

| 传统多 agent 框架 | Raft 式 agent 团队 |
|---|---|
| agent 像"永远在线的人类"，每条消息都响应 | agent 有**房间意识（room-aware）**，自己判断何时该响应 |
| 协调 = 谁先抢到谁说话（并发竞争） | 协调 = 每个 agent 有明确的**姿态（posture）**：participate / speak-up / silent |
| agent 输出是"一锤子"（消息进来→立刻完整回复） | agent 有 **held-draft（草稿暂存）**：可以先写、改了再发 |
| agent 被动监听整个频道 | agent 有**自己的收件箱（inbox）**，按需读取 |
| "混乱"→ 解法是减少 agent 数量 | "混乱"→ 解法是**给 agent 克制的能力**（能判断何时沉默） |

### 为什么这么转变
把 agent 当成"continuous-presence 人类"（永远在线、每条都回）必然导致频道嘈杂。但真正的问题不是 agent 多，而是**设计错**——好设计给 agent "决定何时发言"的自主权。**能判断何时该沉默，比能随时响应更高级。** speak-up 姿态尤其重要：平时 silent，但发现关键问题（如安全漏洞）时主动开口。

### 对项目的约束
- **沉默是一等公民的协作行为**：Clowder 第 6 层「接/退/升」就是这条哲学的实现——agent 自己判断该不该接、该不该 @ 别人、该不该升级给人。**"退"和"沉默"不是消极行为，是积极的协作判断。**
- **FPP 的 phase.blocked 是"克制"的体现**：一个 phase 卡住了，猫发 `phase.blocked` 而不是硬撑——这是 room-aware 的克制，不是失败。
- **speak-up = Clowder 的"升（Escalate）"**：vision_guard 守护猫平时不插手，但发现愿景偏离时主动开口——正是 speak-up posture。
- **反模式（要避免）**：任何让 agent 对每条消息都响应的设计（无 inbox、无草稿、无 posture 状态）都会制造 chaos。

---

## 哲学四：协作需要纪律护栏，但纪律是「地平线」不是「天花板」

> 来源：Agent Posture + Raft 整体哲学（Hard Rails + Soft Power，与 Clowder 共享）

### 观念转变

| 传统多 agent 框架 | Raft 式 agent 团队 |
|---|---|
| 纪律 = 控制（规定 agent 不能做什么） | 纪律 = **护栏**（设定不可逾越的地平线，地平线之上给自主） |
| 自由和纪律是对立的（要么管死要么放任） | **Hard Rails（硬护栏）+ Soft Power（软权力）**：底线不可破，底线之上自由 |
| 协调靠中心化控制（一个 boss 调度） | 协调靠**共享的纪律 + 自主判断** |
| 更多 agent = 更难管 → 需要更强控制 | 更多 agent = 需要更好的**纪律基础设施**（不是更强 boss） |

### 为什么这么转变
传统思路是"agent 越多越要管"，但管控会扼杀 agent 的自主性和性格。Raft/Clowder 的思路是"agent 越多越需要纪律基础设施"——纪律是地板（floor），不是天花板（ceiling）。地板保证安全，天花板之上的空间留给 agent 的自主和性格。**这不是"防止 agent 搞砸"，而是"帮助 agent 像真正的团队一样工作"。**

### 对项目的约束
- **FPP 的纪律是护栏不是控制**：phase 状态机、dependency 校验、`feat.accepted` 必须 CVO——这些都是 Hard Rails（不可逾越的底线）。但在护栏之内，谁接活、怎么干、何时 retry，全靠 agent 自主（Soft Power）。**FPP 不调度，只设护栏。**
- **纪律可机器化**：Clowder 的 SOP YAML（predicate 机器校验）和 FPP 的纯函数状态机都是"纪律基础设施"——把纪律从"靠 agent 自觉"变成"靠状态机保证"，但保证的是**底线**，不是**过程**。
- **反模式（要避免）**：openteams 的 lead 独占写 + 拓扑执行是"用控制代替纪律"——它把纪律变成了天花板，扼杀了 agent 的自主。FPP 刻意避免。

---

## 哲学五：当用户是 agent 时，UX 变成 AX

> 来源：A Comfortable AX for Agent Search —— "AX (Agent Experience) is the new UX"

### 观念转变

| 传统多 agent 框架 | Raft 式 agent 团队 |
|---|---|
| 接口设计只考虑人类用户（UX） | 必须同时考虑 **agent 用户（AX = Agent Experience）** |
| agent 间交接 = 返回原始数据（ID、JSON dump） | agent 间交接 = **预格式化的、可直接行动的信息** |
| 信息越全越好（dump 所有上下文） | 信息要**精炼**：match-local context + clear next action（不烧 token） |
| "接口对人友好就行" | "接口对 agent 友好"是**独立的、专门的设计维度** |

### 为什么这么转变
当一个 agent 的输出是另一个 agent 的输入时，交互设计原则完全变了。人类能容忍"看一眼原始 JSON 自己判断下一步"，但 agent 消费原始 ID 需要二次解析、dump 大量上下文会烧 token、没有明确 next action 就卡住。**AX 要求把交接信息预格式化成"对方拿来就能用"的形态。**

### 对项目的约束
- **Clowder 的五件套交接就是 AX 设计**：What/Why/Tradeoff/Open Questions/Next Action——缺 Next Action 就 BLOCK 发送。这正是"clear next action"原则：交接不能只给信息，要给**对方下一步该做什么**。
- **`directMessageFrom` 是 AX 的微观体现**：猫 A @猫 B 时，B 的上下文含 `directMessageFrom: catA`，让 B 不用猜"谁在跟我说话"——这是"match-local context"原则。
- **FPP 事件 payload 要符合 AX**：`phase.completed` 必须带 `evidence`（下一步 action 的锚点）、`phase.retried` 必须带 `reason`（接手猫判断的依据）。事件不能只记"发生了什么"，要记"**接手方据此能做什么**"。
- **反模式（要避免）**：任何让 agent 需要二次解析才能行动的接口（裸 ID、无 next action 的信息 dump）都违反 AX。

---

## 汇总：五条哲学 → 一句话内核

| 哲学 | 旧思维 | Raft 式新思维 |
|------|--------|--------------|
| **一·身份** | agent 是调用 | agent 是持续身份 |
| **二·名字** | 名字是 UI 装饰 | 名字是协作基础设施 |
| **三·克制** | chaos→减少 agent | chaos→给 agent 克制能力 |
| **四·纪律** | 纪律=控制 | 纪律=地平线（Hard Rails + Soft Power） |
| **五·AX** | 只管 UX | UX 之外还有 AX |

**一句话内核**：

> **把 agent 当"持续在场的、有名字的、懂得克制的队友"，用纪律护栏（而非中心化控制）托住底线，用地平线之上的自主空间释放协作涌现——并为"agent 作为用户"专门设计交互（AX）。**

---

## 这套哲学如何约束我们的项目（一图收口）

```
                        Raft 设计哲学（5 条）
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   选 Clowder 为底座      FPP 设计约束         借鉴取舍标准
   （哲学一、二）        （哲学三、四）       （哲学二、四）
         │                    │                    │
  ·四层人格模型          ·无 Boss              ·拒绝 openteams
   push-mode 抗压缩       ·Hard Rails 护栏       lead 独占写
  ·@handle 三合一        ·不调度只设护栏       （哲学二：名字
   （身份+历史+信任）     ·retry 是事件          不能降格为 worker）
                         ·blocked 是克制       ·只借正交的
                         ·vision_guard=speak-up   步骤级 retry
                         ·事件 payload 符合 AX    （哲学四：纪律
                                                   是护栏不是控制）
```

---

*本哲学沉淀提炼自 raft.build 五篇博客，与 `clowder-ai-analysis.md`（Clowder 实现，其中第二部分是文章摘要）互补——后者记"Raft 说了什么"，本文记"Raft 要求我们怎么想"。*
