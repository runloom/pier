# Pier CLI

本机控制面。**目标主调用者**是 Pier 启动的协调智能体；人类命令行、脚本、MCP 与外部控制器是并列可选入口，复用同一套命令与 JSON/JSONL 契约。

| 角色 | 关系 |
|------|------|
| 协调智能体 | 默认主路径：`self` → `invoke` 或 `start` → `turn` / `screen` / `wait` |
| 人类 CLI / 脚本 / MCP | 可选；当前已实现命令主要服务这一类 |
| 外部控制器 | 可选；须经本机授权（规划中的 `access`）后同构调用 |

产品与契约真源（未实现能力以它为准）：

- Canvas：[`.pier/canvases/multi-agent-orchestration-gold/`](../.pier/canvases/multi-agent-orchestration-gold/)
- 本文件：**已实现行为**以「当前可用命令」为准（含默认 `cli-local` 授权边界）；**规划命令**只出现在标注未实现 / 交付波次的章节，且不得省略「未实现」标记

实现未完成前，不得把规划命令写进「当前可用命令」。

### 协议分层（架构）

| 版本 | 形态 | 用途 |
|------|------|------|
| **v1**（当前 · 长期保留） | 单次连接、一行 JSON 请求/响应（`protocolVersion: 1`） | 已实现的 open/status/windows/panels 等短控制 |
| **v2**（传输金标准已定义 · 实现按 W1+） | 同 socket 会话、`apiVersion: "pier.control/v2"` NDJSON 多帧 + 可选事件流 | `agents` / 长调用 / wait·watch / access |

v1 与 v2 **首帧分流、同连接不混用**。传输层金标准终态（帧、会话、cursor、peer、错误码）：

[`docs/superpowers/specs/2026-08-10-local-control-v1-v2-design.md`](./superpowers/specs/2026-08-10-local-control-v1-v2-design.md)

产品命令语义与完成权边界仍以 Canvas 为准；**未实现的 v2 命令不得写入「当前可用命令」**。

---

## 硬边界（全波次不变）

1. Pier **不**拥有多智能体任务生命周期、工作 DAG、任务台账、看板、自动调度或完成裁决。
2. **不**提供公共 `transcript` / `history` / `replay` / 完整滚屏检索。
3. `ready`、终端安静、进程退出、`accepted`、当前画面都**不是**调用方工作成功。
4. 调用者身份不可自报：禁止把 `--as-agent`、panel 名、焦点或可伪造环境变量当凭据。
5. 现有 `tasks` 只表示 **shell 命令运行**，不得扩展成多智能体工作项。

完成权、工作拆分、重试与验收始终在调用方（协调智能体或外部控制器）。

---

## 能力地图：金标准命令面 × 现状 × 波次

按金标准收口后的命令面如下。现状以本仓库可执行 `pier` 为准；波次对应 Canvas 落地页 W0–W6。

