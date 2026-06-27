# M2 agent 适配器实现方案

> 把 Claude Code / Codex / Gemini CLI 统一成一套契约。屏蔽三者输出 schema 差异。

| 字段 | 值 |
|------|-----|
| 里程碑 | M2 |
| 位置 | `packages/agents/src/` |
| 前置 | M1 完成（agents 依赖 shared 类型） |
| 验收 | 三个 CLI 都能 spawn + 流式捕获，输出归一化为统一 chunk |

---

## 0. 关键事实（三 CLI 接口已核实）

三者**都支持 NDJSON 流式输出**（每行一个 JSON 对象），但各自 schema 不同：

| CLI | 命令 | 输出格式 | 认证 |
|-----|------|---------|------|
| **Claude Code** | `claude -p "<prompt>" --output-format stream-json --verbose` | stream-json（每行 JSON） | API key / subscription（`~/.claude`） |
| **Codex** | `codex exec --json "<prompt>"` | JSON Lines（NDJSON） | API key（`~/.codex/auth.json`） |
| **Gemini CLI** | `gemini --output-format stream-json "<prompt>"`（需 v0.11.0+） | JSONL 事件流 | API key / Google 账号（`~/.gemini`） |

> 来源：[Claude headless](https://code.claude.com/docs/en/headless)、[Codex non-interactive](https://developers.openai.com/codex/noninteractive)、[Gemini CLI headless](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)

---

## 1. 要实现什么

```
packages/agents/src/
├── base-adapter.ts          # AgentAdapter 接口 + AgentOutputChunk 类型
├── runner.ts                # spawn 子进程 + 流式捕获 + 归一化
├── adapters/
│   ├── claude-code.ts       # stream-json → AgentOutputChunk
│   ├── codex.ts             # NDJSON → AgentOutputChunk
│   └── gemini-cli.ts        # JSONL → AgentOutputChunk
├── normalize.ts             # 每个 adapter 的 schema → AgentOutputChunk 归一化映射
├── health.ts                # 检测 CLI 是否安装/认证
└── __tests__/
    ├── normalize.test.ts    # 各 CLI 的 JSON 行 → chunk 归一化（用 fixture）
    └── runner.test.ts       # spawn + 流式（mock 子进程）
```

---

## 2. 核心契约（对齐 subsystems.md §5.1）

```typescript
// base-adapter.ts
interface AgentAdapter {
  type: AdapterType;
  invoke(input: AgentInvokeInput): AsyncIterable<AgentOutputChunk>;
  healthCheck(): Promise<HealthStatus>;
}

interface AgentInvokeInput {
  agentId: AgentId;
  identityPrompt: string;   // 身份注入（"你是 Atlas，角色..."）
  context: string;          // 对话历史 + team 名册 + task 上下文
  task: string;             // 当前 step 指令
}

type AgentOutputChunk =
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; tool: string; args: unknown }
  | { kind: 'file_change'; path: string; diff: string }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string };

interface HealthStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
}
```

**关键**：上层（task 引擎 / a2a）只消费 `AgentOutputChunk`，不关心底层是哪个 CLI。

---

## 3. 归一化策略（M2 的核心难点）

每个 adapter 把自己 CLI 的 NDJSON 行翻译成 `AgentOutputChunk`。映射在 `normalize.ts`：

### 3.1 Claude Code（stream-json）

```
Claude stream-json 每行 schema（示例字段）:
  { type: "assistant", message: { content: [...] } }     → text
  { type: "tool_use", name: "edit_file", input: {...} }  → tool_call / file_change
  { type: "result", result: "..." }                      → done
```

### 3.2 Codex（NDJSON）

```
Codex NDJSON 每行 schema（示例字段）:
  { type: "message", content: "..." }                    → text
  { type: "function_call", name: "...", arguments: ... } → tool_call
  { type: "completed", ... }                             → done
```

### 3.3 Gemini CLI（JSONL）

```
Gemini JSONL 每行 schema（示例字段）:
  { type: "text", text: "..." }                          → text
  { type: "functionCall", name: "...", args: {...} }     → tool_call
  { type: "turnComplete", ... }                          → done
```

> ⚠️ 上述各 CLI 的精确字段名需在 M2 实现时用真实输出 fixture 核对（三者 schema 可能随版本变）。归一化层是隔离变化的屏障——schema 变了只改 normalize.ts。

---

## 4. runner 实现规格

```typescript
// runner.ts
class AgentRunner {
  // 1. 根据 adapterType 选 adapter
  // 2. 构造 prompt：identityPrompt + context + task 拼接
  // 3. spawn 子进程，传入对应 CLI 命令
  // 4. 逐行读 stdout（NDJSON），交给 adapter.normalize()
  // 5. yield AgentOutputChunk（AsyncIterable）
  // 6. 捕获 stderr / exit code → error chunk
  run(input: AgentInvokeInput, adapter: AgentAdapter): AsyncIterable<AgentOutputChunk>;

  // 中断（user 打回 / retry）
  abort(agentId: AgentId): void;  // kill 子进程
}
```

**身份注入方式**：identityPrompt + context + task 拼成完整 prompt，作为 CLI 的 `-p`/`exec` 参数传入。

---

## 5. healthCheck 实现

```typescript
// health.ts
// Claude Code: 检测 `claude --version` + ~/.claude 存在
// Codex:       检测 `codex --version` + ~/.codex/auth.json 存在
// Gemini CLI:  检测 `gemini --version` + ~/.gemini 存在
async function checkHealth(type: AdapterType): Promise<HealthStatus>;
```

---

## 6. 测试策略

| 测试 | 内容 |
|------|------|
| **归一化测试** | 每个 adapter：拿真实录制的 NDJSON fixture 行 → 断言翻译成正确的 AgentOutputChunk |
| **runner 测试** | mock 子进程（spawn stub）→ 断言流式 yield 正确序列 |
| **错误处理** | CLI 未安装 / 未认证 / 非 0 退出 → error chunk |
| **abort** | abort() 后子进程被 kill，流终止 |

> fixture 来源：M2 实现时实际跑一次每个 CLI，录几行真实 NDJSON 存为测试 fixture。

---

## 7. M2 验收清单

- [ ] `packages/agents` 包创建，依赖 `@fireit/shared`
- [ ] 三个 adapter（claude-code/codex/gemini-cli）实现，输出归一化为 AgentOutputChunk
- [ ] `AgentRunner` 能 spawn 三个 CLI 之一并流式捕获
- [ ] `healthCheck()` 能检测 CLI 安装/认证状态
- [ ] 归一化测试（用真实 fixture）通过
- [ ] 能和至少一个真实 CLI 对话（手动验证）

---

## 8. M2 不做

- ❌ MCP 工具桥接（V1.5+）
- ❌ identity 的性格养成（V1.5，M2 只注入静态身份 prompt）
- ❌ 接到 task 引擎（M3 才接）
- ❌ UI

---

## 9. 依赖

**agents**：`@fireit/shared`（类型）、`vitest`（测试）、`typescript`
运行时：Node `child_process`（spawn）

---

## 10. 风险

| 风险 | 应对 |
|------|------|
| 三 CLI 的 NDJSON schema 随版本变 | 归一化层隔离；schema 变只改 normalize.ts |
| Codex `--json` 文档过时（已知 issue #4776） | 用真实 fixture 而非文档为准 |
| Gemini stream-json 需 v0.11.0+ | healthCheck 检测版本，不满足降级为 `--output-format json`（非流式） |

---

*本方案是 M2 agent 适配器的实现依据。完成后进 M3（task 流程接线）。*
