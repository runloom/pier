# Pier 本机命令行（CLI）使用手册

在终端里控制**已经打开**的 Pier 应用：查看窗口与面板、打开文件夹、打开终端、管理工作树与 shell 任务，以及查看 /（规划中）控制本机智能体相关能力。

> **推荐阅读（应用内）：**  
> [`.pier/canvases/pier-cli-user-manual/`](../.pier/canvases/pier-cli-user-manual/)  
> **文档壳 UI**：左侧目录 + 右侧正文 + 顶栏搜索（无顶栏五段胶囊）。  
> 下文为 Markdown 全文，便于检索、diff 与离线阅读。

> 本手册面向使用 Pier 的人。  
> - **已实现**：可直接执行，输出示例来自当前行为（示意，字段可能随版本变化）。  
> - **暂未实现**：写全规划中的用法与**预期**输出形态，便于了解能力地图；**当前执行会失败或提示未知命令**，请勿写入脚本依赖。

脚本请始终加 `--json`，以实际返回为准。

---

## 使用前

1. **先启动 Pier**（菜单打开，或开发态 `pnpm dev`）。CLI 只连接正在运行的实例。
2. 调用方式：

```bash
# 安装包
pier <命令…>

# 开发态
pnpm --silent cli:dev -- <命令…>
# 或
node ./bin/pier.mjs <命令…>
```

macOS 安装包路径示例：`Pier.app/Contents/Resources/bin/pier`。

连不上时：确认 Pier 已在运行，且与 CLI 是同一用户、同一套应用数据目录。

---

## 通用选项

| 选项 | 说明 | 适用 |
|------|------|------|
| `--json` | 输出机器可读 JSON（脚本推荐） | 已实现命令均支持 |
| `--print-envelope` | 只打印将要发送的请求，不执行 | 调试 |
| `--no-focus` | 尽量不把 Pier 窗口抢到前台 | 打开类命令 |
| `--window <id>` | 指定目标窗口（见 `windows list`） | 多窗口时 |

---

## 通用输出约定

**成功（`--json`）**大致形如：

```json
{
  "ok": true,
  "requestId": "a1b2c3d4-…",
  "data": {}
}
```

**失败（`--json`）**大致形如：

```json
{
  "ok": false,
  "requestId": "a1b2c3d4-…",
  "error": {
    "code": "permission_denied",
    "message": "…"
  }
}
```

不加 `--json` 时，部分已实现命令会打印简短人类可读文本；**格式不保证稳定**。

**暂未实现**命令若被误调用，常见表现：

```text
unknown pier CLI command
```

或 JSON：

```json
{
  "ok": false,
  "requestId": "…",
  "error": {
    "code": "invalid_command",
    "message": "unknown pier CLI command"
  }
}
```

（具体文案以实现为准。）

---

## 命令总表

| 命令组 | 命令 | 状态 |
|--------|------|------|
| 应用 | `status` | 已实现 |
| 打开 | `open` | 已实现 |
| 窗口 | `windows list` · `windows focus` | 已实现 |
| 面板 | `panels list` · `panels focus` | 已实现 |
| 终端 | `terminal open` · `terminal profiles …` | 已实现 |
| 终端 | `terminal list` · `get` · `send` · `key` · `interrupt` · `terminate` · `wait` · `watch` | **暂未实现** |
| 工作树 | `worktrees list` · `create` · `open` | 已实现 |
| 工作树 | `worktrees check` · `get` · `register` · `remove` 等扩展 | **暂未实现**（部分能力仅应用内） |
| Shell 任务 | `tasks list` · `run` · `status` · `cancel` | 已实现 |
| Shell 任务 | `tasks get` · `watch` · `output` · `stop` · `rerun` | **暂未实现**（命名/能力规划） |
| 智能体 | `agents catalog` · `list` · `get` | 已实现 |
| 智能体 | `agents self` · `invoke` · `start` · `turn` · `screen` · `wait` · `watch` · `focus` · `interrupt` · `terminate` | **暂未实现** |
| 偏好 | `preferences read` | 已实现 |
| 插件 | `plugins list` · `inspect` | 已实现 |
| 插件 | `plugins enable` · `plugins disable` | **CLI 默认不可用**（请用应用设置） |
| 顶层 | `version` · `capabilities` · `doctor` · `snapshot` · `watch` | **暂未实现**（`status` 已实现） |
| 活动 | `activity snapshot` · `activity watch` | **暂未实现** |
| 消息 | `notifications list` · `get` · `watch` · `focus` · `mark-read` | **暂未实现** |
| 外部授权 | `access keygen` · `status` · `request` · `wait` · `revoke` | **暂未实现** |

