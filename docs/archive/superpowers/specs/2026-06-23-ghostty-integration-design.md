# Ghostty 终端集成设计

> 状态：历史方案，输入路由部分已废弃。
> 当前实现以 `TerminalInputRoutingSnapshot`、Web overlay rect 和 native
> per-surface `hostKeyboardActive`/`cursorSuppressed` 为准；不要再按本文的
> `overlayActive`、`setOverlayActive` 或 `focusTerminal` 路由模型实现新功能。

> 日期: 2026-06-23
> 状态: 已批准，待实现

## 概述

将 Ghostty 终端引擎集成到 Pier，作为 dockview panel 参与布局。采用 EventRouterView 架构：Ghostty NSView 在底层渲染，WKWebView 透明叠加，顶层路由视图分发事件。Web overlay（command palette、dialog 等）自然覆盖在终端上方，零闪烁。

## 方案选型

评估了三种方案：

| 方案 | 核心思路 | 放弃原因 |
|------|---------|---------|
| A. EventRouterView (采用) | Ghostty 底层 + 透明 web + 顶层事件路由 | — |
| B. Ghostty 顶层 + hide | 终端在 WKWebView 上方，overlay 时 hide 终端 | overlay 打开时终端消失，command palette 体验差 |
| C. 独立分区 | 终端和 web 不重叠 | 放弃 dockview tab/split 布局能力 |

## 架构

### NSView 层级

```
NSWindow.contentView
  +-- [底层] Ghostty NSView 容器 (Metal GPU 渲染)
  |     +-- terminal-panel-{id} container
  |     +-- ...
  +-- [中层] WKWebView (isOpaque=false, 终端区域透明)
  +-- [顶层] EventRouterView (不画像素，只做 hitTest 路由)
```

### 进程边界

```
renderer (web)              main (Node.js)           native addon (.node)
  |                           |                          |
  |-- IPC invoke/send ------->|                          |
  |  terminal:setup           |-- setupWindow() -------->| GhosttyBridge.swift
  |  terminal:create          |-- createTerminal() ----->|  EventRouterView
  |  terminal:set-frame       |-- setFrame() ----------->|  TerminalView 管理
  |  terminal:show/hide       |-- show/hide() ---------->|
  |  terminal:close           |-- closeTerminal() ------>|
  |  terminal:focus           |-- focusTerminal() ------>|
  |  terminal:set-overlay     |-- setOverlayActive() --->| EventRouterView.overlayActive
  |                           |                          |
  |<- window.pier.terminal.*  |                          |
  |  (preload bridge)         |                          |
```

### 项目结构新增

```
pier/
  native/                              # 原生模块
    Package.swift                        SPM: libghostty-spm 依赖
    Package.resolved                     锁定版本
    binding.gyp                          node-gyp 配置
    build.sh                             swift build + node-gyp 编译
    Sources/GhosttyBridge/
      GhosttyBridge.swift                终端管理 + EventRouterView
    src/
      addon.mm                           N-API JS<->C ABI 桥接
  src/
    shared/contracts/terminal.ts         TerminalFrame / IPC 类型
    main/ipc/terminal.ts                 terminal IPC handlers
    preload/index.ts                     扩展: terminal API
    renderer/
      panel-kits/terminal/
        terminal-panel.tsx               TerminalPanel (dockview)
      stores/terminal-overlay.store.ts   overlay ref 计数
```

## 原生层

### EventRouterView

完全透明的 NSView，不绘制任何像素，只 override `hitTest:` 做事件路由：

- `targets: [String: Target]` — panelId 到 (rect, view) 映射，随 setFrame IPC 同步更新
- `overlayActive: Bool` — true 时所有事件回归 web 层
- hitTest 逻辑：overlayActive → return nil；点在终端矩形内 → return terminalView.hitTest；否则 → return nil（落到 WKWebView）

AppKit 保证 mouseDown 所在 view 收到后续所有 mouseDragged/mouseUp，所以 dockview sash 拖拽跨越终端区域时不需要特殊处理。

### GhosttyBridge 改造（相对 demo）

| 项 | Demo | Pier |
|---|---|---|
| 终端 z-order | addSubview positioned: .above | positioned: .below relativeTo: wkWebView |
| EventRouterView | 无 | 窗口初始化时创建，positioned: .above |
| WKWebView 透明 | 无 | underPageBackgroundColor = .clear |
| setFrame | 更新 containerView.frame | 同时更新 EventRouterView.targets |
| 新增 API | — | setupWindow(handle), setOverlayActive(active) |

其余（createTerminal, show, hide, close, focus, 坐标转换, sharedController）复用 demo 逻辑。

### addon.mm 导出

```
复用:  createTerminal, setFrame, showTerminal, hideTerminal, closeTerminal, focusTerminal
新增:  setupWindow(handle)        — 初始化 EventRouter + WKWebView 透明
新增:  setOverlayActive(active)   — 切换路由模式
```

### WKWebView 透明

优先公开 API `underPageBackgroundColor = .clear`（macOS 12+）。MACOSX_DEPLOYMENT_TARGET = 13.0（和 libghostty-spm 一致）。WKWebView 实例通过遍历 contentView.subviews 查找。

