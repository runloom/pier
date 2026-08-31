# Pier 移动端 M2 · 核心交付（远程会合 + 叫醒）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **状态（2026-08-31）**：任务 1–11 的代码已在 `feat/mobile-20260831`（会合云、出站拨号、E2E、Web Push、官方 origin、面板投影）。任务清单未逐项回勾，以代码与治理测试为准。闭环收口（体验诚实性、会合冒烟、规格去账号残留、§14 勾选门）见 [M2 收尾计划](2026-08-31-mobile-companion-m2-closeout.md)。传输模型冻结为会合云盲转发，不改为「只存地址再直连」。
>
> **修订（2026-08-31 第二版）**：产品评审判定账号体系过重，D-3 由「GitHub OAuth 账号」改为**无账号**（宿主身份密钥自证明 + 设备通行证），relay 随之零持久化；主规格第十三次修订与服务端设计已同步。

**Goal:** 落地规格 `docs/superpowers/specs/2026-08-26-mobile-companion-design.md` 的 M2 核心交付，补齐闭环第 5、6 条：官方会合云（**无账号**：宿主出站自证明 + 帧盲转发）与 Web 壳叫醒（唯一 HTTPS origin PWA + Web Push）。至此六条齐（配对一次 / 打开见主机 / 投影会话 / 就地审批 / 远程会合 / 离开能叫醒），移动端才可对外称核心体验交付（规格 §2.1、§14）。

**Architecture:** 三个落点。① 会合云是 monorepo 新包 `apps/relay/`：独立 Node 服务（非 Electron），只做宿主准入（挑战签名）、设备准入（宿主担保名册）、在线态与 `PierRelayEnvelope` 盲转发——**无账号、零持久化、不存帧、不解密、不授权**（快照模型幂等，断线重连拉全量；准入事实由宿主连接期担保；授权与 `tokenEpoch` 核对永远在宿主侧，规格 §17.5）。**服务端权威设计：[`2026-08-31-mobile-relay-server-design.md`](../specs/2026-08-31-mobile-relay-server-design.md)**（状态模型、帧协议、赎回盲传、防重放、失效模式、威胁模型），relay 相关任务以该文为准。② 宿主侧新增出站拨号 uplink（`src/main/adapters/remote-control/uplink/`），把 relay 转发来的每设备帧流适配成既有 `session-bridge` 会话，复用 M1 全部命令链；NCS 投递新增第三条正交通道 `remotePush`，宿主自持 VAPID 密钥**直发**浏览器 Push Service（不经会合云，规格 §12）。③ Web 壳在 `apps/mobile-web/` 原地演进：发布到唯一官方 HTTPS origin 的静态托管 + Service Worker + Web Push 订阅 + relay 传输层（无登录页）。

**Tech Stack:** Node ≥ 24（relay 独立运行时，**零持久化**，镜像 `node:24-slim`，对齐服务端设计 §10.2）· `ws`（已有）· 宿主新增 `web-push`（RFC 8030/8291 VAPID 发送）· E2E 与准入密码学用 `node:crypto` / WebCrypto（HKDF-SHA256 + AES-256-GCM + P-256 ECDHE + Ed25519，双端零新依赖）· React 19 + Vite 8（SPA 已有）。

## 计划内决策（依业界调研锁定；评审可推翻，推翻须回写规格）

调研结论详见 2026-08-31 会话调研（Happy / Tailscale DERP / RustDesk / WebKit / Chrome LNA），要点直接落为决策：

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| D-1 | **Web 壳一律经会合（含同网）** | 发布到 HTTPS origin 后，浏览器混合内容策略禁开 `ws://`（全浏览器强制、无 workaround）；Chrome 147+/Firefox 154 又对私网 `wss://` 加 Local Network Access 权限提示。故 M2 的 Web 壳不做 LAN 直连，QR 里的 `host`/`port` 保留给 dev 切片与 App 壳（M4，原生无此限制）。规格 §9 第 6 步措辞随本计划修订（Task 1） | websocket.org 混合内容参考；Chrome/Firefox LNA 公告 |
| D-2 | **D4-加密收口：E2E 密封，relay 盲** | 帧过会合一律密文：赎回时双端各自从设备令牌派生 `e2eKey = HKDF-SHA256(deviceToken, salt=fingerprint, info="pier-m2-e2e")`；宿主在赎回瞬间派生并经 safeStorage 存密钥（令牌本身仍只存哈希），手机从 localStorage 令牌即时派生。帧密封 AES-256-GCM。`tokenEpoch` 递增 = 新令牌 = 新密钥。relay 只见 `PierRelayEnvelope { hostId, deviceId, frame: 密文 }`。**两条推论**（详见服务端设计 §5.3/§6）：赎回往返必须用 QR 带外传递的高熵 `pairSecret` 派生的 `pairKey` 密封（否则令牌明文过 relay，E2E 作废）；每管道以双侧随机 nonce + P-256 临时 ECDH 混入派生 `channelKey`（PSK+ECDHE，前向保密默认达成）+ AAD 内单调 `seq` 防重放 | Happy how-it-works；规格 §17.2「实例密钥演进为宿主身份密钥」 |
| D-3 | **D4-准入收口：无账号**（2026-08-31 第二版，推翻首版 GitHub OAuth） | 宿主首启生成 Ed25519 身份密钥（`instanceSecret` 演进），`hostId = sha256(公钥)` 自证明、无法抢注，uplink 经挑战签名准入；设备准入凭宿主担保名册——`relayPass = HKDF(deviceToken, info="pier-m2-relay-pass")`，宿主存哈希并在 uplink 担保，手机持原文接入。**手机主机列表 = 本地已配对存储 +（凭 relayPass 查询的）会合在线态**，无登录。账号仅在未来配额/商业化需要时作为可选叠加层（契约 `PierAccountRef`/`PierHostRegistration` 转保留位） | Happy 公钥挑战（无密码无邮箱）；DERP 键即地址；RustDesk 无账号；四大厂用账号是因其手机端本就是自家账号 App，Pier 无此前提 |
| D-4 | **relay 形态：单实例零持久化薄服务** | `apps/relay/` 单包单实例：HTTP（在线态查询 + 赎回盲传）+ WS（宿主 uplink / 移动端 downlink）同进程；**无数据库**——在线表与设备名册全内存，宿主重拨即重建。**不存帧、不存推送句柄**（句柄在宿主，规格 §12）。多区域 / 水平扩展 / P2P 打洞列为非目标 | Tailscale DERP「盲转发 + 键即地址」；服务端设计 §3 |
| D-5 | **Web Push 宿主直发** | VAPID 密钥对宿主首启生成，私钥进 `secrets-store`（safeStorage 先例）；`web-push` 库 POST 到 `web.push.apple.com` 等端点，**不经 relay**。iOS 前置（HTTPS origin + 加到主屏 + 用户手势订阅）由 Task 10 的安装引导承接 | Apple Web Push 文档；规格 §12 |
| D-6 | **发布形态：静态 PWA 独立 origin** | `apps/mobile-web` 构建产物发布到官方静态托管（域名占位 `m.pier.codes`，relay 占位 `relay.pier.codes`，最终域名发布前定）。origin 永久稳定（令牌与推送订阅绑死 origin）。宿主同端口托管 SPA 降级为 dev-only 分发 | Happy web 壳（app.happy.engineering 静态 + 密钥在浏览器）先例；规格 §9 第 6 步 |

