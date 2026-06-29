// packages/server/src/services/agent-service.ts
// AgentService —— agent 的三层状态管理者(对齐 design 三层心智模型):
//   定义层:DB agents 表 ↔ TeamRegistry 同步(seed/create/edit/delete)
//   运行时层:agent_sessions 表(per-agent 全局单一 active;resume/rotate)
//   工作区层:.fireit/agents/<id>/ + 种子 MEMORY.md + git init(git checkout 作 reset 锚点)

import { TeamRegistry } from '@fireit/core';
import type {
  AdapterType,
  Agent,
  AgentId,
  AgentRole,
  AgentStatus,
  ModelFamily,
  SeedSpec,
} from '@fireit/shared';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/index.js';
import { agentSessions, agents } from '../db/schema.js';

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

export interface CreateAgentInput {
  handle: string;
  name: string;
  role: string;
  specialties: string[];
  restrictions: string[];
  adapterType: AdapterType;
  modelFamily: ModelFamily;
  roles: AgentRole[];
  color?: string;
  personality?: string;
  createdBy?: string;
}

export interface AgentServiceDeps {
  db: DbHandle;
  registry: TeamRegistry;
  workspaceRoot: string; // 默认 '.fireit/agents'
}

export interface SessionRow {
  id: string;
  agentId: string;
  adapterType: AdapterType;
  cliSessionId: string | null;
  status: 'active' | 'sealed';
  createdAt: number;
  sealedAt: number | null;
}

export class AgentService {
  constructor(private deps: AgentServiceDeps) {}

  // ── 定义层 ────────────────────────────────────────────
  // 启动时:把 seed 写入 DB(若不存在),然后把 DB 全量加载进 registry
  seedAndLoad(seeds: SeedSpec[]): void {
    const have = new Set(this.deps.db.db.select().from(agents).all().map((r) => r.id));
    const now = Date.now();
    for (const s of seeds) {
      if (have.has(s.agentId)) continue;
      this.deps.db.db
        .insert(agents)
        .values({
          id: s.agentId,
          handle: s.handle,
          name: s.name,
          role: s.role,
          specialtiesJson: JSON.stringify(s.specialties),
          restrictionsJson: JSON.stringify(s.restrictions),
          adapterType: s.adapterType,
          modelFamily: s.modelFamily,
          rolesJson: JSON.stringify(s.roles),
          available: s.available,
          color: s.color,
          personality: s.personality,
          createdAt: now,
          createdBy: 'system',
          status: 'idle',
        })
        .run();
    }
    this.reloadRegistry();
  }

  // 从 DB 全量加载到 registry(并确保 workspace 存在)
  reloadRegistry(): void {
    this.deps.registry.clear();
    const rows = this.deps.db.db.select().from(agents).all();
    for (const r of rows) {
      this.deps.registry.register(rowToAgent(r));
      this.ensureWorkspace(r.id);
    }
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const id = newId('agent');
    const now = Date.now();
    this.deps.db.db
      .insert(agents)
      .values({
        id,
        handle: input.handle,
        name: input.name,
        role: input.role,
        specialtiesJson: JSON.stringify(input.specialties),
        restrictionsJson: JSON.stringify(input.restrictions),
        adapterType: input.adapterType,
        modelFamily: input.modelFamily,
        rolesJson: JSON.stringify(input.roles),
        available: true,
        color: input.color ?? null,
        personality: input.personality ?? null,
        createdAt: now,
        createdBy: input.createdBy ?? 'web',
        status: 'idle',
      })
      .run();
    const row = this.deps.db.db.select().from(agents).where(eq(agents.id, id)).get();
    if (!row) throw new Error('failed to read created agent');
    const ag = rowToAgent(row);
    this.deps.registry.register(ag);
    this.ensureWorkspace(id);
    return ag;
  }

