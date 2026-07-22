# 终端面板跟随 surface 有效背景设计

- 日期：2026-07-22
- 状态：draft
- 相关前作：
  - `docs/superpowers/specs/2026-06-23-ghostty-integration-design.md`
  - `docs/superpowers/plans/2026-07-02-phase2-terminal-status-bar-controls.md`
- 触发问题：终端面板底部状态栏条带使用 Pier 主题底色，而 TUI（如 Crush）通过 OSC 改写了 Ghostty surface 默认背景后，内容区与底栏出现明显色差。

## 1. 目标与完成标准

### 1.1 本期目标

1. 当 surface 的**默认背景**（default background，含 OSC 11 等）变化时，该终端面板的状态栏条带与 native container 垫色跟随同一颜色。
2. 跟随粒度是 **per-panel**，多终端可同时持有不同有效背景。
3. Pier 主题切换后，runtime 覆盖被清除，先回到主题底；若 TUI 仍在并再次改写默认背景，再跟一次。
4. **不改变**状态栏 28px 占位布局语义（继续为状态栏扣 content bottom inset）。
5. 状态栏文字在跟色后仍可读。

### 1.2 完成标准

| 场景 | 期望 |
|---|---|
| TUI 发出默认背景变更（OSC 11 / Ghostty `COLOR_CHANGE` background） | 该 panel 状态栏条带与内容区视觉同色 |
| 同一窗口两个 terminal，TUI 底色不同 | 各自跟各自的有效背景 |
| 切换 Pier 主题 | 所有 panel 清 runtime 覆盖 → 主题底；TUI 再改写则再跟 |
| 关闭 / relaunch panel | 清除该 panel 覆盖，无泄漏 |
| 无 runtime 覆盖 | 状态栏条带用主题 `--terminal-background` |
| resize matte / placeholder / restored 结果卡 | 仍用主题终端底（无活 surface 覆盖时不猜） |
| 窗口级 native chrome（`setNativeChrome`） | 仍跟 Pier 主题底，不跟某个 TUI |
| 布局 | `statusInsetPx` / `--terminal-content-bottom` 语义不变 |

### 1.3 非目标

- 不把状态栏叠到终端内容上（方案 A）。
- 不在 agent/TUI 期间默认隐藏状态栏（方案 C）。
- 不采样 GPU/像素推断背景。
- 不跟随每个 cell 的局部 SGR 背景（仅 default background）。
- 不把 composer / search / floating chrome 改成跟 TUI 底。
- 不改 TUI 自身主题或注入环境变量强迫 TUI 用 Pier 色。

## 2. 现状与缺口

### 2.1 分层导致的色差

当前终端面板：

1. Native Ghostty surface 只覆盖 content 区：`bottom = statusInset(28) + composerInset`。
2. `TerminalStatusBar` 自身**无底色**，绝对定位在 panel 底部 `h-7`。
3. 条带透出的是窗口 native chrome / 主题底（`theme.store` → `applyTheme` → `setNativeChrome(colors.background)`，以及全局 CSS `--terminal-background`）。
4. TUI 改写 surface 默认背景后，**只影响 Ghostty 绘制区**，到不了状态栏条带 → 缝。

### 2.2 Ghostty 已有颜色变更动作，Pier 未接

`ghostty.h`：

```c
GHOSTTY_ACTION_COLOR_CHANGE;
// ghostty_action_color_change_s { kind, r, g, b }
// kind: FOREGROUND=-1, BACKGROUND=-2, CURSOR=-3
```

`TerminalCallbackBridge.handleAction` 今日落入 `default`，仅打日志。  
对照：`SET_TITLE` / `PWD` / `COMMAND_STARTED` 已有完整「bridge → delegate → GhosttyBridge → main → renderer」链路。

### 2.3 Native container 垫色是 window 级

`GhosttyBridge.applyTheme` 把 `terminalBackgrounds[windowId]` 写成主题底，并刷该窗**所有** terminal 的 `containerView.backgroundColor`。  
多 panel 不同 runtime 底时，window 级 map 不够用；垫色应 **per terminal / panelId**。

### 2.4 Renderer 只有全局终端色变量

`theme.store.syncTerminalSurface` 写：

- `--terminal-background`
- `--terminal-foreground`

这是主题级全局量，适合 placeholder / matte / restored 卡；**不能**表示「当前这个 panel 的 surface 有效背景」。

## 3. 方案选择

| 方案 | 结论 |
|---|---|
| A. 状态栏叠在铺满的 native surface 上 | 结构消缝，但挡最后一行；本期不采用 |
| **B. 跟随 surface 默认背景刷状态栏条带 + container 垫色** | **采用**。布局不变；信号源已在 Ghostty |
| C. agent/TUI 时隐藏状态栏 | 只覆盖部分场景，普通 shell 自定义底仍可能有缝 |
| D. 像素采样 | 脆、费、难测；作 B 失效时的远期后备，不进本期 |

