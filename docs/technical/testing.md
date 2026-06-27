# fireit 测试方案

> 测试金字塔分层 + 端到端策略。覆盖 VISION 两个支柱的 P0 验收。

| 字段 | 值 |
|------|-----|
| 文档状态 | Draft |
| 版本 | v0.1 |
| 更新日期 | 2026-06-26 |
| 配套 | 各 `m{N}-*.md` 实现方案、`subsystems.md` |

---

## 0. 测试金字塔

```
           ╱  E2E（真实 CLI）   ╲     少量，慢，烧 token，手动/nightly
          ╱   场景一全流程        ╲
       ╱──────────────────────────╲
      ╱   集成测试（真实 SQLite）    ╲   中量，EventStore双写/TaskService编排
     ╱──────────────────────────────╲
    ╱     单元测试（纯函数，CI 必跑）   ╲  大量，状态机/归一化/路由，快
   ╱──────────────────────────────────╲
```

| 层 | 数量 | 速度 | CI | 用真实 |
|----|------|------|----|--------|
| **单元** | 大 | 毫秒级 | ✅ 每次提交 | 无（纯函数） |
| **集成** | 中 | 秒级 | ✅ 每次提交 | SQLite（临时文件） |
| **E2E** | 少 | 分钟级 | ❌ 手动/nightly | 真实 CLI + 真实 token |

---

## 1. 单元测试（CI 必跑）

纯函数，零 IO，毫秒级。已散落在 M1/M2 方案里，这里汇总。

### 1.1 task 引擎（M1）

| 测试文件 | 内容 |
|---------|------|
| `state-machine.test.ts` | 5 态 × 6 事件穷举 30 格 + 特殊守卫（依赖前置/approver/user 校验） |
| `projector.test.ts` | rebuild 零漂移 + deriveReady 派生 + retryCount |
| `invariants.test.ts` | INV-T3~T7（事件 frozen / accepted 前置 / projector 不可变） |

### 1.2 A2A 路由（M4）

| 测试文件 | 内容 |
|---------|------|
| `mention-parser.test.ts` | 行首 @ 解析；句中 @ 不路由；代码块/URL/邮箱不误判 |
| `target-resolver.test.ts` | handle→agentId；不可用 agent 报错；未知 handle 建议 |
| `fallback.test.ts` | 回退梯级优先级（显式>最近提及>最后回复者>默认） |
| `guards.test.ts` | 乒乓检测（N 轮警告）+ 深度限制 + 去重 |

### 1.3 归一化（M2）

| 测试文件 | 内容 |
|---------|------|
| `normalize.test.ts` | 每个 CLI 的真实 NDJSON fixture 行 → 正确 AgentOutputChunk |

> fixture 来源：首次实现时跑一次真实 CLI，录几行 NDJSON 存为 `__fixtures__/`。

### 1.4 review + 介入（M4）

| 测试文件 | 内容 |
|---------|------|
| `reviewer-matcher.test.ts` | 跨 family 优先 > 同 family > 降级；禁自审 |
| `intervention.test.ts` | **四类触发全覆盖**（见下） |

**介入测试矩阵**（P0 验收的核心保障）：

| 场景 | 输入 | 期望 |
|------|------|------|
| 互审一致 | verdict=approved, 非危险 | needsHuman=false, trigger=review_consensus |
| 互审分歧 | verdict=rejected, 非危险 | needsHuman=true, trigger=review_disagreement |
| 危险操作（互审一致） | verdict=approved, 删文件 | needsHuman=true, trigger=dangerous_op |
| 危险操作（互审分歧） | verdict=rejected, 改鉴权 | needsHuman=true, trigger=dangerous_op |
| 最终验收 | acceptTask, 全 step closed | trigger=final_acceptance, 必须 user |

---

## 2. 集成测试（CI 必跑）

真实 SQLite（临时文件），不 mock 存储。验证"接线"正确。

### 2.1 EventStore 双写（M3）

| 测试 | 内容 |
|------|------|
| `event-store.append.test.ts` | append 事件 → 投影表同步更新 |
| `event-store.rebuild.test.ts` | 从 task_events 重放 → 与投影表逐字段一致（INV-T2） |
| `event-store.idempotent.test.ts` | 同 eventId 重复 append → 幂等，不重复 |

### 2.2 TaskService 编排（M3）

| 测试 | 内容 |
|------|------|
| `task-service.create.test.ts` | createTask → tasks + steps 行存在，全 pending |
| `task-service.flow.test.ts` | approvePlan → readySteps 派生；startStep → running；complete → 下一 ready |
| `task-service.retry.test.ts` | retryStep → 只该 step 重置，其他不变 |
| `task-service.accept.test.ts` | acceptTask：全 closed 通过；未全 closed 拒；非 user 拒 |

### 2.3 REST 路由（M3）

