# 终端背景一致（A+B）实施计划

> **For agentic workers:** 按任务顺序执行；终态见  
> `docs/superpowers/specs/2026-07-22-terminal-surface-background-chrome-design.md`。  
> **禁止**再实现 surface → Web COLOR_CHANGE 跟色链路。

**Goal:** Crush/OpenCode 在 Pier 内嵌时内容与底栏无假色缝——agent 继承终端默认底，Pier 状态栏透明。

**Architecture:**

1. **B** — `TerminalStatusBar` 不涂实心底；无 chrome-strip 跟色层。
2. **A** — 集成 install 写入 Crush `options.tui.transparent=true`（unset 时）、OpenCode `tui.json` `theme=system`（安全时）。
3. **不**接 Ghostty COLOR_CHANGE 到 renderer。

**Tech stack:** 既有 agent `transformJsonConfig`、terminal panel kit。

---

## 已完成 / 保持

| 项 | 位置 |
|---|---|
| StatusBar 透明（无 surface prop） | `terminal-status-bar.tsx` |
| 无 chrome-strip 跟色 | `terminal-panel.tsx` |
| Crush transparent 注入 | `crush.ts` + `crush.test.ts` |
| OpenCode system 注入（migration-safe + 损坏 main 跳过） | `opencode.ts` + `opencode.test.ts` |
| Composer pill 产品底 | 既有 composer 单测 |
| per-panel suppress / composer inset 等无关改动 | 按原 PR 保留 |

## 明确不要做

- `TerminalColorChange*` 契约 / channel / preload
- native `setColorChangeForwardCallback` / vendor COLOR_CHANGE → JS
- `terminal-surface-background.store` / contrast helper / hook
- 主题 clear surface overrides

## 验证

```bash
pnpm exec vitest run \
  tests/unit/agent-integrations/crush.test.ts \
  tests/unit/agent-integrations/opencode.test.ts \
  tests/unit/renderer/terminal-composer.test.tsx \
  tests/unit/renderer/terminal-status-bar.test.tsx \
  tests/unit/renderer/stores/theme-store-native-chrome.test.ts \
  tests/unit/renderer/panel-kits/use-terminal-relaunch.test.ts \
  tests/unit/renderer/terminal-layout-coordinator.test.ts \
  tests/unit/terminal-presentation-suppress.test.ts
```

真机：

1. Crush：`transparent=true` 后内容与底栏无 Pier 假色缝  
2. OpenCode：`system` 主题后同上  
3. 普通 shell：状态栏透明，布局 28px 不变  
4. Composer pill 仍是产品底  

**不自动 commit。**