下文：**先完整写已实现（含输出示例），再完整写暂未实现（含规划语法与预期输出）。**

---

# 第一部分：已实现命令

## 应用状态

```bash
pier status --json
```

查看 Pier 是否在线及简要状态。

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "appVersion": "0.1.x",
    "platform": "darwin"
  }
}
```

---

## 打开文件夹

```bash
pier open <路径> [--window <窗口id>] [--split <方向>] [--no-focus] --json
```

| 参数 | 说明 |
|------|------|
| `<路径>` | 要打开的目录 |
| `--split` | `right` · `left` · `below`/`down` · `above`/`up` |
| `--window` | 目标窗口 |
| `--no-focus` | 不抢前台 |

**示例：**

```bash
pier open . --json
pier open ~/Projects/foo --split right --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panelId": "terminal-…",
    "windowId": "…"
  }
}
```

---

## 窗口

### `windows list`

```bash
pier windows list --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "windows": [
      {
        "id": "main",
        "focused": true,
        "title": "Pier"
      }
    ]
  }
}
```

### `windows focus`

```bash
pier windows focus <窗口id> --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": { "windowId": "main" }
}
```

---

## 面板

### `panels list`

```bash
pier panels list [--window <窗口id>] --json
```

**不加 `--json` 时**可能类似：

```text
窗口 1 · 当前窗口 · 第 1 组
  terminal-abc    Terminal    focused
  files-xyz       Files
```

**`--json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panels": [
      {
        "panelId": "terminal-abc",
        "windowId": "main",
        "title": "Terminal",
        "focused": true,
        "groupIndex": 0
      }
    ],
    "errors": []
  }
}
```

### `panels focus`

```bash
pier panels focus <面板id> [--window <窗口id>] [--no-focus] --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panelId": "terminal-abc",
    "windowId": "main"
  }
}
```

---

## 终端（已实现子集）

### `terminal open`

```bash
pier terminal open [--cwd <路径>] [--profile <配置id>] [--env KEY=VALUE] \
  [--command <命令> | -- <命令…>] \
  [--window <窗口id>] [--split <方向>] [--no-focus] --json
```

**示例：**

```bash
pier terminal open --cwd . --json
pier terminal open --profile work --json
pier terminal open -- claude --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panelId": "terminal-…",
    "windowId": "…"
  }
}
```

### `terminal profiles list` / `get` / `set` / `delete`

```bash
pier terminal profiles list --json
pier terminal profiles get <配置id> --json
pier terminal profiles set <配置id> [--cwd <路径>] [--env KEY=VALUE] \
  [--command <命令> | -- <命令…>] --json
pier terminal profiles delete <配置id> --json
```

**`list` 不加 `--json` 时**可能类似：

```text
default
  cwd: /Users/you/project
work
  command: claude
  cwd: /Users/you/work
```

**`list --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "default": { "cwd": "/Users/you/project" },
    "work": { "command": "claude", "cwd": "/Users/you/work" }
  }
}
```

**`get --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "command": "claude",
    "cwd": "/Users/you/work",
    "env": { "FOO": "1" }
  }
}
```

**`set` / `delete` 成功**时 `ok: true`；`data` 可能为空或回显配置。

> 向**已有**终端注入按键、列举运行中的终端实例等：见下文「暂未实现 · 终端」。

---

## 工作树（已实现子集）

```bash
pier worktrees list --path <仓库路径> --json
pier worktrees create --path <仓库> --name <目录名> --branch <分支> --base <基准ref> --json
pier worktrees open <路径> --json
```

**`list --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "worktrees": [
      {
        "path": "/Users/you/repo",
        "branch": "main",
        "bare": false
      },
      {
        "path": "/Users/you/repo.worktree/feature-x",
        "branch": "feature-x",
        "bare": false
      }
    ]
  }
}
```

**`create` / `open` 成功**时返回路径相关字段（如 `path`）。扩展子命令见「暂未实现 · 工作树」。

---

## Shell 任务（已实现子集）

这里的「任务」是 Pier 内配置的 **shell 命令运行**，不是多智能体工作项。

```bash
pier tasks list [--path <路径>] --json
pier tasks run <任务id> [--path <路径>] [--input id=value] \
  [--window <窗口id>] [--split <方向>] [--no-focus] --json