## Global Constraints

- **对外承诺以六条齐为准**：本计划完成前，任何文案不得宣称移动端核心交付完成（规格 §2.1、§14）。
- relay **不成为第二份事实源**：不跑代码、不持仓库、不解读帧、不做授权、**不落盘任何状态**；`tokenEpoch` 核对只在宿主（规格 §9.2、§17.5；服务端设计 §3）。
- 跨网路径宿主**只出站**；不开放公网入站、不公布主机地址。同网直连（M1 LAN listener）保留不动，与 uplink 并存（规格 §9.2 第 2 条）。
- **无账号红线**：relay 与两端源码不得引入注册/登录/OAuth/第三方身份；准入只认宿主签名与担保名册（治理锁 Task 12）。
- 推送不进帧协议：NCS → `remotePush` 适配器 → 按 `PierPushHandle.shell` 分叉；v1 只实现 `web`，未实现的壳 = 不推（规格 §11.4）。
- `resolveDeliveryPlan` 是唯一打断决策：remotePush 是第三条**正交**通道——**有 key-window 仍推手机**；目标设备无前台会话才推；kind ∈ `OS_ELIGIBLE_KINDS`；DND 与 in-app toast 同规则（error 除外）；现有 toast/OS 互斥不变（规格 §12）。禁止业务侧旁路判定。
- 帧仍是纯 JSON 文本契约（密封后的载体也是 JSON 字段），不依赖 DOM / Service Worker / IndexedDB（规格 §11.3 冻结第 1 条；SW 只做推送与深链，不进帧编解码）。
- 契约演进只许 additive：`PierPairedDevice` 加可选字段、QR payload 加可选 `hostId`/`pairSecret`、`PairingState` 加可选新字段；`PierAccountRef`/`PierHostRegistration` 保留不删（未来账号层槽位）；治理锁（governance.test.ts M2-②）不得放宽。
- M1 治理锁「`relayHint` 恒 null」按规格注释（「M1 恒 null；M2 会合地址」）**同步演进**：新锁 = 未配置 relay 时为 null、配置后为合法 `wss://` URL（Task 12）。
- 用户可见文案全部走 i18n 四语言；中文产品词：移动端、需要你处理、智能体；禁词 scrollback / 完整历史（治理扫描不变）。
- 仓库硬门禁：单文件 ≤ 500 行、目录密度、命名不重复父目录语义；禁 `@ts-ignore` / `as any`。
- relay 是新的运维面：滥用防护（hello 失败限速、名册准入、赎回限额、envelope 尺寸上限复用 `LOCAL_CONTROL_MAX_FRAME_BYTES`）必须随首版交付，不做「先上线后补」。

## 现状锚点（2026-08-31 勘察结论，实施时以代码为准复核）

- M1 已全量合入 main（0.1.33，主提交 `8c177fa40`）：适配器 / 配对 / Web 壳七面 / 审批 / 设置卡 / 治理与 e2e 全在。
- M2 契约状态：`src/shared/contracts/remote.ts` 的 `PierRelayEnvelope` / `PierPushHandle` 冻结待实现；`PierAccountRef` / `PierHostRegistration` 经规格第十三次修订转**保留位**（不实现、不删除）；`pairingQrPayloadSchema.relayHint` 注释「M1 恒 null；M2 会合地址」。
- 治理锁现状 `tests/unit/main/adapters/remote-control/governance.test.ts`：不变量 2 断言 `buildPairingQrPayload` 产物 `relayHint === null`——Task 12 演进；M2-② 锁 additive 注释——保持。
- Web 客户端 `apps/mobile-web/src/lib/client.ts:196` 硬编码 `` ws://${args.host}:${args.port}/ws ``——Task 9 抽传输层；`FATAL_AUTH_CODES`（`device_revoked`）断连不重连语义已就绪，relay 路径直接复用。
- 投递单一实现 `src/shared/notification-delivery.ts`：`resolveDeliveryPlan(input, prefs, focus)` 返回 `DeliveryPlan { decision, osCooldownKey?, osTarget, toastTarget }`；`OS_ELIGIBLE_KINDS = { agent.attention, agent.turn-finished }`。remotePush 扩展落点在此（Task 7）。
- 会话桥 `src/main/adapters/remote-control/session-bridge.ts` 的 `attachMobileSession(ws, ctx)` 接受 WebSocketLike——uplink 每设备虚拟通道实现同接口即可零改动复用（Task 5）。
- 宿主 `instanceSecret` 在 `src/main/state/pairing-store.ts`（首启生成）；规格 §17.2 预留「演进为宿主身份密钥」——Task 6 落地为 Ed25519 密钥对。
- safeStorage 先例：`src/main/state/secrets-store.ts`（身份私钥、VAPID 私钥、e2eKey 的落点）。
- `pnpm-workspace.yaml` 已含 `apps/*`；根 `package.json` 的 `typecheck:packages` 需追加 `apps/relay/tsconfig.json`。
- `apps/mobile-web/public/manifest.webmanifest` 已有（name「Pier 移动端」）；无 Service Worker、无 push 订阅、无 `navigator.storage.persist()`。
- e2e 先例：`tests/e2e/mobile/remote-access-smoke.spec.ts`（LAN 冒烟）——relay 冒烟仿此新建。

