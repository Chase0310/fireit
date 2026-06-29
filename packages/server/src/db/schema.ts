// packages/server/src/db/schema.ts
// Drizzle 表定义（对齐 subsystems.md §6.2）
// tasks/steps 是派生投影；task_events 是 append-only 真相源。

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// task 投影表
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  vision: text('vision').notNull(),
  status: text('status').notNull(),
  leadAgentId: text('lead_agent_id'),
  createdAt: integer('created_at').notNull(),
  acceptedAt: integer('accepted_at'),
});

// step 投影表
export const steps = sqliteTable('steps', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  title: text('title').notNull(),
  instruction: text('instruction').notNull(),
  acceptance: text('acceptance').notNull(),
  assignedAgentId: text('assigned_agent_id'),
  dependenciesJson: text('dependencies_json').notNull(), // JSON: string[]
  status: text('status').notNull(),
  retryCount: integer('retry_count').notNull().default(0),
  orderIdx: integer('order_idx').notNull(),
});

// agent 表(定义层持久化:DB 唯一真源,web 可增删改)
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  specialtiesJson: text('specialties_json').notNull(),
  restrictionsJson: text('restrictions_json').notNull(),
  adapterType: text('adapter_type').notNull(),
  modelFamily: text('model_family').notNull(),
  rolesJson: text('roles_json').notNull(),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  color: text('color'),
  personality: text('personality'),
  effort: text('effort').notNull().default('medium'), // 思考等级 minimal/low/medium/high
  createdAt: integer('created_at'),
  createdBy: text('created_by'),
  status: text('status').notNull().default('idle'),
});

// agent 运行时 session 绑定(per-agent 全局单一 active;对齐 design 运行时层)
export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  adapterType: text('adapter_type').notNull(),
  cliSessionId: text('cli_session_id'), // CLI 报回的真实 session id;首次 invoke 后回填
  status: text('status').notNull().default('active'), // 'active' | 'sealed'
  createdAt: integer('created_at').notNull(),
  sealedAt: integer('sealed_at'),
});

// task 事件流（append-only，真相源）
export const taskEvents = sqliteTable('task_events', {
  eventId: text('event_id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  kind: text('kind').notNull(),
  classification: text('classification').notNull(),
  payloadJson: text('payload_json').notNull(),
  at: integer('at').notNull(),
});

// run 记录（agent 执行）
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id'),
  stepId: text('step_id'),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  logPath: text('log_path'),
  tokenUsage: integer('token_usage'),
  at: integer('at').notNull(),
});

// 互审结果记录
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  authorId: text('author_id').notNull(),
  verdict: text('verdict').notNull(),
  findingsJson: text('findings_json').notNull(),
  decisionBasis: text('decision_basis').notNull(),
  at: integer('at').notNull(),
});

// 介入决策
export const interventions = sqliteTable('interventions', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  taskId: text('task_id'),
  trigger: text('trigger').notNull(),
  needsHuman: integer('needs_human', { mode: 'boolean' }).notNull(),
  basis: text('basis').notNull(),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
  at: integer('at').notNull(),
});

// 会话(头脑风暴/有向协作)
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  mode: text('mode').notNull().default('brainstorm'),
  taskId: text('task_id'),
  title: text('title'), // 取首条用户消息前若干字
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 会话消息(持久化;内存 Map 作为缓存)
export const threadMessages = sqliteTable('thread_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => threads.id),
  kind: text('kind').notNull(),
  sender: text('sender').notNull(),
  dataJson: text('data_json').notNull(), // 完整 ThreadMessage 的 JSON
  at: integer('at').notNull(),
});
