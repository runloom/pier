# Pier 移动端 M1 · 同网切片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地规格 `docs/superpowers/specs/2026-08-26-mobile-companion-design.md` 的 M1 同网切片：LAN 适配器 + 配对/令牌生命周期 + Web 壳先主机后投影（T1 终端 + 审批 + 只读变更/文件）。

**Architecture:** 服务端不另起项目、不用任何云服务——「服务端」就是当前仓库的 Electron main 进程：新增 `src/main/adapters/remote-control/`（node:http + `ws` 同端口，静态托管 SPA + 帧通道），经薄桥接复用 local-control 的传输无关会话层（`createLocalControlSessionFromHello`）与 command-router；配对/设备/令牌进 `src/main/services/pairing/` + `src/main/state/pairing-store.ts`；Web 壳是 monorepo 内新包 `apps/mobile-web/`（独立 vite 构建，产物 `out/mobile-web/`，不进 renderer bundle）。

**Tech Stack:** Electron 43 main（Node 内置 `node:http` + 新增依赖 `ws`）· zod 4.4.3 · React 19.2.7 + Vite 8 + Tailwind v4（SPA）· `debouncedJsonStore` 持久化 · `qrcode`（设置页 QR，新依赖）

## 服务端形态与选型（决策锁定，回答「另起项目 / Supabase」）

1. **不另起项目。** M1 的服务端是当前仓库 main 进程内的新适配器；移动端的每份数据都是宿主状态投影（快照、git、终端、审批全部只在 main 进程），独立服务项目没有任何事实源可连。Web 壳 SPA 也在同一 monorepo（`apps/mobile-web/`），复用插件包「一包多 vite 配置、独立产物」先例。
2. **不用 Supabase / 任何 BaaS / 任何云服务。** Supabase 是云数据库 + 云认证，与「事实源只有桌面 main 进程」的架构直接冲突（规格 §8：连会合云都不得成为第二份事实源）。M1 无账号体系、无远程通路：账号与会合云是 M2 范围（规格 §9.2、D4 账号形态仍开放），本计划不涉及。
3. **唯一新运行时依赖：`ws`**（WebSocket 服务端；全仓已核实无任何 WS 库，local-control 是 NDJSON-over-UDS）。浏览器侧 SPA 用原生 `WebSocket`，无依赖。设置页 QR 渲染新增 `qrcode`（纯 JS，无原生绑定）。

## Global Constraints

- 适配器**默认关闭**；设置页「远程访问」显式开启后启动，关闭即停（规格 §9）。
- 局域网直连只监听本网接口，不映射公网、不开放 WAN 入站；端口从固定区间 `47000–47099` 随机选取（规格 §9「固定区间随机」）。
- 威胁模型：M1 目标环境为可信家庭/办公网段，`ws://` + 每设备令牌，设置页必须明示边界（规格 §9 威胁模型）。
- 帧是 JSON 文本契约，不依赖 `window`、DOM、Service Worker、IndexedDB（规格 §11.3 冻结第 1 条）。
- QR payload 固定为 `{ pairingCode, fingerprint, host, port, relayHint }`，不夹 Web-only 字段（规格 §11.3 冻结第 3 条）。
- T1 是 viewport 纯文本快照档：UI/文案**禁止**写「完整历史 / scrollback」；`scope` 恒为 `"viewport"`（规格 §10.1、§13）。
- `mobile-paired` 默认能力集 = 「只读监视 + 通知写」：加入 `git:read`、`notification:write`；移出 `window:create/close/control`、`panel:control`、`terminal:control`（规格 §10）。
- `agent.attention.respond`：`allowedClientKinds` 含 `mobile-paired` 与 `desktop-renderer`，能力仅 `notification:write`；审批键不是 `terminal:control`（规格 §10）。
- 审批双重门：执行前校验 agentRef 当前 status 为 `waiting` 且 `interactionId` 与当前未决交互一致，否则返回 `interaction_stale`（规格 §8 缺口④）。
- 吊销 = 令牌哈希作废 + `tokenEpoch` 递增 + **立即断开**该 deviceId 的已认证会话；已连连接下一命令返回 `device_revoked`（规格 §9 第 4 步）。
- SPA 约束：禁止 dockview 运行时与 `window.pier`；构建产物独立目录 `out/mobile-web/`，不进 renderer bundle（规格 §11.3）。
- 用户可见文案全部走 i18n（宿主 `src/renderer/i18n/locales/{zh-CN,en,ja,ko}/`），禁内联字符串；中文界面产品词：智能体、工作树、需要你处理。
- 仓库硬门禁：单文件 ≤ 500 行（`pnpm check:file-size`）、目录密度（`pnpm check:dir-density`）、命名不重复父目录语义。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 本计划只交付 M1；**M1 不是可对外的核心产品**（缺会合与叫醒），任何文案不得宣称产品完成（规格 §3、§14）。

## 现状锚点（2026-08-28 勘察结论，实施时以代码为准复核）