## 文件结构

**新建（relay，全部在 `apps/relay/`，无数据库）：**
- `package.json` / `tsconfig.json` / `README.md`（部署说明：单容器、无 volume、TLS 由前置层终结、环境变量清单）
- `src/config.ts` — 端口、公开 URL、限速参数（全部环境变量注入；**无任何密钥材料**）
- `src/host-auth.ts` — 挑战签名验证（Ed25519 verify + `hostId === sha256(pubKey)` 自证明校验）
- `src/registry.ts` — 在线表 + 设备名册（内存 `Map<hostId, { conn, roster: Map<deviceId, relayPassHash>, lastSeenAt }>`）
- `src/forward.ts` — envelope 路由：downlink→uplink / uplink→downlink，按 `(hostId, deviceId)`；宿主离线回 `server.error host_offline`
- `src/server.ts` — HTTP（`POST /hosts/status` 凭 relayPass 查在线态、`POST /pair/relay` 赎回盲传、`GET /healthz`）+ WS（`/uplink` 宿主、`/downlink` 移动端）同端口
- `src/main.ts` — 进程入口

**新建（宿主）：**
- `src/main/adapters/remote-control/uplink/dialer.ts` — 出站 WS 拨号 + 挑战应答 + 名册担保 + 指数退避重连；启停状态机**内聚于此**（不复制 LAN `registration.ts` 抽象——LAN 版是为异步 listen 失败/节流记账而生，出站拨号的重连循环本身就是状态机，再套一层是冗余）
- `src/main/adapters/remote-control/uplink/device-channel.ts` — 每 deviceId 虚拟 WebSocketLike（envelope 复用 / 密封解封 / channel 握手），喂给既有 `attachMobileSession`
- `src/main/services/pairing/e2e-seal.ts` — HKDF 派生（e2eKey / pairKey / relayPass / channelKey）+ ECDH + AES-256-GCM seal/unseal（纯函数，双端同构约定）
- `src/main/services/pairing/host-identity.ts` — Ed25519 身份密钥生命周期（`instanceSecret` 演进；私钥经 secrets-store；`hostId`/`fingerprint` 派生）
- `src/main/services/remote-push/service.ts` — VAPID 密钥生命周期 + `PierPushHandle` 登记表（pairing-store additive 字段）+ `web-push` 发送 + 失效句柄清理（410 Gone）
- `src/main/app-core/commands/notifications-push-handle.ts` — `notifications.registerPushHandle` / `unregisterPushHandle`（mobile-paired 可调）

**修改（宿主）：**
- `src/shared/contracts/remote.ts` — QR payload 可选 `hostId`/`pairSecret`（additive）；`PierAccountRef`/`PierHostRegistration` 注释改保留位
- 新建 `src/shared/contracts/relay.ts` — relay 帧契约（三端共用，Task 1）
- `src/shared/notification-delivery.ts` — `DeliveryPlan.remotePushTarget` + 输入扩展（Task 7 接口）
- `src/shared/contracts/host/control-commands.ts` + `metadata-table.ts` + `command-router.ts` — 新命令接线
- `src/main/state/pairing-store.ts` — additive：`hostKeyPair`（经 secrets-store 引用）、`relayPassHash`（per device）、`pushHandles`
- `src/main/adapters/remote-control/boot.ts` — uplink 装配（默认不拨号，随「远程访问」开关联动；**无账号前置**）
- `src/main/services/notification-center/`（deliverOs 同层）— remotePush 执行点接线
- `src/renderer/pages/settings/components/remote-access/section.tsx` — 「跨网远程」状态区（在线/重连中/未启用 + 保持唤醒提示；**无登录 UI**）
- 四语言 `settings-remote-access.ts` locale
- `docs/superpowers/specs/2026-08-26-mobile-companion-design.md` — §9 第 6 步（D-1 措辞 + 迁移句）；第十三次修订与 D4 收口已完成，Task 1 复核

**修改（Web 壳，`apps/mobile-web/`）：**
- `src/lib/client.ts` / `client-types.ts` — 传输抽象：`direct`（dev）| `relay`（wss + envelope + E2E 密封 + relayPass 准入）
- `src/lib/paired-hosts.ts` — additive：`hostId`、`pairSecret` 派生物不落盘（relayPass 每次从令牌派生）；LAN 存量作废逻辑
- `src/lib/e2e-seal.ts` — WebCrypto 侧密封（与宿主 `e2e-seal.ts` 逐字节同构，共享测试向量）
- `src/lib/relay-api.ts` — `POST /hosts/status`（凭 relayPass 批量查在线态）
- `src/pages/{hosts,pair}.tsx` — 主机列表加在线点（本地列表为主源）、扫码走 relay 赎回；**无登录页**
- `public/sw.js` + 注册 + `src/lib/push.ts` — push / notificationclick 深链 / 订阅管理
- `vite.config.ts` / `manifest.webmanifest` — SW 构建、`display: standalone` 核对、图标补齐
- 新增 `.github/workflows/deploy-mobile-web.yml`（静态发布）与 `deploy-relay.yml`（容器发布）——部署目标发布前定，workflow 先以 dry-run 落地

---

### Task 1: 契约与规格修订（additive 收口，先行冻结）

**Files:**
- Modify: `src/shared/contracts/remote.ts`、`docs/superpowers/specs/2026-08-26-mobile-companion-design.md`
- Create: `src/shared/contracts/relay.ts`（relay 帧契约，relay / 宿主 / Web 壳三端共用）
- Test: `tests/unit/shared/remote-contracts.test.ts`（扩充）、`tests/unit/shared/relay-contracts.test.ts`（新建）