### 构建流程

沿用 demo 三步流水线：SPM resolve + swift build → staging + rpath fixup → node-gyp rebuild。pier 的 package.json 新增 `build:native` 脚本，`dev` 和 `build` 前置调用。

## IPC 契约

### shared/contracts/terminal.ts

```ts
interface TerminalFrame { x: number; y: number; width: number; height: number }
interface CreateTerminalArgs { panelId: string; frame: TerminalFrame }
interface TerminalAPI {
  setup(): Promise<{ ok: boolean; error?: string }>
  create(args: CreateTerminalArgs): Promise<{ ok: boolean; error?: string }>
  setFrame(panelId: string, frame: TerminalFrame): void
  show(panelId: string): void
  hide(panelId: string): void
  close(panelId: string): Promise<void>
  focus(panelId: string): void
  setOverlayActive(active: boolean): void
}
```

### 通道设计

| 通道 | 传输 | 频率 |
|------|------|------|
| pier:terminal:setup | invoke/handle | 一次/窗口 |
| pier:terminal:create | invoke/handle | 低 |
| pier:terminal:set-frame | send/on | 高 (RAF 节流) |
| pier:terminal:show | send/on | 低 |
| pier:terminal:hide | send/on | 低 |
| pier:terminal:close | invoke/handle | 低 |
| pier:terminal:focus | send/on | 低 |
| pier:terminal:set-overlay | send/on | 低 |

### Preload

`window.pier.terminal` 命名空间挂载 TerminalAPI。高频操作用 send，生命周期操作用 invoke。

### main/ipc/terminal.ts

- native addon 通过 `createRequire` 加载，非 macOS 或加载失败返回 null
- setup handler 用 `BrowserWindow.fromWebContents(event.sender)` 获取窗口，支持多窗口
- setup 调用时机：renderer bootstrap，initTheme 之后

## Renderer 侧

### TerminalPanel

从 demo TerminalPanel 移植，适配 pier panel-kit 规范：

- API 调用: `window.pier.terminal.*`
- anchor div 提供视口坐标 (getBoundingClientRect)
- ResizeObserver + window resize 驱动 setFrame (RAF 节流，drag 时同步)
- onDidVisibilityChange: show / hide（双 RAF 延迟 hide 防闪）
- onDidActiveChange: focus
- cleanup: close
- native 不可用时渲染降级 UI

注册到 panel-registry: `{ terminal: TerminalPanel }`。

### CSS 透明方案

终端 panel 区域成为"透视孔"，Ghostty 从底层透上来：

```
html, body, #root         → background: transparent
.dockview-theme-pier
  .dv-dockview             → background: transparent
  .dv-groupview            → background: transparent
TitleBar                   → bg-sidebar (不透明)
Tab bar                    → --sidebar (不透明)
WelcomePanel / 其他 web panel → bg-background (不透明)
TerminalPanel              → 不设背景 (透明, 透视孔)
.dv-view-container         → background: var(--background) (缝隙区域补色)
```

子像素抗锯齿：macOS Mojave+ 已默认灰度抗锯齿，pier 的 `-webkit-font-smoothing: antialiased` 也用灰度模式，无额外影响。

### Overlay 联动

terminal-overlay.store.ts 提供 ref 计数式 pushOverlay/popOverlay：

```ts
let overlayCount = 0
function pushOverlay(): void {
  if (++overlayCount === 1) window.pier.terminal.setOverlayActive(true)
}
function popOverlay(): void {
  if (--overlayCount === 0) window.pier.terminal.setOverlayActive(false)
}
```

接入 CommandPalette、SettingsDialog 等组件的 onOpenChange 回调。overlay 打开时终端仍然可见（web 层 backdrop 遮罩调暗），只是暂时不可交互。

## 降级策略

| 层 | 条件 | 行为 |
|---|---|---|
| 平台 | process.platform !== "darwin" | loadNativeAddon 返回 null |
| addon | .node 文件不存在 / 加载失败 | catch 返回 null |
| setup | addon.setupWindow 返回 false | IPC 返回 { ok: false } |
| 终端面板 | setup 失败 | 渲染静态提示文案，web panel 正常使用 |

## 多窗口

每个 BrowserWindow 独立调用 setup()，初始化自己的 EventRouterView。terminal:create handler 通过 BrowserWindow.fromWebContents 关联到正确窗口。GhosttyBridge 内部用 NSWindow 指针区分不同窗口。

## 风险

| 风险 | 缓解 |
|------|------|
| Electron 升级改变 contentView 子视图结构 | setup() 降级；WKWebView 查找加日志 |
| libghostty-spm 上游 breaking change | Package.resolved 锁版本；CI build:native |
| 透明合成 GPU 开销 | 仅终端区域透明，非全窗口 |
| hitTest 矩形短暂不同步 | RAF 节流 + drag 同步，延迟 <16ms |

## 不做

- Windows/Linux 终端（后续单独设计，可能走 xterm.js + node-pty）
- 终端配置 UI（走 Ghostty 自身配置文件）
- 终端 session 持久化/恢复
- 多 shell 选择
