# 本机控制通道传输金标准：v1 保留 · v2 会话

**日期：** 2026-08-10
**状态：** 传输层实现仍在仓库；**产品 CLI 已收敛为「本机用户 + 协调智能体共用 pier」——一律 `cli-human`**
**实现水位（终态）：** 用户手册 Canvas [pier-cli-user-manual](../../../.pier/canvases/pier-cli-user-manual/)。唯一主体 `cli-human`（`auth.none` + peer）；人类与协调智能体一律本机 `pier`。CLI 不是权限系统。
**层级权威：**

| 层级 | 权威 | 冲突时 |
|------|------|--------|
| 产品边界 / 命令语义 / 完成权 / 内容路径 | Canvas [pier-cli-user-manual](../../../.pier/canvases/pier-cli-user-manual/) + 本文 §1 | **以手册与本文为准**（原 multi-agent-orchestration-gold 演示画布已于 2026-08-28 删除） |
| Socket 分流、帧形状、会话状态机、cursor/流、peer 校验 | **本文** | **以本文为准** |
| 命令面地图（已实现 vs 规划） | Canvas [pier-cli-user-manual](../../../.pier/canvases/pier-cli-user-manual/) | 实现未落地不得写成可用 |

**相关代码（现状 v1）：**
`bin/pier.mjs` · `bin/pier-cli-parser.js` · `src/main/adapters/cli/local-control/server.ts` · `src/shared/contracts/commands.ts` · `src/main/app-core/command-router.ts` · `src/shared/contracts/permissions.ts`

---

## 0. 金标准判定

本文是 **本机控制传输（local-control）金标准终态**：

- 定义 v1/v2 共存、帧 schema、principal、流与 cursor、错误码、测试矩阵与实施波次。
- **不是** 产品能力金标准全文（那是 Canvas）。
- 产品主路径已实现；planned 仅非必达尾巴（version/doctor 等），见 pier-cli-user-manual。

**一句话：** 保留 v1 短请求；在同 socket 上用 v2 会话（cli-human）承载持久 agents 控制与 JSONL 观察。

---

## 1. 已关闭的产品决议（原开放问题）

| # | 决议 | 理由 |
|---|------|------|
| R1 | **`agents.invoke` 为 non-goal**；one-shot 走原生 agent CLI。会话内持久写 op 同步挂到终态 `response`；`watch` 可推 `event*` 再 `response` | 产品边界：不封装一次性；长调用只服务持久 RuntimeRef |
| R2 | **cli-human 短控制**（open/panels/tasks…）走 **v1**；**agents 持久写**（start/turn/…）走 **会话** + effectKey | 避免把长挂起塞进 PierCommand；产品主体恒 cli-human |
| R3 | **subscribe 帧必须在协议层一次定义**；W1 可对未实现 stream 回 `unsupported`，**禁止** W3 另发明第二套事件包 | 客户端只实现一套 |
| R4 | **帧编码：NDJSON**（每行一个 UTF-8 JSON 对象 + `\n`） | 与现 v1/CLI JSONL 一致；JSON 字符串内换行已转义。单帧上限默认 **16 MiB**，超限 `frame_too_large` |
| R5 | **v1 的 `protocolVersion: 1` 永不改语义**；v2 只用 `apiVersion: "pier.control/v2"` | 旧客户端零迁移 |
| R6 | **新 agents 能力优先 v2 op + domain service**；仅当与现 handler 完全同构时才内部映射 `PierCommand` | 防 `pierCommandSchema` 无限膨胀 |
| R7 | 唯一主体 `cli-human`；无 external / AccessGrant / agent principal | 协调智能体也走本机 pier |
| R8 | **解析器拆分与 v2 传输解耦** | 传输 T1–T3 不依赖 parser 大拆 |

---

## 2. 为什么需要传输金标准