pier tasks status <运行id> --json
pier tasks cancel <运行id> [--window <窗口id>] --json
```

**`list --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "tasks": [
      {
        "id": "build",
        "label": "Build",
        "command": "pnpm build"
      }
    ]
  }
}
```

**`run --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "runId": "run-…",
    "taskId": "build",
    "status": "running"
  }
}
```

**`status --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "runId": "run-…",
    "status": "succeeded",
    "exitCode": 0
  }
}
```

**`cancel --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "runId": "run-…",
    "status": "cancelled"
  }
}
```

规划中的 `get` / `watch` / `output` 等命名见「暂未实现 · Shell 任务」。

---

## 偏好（只读）

```bash
pier preferences read --json
```

**输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "locale": "zh-CN",
    "theme": "system"
  }
}
```

---

## 插件（只读）

```bash
pier plugins list --json
pier plugins inspect <插件id> --json
```

**`list --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "plugins": [
      {
        "id": "pier.codex",
        "name": "Codex",
        "version": "…",
        "enabled": true
      }
    ]
  }
}
```

**`inspect --json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "id": "pier.codex",
    "version": "…",
    "enabled": true,
    "manifest": {}
  }
}
```

启用 / 禁用：见「暂未实现 · 插件写操作」。

---

## 智能体（已实现：只读查看）

```bash
pier agents catalog --json
pier agents list --json
pier agents get --agent-id <id> --json
pier agents get --agent-ref <引用> --json
pier agents get --panel <面板id> --json
```

CLI **不负责**智能体权限签发或委派；下列只读命令无需额外凭证。

### `agents catalog` — 产品目录

**不加 `--json` 时**可能类似：

```text
claude	Claude	available
codex	Codex	unknown
```

**`--json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "agents": [
      {
        "agentId": "claude",
        "label": "Claude",
        "availability": "available"
      },
      {
        "agentId": "codex",
        "label": "Codex",
        "availability": "unknown"
      }
    ]
  }
}
```

### `agents list` — 当前运行中的智能体面板

**不加 `--json` 时**可能类似：

```text
claude	panel=terminal-abc	window=main	status=running
```

无运行中智能体时：

```text
(no running agents)
```

**`--json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "ts": 1730000000000,
    "entries": [
      {
        "agentId": "claude",
        "agentRef": "…",
        "panelId": "terminal-abc",
        "windowId": "main",
        "source": "launch",
        "updatedAt": 1730000000000
      }
    ]
  }
}
```

### `agents get` — 查询一条

```bash
pier agents get --agent-id claude --json
pier agents get --panel terminal-abc --json
```

**不加 `--json` 时**可能类似：

```text
claude	panel=terminal-abc	window=main
```

