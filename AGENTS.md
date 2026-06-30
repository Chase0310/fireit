# fireit — ZCODE Agent Guide

> 这份文件是给在 fireit 仓库里工作的 AI agent(以及未来的贡献者)看的。ZCODE 在本仓库干活时,遵守下面的规约。

## 项目是什么

fireit 是一个本地优先的多 agent 协作工具。一群有持久身份、性格、记忆的 agent(Atlas/Forge/Nova)在共享的聊天房间里和用户协作 —— 头脑风暴(全员 posture 判断发言)或单聊(DM,单 agent 路由)。每个 agent 绑定一个本机的 coding CLI(claude-code / codex),有持久 session(resume)和自管的 workspace(MEMORY.md)。

## 架构速览(改动前必读)

- **packages/shared** — 前后端共享类型(Agent / ThreadMode / AgentOutputChunk / AgentInvokeInput)
- **packages/core** — 协作内核:posture 判断、@mention 解析(parseMentions/parseAnyMentions)、target 解析、team registry
- **packages/agents** — CLI 适配器:buildArgs(claude `--append-system-prompt`/`--effort`、codex `-c developer_instructions`/`model_reasoning_effort`)、normalize(stream → AgentOutputChunk,含 session_bound 捕获)、runner(spawn + resume)
- **packages/server** — Fastify + better-sqlite3 + Drizzle。ChatService 是编排核心(handleBrainstormMessage / handleDirectedMessage / handleDmMessage / runAgent / agent@agent 链式触发);AgentService 管三层状态(定义层 DB / 运行时 session / 工作区文件)
- **packages/web** — React + zustand。IM 布局(群聊/单聊/在场状态三段式 sidebar)

**关键数据流**:user 消息 → ChatService 按 mode 路由 → posture 判断/@排他 → runAgent(spawn CLI,身份走 system role,task 走 user role)→ 流式 chunks → 解析 agent 输出里的 @mention → 链式触发队友(防循环:spoken 去重 + reminder)。

## 真相源(改之前先读这些)

- 架构与设计:`docs/technical/`、`docs/superpowers/specs/`
- 已解决问题:`docs/troubleshooting/incidents.md`(每个 bug 的现象/根因/解法)
- 排查手段:`docs/troubleshooting/troubleshoot.md` + `docs/skills/fireit-debug/SKILL.md`
- 运行时数据:**不进 git**(`.fireit/` 被 gitignore):DB 在 `.fireit/fireit.db`,agent workspace 在 `.fireit/agents/<id>/`

---

## 🔴 规约:解决 bug 必须沉淀

**这是硬性要求,不是建议。** 每解决一个 bug(无论是用户报的还是自己发现的),都必须在 `docs/troubleshooting/incidents.md` 追加一条记录,**然后才能视为"完成"**。

### 沉淀格式(照此写)

```markdown
## YYYY-MM-DD · 一句话标题(问题是什么)

**现象**:用户/你看到了什么。尽量贴具体表现(消息流、报错、截图描述)。不要只写"有问题"。

**根因**:为什么会这样。区分"环境问题"(如 CLI 卡住)还是"代码问题"(逻辑/设计错)。如果排查走了弯路,记下弯路和为什么走错(避免下次重复)。

**解法**:改了什么(文件/函数/commit)。如果是设计层而非代码层(如语义不清),说明这次定的是哪种语义、为什么。

**验证**:怎么确认修好了(测试名 / 手动步骤 / e2e)。

**遗留/反思**(可选):还有什么没解决、或这次暴露的更深层问题。
```

### 为什么必须沉淀

- fireit 涉及多 agent + 多 CLI + 多模式(brainstorm/directed/dm),问题复现链条长。不沉淀 = 下次同样的问题要重新排查一遍。
- 很多 bug 是**设计语义不清**(如 "@是排他还是补充"),不是代码错。沉淀能把这些决策固定下来,避免反复摇摆。
- 排查手段(thread → cliSessionId → CLI transcript)不沉淀就只能靠记忆,新接手的人(或未来的你)无从下手。

### 不要沉淀什么

- 纯 typo / 一行 fix —— 除非它反映了某个易错点
- 还没确认根因的猜测 —— 沉淀的是**已验证**的解法

---

## 工作规约

### 改动前
- 先读 `docs/troubleshooting/incidents.md`,确认这个问题之前没遇到过
- 涉及 agent 行为的,用 `docs/skills/fireit-debug/SKILL.md` 的手段拿全上下文(thread 消息 + CLI transcript + workspace),不要凭猜测改

### 改动中
- 类型先行:shared 包的类型契约先改,再改 server/agents/web
- 测试先行:TDD —— 写失败测试 → 实现 → 跑过。agent 路由类用 StubInvoker/ScriptedInvoker 不碰真实 CLI
- 小步提交:一个功能/一个 fix 一个 commit,commit message 写清改了什么 + 为什么

### 改动后
- `pnpm test` 全过 + `pnpm build` 五包绿,才算完
- 涉及 agent 行为的,在真实 server + web 上手动验过(别只信单测)
- **bug 类改动 → 必须沉淀到 incidents.md**(见上)

### 危险动作(要确认)
- `codex resume <id>` / `claude --resume <id>` —— 会往真实 session 注入消息,排查时只读 transcript 文件,别 resume
- 删 `.fireit/fireit.db` —— 清空所有会话和 agent session 绑定;只在明确要重置时做
- push —— 对外发布,确认后才做