| 事实 | 含义 |
|------|------|
| 现 CLI 一问一答即关 | 适合 open/status；不适合 wait/watch/invoke |
| 客户端恒 `cli-local` | 无法证明协调智能体凭证 |
| Canvas 已写 `pier.control/v2` + effect fence | 只扩 `PierCommand` 会结构性欠债 |
| 产品禁止任务台账 / 公共历史 | 传输层不得开旁路 |

**非目标：** 实现全量 CapabilityAuthority UI、替换 renderer IPC、引入任务台账、第三方插件通道。

---

## 3. v1 金标准冻结（长期保留）

### 3.1 传输

```text
connect → write(JSON.stringify(PierCommandEnvelope)+"\n") → read until end → PierCommandResult → close
```

- 路径：`resolveLocalControlSocketPath(userData)`
- 默认客户端超时：5s（可按命令覆盖，但不改变一问一答模型）
- 无 hello、无多帧、无流

### 3.2 信封

```ts
// protocolVersion 字面量 1 — 禁止改为 2
{
  protocolVersion: 1,
  requestId: string,      // min 1
  clientId: string,       // 实践 "cli-local"
  clientEnv?: Record<string, string>,
  command: PierCommand
}
```

成功：`{ ok: true, requestId, data }`
失败：`{ ok: false, requestId, error: { code, message } }`
错误码集：现有 `PierCommandErrorCode`（**不因 v2 改名**）。

### 3.3 授权

- 单一 `PierClient` `kind: "cli-local"`
- `DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"]`
- `authorizeCommand`：client-kind + capability + 可选 `allowedClientKinds`

### 3.4 必须继续走 v1 的命令类

短、同步、无智能体凭证：

- `app.status` / `preferences.read`
- `window.*` / `panel.list|focus` / open 路径
- `terminal.open` / `terminal.profile.*`
- `worktree.list|create|open`（过渡名，W4 再同构）
- `run.list|spawn|status|cancel`（shell TaskRuns 过渡名）
- `plugin.list|inspect`；enable/disable 仍受 `plugin:write`

**兼容承诺：** v2 落地后，仅发 v1 信封的脚本/MCP **行为不变**。

---

## 4. 双栈共存（金标准）

### 4.1 同 socket，首帧分流

| 首帧 | 判定 | 行为 |
|------|------|------|
| 对象含 `protocolVersion: 1` 且含 `command` | v1 | 处理一次，写一行结果，**结束连接** |
| 对象含 `apiVersion: "pier.control/v2"` 且 `type: "client.hello"` | v2 | 进入会话；可多帧 |
| 其他 | 拒绝 | `protocol_unsupported` 或 `invalid_command`；**不**泄漏 boot/项目 |

硬规则：

1. 同连接 **禁止** v1/v2 混用
2. 禁止把 v2 事件塞进 v1 `data` 冒充兼容
3. PeerCheck（§6.1）对 **v2 必做**；v1 **T2 起逐步加**（可先 warn 后 enforce，需单测锁定；推荐 v1 与 v2 同时 enforce peer，失败码一致）

### 4.2 CLI 选择

| 命令 | 协议 |
|------|------|
| 现有短控制 | v1 |
| `agents *`、`snapshot`、`watch` | v2 |
| 可选 `PIER_CONTROL_PROTOCOL=v2` | 试验强制 v2（不得成为默认破坏源） |

---

## 5. v2 帧编码金标准

### 5.1 编码

- 连接：同一 Unix socket / Windows pipe
- 帧：**NDJSON** — 每个控制帧独占一行，以 `\n` 结束
- 字符集：UTF-8
- **maxFrameBytes：** 默认 `16 * 1024 * 1024`；可配置，测试锁默认
- 超限：写 `server.error` / `response.ok=false` code=`frame_too_large` 后可关闭连接
- 空行：忽略
- 半包：按 `\n` 粘包拆帧（与现 server 读法同族）

### 5.2 公共字段