**`--json` 输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "agent": {
      "agentId": "claude",
      "agentRef": "…",
      "panelId": "terminal-abc",
      "windowId": "main",
      "source": "launch",
      "updatedAt": 1730000000000
    }
  }
}
```

未找到时：

```json
{
  "ok": false,
  "requestId": "…",
  "error": {
    "code": "not_found",
    "message": "…"
  }
}
```

其余智能体命令见下文「暂未实现 · 智能体」。

---

# 第二部分：暂未实现命令（完整说明）

> 以下命令**当前不可用**。文档写完整是为了说明产品能力地图与未来用法。  
> 规划中的输出为**预期形态**，实现时可能调整；落地后会迁入「已实现」并改为真实示例。

---

## 暂未实现 · 顶层

### `version` — 打印 CLI / 协议版本

**状态：暂未实现**

```bash
pier version --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "cliVersion": "0.1.x",
    "appVersion": "0.1.x",
    "protocol": ["1", "pier.control/v2"]
  }
}
```

### `capabilities` — 列出当前客户端可用能力

**状态：暂未实现**

```bash
pier capabilities --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "commands": ["app.status", "panel.list", "agents.catalog"],
    "features": []
  }
}
```

### `doctor` — 本机连接与环境自检

**状态：暂未实现**

```bash
pier doctor --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "socket": "ok",
    "appRunning": true,
    "issues": []
  }
}
```

### `snapshot` — 原子总快照（多资源）

**状态：暂未实现**

一次取回窗口 / 面板 / 活动等一致性快照，供脚本对账。

```bash
pier snapshot [--include windows,panels,activity] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "bootId": "…",
    "capturedAt": 1730000000000,
    "windows": [],
    "panels": [],
    "activity": null,
    "cursor": { "bootId": "…", "revision": 12, "scope": "global" }
  }
}
```

### `watch` — 全局事实流（不漏事件）

**状态：暂未实现**

```bash
pier watch [--after-boot <bootId> --after-revision <n>] --json
```

**预期行为：** 长连接或 JSONL 流式输出事件；断线 / 游标过期时提示重新 `snapshot`。

**预期事件行示例（JSONL）：**

```json
{"type":"event","resource":"panels","revision":13,"payload":{}}
{"type":"event","resource":"activity","revision":14,"payload":{}}
```

---

## 暂未实现 · 终端（写控与观察）

> 当前可用：`terminal open`、`terminal profiles …`（见上文）。

### `terminal list` — 列出终端运行实例

**状态：暂未实现**

```bash
pier terminal list [--window <窗口id>] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "terminals": [
      {
        "panelId": "terminal-abc",
        "windowId": "main",
        "cwd": "/Users/you/project",
        "title": "zsh",
        "runtimeId": "…",
        "generation": 3
      }
    ]
  }
}
```

### `terminal get` — 查询单个终端

**状态：暂未实现**

```bash
pier terminal get --panel <面板id> [--window <窗口id>] --json
# 规划中亦可能支持按 RuntimeRef：
# pier terminal get --runtime <id> --boot <bootId> --generation <n> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panelId": "terminal-abc",
    "cwd": "/Users/you/project",
    "title": "zsh",
    "alive": true,
    "runtimeId": "…",
    "generation": 3,
    "bootId": "…"
  }
}
```

### `terminal send` — 向终端发送文本

**状态：暂未实现**

```bash
pier terminal send --panel <面板id> --text "echo hi" --json
# 或 stdin：
# pier terminal send --panel <面板id> --json < payload.txt
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "accepted": true,
    "panelId": "terminal-abc"
  }
}
```

> `accepted` 只表示已提交输入，**不等于**命令已执行完毕。

### `terminal key` — 发送按键

**状态：暂未实现**

```bash
pier terminal key --panel <面板id> --key Enter [--mods …] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": { "accepted": true, "key": "Enter" }
}
```

### `terminal interrupt` — 中断（如 Ctrl-C）

**状态：暂未实现**

```bash
pier terminal interrupt --panel <面板id> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": { "signaled": true, "panelId": "terminal-abc" }
}
```

### `terminal terminate` — 结束终端进程 / 关闭运行

**状态：暂未实现**

```bash
pier terminal terminate --panel <面板id> [--force] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": { "terminated": true, "panelId": "terminal-abc" }
}
```

### `terminal wait` — 等待终端进入某状态

**状态：暂未实现**

```bash
pier terminal wait --panel <面板id> --until idle|exited [--timeout-ms 60000] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "until": "idle",
    "reached": true,
    "elapsedMs": 1200
  }
}
```

超时预期：

```json
{
  "ok": false,
  "requestId": "…",
  "error": {
    "code": "observation_timeout",
    "message": "…"
  }
}
```

### `terminal watch` — 订阅终端相关事件

**状态：暂未实现**

```bash
pier terminal watch --panel <面板id> --json
```

**预期：** JSONL 事件流（标题变化、退出、cwd 变化等）。

---

## 暂未实现 · 工作树（扩展）

> 当前可用：`worktrees list` · `create` · `open`。

### `worktrees check` — 检查路径是否可作为工作树目标

**状态：暂未实现**

```bash
pier worktrees check --path <路径> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "path": "/Users/you/repo",
    "isGit": true,
    "canCreateWorktree": true,
    "issues": []
  }
}
```

### `worktrees get` — 查询单个工作树

**状态：暂未实现**

```bash
pier worktrees get --path <路径> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "path": "/Users/you/repo.worktree/feature-x",
    "branch": "feature-x",
    "gitRoot": "/Users/you/repo",
    "worktreeKey": "…",
    "incarnationId": "…"
  }
}
```

### `worktrees register` — 登记已有工作树

**状态：暂未实现**

```bash
pier worktrees register --path <路径> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "path": "/Users/you/repo.worktree/feature-x",
    "registered": true
  }
}
```

### `worktrees remove` — 安全移除工作树

**状态：暂未实现**

```bash
pier worktrees remove --path <路径> [--force] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "path": "/Users/you/repo.worktree/feature-x",
    "removed": true
  }
}
```

---

## 暂未实现 · Shell 任务（命名与扩展）

> 当前可用：`tasks list` · `run` · `status` · `cancel`。  
> 下列为规划中的同构命名（语义可能与 `status`/`cancel` 重叠，实现时再定最终别名）。

### `tasks get`

**状态：暂未实现**

```bash
pier tasks get <运行id> --json
```

**预期：** 与 `tasks status` 类似的单条运行详情，字段更完整。

### `tasks watch`

**状态：暂未实现**

```bash
pier tasks watch <运行id> --json
```

**预期：** JSONL 推送运行状态变化，直至终态。

### `tasks output`

**状态：暂未实现**

```bash
pier tasks output <运行id> [--after-byte <n>] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "runId": "run-…",
    "chunk": "…",
    "nextByte": 4096,
    "eof": false
  }
}
```

### `tasks stop` / `tasks rerun`

**状态：暂未实现**

```bash
pier tasks stop <运行id> --json
pier tasks rerun <运行id> --json
```

**预期：** `stop` 类似取消；`rerun` 返回新的 `runId`。

---

## 暂未实现 · 智能体（完整）

> 当前可用：`agents catalog` · `list` · `get`（见第一部分）。  
> 下列命令**全部暂未实现**。实现前请用应用内方式启动智能体；CLI 仅作查看。

### `agents self` — 当前调用者摘要

**状态：暂未实现**（人类 CLI 在解析期直接拒绝，不会连上宿主后才报权限错误）

用于查询「谁在调用 Pier」的非秘密摘要（规划/实验能力；**需要 agent principal**，**不作为本机权限系统**）。产品 `pier` 始终以 `cli-human` 连接，请用 `agents catalog|list|get`。

```bash
# 人类 CLI 会失败（预期）：
pier agents self --json
# → pier agents self is not available from the human CLI …
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "self": {
      "principalRef": "…",
      "bootId": "…",
      "operations": ["agents.catalog", "agents.list"],
      "expiresAt": 1730003600000
    }
  }
}
```

### `agents invoke` — 一次性调用

**状态：暂未实现**

对指定智能体发起**单次**调用，只返回本次结构化回复，不建立可枚举历史。

```bash
pier agents invoke --agent <agentId> \
  --worktree-key <key> [--incarnation-id <id>] \
  [--execution-deadline-ms <n>] [--wait-timeout-ms <n>] \
  --json < prompt.txt