- 帧契约单一来源 `src/shared/contracts/local-control/frames.ts`：`localControlClientKindSchema`（:15）现仅 `z.enum(["cli-human"])`；`localControlAuthSchema`（:20）现仅 `{ method: "none" }`；错误码在 `errors.ts`（30 个，`LOCAL_CONTROL_MAX_FRAME_BYTES` = 16 MiB）。
- 传输无关会话层 `src/main/adapters/cli/local-control/session.ts`：`createLocalControlSessionFromHello(hello, args)`（:67），`args.emit` 是抽象写出钩子；`CreateLocalControlSessionArgs`（:47-64）依赖：bootId/features/discovery/authorizer/receipts/runtimeControl/capabilityAuthority/resolveOriginPanel/snapshotService。`LocalControlSession.handleLine(line)` 处理后续全部帧。
- `hello-auth.ts` `resolveHelloPrincipal`（:18）现只放行 `cli-human` → `human:peer`；注释「产品终态：仅 cli-human」被规格显式推翻。
- `authorize.ts` `LocalControlAuthorizer` 接口（:24-26）+ `HUMAN_ALLOWED` op 白名单（:36-44）——authorizer 是注入依赖，远程适配器可注入移动端白名单实现，**零侵入**。
- `control.watch` = digest 轮询 + revision 变化推全量快照（`control-snapshot-ops.ts:104-276`），移动端以「整帧替换本地态」为同步原语。
- v1 命令链：`commandRouter.execute(envelope)`（`command-router.ts:456`）→ `clients.get(clientId)` → `authorizeCommand`（`app-core/permissions.ts:17-47`：plugin-principal 闸 → allowedClientKinds 闸 → capabilities 逐项）→ 域 executor。用固定 clientId 构造 envelope 的先例：`adapters/cli/register-local-control.ts:107-109`。
- `COMMAND_METADATA`（`app-core/commands/metadata-table.ts:16`）是穷举 `Record<PierCommand["type"], CommandMetadata>`：新增命令类型后缺 metadata 直接编译失败。
- 终端写：`terminal-control.ts:216-256` `executeTerminalKeyCommand` 把 enter/escape/tab/ctrl-c/单字符映射为字节序列走 `addon.sendText`；native `sendText(panelId, text)` / `sendKeyPress(panelId, keycode, mods?, text?)` 在 `src/main/ipc/terminal/native-addon.ts:114-120`。**注意**：`terminal-screen.ts` 头部注释表明 send/key 路径有 agent 终端写禁令——`agent.attention.respond` 不得复用 `executeTerminalSendCommand`，直接 `resolveNativeKey` + `addon.sendText`。
- 交互事件：`InteractionRequested/Resolved` 有 `interactionKind`（permission/question/external-block）+ 可选 `interactionId`（≤1024）；`activityStatusForHookEvent`（`src/shared/contracts/foreground-activity.ts:159-178`）把 `InteractionRequested` 映射为 `waiting`。main 侧当前**不持久化**未决 interactionId——本计划新增登记点。
- `agent-attention` 服务（`src/main/services/agent-attention/service.ts:93-133`）已在消费 waiting 事件发通知，`agentRef = makeAgentRef(windowId, panelId)`。
- 持久化样板：`src/main/state/preferences.ts:30-163`（`debouncedJsonStore<T>({filePath, defaults})` → `{init,get,mutate,replace,flush,clear}`；zod 校验失败回退默认）。
- main 进程**无任何 HTTP server 先例**（新建）；无 LAN IP / 空闲端口工具（新建 `os.networkInterfaces()` + 区间试探）。
- 设置页注册三处：`pages/settings/data/appearance-nav.ts:36-47` NAV_ITEMS、`pages/settings/dialog.tsx:324-334` 条件渲染、四语言 locale 的 `settings.nav.*` / `settings.section.*`。
- 工作区：`pnpm-workspace.yaml` 覆盖 `packages/*`；`apps/` 是本计划新立的应用落点（需在 yaml 追加 `apps/*`），`apps/mobile-web` 走 `apps/*`。根 `package.json` 的 `typecheck:packages` 逐包硬编码 tsconfig 路径，新包必须追加 `apps/mobile-web/tsconfig.json` 一项。
- electron-builder `files` 已含 `out/**/*`——SPA 产物落 `out/mobile-web/` 自动进包，打包配置零改动。

## 文件结构

**新建（服务端）：**
- `src/main/state/pairing-store.ts` — 设备表 / 待决配对码 / 实例密钥的持久化（复刻 preferences 样板）
- `src/main/services/pairing/tokens.ts` — 令牌/配对码生成与哈希（纯函数）
- `src/main/services/pairing/service.ts` — 配对生命周期：配对码、能力交集、签发、认证、吊销、epoch 门
- `src/main/services/pairing/qr-payload.ts` — QR payload 构造与解析校验（契约纯函数）
- `src/main/services/agent-attention/pending-interactions.ts` — 未决交互登记（双重门事实源）
- `src/main/adapters/remote-control/network.ts` — LAN IPv4 枚举 + 区间端口探测
- `src/main/adapters/remote-control/static-spa.ts` — SPA 静态文件托管（MIME、路径防穿越）
- `src/main/adapters/remote-control/session-bridge.ts` — WS 消息 → 会话/命令桥（hello 认证、command 帧、epoch 门）
- `src/main/adapters/remote-control/server.ts` — node:http + ws 同端口 listener
- `src/main/adapters/remote-control/registration.ts` — 启停状态机（仿 local-control registration.ts）
- `src/main/app-core/commands/agent-attention-respond.ts` — 审批回写 handler
- `src/main/app-core/commands/remote-access.ts` — 宿主管理命令 handler（getState/setEnabled/beginPairing/cancelPairing/revokeDevice）

**修改（服务端）：**
- `src/shared/contracts/permissions.ts` — mobile-paired 默认集修订 + 新增 `remote-access:read`/`remote-access:control` 能力
- `src/shared/contracts/remote.ts` — 扩为协议与数据模型单一来源（规格 §17）：QR/配对契约 + M2 冻结类型（Task 4）
- `src/shared/contracts/local-control/frames.ts` — clientKind/auth 扩展 + `command` 帧
- `src/shared/contracts/local-control/errors.ts` — 新错误码 `device_revoked`、`interaction_stale`（`auth_failed` 已有则复用）
- `src/shared/contracts/commands.ts` 或 `host/control-commands.ts` — 新命令 schema 入 union
- `src/main/adapters/cli/local-control/hello-auth.ts` — 加 mobile-paired 分支（注入式认证钩子）
- `src/main/app-core/commands/metadata-table.ts` — 6 条新命令 metadata
- `src/main/app-core/command-router.ts` — 挂新 executor
- `src/main/services/agent-attention/service.ts` — 事件流接入 pending-interactions
- `src/main/index.ts` / `src/main/app-core/index.ts` — 装配 pairing 服务与 remote-control registration-owner