所有 v2 帧：

```ts
{
  apiVersion: "pier.control/v2",  // 字面量
  type: string,
  // 多数帧含 requestId；event 用 subscriptionId
}
```

时间：Unix epoch **毫秒**，安全整数。

---

## 6. v2 会话状态机（金标准）

```text
Accepted
  → PeerCheck          # 失败：peer_identity_denied 后 close
  → WaitHello          # 仅 client.hello
  → Auth               # cli-human auth.none only
  → Ready              # request | subscribe | cancel
  → Draining | Closed
```

### 6.1 PeerCheck

| 平台 | 规则 |
|------|------|
| Unix | 优先 `getpeereid`（macOS，经 native `getUnixPeerUid` 注册到 `peer-identity`）peer UID == 服务端 EUID；不可用时 **fs-acl 兜底**：socket 文件所有者 == EUID 且 mode 无 group/other 位（目标 0600）。`requirePeerUid` 仅测试严格路径 |
| Windows | named pipe owner-only DACL；client SID == 服务所有者；否则 deny |

失败：单帧 error（若尚无 requestId 用 `server.error`），**禁止**附带 bootId、面板、项目路径。

**实现水位：** 宿主在加载 Ghostty native 后 `registerUnixPeerUidResolver`。`withPanelStatusEnv` 只剥离历史 `PIER_AGENT_CALLER_*`，永不注入 binding。产品 CLI 恒为 `cli-human`。

### 6.2 客户端 → 服务端帧（规范形状）

```ts
type ControlClientFrame =
  | ClientHello
  | ClientRequest
  | ClientSubscribe
  | ClientUnsubscribe
  | ClientCancel;

type ClientHello = {
  apiVersion: "pier.control/v2";
  type: "client.hello";
  requestId: string;
  clientKind: "cli-human";
  auth: { method: "none" };
};
```

（协议仅 cli-human + auth.none。）

### 6.5 Principal

| kind | 证明 | 产品水位 | 权限来源 |
|------|------|----------|----------|
| `cli-human` | PeerCheck + `auth.method: "none"` | **唯一产品路径**（人类与协调智能体经 `pier`） | op allowlist + effectKey + CA 热路径 |


禁止：`--as-agent`、panelId、焦点、可伪造环境自报主体。

---

## 7. effectKey · receipt · fence（传输侧金标准）

### 7.1 何时必填

| op 类 | effectKey | expectedBootId |
|-------|-----------|----------------|
| `agents.start/turn/interrupt/terminate` | **必填** ≥128bit 不透明 | 涉及 runtime 时必填 |
| terminal 写（v2 映射后） | 必填 | 必填 |
| 只读 catalog/list/get/screen/snapshot | 不强制 | 可选 |

**禁止** 把外部 task/attempt/message id 直接当 effectKey。
**产品 non-goal**：不提供 `agents.invoke`（一次性走各 agent 原生 CLI）。

### 7.2 Receipt（实现下限）

查找键逻辑：`principalRef + op + canonicalTarget + effectKey`
摘要：JCS(规范化 params + expectedBootId + 影响执行的选项)；**不含** 纯观察 wait-timeout、输出格式。

| 情况 | 行为 |
|------|------|
| 同键同摘要 | 重放同一成功/终态 response（含同一 effectRevision） |
| 同键异摘要 | `idempotency_conflict` |
| 鉴权失败 | 不得重放旧成功 receipt |
| boot 结束 | receipt 作废；旧 expectedBootId → `boot_changed` |

W1：允许 **进程内、当前 boot** receipt。
W2+：按 Canvas 加厚 epoch/容量（`effect_window_full` 等）。

### 7.3 Effect fence

写 op 在底层副作用 **前** 分配全局单调 `effectRevision = F`。
成功/重放 `meta.effectRevision = F`。
**禁止** 返回「响应时刻最新 high-water」代替 F。
由该 effect 引起的事实事件必须 `revision > F`（实现与测试矩阵 §13）。

