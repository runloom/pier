# 透明 web 叠 Ghostty 合成金标准

日期：2026-09-04  
状态：现行权威（桌面窗合成）  
范围：macOS 透明 `WebContentsView` 叠在 Ghostty NSView 上时，产品 web 层允许与禁止的合成样式。  
不包含：窗口缩放时藏 native 的 matte（那是 AppKit 整窗 resize 路径）；焦点路由；滚动条渐隐 mask（见滚动条金标准）。

权威实现：[`packages/ui/src/image-preview/controls.tsx`](../../../packages/ui/src/image-preview/controls.tsx)（预览字号 / 图片 / 画布 zoom 胶囊）；检查点 [`tests/unit/renderer/app/gpu-compositing-governance.test.ts`](../../../tests/unit/renderer/app/gpu-compositing-governance.test.ts)。  
相关先例：`82926809`（终端浮层 `translate3d` 残影）、`cef4c928`（drag-over 半透明色斑）、命令面板 / 设置遮罩禁 `backdrop-blur`、`62b82e2f`（分栏不准藏 native）。

---

## 一句话终态

终端洞必须保持透明，好让 Ghostty 透出来。洞上和洞边的 web 不得再开一层会采样或缓存旧像素的合成层。该实的表面自己铺不透明底并裁切。

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
| `backdrop-blur*` / `backdrop-filter:` | 采样透明 WebContentsView 后面的 Ghostty，分栏时留下历史残影 |
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
