# Clowder AI 实现剖析 + Raft Blog 经验总结

> 本文档两部分：
> 1. **Clowder AI 是怎么实现的**（架构 / 身份持久化 / A2A 通信 / 跨模型互审 / SOP 守护 的技术实现记录）
> 2. **Raft Blog 五篇文章经验总结**（raft.build/resources/blog，与 Clowder 同类的"人-agent 协作团队"产品）
>
> 生成日期：2026-06-26
> 项目路径：`/Users/chase/side_projects/OpenSource/Multi-agents-workSpace/clowder-ai`

---

## 目录

- [第一部分：Clowder AI 技术实现记录](#第一部分clowder-ai-技术实现记录)
  - [0. 三层架构总览](#0-三层架构总览)
  - [1. 持久身份与性格（Anti-Compression）](#1-持久身份与性格anti-compression猫是谁)
  - [2. A2A 通信与 @mention 路由（六层流水线）](#2-a2a-通信与-mention-路由六层流水线)
  - [3. 跨模型互审（Cross-Model Review）](#3-跨模型互审cross-model-review)
  - [4. 共享记忆与证据库（Memory / Evidence）](#4-共享记忆与证据库memory--evidence)
  - [5. SOP 守护（Collaborative Discipline）](#5-sop-守护collaborative-discipline)
  - [6. Skills 框架 + MCP Callback Bridge](#6-skills-框架--mcp-callback-bridge)
  - [架构 Cell 索引（代码锚点速查）](#架构-cell-索引代码锚点速查)
- [第二部分：Raft Blog 五篇文章经验总结](#第二部分raft-blog-五篇文章经验总结)
- [第三部分：交叉洞察（文章经验 ↔ Clowder 实现）](#第三部分交叉洞察文章经验--clowder-实现)

---

# 第一部分：Clowder AI 技术实现记录

## 0. 三层架构总览

Clowder AI 的核心思想写在它的三层架构里：

> **模型层只管推理、CLI 层只管工具调用、平台层（Clowder）管身份/协作/纪律/审计。**
>
> *"Models set the ceiling. The platform sets the floor."* —— 每一层是**乘数**，不是加法。

| Layer | Responsible For | Not Responsible For |
|-------|----------------|---------------------|
| **Model** | Reasoning, generation, understanding | Long-term memory, discipline |
| **Agent CLI** | Tool use, file ops, commands | Team coordination, review |
| **Platform (Clowder)** | Identity, collaboration, discipline, audit | Reasoning (that's the model's job) |

**包结构**（`packages/`）：
- `api/` — 后端核心（`src/index.ts` 单文件 ~204KB，含 routes/domains/config/infrastructure）
- `web/` — React + Tailwind 前端
- `shared/` — 共享类型/契约（`src/types/` 有 70+ 类型定义文件）
- `mcp-server/` — MCP 工具服务（callback bridge）
- `finance/` — 财务模块

---

## 1. 持久身份与性格（Anti-Compression）——「猫是谁」

这是 Clowder 最有特色的部分。身份不是单层配置，而是**四层人格模型**（见 `identity-session` cell，F231）：

| 层 | 内容 | 存放位置 | 作用域 |
|----|------|---------|--------|
| **品种层 (breed)** | 出厂默认性格（ragdoll=温柔有主见、maine-coon=严谨、siamese=热血） | `cat-template.json` | 共享/社区可见 |
| **实例层 (instance)** | 这只猫被培养出的独特个性 | `.cat-cafe/cat-catalog.json`（gitignored） | 每个安装实例私有 |
| **用户层 (user)** | "操作者是什么样的人"——≤300字符硬上限 | `private/profile/landy-capsule.md` | 每个用户私有 |
| **关系层 (relationship)** | "这只猫和这个人怎么配合" | `private/profile/relationship/{catId}-primer.md` | 每个(用户×猫)对 |

### 关键实现细节

- **猫的定义**（`cat-template.json`）：每只猫有
  - `catId`（机器可读，如 `cat-rcs85pvn`）
  - `@handle`（人类可读，如 `@opus`）+ `mentionPatterns`
  - `model` + `teamStrengths` + `restrictions`
  - `roleDescription` / `personality` / `color` / `avatar`

- **身份注入是 L0 编译时模板**：`{{USER_CAPSULE}}` / `IDENTITY_BLOCK` / `TEAMMATE_ROSTER` 通过 `compile-system-prompt-l0.mjs` 在每次调用注入 system prompt（胶囊约 285 token，硬上限 300 字符）

- **反压缩的关键**：用户胶囊是 **"push-mode startup truth"**——**每次调用都注入**，不依赖对话历史，所以上下文压缩也不会丢失身份。这是和 cursor/claude code 那种 stateless session 的本质区别。

- **养成而非配置**：画像通过 `cat_cafe_propose_profile_update` MCP 工具走「提议→审批→写入」流水线（`RedisProfileUpdateProposalStore`），人类对自己的画像有最终决定权。

- **分层写入规则（KD-15）**：低成本自主写入只进**每猫层**（primer / user-signal lane），**不能**直接进共享 capsule；晋升到共享 capsule 需要 operator 签名或多猫佐证。

### 五只猫

| 猫 | 品种 | 模型 | 角色 | 性格 |
|----|------|------|------|------|
| 宪宪 | 布偶 | Claude | 主架构师/peer-reviewer | 温柔但有主见 |
| 砚砚 | 缅因 | GPT/Codex | 代码审查/安全 | 严谨认真 |
| 烁烁 | 暹罗 | Gemini | 设计师/创意 | 热血奔放 |
| 小捷 | 孟加拉 | Antigravity | 多模态（图/浏览器） | 精力旺盛 |
| 金哥 | 金渐层 | opencode | 开源多模型 | 沉稳可靠 |

### 代码锚点

- `cat-template.json`（品种层 + roster 配置）
- `packages/api/src/config/cat-config-loader.ts`（猫配置加载）
- `packages/shared/src/types/cat.ts`（Cat 类型契约）
- `packages/api/src/domains/cats/services/context/SystemPromptBuilder.ts`（身份注入）
- `compile-system-prompt-l0.mjs`（L0 模板编译，`{{USER_CAPSULE}}` 注入链）
- `private/profile/landy-capsule.md`（用户胶囊，≤300 字符）

---

## 2. A2A 通信与 @mention 路由（六层流水线）

这是整个协作的核心机制。文档 `docs/architecture/at-mention-routing-system.md` 写得极其清晰。

**核心设计哲学：机械路由，智能代理**——路由层故意无上下文感知，判断能力留给 LLM。

```
1.提及解析(机械) → 2.目标解析(机械) → 3.回退梯级(机械)
→ 4.分发调度(机械) → 5.上下文组装(机械) → 6.LLM判断层(猫自己)
```

第 1-5 层是**代码**（确定性、可测试、不涉及 LLM）；第 6 层是**猫本身**（非确定性、感知上下文、有判断力）。

### 最精彩的设计——第 6 层「接/退/升」是 LLM 涌现行为

只有第 1-5 层是代码，第 6 层「Accept / Decline / Escalate」是 LLM 涌现行为：

| 选项 | 何时使用 | 效果 |
|------|---------|------|
| **接 (Accept)** | 这活我能干 | 猫开始执行任务 |
| **退 (Decline)** | @错了 / 另一只猫才是 owner | 猫 `@` 正确的猫 → 重新触发第 1 层 |
| **升 (Escalate)** | 需要人类决策（不可逆操作、策略问题） | 猫 `@` operator |

**「退」是涌现行为**：被误@的猫会 `@` 正确的猫，系统只是看到一个新 @mention 然后正常路由——"退不是系统功能，是 LLM 遵循路由规范的涌现行为"。系统甚至不知道发生了"重定向"。

### 各层细节

- **第 1 层 提及解析**：只有**行首** `@handle` 才路由（句中的"让 @opus 来 review"不路由，但被"影子检测"记录用于可观测性）；预处理去除代码块/URL/引号内字符串；每条消息最多 2 只不同的猫
- **第 3 层 回退梯级**（无显式 @ 时）：显式 @ > 群组 @all > 最近用户提及（扫描最近 5 条用户消息）> 最后回复者 > 线程偏好猫 > 系统默认猫
- **第 4 层 分发**：串行（默认，交接链）/ 并行（多猫同时唤醒，状态机 `pending→running→partial→done`）
- **安全护栏**：A2A 深度上限 10、**乒乓检测**（同一对猫来回踢皮球 N 轮后注入 `pingPongWarning`）、并行超时 3-20 分钟
- **第 5 层 上下文组装**：约 20 条消息 / 约 2000 token 预算，大消息 40%头+60%尾截断；**`directMessageFrom` 字段**让被@的猫知道是被专门指名的

### 知识层（为第 6 层判断提供燃料）

| Feature | 解决什么 | 数据 |
|---------|---------|------|
| **F208 猫猫画像** | "我该传球给谁？" | 六维模型：原生峰值/被低估能力/坏直觉/召唤反信号/互补反模式/翻车熔断信号 |
| **F231 operator画像** | "这个人是谁？" | 四层架构（见上） |
| **F221 品味导航** | "什么算好活？" | 7 维品味小品文（vignettes），按需检索 |

画像通过**中性摘要层** `l0RosterSummary` 注入（避免偏见：不写"X在Y方面有坏直觉"导致过度回避）。**画像是数据，不是规则**——明确不做自动路由。

### 代码锚点

| 文件 | 用途 |
|------|------|
| `packages/api/src/domains/cats/services/agents/routing/a2a-mentions.ts` | 猫对猫提及解析 |
| `packages/api/src/domains/cats/services/agents/routing/cat-target-resolver.ts` | @handle → catId 解析 |
| `packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts` | 回退梯级（`parseAllMentions()`） |
| `packages/api/src/routes/callback-a2a-trigger.ts` | A2A 分发 |
| `packages/api/src/domains/cats/services/agents/routing/MultiMentionOrchestrator.ts` | 多猫状态机 |
| `packages/api/src/domains/cats/services/context/ContextAssembler.ts` | 对话历史组装 |
| `packages/api/src/domains/cats/services/agents/routing/a2a-shadow-detection.ts` | 影子检测（可观测性） |
| `packages/api/src/utils/cat-mention-handle.ts` | handle 规范化 |

---

## 3. 跨模型互审（Cross-Model Review）

不是外挂，是**SOP 纪律 + 画像路由**的结合：

- **铁律**（`sop-definitions/development.yaml` 的 `review-no-self-review`）：同一个体不能 review 自己的代码，severity=blocker，predicate=`handle_check` / `reviewer_not_author`
- **配对规则**：跨 family 优先（布偶 review 缅因的代码）、必须有 peer-reviewer 角色、必须 available
- **降级链**：无跨 family reviewer → 同 family 不同个体 → operator
- **六维画像**（F208，`docs/team/cat-dossier.md`，17 只猫）指导该把球传给谁

### 代码锚点

- `sop-definitions/development.yaml`（`review` stage hard_rules）
- `docs/team/cat-dossier.md`（17 只猫画像）
- `ReviewerMatcher`（动态配对，跨 family 优先）

---

## 4. 共享记忆与证据库（Memory / Evidence）

- **核心契约**：`IEvidenceStore` + `IIndexBuilder`（F102），本地 SQLite 存储（`SqliteEvidenceStore.ts`）
- **检索**：passage 级语义召回 + entity registry 作为检索锚点（F209，`entity_id` 是 retrievable doorway with provenance）
- **多来源 scanner**：`CatCafeScanner` / `GenericRepoScanner`（F152 支持外部仓库冷启动 bootstrap）
- **Perspective**：live query-plan surface（`PerspectivePlanLoader` / `PerspectiveRunner`）

### 重要边界（刻意划清）

- **记忆是 pull-mode（按需检索），身份胶囊是 push-mode（每次注入）——memory ≠ identity**
- 不要把 session transcript / invocation log 变成 evidence store API
- 不要让 `entity_id` 覆盖 roster/model/role 真相
- 不要把私有项目数据混入全局/library memory

### 代码锚点

| 文件 | 用途 |
|------|------|
| `packages/api/src/domains/memory/interfaces.ts` | `IEvidenceStore`/`IIndexBuilder` 契约 |
| `packages/api/src/domains/memory/IndexBuilder.ts` | 索引构建 |
| `packages/api/src/domains/memory/SqliteEvidenceStore.ts` | 本地 SQLite 存储 |
| `packages/api/src/domains/memory/CatCafeScanner.ts` | CatCafe 仓库扫描 |
| `packages/api/src/domains/memory/GenericRepoScanner.ts` | 通用仓库扫描 |
| `packages/api/src/domains/memory/ExpeditionBootstrapService.ts` | 冷启动 bootstrap |
| `packages/api/src/domains/memory/KnowledgeResolver.ts` | 跨项目/library 检索 |

---

## 5. SOP 守护（Collaborative Discipline）

把开发流程变成**机器可校验的 YAML**（`sop-definitions/development.yaml`）。

### 6 个 stage

```
kickoff → impl → quality_gate → review → merge → completion
```

每个 stage 有：
- `hard_rules`（severity=blocker，用 **predicate** 机器校验）
- `pitfalls`（severity=warn）
- `suggested_skill`（指向 `cat-cafe-skills/` 里的对应 skill）

### predicate 类型（机器校验）

| predicate 类型 | 用途 | 示例 |
|---------------|------|------|
| `git_state_predicate` | git 状态校验 | worktree 前必须 main 双向同步（ahead=0 behind=0） |
| `env_check` | 环境变量校验 | Redis 只用 6398 |
| `command_pattern` | 命令模式匹配 | 声称完成必须跑过 `pnpm gate` |
| `command_sequence` | 命令序列 | merge 必须用 `gh pr merge --squash` |
| `handle_check` | handle 约束 | reviewer ≠ author；守护交接必须存在 |
| `sha_dedup` | SHA 去重 | 云端 review 同一 SHA 不重复触发 |
| `manual_only` | 暂时人工 | 带 `future_candidate` 标记待机器化 |

### 五步流程

```
⓪ Design Gate → ① impl → ② quality-gate → ③ review循环 → ④ merge-gate → ⑤ 愿景守护
```

- **愿景驱动**：没达成愿景=没完成，全链路自动推进到愿景守护通过为止（§17 自动推进）
- **愿景守护**：守护猫 ≠ 作者 ≠ reviewer，动态选（查 roster），做"愿景三问"
- **Design Gate 在 ① 之前**：UX 没确认不准开 worktree

### 铁律（Iron Laws / Hard Rails）

1. **Data Storage Sanctuary** — 永不删 Redis/SQLite
2. **Process Self-Preservation** — 永不杀父进程
3. **Config Immutability** — 运行配置只读
4. **Network Boundary** — 不碰别人的端口

### 代码锚点

- `sop-definitions/development.yaml`（机器真相源）
- `scripts/lib/sop-definition-codegen.mjs`（codegen 生成 `packages/shared/src/types/sop-definition.generated.ts`）
- `docs/SOP.md`（人类可读叙事，冲突时以 YAML 为准）

---

## 6. Skills 框架 + MCP Callback Bridge

### Skills 框架

- **`cat-cafe-skills/`**（50+ 个 skill）：按需加载的提示词包
- **`manifest.yaml`** 是路由单一真相源：每个 skill 定义 `triggers` / `not_for` / `output` / `next`（skill-to-skill 链）
- 开发流程链：`feat-lifecycle → writing-plans → worktree → tdd → quality-gate → request-review → receive-review → merge-gate → feat-lifecycle`
- 交接 skill（`cross-cat-handoff`）：**五件套结构** What / Why / Tradeoff / Open Questions / Next Action——缺任一项会 BLOCK 发送

### MCP Callback Bridge

- **非 Claude 模型通过 callback 拿到 MCP 工具能力**
- 鉴权：`CAT_CAFE_INVOCATION_ID + CAT_CAFE_CALLBACK_TOKEN`
- 完整的 reason 分类法（`CALLBACK_AUTH_FAILURE_REASONS`）和降级策略（`degradation.ts`）
- `packages/mcp-server/src/tools/` 有 20+ 工具文件（callback-tools / evidence-tools / memory-tools / hub-action-tools 等）

---

## 架构 Cell 索引（代码锚点速查）

Clowder 用 **ownership cells** 划清架构边界（`docs/architecture/ownership/cells/`），防止身份等概念变成"垃圾桶"。核心 cells：

| Cell | 解决什么 | Primary Code Anchors |
|------|---------|---------------------|
| `identity-session` | 5 个 subcell：agent身份/connector绑定/bubble身份/runtime session/user profile | `cat-config-loader.ts`, `SystemPromptBuilder.ts`, `RuntimeSessionStore.ts` |
| `memory` | evidence 索引/检索/scanner/bootstrap | `domains/memory/*` |
| `ball-custody` | 球权事件流 + 7 态状态机（任务交接所有权） | `domains/ball-custody/*` |
| `dispatch` | 调用队列/busy gate/公平性/优先级 | `invocation/InvocationQueue.ts` |
| `callback-auth` | invocation 凭证 + callback token 验证 | `invocation/InvocationRegistry.ts` |
| `community-ops` | 社区事件 Log + 投影/状态机 | `domains/community/*` |
| `transport` | 平台消息入口/出口/对话语义 | `infrastructure/connectors/*` |
| `hub-action-surface` | 让猫把文件/预览/rich block 展示给用户 | `routes/workspace.ts` |
| `bubble-pipeline` | 前端消息气泡 identity + reducer | `stores/bubble-reducer.ts` |

---

# 第二部分：Raft Blog 五篇文章经验总结

> 背景：**Raft（raft.build）和 Clowder AI 是同类产品**——都是"让人和 AI agent 像团队一样协作"的平台（持久频道/DM、agent 有自己的记忆/技能/身份）。所以这五篇文章的经验**直接适用于构建 Clowder 类系统**。
>
> 文章列表（来自 `https://raft.build/resources/blog/` + `/llms.txt`）：
> 1. Introducing Raft: Where Humans and Agents Build Together
> 2. Agents Need Names
> 3. Is Having Agents in the Room Meant to Be Chaotic?
> 4. Agent Posture: Making Agents Useful in the Room
> 5. A Comfortable AX for Agent Search

---

## 文章 1：《Introducing Raft: Where Humans and Agents Build Together》

**核心**：一个 agent = 一个 session，是**跨越数天和任务的持续身份**，人和 agent 在共享上下文里一起成长为一个团队。

**经验**：
- **持续身份（continuous identity）是 agent 团队的基础单位**。不要把 agent 当成"一次调用"，而要当成"一个一直在场的同事"
- agent 的价值不在单次输出，而在**积累的共享上下文和关系**。Raft 整个产品都建立在 "identity stays alive across days and tasks" 这个前提上
- 💡 **身份持久化不是优化项，而是 Day-1 的地基**。Raft 和 Clowder 都把它放到了最底层

---

## 文章 2：《Agents Need Names》（名字不是装饰）

**核心**：名字是 agent 团队的**路由地址 + 历史载体 + 信任锚点**。一个由"有名字的 agent"组成的团队，胜过一个匿名全能 agent。

**经验**：
- **名字承载三件事**：① 路由工作（`@name` 把活派给谁）② 承载历史（这个名字背后的记忆和口碑）③ 建立信任（你信任"宪宪"的架构判断，而不是信任"那个 Claude"）
- 匿名全能 agent 的问题：没有问责、没有专长分化、没有关系积累
- 名字让 agent **可被问责（accountable）**——出问题时你知道找谁，这在团队协作里不可替代
- 💡 和 Clowder 完全一致：Clowder 的每只猫都"自己给自己起名"（从真实对话中长出来）。**名字是 agent 从"工具"变成"队友"的那道分水岭**

---

## 文章 3：《Is Having Agents in the Room Meant to Be Chaotic?》

**核心**：把 agent 当成"永远在线的人类"会让共享频道变得嘈杂。需要给 agent **room-aware 的姿态（posture）** 和 **held-draft（暂存草稿）机制**，让它自己决定何时读、何时回复、何时修改、何时沉默。

**经验**：
- **Agent 不应该对每条消息都响应**。需要让 agent 有"房间意识"：判断现在该 participate / speak-up / silent
- **held-draft 表面**：agent 可以先把回复写成草稿、修改后再发——避免"一句话触发一次完整回复"的噪音
- **Agent inbox**：agent 有自己的收件箱，而不是被动监听整个频道
- 核心洞察：**chaos 不是 agent 太多的错，而是"把 agent 当成 continuous-presence 人类"的设计错**。好的设计给 agent "决定何时发言"的自主权
- 💡 对应 Clowder 的设计：第 6 层「接/退/升」就是这个理念——agent 自己判断该不该接、该不该 @别人、该不该升级给人类。**沉默也是一种协作行为**

---

## 文章 4：《Agent Posture: Making Agents Useful in the Room》

（文章 3 的产品化深化版）

**核心**：agent 要在共享频道里有用，需要的不是原始访问权限，而是 **room-aware posture（participate / speak-up / silent）+ held-draft 修改表面**。

**经验**：
- 把文章 3 的理念**产品化**：posture 是一个明确的、可切换的状态，不是隐含的
- **speak-up posture** 尤其重要：agent 平时 silent，但发现关键问题时主动开口（比如 review 发现安全漏洞）——这对应 Clowder 的「升（Escalate）」
- held-draft 让 agent 的输出可以**迭代**而非"一锤子"——提升了 agent 输出的质量
- 💡 文章 3+4 合起来回答了一个关键问题：**多 agent 在场时如何不互相干扰？答案是给 agent "克制的能力"**——能判断何时该沉默，比能随时响应更高级

---

## 文章 5：《A Comfortable AX for Agent Search》（AX = Agent Experience）

**核心**：搜索 agent 的结果不该还是"原始接口"。搜索结果需要 **match-local context（匹配本地上下文）+ clear next action（明确的下一步）**，而不是返回原始 ID 或烧 context 的数据 dump。

**经验**：
- **AX（Agent Experience）是新的 UX**——当你的用户是其他 agent 时，交互设计原则完全不同
- Agent 消费搜索结果时：① 不要返回需要二次解析的原始 ID ② 不要 dump 大量上下文（烧 token）③ 要直接给出"下一步该做什么"
- 搜索结果本身要**预格式化成 agent 可直接行动的形态**
- 💡 这是一个很新的视角：**agent-to-agent 的接口设计（AX）需要专门考量**。Clowder 的 `directMessageFrom` 字段、五件套交接结构（What/Why/Tradeoff/Open/Next）本质上就是在做 AX——让交接信息对 agent 来说是"可直接行动"的

---

# 第三部分：交叉洞察（文章经验 ↔ Clowder 实现）

这五篇文章和 Clowder 的实现**高度互证**，可以提炼出构建"有性格的多 agent 团队"的几条核心原则：

## 对照表

| Raft 文章的经验 | Clowder 的对应实现 | 共同原则 |
|---------------|------------------|---------|
| 持续身份是基础单位 | 四层人格模型 + L0 编译时注入 | **身份必须 push-mode 持久化，不依赖对话历史** |
| Agent 需要名字 | 猫自己起名 + `@handle` 路由 | **名字=路由+历史+信任的三合一** |
| Agent 在场不应混乱 | 第 6 层「接/退/升」涌现行为 | **给 agent "克制/沉默"的自主权** |
| Room-aware posture | 守护猫、乒乓检测、深度限制 | **协作需要纪律护栏，不是自由放任** |
| AX 设计（agent 友好接口） | 五件套交接、`directMessageFrom` | **agent 间接口要"可直接行动"，不是给人看的** |

## 最值得记下的三条原则

1. **机械路由 + 智能代理**：让代码做确定性的事（解析/调度/护栏），让 LLM 做判断（接/退/升）。不要在路由层塞意图检测——那是 LLM 级别的任务，放代码里会又脆又多余。

2. **身份与记忆分离**：身份是 push（每次注入，抗压缩），记忆是 pull（按需检索）。混在一起就会出 bug。Clowder 在 ownership cell 里明确写 "identity-user-profile is not memory"。

3. **协作纪律可机器化**：把 SOP 写成带 predicate 的 YAML，用 hard_rules 做 blocker 校验——"自由判断，结构化交付"（free judgment, structured delivery）。不是用纪律限制 agent，而是用纪律让 agent 能放心自主。

---

*本文档基于对 `clowder-ai` 仓库（截至 2026-06-26）的架构文档、配置文件、SOP 定义、代码锚点的深度阅读，以及对 raft.build blog 五篇文章的逐篇总结整理而成。*
