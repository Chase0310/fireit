# fireit 故障沉淀(Incidents)

> 每条:现象 → 根因 → 解法 → 验证。按时间倒序。新问题照此格式追加。

---

## 2026-06-30 · agent 被 @ 排他时其他 agent 仍抢话(Forge 抢主持)

**现象**:用户 `@nova 你主持一下玩剪刀石头布`,Nova 被强制发言是对的,但 **Forge 也抢着主持**了(回复"来,我主持...")。结果出现两个裁判,协作混乱。截图里能看到 Forge 和 Nova 同时在宣布规则。

**根因**:`handleBrainstormMessage` 里,被 @ 的 agent 进 `forced` 集合强制 participate,但**其余 agent 仍走 `brainstormPostureJudge` 判断**。Forge 的性格是"热血奔放,爱抢话",posture judge 在"玩游戏"这种活泼场景下判它 participate。`@` 在设计上只是"保证某人一定回",不是"排除其他人",导致 @不排他。

**解法**:`@` 改为**排他语义**。消息含 `@mention` 时(`forced.size > 0`),其余 agent **直接 silent**,不走 posture judge。逻辑分支:
- `forced` 非空 → 只有 forced 里的 agent 发言,其余 `🤫 X: 用户 @了别人,这轮我不参与`
- `forced` 空 → 走全员 posture 判断(头脑风暴原语义不变)

改动文件:`packages/server/src/services/chat-service.ts` `handleBrainstormMessage`。
提交:`f7e6306`。

**验证**:新增 2 个测试(`agent-mention.test.ts` 的"@排他"describe 块):
- `@atlas` 时 forge/nova 不被调用(invoker.calls 不含它们)
- 无 `@` 时仍走 judge
- 手动:`@nova 你主持` → 只有 Nova 回,Forge/Atlas 显示 🤫

**遗留/反思**:这是"语义不清"类 bug,不是代码错误。`@` 在 brainstorm 里到底是"补充"(保证某人回,其他人可插话)还是"排他"(只听 TA)?这次定为排他,更接近 DM 语义,符合用户预期。如果未来要"补充"语义,需要做成 per-thread 配置。

---

## 2026-06-30 · 消息发出去 agent 不回(codex HTTP 502 拖死 brainstorm)

**现象**:在 brainstorm 发消息,只有 user 消息落库,**agent 一个都不回**,server 日志无报错。等 8 秒、20 秒都不回。

**根因**(两层):
1. **环境层**:codex CLI 连不上它的 MCP server,报 `HTTP 502`(rmcp transport: `UnexpectedServerResponse("HTTP 502")`),codex 进程**卡住不退出**(输出停在 `thread.started`/`turn.started`,无 `turn.completed`)。
2. **代码层**:fireit 的 `handleBrainstormMessage` 用 `Promise.all` 等所有候选 agent 的 posture 判断完成。Forge/Nova(codex)的 judge 调用因 codex 卡住而**永不 resolve**,`Promise.all` 被拖死,**连被 @ 强制发言的 Atlas(claude,本身正常)也发不出话**——因为 willSpeak 收集在 Promise.all 之后。

直接测 codex CLI 复现:`echo "hi" | codex exec --json ...` 输出只有 `thread.started`/`turn.started`,stderr 一片 502。

**解法**(用户已自行修环境层):代码层的根因是"无超时保护"。**推荐补的防线**(若再遇到):
- posture judge 调用加超时(如 30s 没回当 silent)
- `runAgent` 的 CLI 调用加超时上限(如 120s)

**排查手段**:见 `docs/troubleshooting/troubleshoot.md` 的"agent 不回"章节——核心是直接 curl API + 看 server 日志 + 单独测 claude/codex CLI 隔离是环境问题还是代码问题。

---

## 2026-06-29 · 身份/上下文没进 system message(会被压缩丢弃)

**现象**:对照 Slock 的 codex session transcript,发现 Slock 把 agent 身份注入到 `role=developer` 的消息块(压缩免疫),而 fireit 把 `identity + context + task` **全拼成一个字符串**作 user prompt(`-p <prompt>`)。后果:长对话触发上下文压缩时,身份信息可能被丢弃,agent "忘了自己是谁"。

**根因**:`composePrompt` 把三段拼一个字符串,`buildArgs` 全部走 user prompt 通道。没用 claude 的 `--append-system-prompt` 或 codex 的 `-c developer_instructions`。

**解法**:拆成两部分——
- `identity + context` → `composeSystemPrompt()` → 注入 **system/developer role**(压缩免疫)
  - claude:`--append-system-prompt`(追加到默认人格之后)
  - codex:`-c developer_instructions=`(developer message,与 permissions/skills 并列)
- `task` → 仍是 user prompt(当前这一句)

提交:`683430f`。

**验证**:直接跑 `codex exec ... -c 'developer_instructions=你是 Forge'`,查 session transcript 第 3 行:
```
response_item/message role=developer
  input_text[1]: 你是 Forge,后端工程师。完成时说 DONE。  ← 我的身份 ✓
```
与 Slock 的注入结构一致。claude 的 `--append-system-prompt` 被接受且正常回复。

**教训**:用户 prompt 会被压缩,身份这类"必须持久"的内容要走 system/developer role。这是 Slock 和 clowder 共同的设计,fireit 之前漏了。

---

## 2026-06-29 · agent 创建后 workspace 目录没建(实为看错 cwd)

**现象**:POST `/agents` 建了 agent,但 `.fireit/agents/<id>/` 下找不到 MEMORY.md,以为 `ensureWorkspace` 没生效。

**根因**:**不是 bug,是看错位置**。`pnpm --filter @fireit/server dev:full` 启动时 server 的 cwd 是 `packages/server/`,而 `dbPath`/`workspaceRoot` 是相对路径 `'.fireit/...'`,所以数据实际落在 `packages/server/.fireit/agents/`,不是项目根。`ensureWorkspace` 一直正常工作,只是文件在别处。

**解法**:路径统一——`dev.ts` 用 `PROJECT_ROOT`(相对 `__dirname` 上溯 3 级)解析出绝对路径,`dbPath`/`workspaceRoot` 都用绝对路径。数据现在稳定落在 `fireit/.fireit/`。提交:在"思考等级 + 路径统一"那次 commit 里。

**教训**:相对路径 + 可变 cwd = 数据落点不可预测。server 类应用的数据路径应该**用绝对路径**,从模块位置或环境变量推导,不依赖 cwd。
