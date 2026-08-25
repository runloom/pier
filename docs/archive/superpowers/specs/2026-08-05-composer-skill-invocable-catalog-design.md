# 增强输入 Skill 可调用目录（L1）

日期：2026-08-05  
状态：**金标准终态**（严格 L1 + 消息开头唤起 + agent 原生 invoke + surface i18n 棘轮）

## 产品句

**增强输入 `/` 列表 = 当前前台智能体 force-invocable 入口（L1）**  
= 磁盘 discovery（managed + unmanaged + user-global）∪ **adapter bundled 内置** ∪ **文档化内建命令**  
≠ 本机全部 SKILL.md，≠ 宿主 Grok skill（L3）。

| 层 | 名称 | 内容 | 增强输入 |
|----|------|------|----------|
| L1 | Invocable | 磁盘可调用 + bundled + 内建命令 | **唯一数据源** |
| L2 | Inventory | 设置台账（含 disabled / not-projected） | 不直接等同 L1 |
| L3 | Host | `~/.grok/skills` 等宿主 skill | **永不**进入 agent `/` |

## 实现锚点

- 合并：`buildComposerSkillSuggestItems`（`composer-skill-suggest.ts`）
- **Per-agent composer surface**：`src/shared/agent-surfaces/<kind>.ts`
  （每个 agent 一份 host 维护的静态能力描述；`index.ts` 只做 registry）
  - `builtinCommands`：文档化 + 文本可组合斜杠命令（`/plan`、`/btw`、
    `/compact`…）；插入永远是字面 `/id`——Codex 的 `$` 只属于 skill
  - `bundledSkills`：不在磁盘 discovery 上的 runtime bundled skill
  - 出口：`getAgentComposerSurface` / `listBuiltinCommands` /
    `listBundledSkills` / `listComposerSurfaceAgentKinds`
  - **不属于** main `integrations/`（hook 安装）或用户设置勾选
- 同 id 优先级：bundled < user-global < unmanaged < managed（磁盘覆盖内置）；
  内建命令按 invokeText 去重，磁盘 skill 同文本时命令让位
- **严格 L1 收录**（避免「Pier 有、agent 不认」）：
  - 磁盘 skill：仅当前 agent 矩阵为 `discoverable` / `duplicate`
  - managed：还须 `enabled === true`（`not-projected` / 关闭 / 无该 agent cell 不进）
  - agent 在矩阵中无 cell 时**不再**倾倒全部 enabled skill，只剩 surface bundled + 命令
  - 命令 / bundled：仍只来自该 kind 的 `agent-surfaces` 白名单
  - skill 插入还须 `skillInvokePrefix(agent) != null`（无 force-invoke 的 agent
    如 aider / amp / crush / 未知 kind 不插 skill 行）
- 列表排序：**内建命令在前、技能在后**，组内按 id 排序
- **i18n（展示 + 过滤）**：
  - 命令：`terminal.composer.commandDesc.<agentKind>.<id>`
  - bundled skill：`terminal.composer.skillDesc.<agentKind>.<id>`
  - surface 内 English 为 fallback；openclaude → claude；kilo 命令回落 opencode
  - 治理：`tests/unit/shared/agent-surfaces-governance.test.ts`
- 插入：**agent 原生 force-invoke 文本**（Claude `/id`，Codex `$id`；命令字面 `/id`）。
  **不**发送 library / `SKILL.md` 绝对路径——业界与 Pier 投影模型都是「按 id
  在 agent skill 根下发现并加载」；路径发送会变成普通读文件，不是 skill 调用。
  Pier 保证列表项在矩阵里为 discoverable（已投影到 `viaRoot`），由 agent 自己加载正文。
- 触发：**仅消息开头**（可选前导空白）的 `/` 打开列表；句中 `use /plan`、换行后
  非整段开头的 `/` 不弹。与 agent TUI「本轮 turn 开头 force-invoke」一致。
  全文 plain prefix（含 chip 投影）为空闲内容才算开头。

## Bundled / 内建命令证据规则

- 仅收录官方文档标明的 runtime bundled / system skill 子集（MVP 小白名单）。
- 内建命令同理：官方文档 / `/help` 证据 + 文本可组合（粘贴 `/cmd [args]` 即生效），
  排除依赖 TUI picker 的交互命令（`/model`、`/login`、`/theme`、`/resume`…）。
- 覆盖面（证据写在各 `agent-surfaces/<kind>.ts` 头注释）：
  claude/openclaude、codex、copilot、gemini、qwen-code、aider、goose、kimi、
  grok、cline、continue、opencode、kilo（继承 opencode + `/review`）、
  codebuddy、cursor、droid。amp / crush 为 palette 驱动（Ctrl+O / Ctrl+P），
  无文本斜杠语法，故意无 surface、无 skill force-invoke 前缀；其余 kind 无证据不收，
  自由输入 `/xxx` 由 Enter 放行直发 PTY 兜底。
- 禁止把 audit-only / 宿主根（含 `~/.grok/skills`）并入 L1。
- 命令/bundled 表扩张时：**同步** en/zh locale + 治理单测（无自动 CLI probe 棘轮；
  证据仍人工写在 surface 头注释，避免假全量镜像）。

## 非目标

- 宿主 slash 语义引擎
- 设置页列表与 `/` 强制同一集合
- 无证据全量镜像每个 agent 内建命令（白名单只收文档化、可组合子集）
- 把 composer surface 塞进 main hook integration 或用户配置
- 把 library 绝对路径当 skill 发送载荷
- 对无 force-invoke 的 agent 伪造 `/skill` 插入