---

## 8. 流与 cursor（金标准；实现可分期）

### 8.1 协议（一次定义）

- `subscribe.stream = "global"`：跨资源事实流，`cursorScope: "global"`
- `subscribe.stream = "resource:<name>"`：便利流；**cursor 不得跨 namespace 续接**
- 无 `after`：先发 `mode: "snapshot"` 至高水位 R，再 `live` 且 `revision > R`
- 有效 `after`：`mode: "resume"`，无完整 snapshot，从 cursor 后一条开始
- gap / boot 不匹配 / 过期：只回错误或带 `snapshotRequired` 的失败 response，**禁止** 旧事件与新 snapshot 混流
- 客户端去重键：`bootId + revision`（+ scope）

### 8.2 实现分期

| 波次 | 必须 |
|------|------|
| W1 | 协议可解析；subscribe → `unsupported` 可接受 |
| W3 | **真** `event` 流至少一条 resource 或 global；agents wait 不得依赖「假 JSONL」 |
| W4+ | global snapshot/watch 与宿主原语对齐 |

**禁止（金标准）：** W3 用「短请求轮询」冒充已实现 watch 而不标 experimental。

---

## 9. op 目录与波次

### 9.1 W1（v2 首实装）

| op | 语义 |
|----|------|
| `agents.catalog` | 可调用目标 |
| `agents.list` / `agents.get` | 运行投影 |

传输：PeerCheck + hello + agent 凭证 + 上表 request/response。

### 9.2 W2（产品撤回）

| op | 语义 |
|----|------|
| ~~`agents.invoke`~~ | **non-goal**：不经 Pier 封装 one-shot；调用方直接用原生 agent CLI（如 `codex exec`）。协议层若收到该 op 返回 `unsupported`。 |

### 9.3 W3（实现水位 · 金标准终态）

| op | 语义 |
|----|------|
| `agents.start/turn/screen/wait/watch/interrupt/terminate/focus` | RuntimeRef；cli-human + RuntimeControlService |
| `agents.watch` | 运行事实 event 流（subscriptionId=requestId）+ 终态 response；≠ 工作完成 |
| `subscribe` / `unsubscribe` | 跨资源事实流（W1） |

实现：`src/main/services/runtime-control/` + `local-control/agents-runtime.ts`（op 名单 + effectKey 单飞 + 会话分发）；screen 依赖 native `readViewportText`。

### 9.4 W4–W6

- W4（主路径已关账）：`control.snapshot` / `control.watch`（顶层 `pier snapshot` / `pier watch`）、WorktreeRef + worktrees get/check/remove、terminal list/get/send/key（agent 写拒绝）、tasks get/output/stop、CapabilityAuthority 可替换骨架；E11 全量 cursor 门禁与 CA 热路径强制归 W6
- W5（主路径已关账）：`notifications.list|get|watch|focus|mark-read`（v1 短 RPC，NCS 同源；focus 同构 Runtime Index）；`control.snapshot` 含 `notifications[]` 指针 + FA 多 kind activity；协作 surface（命令面板「智能体协作」）；cursor **命名空间文档化**（`global` / agents / `notifications`，跨域 resume 强制归 W6-S5）
- W6（**产品主路径**已关账）：CA 热路径 start 占额 / terminate 释放；`assertCursorResume` 全量门禁（T-C1..C3）；`snapshot.runtimes[]`；冒烟走 **cli-human**（`scripts/w6-live-control-smoke.mjs` / `w6-fake-coordinator.mjs`）
  - **S5**：`control.watch` / subscribe 共用 cursor-gate；结构化 after；跨 scope/boot → `snapshot_required`
  - **S4**：`capability-hot-path` + `tryReserveChild` 进 start；`childCapabilityRef`；receipt 不双占
  - **产品范围**：无 access.* / external / agent principal
  - **产品身份**：人类与协调智能体 = `cli-human`；CLI **不是**权限系统