| 测试 | 内容 |
|------|------|
| `routes.tasks.test.ts` | Fastify inject（不真实监听端口）→ 各路由返回正确状态码 + 体 |

> 集成测试用 stub adapter（不拉真实 CLI），只验存储/编排/路由，不验 agent 输出。

---

## 3. 端到端测试（真实 CLI，手动/nightly）

**用真实 CLI + 真实 token。** 不进每次提交的 CI，单独标记。

### 3.1 测试标记与运行

```bash
pnpm test              # 单元 + 集成（CI）
pnpm test:e2e          # E2E（真实 CLI，手动/nightly）
pnpm test:e2e:smoke    # 仅冒烟（单 CLI 单轮，验证 CLI 可达）
```

Vitest 配置分离：`vitest.config.ts`（单元+集成）vs `vitest.e2e.config.ts`（E2E）。

E2E 测试前置检查：CLI 未安装/未认证 → skip（不 fail），打印提示。

### 3.2 E2E 测试用例

#### E2E-01：单 CLI 单 step 冒烟

```
拉起 Claude Code → 执行一个最简 step（如 "echo hello"）→ 验证：
  - AgentRunner 成功 spawn
  - 流式捕获到 AgentOutputChunk
  - 归一化正确（text/done chunk）
```

目的：验证某 CLI 可达 + 归一化 schema 对得上。三个 CLI 各跑一次。

#### E2E-02：task 全流程（场景一）

```
对每个 CLI 跑一遍：
1. POST /tasks（创建 task，含 2 step plan）
2. approve-plan
3. startStep(step1) → 真实 agent 执行 → step.completed
4. startStep(step2) → 完成
5. acceptTask → task.accepted
验证：board 投影全程正确，事件流完整。
```

#### E2E-03：跨模型互审（M4 后）

```
agent A（Claude）做一个 step
agent B（Codex）review
验证：
  - reviewer-matcher 选了不同 family
  - ReviewRecord 正确生成
  - 介入判断正确（一致→不叫人 / 分歧→叫人）
```

#### E2E-04：retry 全流程

```
step1 完成 → step2 执行（故意失败/超时）→ retryStep(step2)
验证：step1 状态不变（completed），step2 重置（running），retryCount=1
```

### 3.3 P0 验收的 E2E 自动化

VISION 的两条 P0 验收（零传话 / 必要介入）用 E2E 自动验证：

| P0 | E2E 验证 |
|----|---------|
| **P0-1 零传话** | 整个场景一流程中，无任何"手动注入上下文给 agent"的操作——agent 的 context 全部来自 TaskService.assembleContext（从共享工作空间取），断言 AgentInvokeInput.context 不含 user 手动粘贴的内容 |
| **P0-2 必要介入** | agent 互审一致时不产生 InterventionDecision（断言 pendingInterventions 为空）；模拟危险操作时产生介入（断言非空） |

---

## 4. 测试数据管理

### 4.1 Fixture（单元/集成）

```
packages/agents/src/__fixtures__/
├── claude-code-stream.jsonl    # 录制的真实 Claude stream-json 输出
├── codex-ndjson.jsonl          # 录制的真实 Codex NDJSON
└── gemini-jsonl.jsonl          # 录制的真实 Gemini JSONL
```

### 4.2 测试用 SQLite

集成测试用 `:memory:` 或临时文件，测完销毁。不碰 `.fireit/fireit.db`。

### 4.3 E2E 隔离

E2E 每次跑用独立临时目录（`.fireit-e2e-{timestamp}/`），不污染开发数据。

---

## 5. 各里程碑的测试交付

| 里程碑 | 必须交付的测试 |
|--------|--------------|
| **M1** | 单元：状态机穷举 + 投影 + 不变量（已设计） |
| **M2** | 单元：归一化 fixture + runner mock；E2E：smoke（单 CLI 可达） |
| **M3** | 集成：EventStore 双写 + TaskService 编排 + REST；E2E：task 全流程 |
| **M4** | 单元：路由 + 介入矩阵；E2E：跨模型互审 |
| **M5** | E2E：P0 两条自动化验收 |

---

## 6. CI 策略

```yaml
# 每次 PR / 提交
test:unit+integration     # 快，必跑，全绿才能合

# nightly 或手动
test:e2e                  # 真实 CLI，慢，允许 skip（CLI 未装）
test:e2e:smoke            # 冒烟，快速验证 CLI 可达
```

CI 环境不装 coding CLI、不配 token → E2E 自动 skip，不阻塞。

---

## 7. 测试依赖

- `vitest`（单元 + 集成 + E2E，统一框架）
- E2E 不引入 Playwright（fireit 是 Tauri 桌面应用，E2E 在 API/WS 层验证，不测浏览器 UI 渲染；UI 交互测试留后续）

---

*本方案补齐了测试金字塔的集成层和 E2E 层，并把 VISION 的 P0 验收落成自动化断言。*