```

| 参数（规划） | 说明 |
|--------------|------|
| `--agent` | 目标智能体 id（如 `claude`） |
| `--worktree-key` / 工作树定位 | 约束工作目录身份 |
| prompt | **stdin 或文件**，不进 argv |
| `--execution-deadline-ms` | 执行截止 |
| `--wait-timeout-ms` | 观察等待上限 |

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "reply": {
      "agentId": "claude",
      "status": "responded",
      "text": "…",
      "operationId": "…",
      "bootId": "…",
      "usage": { "inputTokens": 0, "outputTokens": 0 }
    }
  }
}
```

**语义要点（规划）：**

- `status: responded` **不等于**你的工作已完成  
- 不提供 `invoke history` / 公共 transcript  
- 观察超时与执行截止错误码会区分（如 `observation_timeout`）

### `agents start` — 启动持久运行

**状态：暂未实现**

```bash
pier agents start --agent <agentId> \
  --worktree-key <key> [--incarnation-id <id>] \
  [--window <窗口id>] [--split <方向>] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "runtime": {
      "runtimeId": "rt-…",
      "bootId": "…",
      "generation": 1,
      "panelId": "terminal-…",
      "windowId": "main",
      "agentId": "claude"
    }
  }
}
```

### `agents turn` — 向持久运行发送一轮输入