**新建（Web 壳，全部在 `apps/mobile-web/`）：** `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`public/manifest.webmanifest`、`src/main.tsx`、`src/app.tsx`、`src/lib/client.ts`（帧客户端）、`src/lib/store.ts`（快照同步 store）、`src/pages/{pair,hosts,host,session,changes,files,notifications}.tsx`、`src/components/{terminal-screen,approval-bar}.tsx`。

**修改（接线）：** 根 `package.json`（依赖 + build 脚本 + typecheck:packages）、`scripts/dev-with-plugins.mjs`（watch 构建）、`scripts/build-dist.sh`（打包链）、`dependency-cruiser.config.cjs`（新包规则）、设置页 nav/dialog/四语言 locale。

---

### Task 1: 权限地基——mobile-paired 默认能力集修订

**Files:**
- Modify: `src/shared/contracts/permissions.ts:176-190`
- Test: `tests/unit/shared/permissions-mobile-paired.test.ts`（新建，仿 `tests/unit/shared/permissions-memory.test.ts` 的 entries 遍历模式）

**Interfaces:**
- Produces: 修订后的 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"]`；新增能力 `"remote-access:read"` / `"remote-access:control"`（Task 9 消费，仅授 desktop-renderer）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  pierCapabilitySchema,
} from "../../../src/shared/contracts/permissions.ts";

