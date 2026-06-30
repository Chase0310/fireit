# fireit 排查手册(Troubleshooting)

> 排查 agent 行为问题时,怎么拿到**完整上下文**:某个 thread 发生了什么、某 agent 收到了什么身份、CLI session 的原始对话。按场景查。

---

## 场景 1:某条消息/某个 thread 里发生了什么

### 1a. 查 thread 的消息流(fireit DB)

```bash
# DB 路径(项目根;若改过 dev.ts 的 PROJECT_ROOT 就在那)
DB=.fireit/fireit.db

# 列出所有 thread(看 title 找目标)
sqlite3 $DB "SELECT id, mode, dm_agent_id, title FROM threads ORDER BY updated_at DESC LIMIT 10;"

# 某个 thread 的完整消息流(按时间,看 sender/kind/内容)
sqlite3 $DB "SELECT at, sender, kind, substr(data_json,1,200) FROM thread_messages WHERE thread_id='<TID>' ORDER BY at;"

# 只看 agent 的最终回复文本(kind=agent)
sqlite3 $DB "SELECT sender, data_json FROM thread_messages WHERE thread_id='<TID>' AND kind='agent';" | python3 -c "import sys,json;[print(json.loads(l.split('|',1)[1] if '|' in l else l)['text']) for l in sys.stdin]"

# 看 streaming 消息的 chunks(思考/工具调用)
sqlite3 $DB "SELECT data_json FROM thread_messages WHERE thread_id='<TID>' AND kind='streaming';" | python3 -c "
import sys,json
for l in sys.stdin:
    d=json.loads(l)
    print('sender:',d['sender'])
    for c in d.get('chunks',[]): print(' ',c.get('kind'),str(c.get('content',c.get('tool','')))[:80])
"
```

### 1b. 通过 REST API(在线,不碰 DB 文件)

```bash
BASE=http://127.0.0.1:3140
curl -s $BASE/threads | python3 -m json.tool        # thread 列表
curl -s $BASE/threads/<TID>/messages | python3 -m json.tool  # 含 mode/taskId/dmAgentId/messages
```

---

## 场景 2:某 agent 的身份/配置/状态

```bash
DB=.fireit/fireit.db

# agent 定义(身份、adapter、effort、性格)
sqlite3 $DB "SELECT id, handle, name, adapter_type, effort, personality FROM agents;"

# 某 agent 的当前 session 绑定(cliSessionId 在哪)
sqlite3 $DB "SELECT agent_id, adapter_type, cli_session_id, status FROM agent_sessions WHERE agent_id='<AGENT_ID>';"

# REST:agent 详情 + session
curl -s $BASE/agents/<ID>/session | python3 -m json.tool
curl -s $BASE/agents/<ID>/events | python3 -m json.tool   # 跨 thread 事件流
```

### 2a. agent 实际收到的身份注入是什么?

身份来源:`packages/server/src/dev.ts` 的 `SEEDS[].identityPrompt`(或 web 建的 agent 走 AgentService,默认无 identityPrompt)。

```bash
grep -A2 "identityPrompt" packages/server/src/dev.ts   # 看每个 agent 注入的身份原文
```

注入通道(确认身份走 system 还是 user):
```bash
grep -n "composeSystemPrompt\|systemPrompt\|append-system-prompt\|developer_instructions" packages/agents/src/runner.ts packages/agents/src/base-adapter.ts packages/agents/src/adapters/*.ts
```

---

## 场景 3:agent 在 CLI 里的**原始对话**(session transcript)—— 最深一层

fireit 每次 invoke 给 agent 的 CLI spawn,CLI 会把完整对话存到本地。这是排查"agent 到底看到/说了什么"的终极手段。

### 3a. 先拿到 cliSessionId(fireit 记录的绑定)

```bash
sqlite3 $DB "SELECT cli_session_id FROM agent_sessions WHERE agent_id='<AGENT_ID>' AND status='active';"
# 得到类似 019f1239-... (codex) 或 24a9834e-... (claude)
```

### 3b. codex session transcript

```bash
SID=019f1239-e956-7ab1-8bf0-5e5d44dec3d6
# 方式1:resume 进去看(交互式,会真的打开对话——谨慎,会继续该 session)
codex exec resume $SID   # 或交互: codex resume $SID

# 方式2:只读 transcript 文件(不触碰 session,安全)
find ~/.codex/sessions -name "*$SID*"   # 定位文件
F=$(find ~/.codex/sessions -name "*$SID*.jsonl" | head -1)
head -3 "$F"   # session_meta(看 cwd/originator/effort)+ 首个 developer message(身份)

# 看身份注入进了哪个 role(关键:应该是 developer)
python3 -c "
import json
with open('$F') as f:
    for i,line in enumerate(f):
        if i>15: break
        d=json.loads(line)
        if d.get('type')=='response_item':
            p=d.get('payload',{})
            if p.get('type')=='message':
                print(f'[{i}] role={p.get(\"role\")}')
                for c in p.get('content',[]):
                    if c.get('type')=='input_text': print('   ',c['text'][:100])
"

# session_index 里查所有 session 的 thread_name/cwd
grep -i fireit ~/.codex/session_index.jsonl | head
```

