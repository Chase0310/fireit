// packages/agents/src/normalize.ts
// 各 CLI 的 NDJSON 行 → AgentOutputChunk 归一化映射（对齐 m2-agent-adapters.md §3）
// 归一化层是隔离 CLI schema 变化的屏障——schema 变了只改这里。

import type { AdapterType, AgentOutputChunk } from '@fireit/shared';

// 把一行 JSON 文本解析成对象；无法解析或空行 → null
export function parseNdjsonLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// 未知 JSON 对象的宽松访问辅助
type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// ─── Claude Code（stream-json）────────────────────────────────────
//   { type: "assistant", message: { content: [{type:"text",text}, {type:"tool_use",name,input}] } } → text/tool_call/file_change
//   { type: "result", result: "..." } → done
//   { type: "system", ... } → 忽略（informational）
export function normalizeClaudeLine(raw: unknown): AgentOutputChunk[] {
  if (!isObj(raw)) return [];
  const t = raw['type'];
  // 首行 system/init(或任意 system 行带 session_id)→ session_bound
  if (t === 'system' && typeof raw['session_id'] === 'string') {
    return [{ kind: 'session_bound', sessionId: raw['session_id'] }];
  }
  if (t === 'assistant') {
    const message = raw['message'];
    if (!isObj(message)) return [];
    const content = message['content'];
    if (!Array.isArray(content)) return [];
    const chunks: AgentOutputChunk[] = [];
    for (const part of content) {
      if (!isObj(part)) continue;
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        chunks.push({ kind: 'text', content: part['text'] });
      } else if (part['type'] === 'thinking' && typeof part['thinking'] === 'string') {
        // 思考块(extended thinking)——还原"它在想"的临场感
        chunks.push({ kind: 'thinking', content: part['thinking'] });
      } else if (part['type'] === 'tool_use') {
        const name = typeof part['name'] === 'string' ? part['name'] : 'unknown';
        const id = typeof part['id'] === 'string' ? part['id'] : '';
        chunks.push(...toolUseToChunk(name, part['input'], id));
      }
    }
    return chunks;
  }
  if (t === 'user') {
    // user message 里的 content 是 tool_result(工具返回值)——保留,折叠展示
    const message = raw['message'];
    if (!isObj(message)) return [];
    const content = message['content'];
    if (!Array.isArray(content)) return [];
    const chunks: AgentOutputChunk[] = [];
    for (const part of content) {
      if (!isObj(part)) continue;
      if (part['type'] === 'tool_result') {
        const toolUseId = typeof part['tool_use_id'] === 'string' ? part['tool_use_id'] : '';
        let resultContent = '';
        const c = part['content'];
        if (typeof c === 'string') resultContent = c;
        else if (Array.isArray(c)) {
          // content 可能是 [{type:'text',text}] 数组
          resultContent = c
            .map((x) => (isObj(x) && typeof x['text'] === 'string' ? x['text'] : ''))
            .join('');
        }
        chunks.push({
          kind: 'tool_result',
          toolUseId,
          content: resultContent,
          isError: part['is_error'] === true,
        });
      }
    }
    return chunks;
  }
  if (t === 'result') {
    const result = typeof raw['result'] === 'string' ? raw['result'] : '';
    const isError = raw['is_error'] === true;
    if (isError) return [{ kind: 'error', message: result || 'claude result error' }];
    return [{ kind: 'done', summary: result }];
  }
  // system / 其他 → 忽略
  return [];
}

