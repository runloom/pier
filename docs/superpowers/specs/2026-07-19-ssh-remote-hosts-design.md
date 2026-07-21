# SSH 主机能力设计

> 状态: 已决策，分阶段实施；本文对应第一阶段（主机管理 + SSH 终端启动）
> 范围: 修订「远程 / SSH / runner 明确不做」决策（能力清单 2.2 节编号 20），定义 SSH 能力的产品边界与实现分层

## 1. 决策变更

原能力清单把「远程 / SSH / runner」整体列为明确不做。2026-07-19 起调整为分层决策：

| 层 | 能力 | 决策 |
| --- | --- | --- |
| L1 | SSH 主机管理 + 一键打开 SSH 终端 | 进入路线（本文） |
| L2 | 远程文件浏览 / 下载（SFTP） | 需求触发型候选；在 `pier.ssh` 插件私有域内实现 |
| L3 | 完整远程工作区（远程 PTY 接入渲染、远程 Git / 文件系统 provider、远程 agent 状态回传、端口转发） | 仍明确不做 |

判断依据：

- Pier 终端是本机 Ghostty `.exec` PTY；「终端里跑 `ssh`」不改变本地工作台架构，成本极低。
- L3 需要给 `PanelContext`、`FileService`、`GitService`、agent hooks 四条链加 provider 抽象，实质是产品改型，不是能力补齐。
- 对齐「某个插件的发展方向不自动转化为宿主公共能力」原则：SSH 域全部落在官方插件内，宿主只补一个最小通用入口。

## 2. 架构分工

### 2.1 宿主：插件 `terminals.open` API（通用能力，非 SSH 专属）

宿主唯一的新增能力是把已有的 PierCommand `terminal.open` 暴露给插件：

- preload：`window.pier.terminals.open(request)`（`src/preload/terminals-api.ts`），走 `invokePierCommand`，main 侧解析 launch / profile / env 并路由窗口。
- builtin context：`context.terminals.open`（`src/renderer/lib/plugins/host-terminals-context.ts`），capability 断言 `terminal:control`。
- external context：`ExternalRendererPluginContext.terminals.open`（`external-plugin-context.ts` 内联断言 `terminal:control`）。
- 命名区分：单数 `context.terminal` 是读路径（选区 / openUrl，`terminal:read`）；复数 `context.terminals` 是写路径（打开终端 panel，`terminal:control`）。
- main 侧不改：`terminal.open` 带非空 `launch` 时按既有动态规则要求 `workspace:open` + `terminal:control`。

### 2.2 插件：官方 managed 外部插件 `pier.ssh`

SSH 域全部为插件私有，宿主不新增 SSH 数据域、不新增远程路径概念：

- **主机配置**：`plugin.json` 声明 settings 页；主机列表存插件 `workDir/hosts.json`，字段为 name / host / user / port / identityFile。
- **密钥与口令**：v1 不托管任何凭据——认证完全依赖用户本机 `ssh` 客户端、ssh agent 与 `~/.ssh/config`，插件不自带 SSH 协议栈。若未来出现真实需求（如 passphrase 记忆），再经 `context.secrets`（safeStorage）实现并补 `secret:*` 声明。
- **打开 SSH 终端**：renderer 侧动作 / 设置页按钮组装 `ssh` 命令行（host alias 或 `user@host -p port -i identityFile`，参数做 shell 引号防护），调 `context.terminals.open({ launch: { command } })`。
- **测试连接**：main 侧 `ssh -oBatchMode=yes -oConnectTimeout=8 <target> true` 非交互探测，15 秒兜底超时。
- **manifest permissions**：`["terminal:control"]`。
- **导入**：读取 `~/.ssh/config`（插件 main 侧 RPC + Node fs），解析具体别名的 `Host` 条目作为候选（跳过通配/否定模式，v1 不跟随 `Include`）；导入项保留别名作为连接目标，跳板机与私钥配置继续由 ssh config 生效；只读不写用户 ssh 配置。
- **schema 约束**：插件内校验用 `zod/mini`——zod classic 的 JIT 探测（`new Function`）会触发 managed 包校验的 eval 禁令（`package-validation.ts`），这是官方插件的既有约定（对齐 `pier.grok`）。

### 2.3 明确不做（L3 边界）

- 不把远程 PTY 字节流接入 Ghostty（不新增 PTY provider / host-managed 交互后端）。
- 不给 `PanelContext` 增加 host 维度；SSH 终端 panel 的 cwd/git 上下文保持本机语义（`ssh` 进程本身的 cwd）。
- 不改造 `FileService` / `GitService` / files 插件 / git 插件支持远程路径。
- 不做端口转发、远程 agent 状态、远程 worktree。

## 3. 用户可见行为（L1 验收）

1. 设置页出现「SSH 主机」分区：增删改主机、可选导入 `~/.ssh/config`、测试连接（`ssh -oBatchMode=yes <target> true` 报告结果，成功走 toast、失败弹出含 stderr 详情的提示）。
2. 命令面板动作「打开 SSH 终端」：无主机时提示并打开设置页；有主机时始终弹主机选择框（即使只有一个，也让用户显式确认目标）→ 选中后新终端 panel 内运行 `ssh <target>`。
3. 终端 panel 行为与普通终端一致（分屏、tab、恢复策略按现有终端会话规则）。
4. 文案走插件 locales（`plugin.json` 内嵌 en / zh-CN），遵守用户文案规范。

## 4. 测试

- `tests/unit/renderer/plugin-terminals-context.test.ts`：builtin / external `terminals.open` 的 `terminal:control` 门控与透传。
- `tests/unit/main/ssh-plugin-hosts.test.ts`：`ssh` 命令行组装（端口 / identityFile / 引号防护）、`~/.ssh/config` 解析（通配跳过、端口校验）、导入候选去重、hosts 存储持久化与损坏恢复、RPC 校验与路由。
- main 侧 `terminal.open` 权限规则已有 `tests/unit/app-core/permissions.test.ts` 锁定，不改。

## 5. 后续触发条件

- L2（SFTP 文件浏览）：L1 落地后出现稳定、可复现的远程文件查看需求时，在 `pier.ssh` 内自建 panel 实现；不得以此为由改造宿主文件服务。
- L3：只有产品明确决定从「本地工作台」转向「远程开发平台」时重新评估，需独立设计。
