# M0 骨架实现方案

> 最小可运行骨架：Tauri 壳 + Fastify 后端 + React 前端 + WS 通信打通。
>
> M0 不实现任何业务逻辑，只验证三层能跑通并通信。

| 字段 | 值 |
|------|-----|
| 里程碑 | M0 |
| 目标 | 前端能显示后端推送的消息（WS 端到端通） |
| 验收 | 前端发起 WS 连接，后端推送一条消息，前端渲染出来 |

---

## 0. 技术决策（已拍板）

| ID | 决策 | 选型 |
|----|------|------|
| M0-D1 | server 启动方式 | **dev 分开跑，打包时内嵌为 Tauri sidecar** |
| M0-D2 | 端口管理 | **固定端口 + 占用检测**（占用则报错，不自动换） |
| M0-D3 | 实施顺序 | **M0a 纯 Web+后端通 → M0b 加 Tauri 壳** |

### 固定端口分配

| 服务 | 端口 | 用途 |
|------|------|------|
| server (Fastify) | **3140** | REST + WS |
| web dev (Vite) | **5170** | 开发期前端 |

---

## 1. M0 分两步

### M0a：纯 Web + 后端通（先做）

不碰 Tauri。后端 Fastify + 前端 Vite 各自 `pnpm dev` 跑，WS 打通。

### M0b：加 Tauri 壳（后做）

M0a 跑通后，加 Tauri 桌面壳，dev 期 Tauri 加载 `localhost:5170`，前端直连 `ws://localhost:3140`。

---

## 2. 目录结构（M0a 完成态）

```
fireit/
├── package.json                 # 根 workspace，含 dev 脚本
├── pnpm-workspace.yaml          # packages: ['packages/*']
├── tsconfig.base.json           # 共享 TS 配置（strict + moduleResolution bundler）
├── biome.json                   # lint + format 配置
│
├── packages/
│   ├── shared/                  # 前后端共享类型
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       └── events.ts        # WorkspaceEvent（M0 只放最小骨架事件）
│   │
│   ├── server/                  # Fastify + ws
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # Fastify 启动 + WS 挂载
│   │       ├── realtime.ts      # WS broadcaster
│   │       └── health.ts        # 健康检查 + 端口占用检测
│   │
│   └── web/                     # React + Vite
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts       # proxy /api → 3140
│       ├── index.html
│       └── src/
│           ├── main.tsx         # React 入口
│           ├── App.tsx          # 订阅 WS，渲染消息
│           └── hooks/
│               └── useWorkspace.ts  # WS 连接 hook
│
└── (core/ agents/ src-tauri/ 暂不创建，M0 不需要)
```

> M0b 完成态会加 `src-tauri/`，其余不变。

---

## 3. 关键文件规格

### 3.1 根 workspace

**package.json**
```jsonc
{
  "name": "fireit",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @fireit/server dev & pnpm --filter @fireit/web dev",
    "dev:server": "pnpm --filter @fireit/server dev",
    "dev:web": "pnpm --filter @fireit/web dev",
    "check": "biome check .",
    "format": "biome format --write ."
  }
}
```

**pnpm-workspace.yaml**
```yaml
packages:
  - 'packages/*'
```

### 3.2 shared

**`packages/shared/src/events.ts`**（M0 最小骨架事件）
```typescript
// M0 骨架事件——只用于验证 WS 打通，M1 起替换为真实 WorkspaceEvent
export type SkeletonEvent =
  | { type: 'server.hello'; message: string; at: number }
  | { type: 'client.ping'; at: number };
```

### 3.3 server

**`packages/server/src/index.ts`**
```typescript
// 启动流程：
// 1. 端口占用检测（3140 被占 → 报错退出）
// 2. Fastify 启动，注册 /health 路由
// 3. 挂载 WS server（路径 /ws）
// 4. 客户端连接后，推送一条 server.hello
```