describe("mobile-paired 默认能力集（规格 §10）", () => {
  const mobile = DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"];

  it("默认集收敛为只读监视 + 通知写", () => {
    expect([...mobile].sort()).toEqual(
      [
        "app:read",
        "git:read",
        "notification:read",
        "notification:write",
        "panel:read",
        "preferences:read",
        "terminal:read",
        "window:read",
        "workspace:read",
        "worktree:read",
      ].sort()
    );
  });

  it("默认集不含任何 *:write（notification:write 除外）与控制类能力", () => {
    for (const cap of mobile) {
      if (cap === "notification:write") continue;
      expect(cap.endsWith(":write"), cap).toBe(false);
      expect(cap.endsWith(":control"), cap).toBe(false);
      expect(cap.startsWith("window:"), cap).toBe(false);
    }
  });

  it("remote-access 能力仅授 desktop-renderer", () => {
    for (const [kind, caps] of Object.entries(DEFAULT_CAPABILITIES_BY_CLIENT_KIND)) {
      const has = caps.includes("remote-access:control");
      expect(has, kind).toBe(kind === "desktop-renderer");
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/shared/permissions-mobile-paired.test.ts`
Expected: FAIL（`git:read`/`notification:write` 不在现有集合；`remote-access:*` 不是合法能力枚举值）

- [ ] **Step 3: 修订 permissions.ts**

`pierCapabilitySchema` 枚举追加 `"remote-access:read"`、`"remote-access:control"`；`DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"]` 替换为 Step 1 测试中的十个能力；`["desktop-renderer"]` 数组追加 `"remote-access:read"`、`"remote-access:control"`。

- [ ] **Step 4: 跑测试 + 既有权限测试**

Run: `pnpm vitest run tests/unit/shared/permissions-mobile-paired.test.ts tests/unit/app-core/permissions.test.ts`
Expected: PASS。若 `permissions.test.ts:258-268` 旧断言（mobile-paired 缺 `preferences:write` 被拒）因集合变化失效，按新集合修正断言。

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/permissions.ts tests/unit/shared/permissions-mobile-paired.test.ts tests/unit/app-core/permissions.test.ts
git commit -m "feat(permissions): 收敛 mobile-paired 默认能力集并新增 remote-access 能力"
```

---

### Task 2: 配对持久化——pairing-store

**Files:**
- Create: `src/main/state/pairing-store.ts`
- Test: `tests/unit/main/state/pairing-store.test.ts`

**Interfaces:**
- Consumes: `debouncedJsonStore`（`src/main/state/debounced-store.ts`）；`PierPairedDevice`（`src/shared/contracts/remote.ts`）。
- Produces: `readPairingState()` / `updatePairingState(recipe)` / `flushPairingState()`；磁盘态类型：

```ts
interface PairingState {
  devices: PierPairedDevice[]; // tokenHash 在此，令牌原文永不出内存
  pendingPairing: { codeHash: string; expiresAt: number } | null;
  instanceSecret: string; // 首次 init 生成，32 字节 base64url；fingerprint = sha256 前 16 hex
}
```

- [ ] **Step 1: 写失败测试**（临时 userData 目录注入 filePath；覆盖：默认值、设备增删、pendingPairing 一次性语义由服务层保证此处只测读写、zod 坏档回退默认）

```ts
it("坏档回退默认并清空", async () => {
  writeFileSync(filePath, "{not json");
  const store = createPairingStoreForTest(filePath);
  await store.init();
  expect(store.get()).toEqual(DEFAULT_PAIRING_STATE);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm vitest run tests/unit/main/state/pairing-store.test.ts`；Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**——复刻 `preferences.ts:30-163` 样板：`resolveFilePath() = join(app.getPath("userData"), "pairing.json")`；zod schema（devices 数组、pendingPairing 可空、instanceSecret 非空串）；`init` 时若无 instanceSecret 用 `crypto.randomBytes(32).toString("base64url")` 生成并落盘。测试注入走「模块内 factory 接收 filePath」的可测试形态（preferences 同款）。

- [ ] **Step 4: 跑测试确认通过** — 同上命令，Expected: PASS

- [ ] **Step 5: Commit** — `git add src/main/state/pairing-store.ts tests/unit/main/state/pairing-store.test.ts && git commit -m "feat(state): 新增配对设备持久化 store"`

---

### Task 3: 配对服务——配对码 / 签发 / 认证 / 吊销

**Files:**
- Create: `src/main/services/pairing/tokens.ts`、`src/main/services/pairing/qr-payload.ts`、`src/main/services/pairing/service.ts`
- Test: `tests/unit/main/pairing/service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 store；`DEFAULT_CAPABILITIES_BY_CLIENT_KIND`（Task 1）。
- Produces（后续任务消费的确切签名）：

```ts
// tokens.ts（纯函数）
generatePairingCode(): string;            // 6 位数字，crypto 随机
generateDeviceToken(): string;            // 32 字节 base64url（43 字符）
sha256Hex(input: string): string;
fingerprintFromSecret(secret: string): string; // sha256Hex(secret).slice(0, 16)

// qr-payload.ts
buildPairingQrPayload(args: { code: string; fingerprint: string; host: string; port: number }): string;
// → JSON: { pairingCode, fingerprint, host, port, relayHint: null }
parsePairingQrPayload(raw: string): PairingQrPayload | null; // 用 Task 4 的 pairingQrPayloadSchema（契约单一来源在 contracts/remote.ts，本文件只做实现）

// service.ts
interface PairingService {
  beginPairing(args: { host: string; port: number }): { code: string; qrPayload: string; expiresAt: number };
  cancelPairing(): void;
  redeemPairingCode(req: PierPairingRequest):
    | { ok: true; deviceId: string; deviceToken: string; grantedCapabilities: PierCapability[]; tokenEpoch: number }
    | { ok: false; reason: "pairing_expired" | "pairing_invalid" };
  authenticate(deviceId: string, token: string):
    | { ok: true; device: PierPairedDevice }
    | { ok: false };
  revokeDevice(deviceId: string): { revoked: boolean };
  assertEpochCurrent(deviceId: string, tokenEpoch: number): boolean; // 每命令核对
  listDevices(): PierPairedDevice[];
  touchLastSeen(deviceId: string): void;
  onRevoke(listener: (deviceId: string) => void): () => void; // 适配器订阅以踢会话
}
```

行为契约（测试逐条锁）：配对码一次性（redeem 成功即清 pendingPairing）；5 分钟过期（`expiresAt` 过期 redeem 返回 `pairing_expired`）；能力授予 = `requestedCapabilities ∩ DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"]`；`shell` 缺省记 `"web"`；令牌只存 `sha256Hex(token)`；`authenticate` 用 `crypto.timingSafeEqual` 常数时间比较；`revokeDevice` = 删设备 + 触发 `onRevoke`；epoch 随设备删除即失效（重建设备 epoch 从 0 开始，会话核对走「设备存在且 epoch 相等」）。

- [ ] **Step 1: 写失败测试**——按上面行为契约逐条写用例（一次性、过期、能力交集、常数时间比较存在性、吊销触发 listener、epoch 核对）。
- [ ] **Step 2: 跑测试确认失败** — Run: `pnpm vitest run tests/unit/main/pairing/service.test.ts`；Expected: FAIL
- [ ] **Step 3: 实现三个文件**（纯函数先行，service 持 store 引用 + listener 集合）
- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: Commit** — `git add src/main/services/pairing tests/unit/main/pairing && git commit -m "feat(pairing): 配对码与设备令牌生命周期服务"`

---

### Task 4: 契约全书——帧扩展 + 配对/QR 契约 + M2 冻结数据模型

规格 §17 是本任务的文字单一来源；本任务把代码单一来源一次定义全。M2 冻结类型现在定义、M2 才实现——每个类型注释标「M2 冻结」，治理测试锁定形状，防 M2 重定义返工。

**Files:**
- Modify: `src/shared/contracts/local-control/frames.ts`、`src/shared/contracts/local-control/errors.ts`
- Modify: `src/shared/contracts/remote.ts`（扩为协议与数据模型单一来源）
- Test: `tests/unit/shared/local-control/mobile-frames.test.ts`（新建）、`tests/unit/shared/remote-contracts.test.ts`（新建）

**Interfaces:**
- Produces:

```ts
// frames.ts
localControlClientKindSchema = z.enum(["cli-human", "mobile-paired"]);
localControlAuthSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("none") }),
  z.object({
    method: z.literal("device-token"),
    deviceId: z.string().min(1),
    deviceToken: z.string().min(1),
    shell: z.enum(["web", "app", "miniprogram"]).default("web"),
  }),
]);
// 新增命令通道帧（会话内承载 PierCommand）：
localControlClientCommandSchema = z.object({
  apiVersion: z.literal(LOCAL_CONTROL_API_VERSION),
  type: z.literal("command"),
  requestId: z.string().min(1),
  command: z.unknown(), // 由 command-router 侧 pierCommandEnvelopeSchema 校验
});
// localControlClientFrameSchema 的 discriminatedUnion 追加 command 帧。

// errors.ts：LocalControlErrorCode 追加 "device_revoked"、"interaction_stale"

// remote.ts（现有 PierPairedDevice / PierRemoteSession / PierPairingRequest 保留；
// PierPairedDevice 注释写明「演进只许 additive 可选字段，M2 加 accountId?」）
pairingQrPayloadSchema = z.object({
  pairingCode: z.string().min(1),
  fingerprint: z.string().min(1),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  relayHint: z.string().nullable(), // M1 恒 null；M2 会合地址
}).strict();
pairingRedeemResultSchema = z.object({
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  grantedCapabilities: z.array(pierCapabilitySchema),
  tokenEpoch: z.number().int().nonnegative(),
}).strict();
pairingFailureReasonSchema = z.enum(["pairing_expired", "pairing_invalid"]);

// M2 冻结（现在定义、M2 实现；字段语义见规格 §17.3）：
pierAccountRefSchema = z.object({ accountId: z.string().min(1) }).strict();
pierHostRegistrationSchema = z.object({
  hostId: z.string().min(1),
  accountId: z.string().min(1),
  fingerprint: z.string().min(1),
  online: z.boolean(),
  lastSeenAt: z.number().int().nonnegative(),
}).strict();
pierPushHandleSchema = z.object({
  deviceId: z.string().min(1),
  shell: pierCompanionShellSchema,
  webPush: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }).strict(),
  }).strict().optional(),
}).strict();
pierRelayEnvelopeSchema = z.object({
  hostId: z.string().min(1),
  deviceId: z.string().min(1),
  frame: z.unknown(), // 透传 v2 帧，relay 不解读
}).strict();
```

- [ ] **Step 1: 写失败测试**——`mobile-frames.test.ts`：hello 帧接受 `mobile-paired` + `device-token` auth；command 帧 round-trip；**协议冻结测试**：用 `readFileSync` 断言 frames.ts/errors.ts/remote.ts 源码不含 `window` / `document` / `ServiceWorker` / `IndexedDB` 字样（规格 §13「帧编解码单测不得依赖 DOM」）。`remote-contracts.test.ts`：QR payload round-trip 且**必含 `relayHint` 键**（规格 §17.2）；四个 M2 冻结类型各一正一负形状用例；`PierPairedDevice` 源码注释含 additive 演进约束字样。
- [ ] **Step 2-5:** 失败 → 实现 → 通过 → 不提交（本次执行禁止 commit）

---

### Task 5: hello-auth 移动端分支 + 移动端 authorizer

**Files:**
- Modify: `src/main/adapters/cli/local-control/hello-auth.ts`
- Create: `src/main/adapters/remote-control/mobile-authorizer.ts`
- Test: `tests/unit/main/adapters/local-control/hello-auth.test.ts`（扩充）、`tests/unit/main/adapters/remote-control/mobile-authorizer.test.ts`（新建）

**Interfaces:**
- `resolveHelloPrincipal` 扩展为接收可选注入：

```ts
type MobileAuthenticator = (auth: {
  deviceId: string;
  deviceToken: string;
  shell: PierCompanionShell;
}) => { ok: true; principalRef: string } | { ok: false };
resolveHelloPrincipal(hello, authenticateMobile?: MobileAuthenticator): ...
// cli-human 路径行为不变；mobile-paired 无注入或认证失败 → auth_failed
```

- `mobile-authorizer.ts`：`createMobileAuthorizer(assertLive: () => boolean): LocalControlAuthorizer`——op 白名单 `MOBILE_ALLOWED = ["control.snapshot", "control.watch", "agents.catalog", "agents.list", "agents.get"]`；每次 authorize 先跑 `assertLive()`（epoch 门，Task 7 装配时注入），false 返回 `device_revoked`。

- [ ] **Step 1-5:** 失败测试（mobile-paired 无钩子被拒 / 有钩子认证通过 / cli-human 回归；authorizer 白名单内外 op、epoch 门拒绝）→ 实现 → 通过 → commit `feat(adapters): hello-auth 支持 mobile-paired 设备令牌认证`

---

### Task 6: remote-control 适配器——HTTP + WS 同端口 listener

**Files:**
- Create: `src/main/adapters/remote-control/network.ts`、`static-spa.ts`、`server.ts`、`registration.ts`
- Test: `tests/unit/main/adapters/remote-control/{network,static-spa,server}.test.ts`

**Interfaces:**
- Consumes: `createLocalControlSessionFromHello`、Task 5 的 authenticator/authorizer、Task 3 的 PairingService。
- Produces:

```ts
// network.ts
listLanIPv4Addresses(): string[];                       // os.networkInterfaces() 过滤 internal/非 IPv4
pickPortInRange(preferred?: number): Promise<number>;   // 47000–47099 区间随机起试，listen 试探占用

// static-spa.ts
createSpaStaticHandler(distDir: string): (req, res) => void;
// GET / → index.html；/assets/** 静态；MIME: html/js/css/json/svg/png/webmanifest/woff2；
// 路径 normalize 后必须仍在 distDir 内（防 .. 穿越），否则 404；缓存：index.html no-cache，assets immutable。

// server.ts
interface RemoteControlServer {
  start(): Promise<{ host: string; port: number }>; // host = LAN IPv4 首枚
  stop(): Promise<void>;
  state(): { enabled: boolean; host: string | null; port: number | null };
}
createRemoteControlServer(args: {
  spaDistDir: string;
  pairing: PairingService;
  sessionDeps: CreateLocalControlSessionArgs 除 emit/authorizer 外的全部依赖;
  executeCommand: (envelope: PierCommandEnvelope) => Promise<unknown>;
  clients: PierClientRegistry;
}): RemoteControlServer;
```

行为：node:http server 单端口——`POST /pair`（JSON body = `PierPairingRequest`，调 `pairing.redeemPairingCode`，成功 200 返回 `{ deviceId, deviceToken, grantedCapabilities, tokenEpoch }`，失败 403 `{ reason }`）；WS upgrade 路径 `/ws`；其余 GET 走静态托管。WS 消息处理委托 Task 7 的 session-bridge。**默认不启动**，由 registration-owner 被设置开关调用 start/stop。帧大小：单条 WS message 超 `LOCAL_CONTROL_MAX_FRAME_BYTES` → `frame_too_large` + 断连。认证失败限速：同一远端 IP 连续 5 次 hello 失败 → 60 秒内直接拒绝（内存 Map，M1 可信网段基础版）。

- [ ] **Step 1-5:** 失败测试（端口区间、静态托管 404/防穿越、/pair 成功与过期、WS 升级、超帧断连、限速）→ 实现 → 通过 → commit `feat(remote-control): LAN HTTP+WS 适配器骨架`

---

### Task 7: 会话桥——command 通道 + epoch 门 + 吊销断连

**Files:**
- Create: `src/main/adapters/remote-control/session-bridge.ts`
- Test: `tests/unit/main/adapters/remote-control/session-bridge.test.ts`

**Interfaces:**
- Produces: `attachMobileSession(ws: WebSocketLike, ctx): void`，消息分三类：
  1. 首帧 `client.hello`（`clientKind: "mobile-paired"`）→ `pairing.authenticate` → 失败回 `serverErrorFrame("auth_failed")` + close；成功 → `clients.register({ id: "mobile:" + deviceId, kind: "mobile-paired", capabilities: device.capabilities })` → `createLocalControlSessionFromHello(hello, { ...sessionDeps, authorizer: mobileAuthorizer, emit: (frame) => ws.send(JSON.stringify(frame)) })` → 回 server.hello。
  2. `type: "command"` 帧 → **先核对** `pairing.assertEpochCurrent(deviceId, sessionTokenEpoch)`，false → `controlErrorResponse(requestId, "device_revoked", ...)` + close；true → `executeCommand({ clientId: "mobile:" + deviceId, command })` → 结果包成 response 帧。
  3. 其它帧原文转 `session.handleLine(line)`（watch/snapshot 走 authorizer 的 epoch 门）。
- close 时：`session.dispose()` + `clients.unregister("mobile:" + deviceId)`。构造期订阅 `pairing.onRevoke`：命中本 deviceId → 踢连接。

- [ ] **Step 1-5:** 失败测试（hello 认证、command 往返 mock executeCommand、epoch 失配 `device_revoked` + 断连、吊销 listener 踢会话、watch 帧透传）→ 实现 → 通过 → commit `feat(remote-control): 移动端会话桥与吊销断连`

---

### Task 8: 审批回写 agent.attention.respond

**Files:**
- Create: `src/main/services/agent-attention/pending-interactions.ts`
- Modify: `src/main/services/agent-attention/service.ts`（事件流登记/清除）
- Modify: `src/shared/contracts/host/control-commands.ts`（schema 追加）
- Modify: `src/main/app-core/commands/metadata-table.ts`、`src/main/app-core/command-router.ts`（挂 executor）
- Create: `src/main/app-core/commands/agent-attention-respond.ts`
- Test: `tests/unit/app-core/agent-attention-respond.test.ts`、`tests/unit/app-core/permissions.test.ts`（扩充）

**Interfaces:**

```ts
// schema（并入 hostControlCommandSchemas）
z.object({
  type: z.literal("agent.attention.respond"),
  agentRef: z.string().min(1),
  interactionId: z.string().min(1).max(1024),
  key: z.enum(["enter", "escape", "y", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9"]),
}).strict()

// metadata-table.ts
"agent.attention.respond": {
  allowedClientKinds: ["desktop-renderer", "mobile-paired"],
  capabilities: ["notification:write"],
}

// pending-interactions.ts
createPendingInteractionRegistry(): {
  onHookEvent(event: AgentHookEventPayloadV3, agentRef: string): void; // Requested 登记 / Resolved 清除
  assertCurrent(agentRef: string, interactionId: string): boolean;     // 无记录或不符 → false
}
```

- handler 逻辑：`assertCurrent` false → failure `"interaction_stale"`；经 foreground-activity 查 agentRef 当前 status 非 `waiting` → failure `"interaction_stale"`；通过则 `parseAgentRef` 得 panelId → `resolveNativeKey` → `addon.sendText(nativeKey, KEY_BYTES[key])`（`enter: "\r"`、`escape: "\u001b"`、`y/n/数字`: 字符本身）→ success `{ accepted: true }`。**不复用 executeTerminalSendCommand**（agent 终端写禁令），注释写明豁免理由。
- **快照携带未决交互（SPA 审批条的数据来源）**：`pending-interactions` 注册表接入 `services/control-snapshot/` 的 activity 摘要组装点——每个 `waiting` 态 agent 的摘要条目附 `pendingInteractionId`（无登记则缺省）。移动端审批条的 `interactionId` 从快照读，不允许由客户端猜测。组装的精确落点执行时按 control-snapshot 服务内 activity 摘要字段来源确定，并在本任务测试里锁定「waiting 且无登记 → 无该字段」。
- 语义动作（approve/reject 映射表）M1 只做机制：schema 预留位、映射表为空 → 不开放；UI 不出现语义按钮（规格 §8 缺口④「未验证的返回 unsupported、UI 隐藏」）。

- [ ] **Step 1-5:** 失败测试（双重门两个分支、九种键映射字节、授权：mobile-paired 带 `notification:write` 通过 / `cli-local` 缺能力被拒 / `mcp-local` kind 被拒）→ 实现 → 通过 → commit `feat(agent-attention): 移动端审批回写命令 agent.attention.respond`

---

### Task 9: 宿主管理命令 remoteAccess.*

**Files:**
- Modify: `src/shared/contracts/host/control-commands.ts`、`metadata-table.ts`、`command-router.ts`
- Create: `src/main/app-core/commands/remote-access.ts`
- Test: `tests/unit/app-core/remote-access.test.ts` + permissions.test.ts 扩充

**Interfaces:** 五条命令，metadata 全部 `allowedClientKinds: ["desktop-renderer"]`：

| 命令 | 能力 | 行为 |
|---|---|---|
| `remoteAccess.getState` | `remote-access:read` | `{ enabled, host, port, devices: 脱敏列表(无 tokenHash), pendingPairing: { qrPayload, expiresAt } \| null, boundaryNote: true }` |
| `remoteAccess.setEnabled` | `remote-access:control` | `{ enabled: boolean }` → registration-owner start/stop |
| `remoteAccess.beginPairing` | `remote-access:control` | → `pairing.beginPairing` 返回 `{ code, qrPayload, expiresAt }` |
| `remoteAccess.cancelPairing` | `remote-access:control` | 清待决配对码 |
| `remoteAccess.revokeDevice` | `remote-access:control` | `{ deviceId }` → `pairing.revokeDevice`（联动断连已在 Task 7） |

- [ ] **Step 1-5:** 失败测试（五条命令正/负向、脱敏断言——返回体不得含 `tokenHash` 字段）→ 实现 → 通过 → commit `feat(remote-access): 宿主远程访问管理命令面`

---

### Task 10: 设置页「远程访问」卡

**Files:**
- Create: `src/renderer/pages/settings/components/remote-access-section.tsx`
- Modify: `pages/settings/data/appearance-nav.ts`、`pages/settings/dialog.tsx`、四语言 `i18n/locales/*/settings.ts`
- Test: `tests/component/settings/remote-access-section.test.tsx`

**要点：** 开关（`remoteAccess.setEnabled`，即时偏好）→ 开启后显示「同网地址 `http://<host>:<port>`」+ 边界提示 Alert（可信网段 `ws://` 说明，放 Card 内顶部，遵守设置页 Alert 布局规范）；「生成配对码」按钮 → QR（`qrcode` 库 toCanvas）+ 5 分钟倒计时 + 6 位数字码明文（无相机场景手动输）；设备列表（名称/shell/最近在线）+ 吊销按钮（`showAppConfirm` destructive → `remoteAccess.revokeDevice`）。状态镜像走 zustand store 轮询 `remoteAccess.getState`（开启期间 2s）。文案全部 i18n；中文：「远程访问」「已配对设备」「吊销」「仅在可信的家庭或办公网络使用」。

- [ ] **Step 1-5:** 组件测试（开关调用命令、QR 渲染 canvas、吊销确认流）→ 实现 → 通过 → commit `feat(settings): 远程访问设置卡与配对 QR`

---

### Task 11: Web 壳包脚手架 + 帧客户端

**Files:**
- Create: `apps/mobile-web/`（package.json / tsconfig.json / vite.config.ts / index.html / public/manifest.webmanifest / src/main.tsx / src/app.tsx / src/lib/client.ts / src/lib/store.ts）
- Modify: `pnpm-workspace.yaml`（追加 `apps/*`）、根 `package.json`（`build:mobile-web`、`typecheck:packages` 追加 `apps/mobile-web/tsconfig.json`）、`scripts/dev-with-plugins.mjs`（watch）、`dependency-cruiser.config.cjs`（新包规则：允许 `@pier/ui`、`zod`、`react`、`@shared/contracts/**`）、`src/shared` tsconfig paths 若需
- Test: `tests/unit/mobile-web/client.test.ts`（帧客户端对 mock WebSocket）

**要点：** `vite.config.ts`——`root` 本包、`base: "./"`、`build.outDir: "../../out/mobile-web"`、`plugins: [react(), tailwindcss()]`、`resolve.alias: { "@shared": resolve(__dirname, "../../src/shared") }`。`client.ts`：

```ts
export class PierMobileClient {
  connect(args: { host: string; port: number; deviceId: string; deviceToken: string }): Promise<ServerHello>;
  command<T>(cmd: PierCommand): Promise<T>;          // command 帧往返，requestId 自增
  watch(onSnapshot: (payload: unknown) => void): Promise<void>; // control.watch 循环，断线重连
  close(): void;
}
```

zod 校验用 `@shared/contracts/local-control/frames.ts` 真实 schema（运行时同源）。store：快照整帧替换 + revision 记录。`manifest.webmanifest`：name「Pier 移动端」、display standalone、icons 复用 `build/icons/` 拷贝入 `public/`。

- [ ] **Step 1-5:** 失败测试（hello 帧格式、command 往返、重连退避）→ 实现 → `pnpm build:mobile-web` 产物落 `out/mobile-web/` → commit `feat(mobile-web): Web 壳包脚手架与帧客户端`

---

### Task 12: Web 壳页面——先主机后投影

**Files:**
- Create: `apps/mobile-web/src/pages/{pair,hosts,host,session,changes,files,notifications}.tsx`、`src/components/{terminal-screen,approval-bar}.tsx`
- Test: `tests/unit/mobile-web/pages.test.tsx`（组件级，mock client）

**要点（IA 以 `.pier/canvases/mobile-companion/` 线框为真源）：**
- `pair.tsx`（H0）：粘贴/扫码 QR payload（BarcodeDetector 可用则相机，否则手动粘贴）→ `POST /pair` → 令牌存 localStorage（M1 内部切片允许 LAN origin，规格 §9 第 6 步豁免）→ 进 hosts。
- `hosts.tsx`（H1）：localStorage 已配对宿主列表 + 连接态。
- `host.tsx`（H2）：`app.snapshot` + `control.watch` 驱动活动/智能体列表，状态过滤。
- `session.tsx`（S1）：`terminal-screen.tsx`——前台时 400ms 轮询 `terminal.screen`（`scope:"viewport"`），标注「当前屏幕」（**禁写历史/scrollback**）；`approval-bar.tsx`——仅当该会话 status === `waiting` 且带未决 interactionId 时显示 Enter/Esc/y/n/1-9 键，点击发 `agent.attention.respond`（带 interactionId），失败 `interaction_stale` 时刷新快照。
- `changes.tsx`（S2）/`files.tsx`（S3）：`git.getStatus`/`git.getDiffPatch`、`file.list`/`file.readText`，只读。
- `notifications.tsx`（N1）：`notifications.list` + `mark-read`。

- [ ] **Step 1-5:** 组件测试（审批条等待态显隐、T1 文案断言无 scrollback 字样）→ 实现 → 构建通过 → commit `feat(mobile-web): 主机/会话/变更/文件/通知页面`

---

### Task 13: 装配接线 + 静态托管 + 冒烟

**Files:**
- Modify: `src/main/app-core/index.ts`（pairing 服务 + remote-control server 装配进 services）、`src/main/index.ts`（registration-owner start + quit 时 stop 与 `flushPairingState`）、`scripts/build-dist.sh`（在 plugins:pack 与 electron-vite build 之间插 `pnpm build:mobile-web`）

**冒烟（真机或本机浏览器，手工脚本）：**
1. `pnpm dev` → 设置 → 远程访问 → 开 → 生成配对码。
2. 浏览器开 `http://<LAN-IP>:<port>` → 粘贴 QR payload → 配对成功进主机列表。
3. 进会话 → 看到「当前屏幕」；制造一个 permission 等待 → 审批条出现 → 按 `y` → 桌面终端收到键序。
4. 设置页吊销该设备 → 浏览器下一命令/推送收到 `device_revoked` 并断连。
5. 变更页看到 git diff；通知页标已读同步到桌面消息中心。

- [ ] **Step 1-4:** 接线实现 → `pnpm typecheck && pnpm lint` → 按上脚本冒烟并记录结果 → commit `feat(remote-control): main 装配与打包链接入`

---

### Task 14: 治理收口

**Files:**
- Test: `tests/unit/main/adapters/remote-control/governance.test.ts`（新建）、`tests/unit/plugins/markdown/...` 不动

锁定规格 §13 四条不变量：
1. remote-control 默认关闭（读装配代码路径断言：无设置开启不调 `start`）。
2. 同网切片不强制会合云——`relayHint` 恒 `null`（QR payload 测试）。
3. `mobile-paired` 默认集不含 `*:write`（`notification:write` 除外）——Task 1 已锁，此处引用防回退。
4. 移动端文案不得把 T1 称为 scrollback/完整历史——静态扫描 `apps/mobile-web/src/**` 与宿主新 locale 键，禁词 `scrollback` / `完整历史`（允许出现在注释与测试断言的负向匹配里）。
另：T1 契约——`terminalScreenPayloadSchema` 已有 forbid scrollback，补一条回归测试引用；M2 兼容性两条（见「M2 账号时代兼容性」）：QR payload 断言含 `relayHint` 键、`PierPairedDevice`/pairing store schema 演进约束注释入契约测试；`pnpm check`（含 depcruise/file-size/dir-density）全绿。

- [ ] **Step 1-4:** 写治理测试 → 跑 `pnpm check` 全量 → 修门口径 → commit `test(remote-control): M1 治理不变量收口`

---

## M2 账号时代兼容性（防推翻审计，先于任务执行锁定）

产品确实需要服务器端，但不在 M1：M2 的「官方会合云 + 账号」是规格 §9.2 已锁的交付（「做官方云」不是开放问题）。M1 的每个构件都按「M2 只叠加、不推翻」审计过，接缝如下：

| M1 产物 | M2 时的命运 | 依据 |
|---|---|---|
| 设备令牌体系（配对码 → 长期令牌 → tokenHash/epoch） | **原样复用**。账号是叠加层：远程路径「同时把该设备绑到 Pier 账号」，同网/远程「同一令牌、不重扫码」。账号只解决「哪台手机能看见哪台宿主」的发现与归属，不替换设备令牌 | 规格 §9 第 2/3 步 |
| 帧协议（pier.control/v2 扩展） | **原样复用**。会合转发只是换传输，「帧契约与配对令牌体系不变」 | 规格 §9.1 末条 |
| QR payload | **已预留** `relayHint` 字段（M1 恒 `null`） | 规格 §11.3 冻结第 3 条 |
| pairing store schema | **additive 演进**：设备表加 `accountId` 等归属字段只需新增可选项，zod 解析向后兼容；`instanceSecret` 在 D4 决定 E2E 时演进为宿主身份密钥 | 本计划 Task 2 |
| PairingService | **additive 演进**：绑定账号是新方法，不改写令牌生命周期 | 本计划 Task 3 |
| SPA 令牌存 LAN origin | **规格明确豁免 + 已写死迁移路径**：核心交付时经账号认证一次性迁移并作废 LAN 凭据。这是规格接受的一次性迁移，不是推翻 | 规格 §9 第 6 步 |
| 设置页「远程访问」卡 | M2 在此卡上叠加账号登录态，布局不重构 | 本计划 Task 10 |

M2 的云选型（Supabase Auth + Postgres 做账号/设备注册表是候选之一）只覆盖账号与注册表；帧转发是有状态长连接中继，Supabase 无对应物，需自建薄 relay（规格 §9.2「可自建集群，也可以背后用隧道基础设施」）。该决策属 M2 立项，不改变 M1 任何一行代码。

可治理锁定的两条（并入 Task 14）：① QR payload 契约测试断言含 `relayHint` 键；② `PierPairedDevice` / pairing store schema 演进只允许追加可选字段（契约测试注释写明）。

## 明确不做（本计划范围外，防范围蔓延）

- 会合云 / 账号 / Web Push / `remotePush` 投递（M2，规格 §9.2/§12）。
- T2 终端（native tap、Ghostty 水合、`terminal.stream` 能力广告）（M3，规格 §10.1）。
- App / 小程序壳（M4/M5）。
- D2 远程自由输入勾选（`terminal.send`/`terminal.key` 对移动端开放）（规格 D2，随核心交付后评估）。
- mDNS 发现（规格 §9「可选增强」）。