**Interfaces:**
- `pairingQrPayloadSchema` 追加 `hostId: z.string().min(1).optional()` 与 `pairSecret: z.string().min(43).optional()`（32 字节 base64url；strict 保持；仅 QR 带外传递，赎回密封用——服务端设计 §5.3）；`relayHint` 语义注释改「未配置会合时 null；已配置为 relay wss URL」。人工输码（无 pairSecret）仅允许 LAN 直连赎回，relay 路径拒绝。
- `PierAccountRef` / `PierHostRegistration` 注释改「保留位（未来可选账号层），M2 无账号交付不实现」（对齐规格第十三次修订；additive 锁不动）。
- 新建 `src/shared/contracts/relay.ts`：relay 帧契约单一来源（服务端设计 §5 为文字权威）——`server.challenge`、`uplink.hello`（`{ hostId, hostPubKey, signature, roster }`）、`uplink.ready`、`roster.update`、`downlink.hello`（`{ hostId, deviceId, relayPass }`；deviceToken 不出现，令牌只对宿主出示）、`downlink.ready`、载体联合 `RelayEnvelopeFrame`（`sealed | plain`）、`pair.request/result`、传输层错误码（`host_offline` 等）、`/hosts/status` 请求响应体。**wire 形态取扁平**：uplink 帧只带 `deviceId`（hostId 由连接隐含）、downlink 直发载体联合（管道已绑定二元组，不套 envelope 包装）；冻结的 `pierRelayEnvelopeSchema` 全形保留为概念路由元组与未来 mesh 预留，不删除。纯 JSON 契约，源码禁 DOM 依赖（沿用 M1 帧协议冻结锁）。
- 规格修订复核：第十三次修订（去账号）与 D4 收口本日已入库；Task 1 补 §9 第 6 步 D-1 改写（Web 壳一律经会合 + 依据注记；LAN 直连留给 dev 与 App 壳）与同步把该步「经账号认证一次性迁移」改为「作废 LAN 凭据 + 官方 origin 重新配对一次」（内部切片人群的执行形态，消除 Task 11 与规格的矛盾）。

- [ ] **Step 1: 失败测试** — QR payload 带 `hostId`/`pairSecret` round-trip；relayHint 注释含「wss」；relay 帧契约正负形状用例（含 roster、challenge、status 体）+ 源码无 DOM 依赖锁；保留位注释断言。
- [ ] **Step 2: 实现契约 + 修订规格** — 规格改动引用调研依据（混合内容 / LNA）。
- [ ] **Step 3: 跑测试 + 治理** — `pnpm vitest run tests/unit/shared/remote-contracts.test.ts tests/unit/shared/relay-contracts.test.ts tests/unit/main/adapters/remote-control/governance.test.ts`（additive 锁必须仍绿）。
- [ ] **Step 4: Commit** — `feat(contracts): M2 会合帧契约与 QR additive 扩展（无账号模型）`

---

### Task 2: E2E 密封与派生层（双端同构纯函数）

**Files:**
- Create: `src/main/services/pairing/e2e-seal.ts`、`apps/mobile-web/src/lib/e2e-seal.ts`
- Test: `tests/unit/main/pairing/e2e-seal.test.ts`、`tests/unit/mobile-web/e2e-seal.test.ts`（共享测试向量文件 `tests/fixtures/e2e-seal-vectors.json`）

**Interfaces:**

```ts
// 双端同构（宿主 node:crypto / 手机 WebCrypto），签名一致：
deriveE2eKey(args: { deviceToken: string; fingerprint: string }): Promise<Uint8Array>;   // HKDF-SHA256, 32B, info="pier-m2-e2e"
derivePairKey(args: { pairSecret: string; fingerprint: string }): Promise<Uint8Array>;   // 赎回密封（服务端设计 §5.3）
deriveRelayPass(args: { deviceToken: string; fingerprint: string }): Promise<string>;    // info="pier-m2-relay-pass"，base64url；与 e2eKey 同根不同 info，互不可推
generateEphemeral(): Promise<{ publicKey: Uint8Array; exchange(peerPub: Uint8Array): Promise<Uint8Array> }>; // P-256 ECDH（WebCrypto / node:crypto 原生）
deriveChannelKey(e2eKey: Uint8Array, ecdhSecret: Uint8Array, clientNonce: Uint8Array, hostNonce: Uint8Array): Promise<Uint8Array>; // HKDF(ikm=e2eKey‖ecdhSecret)，info="pier-m2-channel"（PSK+ECDHE 前向保密，服务端设计 §6）
sealFrame(key: Uint8Array, seq: number, frameJson: string): Promise<SealedFrame>;   // { v: 1, seq, iv, ct }（AES-256-GCM，seq 入 AAD，iv 96-bit 随机）
unsealFrame(key: Uint8Array, sealed: SealedFrame, lastSeq: number): Promise<string>; // 认证失败或 seq ≤ lastSeq 抛错（防重放，服务端设计 §6）
```

行为契约：同一向量双端产物可互解（ECDH 以注入的固定测试密钥对保持向量确定性）；篡改 ct/iv/seq 必抛；重放（seq 不增）必抛；跨管道重放因 channelKey 不同必抛；channelKey 必须依赖 ECDH 秘密——仅凭 e2eKey 重建不出（前向保密锁）；e2eKey 与 relayPass 互不可推（info 隔离锁）；宿主在 `redeemPairingCode` 成功瞬间派生 e2eKey（交 `secrets-store`）与 relayPassHash（入 pairing-store），令牌原文不落盘不变。

- [ ] **Step 1: 失败测试**（固定向量：token/fingerprint → 各派生物 hex → seal/unseal round-trip；跨端向量文件两侧测试共读）
- [ ] **Step 2: 实现两端** — 宿主 `node:crypto`（hkdfSync + createCipheriv gcm + ECDH）；SPA WebCrypto（deriveBits + AES-GCM + ECDH）。
- [ ] **Step 3: 通过 + redeem 接线**（pairing service 派生存 key 与 passHash；吊销时删除）。
- [ ] **Step 4: Commit** — `feat(pairing): 设备级 E2E 密封与派生层（HKDF + AES-GCM + ECDHE，双端同构）`