| 命令组 | 目标职责（金标准） | 现状 | 交付波次 |
|--------|-------------------|------|----------|
| **顶层** `version` · `capabilities` · `doctor` · `status` · `snapshot` · `watch` | 协议协商、健康、能力列表、原子总快照、不漏事件的全局事实流 | **部分**：`status` 可用；其余未实现 | **W1** 底座扩展；**W3–W4** 与 `snapshot`/`watch` 收口 |
| **`agents`** `self` · `catalog` · `list` · `get` · `invoke` · `start` · `turn` · `screen` · `wait` · `watch` · `focus` · `interrupt` · `terminate` | 智能体优先主路径：身份、一次性回复、持久运行控制、有界当前画面 | **部分**：`self`/`catalog`/`list`/`get`（v2）；invoke/start/screen 等未实现 | **W1** 发现已落地；**W2** `invoke`；**W3** 持久控制与 `screen`/`wait` |
| **`access`** `keygen` · `status` · `request` · `wait` · `revoke` | 人类确认 / 外部 Ed25519 窄授权 | **未实现** | **W6** |
| **`terminal`** `open` · `list` · `get` · `send` · `key` · `interrupt` · `terminate` · `wait` · `watch` · `profiles …` | 精细终端原语（agents 高层之下；**不含** `screen`，画面读取在 `agents screen`） | **部分**：`open`、`profiles`；无 list/get、send/key、interrupt/terminate、wait/watch 与 RuntimeRef 写控 | **W3–W4** 与 RuntimeRef 守卫对齐 |
| **`windows` / `panels`** `list` · `get` · `watch` · `focus` | 界面定位与聚焦；**不能**代替 RuntimeRef 写进程 | **部分**：list/focus；无 get/watch 契约 | **W4** 语义收口（写路径仍禁旁路） |
| **`worktrees`** `check` · `list` · `get` · `register` · `create` · `remove` … | 完整 `WorktreeRef` 定位与安全清理 | **部分**：list/create/open；身份 marker / 准入锁未齐 | **W4** |
| **`activity`** `snapshot` · `watch` | 运行事实便利流 | **未实现**（内部 FA 已有，无 CLI） | **W3–W4** |
| **`tasks`** `list` · `get` · `run` · `watch` · `output` · `stop` · `rerun` | **仅** shell TaskRuns | **部分**：list/run/status/cancel 等；命令名与金标准未完全同构 | **W4** 同构与边界锁定 |
| **`notifications`** `list` · `get` · `watch` · `focus` · `mark-read` | 消息中心注意力，不改运行结论 | **未实现** | **W5** |
| **`open` / `preferences` / `plugins`** | 打开路径、读偏好、插件管理（宿主便利面） | **部分**：`open`、`preferences read`、`plugins list|inspect` 可用；`plugins enable|disable` 需 `plugin:write` / 桌面宿主（默认 `cli-local` **拒绝**） | **W0** 文档归位；写插件路径保持 desktop-renderer |

**双内容路径（方案 A，W2 + W3）：**

| 路径 | 命令 | 返回 | 不是 |
|------|------|------|------|
| 一次性 | `agents invoke` | 本次有界结构化回复 `InvocationReply` | 可枚举历史；`responded` ≠ 工作完成 |
| 持久 | `agents start` → `turn` → `screen` / `wait` | 当前可见画面 + `canonicalPath` / 完整 `WorktreeRef` | 完整 transcript；screen ≠ 语义终答 |

文件与 Git **内容**由调用方本地工具读取；Pier CLI **不**新增 `files` / `git` 命令组。

---

## 交付波次（CLI 视角）

与 Canvas 落地页一致；**先文档与边界，再身份，再双内容路径，再宿主原语收敛，最后协作 UI 与外部接入**。

| 波次 | 名称 | CLI / 文档交付物 | 可验证结果 |
|------|------|------------------|------------|
| **W0** | 文档与边界 | 本文件命令面地图；Canvas 边界；`tests/unit/cli/*-governance` 进 unit CI | **已完成（文档+门禁）**；W1 发现子集见「当前可用」 |
| **W1** | 调用身份 | `agents self`（及 catalog/list/get 只读发现）；凭证注入与 scrub | 协调智能体无需手抄 panelId 即可自述能力 |
| **W2** | 一次性调用 | `agents invoke`（v1 advisory-read-only） | 显式 agent + WorktreeRef → 本次回复；无公共历史 |
| **W3** | 持久运行与画面 | `agents start/turn/screen/wait/watch` + RuntimeRef 守卫 | 父→新建子；viewport 有界；accepted ≠ handled |
| **W4** | 宿主原语收敛 | 现有 `terminal` / `windows` / `panels` / `worktrees` / `tasks` / `status` 对齐金标准命名与 refs；补 `snapshot`/`watch`/`activity` 契约 | 与 agents 共用身份与 effect 语义；shell tasks 不越权 |
| **W5** | 协作面与注意力 | `notifications` CLI + 协作 UI（非 agents 主路径） | 人能回到「需要你处理」的原运行；不写入完成结论 |
| **W6** | 外部与发布 | `access`；人类确认与外部同构 JSON | 假协调智能体 + 假外部控制器端到端 |

