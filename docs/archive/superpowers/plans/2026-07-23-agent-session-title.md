# 智能体会话标题实施计划

> **For agentic workers:** 全部阶段已落地。三条硬约束：不要把 OSC 恢复成主标题；
> 不要复活模型精修层（`titleArgs` / `refine-*`）；不要把标题当会话身份用。

**Goal:** 落地 [Agent 会话标题设计](../specs/2026-07-23-agent-session-title-design.md)：
标题是**尽力而为的可读性信号**，会话身份由 `agentId` + 项目路径锚点 + `panelId` +
role（`actorHint` / `parentSessionId`）确定性承担。

**Spec:** [docs/archive/superpowers/specs/2026-07-23-agent-session-title-design.md](../specs/2026-07-23-agent-session-title-design.md)

---

## 第一轮（2026-07 前）：三层 + 全 agent 燃料覆盖

- [x] FA / Index 可选 `sessionTitle` / `sessionTitleSource`；`resolveAgentSessionTitle` 单源
- [x] Agent 主标题停用 OSC（OSC 只做 tooltip）；占位 `catalog · project`
- [x] stdin metadata 抽 `promptSnippet`；`deriveAgentSessionTitleFromPrompt` + `decideAgentSessionTitleWrite`
- [x] session JSON 持久化 + FA panel-slot 投影
- [x] 插件共享 `pierPromptSnippetFrom`；omp / pi / amp / opencode / mimo-code 写 `promptSnippet`
- [x] `pier:terminal:set-session-title` IPC

## 第二轮：删推断层，换确定性实现

判定：删掉的是**推断层**（不确定性来源），不是标题本身。

### P0 身份先行（多 agent 调度的地基，与标题无关）

- [x] **T1** FA 契约补身份字段：`sessionId` / `actorHint` / `parentSessionId` 透传到 `agentActivitySchema`
- [x] **T2** 修地板：`resolveAgentSessionTitle` 调用点必须带路径锚点，placeholder 不再塌成裸 catalog 标签
- [x] **T3** 同名会话经 `disambiguateAgentSessionTitles` 追加序号
- [x] **T4** 活动行展示身份而非只有标题（主行标题 / 副行 agent · 项目 · 子会话归属）

### P1 拆掉推断层

- [x] **T5** 删模型精修：`refine-one-shot` / `refine-scheduler` / `refine-port` / `wire-deps` + 偏好 + 设置行 + i18n
- [x] **T6** 来源枚举去掉 `model`；历史 `auto` / `rule` / `model` 读取期归一为 `prompt`，**永不回写**
- [x] **T7** 规则流水线换确定性截断：删 `rules` / `noise` / `signals`，只留归一 + 首行 + code point 截断
- [x] **T8** compare-and-set 语义显式化：`prompt` 只能写一次，`user` 永远可写
- [x] **T9** 长度上限放宽到 120 code points（`MAX_AGENT_SESSION_TITLE_LENGTH` 唯一来源），显示层 CSS 截断
- [x] **T10** `stripAgentPromptMarkup` 保留为**读取期兼容**，不参与派生
- [x] **T11** `selfHealAgentHooksIfNeeded` 降级为独立诊断；抽不到文案静默落回身份态

### P2 换便宜且准的燃料

- [x] **T12** 消费 provider 自己的标题：新增 `provider` 秩（`prompt` < `provider` < `user`）。
      通路 `transcript-tail-reconciler.ts` 的 `classifyTitleLine` / `onTitleRecord`
      → `applyProviderAgentSessionTitle`。当前只接 Claude 的 `ai-title`；
      `custom-title` / `agent-name` 装的是 Pier 经 `derive-claude-session-title`
      双写回去的 prompt 派生（逐字相同，含 `…` 截断标记），**明确不收**：收下会把
      自己的截断洗成更高的秩，且它们先到会把随后真正的 `ai-title` 永久挡在门外。
      **不起进程、不花 token、不需要 `titleArgs`**；只消费增量区；
      多 owner 且会话号对不上时放弃而非猜；同秩不覆盖，所以每回合重算的 `ai-title` 不会让标题抖。
- [x] **T13** 用户改名升为一等公民：终端右键菜单 / dockview tab / 命令面板 / 活动总览行内，
      四个入口共用 `lib/agent-runtime/rename-agent-session.ts`（同一初值、校验与失败上报）。

### P3 治理固化

- [x] **T14** 治理测试锁死新边界（来源枚举、禁复活模块、禁 `titleArgs`、调用点路径锚点、
      身份字段进无障碍 DOM、provider 秩零成本）
- [x] **T15** `AGENTS.md`「Agent 会话标题与身份（标题 ≠ 身份）」一节 + 本文档同步

### P4 会话边界加固

- [x] **T16** 持久化增加 `sessionTitleSessionId`；`SessionStart` 对账会话作用域，
      新主会话不继承旧标题，历史未绑定标题只在首次可靠会话上补绑定。
- [x] **T17** 写入返回持久化最终真值；低秩写入被拒时，运行投影回读已有高秩标题，
      禁止水合本次尝试值。
- [x] **T18** main 标题旁路与前台活动聚合器共用 `isSubagentHookEvent`；
      子会话详情不再推进面板主会话的状态、身份和标题。
- [x] **T19** 标题上限在 schema、宿主派生和 hook 脚本中统一按 Unicode 码点计算；
      hook 世代提升到 9。
- [x] **T20** 用户改名入口补齐终端内容菜单，并由治理测试锁定
      `terminal/content`、`dockview-tab`、`command-palette` 与活动总览四处入口。
- [x] **T21** 按所有权拆分转录标题路由、前台活动槽位、文件面板迁移账本与错误反馈；
      所有相关文件低于 500 行硬门槛。

---

### 关键路径

| 能力 | 路径 |
| --- | --- |
| 纯函数层入口 | `src/shared/agent-session-title/index.ts` |
| 写入裁决 | `src/shared/agent-session-title/precedence.ts` |
| main 侧编排 | `src/main/services/agents/session-title/index.ts` |
| 落盘 + 广播 | `src/main/services/agents/session-title/write.ts` |
| provider 标题通路 | `integrations/transcript-tail-reconciler.ts` + `transcript-title-routing.ts` + `claude-transcript-reconciler.ts` |
| 持久化 | `setTerminalPanelSessionTitle` in `state/terminal-session-title.ts` |
| 用户改名（四入口共用） | `src/renderer/lib/agent-runtime/rename-agent-session.ts` |
| 插件 prompt 抽取 | `integrations/prompt-snippet-source.ts` |

### 检查点

`tests/unit/agent-session-title-governance.test.ts` ·
`tests/unit/agent-session-title.test.ts` ·
`tests/unit/agent-session-title-hook-parity.test.ts` ·
`tests/unit/main/claude-transcript-reconciler.test.ts` ·
`tests/component/activity-widget.test.tsx`

交付运行 `pnpm check`：它会依次执行静态检查、单元测试、组件测试和集成测试。