**诚实限制**：若某 TUI 只对每个 cell 上 SGR 背景、**从不**改 default background，则 `COLOR_CHANGE` 不触发，B 无法跟色。此类应用若成为主诉，再评估 A 或采样。

## 4. 架构

### 4.1 数据流

```
TUI / OSC 11
  → Ghostty GHOSTTY_ACTION_COLOR_CHANGE (BACKGROUND, r,g,b)
  → TerminalCallbackBridge.handleAction
  → TerminalSurfaceColorChangeDelegate
  → TerminalEventDelegate (持 panelId / lifecycleId / browserWindowId)
  → GhosttyBridge.forwardColorChangeCallback
  → N-API → main IPC
  → webContents 推送 pier:terminal:color-change
  → renderer store 记 panelId → #RRGGBB
  → TerminalStatusBar（或 panel 底垫层）style.backgroundColor
  → 同时 GhosttyBridge 更新该 term.containerView.backgroundColor
```

### 4.2 有效背景优先级（per-panel）

1. 该 panel 最近一次 `kind === "background"` 的 runtime 色  
2. 否则当前主题 `TerminalColors.background`（即 `--terminal-background`）

### 4.3 主题切换与清理

| 事件 | 行为 |
|---|---|
| Pier `applyTheme` / `applyTerminalColors` | 现有路径重推 Ghostty 主题；**清空**全部 panel runtime 背景覆盖；native container 先回到主题底 |
| panel `close` | 删该 panelId 覆盖 |
| panel relaunch（同 id 新 lifecycle） | 清旧覆盖；新 surface 若再改写再写入 |
| 收到非 background 的 COLOR_CHANGE | v1 可忽略（不进 chrome）；契约仍带 kind 便于扩展 |
| 收到 background 但 lifecycleId 不匹配当前 session | 丢弃（防关 panel 竞态） |

窗口级 `setNativeChrome` **继续只吃主题底**，不吃任一 panel 的 runtime 色。

### 4.4 状态栏文字对比度

跟色后不能假定主题 `muted-foreground` 仍可读。

v1 规则（纯函数，可单测）：

- 对有效背景算相对亮度  
- 亮底 → 用深色字 token（接近 `foreground` 在 light 下的可读色，或固定高对比深色）  
- 暗底 → 用浅色字 token  

不强制接 `COLOR_CHANGE` foreground；TUI 默认前景与「选可读字」不一致时，以可读性优先。  
Composer / search 浮层仍用现有 popover/background 语义，不跟 surface。

## 5. 契约与 API

### 5.1 Shared

```ts
// src/shared/contracts/terminal.ts（示意）
export type TerminalColorChangeKind = "background" | "foreground" | "cursor";

export interface TerminalColorChangeEvent {
  panelId: string;
  lifecycleId: string;
  kind: TerminalColorChangeKind;
  /** 规范化 #rrggbb */
  color: string;
}
```

`TerminalAPI` 增加：

```ts
onColorChange(cb: (event: TerminalColorChangeEvent) => void): () => void;
```

颜色规范化：`r,g,b` → 统一小写 `#rrggbb`（与 renderer `normalizeHex` 输出对齐；native 侧拼 hex 时同样小写）。

### 5.2 Native / vendor

1. `TerminalSurfaceViewDelegate.swift` 新增：

```swift
@MainActor
public protocol TerminalSurfaceColorChangeDelegate: TerminalSurfaceViewDelegate {
    func terminalDidChangeColor(kind: TerminalColorKind, color: TerminalRGBColor)
}
```

2. `TerminalCallbackBridge`：`case GHOSTTY_ACTION_COLOR_CHANGE` 解析 `kind/r/g/b` 并回调。  
3. Pier `TerminalEventDelegate` conform 该协议；全局 `forwardColorChangeCallback`。  
4. `createTerminal` 时 container 初始色 = 当前主题底（或该 panel 已有覆盖，若有）。  
5. 收到 background 变更：更新 **该** `term.containerView.backgroundColor`（per-panel map，键 panelId 或 surface id，不再只写 `terminalBackgrounds[windowId]`）。

Vendor 修改落在 `native/Vendor/libghostty-spm/Sources/GhosttyTerminal/**`，风格对齐既有 delegate；若团队要求补丁可回放，再视情况抽 patch（本期以可维护直接改 Sources 为准，与现有 bridge 演进一致）。

### 5.3 Main / preload