依赖（实施路径，不是任务 DAG）：

```text
W0 → W1 → W2 ┐
         ↘    ├→ W4 → W5 → W6
           W3 ┘
```

W1 完成后，W2 与 W3 可并行；二者都汇入 W4 宿主原语收敛。

---

## 当前可用命令

下列为仓库在默认客户端 **`cli-local` 下可成功执行**的入口（以 `node ./bin/pier.mjs` / 安装包 `pier` 为准）。`cli-local`：可读状态、打开路径、聚焦；默认不能关窗、写配置、改插件状态或向终端注入键鼠。解析层若支持但授权拒绝的命令，**不算**当前可用。

可执行文件：

- 开发：`pnpm --silent cli:dev -- <args…>` 或 `node ./bin/pier.mjs`
- 安装包：`Pier.app/Contents/Resources/bin/pier`

### 约定（已实现）

- 需要机器可读结果时加 `--json`
- 只想看解析后的命令信封时加 `--print-envelope`
- 部分命令成功时可能有人类可读摘要；**agents 主路径落地后**将按 Canvas 固定「会话型 / 动作型 / JSON stdout」输出政策（见 Canvas `cli.commonRules`）

### 智能体发现（v2 · 已实现只读子集）

走 `pier.control/v2` 会话（非 v1 短请求）。人类 CLI 默认 `cli-human`；若设置 `PIER_AGENT_CALLER_CREDENTIAL_FILE` 则按 agent 主体连接。

```bash
pier agents catalog --json
pier agents list --json
pier agents get --agent-id <id> --json
pier agents get --agent-ref <ref> --json
pier agents get --panel <panelId> --json
# 需 agent 凭证：
pier agents self --json
```

- `catalog`：产品目录（T4 可用性多为 unknown，detection 未接全）  
- `list` / `get`：当前 boot 运行中智能体投影（Runtime Index）  
- `self`：调用者非秘密身份与预算（需凭证）

### 打开与状态

```bash
pier open <path> [--window <windowId>] [--split <direction>] [--no-focus] --json
pier status --json
pier preferences read --json
```

- `--window`：发到指定窗口；未指定时优先当前聚焦窗口
- `--split`：`right`、`below`/`down`、`left`、`above`/`up`；未指定则在当前 active group 内作 tab 打开
- `--no-focus`：不把 Pier 窗口抢到前台（适合 MCP / 后台）

`open` 会在 main 解析路径与 Git/worktree，形成 `PanelContext`，再经 renderer bridge 打开带上下文的 terminal panel，初始 cwd 为解析目录。

### 窗口与面板

```bash
pier windows list --json
pier windows focus <windowId> --json
pier panels list [--window <windowId>] --json
pier panels focus <panelId> [--window <windowId>] [--no-focus] --json
```

金标准：**PanelRef / WindowRef 只用于发现与聚焦**；进程写入必须等 W3 的 `RuntimeRef`（`bootId + runtimeId + generation`），不得用 panel 标题或焦点猜写目标。

### 终端（部分）

```bash
pier terminal open [--cwd <path>] [--profile <profileId>] [--env KEY=VALUE] \
  [--command <command> | -- <command...>] [--window <windowId>] [--split <direction>] [--no-focus] --json
pier terminal profiles list --json
pier terminal profiles get <profileId> --json
pier terminal profiles set <profileId> [--cwd <path>] [--env KEY=VALUE] [--command <command> | -- <command...>] --json
pier terminal profiles delete <profileId> --json
```

尚未实现（W3–W4）：`list`/`get` 运行实例、`send`/`key`、`interrupt`/`terminate`、`wait`/`watch`，以及与 `agents *` 同构的代际守卫。

### 工作树（部分）

```bash
pier worktrees list --path <path> --json
pier worktrees create --path <repo> --name <dir> --branch <branch> --base <ref> --json
pier worktrees open <path> --json
```

金标准要求完整 `WorktreeRef`（含 incarnation 等）与准入锁；当前实现为过渡面，**W4** 收口。