  async editAgent(
    id: AgentId,
    patch: Partial<Omit<CreateAgentInput, 'handle'>> & { available?: boolean; status?: AgentStatus },
  ): Promise<Agent | null> {
    const exists = this.deps.db.db.select().from(agents).where(eq(agents.id, id)).get();
    if (!exists) return null;
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name;
    if (patch.role !== undefined) upd.role = patch.role;
    if (patch.specialties !== undefined) upd.specialtiesJson = JSON.stringify(patch.specialties);
    if (patch.restrictions !== undefined) upd.restrictionsJson = JSON.stringify(patch.restrictions);
    if (patch.adapterType !== undefined) upd.adapterType = patch.adapterType;
    if (patch.modelFamily !== undefined) upd.modelFamily = patch.modelFamily;
    if (patch.roles !== undefined) upd.rolesJson = JSON.stringify(patch.roles);
    if (patch.color !== undefined) upd.color = patch.color;
    if (patch.personality !== undefined) upd.personality = patch.personality;
    if (patch.available !== undefined) upd.available = patch.available;
    if (patch.status !== undefined) upd.status = patch.status;
    if (Object.keys(upd).length > 0) {
      this.deps.db.db.update(agents).set(upd).where(eq(agents.id, id)).run();
    }
    const row = this.deps.db.db.select().from(agents).where(eq(agents.id, id)).get();
    if (!row) return null;
    const ag = rowToAgent(row);
    this.deps.registry.register(ag);
    return ag;
  }

  async deleteAgent(id: AgentId): Promise<boolean> {
    const exists = this.deps.db.db.select().from(agents).where(eq(agents.id, id)).get();
    if (!exists) return false;
    this.deps.db.raw.prepare('DELETE FROM agent_sessions WHERE agent_id = ?').run(id);
    this.deps.db.db.delete(agents).where(eq(agents.id, id)).run();
    this.deps.registry.remove(id);
    try {
      rmSync(join(this.deps.workspaceRoot, id), { recursive: true, force: true });
    } catch {
      // 忽略
    }
    return true;
  }

  listAgents(): Agent[] {
    return this.deps.db.db
      .select()
      .from(agents)
      .all()
      .map(rowToAgent);
  }

