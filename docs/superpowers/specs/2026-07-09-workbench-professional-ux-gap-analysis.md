# 工作台专业 UX 差距分析与路线图

日期：2026-07-09  
状态：已确认（用户逐节确认于本日会话）  
形式：差距矩阵 + 分阶段路线图（方案 1）  
前置：

- `2026-07-05-dashboard-kit-and-codex-accounts-design.md`（大盘 / 工作台地基）
- `2026-07-06-dashboard-responsive-layout-design.md`（固定格宽 + 窄容器派生）
- `docs/superpowers/plans/2026-07-09-workbench-grid-interaction.md`（默认尊重持久化布局；整理仅显式触发）

## 1. 对标边界

### 1.1 定位

Pier 工作台是本地 AI 工作台里的「活动与资源总览」，不是 BI 报表画布。对标的是
Grafana / Datadog 的**编辑体验与可发现性**，不是 Power BI / Tableau 的查询、筛选、钻取叙事。

### 1.2 学什么

1. **显式模式**：View / Edit（或等价的锁定可见态）一眼可辨；编辑能力不靠「碰巧 hover」。
2. **常驻动作入口**：添加、整理、锁定、刷新至少有一处非右键入口（顶栏或面板 chrome）。
3. **落点诚实**：添加前能预知落点；拖拽占位对比足够；整理后有完成信号。
4. **内容三态闭环**：loading / empty / error（含 stale + retry）；破坏性操作有确认。
5. **密度与数字纪律**：chrome 不挤内容；数字走统一 formatter + `tabular-nums`。

### 1.3 不学什么（明确非目标）

- 全局时间范围、跨卡筛选、钻取 / Explore
- 多选批量排行、widget 分组折叠、复制粘贴到剪贴板
- 浮动层叠布局、多套断点独立持久化
- 为「像 BI」而堆物料种类；目录厚度另开阶段，不塞进本次 UX 差距修复的 P0
- 换掉 RGL / 重做 12 列基准 + 窄容器派生模型（已验证，保留）

### 1.4 文档级成功标准

读完差距矩阵后，任何人能回答：相对 Grafana 编辑态，我们缺的是哪 5–8 条可执行项；
P0 做完后工作台应不再被误判为「功能藏在右键里的 demo」。

## 2. 现状摘要（保留什么）

以下已接近产品级，**本路线图不推倒重来**：

- 12 列基准持久化 + 窄容器 `deriveLayout` 不误写
- 自动整理（`deriveOptimalAutoLayout`）仅显式「整理布局」触发
- 实例模型 v2（`id` / `widgetId` / `params`）、`salvageWorkbenchPanelParams`
- 物料库 Dialog（分类 + 搜索 + preview）结构
- `WidgetErrorBoundary`、可见性停轮询（system stats acquire/release）
- 契约级 `layoutPriority` / `layoutProfiles`、AGENTS 物料 UI 质量红线

短板集中在**编辑体验与内容完成度**，不在换布局引擎。

## 3. 五层差距矩阵

| 层 | 成熟产品基准 | Pier 现状 | 差距（可执行） | 建议阶段 |
| --- | --- | --- | --- | --- |
| **1. 模式** | View/Edit 显式；编辑态才露出编排能力 | 仅有 `params.locked`；无顶栏/角标；未锁定时手柄 hover 才现 | ① 面板级锁定指示（角标或轻量 banner）② 未锁定时常驻轻微 drag/resize affordance（不必等 hover）③ 锁定空态文案与「可添加」语义脱钩 | P0 |
| **2. 画布** | 顶栏「+」；可拖入库到格子；落点强对比；整理有反馈 | 「+」在网格外底部；落点 `primary/10`；整理静默写回；窄容器 `noCompactor` | ① 常驻「添加组件」入口（顶栏或面板 chrome）② 加强拖拽 placeholder 对比 ③ 整理布局轻量完成信号 ④ 文档化：窄容器不压实是有意还是要修 | P0–P1 |
| **3. Chrome** | 菜单可达；Duplicate/Remove 分层；破坏性确认；快捷键可选 | 卡片菜单 hover 才见；移除无 confirm；右键承载过多全局动作 | ① 移除走 `showAppConfirm` + `intent: destructive` ② 菜单在 focus / 触摸下始终可达 ③ 全局动作（锁定/整理/全刷）迁出「仅右键」 | P0 |
| **4. 内容契约** | loading/empty/error/stale+retry；formatter 统一 | 基建有；system-resources 失败可永久 skeleton；部分空态用 `—`；活动 KPI 未 `tabular-nums`；error boundary 英文兜底 | ① system-resources 失败 → WidgetError+重试 ② plugin-disabled / ranking 空 / trend 不足 → 统一 WidgetEmpty ③ 数字与 i18n 补齐 | P0–P1 |
| **5. 组装叙事** | 厚目录、模板、分组、全局筛选 | 库 UI 完整，实质 ~3 个 core；无模板/分组 | ① 库内 disabled 说明（tooltip）② 小屏分类 fallback ③ 物料厚度/模板 **单列后续**，不进本次 P0 | P1–P2 |

**矩阵读法**

- P0 = 「不再像 demo」的最小集合：模式可见、动作可发现、破坏性安全、关键错误态。
- P1 = 画布诚实度与内容红线打满。
- P2 = 目录/模板等产品厚度（另开，避免和 UX 打磨绑死）。

**刻意不进矩阵的项**（避免膨胀）：多选排行、group、Explore、换布局引擎、多断点记忆。