### Shell 任务（部分，非多智能体任务）

```bash
pier tasks list [--path <path>] --json
pier tasks run <taskId> [--path <path>] [--input id=value] [--window <windowId>] [--split <direction>] [--no-focus] --json
pier tasks status <runId> --json
pier tasks cancel <runId> [--window <windowId>] --json
```

只表示宿主 shell TaskRuns。金标准命名（`get`/`watch`/`output`/`stop`/`rerun`）与精确 `TaskRunRef` 在 **W4** 对齐；**禁止**演化为多智能体 Run/WorkItem。

### 插件（只读）

```bash
pier plugins list --json
pier plugins inspect <id> --json
```

默认 `cli-local` 仅有 `plugin:read`。`plugins enable` / `plugins disable` 虽可被解析，但要求 `plugin:write`（通常仅桌面宿主），CLI 默认会授权失败——**不要**当作当前可用写路径。

插件管理是宿主能力，**不**承担多智能体编排或任务台账。

---

## 规划中的 agents 主路径（摘要）

实现前仅作地图；细节与错误码以 Canvas 为准。

```text
# W1 — 身份
pier agents self --json
pier agents catalog --json
pier agents list --json
pier agents get <agentRef> --json

# W2 — 一次性（prompt 走 stdin 或文件，不进 argv）
pier agents invoke --agent <id> --worktree-key … --incarnation-id … \
  --execution-deadline … --wait-timeout … --json < prompt.txt

# W3 — 持久
pier agents start --agent <id> --worktree-key … --incarnation-id … --json
pier agents turn --runtime … --boot … --generation … --json < turn.txt
pier agents screen --runtime … --boot … --generation … --json
pier agents wait --runtime … --until ready|waiting|… --json
pier agents interrupt|terminate|focus …   # 精确 RuntimeRef
```

语义要点：

- `invoke` → 仅本次 `InvocationReply`；无 list/history
- `turn` → `accepted` + effect cursor，≠ 已处理
- `screen` → 渲染后当前 viewport 单帧，有字节/行上限，无 scrollback
- CLI 返回路径与 `WorktreeRef`；内容用调用方文件/Git 工具读

---

## 开发态验证（已实现命令）

先启动 Pier：

```bash
pnpm dev
```

另一终端：

```bash
pnpm --silent cli:dev -- status --json
pnpm --silent cli:dev -- windows list --json
pnpm --silent cli:dev -- windows focus main --json
pnpm --silent cli:dev -- panels list --window main --json
pnpm --silent cli:dev -- panels focus terminal-1 --window main --json
pnpm --silent cli:dev -- open . --json
pnpm --silent cli:dev -- open . --window main --split right --json
pnpm --silent cli:dev -- open . --no-focus --json
pnpm --silent cli:dev -- preferences read --json
pnpm --silent cli:dev -- status --json --print-envelope
```

这些命令通过 dev profile 的 userData socket 连接运行中的 main，返回 `PierCommandResult`。

相关单测：

```bash
pnpm vitest run tests/unit/app-core/cli-bin.test.ts
pnpm vitest run tests/unit/app-core/cli-adapter.test.ts
pnpm vitest run tests/unit/app-core/local-control.test.ts
```

Canvas 契约（方案与命令面门禁）：

```bash
pnpm vitest run --config .pier/canvases/multi-agent-orchestration-gold/contracts.vitest.config.ts
```

---

## MCP 定位 `pier` 的顺序

1. `PIER_CLI_PATH`
2. `PATH` 中的 `pier`
3. `/Applications/Pier.app/Contents/Resources/bin/pier`
4. `$HOME/Applications/Pier.app/Contents/Resources/bin/pier`
5. fallback 到 `pier`

---

## 相关

- 产品边界与架构：[`AGENTS.md`](../AGENTS.md)
- 金标准方案 Canvas：[`multi-agent-orchestration-gold`](../.pier/canvases/multi-agent-orchestration-gold/)
- 开发环境：[`development.md`](./development.md)