- N-API 导出 color-change 订阅（对齐 title/pwd）。  
- main 校验 `lifecycleId` 仍属于该 `panelId` 的活 session 再转发。  
- preload `terminal.onColorChange`。

### 5.4 Renderer

**状态**（倾向挂在现有 terminal 相关 store，避免新全局主题污染）：

```ts
surfaceBackgroundByPanelId: Readonly<Record<string, string>>
```

- 订阅 `onColorChange`：仅 `kind === "background"` 且 hex 合法时写入  
- `close` / relaunch / 主题 apply：删除对应或全部键  
- `TerminalStatusBar` 增加 `surfaceBackground?: string`（由 `terminal-panel` 传入），根节点：

```tsx
style={{
  backgroundColor: surfaceBackground ?? "var(--terminal-background, var(--background))",
  color: readableStatusForeground(surfaceBackground),
}}
```

若希望垫层与 item 解耦：也可在 panel root 底部单独 `h-7` 垫层，状态栏仍透明叠上；**推荐状态栏根节点直接上色**，少一层 DOM。

**不要**把 runtime 色写回全局 `--terminal-background`（会污染其它 panel 的 placeholder/matte）。

## 6. 用户可见行为

| 用户动作 | 可见结果 |
|---|---|
| 在终端开 Crush 等会改默认背景的 TUI | 底栏条带在短时内跟上 TUI 底，缝消失 |
| 退出 TUI（若恢复 default / 主题色） | 若 Ghostty 再发 COLOR_CHANGE → 跟回；若静默恢复仅主题、无事件 → 保持最后一次 runtime 色直到主题切换或 relaunch（见 §7） |
| 开 composer | composer 卡片仍是 Pier chrome；其下状态栏仍跟 surface |
| 多终端不同 TUI | 各 panel 底栏独立 |

## 7. 边界与风险

| 风险 | 处理 |
|---|---|
| TUI 不改 default background，只刷 cell | B 无效；文档与完成标准已标明；真机用 Crush 验证 OSC 路径 |
| TUI 退出不发恢复事件 | v1 可接受「粘住最后 runtime 色」；主题切换 / relaunch 清掉。若内部试用难忍，可加：foreground-activity 从 agent→idle 时清覆盖（可选增强，不进 MVP 必做） |
| 主题 apply 与 COLOR_CHANGE 竞态 | apply 先清 store + 推主题；后到的旧 lifecycle 事件靠 lifecycleId 丢弃 |
| 状态栏对比度 | luminance 选字，单测锁边界亮度 |
| Vendor API 面扩大 | 单一 delegate 方法；kind 枚举与 C 对齐 |
| file-size | bridge/panel 若触顶，事件处理抽小文件 |

## 8. 测试计划

### 8.1 单测

- hex 规范化：`0,0,0` → `#000000`；`255,128,64` → `#ff8040`  
- 有效背景优先级：有 override / 无 override  
- 主题 apply 清空全部 override  
- panel close / lifecycle 不匹配丢弃  
- `readableStatusForeground` 亮底/暗底  
- 契约 zod（若其它 terminal 事件有 zod，则对称加上）

### 8.2 组件 / 集成

- StatusBar 收到 `surfaceBackground` 时根节点 style 含该色  
- 无 prop 时 fallback `var(--terminal-background, …)`

### 8.3 真机烟测（实现后必做）

1. 默认主题 shell：底栏与内容一致（主题底）。  
2. 启动 Crush（或已知发 OSC 11 的 TUI）：底栏跟上，无缝。  
3. 同窗第二终端不跑 TUI：仍主题底。  
4. 切换 Pier 主题：两终端先回主题底；TUI 侧再跟。  
5. 关 TUI panel / relaunch：无残留错误色。  
6. 状态栏 item 在深/浅 TUI 底下均可读、可点。

## 9. 实现切片（供 writing-plans）

1. Vendor：`COLOR_CHANGE` → `TerminalSurfaceColorChangeDelegate`  
2. GhosttyBridge + per-panel container 垫色 + forward callback  
3. N-API / main / preload / shared 契约  
4. Renderer store + 主题/生命周期清理  
5. `TerminalStatusBar` / `terminal-panel` 接线 + 对比度  
6. 单测 + 真机烟测  

不改 status 挂载判定、不改 inset 公式、不改 composer 布局。

## 10. 决策记录

- 采用 B（跟 default background），不采用 A/C。  
- Chrome 跟随仅限：状态栏条带 + 该 terminal native container 垫色。  
- 窗口 native chrome 保持主题底。  
- Runtime 色 per-panel，不写全局 CSS 变量。  
- v1 不采样像素；不强制接 foreground 事件做 chrome。