**状态：暂未实现**

```bash
pier agents turn \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  --json < turn.txt
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "accepted": true,
    "runtimeId": "rt-…",
    "generation": 1,
    "effectRevision": 5
  }
}
```

> `accepted` 只表示输入已被接受，**不等于**智能体已处理完毕。

### `agents screen` — 读取当前可见画面

**状态：暂未实现**

只返回**当前 viewport** 有界内容（非完整 scrollback / 非 transcript）。

```bash
pier agents screen \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  [--max-bytes <n>] [--max-lines <n>] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "screen": {
      "text": "…当前可见文本…",
      "truncated": false,
      "canonicalPath": "/Users/you/repo/src/main.ts",
      "worktree": {
        "path": "/Users/you/repo",
        "worktreeKey": "…",
        "incarnationId": "…"
      }
    }
  }
}
```

**语义要点（规划）：**

- 文件内容请用你自己的编辑器 / 本地工具读取；CLI 给路径定位  
- 不是语义终答，也不是完整会话历史

### `agents wait` — 等待运行状态

**状态：暂未实现**

```bash
pier agents wait \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  --until ready|waiting|exited|attention \
  [--timeout-ms 60000] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "until": "ready",
    "reached": true,
    "state": "ready",
    "elapsedMs": 3400
  }
}
```

超时：

```json
{
  "ok": false,
  "requestId": "…",
  "error": {
    "code": "observation_timeout",
    "message": "…"
  }
}
```

### `agents watch` — 订阅运行事实

**状态：暂未实现**

```bash
pier agents watch \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  [--after-revision <n>] --json
```

**预期：** JSONL 事件流（状态变化、需要你处理等）；gap 时要求重新对齐。

```json
{"type":"event","revision":6,"kind":"agent.state","state":"waiting"}
{"type":"event","revision":7,"kind":"agent.attention","reason":"…"}
```

### `agents focus` — 聚焦到该运行对应界面

**状态：暂未实现**

```bash
pier agents focus \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  [--no-focus] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "panelId": "terminal-abc",
    "windowId": "main"
  }
}
```

> 在实现前，可用已实现的 `panels focus <面板id>` 作界面聚焦。

### `agents interrupt` — 中断当前运行

**状态：暂未实现**

```bash
pier agents interrupt \
  --runtime <runtimeId> --boot <bootId> --generation <n> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "interrupted": true,
    "runtimeId": "rt-…",
    "generation": 1
  }
}
```

### `agents terminate` — 结束运行

**状态：暂未实现**

```bash
pier agents terminate \
  --runtime <runtimeId> --boot <bootId> --generation <n> \
  [--force] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "terminated": true,
    "runtimeId": "rt-…",
    "generation": 1
  }
}
```

---

## 暂未实现 · 活动（activity）

### `activity snapshot`

**状态：暂未实现**

```bash
pier activity snapshot --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "activity": {
      "kind": "agent",
      "label": "claude",
      "panelId": "terminal-abc",
      "state": "running"
    },
    "cursor": { "bootId": "…", "revision": 3, "scope": "resource:activity" }
  }
}
```

### `activity watch`

**状态：暂未实现**

```bash
pier activity watch [--after-revision <n>] --json
```

**预期：** 前台活动（agent / task / shell / idle）变化的 JSONL 流。

---

## 暂未实现 · 消息中心（notifications）

> 请在应用内使用消息中心 UI。下列为规划中的 CLI 形态。