---

### Task 3: relay 脚手架——挑战准入 + 名册 + 在线态（无账号、无库）

**Files:**
- Create: `apps/relay/`（文件结构节所列）
- Modify: 根 `package.json`（`typecheck:packages` 追加、`dev:relay` / `build:relay` 脚本）
- Test: `tests/unit/relay/{host-auth,registry,server}.test.ts`

**要点：**
- 宿主准入：WS `/uplink` 建立即发 `server.challenge { nonce }`；`uplink.hello` 验 `hostId === sha256(hostPubKey)` + Ed25519 签名 → 在线表登记 + 收名册。
- 设备准入：`downlink.hello` 对照该宿主名册验 `sha256(relayPass)`；宿主离线答 `host_offline`（不泄露 hostId 存在性——名册不可查时一律按离线答）。
- `POST /hosts/status`：body `[{ hostId, relayPass }]` → 逐项 `online | offline`；通行证不符一律 `offline`。
- 限速（服务端设计 §8）：hello 失败 5 次/IP → 60s；每宿主 downlink 并发 ≤ 名册 × 2；envelope ≤ `LOCAL_CONTROL_MAX_FRAME_BYTES` 且 ≤ 200 帧/s/连接；赎回 10 次/时/hostId + 5 次/分/IP；status 60 次/分/IP。
- 配置全环境变量：`RELAY_PORT` / `RELAY_PUBLIC_URL` / 限速参数。**无数据库、无密钥配置。**

- [ ] **Step 1: 失败测试**（挑战签名正负向、hostId 伪造拒绝、名册验证、status 不泄露存在性、限速触发、内存态重启即空）
- [ ] **Step 2: 实现** — 依赖仅 `ws`（HTTP 用 `node:http`，路由手写小表，不引框架）。
- [ ] **Step 3: 通过 + `pnpm typecheck`**
- [ ] **Step 4: Commit** — `feat(relay): 会合云脚手架——挑战准入与担保名册（无账号零持久化）`

---

### Task 4: relay 转发语义——envelope 路由 + 名册增删 + 宿主离线

**Files:**
- Create: `apps/relay/src/forward.ts`（+ server.ts WS 接线）
- Test: `tests/unit/relay/forward.test.ts`（in-process 起 relay，双端 fake WS）

**行为契约（逐条锁测试）：**
1. 宿主 `/uplink` 挑战签名通过 → 在线 + 名册就位；同 hostId 重复拨号踢旧连接（后来者胜）。
2. 移动端 `/downlink` hello：名册哈希验证通过 → 建立管道；不符 → `server.error auth_failed` + close。
3. 双向透传 `PierRelayEnvelope`：relay 不解析 `frame` 字段（治理：forward.ts 源码禁 import `e2e-seal` / 禁解析 `.frame` 内容）。
4. 宿主离线：downlink 发帧回 `server.error host_offline`；宿主重新上线后移动端重连即恢复。
5. 名册增删：`roster.update { upsert }`（配对成功）即时可接入；`roster.update { remove }`（吊销）→ relay 断开该 deviceId 全部 downlink（防御性；权威判定仍在宿主 epoch 门）。
6. 配对赎回盲传（服务端设计 §5.3）：`POST /pair/relay { hostId, sealed }` → uplink `pair.request { requestId, sealedRequest }` → 宿主用 pairKey 解封验码签发 → 先 `roster.update { upsert }` 再 `pair.result { requestId, ok, sealedResult }` → relay 回密文包。relay 全程不见令牌；无 pairSecret 的赎回（人工输码）在 relay 路径直接 403。

- [ ] **Step 1: 失败测试**（六条各至少一用例；含「relay 源码无帧解析」静态断言）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 通过**
- [ ] **Step 4: Commit** — `feat(relay): envelope 盲转发与名册同步`

---

### Task 5: 宿主出站拨号 uplink——复用 session-bridge

**Files:**
- Create: `src/main/adapters/remote-control/uplink/{dialer,device-channel}.ts`（启停状态机内聚在 dialer，见文件结构节理由）
- Modify: `src/main/adapters/remote-control/boot.ts`
- Test: `tests/unit/main/adapters/remote-control/uplink.test.ts`

**Interfaces:**

```ts
createUplinkDialer(args: {
  relayUrl: string;                       // 设置 + PIER_RELAY_URL dev override
  identity: HostIdentity;                 // Task 6：hostId / 公钥 / sign(nonce)
  getRoster: () => { deviceId: string; relayPassHash: string }[]; // pairing-store 投影
  onDeviceFrame: (deviceId: string, rawFrame: string) => void;    // 解封后帧
  sealForDevice: (deviceId: string, frameJson: string) => Promise<SealedFrame | null>; // 无 key（未配对/已吊销）→ null 丢弃
}): { start(): void; stop(): void; state(): UplinkState };        // 指数退避 1s→60s，「远程访问」关闭即 stop
```

- `device-channel.ts`：`createUplinkDeviceChannel(deviceId, sendEnvelope)` 返回 WebSocketLike——`send()` 密封后包 envelope 出站；收帧解封后喂 `handleLine`；`close()` 通知 relay 断该设备管道。每 deviceId 惰性建、断线销毁；直接喂给 M1 `attachMobileSession`（epoch 门 / 吊销踢线 / authorizer 全部原样生效）。channel.init/ack 握手（nonce + ECDH 临时公钥）由 device-channel 承担。
- 装配：`boot.ts` 默认不拨号；「远程访问」开启 → start；关闭 → stop（**无账号前置**）。配对/吊销联动：`pairing.onRevoke` 已有 listener，uplink 侧发 `roster.update { remove }`；赎回成功发 `roster.update { upsert }`（Task 4 第 5/6 条的宿主端）。
- 同 deviceId 竞态规则：LAN 会话与 relay 通道并存或重连竞态时**后来者胜**（对齐 relay 侧同 hostId 重复拨号规则）——注册前先 dispose 旧 `mobile:<deviceId>` 会话，避免 clients registry 撞号；测试锁定。

