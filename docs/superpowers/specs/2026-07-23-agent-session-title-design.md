# 智能体会话标题设计

> 日期：2026-07-23
>
> 状态：已实现并完成边界加固
>
> 实施计划：[../plans/2026-07-23-agent-session-title.md](../plans/2026-07-23-agent-session-title.md)

## 1. 目标和完成标准

Pier 为智能体会话提供独立的产品标题 `sessionTitle`。标题只负责帮助用户辨认会话，
不得承担会话身份、状态或命令路由职责，也不得从终端 OSC 标题反推。

完成标准：

1. tab、标题栏、智能体索引、关闭摘要和活动组件统一读取
   `resolveAgentSessionTitle`。
2. 标题来源固定为 `prompt < provider < user`，只允许严格升秩覆盖；
   `user` 可主动再次改名。
3. 标题按 `sessionId` 绑定。主会话发生 `SessionStart` 切换时，不得把旧会话标题带入
   新会话。
4. 子会话事件不得改写面板主会话的身份、状态和标题。
5. 标题长度上限为 120 个 Unicode 码点，schema、宿主派生和 hook 脚本同构。
6. 用户可从终端内容菜单、dockview tab、命令面板和活动总览四处发起改名，四处共用
   同一交互门面。
7. 全量 `pnpm check` 通过。

## 2. 当前结构为什么不足

早期实现先解决了 OSC 与产品标题混用，但仍有四个结构缺口：

- 持久化只按 `panelId` 保存标题，没有记录标题属于哪个 `sessionId`；`/clear`、resume
  或新会话可能继承旧标题。
- main 的标题旁路和前台活动聚合器都能收到子会话事件；若各自判断主/子身份，规则会
  漂移，子会话的 prompt、状态或会话号可能污染面板主行。
- 写入被高秩标题拒绝时，运行投影曾错误水合“本次尝试值”，而不是磁盘中的最终真值，
  形成内存与持久化分叉。
- JavaScript 的 `string.length` 和 `slice` 按 UTF-16 码元工作，不满足“120 个码点”
  的契约，还可能从代理对中间截断。

这些问题不能靠展示层兜底。标题作用域、写入裁决和事件身份必须在各自所有者处闭环。

## 3. 所有权划分

| 责任 | 所有者 | 说明 |
| --- | --- | --- |
| 身份判定 | `src/shared/agent-session-actor.ts` | 主/子会话判据唯一来源 |
| 标题规范化与秩 | `src/shared/agent-session-title/` | Unicode 上限、派生、展示解析和写入裁决 |
| 持久化真值 | `src/main/state/terminal-session-title.ts` | 保存标题、来源及 `sessionTitleSessionId` |
| 事件编排 | `src/main/services/agents/session-title/` | 只接主会话事件，处理 prompt/provider 标题和会话切换 |
| 运行投影 | `src/main/services/foreground-activity/` | 把持久化真值投影到 `AgentActivity`，不自行推断标题 |
| provider 适配 | `src/main/services/agents/integrations/` | 只分类 provider 已写下的原生标题，不额外调用模型 |
| 用户交互 | `src/renderer/lib/agent-runtime/rename-agent-session.ts` | 四个入口共用的初值、校验、IPC 与错误反馈 |
| UI 展示 | `resolveAgentSessionTitle` 的调用点 | 不接收 OSC；无标题时使用智能体与项目路径占位 |
| 测试 | 标题单测、聚合器单测、治理测试、组件测试 | 证明层间契约和用户入口 |

`sessionTitle` 是可读性信号，不是身份。确定性身份由 `agentId`、项目路径锚点、
`panelId`、`sessionId`、`actorHint` 和 `parentSessionId` 提供。

## 4. 数据流与控制流

### 4.1 prompt 标题

```text
主会话 UserPromptSubmit
  → isSubagentHookEvent：拒绝子会话旁路
  → deriveAgentSessionTitleFromPrompt
  → writeAgentSessionTitle(source="prompt", sessionId)
  → setTerminalPanelSessionTitle：持久化裁决
  → 用持久化返回的最终真值更新前台活动投影
  → resolveAgentSessionTitle → 各展示表面
```

Claude 的 `derive-claude-session-title` 只做同构双写。生成脚本必须与 shared 派生结果
逐字一致；修改脚本时必须提升 `PIER_HOOK_COMMAND_GENERATION`。

### 4.2 provider 标题

```text
provider transcript 增量行
  → agent 专属 classifyTitleLine
  → transcript-title-routing 按 sessionId/唯一 owner 归属
  → applyProviderAgentSessionTitle(source="provider")
  → 同一持久化裁决与投影通路
```

当前只消费 Claude 的 `ai-title`。首次绑定时的历史回扫不写标题；会话号不匹配且存在
多个 owner 时放弃，不猜归属。`custom-title` 和 `agent-name` 是 Pier 自己双写的 prompt
派生，不得洗成更高的 `provider` 秩。

### 4.3 会话切换

```text
主会话 SessionStart(nextSessionId)
  → reconcileTerminalPanelSessionTitleScope
  ├─ 历史标题未绑定 sessionId：只绑定到首次可靠会话
  ├─ sessionId 相同：保留标题
  └─ sessionId 不同或新会话号缺失：清除旧标题、来源和作用域
  → 用持久化最终结果覆盖或清除前台活动投影
```

