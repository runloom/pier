# 智能体状态可靠性实施计划

> 按已经确认的会话规则实施；不提交、不创建分支、不重启用户的智能体会话。

**目标：** 消除候选结束引起的状态丢失，阻止旧回合结算新工作，并补齐原生输入到状态广播的回归证据。

**规格：** [智能体状态：证据与回合归属](../specs/2026-09-06-agent-status-evidence-gold-standard.md)

**实现：** 继续使用提供方适配器 → `foreground-activity` 归约器 → 快照/广播。只修改已有职责内的判断与测试，不增加服务层。

## 任务 1：候选不能清空当前工作

- [x] 在 `tests/unit/main/panel/turn-status/` 增加工具并发、问答、候选覆盖 panel、TTL 与子智能体交错的失败用例。
- [x] 运行 `pnpm exec vitest run tests/unit/main/panel/turn-status`，确认失败来自已有行为。
- [x] 修改 `turn-bookkeeping.ts`、`hook-scope-projection.ts`、`aggregator-hook-scopes.ts`，保留候选之前的状态、工作与置信期限。
- [x] 更新现有 panel 测试的旧候选预期，运行 `pnpm exec vitest run tests/unit/main/panel`。

## 任务 2：回合归属审查

- [x] 只读审查 `turn-bookkeeping.ts` 的旧回合、无 PromptSubmit 认领与可信终态路径。
- [x] 对确认的越权收尾先写失败用例再修复；保留新回合认领和 transcript 软封兼容用例。
- [x] 运行 panel 回合测试及 `tests/unit/main/agents/transcript` 身份与对账测试。

## 任务 3：完整原生轨迹与覆盖门禁

- [x] 扩充 `tests/unit/agent-integrations/status-traces/`，Kimi 使用真实生成 hook 命令与现代 main wire 记录串联完整会话。
- [x] 补齐 Claude completed、Copilot interrupted、Qoder ready/interrupted，以及 Kimi completed/interrupted/ready/waiting/error 的已声明证据。
- [x] 修改 `agent-status-trace-e2e.test.ts`，缺失的已支持维度必须为空；更新其他提供方候选状态预期。
- [x] 运行 `pnpm exec vitest run tests/unit/agent-integrations/agent-status-trace-e2e.test.ts`。

## 任务 4：治理与验证

- [x] 同步契约注释、历史规则指向与 AGENTS 状态规范。
- [x] 运行受影响的 main、适配器、状态消费者与通知测试；失败只按证据修复。
- [x] 运行主进程类型检查、修改文件 lint、依赖边界、文件大小与目录密度检查，以及 Electron 构建。
- [x] 只读代码复审并修复具体问题；记录实际检查结果与运行中版本仍需更新的边界。

## 复审补充

- 恢复执行记录原生时间下界，旧终态不能结束新工作；同 ID 的迟到 PromptSubmit 只补认主身份，真实异步管线测试确认不会清掉已开始的工具。
- Kimi StopFailure 同样可能来自助手，只触发观察；主失败以当前 main wire 记录确认。覆盖无工具失败、失败先落盘后通知，以及历史失败不能被新观察重新认领。
- 失败终态与完成、中断共用 transcript 去重、上下文退休及旧格式文件水位规则。
- 独立只读复审未发现剩余阻塞问题，复跑 4 个相关测试文件共 38 项通过。

## 验证结果

2026-09-06 最终相关回归：184 个测试文件、2280 项全部通过（110.92 秒）。包括全部原生状态轨迹、Kimi 现代/旧格式记录、共享回合规则、状态栏展示与通知集成。

```sh
pnpm exec vitest run tests/unit/main/agents tests/unit/agent-integrations tests/unit/main/panel tests/unit/renderer/terminal/agent-status-item.test.tsx tests/unit/agent/status-visual.test.ts tests/unit/renderer/agent-runtime/status-semantics-matrix.test.ts tests/unit/renderer/agent/index-display-status.test.ts tests/integration/agent-runtime-index-attention.test.ts --maxWorkers 3 --silent
```

- `pnpm exec tsc --noEmit`：通过。
- `pnpm exec ultracite check`（本次修改的 48 个 TypeScript 文件）：通过。
- `pnpm depcruise`：通过，3366 个模块无依赖越界。
- `pnpm check:file-size`、`pnpm check:dir-density`：通过；保留项目已有软上限提示。
- `pnpm build:electron`：通过，preload 沙箱边界验证通过；构建仍有已有的动态/静态混合 import 提示。
- `git diff --check`：通过。

## 生效边界

源代码与构建验证不会替换运行中进程。使用本次构建的新版 Pier，并重新打开 Kimi 会话后，才能使用更新后的状态逻辑和第 19 代 hook 配置。本次没有重启或中断用户的现有会话。

## 追加修复：Claude 文件晚创建

用户实机截图证明正常回答后仍显示 processing。诊断中 PromptSubmit 在 `10:26:34.225Z` 入账，会话记录文件 birthtime 为 `10:26:34.256459Z`；Stop 被处理前，assistant `end_turn` 已全部落盘。已有测试提前创建文件，遗漏了这一启动顺序。

- [x] 先用真实 hook pipeline、Claude 对账器和聚合器复现：无后续 hook / 仅 Stop 两个用例均卡在 processing。
- [x] 复用既有有界 watcher 等待精确路径出现，记录明确缺失时的 Prompt 水位 0，并保留历史过滤与真实路径检查。
- [x] 覆盖注册间隙创建、SessionStart 历史保护、释放、换会话、跨窗迁移和晚创建越界符号链接；81 项重点回归通过。
- [x] 完成共享对账回归、静态检查、构建与独立复审。

独立复审补齐了晚创建目录内符号链接、已有符号链接改指另一文件，以及路径读取期间释放面板的竞争条件。三个用例均先复现失败，再验证修复；路径复用须校验当前真实目标，异步读取后须重新检查 owner 是否仍有效。

追加修复的验证结果：

- 首轮完整相关回归：186 个文件、2291 项通过（116.38 秒）。
- 复审修正后的最终定向回归：21 个文件、213 项通过（19.58 秒），覆盖 Claude、Kimi、共享对账、其他使用方与回合状态。
- `pnpm exec tsc --noEmit`、本次追加修改的 6 个 TypeScript 文件 lint、依赖边界、文件大小、目录密度与 `git diff --check` 均通过。
- 最终 `pnpm build:electron` 通过，preload 沙箱边界验证通过；保留已有构建提示。

本次修复需要运行最新构建的 Pier 才能生效；没有通过重启用户会话验证当前运行中的界面。
