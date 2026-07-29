# 智能体状态真实轨迹验收实施方案

> **执行要求：** 按任务逐项实施时，使用
> `superpowers:subagent-driven-development` 或
> `superpowers:executing-plans`。步骤用复选框记录。

**目标：** 用实际生产器轨迹闭合 27 个主动集成的 148 项状态维度，并锁定 3 个非主动注册项无状态输出。原 161 项统计误把 `advisory` / `none` 的 `Stop` 计为 `ready`，已废弃。

**架构：** 测试侧独立列举官方原生动作；按传输方式执行实际生产产物；共享观察器只做严格 v3 解析、聚合器摄入以及快照和广播的分离记录。中心治理测试把实际执行覆盖与证据矩阵做严格等集。

**技术栈：** TypeScript、Vitest、Node.js 子进程与临时目录、现有智能体钩子生成器和 `ForegroundActivityAggregator`。

## 全局约束

- 不从证据矩阵或 `runtime.emittedMappings` 生成轨迹夹具。
- 不直接构造规范事件绕过生产器。
- `waiting`、终态、子智能体必须覆盖完整成对路径。
- 无法真实执行的传输必须报告缺口，不得伪造。
- 不执行 Git 写操作。

---

### 任务 1：类型、观察器与红灯覆盖门

**文件：**
- 新增：`tests/unit/agent-integrations/status-traces/status-trace-types.ts`
- 新增：`tests/unit/agent-integrations/status-traces/status-trace-harness.ts`
- 新增：`tests/unit/agent-integrations/agent-status-trace-e2e.test.ts`

**接口：**
- 产出：`AgentStatusTraceFixture`、`runAgentStatusTrace()`、覆盖键计算。

- [ ] 写参数化测试，要求主动智能体集合为 27、覆盖键为 148、非主动负例为 3。
- [ ] 运行测试并确认因轨迹夹具注册表缺失而失败。
- [ ] 实现只识别规范状态检查点的共享观察器，分别记录 `snapshot()` 和 `onChange`。
- [ ] 运行测试，确认仍因提供方轨迹缺失而失败。

### 任务 2：钩子命令真实轨迹

**文件：**
- 新增：`tests/unit/agent-integrations/status-traces/hook-command-traces-a.ts`
- 新增：`tests/unit/agent-integrations/status-traces/hook-command-traces-b.ts`
- 修改：需要复用执行逻辑的现有提供方测试辅助函数

**接口：**
- 输入：`AgentStatusTraceFixture`
- 产出：所有钩子命令主动集成的独立官方形状轨迹。

- [ ] 为每家列举原生动作和检查点，不从生产事件表展开。
- [ ] 执行实际安装产物并读取 JSONL。
- [ ] 每批运行中心测试，确认缺失集合按预期缩小。
- [ ] 补齐 Claude、Codex、Droid、Gemini、Cline、OpenClaude 等现有断链。

### 任务 3：托管插件与转录记录轨迹

**文件：**
- 新增：`tests/unit/agent-integrations/status-traces/hosted-plugin-traces.ts`
- 新增：`tests/unit/agent-integrations/status-traces/transcript-traces.ts`

**接口：**
- 输入：生产插件源码构造器和真实对账器。
- 产出：托管插件、`reconciled` 维度的跨层轨迹。

- [ ] 求值实际生成插件并注入官方事件对象。
- [ ] 对 `waiting`、终态、子智能体执行完整闭环。
- [ ] 转录记录使用真实文件尾读与对账器，不直接构造终态事件。
- [ ] 运行中心测试，达到 27 个主动集成和 148 项覆盖。

### 任务 4：非主动负例和完整验证

**文件：**
- 新增：`tests/unit/agent-integrations/status-traces/inactive-traces.ts`
- 修改：`.superpowers/sdd/2026-07-29-agent-status-correctness/task-5-report.md`
- 修改：`.superpowers/sdd/2026-07-29-agent-status-correctness/progress.md`

**接口：**
- 产出：Aider、Kiro、Crush 的实际无输出证据和最终验收报告。

- [ ] 实际运行三家安装或清理入口，断言没有状态生产器输出。
- [ ] 运行中心轨迹、全部智能体集成、契约、聚合器和矩阵测试。
- [ ] 运行定向 Biome、类型检查、文件大小和 `git diff --check`。
- [ ] 汇总轨迹数、27/148/3 覆盖数、桥接例外和剩余外部门禁。
