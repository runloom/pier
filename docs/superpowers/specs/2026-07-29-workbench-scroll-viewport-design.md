# 工作台滚动区域与 viewport 渐隐设计

## 目标与完成标准

工作台卡片需要在圆角壳内稳定呈现固定信息和可滚内容，同时保持滚动条贴近内容区右缘。
本次完成标准如下：

- 每张卡只有一个实际纵向滚动所有者。
- 账号信息和账号切换入口固定，用量指标在独立 viewport 中滚动。
- shadcn `scroll-fade` 只作用于 viewport，不遮罩卡片外壳和滚动条。
- 短滚动区使用更短的渐隐显隐距离：顶部时只显示底部渐隐，中部显示双侧渐隐，底部时只显示顶部渐隐。
- Codex、Claude、Grok 共用同一账号滚动框架。
- 紧凑账号卡只把配额百分比从 `18px` 收敛到 `16px`，标签、账号名、重置时间不得低于现有字号。
- 滚动到底时，最后一个指标与卡片底部保留稳定安全间距：紧凑模式 `12px`，普通模式 `16px`。
- 未迁移的工作台组件继续使用宿主滚动，不发生兼容性变化。

## 当前结构为什么不足

此前宿主 `CardContent` 和账号组件正文都声明了 `overflow-y-auto`，账号根壳又持有水平
内边距。这会形成重复滚动所有权，并把内部滚动条推离卡片边缘。继续使用负边距修正只会
把内容间距、圆角裁切和滚动条几何耦合在一起，无法形成可复用约束。

## 所有权与数据流

- `WorkbenchWidgetCard` 根据注册项 `contentMode` 决定正文行为：
  - `host-scroll`：宿主提供兼容滚动容器和稳定滚动条槽位。
  - `contained`：宿主只负责裁切，组件自行组织固定区与 viewport。
- `external-plugin-context` 负责把外部插件公开注册项的 `contentMode` 原样转换到宿主注册表。
- `AccountWidgetFrame` 负责账号固定区、用量滚动区和密度内边距。
  底部安全间距属于用量滚动内容容器，不属于最后一个指标或 Badge。
- `@pier/ui/scroll-area.tsx` 负责把 `viewportFade` 映射为 shadcn
  `scroll-fade-y` / `scroll-fade-x`，并由 `viewportFadeProfile="short"` 提供受构建系统扫描
  的短滚动区参数；ScrollBar 保持为 viewport 的兄弟节点。
- 各账号插件只提供账号头部内容和用量内容，不再持有滚动策略。

控制流为：

```text
External RendererWorkbenchWidgetRegistration.contentMode
→ external-plugin-context 透传到宿主注册表
→ WorkbenchWidgetCard 选择宿主滚动或 contained
→ AccountWidgetFrame 划分固定区和滚动区
→ ScrollArea 把 viewportFade 和 profile 映射到真正 viewport
→ 浏览器滚动时间线控制边缘渐隐
```

## 禁止的实现

- 宿主和组件同时声明纵向滚动。
- 外部插件适配器重建注册对象时遗漏 `contentMode` 等宿主布局语义。
- 在 Card、ScrollArea Root 或包含滚动条的节点上应用 `scroll-fade`。
- 使用负边距、额外宽度或绝对偏移修正滚动条位置。
- 复制 shadcn `scroll-fade` CSS。
- 在 Tailwind 不扫描的插件源码中直接拼接渐隐参数类名。
- 在三个账号插件中分别维护滚动壳。
- 给最后一个指标或 Badge 单独增加底部外边距。

## 验收证据

| 需求 | 证据 |
|---|---|
| viewport 渐隐为公共能力 | `scroll-area.test.tsx` 验证纵向、横向映射和 DOM 层级 |
| 单一滚动所有权 | `workbench-panel.test.tsx` 验证 `host-scroll` 与 `contained` |
| 外部插件布局语义不丢失 | `external-plugin-workbench-contract.test.ts` 验证 `contentMode` 透传 |
| 三种账号结构一致 | 三个账号组件测试验证固定头部和唯一 ScrollArea |
| 真实几何闭环 | `workbench-canvas.spec.ts` 验证渐隐计算样式、固定头部、贴边误差和横向溢出 |
| 动态渐隐状态 | `workbench-canvas.spec.ts` 验证顶部、中部、底部的渐隐变量 |
| 底部安全间距 | `workbench-canvas.spec.ts` 从真实 Electron 计算样式验证紧凑 `12px`、普通 `16px` |
| 紧凑字号层级 | `account-usage-metrics.test.tsx` 验证紧凑百分比与间距，普通模式保持不变 |
| 后续不回退 | `workbench-scroll-governance.test.ts` 与 `AGENTS.md` |
| 类型和边界闭环 | `pnpm typecheck`、`pnpm depcruise` |

## 滚动条策略（已收口）

产品契约：空闲隐藏拇指；滚动（及 gutter hover）时显示；idle 900ms 自动隐藏；
明确隐藏只走 `data-scrollbar="none"`。

Electron 用标准 `scrollbar-width: thin` + `scrollbar-color`（空闲 transparent →
活动 token）做自动隐藏。不能靠 `::-webkit-scrollbar` 透明拇指：标准属性会覆盖伪元素；
若去掉 `thin` 退回经典 webkit 槽位，设置弹窗等内容区滚动条会位移。webkit 仅作无
`scrollbar-color` 引擎回退。Shadow（目录树）同策略，从而压过 trees 自带 :hover 常显。

| 通道 | 实现 | 备注 |
|------|------|------|
| 原生 light DOM | `globals.css` + `installDocumentAutoHideScrollbars` | 设置页、菜单、CM 等 |
| Shadow（树 / diff） | `scrollbar-system.ts` + 按需 `installAutoHideScrollbar` | 同策略 |
| Radix `ScrollArea` | 默认 `type="scroll"` + 同 idle；竖/横 `ScrollBar` | 禁止默认整容器 hover |
| 终端 | AppKit overlay `autohidesScrollers` | 系统外观，不做 Pier 自绘 overlay |

外观终态（颜色、粗细、渐隐不得盖住滑块、Tab 条皮肤）见
[2026-08-19 滚动条外观金标准](./2026-08-19-scrollbar-visual-gold-standard.md)。
设置页滚动条贴边：DialogContent `pr-0` + `data-scrollbar="overlay"`
（见 `dialog-scrollbar-edge.test.ts`）。