### 4.4 用户改名

```text
终端内容菜单 / dockview tab / 命令面板 / 活动总览
  → promptRenameAgentSession
  → pier:terminal:set-session-title(source="user")
  → main 读取当前主会话 sessionId
  → 持久化裁决
  → 返回并水合磁盘最终真值
```

写入冲突时，调用方不得假定尝试值获胜；必须消费持久化层返回的
`title/source/sessionId`。

## 5. 标题契约

### 5.1 来源优先级

| 来源 | 秩 | 语义 |
| --- | ---: | --- |
| `prompt` | 1 | 首条主会话 prompt 的确定性截断 |
| `provider` | 2 | provider 自己已经生成并写入 transcript 的标题 |
| `user` | 3 | 用户主动改名 |

空槽可写；`user` 可覆盖任意来源；其他写入必须严格升秩。同秩不覆盖，避免每回合标题
抖动。历史 `auto`、`rule`、`model` 只在读取期归一为 `prompt`，不回写。

### 5.2 长度和文本

- `MAX_AGENT_SESSION_TITLE_LENGTH` 固定为 120 个 Unicode 码点。
- `agentSessionTitleValueSchema`、`normalizeAgentSessionTitle` 和 hook 生成脚本都按
  `Array.from(value)` 计数。
- 派生流程为：清协议标记 → 取首个非空行 → 规范化 → 软断点硬截断。
- 不做寒暄判断、语义改写、名词化或标题专用模型调用。
- 存储保留合法全标题；tab 和列表的视觉截断由 CSS 负责。

### 5.3 展示

`resolveAgentSessionTitle` 不接受 `terminalTitle`。无 `sessionTitle` 时，主标题使用
“智能体名称 · 项目短名”；调用点必须传 `projectRootPath` 或 `cwd`。OSC 仅可作为经
截断的终端 tooltip 元数据。

## 6. 明确禁止的反模式

- 从标题反推 `sessionId`、父子关系或命令目标。
- 让子会话的 `PromptSubmit`、工具细节或会话号改写面板主会话。
- main 与聚合器各写一套主/子会话判据。
- 写入被拒后把尝试值水合进运行投影。
- 只按 `panelId` 持久化标题而不记录会话作用域。
- 用 `string.length` 或 `slice(0, 120)` 实现码点上限。
- 恢复 OSC/cwd 全文作为产品主标题。
- 恢复 `titleArgs`、精修进程或标题专用模型调用。
- 为四个改名入口分别实现校验、弹窗或错误反馈。
- 把 provider transcript 做成宿主公共存储、索引或回放能力。

## 7. 最小实施方案

1. 为终端 session 状态增加 `sessionTitleSessionId`，持久化写入返回磁盘最终真值。
2. 在 `SessionStart` 上统一执行标题作用域对账。
3. main 旁路与前台活动聚合器共同消费 `isSubagentHookEvent`；子会话只保留
   `SubagentStart` / `SubagentStop` 计数和必要的结束清理。
4. 把 schema、归一化和 hook 截断改为 Unicode 码点语义，提升 hook 世代。
5. 补齐终端内容菜单改名入口，并由治理测试锁定四入口。
6. 按职责拆分超过 500 行的相关模块，不调整文件大小门禁。

## 8. 需求到证据的验收矩阵

| 需求 | 代码证据 | 测试证据 |
| --- | --- | --- |
| 来源秩唯一 | `agent-session-title/precedence.ts` | `agent-session-title.test.ts`、治理测试 |
| Unicode 120 码点 | `agent-session-title/schema.ts`、`normalize.ts`、`hooks-title-script.ts` | `agent-session-title.test.ts`、hook 同构测试 |
| 标题按会话绑定 | `terminal-session-state-schemas.ts`、`terminal-session-title.ts` | `main/terminal-session-state.test.ts` |
| 写入冲突回到持久化真值 | `session-title/write.ts`、`ipc/terminal.ts` | `main/terminal-session-state.test.ts`、聚合器测试 |
| 子会话不污染面板主行 | `agent-session-actor.ts`、`foreground-activity/aggregator.ts`、`ipc/foreground-activity.ts` | `main/foreground-activity-aggregator.test.ts` |
| provider 标题不猜 owner | `transcript-title-routing.ts`、Claude 适配器 | `main/claude-transcript-reconciler.test.ts`、治理测试 |
| 四个改名入口同门面 | `register-actions.ts`、`activity-row.tsx`、`rename-agent-session.ts` | 治理测试、`activity-widget.test.tsx` |
| UI 单源且不读 OSC | `resolveAgentSessionTitle` 及调用点 | 治理测试、组件测试 |
| 模块边界和文件规模 | 拆分后的标题、聚合器、文件迁移辅助模块 | `pnpm check:static` |

## 9. 验证命令

```bash
pnpm check
```

`pnpm check` 依次执行静态检查、单元测试、组件测试和集成测试。局部开发可先跑标题相关
测试，但交付标准是全量命令通过。