**`packages/server/src/health.ts`**
```typescript
// 端口占用检测：bind 3140 失败 → 打印 "端口 3140 被占用，请释放后重试" 并 process.exit(1)
// /health 路由：返回 { status: 'ok', uptime }
```

**`packages/server/src/realtime.ts`**
```typescript
// RealtimeBroadcaster（对齐 subsystems.md §6.3 接口）
//   - 维护 Set<WebSocket> 客户端
//   - broadcast(event): 序列化 + 发给所有客户端
//   - subscribe(ws): 加入集合
// M0 只 broadcast SkeletonEvent，M1+ 扩展为 WorkspaceEvent
```

### 3.4 web

**`packages/web/vite.config.ts`**
```typescript
// proxy: '/api' → http://localhost:3140（健康检查等 REST）
// WS 直连 ws://localhost:3140/ws（不走 proxy）
```

**`packages/web/src/hooks/useWorkspace.ts`**
```typescript
// useWorkspace(): 连接 ws://localhost:3140/ws
//   - onopen: 发 client.ping
//   - onmessage: 解析 SkeletonEvent，写入 state
//   - 返回 { events, connected }
```

**`packages/web/src/App.tsx`**
```typescript
// 渲染：连接状态指示 + events 列表
// 验收：能看到后端推的 server.hello
```

---

## 4. 启动流程

### M0a dev（纯 Web + 后端）

```bash
# 根目录
pnpm dev
# 等价于：
#   server: tsx watch src/index.ts（监听 3140）
#   web:    vite（监听 5170）
#
# 打开 http://localhost:5170 → 看到 "connected" + server.hello 消息
```

### M0b dev（加 Tauri 壳后）

```bash
pnpm tauri:dev
# Tauri 启动 → 加载 http://localhost:5170（web dev server）
# 前端连 ws://localhost:3140/ws（server 仍独立跑）
```

### 发布打包（M0b 之后）

```
Tauri 打包 → server 作为 sidecar 二进制内嵌
  → app 启动时 spawn server，等待 /health 就绪
  → 加载内置前端（Tauri WebView）
  → 退出时 kill server 子进程
```

---

## 5. 端口占用检测（M0-D2 落地）

**位置**：`packages/server/src/health.ts`

```typescript
async function checkPortAvailable(port: number): Promise<void> {
  // 尝试 bind，失败则：
  console.error(`端口 ${port} 被占用。请释放后重试。`);
  process.exit(1);
}
```

固定端口 3140/5170，占用即报错退出，不自动换端口（避免"连不上但不知道跑在哪个端口"的困惑）。

---

## 6. 验收清单

### M0a 验收

- [ ] `pnpm install` 成功，三个包（shared/server/web）依赖装好
- [ ] `pnpm dev` 启动 server（3140）+ web（5170）无报错
- [ ] 端口占用时：再次 `pnpm dev` 报错"端口 3140 被占用"并退出
- [ ] 浏览器开 `localhost:5170`：显示 "connected"
- [ ] 后端推送 `server.hello`，前端渲染出消息
- [ ] `GET localhost:3140/health` 返回 `{ status: 'ok' }`

### M0b 验收

- [ ] `pnpm tauri:dev` 启动 Tauri 窗口
- [ ] Tauri 窗口加载前端，WS 正常通信（看到 server.hello）
- [ ] 关闭窗口时 server 子进程被清理

---

## 7. M0 不做

- ❌ 任何业务逻辑（task/step/agent）
- ❌ SQLite / Drizzle（M1 才需要）
- ❌ core / agents 包（M1/M2 才创建）
- ❌ 认证 / 鉴权
- ❌ 多窗口 / 系统集成（Tauri 只做最小窗口）

---

## 8. 依赖清单

**server**：`fastify`, `ws`, `tsx`（dev）, `typescript`
**web**：`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`
**shared**：`typescript`（纯类型，零运行时依赖）
**根**：`biome`, `typescript`

---

*本方案是 M0 骨架的实现依据。M0a 完成后进入 M0b，然后进 M1（task 引擎）。*
