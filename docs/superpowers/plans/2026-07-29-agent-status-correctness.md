# 智能体状态链路正确性实施方案

## 全局约束

- 以 35 个 `AgentKind` 为全集；每项必须有证据档案和明确接入状态。
- 默认终端交互方式不变，不为获取状态切换到 server、SDK、App Server 或 Gateway。
- 证据不足的单项状态按 `unsupported` 处理，不保留推测映射。
- 当前正式协议按能力检测接入；已证实旧协议保留兼容分支；未知版本只启用安全交集。
- renderer 只消费 `ForegroundActivity`，不得按提供方或工具名补状态。
- 状态观察代码不得返回授权决定或改变智能体行为。
- 生产改动必须测试先行，逐项验证失败后再实现。
- 不提交、不推送、不创建 PR；所有 Git 写操作仍需用户另行授权。

## 任务 1：建立 35 项证据矩阵

- 用类型化单一来源覆盖全部 35 个 `AgentKind`。
- 替换 `full/coarse` 的二档能力声明，逐项记录接入状态、传输面、五态、完成、中断、子智能体的证据等级。
- 证据等级仅允许 `native`、`reconciled`、`unsupported`。
- 记录上游版本或修订、官方证据地址和核验日期。
- 增加等集、无默认补齐、能力声明与事件映射一致性测试。

## 任务 2：实现标准交互事件与作用域状态机

- 保持 v1/v2 读取兼容，新增 v3 发射契约。
- 增加 `InteractionRequested`、`InteractionResolved`、`interactionId`、`interactionKind`、`interactionOutcome`。
- 作用域维护具名交互集合与匿名交互计数；全部解除后才离开 `waiting`。
- 解除等待不得清空活动工具；重新投影为 `tool` 或 `processing`。
- 新回合、可信终态、会话结束清理交互；TTL 仅回收陈旧事实。
- 身份下沉到 `HookScope`；新主会话替换旧作用域；子智能体明细不得污染主状态。

## 任务 3：修正共享字段提取与提供方事件映射

- 扩充各提供方已证实的会话、回合、工具、交互、父子和终态字段。
- 修正 Claude 系、Codex、Gemini、Cursor、Copilot、OpenCode 系、Amp、Droid、OMP、Pi、Hermes、Mistral Vibe 等已审计错误。
- 不假设 fork 与上游同构。
- 无可靠结束信号的 `PreToolUse` 不得产生持久 `tool`。
- 只有真实用户弹窗或主动提问证据可以产生 `waiting`。

## 任务 4：修正安装、探测与升级

- 将受管生成代数从 9 提升到 10。
- 修正 Cline、Droid、Antigravity、OpenCode、MiMo、Mistral Vibe、Rovo 的路径、格式、事件名或命令。
- 安装、升级、卸载只改 Pier 自有条目，保留用户配置。
- Kiro 默认路径无法证明加载时降级，不批量修改用户自定义智能体。
- Ante、Codebuff、Continue 在现有终端模式标为 `current-launch-unsupported`；Rovo、OpenClaw 仅使用不改变启动模式的 hook/plugin。

## 任务 5：补齐真实轨迹与端到端验收

- 每项已支持状态至少一份官方形状载荷，经过配置生成或插件、schema、归并器和前台广播。
- 覆盖并发工具、并发交互、允许、拒绝、取消、恢复、自动重试、压缩、中断、错误、会话替换、迟到事件和主子交错。
- 负例证明不支持的状态不会被推测生成。
- 删除仅镜像当前数组、虚构字段或只断言源码字符串的自证测试。

## 任务 6：完整验证与审查

- 运行相关专项测试、全部 unit/component/integration、typecheck、lint、dependency-cruiser 和文件大小检查。
- 对照 35 项证据矩阵逐项复核实现与测试。
- 做一次整分支架构和代码质量审查，修复阻断问题。
- 最终说明哪些文件和测试证明数据流闭环，以及避免了哪些反模式。
