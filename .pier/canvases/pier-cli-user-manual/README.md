# Pier 本机 CLI 使用手册

`pier` 用于控制本机 Pier：打开项目、定位窗口和面板、操作终端、查看智能体状态，以及管理 Git 工作树。它不是远程 API，也不替代 Claude Code、Codex、OpenCode 等工具自己的命令行。

> 本页是 GitHub 可直接阅读的入口。应用内的交互版手册由 [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) 和 [`data.json`](./data.json) 提供；其中的返回内容是阅读用示意，脚本应检查当前 `--json` 响应中的 `ok`、`data` 或 `error`。

## 60 秒上手

正式安装包里的 `pier` 在应用未运行时会先启动再执行。发布版不会自动修改 Shell 的 `PATH`；如果 Pier 位于默认的 `/Applications`，先在当前终端运行：

```bash
export PATH="/Applications/Pier.app/Contents/Resources/bin:$PATH"
```

如果应用位于 `~/Applications`，将上面的路径改成 `$HOME/Applications/Pier.app/Contents/Resources/bin`。随后运行：

```bash
# 1. 确认已连接到本机 Pier
pier status --json

# 2. 在 Pier 中打开当前项目（已有同一工作目录的普通终端则聚焦）
pier . --json

# 3. 查看当前窗口和面板
pier windows list --json
pier panels list --json

# 4. 查看 Pier 已知的产品及正在运行的智能体
pier agents catalog --json
pier agents list --json
```

也可以不修改 `PATH`，直接运行 `/Applications/Pier.app/Contents/Resources/bin/pier <命令…>`。从源码开发时使用：

```bash
pnpm --silent cli:dev -- status --json
```

也可以直接运行 `node ./bin/pier.mjs <命令…>`。

## 常用选项

| 选项 | 作用 |
| --- | --- |
| `--json` | 输出稳定的 JSON；脚本调用建议始终添加 |
| `--print-envelope` | 只打印将发送的请求，不执行 |
| `--no-focus` | 尽量不把 Pier 窗口带到前台 |
| `--window <id>` | 指定窗口；先用 `pier windows list --json` 查询 |

成功响应包含 `ok: true` 和 `data`；失败响应包含 `ok: false`、错误代码与可读消息。

## 打开项目与组织面板

```bash
# 打开当前目录；已有同一工作目录的普通终端则聚焦，否则新建
pier . --json

# 打开指定目录；也可在当前布局右侧再拆一块
pier open /path/to/repo --json
pier open . --split right --json

# 打开文件（已打开则复用标签；可带 :行[:列]）
pier src/app.ts:12 --json

# 找到并聚焦面板
pier panels list --json
pier panels focus <panelId> --json

# 新开终端（这条永远新建，不复用）
pier terminal open --cwd . --json
pier terminal open --cwd . --json -- claude
```

终端定位命令不会返回完整终端内容：

```bash
pier terminal list --json
pier terminal get --panel <panelId> --json
```

对普通 Shell 终端，可发送文本或按键：

```bash
pier terminal send --panel <panelId> --text "pnpm test" --json
pier terminal key --panel <panelId> --key enter --json
```

智能体面板请使用下一节的 `agents turn`、`agents interrupt` 和 `agents terminate`，不要通过普通终端命令绕过运行状态。

## 运行和查看智能体

先查看 Pier 已知的智能体目录，再启动一个持续运行的会话：

```bash
pier agents catalog --json
pier agents start --agent codex --cwd . --json
```

`agents start` 会返回 `bootId`、`runtimeId`、`generation` 和 `panelId`。后续命令使用这组运行引用：

```bash
pier agents turn \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --text "检查当前变更并运行测试" \
  --json

pier agents wait \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --until attention \
  --json
```

常用查询与控制如下；表中的 `<运行引用>` 表示同一组 `--boot <bootId> --runtime <runtimeId> --generation <generation>` 参数：

| 命令 | 用途 |
| --- | --- |
| `pier agents list --json` | 列出正在运行的智能体面板 |
| `pier agents get --panel <panelId> --json` | 查询一个运行实例 |
| `pier agents screen <运行引用> --json` | 读取当前可见终端区域，不是完整对话记录 |
| `pier agents watch <运行引用> --json` | 持续接收运行状态变化 |
| `pier agents focus <运行引用> --json` | 回到对应面板 |
| `pier agents interrupt <运行引用> --json` | 中断当前运行 |
| `pier agents terminate <运行引用> --json` | 结束该运行实例 |

`accepted: true` 只表示输入已送达，不表示工作已经完成。`agents wait` 用于等待 `ready`、`waiting`、`exited` 或 `attention`，`agents watch` 用于观察状态变化；最终结果仍以智能体输出为准。

## Git 工作树

```bash
# 查询仓库中的工作树
pier worktrees list --path /path/to/repo --json

# 创建并打开独立工作树
pier worktrees create \
  --path /path/to/repo \
  --name retry-policy \
  --branch feature/retry-policy \
  --base main \
  --json
pier worktrees open /path/to/retry-policy --json

# 检查或查询一个工作树
pier worktrees check --path /path/to/retry-policy --json
pier worktrees get --path /path/to/retry-policy --json
```

移除由 Pier 管理的工作树前，Pier 会检查活跃运行和未提交变更：

```bash
pier worktrees remove --path /path/to/retry-policy --json
```

## Shell 任务

这里的任务是项目中配置的 build、test 等 Shell 运行，不是任务台账或自动调度：

```bash
pier tasks list --path . --json
pier tasks run <taskId> --path . --json
pier tasks status <runId> --json
pier tasks output <runId> --json
pier tasks stop <runId> --json
pier tasks cancel <runId> --json
```

## 消息、偏好与插件

```bash
# 消息中心
pier notifications list --unread --json
pier notifications get --id <id> --json
pier notifications focus --id <id> --json
pier notifications mark-read --id <id> --json

# 只读偏好与插件信息
pier preferences read --json
pier plugins list --json
pier plugins inspect <pluginId> --json
```

插件启用与停用请在 Pier 的「设置 → 插件」中完成；本机 CLI 不提供这项写权限。

## 排查连接问题

- 确认 Pier 应用已经启动，而不只是安装了 `pier` 命令。
- 开发态请使用 `pnpm --silent cli:dev -- <命令…>`，避免误连安装版。
- 多窗口时先运行 `pier windows list --json`，再传入 `--window <id>`。
- 脚本判断结果时读取 `ok` 与 `error.code`，不要依赖面向人的输出文本。
- `agents wait` 超时不等于智能体已失败；可继续用 `agents get` 或 `agents watch` 查询状态。

更完整的命令分组和状态见 [`data.json`](./data.json)，也可以在 Pier 的 Files 面板中打开 [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) 使用可搜索的交互版手册。