- [ ] **Step 1: 失败测试**（fake relay WS：挑战应答 + 名册担保、设备帧往返经真 session-bridge 到 mock executeCommand、退避重连、开关停机、roster.update 双向、密封失败丢帧不炸、同 deviceId 后来者胜）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 通过 + 治理回归**（governance.test.ts 不变量 1「默认关闭」对 uplink 同样成立：boot 静态断言扩展）
- [ ] **Step 4: Commit** — `feat(remote-control): 宿主出站会合拨号与设备虚拟通道`

---

### Task 6: 宿主身份密钥 + 设置卡「跨网远程」

**Files:**
- Create: `src/main/services/pairing/host-identity.ts`
- Modify: `src/main/app-core/commands/remote-access.ts`（`remoteAccess.getState` 增跨网状态：uplink 在线/重连中/未启用 + hostId 短指纹）
- Modify: `src/renderer/pages/settings/components/remote-access/section.tsx` + 四语言 locale
- Test: `tests/unit/main/pairing/host-identity.test.ts`、`tests/unit/app-core/remote-access.test.ts`（扩充）、`tests/component/settings/remote-access-section.test.tsx`（扩充）

**要点：**
- `host-identity.ts`：首用生成 Ed25519 密钥对（私钥经 secrets-store，公钥/hostId 入 pairing-store additive 字段）；提供 `sign(nonce)`；`fingerprint` 统一为 `hostId` 前 16 hex（同源派生，不再独立存储）。**`instanceSecret` 就此退役**（读旧档兼容、不再写入或使用）——M2 发布本就全量作废存量令牌（Task 11），fingerprint 切换无兼容负担。
- 设置卡新增「跨网远程」区：连接状态（已连接 / 重连中 / 未启用）、「保持唤醒」提示文案（防睡眠指引，规格 §9.2 配套注意）。**无登录、无账号 UI。**文案 i18n 四语言；中文禁实现词（对用户写「远程连接」，不写 relay/会合/名册）。
- 二维码 payload 从此带 `hostId` + `pairSecret` + `relayHint`（已配置官方 relay URL 时）。

- [ ] **Step 1: 失败测试**（密钥生成幂等、hostId=sha256(pub) 锁、签名可验、getState 增跨网状态且脱敏、QR 三新字段）
- [ ] **Step 2: 实现 + 设置卡**
- [ ] **Step 3: 通过 + 组件测试**
- [ ] **Step 4: Commit** — `feat(remote-access): 宿主身份密钥与跨网远程设置`

---

### Task 7: `remotePush` 投递契约——第三条正交通道

**Files:**
- Modify: `src/shared/notification-delivery.ts`
- Test: `tests/unit/shared/notification-delivery.test.ts`（扩充，规格 §13 投递用例）

**Interfaces:**

```ts
// DeliveryInput 不变；新增第四入参（可选，缺省 = 无设备，纯函数保持）：
export interface RemotePushCandidate { deviceId: string; hasLiveSession: boolean; }
export function resolveDeliveryPlan(input, prefs, focus, remote?: { candidates: RemotePushCandidate[] }): DeliveryPlan;
// DeliveryPlan 追加：
remotePushTarget: { mode: "none" } | { mode: "devices"; deviceIds: string[] };
```

行为契约（每条一用例）：
1. kind ∉ `OS_ELIGIBLE_KINDS` → none（与 OS 同白名单）。
2. 候选设备 `hasLiveSession === true` → 该设备剔除（前台会话自己会收到 waiting 快照）。
3. **有 key-window 仍推**（toast 与 remotePush 并行；规格 §12 关键场景）。
4. DND：非 error 全剔除（与 toast 同规则）；不影响 osNotify 既有行为。
5. `shouldSilenceAgentInterrupt` 静音 → remotePush 同静音（打断三通道统一受细粒度门）。
6. 现有 toast/OS 互斥与全部既有用例回归不变。

- [ ] **Step 1: 失败测试**（六条 + 既有回归）
- [ ] **Step 2: 实现**（纯函数内收口，禁止在 NCS 业务层二次判定）
- [ ] **Step 3: 通过**
- [ ] **Step 4: Commit** — `feat(notifications): 投递计划新增 remotePush 正交通道`

---

### Task 8: 宿主 Web Push 发送器 + 句柄登记命令

**Files:**
- Create: `src/main/services/remote-push/service.ts`、`src/main/app-core/commands/notifications-push-handle.ts`
- Modify: `metadata-table.ts`、`control-commands.ts`、`command-router.ts`、`pairing-store.ts`（additive `pushHandles: PierPushHandle[]`）、NCS 投递执行点
- Test: `tests/unit/main/remote-push/service.test.ts`、`tests/unit/app-core/notifications-push-handle.test.ts`

**要点：**
- 新依赖 `web-push`；VAPID 密钥对首用生成，私钥 secrets-store、公钥随 `server.hello.features.webPushPublicKey` 广告给壳。
- 命令 `notifications.registerPushHandle { webPush: { endpoint, keys } }` / `notifications.unregisterPushHandle`：`allowedClientKinds: ["mobile-paired"]`、能力 `notification:write`；句柄按会话 deviceId 归属（不信客户端自报 deviceId）。
- 发送：NCS 拿到 plan.remotePushTarget.deviceIds → 查句柄 → `web-push.sendNotification`（payload：标题/详情/深链 path，i18n 由宿主渲染后下发）；410/404 → 删句柄；节流复用 `osCooldownKey` 同款冷却（按 kind+agentRef）。
- `hasLiveSession` 事实源：LAN session-bridge + uplink device-channel 的在线 deviceId 并集（clients registry 已有 `mobile:` 前缀 id，直接查）。

