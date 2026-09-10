# Canvas 流程图与界面流程金标准

日期：2026-09-10  
状态：现行权威（`WorkflowDiagram` / `ScreenFlow` 作者面与绘制）  
范围：交互流程图与设计稿鸟瞰连线；共享折线引擎、校验回执、hover、导出边界、官方模板。  
不包含：热区、点击走查、混尺寸自动摆板、作者 `via` / `fromSide`；架构 / 时序（仍 `Mermaid`）；已移除的 `FlowGraph`。

设计背景：[`2026-09-09-canvas-workflow-diagram-design.md`](2026-09-09-canvas-workflow-diagram-design.md)、[`2026-09-09-canvas-design-screen-flow-design.md`](2026-09-09-canvas-design-screen-flow-design.md)。

## 一句话终态

作者只写意图 IR。宿主用同一支笔编译正交折线；过不了几何门就画 `Empty` + 第一条可执行修法，不画残缺图。线宽、虚线、悬停不由作者挑选。

## 终态表

| 属性 | 终态 |
|---|---|
| 作者面 | `WorkflowSpec` / `ScreenFlowSpec`。禁止 `x` / `y` / `via` / `labelAt` / `fromSide` / `edge.color` |
| 编译 | `compileWorkflowLayout` / `compileWorkflowEdges` 不进 `pier/canvas` |
| 失败 | `status === 1` 或测量后几何 error → `Empty`，文案 = 第一条诊断 + 第一条 `supportedFixes` |
| 主线 | 1.8px 实线 |
| 旁路 | 1.4px 实线（`branch` / `return` / `error`） |
| 镖 | 10×7（半高 3.5）；尖贴端口 |
| idle | 一律实线。虚线只出现在 exception 泳道框，或 hover 的 `pathLength=1` 短 token |
| hover 流动 | `.pier-workflow-edge-flow`，3.35px，1.2s；不把 idle 描边加粗 |
| hover 组 | 只抬高相关卡 / 边 / 对端；其余保持全可见。空白处或离开整图即清除 |
| 配方 | 审批 / 恢复 = `recipe=workflow` + `WorkflowDiagram`；多屏路径 = `recipe=design` + `ScreenFlow` |

## 硬规则

1. **意图 IR。** 节点进度是 `col` 0..8，不是像素。边只有 `from` / `to` / `label` / 可选 `role`。未写 `role` 视为 `main`。
2. **编译器不是作者 API。** SDK 与 `PIER_CANVAS_*_EXPORT_NAMES` 只暴露组件与 `validate*`。
3. **过不了就停画。** `WorkflowDiagram` 挂载时跑 `validateWorkflowSpec`（含几何）。`ScreenFlow` 先跑结构校验，量齐 `[data-slot="artboard-frame"]` 后再跑质量门与穿盒；未量齐不画边。`ScreenFlow` 必须是某个 `WorldStage` 的直接子节点。
4. **同一支笔。** 界面流程调用 `packages/ui/src/canvas-workflow/` 的路由 / 色 / 标签 / 质量门 / `WorkflowEdges`。禁止第二套贝塞尔面条、套管加粗、或单独的 `.pier-screen-flow-edge-flow` 动画。
5. **修法可执行。** `supportedFixes` 是改 `col`、换泳道、补边、挪 Layer。禁止「删语义标签以过关」。界面流程把内部 `cap_*` 改写成真实画板 id。
6. **不压暗。** 产品只有抬高热组。禁止把其余边降到 35% 作为默认。
7. **展示面。** 卡片、边、画板不进 Tab 序。禁止 `ring-primary`、禁止 `filter: blur()`。不得抢走 `WorldStage` 平移缩放。
8. **官方模板必须先校验。** `templates/workflow.canvas.tsx` 与 `templates/design-mockup.canvas.tsx` 调用对应 `validate*`；设计稿模板禁止手写 `<svg` 连线。

## 必须画对的闭集

下列 IR 必须 `validate*` 为 0，且编译后没有几何错误：

| 样本 | 覆盖 |
|---|---|
| `agentToolCallWorkflowSpec` | Archify gallery 金样：四泳道、阶段、组、闸门、回写 |
| `reviewWorkflowSpec` | 主路径 + 恢复带 |
| `sameColumnReturnSpec` | 同列失败下落 + C 形重试 |
| `designMockupScreenFlowSpec` | Library → Done，失败掉到下一行再返回 |
| 大画板帧（phone 393 宽 / desktop 1280 宽） | 与流程图同一路由器，侧向 error / return 不穿 caption |

不保证任意拓扑都好看。过不了就 `Empty`，不调用通用自动布局。

## 禁止

1. 作者写折线像素、`via`、边色、套管、idle 虚线。
2. 把 `Artboard` 当 `WorkflowDiagram` 节点，或用 `WorkflowDiagram` 画界面路径。
3. 设备宽度变体进 `ScreenFlow` 的 `edges`。
4. 复活 `FlowGraph` / `layoutFlowGraph` / `dag-viewer`。
5. 默认 hover 压暗、点击钉住、关系目录、键盘选边、热区走查。
6. 规格与代码两套线宽（已否决的「套管 + 5px 主线」不得回潮）。

## 不是缺陷

- 智能体绕过 `/pier-canvas`、在 `.canvas.tsx` 里手写装饰 SVG：宿主只拦两个连线原语，不在整文件禁 SVG。
- `recipe=design` 的 Layer 坐标仍由作者摆；重叠或间距不足 120px 时停画，不自动重排。
- 文案语义对不对、路径讲的是不是用户要的故事：技能与模板负责教，引擎不审。

## 检查点

- `tests/unit/ui/canvas-workflow/governance.test.ts`
- `tests/unit/ui/canvas-workflow/closed-set.test.ts`
- `tests/unit/ui/canvas-workflow/`（validate / compile / geometry / quality）
- `tests/unit/renderer/live-modules/pier-canvas-workflow.test.tsx`
- `tests/unit/renderer/live-modules/pier-canvas-screen-flow.test.tsx`
- `tests/component/misc/bundled-pier-canvas-templates.test.tsx`
