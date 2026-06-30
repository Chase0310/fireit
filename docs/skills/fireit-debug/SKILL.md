---
name: fireit-debug
description: 排查 fireit 多 agent 协作的运行时问题——agent 不回、行为异常、身份没注入、session 丢失等。提供从 fireit DB → CLI session transcript 的完整上下文获取手段。当用户说 agent 不说话/行为奇怪/查某 agent 状态/查某 thread 发生了什么 时使用。
---

# fireit 运行时排查

排查 fireit agent 行为问题时,需要拿到**完整上下文链**:某 thread 发生了什么 → 某 agent 收到什么身份 → CLI session 里的原始对话。这份 skill 给出每一层的获取手段。

## 三层上下文(由浅到深)

排查 agent 问题时,按这三层逐层下钻:

1. **fireit 层**(应用视角):thread 消息流、agent 配置、session 绑定 —— 查 `.fireit/fireit.db`
2. **CLI 层**(agent 真实对话):codex/claude 的 session transcript —— 查 `~/.codex/sessions` / `~/.claude/projects`
3. **workspace 层**(agent 自管文件):MEMORY.md、notes、git 锚点 —— 查 `.fireit/agents/<id>/`

完整命令清单见 `docs/troubleshooting/troubleshoot.md`(这份 skill 是它的入口)。**优先读那份文档**,里面有可复制的具体命令。

## 常见问题 → 该查哪层

| 现象 | 先查哪层 | 关键动作 |
|---|---|---|
| agent 不回 / 只 user 没 agent | CLI 层 | 直接测 `claude -p`/`codex exec` 隔离环境问题;看 server 日志有无 `⚠ 执行出错` |
| agent 抢话 / 该说的没说 | fireit 层 | 查 thread 消息流的 system 消息(🤫 原因);看 posture 判断 + @排他逻辑 |
| agent 忘了自己是谁 | CLI 层 | 查 codex transcript 的 `role=developer` 块有没有身份;确认走 system role |
| 身份注入没生效 | CLI 层 | 见 troubleshoot.md 场景 5,跑带 `developer_instructions=` 的 codex 看 developer role |
| workspace 文件找不到 | workspace 层 | 确认 PROJECT_ROOT 路径(不再依赖 cwd);数据在 `.fireit/agents/<id>/` |

## 拿 cliSessionId(下钻 CLI 层的钥匙)

fireit 把 agent 绑定的 CLI session id 记在 `agent_sessions` 表。拿到它才能去查 CLI transcript:

```bash
sqlite3 .fireit/fireit.db "SELECT agent_id, cli_session_id FROM agent_sessions WHERE status='active';"
# 得到如:agent_forge|019f1239-e956-7ab1-8bf0-5e5d44dec3d6
```

然后用这个 id 去 `~/.codex/sessions/`(find by id)或 `~/.claude/projects/` 找 transcript。

## 注意事项

- **只读 transcript,别 resume**:除非明确要继续对话,否则只 `cat`/`python` 读 transcript 文件。`codex resume <id>` / `claude --resume <id>` 会真的往该 session 注入消息,可能影响真实协作。
- **DB 用 `:memory:` 测试时无文件**:集成测试用内存库,排查生产问题要找真实的 `.fireit/fireit.db`。
- **cwd 编码**:claude session 目录名是 cwd 的编码(`/` → `-`),fireit agent 的目录名带 `fireit-agents-agent-<name>`。
- **schema 可能滞后**:用 `sqlite3 <db> ".schema <table>"` 看实际列,别假设。幂等迁移(`upgradeAgentsColumns`/`upgradeThreadsColumns`)要 server 启动跑过才补列。