- [ ] **Step 1: 失败测试**（登记/注销归属校验、epoch 吊销后句柄清除、发送成功/410 清理、冷却去重、deviceId 伪造被拒）
- [ ] **Step 2: 实现 + NCS 接线**
- [ ] **Step 3: 通过 + `pnpm test:unit` 通知域全量回归**
- [ ] **Step 4: Commit** — `feat(remote-push): 宿主直发 Web Push 与句柄登记`

---

### Task 9: Web 壳传输层演进——relay + E2E + 在线态

**Files:**
- Modify: `apps/mobile-web/src/lib/{client,client-types,paired-hosts,routes}.ts`、`src/pages/{hosts,pair}.tsx`
- Create: `apps/mobile-web/src/lib/relay-api.ts`（`POST /hosts/status`）
- Test: `tests/unit/mobile-web/{client-relay,relay-api}.test.ts`

**要点：**
- 传输抽象：`connect(args)` 增 `transport: { kind: "direct", host, port } | { kind: "relay", url, hostId, relayPass }`；relay 路径 hello 前先 downlink 握手 + channel.init/ack（nonce + ECDH），帧出入经 `e2e-seal`（Task 2）；`device_revoked` / `host_offline` 语义接入既有状态机（fatal / 可重试）。
- 主机列表（**本地为主源，无登录**）：localStorage 已配对列表 + `POST /hosts/status`（relayPass 每次从存储的 deviceToken 即时派生，不落盘）刷新在线点。
- 配对页：扫码得 `hostId + pairSecret + relayHint` → pairKey 密封 `POST {relayHint}/pair/relay` 赎回 → 存 `{ hostId, deviceId, deviceToken, fingerprint }`。
- dev 模式保留：`import.meta.env.DEV` 或 QR 带 host/port 时允许 direct `ws://`（宿主 LAN 托管的切片入口），生产 origin 构建禁用 direct（构建时常量裁剪）。

- [ ] **Step 1: 失败测试**（relay 握手帧序含 channel.init/ack、密封往返对接 Task 2 向量、host_offline 重试、生产构建 direct 被裁、status 批量刷新）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 通过 + `pnpm build:mobile-web`**
- [ ] **Step 4: Commit** — `feat(mobile-web): 会合传输与在线态（E2E 密封，无登录）`

---

### Task 10: Web 壳 PWA 化——Service Worker + 订阅 + 深链 + 持久化

**Files:**
- Create: `apps/mobile-web/public/sw.js`、`src/lib/push.ts`、安装引导组件
- Modify: `src/main.tsx`（SW 注册）、`manifest.webmanifest`、`src/pages/notifications.tsx`（订阅入口）
- Test: `tests/unit/mobile-web/push.test.ts`（sw 消息合约 + 订阅状态机，mock PushManager）

**要点：**
- SW 只做三件事：`push`（showNotification，标题/详情/深链来自宿主 payload）、`notificationclick`（focus 或 openWindow 到 `routes` 深链：主机 → 会话 / 通知）、版本升级 skipWaiting。**无 fetch 缓存**（v1 避免静态资源陈旧问题，规格帧契约也不依赖 SW）。
- 订阅流：仅在「已配对 + standalone 显示模式」下，用户手势触发 `pushManager.subscribe(userVisibleOnly: true, applicationServerKey: 宿主广告的公钥)` → `notifications.registerPushHandle` 上行。iOS 非 standalone 时展示「加到主屏幕」引导（分步图文，i18n）。
- 首启调用 `navigator.storage.persist()`；订阅健康检查：打开时校验句柄仍在（宿主快照），失效引导重订阅。
- Safari 18.4+ Declarative Web Push 作渐进增强（payload 兼容 `web_push: 8030` 字段），不作为必达。

- [ ] **Step 1: 失败测试**（notificationclick 深链路由、非 standalone 不出订阅按钮、句柄失效重订阅提示）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 通过 + 真机手测记录**（iPhone Safari：加主屏 → 授权 → 锁屏收横幅 → 点开落会话）
- [ ] **Step 4: Commit** — `feat(mobile-web): PWA 叫醒——Service Worker 与 Web Push 订阅`

---

### Task 11: 发布管线与切片迁移

**Files:**
- Create: `.github/workflows/deploy-mobile-web.yml`、`.github/workflows/deploy-relay.yml`、`apps/relay/Dockerfile`
- Modify: `apps/mobile-web/vite.config.ts`（生产 origin 常量）、宿主设置卡（QR relayHint 指向官方 relay）、`src/main/adapters/remote-control/static-spa.ts` 注释（降级 dev-only 分发）
- Test: `tests/unit/relay/config.test.ts`（生产配置完整性校验）

**要点：**
- 域名与托管商发布前敲定（占位 `m.pier.codes` / `relay.pier.codes`）；workflow 先以构建 + 产物校验（dry-run）落地，接入部署密钥后启用。relay 容器**无 volume 无密钥**，部署即换（服务端设计 §10.3/§10.4）。
- **LAN 切片迁移（规格 §9 第 6 步，Task 1 已修订措辞）**：M1 内部切片人群 = 团队自用。执行 = 发布公告 + 宿主升级后对既有设备全量 `tokenEpoch` 递增（一次性作废 LAN origin 令牌），用户在官方 origin 重扫一次码。不建跨 origin 迁移通道（一次性成本 < 通道复杂度）。
- 宿主 LAN 托管 SPA 保留为 dev 分发（`PIER_PLUGIN_MODE=workspace` 同精神），生产 QR 深链指向官方 origin。

- [ ] **Step 1: workflow + Dockerfile 落地（dry-run 绿）**
- [ ] **Step 2: 迁移逻辑 + 设置卡 QR 演进**
- [ ] **Step 3: `pnpm check` 全绿**
- [ ] **Step 4: Commit** — `feat(mobile): 发布管线与 LAN 切片令牌作废迁移`

---

### Task 12: 治理收口 + 闭环冒烟

**Files:**
- Modify: `tests/unit/main/adapters/remote-control/governance.test.ts`
- Create: `tests/unit/relay/governance.test.ts`、`tests/e2e/mobile/relay-smoke.spec.ts`（或 vitest 集成冒烟，视 e2e runner 承载力定）

