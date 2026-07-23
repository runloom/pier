# Agent sessionTitle Implementation Plan

> **For agentic workers:** P0–P2 landed. Do not re-open OSC as primary title.

**Goal:** 落地 [Agent 会话标题设计](../specs/2026-07-23-agent-session-title-design.md) 全阶段。

**Spec:** [docs/superpowers/specs/2026-07-23-agent-session-title-design.md](../specs/2026-07-23-agent-session-title-design.md)

---

### P0 — UI 单源 + 契约预留

- [x] FA / Index 可选 `sessionTitle` / `sessionTitleSource`
- [x] `resolveAgentSessionTitle` / `agentSessionTitleInput`
- [x] Agent 主标题停用 OSC；占位 `catalog · project`
- [x] Index / close / activity widget 统一 resolver

### P1 — 首条自动命名

- [x] stdin metadata 提取 `promptSnippet`
- [x] `deriveAgentSessionTitleFromPrompt` + `decideAgentSessionTitleWrite`
- [x] session JSON 持久化 + FA panel-slot 投影
- [x] PromptSubmit → auto 写一次；寒暄不命名

### P2 — refine / Claude 双写 / 手改

- [x] 截断标题后台 `refineAgentSessionTitleFromPrompt`（AiService，超时 fail-open；`replaceAuto`）
- [x] Claude `UserPromptSubmit` stdout `hookSpecificOutput.sessionTitle`
- [x] Tab / 命令面板「重命名会话」→ `source: user`
- [x] `pier:terminal:set-session-title` IPC

### P2.5 — 全 Agent PromptSubmit 文案覆盖

- [x] 插件共享 `pierPromptSnippetFrom`（`prompt-snippet-source.ts`）
- [x] omp / pi / amp / opencode / mimo-code PromptSubmit 写 `promptSnippet`
- [x] openclaude `UserPromptSubmit` 复用 Claude dual-write
- [x] 设计文档覆盖矩阵（stdin / plugin / 无 PS 占位-only）

---

### 关键路径

| 能力 | 路径 |
| --- | --- |
| Resolver | `src/shared/agent-session-title.ts` |
| Effects | `src/main/services/agents/agent-session-title-effects.ts` |
| Refine | `src/main/services/agents/agent-session-title-refine.ts` |
| Persist | `setTerminalPanelSessionTitle` in `terminal-session-state.ts` |
| Claude / OpenClaude 双写 | `pierClaudeUserPromptSubmitCommand` in `integrations/shared.ts` |
| 插件 prompt 抽取 | `integrations/prompt-snippet-source.ts` |
