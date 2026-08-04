# Pier CLI 多智能体交互设计

> 状态：设计基线已确认（2026-08-04）；范围：P0 详细设计 + P1 短期演进方向；核心决策：Pier 提供“智能体运行时语义面 + 通用终端控制面”，不建设任务编排系统，不公开 provider transcript。

## 1. 结论

Pier 不应该新增一套包含 run、task、dispatch、gate、delivery 的编排服务。那会把产品带向任务台账、调度器和工作流引擎，与 Pier“本地 AI 开发工作台”的定位冲突。

正确的最小能力是两层：

1. **智能体运行时语义面**：发现、启动、查看状态、等待状态变化、聚焦智能体。
2. **通用终端控制面**：查看当前屏幕、增量读取输出、发送文本、发送按键、等待输出、打断和关闭。

P0 先把所有现有 CLI/TUI 智能体都能使用的终端控制闭环做完整。P1 再为支持结构化协议的 provider 增加协议级 prompt、取消和权限交互，并把事件转成现有 Foreground Activity 状态证据；不公开 provider 事件流，不建立统一 transcript 数据库或历史读取 API。

```text
外部脚本 / 上层协调器
          │
          ├── agents：语义状态、启动、等待、聚焦
          │             │
          │             └── Agent Runtime Index
          │                    └── Foreground Activity（状态唯一来源）
          │
          └── terminal：屏幕、输出、文本、按键、退出
                        │
                        ├── Pier 终端输出分段文件
                        └── Ghostty 原生终端会话
```

## 2. 为什么原方案失焦

原方案同时设计了三套本质不同的能力：

- 终端输入输出；
- provider 的结构化会话；
- 持久化任务编排系统。

这导致 `agents read`、`agents send`、turn、task、dispatch、delivery 等概念互相覆盖，也让一个“控制正在运行的智能体”的需求膨胀成了新的工作流产品。

必须先分清三种“会话内容”：

| 内容 | 真实含义 | P0/P1 | 正确入口 |
|---|---|---|---|
| 当前屏幕 | 终端模拟器此刻渲染的字符单元 | P0 | `terminal screen` |
| 增量输出 | Pier 捕获到的 PTY 输出字节流 | P0 | `terminal read` |
| provider 结构化事件 | 消息片段、工具调用、权限请求、回合停止原因 | P1 内部 | provider 协议适配器 → Foreground Activity |

三者不能合并：TUI 会反复重绘，PTY 输出不是消息历史；provider transcript 又可能包含私有格式和内部状态，不能通过文件扫描伪造成公共契约。

## 3. 业界调研

### 3.1 终端控制的共同做法

主流终端控制工具都把“读取屏幕”“持续读取输出”“发送文本/按键”拆开：

| 产品 | 相关能力 | 对 Pier 的启示 |
|---|---|---|
| tmux | `capture-pane`、`pipe-pane`、`send-keys` | 当前屏幕、增量流、输入是三种能力 |
| Orca | terminal `read --cursor`、`send --enter`、`wait` | 长输出使用 cursor；发送后可按状态或输出继续等待 |
| cmux | surface 文本输入、按键输入；生产版本提供 screen readback | 文本粘贴、控制键和屏幕读取不能共用同一接口 |

