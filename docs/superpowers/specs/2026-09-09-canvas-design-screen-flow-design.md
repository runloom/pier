# Canvas 设计稿界面流程 · 设计

- 日期：2026-09-09
- 状态：设计背景（v1：鸟瞰连线；不做点击走查）。硬规则见 [`2026-09-10-canvas-workflow-screen-flow-gold-standard.md`](2026-09-10-canvas-workflow-screen-flow-gold-standard.md)
- 前置：Canvas 双模式壳（2026-08-26）；FlowGraph 移除（2026-08-30）；Workflow 图（2026-09-09）
- 对照：[`2026-09-09-canvas-workflow-diagram-design.md`](2026-09-09-canvas-workflow-diagram-design.md) 的作者契约与连线编译；业界鸟瞰对照 Overflow Canvas，不复制其 Prototype / Story 播放器
- 金样作者面：[`resources/system-skills/pier-canvas/templates/design-mockup.canvas.tsx`](../../../resources/system-skills/pier-canvas/templates/design-mockup.canvas.tsx)

## 1. 定位

`recipe=design` 的画板流要让人**缩小到 fit 就能读出用户路径**：从哪一屏开始、点什么到下一屏、失败走哪、在哪结束。

`templates/design-mockup.canvas.tsx` 示范一条上传路径（Library → Done，失败掉到下一行）。`recipe=workflow` 的 `WorkflowDiagram` 示范的是语义卡片流程图，规格已禁止把 `Artboard` 当图节点。设备宽度变体若出现，只作附录，不进 `edges`。

本能力是设计稿上的**说明连线层**：画板仍是真界面，路径写在 typed IR 里，宿主用与 Workflow 图**同一套**正交折线引擎画出来。

不是：

- 把 `recipe=design` 教成流程图配方
- 把 `Artboard` 画成 `WorkflowDiagram` 节点卡
- 复活 `FlowGraph`
- 点击跳屏 / 智能动画 / 变量条件（业界原型播放器；去掉 Pier 后 Figma / 墨刀仍能做 → 不做）

## 2. 关键决定

| 决定 | 选择 | 理由 |
|---|---|---|
| 产品名 | 界面流程；内部 `ScreenFlow` | 避免和 `WorkflowDiagram` 撞名 |
| 配方 | 仍 `recipe=design` | 外观在画板里；路径是画板之间的说明 |
| 作者模型 | 对齐 `workflow.canvas.tsx`：只写 spec，不写像素 | agent 能写对；几何由宿主 fail-closed 编译 |
| 摆放 | 作者继续 `Layer` `x`/`y` 摆画板 | 混尺寸真机帧不是 lane/col 网格；v1 不做自动摆板 |
| 连线 | **调用** `packages/ui/src/canvas-workflow/` 的折线 / 色 / 标签 / 质量门 / 边绘制，禁止复制 SVG | 用户确认：连线参考 workflow 金样的实现 |
| 端口 | 画板**帧**中点端口，不是控件热区 | 与 `routeWorkflowEdge` 的 `port(node, side)` 同构；热区是 v2 |
| 消费 | 鸟瞰 + hover 只抬高相关组 | 不做压暗/隐藏其余；不做钉住、目录、键盘选边 |
| 金样叙事 | 一条任务路径；设备变体不是主叙事 | 三宽度墙降为某一步的可选附录，附录内禁止连线 |

## 3. 作者契约

对齐 `templates/workflow.canvas.tsx`：

1. 只写 TS spec 对象，挂宿主组件。
2. 禁止 `x` / `y` / `via` / `labelAt` / `fromSide` / `edge.color` / 手写 SVG 连线 / 用 `Layer` 当图节点。
3. 先 `validateScreenFlowSpec(spec)`。`status === 1` 时只应用**第一条** `supportedFixes`，再校验。失败不挂残缺图。
4. 用户可见文案改写成用户语言。

根原语 `ScreenFlow`，必须是某个 `WorldStage` 的子节点（已在 world 内，不再包第二层舞台）。画板用既有 `Artboard`，增加稳定 `id`（写到 `data-artboard-id`，不是 DOM `id`，也不是给人看的 `label`）。

