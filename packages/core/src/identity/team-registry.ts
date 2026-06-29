// packages/core/src/identity/team-registry.ts
// TeamRegistry：team 管理（对齐 subsystems.md §3.1）

import type { Agent, AgentHandle, AgentId, AgentRole } from '@fireit/shared';

export class TeamRegistry {
  private byId = new Map<AgentId, Agent>();
  private byHandle = new Map<AgentHandle, Agent>();

  register(agent: Agent): void {
    this.byId.set(agent.agentId, agent);
    this.byHandle.set(agent.handle, agent);
  }

  get(agentId: AgentId): Agent | undefined {
    return this.byId.get(agentId);
  }

  getByHandle(handle: AgentHandle): Agent | undefined {
    return this.byHandle.get(handle);
  }

  listAvailable(): Agent[] {
    return [...this.byId.values()].filter((a) => a.available);
  }

  listByRole(role: AgentRole): Agent[] {
    return [...this.byId.values()].filter((a) => a.roles.includes(role));
  }

  list(): Agent[] {
    return [...this.byId.values()];
  }

  // 从 registry 移除(AgentService 删 agent 时用)
  remove(agentId: AgentId): void {
    const a = this.byId.get(agentId);
    if (a) {
      this.byId.delete(agentId);
      this.byHandle.delete(a.handle);
    }
  }

  // 清空(AgentService 从 DB 重新加载前用)
  clear(): void {
    this.byId.clear();
    this.byHandle.clear();
  }
}
