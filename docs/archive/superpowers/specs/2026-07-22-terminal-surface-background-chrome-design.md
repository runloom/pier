# 终端面板背景一致：继承终端底（A+B）

- 日期：2026-07-22
- 状态：accepted（相对早期「surface → Web 跟色」草案的修订终态）
- 触发问题：终端面板底栏与 TUI 内容区背景不一致（截图：OpenCode/Crush 自绘底 vs Pier chrome）。

## 1. 结论（先读）

**不**做 surface 默认背景 → Web 状态栏跟色。

主因：

1. OpenCode/OpenTUI **明确不写 OSC 11**（避免毒化 Ghostty 主题探测）。
2. Crush 默认用 Lip Gloss **cell 底**，也不走 default background。
3. 无可靠 OSC 时，用 Pier `--terminal-background` 去「假跟」只会制造第二套实心色缝。
4. 在 Ghostty/Pier 层**禁止** agent 画 cell 背景做不到。

因此产品策略改为：

| 层 | 策略 |
|---|---|
| **A. Agent** | 协商继承宿主终端默认底 |
| **B. Pier chrome** | 状态栏/预留条带**透明**，不发明 Pier 实心 fallback |
| **Native** | container 垫色继续只跟 Pier 主题终端底；**无** COLOR_CHANGE → Web 链路 |

## 2. 目标与完成标准

### 2.1 目标

1. 内嵌 Crush / OpenCode 时，内容区与底栏视觉同属「宿主终端默认底 + 透明 chrome」，无假色缝。
2. 不改状态栏 28px 占位与 `--terminal-content-bottom` 公式。
3. Composer pill 继续产品 `bg-background`（控件壳，不跟 TUI）。
4. 不引入 per-panel surface 色 store / OSC IPC。

### 2.2 完成标准

| 场景 | 期望 |
|---|---|
| Crush 集成 install | 若用户未设 `options.tui.transparent`，写入 `true`；显式 `false` 保留；uninstall 不回滚 |
| OpenCode 集成 install | 若 `tui.json` 未设 `theme` 且不会挡住 legacy 迁移，写入 `system`；已有 theme / 损坏 main / 待迁移 legacy 键则跳过 |
| 无 surface 跟色 | StatusBar **无** `backgroundColor` 内联实心；无 chrome-strip 跟色层 |
| resize matte / placeholder / restored 卡 | 仍用主题 `--terminal-background`（占位/结果卡，不是 live TUI 跟色） |
| 窗口 native chrome | 仍跟 Pier 主题底 |
| 布局 | `statusInsetPx` / content bottom 语义不变 |

### 2.3 非目标

- 不跟随 OSC 11 / `GHOSTTY_ACTION_COLOR_CHANGE` 刷 Web 底栏。
- 不采样像素。
- 不禁止 cell SGR 背景。
- 不把 composer / search 改成跟 TUI 底。
- 不为任意第三方 TUI 保证「任意自定义底 + Pier 底栏同色」——需要该 TUI 自己继承终端底。

## 3. 方案

### 3.1 A — Agent 继承终端底

#### Crush

- 配置：`~/.config/crush/crush.json` → `options.tui.transparent: true`
- 注入点：`withPierCrushTerminalChrome`，在 `installCrushHooks` 中与 hooks 一并 `transformJsonConfig`
- 仅当 `transparent === undefined` 时写入；用户显式 `true`/`false` 不动
- uninstall 只撤 hooks，**不**回滚 transparent（sticky 产品偏好）

#### OpenCode

- 配置：与 `opencode.json` 同目录的 `tui.json` → `theme: "system"`
- `system` 主题用 `none` 继承终端默认底（OpenCode 文档）
- `installOpencodeTerminalChrome`：
  - `tui.json` 已有 `theme` → 不覆盖
  - `tui.json` 不存在且 sibling `opencode.json` 仍有可迁移 `theme`/`keybinds`/`tui` → **不创建** `tui.json`（避免挡住 `migrateTuiConfig`）
  - `opencode.json` 存在但不可解析 → **不创建** `tui.json`
  - 其余安全情况 → 写入 `theme: "system"`
- uninstall 不回滚 theme（sticky）

### 3.2 B — Pier chrome 透明

- `TerminalStatusBar`：不接 surface 色 prop；根节点不设实心 `backgroundColor`
- 不渲染 `terminal-chrome-strip` 跟色垫层
- Composer 保持产品背景（已有单测锁定 `bg-background`）

### 3.3 明确删除 / 不做的路径

以下曾在早期草案出现，**终态不保留**：

- `GHOSTTY_ACTION_COLOR_CHANGE` → N-API → `pier://terminal:color-changed`
- `TerminalColorChangeEvent` / `onColorChange`
- `terminal-surface-background.store` / `useTerminalSurfaceBackground`
- StatusBar / chrome-strip 按 runtime hex 上色
- 主题切换时 `clearAllSurfaceBackgrounds`

## 4. 风险与边界

| 风险 | 处理 |
|---|---|
| 用户关掉 Crush transparent / 自选非 system OpenCode 主题 | 接受可能色差；产品默认推荐继承终端底 |
| 其它 agent 无透明/system 开关 | 逐个加注入或文档说明；不恢复 Web 跟色 |
| 真发 OSC 11 的 shell 主题 | 底栏仍透明，可能与内容 default 底有缝；不在本期范围 |
| sticky 注入 | 有意为之；与 hooks 生命周期分离，文档写明 |

## 5. 测试

- `tests/unit/agent-integrations/crush.test.ts` — transparent 注入 / 保留显式值
- `tests/unit/agent-integrations/opencode.test.ts` — system 注入、legacy 不抢迁移、损坏 main 不建 tui.json
- StatusBar：无 surface prop、无实心 fallback（既有 status bar 单测 + 不引入跟色测试）
- composer pill `bg-background` 单测保留
- 不保留 color-change / surface-background store 单测

## 6. 决策记录

- **弃用** surface → Web 跟色（复杂度高，对 OpenCode/Crush 无效）。
- **采用 A+B**：agent 继承终端底 + Pier chrome 透明。
- OpenCode 注入必须 migration-safe。
- 注入 sticky；uninstall 不回滚外观偏好。