```ts
type ScreenFlowEdgeRole = WorkflowEdgeRole; // "main" | "branch" | "return" | "error"

interface ScreenFlowEdge {
  id: string;
  from: string; // Artboard.id
  to: string;
  label: string; // 用户动作：「点 Upload」。可空。
  role?: ScreenFlowEdgeRole;
}

interface ScreenFlowSpec {
  title: string;
  edges: readonly ScreenFlowEdge[];
  mainPath?: readonly string[];
  start?: string; // 省略则 mainPath[0]，再否则第一条边的 from
}

interface ScreenFlowProps {
  spec: ScreenFlowSpec;
  className?: string;
}
```

`id` 匹配 `WORKFLOW_ID_PATTERN`。未写 `role` 视为 `main`。`mainPath` 相邻必须有边。一块画板可作多条边的端点；起始旗每板最多一个。

v1 **不**提供：`lanes` / `col` / `kind` / `phases` / 宿主 `notes` 卡 / 菱形闸门层。判断只靠边上的 `role` + 文案。设备变体是另几块 `Artboard`，不进 `edges`。

金样结构：

```text
WorldStage
├─ Layer(40,40)     Artboard id=library  S1 phone height=560
├─ Layer(641,40)    Artboard id=detail   S2
├─ Layer(1234,40)   Artboard id=confirm  S3
├─ Layer(1827,40)   Artboard id=success  S4
├─ Layer(1234,820)  Artboard id=blocked  S3b（失败，S3 正下方）
├─ Layer(40,820)    说明便签
└─ ScreenFlow spec={ library→detail→confirm→success; confirm--error-->blocked; blocked--return-->confirm }
```

阅读方向：主路径从左到右；失败掉到下一行。Layer 坐标必须让 `layoutQualityDiagnostics` 为 0——过不了就改间距，不上自动绕障。可选附录：S1 下再放同一界面的 desktop 帧，**不**连线。

## 4. 连线：复用 Workflow 实现（硬约束）

禁止第二套折线、贝塞尔面条、作者描点。Workflow 金样能画对的边，界面流程必须看起来是同一支笔。

### 4.1 直接调用，禁止复制

| 能力 | 单一来源 | 界面流程怎么用 |
|---|---|---|
| 正交路由 | `path.ts` `routeWorkflowEdge` | 画板帧盒当成 `WorkflowNodeLayout` 的 `{id,x,y,w,h}`；`lanes=[]` 时 `laneFloorFor` 已回退到 `node.y+node.h` |
| 端口 / stub / 同列 C 形回边 / 底侧通道 / L 形 | 同上 `port` / `routeSameColumnReturn` / `routeFloor` / `routeL` | 原样。`return` 同列走侧向 C 形；宽画板的向下 `error` 从侧边接入（避开 caption），return 走另一侧。禁止另写路由器 |
| 标签落点 | `workflowLabelAt` + `workflowLabelPaintBox` | `lanes=[]` `groups=[]`，锚在最长段上，胶囊画在描边外侧并避开帧与 caption |
| 箭头 | `geometry.ts` `layoutEdgeArrow` | `WORKFLOW_ARROW_*` 原值；镖在端口，帧盖住入端最后一像素 |
| 质量门 | `quality.ts` `layoutQualityDiagnostics` | 最后一段不够长、标签离描边、标签进盒、箭进盒、同对端点共用竖走廊 → error |
| 穿盒 | `compile-edges.ts` `workflowCrossingDiagnostics` | 边穿过无关画板帧 → error |
| role → 色 / 线宽 | `role.ts` 色令牌；`kind="screens"` 不加虚线 | 主路径实线加粗；error/return 实线 + 色 + 略细。虚线是流程图短距旁路的非色通道，**不是**界面路径的最佳实践 |
| 主路径加重视觉 | `edgeVisual(..., "screens")` | 大画板间距不再被 `sequential < 240` 降成 muted 旁路；与流程图同一支笔（1.8 / 1.4），不加套管 |
| 常量 | `metrics.ts` | 界面路径与流程图同一支笔（主线 1.8、旁路 1.4、镖 10×7）。同排 hop 落在画板中线 0.5；同列 return 落到 0.72，避免穿过 hop |
| hover 闭包 | `highlight.ts` `workflowHighlight` | 边形状与 `WorkflowEdge` 同构，直接传入 |
| 边 SVG | 从 `paint.tsx` 抽出共享 `WorkflowEdges` | polyline + 透明命中区 + `pier-workflow-edge-flow` + 镖多边形 + 白底标签胶囊 |
| 流动动画 | `globals.css` `.pier-workflow-edge-flow` | 原类名；`prefers-reduced-motion` 停流动 |

