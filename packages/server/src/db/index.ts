// packages/server/src/db/index.ts
// better-sqlite3 连接 + Drizzle + 迁移（建表）
// 数据库文件：.fireit/fireit.db（gitignored）。集成测试用 :memory: 或临时文件。

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type DBClient = BetterSQLite3Database<typeof schema>;
export type RawDB = DB;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  vision TEXT NOT NULL,
  status TEXT NOT NULL,
  lead_agent_id TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  assigned_agent_id TEXT,
  dependencies_json TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  order_idx INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  specialties_json TEXT NOT NULL,
  restrictions_json TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  model_family TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  personality TEXT,
  effort TEXT NOT NULL DEFAULT 'medium',
  created_at INTEGER,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'idle'
);
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL,
  classification TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  step_id TEXT,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  log_path TEXT,
  token_usage INTEGER,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  decision_basis TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  task_id TEXT,
  trigger TEXT NOT NULL,
  needs_human INTEGER NOT NULL,
  basis TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'brainstorm',
  task_id TEXT,
  dm_agent_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  kind TEXT NOT NULL,
  sender TEXT NOT NULL,
  data_json TEXT NOT NULL,
  at INTEGER NOT NULL
);
`;

// agent 运行时 session 绑定表(per-agent 全局单一 active;对齐 design 运行时层)
export const ALTER_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  adapter_type TEXT NOT NULL,
  cli_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  sealed_at INTEGER
);
`;

export interface OpenOptions {
  /** 数据库文件路径；':memory:' 用内存库。默认 .fireit/fireit.db */
  path?: string;
  /** 是否建表（首次/迁移）。默认 true */
  migrate?: boolean;
}

export interface DbHandle {
  raw: RawDB;
  db: DBClient;
  path: string;
  close(): void;
}

export function openDb(opts: OpenOptions = {}): DbHandle {
  const path = opts.path ?? '.fireit/fireit.db';
  if (path !== ':memory:' && opts.migrate !== false) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  const db = drizzle(raw, { schema });
  if (opts.migrate !== false) {
    raw.exec(SCHEMA_SQL);
    raw.exec(ALTER_TABLES_SQL);
    upgradeAgentsColumns(raw);
    upgradeThreadsColumns(raw);
  }
  return { raw, db, path, close: () => raw.close() };
}

// 已有 agents 表补列(幂等:已存在的列跳过;SQLite 无 ADD COLUMN IF NOT EXISTS)
function upgradeAgentsColumns(raw: RawDB): void {
  const cols = raw.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const addIfMissing = (col: string, def: string) => {
    if (!have.has(col)) raw.exec(`ALTER TABLE agents ADD COLUMN ${col} ${def}`);
  };
  addIfMissing('color', 'TEXT');
  addIfMissing('personality', 'TEXT');
  addIfMissing('effort', "TEXT NOT NULL DEFAULT 'medium'");
  addIfMissing('created_at', 'INTEGER');
  addIfMissing('created_by', 'TEXT');
  addIfMissing('status', "TEXT NOT NULL DEFAULT 'idle'");
}

// 已有 threads 表补列(幂等:DM 模式加 dm_agent_id)
function upgradeThreadsColumns(raw: RawDB): void {
  const cols = raw.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  if (!have.has('dm_agent_id')) raw.exec('ALTER TABLE threads ADD COLUMN dm_agent_id TEXT');
}

// 临时文件数据库（集成测试用，测完销毁）
export function openTempDb(): DbHandle {
  return openDb({ path: ':memory:' });
}
