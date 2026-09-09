# Canvas Workflow 图 · 设计

- 日期：2026-09-09
- 状态：现行权威（v1：仅 workflow）
- 前置：Canvas 双模式壳（2026-08-26）；FlowGraph 移除（2026-08-30）
- 对照：[archify](https://github.com/tt-a1i/archify) 的 agent 管线（typed IR → 确定性编译 → validate 回执），不复制其 HTML viewer / Share Card / Mermaid 转译

## 1. 定位

Pier 需要一张 **agent 能写对、宿主能画稳** 的交互流程图。作者只写语义 IR（泳道、逻辑列、节点、边、主路径）；宿主编译几何并 fail-closed 校验。这是静态沟通产物，挂在 Files 预览的 `WorldStage` 相机里。

2026-08-30 拆掉的 `FlowGraph` 是 **活图 viewer**（轮询着色、拖节点）。本能力不恢复那些导出名，也不做数据驱动状态色。

与 `recipe=design` 切开：设备外观仍是 `Artboard`；流程图节点是语义卡片，不是 393×852 真机帧。

## 2. 作者契约

根原语 `WorkflowDiagram`，IR 是 TS 对象，仍写在 `.canvas.tsx`：

```ts
type WorkflowEdgeRole = "main" | "branch" | "return" | "error";
type WorkflowNodeKind = "step" | "gate" | "system" | "store" | "external";

interface WorkflowSpec {
  title: string;
  lanes: { id: string; label: string; variant?: "default" | "exception" }[];
  nodes: {
    id: string;
    lane: string;
    col: number;
    label: string;
    detail?: string;
    kind?: WorkflowNodeKind;
    tag?: string;
  }[];
  edges: {
    id: string;
    from: string;
    to: string;
    label: string;
    role?: WorkflowEdgeRole;
  }[];
  mainPath?: string[];
  phases?: { id: string; label: string; fromCol: number; toCol: number }[];
  groups?: {
    id: string;
    label: string;
    lane: string;
    fromCol: number;
    toCol: number;
  }[];
  notes?: { title: string; items: string[] }[];
}
```

- `col` 是逻辑进度 `0..8`，不是像素。
- `id` 匹配 `^[a-zA-Z][a-zA-Z0-9_-]*$`。
- 未写 `role` 视为 `main`。
- 禁止：`x` / `y` / `via` / `labelAt` / `edge.color` / 把 `Layer` 或 `Artboard` 当图节点 / 手写 `Connector` 冒充关系。
- `fromSide` / `toSide` 仅在 diagnostic 点名后、一次只改一个（v1 可不暴露；编译器自选端口）。

VALUE 导出 `validateWorkflowSpec(spec)`。`compileWorkflowLayout` 不导出。

## 3. 校验回执

```ts
interface WorkflowValidateReceipt {
  status: 0 | 1;
  diagnostics: {
    code: string;
    severity: "error" | "warning";
    message: string;
    subject: { nodeId?: string; edgeId?: string; path?: string };
    evidence?: Record<string, string | number>;
    supportedFixes: string[];
  }[];
}
```

结构错误：id 冲突、未知端点、`col` 越界、未知 lane、`mainPath` 相邻无边、主路径列回退、组跨度/空组/同泳道重叠。exception 泳道是恢复带的画法，闸门可以同时写在 `mainPath` 上。

几何错误：边穿过无关节点盒；最后一段短于箭头；箭头扎进节点盒；标签漂离自己的描边或压进节点盒；同一对端点的两条边共用一条竖走廊。过不去就失败，不调用通用自动布局绕障。`supportedFixes` 必须是可执行动作（改 `col`、换 lane、补边）；禁止「删语义标签以过关」。

作者只写 IR。宿主保证：`validateWorkflowSpec` 为 0 时，上述几何门都过了，预览才画图。不保证任意拓扑都好看——过不了就 Empty + 第一条修法。金样与 F1–F5（主路径 + 同列失败/重试）是必须画对的闭集。

编译失败的预览画 `Empty` + 第一条 diagnostic / supportedFix，不画残缺图。

## 4. 编译

不引入第三方路由器。网格：lane → 带顶栏的泳道框，col → 列；`phases` 画在第一泳道上方、跨列；`groups` 画在泳道内、跨列的虚线框。exception 泳道对齐 Archify `c-security-group`：透明底 + warning 虚线框，不用半透明实底（否则折线跨带会变色）。节点可有 `detail` 第二行、`tag` 芯片与 `kind`（step / gate / system / store / external）。图例由已出现的 kind 派生，作者不写色。`notes` 由宿主画在图下，作者不要手写说明 Card。绘制顺序对齐 Archify 单 SVG：泳道/组 → 折线与箭头 → 不透明节点卡（盖住入端）→ 标签。正交肘线，约定三条（对齐 ELK / Graphviz ortho 的最小集）：

1. **最后一段留给箭头。** 入端长度 ≥ stub；箭头方向与最后一段一致。禁止把镖画在短 stub 上。
2. **标签落在最长段上。** 白底胶囊打断描边（knockout）；沿该段滑动以避开泳道/组框边，禁止漂到框上或压进节点盒。
3. **同列回边走 C 形。** error 中线下落；return 从左右边接入上节点（避开主路径中点端口），禁止沿失败线爬回或从底边短 stub 进入。不同列的 return 仍走底侧通道。

所有边同一线宽（1.5px）。主路径与旁路用颜色和线型区分，不加粗。

建议 ≤12 主节点；超过只警告，不硬失败。

## 5. 连线色

作者不写色值。`role` 映射到语义令牌：

| role | 令牌 |
|---|---|
| `main`（默认） | `--chart-1` / `status-info` |
| `branch` | `--muted-foreground`（旁路，不与成功语义抢色） |
| `return` | `--chart-3` / `status-warning` |
| `error` | `--chart-4` / `status-danger` |

箭头、描边、标签边框跟边色；标签文字 `--foreground`。节点卡不写作者色：`kind` 映射到语义表面（闸门 warning 边、系统/存储 muted、外部虚线），图例从已出现的 kind 派生。同一对端点、同一 role 的平行边仍同色，靠标签区分。主路径静止时加粗实线；`branch` / `return` / `error` 另用线型（长划 / 短划），不只靠颜色。折线画在泳道框之上、节点卡之下（Archify `marker-end` 同序）：尖贴端口，卡片盖住入端最后一像素，看起来没有空距。禁止半透明实底盖在折线上。标题对齐第一列节点，字号大于步骤名；步骤名在卡内垂直居中。

## 6. 交互（v1）

只做 hover 整组高亮。不做点击钉住、关系目录、方向演示、键盘选边。

- hover 卡片 N：亮 N + 所有关联边（线 / 箭头 / 标签）+ 对端卡片。亮的卡片用 `box-shadow` 光晕（对齐 Archify `drop-shadow` hover），禁止 `ring-primary`、禁止 `filter: blur()`。
- hover 连线或线上标签：亮该边 + 两端卡片 + 该边标签。
- 其余约 35% 不透明度；离开全部恢复。相关**连线**沿从→到方向做 dash 流动。`prefers-reduced-motion` 时连线保持实线、光晕仍在。

折线用屏幕尺度透明命中区（`vector-effect: non-scaling-stroke`）。图是展示面，卡片与边不进 Tab 序。禁止 `ring-primary`。不得抢走 `WorldStage` 平移缩放。

同一画板可嵌多张图：已在 `WorldStage` 内时 `WorkflowDiagram` 不再包第二层舞台。

## 7. 配方

新增 `recipe=workflow`。不要改 `recipe=design` 去教流程图。架构 / 时序仍用 `Mermaid`。模板 `templates/workflow.canvas.tsx` 是 agent 工具调用金样（对照 Archify gallery 的 IR 与说明卡，不复制其 HTML viewer）：四泳道、阶段、组框、带 tag 的双行节点、主路径穿过策略闸门、证据回写、宿主图例与说明卡，无手机框。

## 8. 非目标

- architecture / sequence / dataflow / lifecycle schema
- 嵌 archify HTML、Share Card、Presentation、WebM、Mermaid 机械转 IR
- Files 预览关系审查工具栏
- `libavoid` / WASM / 通用自动布局作为作者 API 或 v1 求解器
- 复活 `FlowGraph` / `layoutFlowGraph` / `dag-viewer`

## 9. 检查点

- `tests/unit/ui/canvas-workflow/`（validate / compile / geometry）
- `tests/unit/renderer/live-modules/pier-canvas-workflow.test.tsx`（挂载、失败 Empty、hover 整组、连线流动）
- 既有 recipe 闭集、export 四路、bundled 模板挂载
- FlowGraph 禁词治理继续零匹配
