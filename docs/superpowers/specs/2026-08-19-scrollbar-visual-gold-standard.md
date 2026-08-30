# 滚动条外观金标准

日期：2026-08-19  
状态：现行权威（外观）  
范围：Web 滚动条的颜色、粗细、圆角、轨道、自动隐藏，以及内容渐隐是否盖住滑块。  
不包含：`scrollTop` / `scrollLeft` 意图与单写者（见文件树、Review、Tab 条各自金标准）。

行为收口仍见 [2026-07-29 工作台滚动区域](./2026-07-29-workbench-scroll-viewport-design.md)。**外观以本文为准。**

## 一句话终态

凡是产品滚动条，必须是同一条滑块：同一颜色、同一粗细、同一圆角、同一套「空闲隐藏 / 滚动或槽位悬停显现 / 900ms 隐藏」。槽位策略只决定占不占位。只有关闭清单里的场景可以不同。

## 产品条

| 属性 | 终态 |
|---|---|
| 空闲 | 拇指不可见（`scrollbar-color` 透明） |
| 显现 | 滚动 / 滚轮 / 触控 / 槽位悬停。禁止整容器 hover 当默认 |
| 隐藏 | 停止活动后 900ms（`AUTO_HIDE_SCROLLBAR_IDLE_MS`） |
| 颜色 | 相对 `--background` 的不透明混合，不随侧栏/画布底「染色」。**Markdown 纸面（`data-reading-appearance`）换 token 时必须在该作用域同公式重混**——自定义属性在声明处求值后继承，:root 的拇指值不会跟随纸面（2026-08-28） |
| 粗细 | Chromium `scrollbar-width: thin`。自绘重建跟 `--shell-scrollbar-width-legacy`（测到的 `thin` 槽宽；测不到用 11px） |
| 圆角 | `--shell-scrollbar-radius`（胶囊） |
| 轨道 | 透明 |
| 槽位 | `stable` / `overlay` / `none` 只谈布局 |

禁止再开第五套引擎（Monaco 自绘条、第二套 webkit 主题、按面板手写颜色）。

`--shell-scrollbar-width` 保持 `thin`。标准属性没有像素档；拿掉 `thin` 会退回经典 webkit 槽，设置等 overlay 表面会跳。

## 决策树

1. 工作区持久表面（文件树、源码、Markdown 预览、工作台 host-scroll）→ 产品条 + `stable`
2. 弹层 / 对话框 / 菜单 → 产品条 + `overlay`
3. 卡片 / 物料能用 `ScrollArea` → `ScrollArea`（`type="scroll"`，渐隐在 viewport，条是兄弟）
4. 必须藏条 → 只许 `data-scrollbar="none"`，治理测试白名单写理由
5. 终端正文 → AppKit overlay，不自绘
6. 平移/缩放画布 → 相机 transform 视口 `overflow-hidden`，天然无条（图片查看器仍是 `none`）

## 渐隐

看得见的条：mask / `scroll-fade` 不得盖住拇指。

- `ScrollArea`：渐隐在 viewport，条是兄弟（已正确）
- 原生 overflow 且 `data-scrollbar` 为 `stable` / `overlay`：渐隐 mask **并**一层槽位不透明带（`--shell-scrollbar-gutter-mask` + `mask-composite: add`）。禁止缩小 `mask-size` 或 `mask-clip: content-box`——未遮罩区域会整段透明，滑块消失
- 已 `none`：mask 可以打在滚动容器上（命令面板、大纲细轨）
- 目录树 Shadow：`scrollFadeUnsafeCss(..., spareNativeScrollbar: "inline-end")`

`@pierre/trees` / `@pierre/diffs` 自带 webkit 条不是产品表面。unsafe CSS 必须压住包内 `:hover` 亮条；活动态只靠 `data-scrollbar-scrolling` / `data-scrollbar-hovering`。

## 关闭清单

| 场景 | 允许的样子 |
|---|---|
| Ghostty 终端 | AppKit overlay + `autohidesScrollers` |
| `data-scrollbar="none"` | 无条（命令面板、提及/补全、审查提交选择列表、侧栏壳、面包屑、大纲细轨、通知列表、图片画布） |
| Canvas world 预览台 | 相机 transform + `overflow-hidden` 视口，本就没有滚动条 |
| Markdown 大纲 hover 列表 | `ScrollArea` + fade，藏 Radix 拇指 |
| CodeMirror 小地图 | 独立概览，不是滚动条 |
| Dockview Tab 条 | 颜色 / 圆角对齐产品条；**厚度保持 4px**；显隐沿用 dockview 的条 hover 与拖拇指（滚轮不设 `dv-scrollable-scrolling`，Pier 不得关掉 `:hover` 着色） |
| `forced-colors` | UA `auto` |

## 检查点

- `tests/unit/renderer/styles/scrollbar-visual-governance.test.ts`
- `tests/unit/renderer/styles/dockview-scrollbar-css.test.ts`
- `tests/unit/renderer/app/auto-hide-scrollbar.test.ts`
- `tests/e2e/files/markdown-scrollbar.spec.ts`（`gutter: stable` + `width: thin`）
