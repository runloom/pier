# 透明 web 叠 Ghostty 合成金标准

日期：2026-09-04  
状态：现行权威（桌面窗合成）  
范围：macOS `WebContentsView` 叠在 Ghostty NSView 上时，产品 web 层允许与禁止的合成样式。web 表面整体不透明；终端洞透明、由洞遮罩负责透出 native。  
不包含：窗口缩放时藏 native 的 matte（那是 AppKit 整窗 resize 路径）；焦点路由；滚动条渐隐 mask（见滚动条金标准）。

权威实现：[`packages/ui/src/image-preview/controls.tsx`](../../../packages/ui/src/image-preview/controls.tsx)（预览字号 / 图片 / 画布 zoom 胶囊）；native 洞遮罩 [`native/Sources/GhosttyBridge/TerminalHoleMask.swift`](../../../native/Sources/GhosttyBridge/TerminalHoleMask.swift)；分栏 sash 登记 [`src/renderer/lib/workspace/sash-web-overlays.ts`](../../../src/renderer/lib/workspace/sash-web-overlays.ts)。检查点 [`tests/unit/renderer/app/gpu-compositing-governance.test.ts`](../../../tests/unit/renderer/app/gpu-compositing-governance.test.ts)、[`tests/unit/native/terminal-hole-mask-governance.test.ts`](../../../tests/unit/native/terminal-hole-mask-governance.test.ts)、`native/Tests/GhosttyBridgeTests/TerminalHoleMaskTests.swift`。  
相关先例：`82926809`（终端浮层 `translate3d` 残影）、`cef4c928`（drag-over 半透明色斑）、命令面板 / 设置遮罩禁 `backdrop-blur`、`62b82e2f`（分栏不准藏 native）。

---

## 一句话终态

终端洞必须保持透明，好让 Ghostty 透出来。洞上和洞边的 web 不得再开一层会采样或缓存旧像素的合成层。该实的表面自己铺不透明底并裁切。**终端洞由 native 遮罩硬保证：web 合成层只能在非终端矩形与已登记浮层矩形内出像素，用户内容不可控也不影响终端。** 同时，**web 表面（`WebContentsView` backing）必须整体不透明**：终端透出只由洞遮罩负责，透明 backing 会让 Chromium 的部分重绘保留旧帧像素。

---

## 根因与 hard guarantee（native 洞遮罩）

Chromium 的合成层（`ViewsCompositorSuperview`）覆盖整个窗口，终端 NSView 在它下面。此前产品靠「终端区域 web 输出 alpha=0」的礼貌约定：只要任意 web 内容（尤其是用户 HTML 的 `backdrop-filter`、3D transform、`will-change`）把该区域提升为独立合成层，或 macOS 保留旧层像素，web 就会画在终端上，形成重叠 / 残影。用户 HTML 不可控，不能靠治理测试或注入 CSS 解决。

宿主在 `ViewsCompositorSuperview.layer` 上挂 `CAShapeLayer` mask（`TerminalHoleMask`）做**硬裁**：

1. 遮罩基础路径 = 整个 compositor 窗口矩形；所有 **visible** 终端 viewport 矩形挖成洞（even-odd），web 在洞里一个像素都画不出来。终端矩形先合并相交项，保证 even-odd 不会把重叠交集翻回可见。
2. `webOverlayRects` 与终端 viewport 的交集回填为可见：登记浮层仍能盖在终端上（终端 floating pill、工具提示、上下文菜单、命令面板、dockview 分栏 sash 等）。`webOverlayRects` 是 web 覆盖终端的唯一几何真源。条目带 `paints: false` 的浮层**只参与事件路由**（全屏输入捕获：菜单 / popover 打开期间改道点击、sash / tab 拖拽），不参与回填——它们本身不画像素，整窗矩形若回填会把所有洞抹空。
3. 终端不可见（`visible=false`，如 content preview suppress）→ 不挖洞；没有可见终端 → 移除 mask；`closeAll` / `detachWindow` 清 mask。
4. 坐标：renderer 的 `TerminalFrame` 是 contentView top-left CSS px；合成层未翻转（Electron 43 macOS 实测 `isFlipped=false`），mask 路径用 bottom-left，换算必须做 Y-flip；compositor 重建后由下一次 `applyWindowState` 重新挂上。
5. mask 路径更新必须在 `CATransaction.setDisableActions(true)` 内，避免洞位动画滞后。
6. **压在终端上的产品 chrome 必须登记**：dockview 分栏 sash（`.dv-sash`）跨在相邻终端 viewport 上，由 workspace host（`src/renderer/lib/workspace/sash-web-overlays.ts`）在 layout change、active panel change、sash inline style 位移、DOM 增删时同步登记。登记同时是输入命中真源（点分栏不落到终端）；未登记的产品 chrome 在终端矩形内会被硬裁（2026-11-09 分栏线消失）。dockview 浮组（`.dv-resize-container`）整体是 web 面，必须回填；浮组内含可见终端时只回填标题栏 / tab 条 / 不承载终端的 content 区，终端 body 保持洞——整块回填会抹掉终端自己的洞。composer 自动补全等 body portal 同样必须登记元素几何。
7. **web 表面不透明**：macOS 的 `WebContentsView` backing 使用窗口兜底色（`NATIVE_CHROME_FALLBACK`），主题切换时窗口背景与 web backing 同步（`windowManager.setNativeChromeColor`）。不允许回退到透明 backing。终端可见性已由 mask 硬裁负责；透明 backing 会让 Chromium 的部分重绘（buffer age / partial swap）在未覆盖区域保留旧帧像素。洞遮罩是透出的唯一职责方，web 透明度不是。