抽函数，不抽第二份常量：

- `compileWorkflowEdges(nodes, spec.edges, spec.mainPath, lanes, groups, width)`：即今日 `compileWorkflowLayout` 里 115–168 行的边循环。`WorkflowDiagram` 与 `ScreenFlow` 共用。
- `WorkflowEdges`：今日 `paint.tsx` 里 `layout.edges` 的 stroke / flow / hit / arrow / label。节点卡、泳道、阶段、图例、notes **不**进界面流程。

`supportedFixes` 在界面流程里改写为可执行的 Layer 动作（「把 `blocked` 的 Layer 下移」），禁止「删语义标签以过关」。不要改 `quality.ts` 里 workflow 自己的 col/lane 措辞；映射发生在 ScreenFlow 回执层。

### 4.2 画板盒怎么变成节点盒

连线端口打在 `[data-slot="artboard-frame"]`，**不是**整块 `Artboard`（caption 在帧上方，gap 10px）。量的是帧的 border box，相对 `WorldStage` 根的 border box。caption 盒作为障碍物参与路由与标签避让：向下的 error 不得穿过标题行。

`Artboard` 增加可选 `id`。出现在 `ScreenFlowSpec.edges` 里的 id 必须有对应已挂载画板，否则结构校验失败。

测量在 `useLayoutEffect`（ResizeObserver + 画板挂载）。未量齐不画边。量齐后跑 `compileWorkflowEdges` + 质量门；几何失败画 `Empty` 覆盖层（文案与 workflow 同 i18n 键族），不画残缺折线。

### 4.3 绘制顺序与命中

对齐 Workflow 图：折线与箭头 → 不透明画板帧盖住入端 → 标签。

实现：`ScreenFlow` 在 `WorldStage` 内绝对铺满一张 SVG（`inset: 0`）。根 `pointer-events: none`；命中折线 / 标签 `pointer-events: stroke` / `auto`。不得抢走 `WorldStage` 平移缩放，不得挡住画板内按钮。

hover：

- 进入画板（caption 或帧）：抬高该板 + 关联边 + 对端画板
- 进入边或标签：抬高该边 + 两端画板
- **不**把其余元素降到 35% 或不透明度隐藏；未选中保持 idle 全可见
- 热边用与流程图相同的 `.pier-workflow-edge-flow` 沿从→到流动
- 热画板用 `box-shadow` 光晕，禁止 `ring-primary`，禁止 `filter: blur()`
- 画板与边不进 Tab 序

起始旗：宿主画在起始画板 caption 行，info 色，文案为 `spec.title` 或「起点」。不进画板帧内，不伪造 Home 图标。

## 5. 校验

结构（纯 spec，不依赖 DOM）：

- id 冲突 / 不合 `WORKFLOW_ID_PATTERN`
- `from`/`to`/`start`/`mainPath` 引用未声明的画板 id（作者面：spec 里出现的 id 必须在同文件 `Artboard id=` 出现；运行时再对已挂载 DOM 对账）
- `mainPath` 相邻无边
- 平行边同一 `role` 且都无标签

几何（测量后，复用 workflow 质量门）：

- 边穿过无关帧
- 最后一段短于箭头
- 箭尖进帧盒
- 标签离描边或进帧盒
- 同一对端点两条边共用竖走廊

过不了就 `status: 1` + Empty。不调用通用自动布局。不保证任意摆放都好看——金样坐标是必须画对的闭集。

## 6. 配方与教法