// ─── Codex（NDJSON）───────────────────────────────────────────────
//   { type: "thread.started" | "turn.started" } → 忽略
//   { item: { type: "reasoning", text } } → thinking
//   { item: { type: "agent_message", text } } → text
//   { item: { type: "function_call", name, arguments } } → tool_call/file_change
//   { item: { type: "command_execution", command, aggregated_output, exit_code } } → tool_call + tool_result
//   { type: "turn.completed" } → done
export function normalizeCodexLine(raw: unknown): AgentOutputChunk[] {
  if (!isObj(raw)) return [];
  const t = raw['type'];
  // 首行 session_meta → session_bound(payload.session_id)
  if (t === 'session_meta') {
    const payload = raw['payload'];
    if (isObj(payload)) {
      const sid =
        typeof payload['session_id'] === 'string'
          ? payload['session_id']
          : typeof payload['id'] === 'string'
            ? payload['id']
            : '';
      if (sid) return [{ kind: 'session_bound', sessionId: sid }];
    }
    return [];
  }
  // item.started / item.completed 都带 item;completed 时有最终 output
  if (t === 'item.completed' || t === 'item.started') {
    const item = raw['item'];
    if (!isObj(item)) return [];
    const itemType = item['type'];
    // 思考块
    if (itemType === 'reasoning' && typeof item['text'] === 'string') {
      return [{ kind: 'thinking', content: item['text'] }];
    }
    // 回复文本
    if (itemType === 'agent_message' && typeof item['text'] === 'string') {
      return [{ kind: 'text', content: item['text'] }];
    }
    // 工具调用(原生函数调用)
    if (itemType === 'function_call') {
      const name = typeof item['name'] === 'string' ? item['name'] : 'unknown';
      let args: unknown = item['arguments'];
      if (typeof args === 'string') {
        args = parseNdjsonLine(args) ?? args;
      }
      return toolUseToChunk(name, args);
    }
    // 命令执行(Shell)—— command + 可能的输出/退出码
    if (itemType === 'command_execution') {
      const chunks: AgentOutputChunk[] = [];
      const command = typeof item['command'] === 'string' ? item['command'] : '';
      // tool_call:展示命令
      chunks.push({ kind: 'tool_call', tool: 'shell', input: { command } });
      // completed 时带输出 + exit_code → tool_result
      const output = typeof item['aggregated_output'] === 'string' ? item['aggregated_output'] : '';
      const exitCode = item['exit_code'];
      if (output || exitCode !== null) {
        chunks.push({
          kind: 'tool_result',
          toolUseId: typeof item['id'] === 'string' ? item['id'] : '',
          content: output,
          isError: exitCode !== null && exitCode !== undefined && exitCode !== 0,
        });
      }
      return chunks;
    }
    return [];
  }
  if (t === 'turn.completed') {
    return [{ kind: 'done', summary: 'codex turn completed' }];
  }
  // thread.started / turn.started / 其他 → 忽略
  return [];
}

// ─── Gemini CLI（JSONL）───────────────────────────────────────────
//   { type: "text", text } → text
//   { type: "functionCall", name, args } → tool_call/file_change
//   { type: "turnComplete" } → done
//   { type: "open" } → 忽略
export function normalizeGeminiLine(raw: unknown): AgentOutputChunk[] {
  if (!isObj(raw)) return [];
  const t = raw['type'];
  if (t === 'text' && typeof raw['text'] === 'string') {
    return [{ kind: 'text', content: raw['text'] }];
  }
  if (t === 'functionCall') {
    const name = typeof raw['name'] === 'string' ? raw['name'] : 'unknown';
    return toolUseToChunk(name, raw['args']);
  }
  if (t === 'turnComplete') {
    return [{ kind: 'done', summary: 'gemini turn completed' }];
  }
  // open / 其他 → 忽略
  return [];
}

// 工具调用归一化：文件编辑类工具 → file_change；其余 → tool_call
const FILE_EDIT_TOOLS = new Set([
  'edit',
  'edit_file',
  'write',
  'write_file',
  'str_replace_editor',
  'multi_edit',
  'replace',
  'create_file',
  'notebookedit',
]);

function toolUseToChunk(tool: string, input: unknown, toolUseId = ''): AgentOutputChunk[] {
  const args = isObj(input) ? input : {};
  const lower = tool.toLowerCase();
  if (
    FILE_EDIT_TOOLS.has(lower) ||
    lower.includes('edit') ||
    lower.includes('write') ||
    lower === 'writefile'
  ) {
    const path =
      typeof args['file_path'] === 'string'
        ? args['file_path']
        : typeof args['path'] === 'string'
          ? args['path']
          : '<unknown>';
    const oldStr = typeof args['old_string'] === 'string' ? args['old_string'] : '';
    const newStr = typeof args['new_string'] === 'string' ? args['new_string'] : '';
    const content = typeof args['content'] === 'string' ? args['content'] : '';
    // 构造一个简易 diff 串
    const diff = content
      ? `+ ${content.split('\n').join('\n+ ')}`
      : oldStr || newStr
        ? `--- old\n${oldStr}\n+++ new\n${newStr}`
        : '';
    return [{ kind: 'file_change', path, diff }];
  }
  return [{ kind: 'tool_call', tool, input: input ?? {}, ...(toolUseId ? { toolUseId } : {}) }];
}

// 按 adapter 类型分发
export function normalizeLine(type: AdapterType, raw: unknown): AgentOutputChunk[] {
  switch (type) {
    case 'claude-code':
      return normalizeClaudeLine(raw);
    case 'codex':
      return normalizeCodexLine(raw);
    case 'gemini-cli':
      return normalizeGeminiLine(raw);
    default:
      return [];
  }
}