### `notifications list`

**状态：暂未实现**

```bash
pier notifications list [--unread] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "items": [
      {
        "id": "n-…",
        "title": "需要你处理",
        "body": "…",
        "unread": true,
        "createdAt": 1730000000000
      }
    ]
  }
}
```

### `notifications get`

**状态：暂未实现**

```bash
pier notifications get <id> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "item": {
      "id": "n-…",
      "title": "需要你处理",
      "body": "…",
      "unread": true,
      "createdAt": 1730000000000,
      "actions": []
    }
  }
}
```

### `notifications watch`

**状态：暂未实现**

```bash
pier notifications watch --json
```

**预期：** JSONL 推送新消息 / 已读变化。

### `notifications focus`

**状态：暂未实现**

```bash
pier notifications focus <id> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "id": "n-…",
    "focused": true,
    "panelId": "terminal-abc"
  }
}
```

### `notifications mark-read`

**状态：暂未实现**

```bash
pier notifications mark-read <id> --json
pier notifications mark-read --all --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": { "marked": 1 }
}
```

---

## 暂未实现 · 外部授权（access）

供外部控制器或人类确认场景的窄授权（规划）。**不是**本机日常 CLI 所需。

### `access keygen`

**状态：暂未实现**

```bash
pier access keygen --out <私钥路径> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "publicKey": "…",
    "path": "/Users/you/.config/pier/access.pem",
    "created": true
  }
}
```

### `access status`

**状态：暂未实现**

```bash
pier access status --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "hasKey": false,
    "grants": []
  }
}
```

### `access request`

**状态：暂未实现**

```bash
pier access request --scope <scope-json-or-file> --json
```

**预期输出示例（等待宿主确认）：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "accessRequestId": "…",
    "outcome": "pending"
  }
}
```

### `access wait`

**状态：暂未实现**

```bash
pier access wait --request-id <id> [--timeout-ms 300000] --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "accessRequestId": "…",
    "outcome": "approved",
    "grantId": "grant-…"
  }
}
```

### `access revoke`

**状态：暂未实现**

```bash
pier access revoke --grant-id <id> --json
```

**预期输出示例：**

```json
{
  "ok": true,
  "requestId": "…",
  "data": {
    "grantId": "grant-…",
    "revoked": true
  }
}
```

---

## 暂未实现 · 插件写操作

### `plugins enable`

**状态：CLI 默认不可用**（请在应用「设置 → 插件」中操作）

```bash
pier plugins enable <插件id> --json
```

**若强行调用，预期失败示例：**

```json
{
  "ok": false,
  "requestId": "…",
  "error": {
    "code": "permission_denied",
    "message": "…"
  }
}
```

### `plugins disable`

**状态：CLI 默认不可用**

```bash
pier plugins disable <插件id> --json
```

**预期失败示例：** 同 `plugins enable`。

---

## 本机 CLI 能做什么、不能做什么

| 通常可以（已实现） | 通常不可以 |
|--------------------|------------|
| 查看状态、窗口、面板 | 关闭窗口、改多数写配置 |
| 打开文件夹 / 终端 | 依赖上文「暂未实现」命令写脚本 |
| 查看智能体目录与运行列表 | 智能体权限 / 委派管理 |
| 列出插件 | 默认 CLI 启用 / 禁用插件 |
| 跑 shell 任务 list/run/status/cancel | 把 tasks 当成多智能体看板 |

Pier CLI 是本机工作台的控制与观察入口，**不是**远程 API，也**不是**多智能体编排权限系统。

---

## 常见问题

**连不上 Pier**  
先打开 Pier；开发态用同一 worktree 的 `pnpm dev` 与 `pnpm --silent cli:dev`。

**脚本解析**  
始终 `--json`。

**手册里写了但命令不可用**  
看是否标注 **暂未实现**；实现前请用应用内等价能力。

**从 MCP 或其它工具调用**  
调用本机 `pier`。查找顺序一般：`PIER_CLI_PATH` → `PATH` 中的 `pier` → `Pier.app/.../bin/pier`。

**开发与架构**  
见 [`development.md`](./development.md)、[`README.md`](./README.md)。
