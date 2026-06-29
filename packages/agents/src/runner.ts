// packages/agents/src/runner.ts
// AgentRunner：spawn 子进程 + 流式捕获 + 归一化（对齐 m2-agent-adapters.md §4）
//   1. 根据 adapterType 选 spec
//   2. 构造 prompt：identityPrompt + context + task 拼接
//   3. spawn 子进程，传入对应 CLI 命令
//   4. 逐行读 stdout（NDJSON），交给 normalizeLine
//   5. yield AgentOutputChunk（AsyncIterable）
//   6. 捕获 stderr / exit code → error chunk
//   abort(agentId): kill 子进程（user 打回 / retry）

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type { AdapterType, AgentId, AgentInvokeInput, AgentOutputChunk } from '@fireit/shared';
import { claudeCodeSpec } from './adapters/claude-code.js';
import { codexSpec } from './adapters/codex.js';
import { geminiSpec } from './adapters/gemini-cli.js';
import type { AdapterSpec } from './base-adapter.js';
import { composePrompt } from './base-adapter.js';
import { normalizeLine, parseNdjsonLine } from './normalize.js';

export function specFor(type: AdapterType): AdapterSpec {
  switch (type) {
    case 'claude-code':
      return claudeCodeSpec;
    case 'codex':
      return codexSpec;
    case 'gemini-cli':
      return geminiSpec;
    default:
      throw new Error(`unknown adapter type: ${type as string}`);
  }
}

// 可注入的 spawn 函数（测试用 mock）
export type SpawnFn = (
  binary: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; promptViaStdin: boolean; prompt: string },
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnFn = (binary, args, opts) => {
  const child = spawn(binary, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (opts.promptViaStdin && child.stdin) {
    child.stdin.write(opts.prompt);
    child.stdin.end();
  }
  return child;
};

// 把子进程 stdout（NDJSON 流）转成归一化的 chunk 流
async function* streamChunks(
  child: ChildProcessWithoutNullStreams,
  type: AdapterType,
): AsyncIterable<AgentOutputChunk> {
  let buffer = '';
  for await (const data of child.stdout) {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const raw = parseNdjsonLine(line);
      if (raw === null) continue;
      yield* normalizeLine(type, raw);
    }
  }
  // flush 残行
  const tail = parseNdjsonLine(buffer);
  if (tail !== null) yield* normalizeLine(type, tail);
}

export class AgentRunner {
  private active = new Map<AgentId, ChildProcessWithoutNullStreams>();
  private spawnFn: SpawnFn;

  constructor(spawnFn: SpawnFn = defaultSpawn) {
    this.spawnFn = spawnFn;
  }

  // spawn 子进程，注入 identity，流式捕获，归一化输出
  async *run(
    input: AgentInvokeInput,
    type: AdapterType,
    opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ): AsyncIterable<AgentOutputChunk> {
    const spec = specFor(type);
    const prompt = composePrompt({
      identityPrompt: input.identityPrompt,
      context: input.context,
      task: input.task,
    });
    const args = spec.buildArgs(spec.promptViaStdin ? '' : prompt, { resumeId: input.resumeId });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn(spec.binary, args, {
        cwd: opts.cwd,
        env: opts.env,
        promptViaStdin: spec.promptViaStdin,
        prompt,
      });
    } catch (err) {
      yield { kind: 'error', message: `failed to spawn ${spec.binary}: ${(err as Error).message}` };
      return;
    }

    this.active.set(input.agentId, child);

    let stderrText = '';
    child.stderr.on('data', (d) => {
      stderrText += d.toString();
    });

    // 退出 promise：等子进程真正退出后再判定 exit code
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
    });

    try {
      yield* streamChunks(child, type);
    } catch (err) {
      yield { kind: 'error', message: `stream error: ${(err as Error).message}` };
    } finally {
      this.active.delete(input.agentId);
    }

    // 等子进程退出，再判定 exit code（非 0 → error chunk）
    const exitCode = await exited;
    if (exitCode !== null && exitCode !== 0) {
      const msg = stderrText.trim() || `${spec.binary} exited with code ${exitCode}`;
      yield { kind: 'error', message: msg };
    }
  }

  // 中断当前执行（user 打回 / retry）
  abort(agentId: AgentId): boolean {
    const child = this.active.get(agentId);
    if (!child) return false;
    try {
      child.kill('SIGTERM');
    } catch {
      // 忽略
    }
    this.active.delete(agentId);
    return true;
  }
}
