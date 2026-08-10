# 智能体优先 CLI Canvas 全量改稿计划

> **执行要求：** 本计划仅更新 `.pier/canvases/multi-agent-orchestration-gold/**`。每个行为变化先写失败测试，再修改正式内容；不提交当前脏工作树。

**目标：** 把 Canvas 从“人类运行监督与外部编排器接入”重写为“协调智能体通过 Pier CLI 调用、观察并读取工作智能体内容”，同时保持 Pier 不拥有任务生命周期。

**架构：** Pier 启动的协调智能体是 CLI 的主要调用者；人类和外部控制器是并列的次要调用者。Pier 为每个智能体运行实例注入当前 boot 有效、最小范围的调用凭证，并提供一次性 `invoke`、持久会话 `start/turn`、有界 `screen`、运行事实 `wait/watch` 与精确停止能力。目标、任务分解、重试、结果接受和完成判断始终由调用智能体或外部控制器持有。

**技术栈：** Pier Canvas、React 19、TypeScript 严格模式、相邻 `data.json`、Vitest、Electron + Playwright。

## 全局约束

- `content=closed-loop`、`presentation=primary_nav_5`、`ui=pier-default` 保持不变。
- 首屏唯一主回路必须以“协调智能体”为主调用者；外部控制器只作为可选并列调用方。
- 方案 A：`agents invoke` 直接返回本次调用的结构化回复；持久会话只开放有界当前画面、工作树文件与 Git 变化，不提供完整 transcript、历史索引或回放。
- Pier 不新增多智能体 Run、WorkItem、Attempt、Gate、Result、任务 DAG、任务台账、看板、自动调度或完成权。
- `ready`、`waiting`、一轮结束、终端安静、进程退出和屏幕内容都不是外部任务结果。
- 智能体调用者不能通过 `--as-agent`、panelId、当前焦点或可伪造环境变量自报身份。
- 默认只允许调用者控制自己创建的精确子运行；跨同伴读取、递归调用和提高并发预算必须显式授权。
- closed-loop 阶段严格使用 `{wave,name,outcome,slices:[{id,title}]}`。
- 中文前台不得直出内部状态码或实现词；技术设计表可保留精确命令和类型名。

---

### 任务 1：锁定智能体优先内容契约

**文件：**

- 修改：`contracts.test.ts`
- 修改：`protocol-contracts.test.ts`

**产出：** 新测试约束首屏主调用者、方案 A 内容边界、命令树、调用主体、四步日路径和任务生命周期禁区。

- [x] 先增加失败测试，断言 `scope.model = agent-facing-runtime-control`、`completionAuthority = caller-agent-or-external-controller`。
- [x] 断言首屏图同时包含 `协调智能体`、`工作智能体`、`Pier 智能体 CLI`，且“外部控制器”被标为可选调用者。
- [x] 断言 `agents` 命令至少包含 `self/catalog/list/get/invoke/start/turn/screen/wait/watch/focus/interrupt/terminate`。
- [x] 断言内容策略明确 `invoke` 返回本次回复、`screen` 仅当前可见画面、文件/Git 由调用者读取，并拒绝 transcript/history/replay。
- [x] 断言调用主体至少包含协调智能体、普通工作智能体、人类 CLI、外部控制器。
- [x] 运行专用 Vitest，确认测试因旧内容模型失败，而非语法错误。

### 任务 2：更新数据模型与结构门禁

**文件：**

- 修改：`model.ts`
- 修改：`scope-contract.ts`
- 修改：`contracts.test.ts`

**接口：**

- `SchemeData.data.scope` 改为 `callerOwns`，不再用 `externalOwns` 表示唯一上游。
- 新增允许实体 `AgentCallerCredential` 与 `InvocationReply`。
- 新增所有权层“智能体调用身份”，所有者为 `Pier main AgentCallerService`。

- [x] 修改精确 schema 与 allowlist，使协调智能体能拥有目标分解、调用策略、重试和完成判断。
- [x] 保留跨表边界扫描：任何字段若把任务生命周期、台账、工作看板、自动调度或完成权交给 Pier/宿主/本产品，解析必须失败。
- [x] 增加对 `AgentCallerCredential`、一次性 invocation 和无 transcript 能力的结构断言。
- [x] 运行专用 Vitest 与 Canvas 类型检查，确认模型层全绿。

### 任务 3：全量重写方案内容

**文件：**

- 修改：`data.json`

**产出：** 五页共享的单一内容真源。

- [x] 重写 BLUF、洞见、决策、目标、非目标与成功指标：协调智能体是 CLI 主调用者。
- [x] 重写三项源码调研与能力矩阵：采用 Orca/AO 的 agent-first CLI，采用 cmux 的精确 surface/runtime 身份与有界画面读取；拒绝各自的任务台账、可靠邮箱和完成推断。
- [x] 重写架构、所有权、实体、事实、状态机和闭环：`self → invoke` 与 `start → turn → screen/wait` 两条内容路径并列。
- [x] 重写完整 CLI：智能体高层命令在前，terminal/window/panel/worktree/tasks 为进阶宿主原语。
- [x] 重写调用者身份和最小权限：boot-bound credential、父到新建子、精确 RuntimeRef、深度/并发预算、无 `--as-agent`。
- [x] 重写 Day 1 四步与完整配方：协调智能体先 `self`，再一次性 `invoke`，随后展示持久 `start/turn --include-screen` 路径；所有 prompt 经 stdin/文件传递。
- [x] 重写协作界面样例、五条路径、默认值、实施波次和验收矩阵。
- [x] 运行专用 Vitest，确认所有内容契约通过。

### 任务 4：重构五页呈现与协作原型

**文件：**

- 修改：`overview-sections.tsx`
- 修改：`path-sections.tsx`
- 修改：`multi-agent-orchestration-gold.canvas.tsx`
- 必要时修改：`shared.tsx`、`status-presentation.ts`

**产出：** 首屏在 30 秒内解释“谁调用谁、如何拿到内容、Pier 不拥有什么”。

- [x] 速览页主图改为协调智能体调用工作智能体；外部控制器降为可选入口。
- [x] 问题页把旧误区改为“把人当主调用者、没有结构化一次性回复、持久会话内容来源不清、调用身份不可证明”。
- [x] 设计页优先展示调用者身份、两条内容路径、委派范围和完成权边界。
- [x] 日路径原型改成“协调智能体 + 持久工作智能体 + 当前画面/工作树产物”，一次性回复只返回调用者，不进入协作台。
- [x] 落地页保留阶段与证据矩阵，并确保长表只在自身容器横向滚动。
- [x] 运行组件场景与类型检查。

### 任务 5：真实挂载、视觉检查与最终审计

**文件：**

- 验证：`.pier/canvases/multi-agent-orchestration-gold/**`

- [x] 运行专用契约测试、Canvas 类型检查、组件场景、`git diff --check` 与 Electron 构建。
- [x] 用真实 Electron + Playwright 打开五个页签，检查控制台、页面错误、Mermaid 与状态文案。
- [x] 检查 492px Canvas 面板下五页均无页面级横向溢出，主图可读。
- [x] 搜索旧主叙事：不得仍把“人类 CLI / 外部控制器”写成唯一或主要调用方。
- [x] 搜索边界泄漏：不得出现 Pier 持有任务生命周期、公共 transcript、可靠邮箱或任务完成权。
- [x] 由独立审计者复核需求、CLI、边界、五页一致性和视觉证据。
