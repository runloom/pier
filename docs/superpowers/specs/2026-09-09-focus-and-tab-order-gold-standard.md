# 焦点与 Tab 序规范 — 金标准

日期：2026-09-09
状态：已确认。本文是桌面工作台 focus 纪律的唯一权威细则；AGENTS.md「焦点与 Tab 序规范」只保留不变量与指针。正文 2026-09-09 自 AGENTS.md 迁入，规则文字不变。

桌面工作台的 focus 纪律：**去掉不该 focus 的脏环；该 focus 的只用产品 `focus-visible` ring。**  
不要为了「干净」全局消灭键盘焦点指示。

硬规则：

1. **鼠标点中不画 UA outline。** 底座在 `src/renderer/app/globals.css`：
   `:focus:not(:focus-visible) { outline: none; }`。禁止依赖 Electron/macOS 系统强调色
   的 `outline: auto` 粗环。
2. **真正可操作控件**（Button / Input / Select / Toggle / 菜单项 / 拖拽把手等）使用
   **`focus-visible:ring-*` + `outline-none`（或等价）**；token 优先 `ring-ring/30~50`，
   禁止用 `ring-primary` 当 focus 铬（主题橙会像脏 focus 环）。
3. **展示型 / 只读表面不进 Tab 序**：图表（`ChartContainer` 默认注入
   `accessibilityLayer={false}`，子节点经 `Children.map`/Fragment 处理）、
   纯展示节点图（无 `onSelectNode`/`editable` 时 `focusable=false`、`role="img"`；
   有选择/编辑合约时节点可键盘聚焦并带产品 `ring-ring`）、
   状态徽标（短标签 + 完整 `aria-label`，不要为 tooltip 硬挂 `tabIndex={0}`）、
   装饰 SVG。hover tooltip / 点击选点仍可用。
4. **业务高亮 ≠ focus。** 短时反馈用轻量 `ring-1 ring-ring/40`（或阴影）；禁止与 focus 环共用 `ring-primary/50` 粗描边。
5. **`tabIndex={0}` 白名单**（产品源码；新增必须在治理测试里登记理由）：
 - 图片预览画布（缩放/平移快捷键）
 - 图片 diff 左右滑动条（`role="slider"`，方向键调整对比比例）
 - dockview panel tab 内容（标签激活）
 - 设置「项目」列表行（`role="button"` 打开项目；须处理 Enter/Space）
 - 任务 applet 卡片/列表行（applet 视图 spec 键盘契约：focus ring；「移动到列」走菜单）
6. **`role="button"` 的非 button 元素**必须同时具备：键盘激活（Enter/Space）、
   `tabIndex={0}`、以及可见的 `focus-visible` 环（或复用已带 ring 的 `Item` 等原语）。
   能改成真正 `<button>` / `Button` 时优先改。
7. 菜单/列表的 `:focus` 背景高亮（Radix roving focus）保留；那是选中态，不是 UA outline。

检查点在 `tests/unit/renderer/app/chart-focus-governance.test.ts`（锁定本节标题、全局
outline 抑制、Chart/DataChart/Mermaid 默认、状态徽标不进 Tab、`tabIndex={0}` 白名单、
禁止 `ring-primary` focus 铬）。
