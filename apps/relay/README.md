# @pier/relay · Pier 会合云

无账号、零持久化的盲转发服务。权威设计：[`docs/superpowers/specs/2026-08-31-mobile-relay-server-design.md`](../../docs/superpowers/specs/2026-08-31-mobile-relay-server-design.md)。

- **做**：宿主准入（Ed25519 挑战签名，hostId = 公钥哈希自证明）、设备准入（宿主担保的通行证名册，仅哈希）、在线态、`RelayEnvelopeFrame` 盲转发、配对赎回盲传、限速。
- **不做**：账号、数据库、帧解析/解密、消息存储、授权（`tokenEpoch` 核对在宿主）、推送（宿主直发）。

## 运行

仓库根目录：

```bash
pnpm dev:relay                 # Node 24 原生跑 TS，默认 :8787
curl -sS http://127.0.0.1:8787/healthz   # 期望 {"ok":true}
```

与桌面联调（另开终端；`PIER_RELAY_URL` 覆盖内置官方地址、改连本地实例）：

```bash
PIER_RELAY_URL=ws://127.0.0.1:8787 pnpm dev
```

设置 → 远程访问 → 开启后，「跨网远程」应显示已连接。QR 会带 `relayHint`；Web 壳走会合，不再直连 LAN `ws://`。

语义与治理不依赖真实进程，可只跑：

```bash
pnpm vitest run tests/unit/relay
```

其中 `process-boot.test.ts` 会按 `package.json` 的 `dev:relay` 真拉起进程并打 `/healthz`。

TLS 由前置层（Caddy 等）终结；容器无 volume、无密钥材料，重启即全忘——宿主重拨自动重建在线态与名册。

## 发布

与宿主 `v*` / 插件通道解耦（见 [`docs/release.md`](../../docs/release.md)）。

```bash
git tag relay-v0.1.0 && git push origin relay-v0.1.0
```

- 触发 `.github/workflows/deploy-relay.yml`：类型检查 + `tests/unit/relay` + `docker build`。
- 当前为 **dry-run**（构建校验，不推镜像、不 SSH）。接入 GHCR 与 VM 密钥后，同一 tag 才真正 `compose pull && up -d`。
- 类型检查：`pnpm build:relay`（`tsc --noEmit`）。运行时不走编译产物，容器与 `dev:relay` 都是 Node 剥离 TS。

移动端 Web 壳（静态 PWA）是另一条 tag：

```bash
git tag mobile-web-v0.1.0 && git push origin mobile-web-v0.1.0
```

产物：`pnpm build:mobile-web` → `out/mobile-web/`。workflow 校验 `sw.js` / `manifest.webmanifest` / `index.html`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `RELAY_PORT` | `8787` | 监听端口；`0` 表示系统分配（进程冒烟） |
| `RELAY_PUBLIC_URL` | —（可选） | 对外 wss/https 基址（日志与自检用） |
| `RELAY_MAX_DOWNLINKS_PER_DEVICE` | `2` | 每设备并发管道上限 |
| `RELAY_FRAMES_PER_SECOND` | `200` | 单连接帧速上限 |
| `RELAY_HELLO_FAILURES_PER_MINUTE` | `5` | 单 IP 协议/签名失败限速（超限 60s 拒绝）；uplink 与 downlink 分窗 |
| `RELAY_DOWNLINK_HELLOS_PER_MINUTE` | `60` | 单 IP downlink hello 总次数（含诚实 `host_offline`） |
| `RELAY_HEARTBEAT_INTERVAL_MS` | `30000` | WS ping 间隔；一轮无 pong/入站则断开 |
| `RELAY_REDEEMS_PER_HOST_PER_HOUR` | `10` | 单宿主赎回限额 |
| `RELAY_REDEEMS_PER_IP_PER_MINUTE` | `5` | 单 IP 赎回限额 |
| `RELAY_STATUS_PER_IP_PER_MINUTE` | `60` | 单 IP 在线态查询限额 |