  // ── 运行时层(session)──────────────────────────────────
  // 取该 agent 当前 active session;不存在则建一个(cliSessionId 待回填)
  getOrCreateActiveSession(agentId: AgentId): SessionRow {
    const row = this.deps.db.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.agentId, agentId))
      .all()
      .filter((r) => r.status === 'active')[0];
    if (row) return toSessionRow(row);
    const ag = this.deps.db.db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!ag) throw new Error(`agent not found: ${agentId}`);
    const id = newId('sess');
    const now = Date.now();
    this.deps.db.db
      .insert(agentSessions)
      .values({
        id,
        agentId,
        adapterType: ag.adapterType,
        cliSessionId: null,
        status: 'active',
        createdAt: now,
        sealedAt: null,
      })
      .run();
    const created = this.deps.db.db.select().from(agentSessions).where(eq(agentSessions.id, id)).get();
    if (!created) throw new Error('failed to read created session');
    return toSessionRow(created);
  }

  // CLI 报回 session id 后回填(若当前 active 尚未绑定)
  bindSessionId(agentId: AgentId, cliSessionId: string): void {
    const cur = this.deps.db.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.agentId, agentId))
      .all()
      .filter((r) => r.status === 'active')[0];
    if (!cur || cur.cliSessionId) return; // 已绑定或无 active,不覆盖
    this.deps.db.db
      .update(agentSessions)
      .set({ cliSessionId })
      .where(eq(agentSessions.id, cur.id))
      .run();
  }

  // 取 resumeId(active session 的 cliSessionId;null 表示新 session)
  getResumeId(agentId: AgentId): string | undefined {
    const s = this.getOrCreateActiveSession(agentId);
    return s.cliSessionId ?? undefined;
  }

  // RESET SESSION:把当前 active 标 sealed(下次自动开新 session)
  resetSession(agentId: AgentId): void {
    const now = Date.now();
    this.deps.db.db
      .update(agentSessions)
      .set({ status: 'sealed', sealedAt: now })
      .where(eq(agentSessions.agentId, agentId))
      .run();
  }

  // ── 工作区层 ──────────────────────────────────────────
  workspaceDir(agentId: AgentId): string {
    return join(this.deps.workspaceRoot, agentId);
  }

  // 确保目录 + 种子 MEMORY.md + git init(幂等)
  ensureWorkspace(agentId: AgentId): void {
    const dir = this.workspaceDir(agentId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ag = this.deps.db.db.select().from(agents).where(eq(agents.id, agentId)).get();
    const memoryPath = join(dir, 'MEMORY.md');
    if (!existsSync(memoryPath) && ag) {
      writeFileSync(
        memoryPath,
        seedMemory(ag.name, ag.handle, ag.role, ag.personality, JSON.parse(ag.specialtiesJson)),
        'utf8',
      );
    }
    const gitDir = join(dir, '.git');
    if (!existsSync(gitDir)) {
      this.git(dir, 'init');
      this.git(dir, 'add', '-A');
      this.git(dir, 'commit', '-m', 'init', '--allow-empty');
    }
  }

  // FULL RESET:git checkout 回 init(擦 agent 记忆演化,留种子)+ 轮转 session
  async fullReset(agentId: AgentId): Promise<void> {
    this.ensureWorkspace(agentId);
    const dir = this.workspaceDir(agentId);
    // 回 init(已跟踪文件的改动)+ 清未跟踪文件(notes/ 等)
    this.git(dir, 'checkout', '--', '.');
    this.git(dir, 'clean', '-fd');
    this.resetSession(agentId);
  }

  // agent 写文件的场地(cwd 传给 CLI)
  cwdFor(agentId: AgentId): string {
    this.ensureWorkspace(agentId);
    return this.workspaceDir(agentId);
  }

  private git(dir: string, ...args: string[]): void {
    try {
      execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    } catch {
      // git 不可用时降级:FULL RESET 仅清 session,不动文件
    }
  }
}

// ── 行 → Agent 映射 ─────────────────────────────────────
function rowToAgent(r: typeof agents.$inferSelect): Agent {
  return {
    agentId: r.id,
    handle: r.handle,
    name: r.name,
    role: r.role,
    specialties: JSON.parse(r.specialtiesJson),
    restrictions: JSON.parse(r.restrictionsJson),
    adapterType: r.adapterType as AdapterType,
    modelFamily: r.modelFamily as ModelFamily,
    roles: JSON.parse(r.rolesJson),
    available: r.available,
    color: r.color ?? undefined,
    personality: r.personality ?? undefined,
    createdAt: r.createdAt ?? undefined,
    createdBy: r.createdBy ?? undefined,
    status: (r.status ?? 'idle') as AgentStatus,
  };
}

function toSessionRow(r: typeof agentSessions.$inferSelect): SessionRow {
  return {
    id: r.id,
    agentId: r.agentId,
    adapterType: r.adapterType as AdapterType,
    cliSessionId: r.cliSessionId,
    status: r.status as 'active' | 'sealed',
    createdAt: r.createdAt,
    sealedAt: r.sealedAt,
  };
}

function seedMemory(
  name: string,
  handle: string,
  role: string,
  personality: string | null,
  specialties: string[],
): string {
  return [
    `# ${name}`,
    '',
    '## Identity',
    `- handle: ${handle}`,
    `- role: ${role}`,
    `- 性格: ${personality ?? '未设定'}`,
    `- 专长: ${specialties.join('、')}`,
    '',
    '## Active Context',
    '(留空;agent 在运行中可自行补充长期要点)',
    '',
  ].join('\n');
}