- `packs/recipes/design/pack.json`：`primitives` 增加 `ScreenFlow`；`required` 增加路径边。`antiPatterns` 增补：手写 SVG 连线；用 `WorkflowDiagram` 画界面路径；把三设备并排当成路径；在设备变体之间连线。
- `agentPrompt`：WorldStage + Artboard `id` + Layer 摆放 + `ScreenFlow spec`；`validateScreenFlowSpec`；禁止 `via`/色值；设备变体不进 `edges`。
- `SKILL.md` / `authoring.md`：多屏用户路径仍 `recipe=design` + `ScreenFlow`。审批 / 恢复仍 `recipe=workflow`。架构 / 时序仍 `Mermaid`。
- `templates/workflow.canvas.tsx` 继续是交互流程图金样，不改题。
- `templates/design-mockup.canvas.tsx` 改成 §3 路径金样；说明便签写清「连线由 ScreenFlow 编译，与 workflow 金样同一支笔」。
- 物料 catalog 增加 `ScreenFlow` 行，示例只展示 spec + 两块 Artboard，不贴折线 SVG。

## 7. 非目标

- 点击走查、覆盖层、智能动画、滚动到、语音触发
- 热区（v2：`from: { artboard, anchor }`，量 `data-pier-flow-anchor`）
- 多条命名流程过滤 / 关系目录工具栏
- 菱形闸门层、泳道、col 网格、自动摆板
- `libavoid` / WASM / 力导向
- 复活 `FlowGraph` / `layoutFlowGraph`
- 站点地图、FigJam 便利贴
- 作者 `via` 点或第二套 `Connector` 原语
- Overflow Story / Prototype 三模式切换

## 8. 检查点

- `tests/unit/ui/canvas-workflow/governance.test.ts` 与 `closed-set.test.ts`
- `tests/unit/ui/canvas-workflow/`：抽 `compileWorkflowEdges` 后既有图回归为零差；新增「大矩形节点」（phone 393×852 / desktop 1280×800）路由用例；同列 error + return（对齐 `sameColumnReturnSpec`）
- `tests/unit/renderer/live-modules/pier-canvas-screen-flow.test.tsx`：挂载、未知 id → Empty、几何失败 → Empty、hover 整组、流动 class、不包第二层 WorldStage
- `bundled-pier-canvas-templates`：design-mockup 含 `ScreenFlow`、≥4 个不同步骤 `Artboard id`、含 `role: "error"`、**不含**手写 `<svg>` 连线；三 `preset` 不再作为路径主断言
- 颜色令牌：新文件若只引用 `role.ts` 令牌则不必进 allowlist；禁止新十六进制
- 焦点：边与画板不进 Tab；`tabIndex={0}` 不新增
- GPU 合成：不新增 `translate3d` / `backdrop-filter` / `filter: blur()`
- FlowGraph 禁词治理继续零匹配
- file-size ≤ 500；`packages/ui/src/canvas-workflow/` 保持领域目录，不把边绘制摊回 `packages/ui/src`

## 9. 实现清单

### PR 1 — 抽出共享边编译（行为零差）

- 从 `compile.ts` 抽出 `compileWorkflowEdges`；`compileWorkflowLayout` 改为调用它
- 从 `paint.tsx` 抽出 `WorkflowEdges`（stroke / flow / hit / arrow / label）
- 既有 `tests/unit/ui/canvas-workflow/*` 全绿，不改金样像素约定
- 不暴露给 `pier/canvas` 作者 API

### PR 2 — `ScreenFlow` 原语

- `Artboard` 增加 `id?: string` → `data-artboard-id`
- `validateScreenFlowSpec` + 测量后质量门 + 回执改写 `supportedFixes`
- `pier-canvas-screen-flow.tsx`：world 内覆盖 SVG；失败 Empty；hover 委托
- SDK `core.d.ts` 导出类型 / 组件 / `validateScreenFlowSpec`；`compile*` 不导出
- 导出四路与物料 catalog
- 单测与组件挂载

### PR 3 — 金样与教法

- 重写 `templates/design-mockup.canvas.tsx` 为 §3 路径（Library 主题保留）
- `pack.json` / SKILL / authoring / docs 模板互指
- 质量锚点断言
- 本地复制到 `.pier/canvases/` 走查 fit 全景、hover、相机；验收后删副本

PR 1 ⊥ 可先合。PR 2 依赖 PR 1。PR 3 依赖 PR 2。本期不实现热区与点击播放。