来源：[tmux Advanced Use](https://github.com/tmux/tmux/wiki/Advanced-Use)、[Orca CLI Reference](https://www.onorca.dev/docs/cli/reference)、[cmux API](https://cmux.com/docs/api)、[cmux Changelog](https://cmux.com/docs/changelog)。

### 3.2 结构化智能体协议的共同做法

结构化集成采用会话协议，而不是解析终端文字：

| 产品/协议 | 核心模型 | 对 Pier 的启示 |
|---|---|---|
| Agent Client Protocol | JSON-RPC；session、prompt、update、cancel、permission | 能力协商与双向权限请求是协议能力 |
| Codex App Server | Thread → Turn → Item，流式通知与审批 | 深度集成应走 App Server，不应解析 Codex TUI |
| Claude Agent SDK | 持久流式进程、session、interrupt、permission callback | 交互式控制需要长连接和结构化事件 |
| Gemini CLI | ACP 模式；headless JSON/stream-json | TUI、非交互输出、协议服务是不同表面 |
| OpenCode | TUI 是 headless HTTP server 的客户端 | 原生 server API 可以承载结构化集成 |

来源：[ACP Architecture](https://agentclientprotocol.com/get-started/architecture)、[ACP Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)、[ACP Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)、[ACP Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)、[Codex App Server](https://learn.chatgpt.com/docs/app-server.md)、[Codex Non-interactive Mode](https://learn.chatgpt.com/docs/non-interactive-mode.md)、[Claude Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[Gemini ACP Mode](https://geminicli.com/docs/cli/acp-mode/)、[OpenCode Server](https://dev.opencode.ai/docs/server/)。

### 3.3 调研结论

业界没有一个可靠的“通用 CLI 会话读取”抽象。可迁移的共同模式是：

- 对任意 CLI/TUI 提供终端控制；
- 对支持协议的 provider 使用结构化适配；
- 通过 capability 明确能力差异；
- 不把屏幕抓取解释成结构化消息；
- 不为了多智能体控制而内建任务调度系统。

## 4. 现有 Pier 基线

本设计建立在现有能力上，不平行重建：

- `Agent Runtime Index` 已是 `foreground-activity` 中 `kind: "agent"` 的本机投影。
- 智能体状态唯一来自 Foreground Activity：`ready | processing | tool | waiting | error`；仅有 launch 证据时状态可以缺省。
- Index 已能关联 `windowId`、`panelId`、`agentId`、工作树上下文并聚焦面板。
- 终端会话已经记录 `agentId`、launch、provider resume metadata、运行/退出状态。
- 终端输入已经区分 `sendText` 与 `sendKeyPress`；提交文本不能退化成一次发送 `text + "\r"`。
- Pier 已分段保存原始终端输出，但 CLI 尚无屏幕读取和 cursor 增量读取能力。
- 本地 CLI 当前是一问一答的 JSON 行协议，P0 无需升级为流式 protocol v2。

## 5. 总体架构

### 5.1 两个公共控制面

```text
pier
├── agents
│   ├── start
│   ├── list
│   ├── status
│   ├── wait
│   └── focus
│
├── terminal
│   ├── open / profiles                 # 现有
│   ├── list / show                     # P0
│   ├── screen / read                   # P0 内容读取
│   ├── send / key                      # P0 输入
│   ├── wait                            # P0 输出/退出等待
│   ├── interrupt / focus / close       # P0 生命周期
│   └── ...
│
└── worktrees / panels / windows ...   # 现有资源面
```

`agents` 不复制终端命令。每个智能体条目返回对应的 `terminalHandle`，调用方再进入 `terminal` 控制面完成低层交互。

### 5.2 资源职责

| 资源 | 拥有什么 | 不拥有什么 |
|---|---|---|
| `agents` | 智能体类型、语义状态、位置、运行时引用 | PTY 字节、屏幕内容、任务生命周期 |
| `terminal` | 进程、屏幕、输出 cursor、文本/按键输入 | 消息角色、工具调用、回合成功 |
| `worktrees` | Git 工作树创建、枚举、删除 | 智能体启动策略 |
| P1 provider adapter | 协议级输入、取消、权限交互和状态证据 | 公共事件流、统一历史库、跨 provider transcript |

### 5.3 组合而非内建编排

多智能体并行由外部脚本组合：

```bash
worktree_json=$(pier worktrees create --repo "$repo" --name api --json)
worktree_path=$(jq -r '.data.path' <<<"$worktree_json")

agent_json=$(pier agents start \
  --agent codex \
  --cwd "$worktree_path" \
  --prompt "检查 API 兼容性" \
  --json)

agent_handle=$(jq -r '.data.agent.agentHandle' <<<"$agent_json")
terminal_handle=$(jq -r '.data.agent.terminalHandle' <<<"$agent_json")

pier agents status "$agent_handle" --json
pier terminal screen "$terminal_handle" --json
```

Pier 提供可靠原语；是否建立 DAG、重试、投票、审批门或 worker 汇报，由调用方或专门的上层协调器决定。

## 6. P0 命令设计

### 6.1 寻址与生命周期

CLI 返回两种 URL-safe opaque handle：

| Handle | 作用域 | 用途 |
|---|---|---|
| `agentHandle` | 当前 Pier 主进程生命周期 | `agents status/wait/focus` |
| `terminalHandle` | 当前 Pier 主进程生命周期 | `terminal screen/read/send/...` |

规则：

- 公共 CLI 不直接暴露内部含分隔符的 `agentRef`。
- handle 不可由脚本拼接或解析。
- Pier 重启后 handle 失效；调用方重新执行 `agents list` 或 `terminal list`。
- 不为稳定 ID 建立数据库，也不把运行时 handle 写入 userData。
- 变更类命令要求显式 handle，不猜测“当前智能体”。

### 6.2 `agents start`

```text
pier agents start
  --agent <agentId>
  [--cwd <path> | --worktree <existing-selector>]
  [--prompt <text>]
  [--window <windowId>]
  [--no-focus]
  [--json]
```

语义：

- 启动一个带 `agentId` 元数据的受管终端。
- `--cwd` 和 `--worktree` 只选择已有位置；创建工作树继续走 `worktrees create`。
- 缺省位置为 CLI 当前工作目录。
- `--prompt` 是启动后的初始终端输入，不创建 Pier turn 实体。
- 返回终端创建并可寻址的结果，不等待智能体完成工作。
- 不提供跨 provider 的 `--approval-mode auto`；权限和沙箱继续由具体 provider 配置负责。

返回：

```json
{
  "ok": true,
  "requestId": "req_01",
  "data": {
    "agent": {
      "agentHandle": "agent_rt_01",
      "terminalHandle": "term_rt_01",
      "agentId": "codex",
      "status": null,
      "statusSource": "launch",
      "revision": 18,
      "windowId": "2",
      "panelId": "terminal-7",
      "cwd": "/repo/.worktrees/api"
    }
  }
}
```

`status: null` 表示目前只有启动证据，不能猜测智能体是否 ready 或 processing。

### 6.3 `agents list/status`

```text
pier agents list [--window <windowId>] [--json]
pier agents status <agentHandle> [--json]
```

条目直接投影 Agent Runtime Index：

```ts
interface CliAgentRuntime {
  agentHandle: string;
  terminalHandle: string;
  agentId: string;
  status: "ready" | "processing" | "tool" | "waiting" | "error" | null;
  statusSource: "hook" | "launch";
  revision: number;
  updatedAt: number;
  windowId: string;
  panelId: string;
  cwd?: string;
  projectRootPath?: string;
  worktreeKey?: string;
  sessionTitle?: string;
}
```

约束：

- 不增加 `idle`、`working`、`completed` 等第二套状态词。
- `processing` 与 `tool` 保持可区分。
- 状态缺失就返回 `null`，不通过终端文本猜测。
- `revision` 来自运行时快照的单调序号，只在当前主进程生命周期内有效。

### 6.4 `agents wait`

```text
pier agents wait <agentHandle>
  --after <revision>
  --until <ready|waiting|error|gone>[,...]
  [--timeout-ms <ms>]
  [--json]
```

语义：

- 只接受 `--after` 之后的新快照，避免已有 `ready` 状态导致错误的立即成功。
- 状态判断仍由 Foreground Activity 完成，CLI 不解析屏幕。
- `gone` 表示该运行时条目消失，例如终端关闭或窗口销毁。
- 返回匹配状态、最新 revision 和完整条目。
- timeout 返回非零退出码和 `WAIT_TIMEOUT`，同时附带最后一次观察结果。
- 对没有结构化状态能力的 launch-only 智能体，不能等待 `ready` 来代表“回合结束”；调用方可等待终端输出或进程退出。

P0 明确没有 `turn.completed` 语义。

### 6.5 `agents focus`

```text
pier agents focus <agentHandle> [--json]
```

复用 Agent Runtime Index 的跨窗口聚焦能力。目标已消失时返回明确的 `AGENT_GONE`，不选择其他“相似”面板。

### 6.6 `terminal list/show`

```text
pier terminal list [--window <windowId>] [--json]
pier terminal show <terminalHandle> [--json]
```

`show` 返回终端元数据与读取基线：

```ts
interface CliTerminalRuntime {
  terminalHandle: string;
  state: "running" | "exited";
  windowId: string;
  panelId: string;
  cwd?: string;
  agentHandle?: string;
  agentId?: string;
  outputCursor: string;
  exitCode?: number;
}
```

`outputCursor` 可作为“从现在开始观察”的基线。

### 6.7 `terminal screen`

```text
pier terminal screen <terminalHandle>
  [--scrollback-lines <n>]
  [--json]
```

返回终端模拟器当前渲染结果：

```ts
interface TerminalScreenSnapshot {
  terminalHandle: string;
  revision: number;
  rows: number;
  columns: number;
  text: string;
  cursor?: { row: number; column: number; visible: boolean };
  scrollbackLines: number;
  truncated: boolean;
}
```

契约：

- `text` 是按终端字符单元还原的纯文本屏幕，不包含 ANSI 控制序列。
- 默认只返回可见 viewport；`--scrollback-lines` 有严格上限。
- 保留行结构，去掉每行右侧未使用的空白单元，但不折叠中间空行。
- 结果是观察快照；下一次读取可能已经变化。
- 屏幕读取由终端原生层提供，不能依赖截图 OCR 或 renderer DOM。

`screen` 适合回答“这个 TUI 现在显示什么”。

### 6.8 `terminal read`

```text
pier terminal read <terminalHandle>
  [--cursor <opaque-cursor>]
  [--limit-bytes <n>]
  [--json]
```

返回 Pier 已捕获的增量 PTY 输出：

```ts
interface TerminalOutputChunk {
  terminalHandle: string;
  cursor: string;
  nextCursor: string;
  text: string;
  byteLength: number;
  truncated: boolean;
  exited: boolean;
}
```

契约：

- cursor 是不透明字符串；其内部偏移单位不是公共 API。
- 省略 cursor 时返回有上限的最近输出，并给出 `nextCursor`。
- `limit-bytes` 限制单次返回量；服务端不能在 UTF-8 code point 中间切断文本。
- 输出保留 PTY/ANSI 控制字符；JSON 模式按 JSON 字符串转义。
- 分段清理导致 cursor 失效时返回 `CURSOR_EXPIRED`，并附带当前最早 cursor。
- TUI 重绘可能产生重复行和控制序列，调用方不得把它解释成消息列表。

`read` 适合回答“从上次读取后新增了哪些终端输出”。

### 6.9 `terminal send/key`

```text
pier terminal send <terminalHandle>
  --text <text>
  [--enter]
  [--json]

pier terminal key <terminalHandle>
  --key <enter|escape|tab|up|down|left|right|...>
  [--ctrl] [--alt] [--shift] [--command]
  [--json]
```

契约：

- `send` 走现有 paste/sendText 路径。
- `--enter` 必须在文本成功送达后，再按顺序调用 `sendKeyPress(Return)`。
- 不能把 `"\r"` 拼入同一次文本发送；bracketed paste 下这不等价于提交。
- 如果文本已送达但 Enter 失败，返回 `textDelivered: true`，防止调用方重试后重复粘贴。
- Esc、Ctrl-C、方向键等必须走 `key`。
- 输入目标必须是显式 terminal handle；不向当前焦点终端盲发。

### 6.10 `terminal wait`

```text
pier terminal wait <terminalHandle>
  --until <output|quiet|exit>
  [--after <cursor>]
  [--quiet-ms <ms>]
  [--timeout-ms <ms>]
  [--json]
```

三种条件：

| 条件 | 成功定义 | 必要参数 |
|---|---|---|
| `output` | `after` 之后出现新输出 | `--after` |
| `quiet` | 连续指定时间没有新终端输出 | `--quiet-ms` |
| `exit` | 终端子进程退出 | 无 |

`quiet` 只表示终端暂时没有输出，绝不等价于智能体 ready、回合完成或任务成功。

P0 的 wait 由 CLI 对现有一问一答协议进行有界轮询；无需为长等待引入服务端 JSONL 流。

### 6.11 `terminal interrupt/focus/close`

```text
pier terminal interrupt <terminalHandle> [--json]
pier terminal focus <terminalHandle> [--json]
pier terminal close <terminalHandle> [--json]
```

- `interrupt` 发送终端 Ctrl-C 按键，不直接向进程发送未经 TUI 处理的 POSIX signal。
- `focus` 聚焦窗口和终端面板。
- `close` 使用现有终端关闭生命周期；不得绕过退出确认和清理规则。
- 智能体终止复用 terminal 生命周期，不再增加语义重复的 `agents stop`。

## 7. P0 输出与错误契约

### 7.1 输出格式

- 默认输出面向人类。
- `--json` 沿用现有单 envelope：`{ ok, requestId, data | error }`。
- stdout 只输出最终结果；诊断信息写 stderr。
- 一次命令只输出一个 JSON 文档。
- P0 不增加 `--jsonl`，不升级本地 socket 协议。

### 7.2 核心错误码

| 错误码 | 含义 |
|---|---|
| `AGENT_NOT_FOUND` | agent handle 无效或已过期 |
| `AGENT_GONE` | 等待或聚焦期间智能体运行时消失 |
| `TERMINAL_NOT_FOUND` | terminal handle 无效或已过期 |
| `TERMINAL_EXITED` | 目标终端已退出，操作不再接受输入 |
| `CURSOR_EXPIRED` | 输出 cursor 已超出保留范围 |
| `WAIT_TIMEOUT` | 在时限内未观察到目标条件 |
| `STATUS_UNAVAILABLE` | 当前 provider/launch 证据不支持所需语义状态 |
| `INPUT_REJECTED` | 文本或按键未送达终端 |
| `WINDOW_UNAVAILABLE` | 所属窗口无法完成屏幕读取或聚焦 |

错误响应应包含可恢复信息，例如最后 revision、最新 cursor 或重新执行 `list` 的建议。

## 8. 状态、内容与完成语义

### 8.1 状态唯一来源

`agents status/wait` 只投影 Foreground Activity。终端标题、PTY 文本和提示符可以作为 provider hook 的内部证据，但 CLI 层不能再实现一套正则状态机。

### 8.2 P0 不存在通用“回合完成”

长驻 TUI 进程可以连续接受多次输入，且不同 provider 没有一致的完成标志。因此 P0：

- 不创建 `turnId`；
- 不返回 `turn.completed`；
- 不把 `ready` 自动改名为 `completed`；
- 不把 quiet 解释为完成；
- 不从最后几行终端输出提取“最终答案”。

脚本需要根据自身目的选择：等待语义状态、等待新输出、读取当前屏幕，或等待进程退出。

### 8.3 内容读取边界

Pier 可以公开自己拥有的终端表面和终端输出，但不能公开 provider 私有 transcript：

- `terminal screen/read` 是 Pier 终端能力。
- provider session ID、历史文件格式和内部消息索引不是公共 CLI 契约。
- 不扫描 `~/.codex`、`~/.claude` 等目录生成统一会话历史。
- 不提供 `agents transcript/messages/replay` 命令。
- P1 的 provider 事件只用于适配器内部状态归一化；历史加载也只作为内部兼容过程。

## 9. P1：结构化控制适配

P1 不替换终端控制面，而是在 provider 明确支持时增加可选能力。

```ts
interface StructuredAgentCapabilities {
  prompt: boolean;
  cancel: boolean;
  permissions: boolean;
  resume: boolean;
  statusEvidence: boolean;
}
```

建议的短期命令面：

```text
pier agents capabilities <agentHandle>
pier agents prompt <agentHandle> --text <text>
pier agents cancel <agentHandle>
pier agents permissions list <agentHandle>
pier agents permissions respond <requestId> --option <optionId>
```

规则：

- 命令只在 capability 为 true 时可用，否则返回 `CAPABILITY_UNAVAILABLE`。
- `agents prompt` 是协议级用户消息；`terminal send` 是终端文本，两者语义不能互换。
- 权限响应必须引用 provider 给出的 request ID 和 option ID；不得把“向 TUI 输入 y”伪装成结构化审批。
- resume 可以由适配器内部使用 provider session ID，但不把该 ID 变成 Pier 的公共持久化主键。
- provider 事件只在对应适配器内部归一化为现有 Foreground Activity 证据；宿主不提供 `events/messages/transcript/replay` 公共读取面。
- `permissions list` 只返回仍待处理的 request ID、可选响应、动作说明，以及做出决定所必需的有界参数；不返回相邻消息历史。命令、路径等高风险参数不能为了“简洁”而省略。

适配顺序建议：

1. ACP 原生 provider；
2. Codex App Server；
3. Claude Agent SDK；
4. OpenCode server；
5. 其他 provider 保持 terminal-only。

结构化适配必须另行设计连接生命周期、断线和权限 UI，不在 P0 顺带实现。provider 的 thread/session/item 等对象始终是适配器实现细节。

## 10. 安全与数据边界

- CLI 仍属于本机用户信任模型，但读取终端输出必须拥有明确的只读 capability。
- `screen/read` 可能返回密钥、token、命令输出等敏感内容；默认限量，不新增遥测或镜像副本。
- 写入终端、打断和关闭属于控制 capability，与只读能力分开。
- P0 不新增 provider 权限绕过开关。
- 工作树是 Git 隔离，不是进程安全沙箱。
- 不新增数据库；现有终端输出分段文件、终端 session metadata 和 Foreground Activity 各自保持原有所有权。

P0 复用现有 capability，不新增 `agent:*` 或 Transcript capability：

| 命令 | capability |
|---|---|
| `agents list/status/wait` | `panel:read` |
| `agents focus` | `panel:control` |
| `agents start` | `workspace:open` + `terminal:control` |
| `terminal list/show/screen/read/wait` | `terminal:read` |
| `terminal send/key/interrupt/close` | `terminal:control` |
| `terminal focus` | `panel:control` |

## 11. 明确非目标

以下能力不属于本设计：

- Pier task/run/dispatch/delivery 持久化实体；
- DAG、自动调度、重试、投票或 worker 池；
- gate、ask/reply、收件箱和 ack 协议；
- provider 无关的 turn/result 抽象；
- 解析终端文本生成工具调用或最终答案；
- provider transcript 读取、统一索引和跨 provider 回放；
- 为 P0 引入 socket protocol v2 或常驻 JSONL 连接；
- 用工作树代替权限、沙箱或进程隔离。

## 12. P0 验收标准

P0 完成时必须满足：

1. CLI 能枚举所有窗口中的智能体，并复用 Agent Runtime Index 状态和排序事实。
2. 每个智能体都能解析到明确的 terminal handle。
3. `terminal screen` 能返回有界、稳定格式的当前渲染文本。
4. `terminal read` 能通过 opaque cursor 增量读取，正确处理截断、UTF-8 边界和 cursor 失效。
5. 文本输入与按键输入分开；`send --enter` 保持现有 paste → Return 顺序和部分失败语义。
6. `agents wait` 不会因旧状态立即误判；`terminal wait quiet` 不会被描述为完成。
7. 终端消失、窗口消失、进程退出和等待超时都有结构化错误。
8. 所有 JSON 命令继续使用单 envelope；现有 CLI 命令保持兼容。
9. 不新增任务台账、provider transcript API、统一会话数据库或 protocol v2。
10. 单元测试覆盖 handle 生命周期、状态等待、cursor 边界、输入顺序和权限映射。

## 13. 被否决的替代方案

### 方案 A：在 Pier 内建设完整编排服务

否决。它需要持久化 run/task/dispatch、调度、投递和恢复语义，超出产品定位，并与现有 `tasks` 命令产生概念冲突。

### 方案 B：所有能力都放在 `agents` 下

否决。普通 shell、调试器和未知 TUI 同样需要 screen/read/send/key；把终端能力挂在 `agents` 下会重复实现并模糊语义。

### 方案 C：只提供终端抓取

否决为长期方案。它适合作为通用 P0 fallback，但无法可靠表达工具调用、权限请求、取消和停止原因。

### 方案 D：扫描 provider transcript 文件

否决。私有格式不稳定、权限边界不清晰，也会诱导 Pier 建立统一历史库和错误的跨 provider 语义。

### 方案 E：P0 直接采用某个 provider 的事件协议

否决。Codex、Claude、Gemini、OpenCode 的对象模型不同；P0 应先交付 provider 无关的终端控制，结构化适配通过 capability 渐进加入。

## 14. 最终决策

Pier 的多智能体 CLI 不是一个新的编排器，而是可被编排的本地运行时：

- `agents` 回答“智能体在哪里、是什么状态”；
- `terminal` 回答“屏幕显示什么、输出了什么、如何输入和停止”；
- P1 provider adapter 提供协议级输入、取消、权限和更可靠的状态证据；
- 外部协调器决定“谁做什么、依赖谁、何时重试”。

这条边界既覆盖完整会话交互，也保持 Pier 架构简洁、可实施且不偏离产品定位。