## 4. P0 / P1 / P2 路线图与验收

### 4.1 P0 — 「不再像 demo」

| # | 项 | 验收 |
| --- | --- | --- |
| P0.1 | 锁定态可见 | 锁定时面板有持久视觉指示（角标或轻量条）；空态文案不再暗示「去添加」 |
| P0.2 | 编辑 affordance | 未锁定时 drag handle / SE resize 在非 hover 下仍有可辨识提示（可降透明度，不可全隐） |
| P0.3 | 常驻添加入口 | 非空布局下，「添加组件」不依赖滚到网格底部；至少一处固定入口（顶栏或面板 chrome） |
| P0.4 | 全局动作出口 | 锁定 / 整理布局 / 全部刷新 至少有一处非右键入口（可与 P0.3 同条 chrome） |
| P0.5 | 破坏性确认 | 移除物料走 `showAppConfirm`，`size: "sm"`，`intent: "destructive"` |
| P0.6 | 整理反馈 | 「整理布局」成功后有弱反馈（toast 或短暂布局高亮二选一，避免双反馈） |
| P0.7 | 关键错误态 | system-resources 轮询失败 → `WidgetError` + 重试；error boundary 文案走 i18n |

**P0 完成判据**：新用户未读文档，能在 30 秒内完成「发现可编辑 → 添加一张卡 → 锁定 → 解锁」；不会只靠右键猜功能。

### 4.2 P1 — 画布诚实 + 内容红线

| # | 项 | 验收 |
| --- | --- | --- |
| P1.1 | 落点对比 | 拖拽 placeholder 对比度达到「一眼能辨落点」；组件测试或视觉说明写入实施计划附录即可 |
| P1.2 | 添加落点预期 | 添加前用户能理解新卡大致落在何处（网格内 ghost、next-slot 预览、或添加瞬间高亮——实施计划须三选一写死） |
| P1.3 | 窄容器策略声明 | 文档 + UI 其一：派生视图有轻提示，或确认 `noCompactor` 为有意并写进 AGENTS/注释 |
| P1.4 | 三态打满 | plugin-disabled、ranking 空、trend 数据不足、metric unavailable 统一走 `WidgetEmpty`/`WidgetError`，禁止裸 `—` 当唯一空态 |
| P1.5 | 数字纪律 | 活动 KPI `tabular-nums`；load 等走 `@pier/ui/format`；与 AGENTS 红线一致 |
| P1.6 | a11y 最小集 | drag handle 有 `aria-label`；卡片菜单 focus 可见；库内单实例 disabled 有原因提示；活动行按钮有可达名称 |
| P1.7 | 库小屏 | `md` 以下分类可浏览（chips/tabs），不只靠搜索 |

**P1 完成判据**：对照 AGENTS「物料 UI 质量红线」逐条可勾；键盘/触摸用户不依赖 hover 完成刷新/设置/移除。

### 4.3 P2 — 组装厚度（另开，不阻塞 P0/P1）

| # | 项 | 验收 |
| --- | --- | --- |
| P2.1 | 物料目录 | 至少再有 1–2 个有意义的插件或 core 物料，库不再「只有三张卡」的空壳感 |
| P2.2 | 可选模板 | 空态可一键套用「开发者默认」布局（仍只打开物料库也可保留；模板是增强） |
| P2.3 | 预览逼真度 | 库 preview 与真卡 chrome 差距缩小到「不会误判功能」 |

**P2 明确不做**：全局时间范围、跨卡筛选、多选排行、group、Explore。

## 5. 实施约束

- 不改 12 列基准 + 窄容器派生 + 显式整理 的数据模型。
- 不换 RGL；不引入第二套布局引擎。
- 宿主弹窗 / toast / i18n 规范沿用 `AGENTS.md`（`showAppConfirm`、操作反馈顺序、禁止内联 toast 文案）。
- 每阶段先补组件测试再改 UI；P0.5 对齐 `tests/unit/renderer/app-dialog-governance.test.ts` 检查点。
- 右键菜单可保留为快捷入口，但不得再作为锁定/整理/添加/全刷的**唯一**入口。

## 6. 关键代码锚点（实施时优先改）

| 区域 | 路径 |
| --- | --- |
| 面板壳 / 网格 / 右键 | `src/renderer/panel-kits/workbench/workbench-panel.tsx` |
| 卡片 chrome | `src/renderer/panel-kits/workbench/workbench-widget-card.tsx` |
| 添加入口 | `src/renderer/panel-kits/workbench/workbench-add-card.tsx` |
| 状态写回 | `src/renderer/panel-kits/workbench/use-workbench-panel-state.ts` |
| 物料库 | `src/renderer/panel-kits/workbench/workbench-library-dialog.tsx` |
| 系统资源 | `src/renderer/panel-kits/workbench/core-widgets/system-resources-widget.tsx` |
| 活动总览 | `src/renderer/panel-kits/workbench/core-widgets/activity-widget.tsx` |
| 错误边界 | `src/renderer/panel-kits/workbench/workbench-widget-error-boundary.tsx` |
| 契约 | `src/shared/contracts/workbench.ts` |
| 组件测试 | `tests/component/workbench-panel.test.tsx` |

## 7. 后续

1. 用户审阅本 spec。
2. 通过后用 `writing-plans` 产出 P0 实施计划（建议先只做 P0；P1/P2 各开独立 plan）。
3. 实施时按验收表逐项勾选；不把 P2 物料厚度混进 P0 PR。