### 9.5 与 PierCommand

- 新 agents：**v2 op + service**
- 旧短命令：v1
- 插件 RPC：**不进** 本通道

---

## 10. 错误码金标准

| code | 含义 |
|------|------|
| `protocol_unsupported` | apiVersion/type 不支持 |
| `frame_too_large` | 超 maxFrameBytes |
| `peer_identity_denied` | OS 用户不匹配 |
| `auth_required` / `auth_failed` | 凭证/签名 |
| `permission_denied` | capability |
| `capability_revoked` | 已撤销 |
| `boot_changed` | boot 不一致 |
| `stale_generation` | Runtime 代际旧 |
| `idempotency_conflict` | 同 key 异摘要 |
| `effect_in_progress` | 同操作进行中，可附着 |
| `observation_timeout` | 仅观察超时 |
| `execution_deadline_exceeded` | 执行截止 |
| `unsupported` | op/stream 未实现 |
| `invalid_command` | schema |
| `snapshot_required` | cursor 不可续 |
| `internal_error` | 未分类 |

CLI 映射建议：`observation_timeout` → exit 124；用户取消观察 → 130；与 Canvas 一致。

---

## 11. 安全与产品边界（传输侧）

1. capability = 纪律边界，非恶意同 UID 隔离
2. 无 transcript/history/replay 公共 op
3. 运行事实 ≠ 工作完成
4. 无多智能体任务台账字段进入 wire
5. 凭证不进 argv/日志/screen
6. v1 不强制 hello（兼容）
7. Peer deny 不泄漏内部状态

---

## 12. 模块落点

```text
src/shared/contracts/local-control/
  frames.ts         # zod 单一来源
  errors.ts
  agents-runtime.ts / runtime-ref.ts
  classify.ts

src/main/adapters/cli/
  register-local-control.ts    # 宿主挂载入口
  peer-identity.ts
  local-control/
    agents-discovery.ts
    server.ts                  # 首帧分流（v1 短 RPC + v2 会话）
    session.ts                 # pier.control/v2 会话
    features.ts                # op 名单 + hello features
    authorize.ts / receipts.ts
    discovery.ts               # catalog/list/get/trace
    agents-runtime.ts          # 持久运行 + effectKey 单飞
    subscribe.ts / hello-auth.ts
    registration.ts

src/main/services/
  runtime-control/ # W3（持久运行控制；无 agent-invoke 产品模块）

bin/
  pier.mjs
  pier-control-client.js
```

依赖：`adapters/cli` → `services/*`；禁止 session → renderer。

---

## 13. 测试矩阵（金标准门禁）

### 13.1 契约 / 单测

| ID | 断言 |
|----|------|
| T-F1 | 所有 Client/Server 帧 zod 圆Trip |
| T-F2 | 缺 apiVersion / 错误 type → invalid 或 protocol_unsupported |
| T-F3 | 帧 > maxFrameBytes → frame_too_large |
| T-S1 | 首帧 v1 → 一问一答关闭；并发 v2 hello 另一连接成功 |
| T-S2 | 同连接 v1 后再发 v2 → 拒绝 |
| T-P1 | peer UID 不匹配 → peer_identity_denied 且 body 无 bootId |
| T-A1 | 伪造 credentialId → auth_failed |
| T-A2 | agent self 不返回 secret |
| T-R1 | 同 effectKey 同摘要重放一致 effectRevision |
| T-R2 | 同 effectKey 异摘要 → idempotency_conflict |
| T-C1 | subscribe 无 after → snapshot 然后 live revision 严格增 |
| T-C2 | after 过期/错 boot → snapshot_required，无混流 |
| T-C3 | resource cursor 续到 global → 拒绝 |
| T-E1 | 写成功 meta.effectRevision=F；后续事件 revision>F（W3+） |
| T-X1 | 无 transcript/history/replay op 名出现在 `features.ts` / `AGENTS_RUNTIME_OPS` 名单 |