遮罩是结构性保证，不是安全边界；它不替代下面的产品源码禁令：登记浮层本身仍会被回填进可见区，`backdrop-filter` / 三维位移的旧层残留风险仍在。

---

## 决策树

1. **终端锚点 / 状态栏透明洞** → 保持透明；不要 `backdrop-filter`、不要三维位移、不要半透明大面积叠在洞上。
2. **预览控件、图片 diff 字幕、Files 正文** → 不透明 `bg-background`（或语义底）；禁止 `backdrop-blur*`。
3. **命令面板 / 设置 / Dialog 遮罩** → 已经禁止 blur；新遮罩抄同一纪律。
4. **分栏 / 浮层改大小** → 只拦输入，**不准藏 native**。窗口边拖拽才走 surface suppress。
5. **必须用被禁样式** → 先改设计；例外只能进治理测试 allowlist，写明为什么不能用不透明底 / 2D `left`/`top`。

---

## 禁止（产品源码）

扫描范围必须包括 `packages/ui/src`、`src/renderer`、`src/plugins/builtin`。只扫 renderer 会漏掉共享控件（2026-09-04 Markdown 预览残影：`ImagePreviewControls` 在 `packages/ui`）。

| 标记 | 为什么 |
|------|--------|
| `backdrop-blur*` / `backdrop-filter:` | 强制独立合成层。Chromium/WebKit 的 backdrop 不采样下层 Ghostty（跨 `WebContentsView` 实测为自身半透明雾），但会跨 iframe 文档边界采样父文档；真正危险的是被提升层的旧像素由 macOS 保留并跨位置复现（`82926809`） |
| `filter: blur()` | 同源：强制独立合成层 |
| `translate3d` / `translateZ` / `transform-gpu` / `will-change: transform` / `backface-visibility` / `perspective()` | 把节点提成 GPU 层；macOS 在 hover / 局部重绘时保留旧层像素（`82926809`） |

2D `translate-x` / `translate-y`（如 TOC `-translate-y-1/2`）不在三维禁令里；新代码仍优先用 `left`/`top`。

---

## 明确不做

- 用 sash 拖拽 `acquireTerminalSurfaceSuppression` 去「盖住」残影
- 给全部 `.dv-content-container` 加 `overflow: hidden` 当万能药（会裁到终端组）
- 把对话框禁 blur 的测试当成全产品覆盖
- 在注释里写 `backdrop-filter:` 冒号形式（治理扫描会当成 CSS）

---

## 复发记录

Markdown 预览字号复用图片 zoom 胶囊，带上 `backdrop-blur-sm`。源码模式不挂该控件所以不闪。治理测试当时只扫 `src/renderer`、只禁三维位移，共享 UI 包漏网。

2026-11-09 Files 预览用户 HTML 的 `backdrop-filter` / `will-change` 造成终端内容重叠。产品源码禁令管不到用户内容；根治是 native 洞遮罩（见「根因与 hard guarantee」）。同时纠正旧表述：跨独立 `WebContentsView` 的 backdrop 不采样下层 Ghostty，危险的是跨 iframe 文档采样与旧合成层像素残留。

同日洞遮罩上线后分栏线消失：`.dv-sash` 压在相邻终端 viewport 内，未登记即被硬裁。修复是 workspace host 登记 sash 几何（登记同时服务输入命中），不是放宽洞几何或给分栏单独开像素通道。

同日 dockview 浮组（Shift 拖 tab 出来）与 composer 自动补全列表压在终端上被整块硬裁：浮组容器与 body portal 都不在 `webOverlayRects`。修复是浮组按「是否含可见终端」分件登记（含终端时只回填标题栏 / tab 条 / 非终端 content，整块回填会抹掉终端自己的洞），自动补全 portal 用共享 registry 登记自身几何并在定位变化后 flush。

同日终端状态栏文字重影（用户 HTML 玻璃页在场时缩放窗口即复现）：截图里同一组 chip 出现两份，旧份与缩放前像素逐点一致，`webContents.invalidate()` 全量重绘可清、随后的局部重绘又复发；摘掉 native mask 后重影仍在。根因不是洞遮罩，而是 `WebContentsView` 用了透明 backing：Chromium 部分重绘（buffer age / partial swap）把新帧透明区域混合在旧帧像素上，旧文字从「状态栏透明底」透出。修复是 web backing 改为不透明兜底色并与窗口背景同步（见 hard guarantee 第 7 条）；终端可见性继续由洞遮罩硬裁，不靠 web 透明度。

同日 web backing 改不透明后，sash 拖拽瞬间终端整块变成兜底色：全屏输入捕获层把整窗矩形登记进 `webOverlayRects`，被洞遮罩当作「web 可绘制区」回填，所有终端洞被减空 → 移除 mask → 不透明 backing 直接盖住终端。修复不是恢复透明 backing，而是把「输入捕获」与「允许绘制」分成两个语义：全屏捕获层以 `paints: false` 登记，只进事件路由；真正绘制的浮层内容（菜单 / popover / toast / sash）仍按元素几何回填（见 hard guarantee 第 2 条）。