**治理演进与新增（规格 §13 + 服务端设计 §13 对照）：**
1. 不变量 2 演进：QR payload——未配置 relay 时 `relayHint === null`；配置后必须是合法 `wss://` URL 且带 `hostId`/`pairSecret`。
2. 新锁「relay 盲」：`apps/relay/src/**` 静态断言——不 import `e2e-seal`、不出现 `unseal` / 帧内容解析；envelope 透传路径无 `JSON.parse(… .frame)` / 无 `.frame` 内容解构；赎回路径无 `deviceToken` 字面量；日志语句无 frame / relayPass / 令牌字段。
3. 新锁「relay 零持久化 + 无账号」：`apps/relay/src/**` 禁 import `node:sqlite` / `node:fs` 写路径；源码无 `oauth` / `github` / 账号业务字样（保留位契约 import 除外）。
4. 新锁「宿主只出站」：uplink dialer 源码无 `.listen(`；boot 装配对 uplink 维持默认关。
5. remotePush 治理：`resolveDeliveryPlan` 用例断言「有 key-window 仍可 remotePush」「toast/OS 互斥不因 remotePush 改变」「未实现壳（app/miniprogram 句柄）不发送」。
6. 文案治理沿用禁词扫描（新增 locale 键与 `apps/mobile-web` 新页自动进扫描范围）。
7. Web origin 验收（规格 §13）：同网配对 → 官方 origin 打开 → 不再扫码 → 收到 Web Push（真机手测记录进 PR；自动化只覆盖到「句柄登记 + 宿主发送调用」层）。

**冒烟（relay-smoke，全自动）：** in-process 起 relay → 宿主 uplink 挑战签名注册 + 名册担保 → fake 手机 downlink relayPass 握手 → channel.init/ack → 密封 command 往返（`app.snapshot`）→ 吊销（roster.update remove）→ downlink 收 `device_revoked` 断连 → 宿主离线 → downlink 收 `host_offline`。

- [ ] **Step 1: 治理测试演进与新增**
- [ ] **Step 2: 冒烟实现**
- [ ] **Step 3: `pnpm preflight:push` 全绿**
- [ ] **Step 4: Commit** — `test(mobile): M2 治理不变量与会合冒烟收口`

---

## M3–M5 兼容性审计（防推翻，执行前锁定）

| M2 产物 | 后续切片的命运 | 依据 |
|---|---|---|
| envelope 盲转发 | **原样承载 T2**：`terminal.subscribe` 流帧也是 v2 帧，密封后透传，relay 零改动（M3 只动宿主 native 开口与壳渲染） | 规格 §10.1、§17.5 |
| `PierPushHandle.shell` 分叉 | App 壳（M4）加 `apnsOrFcm?` additive 字段 + 宿主新适配器；web 路径不动 | 规格 §11.4 |
| hostId 自证明 + relayPass | App / 小程序壳同构复用（白名单域名 = relay HTTPS，D7 前置达成）；无账号也无小程序登录负担 | 规格 §11.3 冻结第 6 条 |
| E2E 密封 | App / 小程序壳同构实现 `e2e-seal`（AES-GCM/ECDH 全平台可得）；测试向量文件即跨端契约 | 本计划 Task 2 |
| dev direct 传输 | App 壳的 LAN 直连入口（原生无混合内容限制），QR host/port 字段复用 | 本计划 D-1 |
| 未来账号层 | 配额/商业化/跨设备漫游需要时 additive 启用 `PierAccountRef`/`PierHostRegistration` 保留位；无账号路径继续可用 | 服务端设计 §10.6 |

## 明确不做（本计划范围外，防范围蔓延）

- **用户账号体系**（注册/登录/OAuth/邮箱）——2026-08-31 评审去除；未来按触发条件作为可选叠加层引入。
- P2P 打洞 / WebRTC / 多区域 relay mesh（带宽优化，闭环不依赖）。
- relay 任何持久化（数据库、消息信箱、离线队列——快照模型不需要；Happy 的密文信箱是聊天形态的产物）。
- T2 终端流、App 壳、小程序壳（M3–M5）。
- D2 远程自由输入勾选（随核心交付后评估不变）。
- Supabase / 任何 BaaS。
- SW fetch 缓存 / 离线模式（v1 静态资源直连托管，避免陈旧壳）。

## 验收（核心六条对照，全部达成才可对外）

1. **配对一次**：桌面出码（带 hostId + pairSecret + relayHint）→ 官方 origin 扫码 → 长期令牌。此后打开不扫码、**全程无注册登录**。
2. **打开见主机**：本地已配对主机列表 + 会合在线态真值；多宿主并列。
3. **投影会话**：跨网经会合进入 H2 → S1/S2/S3 全部可用（T1「当前屏幕」+ 只读变更/文件），与 LAN 行为一致。
4. **就地审批**：跨网路径 `agent.attention.respond` 双重门语义与 LAN 完全一致（`interaction_stale` / `device_revoked` 可复现）。
5. **远程仍在**：宿主换网 / 断网恢复后 uplink 自动重拨（挑战重签 + 名册重担保），手机无感重连；吊销即断。
6. **离开能叫醒**：手机锁屏、PWA 未在前台，桌面智能体进入「需要你处理」→ 锁屏横幅 → 点开落到该会话（真机记录）。

## 本地联调与发布（实施后）

会合云必须先能作为独立进程起来，再谈桌面/PWA。操作单一来源：[`apps/relay/README.md`](../../../apps/relay/README.md)。

```bash
pnpm dev:relay
curl -sS http://127.0.0.1:8787/healthz
PIER_RELAY_URL=ws://127.0.0.1:8787 pnpm dev
pnpm vitest run tests/unit/relay          # 含 process-boot 进程级 /healthz
```

发布 tag（与宿主 `v*` 解耦；workflow 现为 dry-run）：`relay-v*`、`mobile-web-v*`，见 [`docs/release.md`](../../../docs/release.md)。