### 13.2 集成

| ID | 断言 |
|----|------|
| I-1 | 假协调智能体：hello → self → catalog |
| I-2 | 旧 `pnpm cli:dev -- status` v1 全绿 |
| I-3 | ~~invoke 取消/deadline~~ **non-goal**（不提供 `agents.invoke`；one-shot 走原生 agent CLI） |
| I-4 | screen 有界 + wait/watch + RuntimeRef（W3） |

### 13.3 治理

- 既有 `tests/unit/cli/*-governance`
- 新增：`LOCAL_CONTROL_FEATURE_*` / `AGENTS_RUNTIME_OPS` 禁止 public history / `agents.invoke` 产品 op

---

## 14. 实施波次（传输）

| 切片 | 交付 | 退出标准 |
|------|------|----------|
| **T0** | 本文确认 | 决议 R1–R8 无歧义 |
| **T1** | 分流骨架 + session hello features=[] | 旧 CLI 绿；hello 可通 |
| **T2** | PeerCheck enforce | T-P1 |
| **T3** | cli-human hello（auth.none） | I-1 子集 |
| **T4** | catalog/list/get | I-1 |
| **T5** | `bin/pier-control-client.js` 挂 agents 会话 | docs 标明 |
| **T6** | ~~invoke~~ **撤回**：协议收到 `agents.invoke` → `unsupported` | I-3 non-goal |
| **T7** | start/turn/screen/wait/watch + RuntimeControlService（W3） | T-C* I-4 |

T1–T5 ⊆ **产品 W1**；T6⊆W2；T7⊆W3。

---

## 15. CLI 输出政策（传输相邻；金标准摘要）

| 类型 | 无 `--json` | `--json` / v2 data |
|------|-------------|-------------------|
| 会话/观察 | 短摘要；有 window 则带上 | **仅** 协议 data/事件 |
| 动作成功 | 可静默 | 仅 envelope/response |
| 长等待 | stderr 心跳（可选） | **默认无** 心跳进 stdout |

禁止：摘要/heartbeat 写入 `--json` stdout。完整表随 agents 落地写入 pier-cli-user-manual Canvas。

---

## 16. 与 Canvas 的双向引用

- Canvas `cli.transport`：产品语义与授权叙事
- **本文：** socket/帧/会话/cursor 的唯一传输权威
- 实现 PR：改 wire 必须改本文 + T-F* 测试；改产品边界必须改 Canvas

Canvas 侧应增加 transport 条目指向本文（见同提交/后续补丁）：

> 本机 socket 帧与 v1/v2 分流：以 `docs/superpowers/specs/2026-08-10-local-control-v1-v2-design.md` 为传输金标准。

---

## 17. 决议清单（冻结用）

- [x] R1 agents.invoke non-goal；持久写 op 可同步挂到 response（watch 可 event*）
- [x] R2 短控制走 v1；agents 持久写走会话 + effectKey
- [x] R3 subscribe 一次定义
- [x] R4 NDJSON + 16MiB
- [x] R5 v1 数字 1 不动
- [x] R6 agents → v2 op + service
- [x] R7 唯一 cli-human（无 external/access/agent principal）
- [x] R8 parser 与传输解耦
- [x] 产品边界听 Canvas；传输听本文

---

## 18. 总结

| | v1 | v2 |
|--|----|----|
| 定位 | IDE 短控制金标准保留面 | 智能体运行控制传输金标准 |
| 状态 | 已实现 | 终态已定义，分波次实现 |
| 身份 | cli-local | cli-human only |
| 流 | 无 | NDJSON events + cursor |

**本文 = 传输金标准终态。**
**Canvas = 产品与命令语义金标准。**
**实现完成度 = 波次进度，不等于设计未完成。**