### 3c. claude session transcript

```bash
SID=24a9834e-5e93-4d65-9d92-186565eafe0a
# claude 按 cwd 组织,目录名是 cwd 的编码(/ → -)
# fireit agent 的 cwd 是 .fireit/agents/<id>,所以目录名带 fireit-agents-agent-<name>
ls -d ~/.claude/projects/*fireit*agents*
F=$(find ~/.claude/projects -name "*$SID*.jsonl" | head -1)

# 看消息(只 user/assistant;system prompt 是协议层不回显)
python3 -c "
import json
with open('$F') as f:
    for line in f:
        d=json.loads(line)
        msg=d.get('message',{})
        role=msg.get('role','')
        if role in ('user','assistant'):
            content=msg.get('content','')
            if isinstance(content,list):
                content=' '.join(c.get('text','')[:60] for c in content if isinstance(c,dict))
            print(f'  role={role} | {str(content)[:80]}')
"

# resume(交互,会继续 session——谨慎)
claude --resume $SID -p "继续"
```

### 3d. agent 自己写的文件(workspace)

```bash
# fireit agent 的 cwd = .fireit/agents/<agentId>/
ls -la .fireit/agents/agent_forge/
cat .fireit/agents/agent_forge/MEMORY.md        # agent 自管的记忆
ls .fireit/agents/agent_forge/notes/            # agent 自己写的笔记
git -C .fireit/agents/agent_forge/ log --oneline  # FULL RESET 的锚点历史
```

---

## 场景 4:agent 不回 / 行为异常

**步骤化排查**:

1. **server 健康?**
   ```bash
   curl -s $BASE/health
   ```

2. **消息落库了吗?**(user 消息有没有,agent 消息有没有)
   ```bash
   sqlite3 $DB "SELECT sender,kind FROM thread_messages WHERE thread_id='<TID>' ORDER BY at;"
   ```
   只有 user 没有 agent → agent 根本没跑 → 看步骤 3/4

3. **是环境问题还是代码问题?直接测 CLI**
   ```bash
   # claude(Atlas)
   /opt/homebrew/bin/claude -p "说一个字:好" --output-format stream-json --verbose --dangerously-skip-permissions | tail -3
   # codex(Forge/Nova)
   echo "说一个字:好" | /opt/homebrew/bin/codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox | tail -5
   ```
   - CLI 本身卡住/报错(如 HTTP 502)→ **环境问题**,不是 fireit bug
   - CLI 正常 → fireit 代码/路由问题,看步骤 4

4. **看 server 实时日志**
   ```bash
   tail -f /tmp/fireit-server.log   # 启动时重定向到这里
   ```
   找 `⚠ 执行出错` 或静默失败(没任何痕迹 = 异步链没起来/被 catch 吞了)

5. **posture 判断卡住?**(brainstorm 特有)
   - judge 对每个 agent 跑一次 LLM,某个 CLI 卡住 → `Promise.all` 永不 resolve → 全员都不回
   - 确认:看 server 日志有没有 `判断要不要发言` 之后的 `执行中`/`空闲` 状态变化

---

## 场景 5:验证身份注入是否生效(system role)

```bash
# 跑一次带身份的 codex,看 transcript 里 role=developer 有没有身份
echo "hi" | /opt/homebrew/bin/codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -c 'developer_instructions=你是 Forge,后端工程师' > /tmp/t.json 2>/dev/null
# 找最新 session 文件
F=$(ls -t ~/.codex/sessions/2026/*/*.jsonl | head -1)
python3 -c "
import json
with open('$F') as f:
    for line in f:
        d=json.loads(line)
        if d.get('type')=='response_item':
            p=d.get('payload',{})
            if p.get('type')=='message' and p.get('role')=='developer':
                for c in p.get('content',[]):
                    t=c.get('text','')
                    if 'Forge' in t: print('✓ 身份进了 developer role:',t[:80])
"
```

---

## 速查:关键路径

| 东西 | 位置 |
|---|---|
| fireit DB | `.fireit/fireit.db` |
| agent workspace | `.fireit/agents/<agentId>/`(MEMORY.md + notes/ + .git) |
| codex session transcript | `~/.codex/sessions/YYYY/M/D/rollout-*.jsonl` |
| codex session 索引 | `~/.codex/session_index.jsonl` |
| claude session transcript | `~/.claude/projects/<cwd编码>/<sessionId>.jsonl` |
| server 日志 | `/tmp/fireit-server.log`(启动时重定向) |
| web 日志 | `/tmp/fireit-web.log` |
| CLI 二进制 | `/opt/homebrew/bin/{claude,codex}` |
