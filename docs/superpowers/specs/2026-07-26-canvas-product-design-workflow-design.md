# Canvas 产品技术设计工作流（Plan + DAG 产物 + 文档）

日期：2026-07-26  
状态：**已确认（2026-07-26）** — DAG 产物必做、引擎不做；通用节点图库；dogfood 第一步 = D0  
范围：Live Modules **底座不实现 DAG 引擎**；**必须能产出 DAG 形态 canvas**（dogfood 第一步）；数据与会话约定；目录与分期。  
不含：宿主任务台账 / 自动调度；完整 `pier.canvas` Library UX。

相关：

- Live Modules 规格：[`2026-07-25-live-modules-and-project-components-design.md`](./2026-07-25-live-modules-and-project-components-design.md)
- Live Modules 实施：[`../plans/2026-07-25-live-modules-c-track.md`](../plans/2026-07-25-live-modules-c-track.md)
- 本方案实施任务拆分：[`../plans/2026-07-26-canvas-product-design-workflow.md`](../plans/2026-07-26-canvas-product-design-workflow.md)

---

## 0. 一句话与决策表

### 0.1 一句话

**底座 = 编译预览 + 组件积木 +（可选）通用读写/开会话**；**DAG 是 canvas 产物不是内核子系统**；图交互优先走 **通用节点图画布库**（非 DAG 专用引擎）；**dogfood 第一步就是交付可用的 DAG canvas**（+ 同源数据文件）。

### 0.2 分层（先锁这个，避免再偏）

```text
L3  产物 / 约定（可多套并存，可替换）
    dag.canvas.tsx · todo.canvas.tsx · 设计稿 · 文档
    plan.json（某 skill 的数据约定，非宿主必选服务）

L2  通用积木（扩展面）
    pier/canvas  UI
    通用「节点图」能力（推荐 xyflow 类库，见 §2）
    可选：受控写项目文件 · 打开/聚焦 Agent（无 plan 语义）

L1  Live Modules 底座
    registerRoot · esbuild · 围栏 · watch · pier-live · 挂载
    项目组件 resolve · 多框架入口
    ❌ 不实现 DAG 引擎 / 任务状态机 / 官方 PlanService
```

### 0.3 已拍板

| 点 | 选择 | 理由 |
|---|---|---|
| 内核是否含 DAG 引擎 | **否** | 扩展性；对齐 VS Code webview / Cursor「组件积木 + skill 定形态」 |
| 是否需要 DAG **canvas 产物** | **是，且为 dogfood 第一步** | 自己吃狗粮；可见可迭代的工作流图 |
| 图库定位 | **通用节点图 / diagram 库，不是 DAG-only 库** | 同一套可画架构图、流程图、依赖图、以后看板式节点 |
| 布局算法 | **与渲染解耦**（库负责交互，layout 可换） | dagre/elk/自研分层都可插 |
| 任务数据 | **项目内 JSON（如 plan.json）** 由 L3 约定 | git；非宿主台账 |
| DAG 与 Todo | **同源数据投影** | 禁止两份任务列表 |
| React canvas 依赖围栏 | **默认仍禁任意 npm**；图库需 **白名单或 pier/canvas 再导出** 才能用 | 见 §2.3 |
| dogfood v0 图实现 | **可先自绘分层 SVG** 不挡产物；**v1 上通用图库** | 先有产物，再升级体验 |
| 多框架 smoke | **保留四框架 hello** | 工程回归 |
| scenarios 厚样例 | **可删/迁** | 不挡 L3 dogfood |

### 0.4 非目标

- 宿主全局看板 / SQLite 任务库 / 自动调度  
- canvas 内 `node:fs`  
- 把 xyflow/dagre 做成「只能画任务 DAG」的官方业务壳  
- 用 attention/NCS 驱动 plan status  
- 第一步就上协同白板 / CRDT  

---

## 1. 背景与业界参照（简）

| 系统 | 底座做什么 | 形态谁定 |
|---|---|---|
| VS Code | Webview / Custom Editor / Notebook | 扩展与文件内容 |
| Cursor Canvas | React + 一等组件库 + 编译预览 | Agent + Skill（diagram/table/todo 都是组件组合） |
| Pier（目标） | Live Modules + `pier/canvas` + **项目组件** | Agent + 仓库 canvas 文件；**可引真 UI** |

Pier 相对 Cursor 的差异化仍是：**import 用户项目组件做出接近真品的设计稿**。  
DAG 只是众多产物之一，但是 **本仓库 dogfood 的第一份产物**。

---

## 2. 如何支持 DAG：库选型与接入（本章为本次补齐重点）

### 2.1 问题拆开（三层能力，不要揉成一个「DAG 库」）

| 层 | 职责 | 是否 DAG 专用 |
|---|---|---|
| **A. 图交互画布** | 节点、边、平移缩放、选中、拖拽、自定义 node UI | **否** — 通用 |
| **B. 自动布局** | 给节点算 x/y（分层、力导向、树） | **否** — 算法可插拔；DAG 常用「分层」只是一种 |
| **C. 领域模型** | plan 节点 status/deps/sessionRefs | **是** — 属于 L3 数据约定，不是绘图库 |

**结论：库应该是「通用绘图 / 节点图画布」，不是「DAG 引擎」。**  
DAG 语义 = `plan.json`（或等价数据）+ canvas 里怎么绑到 A/B。

### 2.2 候选库对比

| 方案 | 类型 | 交互编辑 | 包体/复杂度 | 许可证 | 与「通用图」 | 备注 |
|---|---|---|---|---|---|---|
| **@xyflow/react**（React Flow） | 节点图画布 | 强（拖、连、缩放、自定义 node） | 中 | MIT | **高** | 业界主流；架构图/流程/依赖都可 |
| **elkjs** | **仅布局** | 无 | 中偏大（wasm/worker 可选） | EPL-2.0 | 高 | 常与 xyflow 组合；强布局 |
| **@dagrejs/dagre** | **仅布局** | 无 | 小 | MIT | 中 | 分层布局简单；维护活跃度一般 |
| **自研分层布局 + SVG** | 渲染+简布局 | 弱（可逐步加） | 极小 | — | 低～中 | **零依赖**，贴合当前围栏 |
| **Mermaid** | 文本→图 | 弱 | 中 | MIT | 中 | 适合文档静态图，不适合可编辑任务图 |
| **Cytoscape.js** | 通用图可视 | 中～强 | 大 | MIT | 高 | 分析向；React 集成重 |
| **JointJS** | 图编辑 | 强 | 大 / 商业向 | 双许可 | 高 | 偏重，不适合先做进宿主 |
| **d3** | 底层 | 全自制 | 中 | ISC | 高 | 灵活但 Agent 与维护成本高 |

**推荐组合（目标态）：**

```text
@xyflow/react          → 通用节点图画布（交互）
+ 可选 @dagrejs/dagre 或 elkjs 或自研 layeredLayout()
                       → 布局（可替换）
+ plan.json            → 领域数据（L3）
+ pier/canvas          → 节点卡片视觉（Badge/Button 等）
```

**不推荐：** 为 Pier 自研完整图编辑引擎；上 Mermaid 当可编辑工作流主路径；上 JointJS 重方案。

### 2.3 与 Live Modules **围栏** 的硬约束

当前 React canvas（`fence.ts`）：

- 默认 **禁止** bare `node_modules` 包（`react` / `react-dom` / `pier/canvas` 除外）  
- 非 React 框架反而可从项目解析依赖  

因此 **不能** 在未改围栏时于 React canvas 里直接：

```ts
import { ReactFlow } from "@xyflow/react"; // 今日会编译失败
```

**三条合法接入路径：**

| 路径 | 做法 | 优点 | 缺点 | 建议阶段 |
|---|---|---|---|---|
| **P0 零依赖** | canvas 内自绘 SVG + 简单拓扑分层 | 立刻 dogfood；无围栏改动 | 交互弱 | **dogfood 第一步可用** |
| **P1 宿主积木** | 将通用图能力经 `pier/canvas` 再导出（或 `pier/canvas/diagram`） | Agent 写法统一；版本由宿主钉 | 扩大 pier/canvas 表面积；要评估包体 | **推荐正式方案** |
| **P1′ 项目依赖 + 围栏白名单** | 项目装 `@xyflow/react`，fence 允许名单内 bare 包 | 版本跟项目 | 每项目要装；白名单治理 | 备选 |
| **P2 allowNodeModules 全开** | root resolve 放开 | 最灵活 | 信任与包体风险大 | **不作为默认** |

**拍板倾向：**

1. **Dogfood 第一步（本周可做）：P0 自绘 DAG canvas + plan.json** — 证明产物与流程。  
2. **正式图能力（紧随）：P1 引入通用节点图库，经受控通道进入 canvas**（优先 `pier/canvas` 子集或独立 `pier/diagram` 运行时 external，与 React 单例策略一致）。  
3. 布局库（dagre/elk）同样走白名单或自研 `layeredLayout` 纯函数（纯 TS 可放 `shared/` 或 canvas 旁 `lib/`，**不经过 node_modules 也行**）。

### 2.4 「通用绘图库」是否正确？

**是，方向正确，但要说精确一点：**

| 说法 | 判断 |
|---|---|
| 上一个「什么都能画」的自由画板（Excalidraw 级） | v1 **过重**，且和「结构化任务图」不完全同路 |
| 上 **通用节点图（node-edge canvas）** | **正确** — DAG/流程图/架构图/依赖图都是 node+edge |
| 上 **DAG 专用库**（只理解拓扑任务） | **不推荐** — 扩展性差，和「底座不绑 DAG」矛盾 |

所以：  
**库 = 通用 node-based diagram（xyflow 类）**；  
**DAG = 数据与布局策略 + 一份 canvas 用法**，不是第二种引擎。

### 2.5 Agent 如何「产出」DAG canvas

不依赖内核 API「createDag」：

1. Skill / 模板规定：生成 `plan.json` + `dag.canvas.tsx`（import 数据 + 使用图积木）。  
2. 人/Agent 改 JSON 或改 canvas。  
3. Live Modules 热更预览。  

与 Cursor「skill 教 Agent 用组件拼 canvas」同构；Pier 多一步 **可绑项目组件与 plan 文件**。

### 2.6 Dogfood 第一步（明确交付物）

**必须有：**

```text
.pier/plans/canvas-capabilities-v1/
  plan.json              # 节点/deps/status
  dag.canvas.tsx         # 读 plan，渲染依赖图（P0 自绘即可）
  todo.canvas.tsx        # 可选但强烈建议：同源列表
```

**成功标准：**

- 打开 `dag.canvas.tsx` 能看见当前能力切片的依赖图  
- 改 `plan.json` 后图与列表一致  
- **不**要求已接入 xyflow  

**下一步（仍属 L2/L3，非改 L1 语义）：**  
把 `dag.canvas.tsx` 的渲染层换成 xyflow（或 pier 封装），数据层 API 不变。

---

## 3. 目录与产物模型

### 3.1 仓库布局（目标）

```text
.pier/
  canvases/
    smoke/
      hello.canvas.tsx
      hello.canvas.vue
      hello.canvas.svelte
      hello.canvas.solid.tsx
    templates/
      blank.canvas.tsx              # 最小 composition 起稿（可选但建议）
    README.md                       # 说明：此处为工程 smoke + 模板，非产品台账
  plans/
    README.md
    <planId>/
      plan.json                     # 唯一任务图真源
      plan.canvas.tsx               # 唯一入口：Tab = 任务 / 依赖图 / 说明
      docs/                         # 可选：产品/技术文档 canvas
        *.canvas.tsx
      slices/                       # 可选：UI 设计稿切片
        *.canvas.tsx
  preview-exports.ts                # 可选：项目组件预览桶（已有约定）
```

### 3.2 `.pier/canvases` 瘦身策略

| 动作 | 路径 | 说明 |
|---|---|---|
| **保留** | `smoke/*` 四框架 | 编译/挂载回归；测试锚点 |
| **保留或新建** | `templates/blank.canvas.tsx` | AI/人手最小起稿 |
| **删除或迁出** | `scenarios/**`、`stress/**`、厚 `templates/kit|docs-*|composition-*` | 实施 PR 内改测试引用后删除 |
| **不默认删除** | 多框架能力代码（main 侧 vue/svelte/solid） | 与样例文件无关 |

**验收：** `pnpm test` 中 live-modules / project-canvas 相关用例全部指向 smoke（+ blank），无悬空路径。

### 3.3 Plan 目录约定

- `planId`：小写 kebab，稳定，如 `canvas-capabilities-v1`
- 一计划一目录；允许多计划并存
- canvas 通过 **相对 import** 读 `./plan.json`（esbuild JSON loader）
- 写回：见 §5
- **`dag.canvas.tsx` 是一等 dogfood 产物**，不是可有可无的附录

---

## 4. `plan.json` 契约

### 4.1 Schema（v1）

```ts
/** .pier/plans/<planId>/plan.json */
type PlanDocument = {
  version: 1;
  id: string;                 // === planId 目录名
  title: string;
  description?: string;
  updatedAt: string;          // ISO-8601
  nodes: PlanNode[];
  /** 可选显式边；若省略，由 nodes[].deps 推导 */
  edges?: PlanEdge[];
};

type PlanNodeStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

type PlanNode = {
  id: string;                 // 计划内稳定 id，如 "v1a"
  title: string;
  status: PlanNodeStatus;
  /** 前置节点 id 列表 */
  deps: string[];
  notes?: string;
  /** 相关仓库相对路径，供 Agent 上下文 */
  paths?: string[];
  acceptance?: string[];
  /** 文档/设计稿 canvas 相对本 plan 目录的路径 */
  docRefs?: string[];
  sessionRefs?: PlanSessionRef[];
  /** 看板列投影用；缺省由 status 映射 */
  column?: "backlog" | "doing" | "review" | "done";
};

type PlanEdge = {
  from: string;
  to: string;
};

type PlanSessionRef = {
  sessionId: string;
  agentId?: string;
  boundAt: string;            // ISO-8601
  role?: "implement" | "review" | "explore";
  /** 可选：panel / runtime 定位提示，不替代 sessionId */
  panelHint?: string;
};
```

### 4.2 不变量

1. `nodes[].id` 在计划内唯一；`deps` 必须指向存在的 id，禁止环。
2. `status` 是进度真源；`column` 仅展示，缺省由 status 映射。
3. **禁止**多 canvas 各维护一份任务数组。
4. `sessionRefs` 可多条；「继续」取最近一条。

### 4.3 Zod 落点

- `src/shared/contracts/project-plan.ts`
- 解析失败：视图内 Alert，不静默空列表

---

## 5. 读 / 写路径

### 5.1 读

`import plan from "./plan.json"`（esbuild json）；热更需 watch 覆盖该文件。

### 5.2 写

| 阶段 | 机制 |
|---|---|
| **W0 dogfood** | 人/Agent 改 plan.json |
| **W1** | files / 受控写项目相对路径 |
| **W2** | 专用命令，围栏 `.pier/plans/**` |

Canvas 禁止 `node:fs`。

### 5.3 校验

写前：schema、无环、deps 存在。

---

## 6. 视图 Canvas

### 6.1 overview / todo

说明页 + 同源列表；W1+ 可改 status。

### 6.2 dag.canvas.tsx（**dogfood 第一步必达**）

| 阶段 | 渲染 | 编辑 | 依赖 |
|---|---|---|---|
| **D0** | 拓扑分层 + SVG/div + pier/canvas 节点卡 | 只读（改 JSON） | **无新 npm** |
| **D1** | **@xyflow/react**（§2.3 受控接入） | 拖、选、缩放 | 通用图库白名单 |
| **D2** | 同上 + 改 deps 写盘 | 轻编辑 | W1 |

节点视觉用 `pier/canvas`；**领域 status 不写进图库封装**。

### 6.3 docs / slices

产品/技术文档模板；实例在 `plans/<id>/docs|slices`。

---

## 7. 与 Agent 会话关联

### 7.1 模型

`PlanNode.sessionRefs[]` ──sessionId──► Agent 运行时（transcript 仍在 agent 域）

### 7.2 动作

| 动作 | 行为 |
|---|---|
| 用 Agent 做这个 | 创建/打开会话 + 注入上下文 + push sessionRef |
| 继续 | focus 最近 sessionId |
| 解绑 | 移除 ref，不删会话 |

### 7.3 约束

- 无全局任务服务 / 无内核 PlanService  
- 图库与 session API 无耦合  
- 不用 NCS/attention 驱动 plan status  

---

## 8. 分期（修订：DAG 产物优先）

```text
D0   plan.json + 只读 dag.canvas（自绘）+ todo     ← dogfood 第一步
D0b  canvases 瘦身 smoke（可并行）
D1a  通用节点图库受控接入（xyflow 类）
D1b  dag.canvas 换图库渲染（数据层不变）
W1   写盘
S1   sessionRefs
T*   文档/设计稿模板、组件概览
```

**D0 不阻塞在「先选完库、改进围栏」。**

---

## 9. Dogfood 节点草案

| id | title | deps |
|---|---|---|
| d0-dag-canvas | plan.json + 只读 dag/todo（自绘） | — |
| d0b-slim | canvases 瘦身 | — |
| d1-diagram-lib | 图库白名单 / pier diagram runtime | d0-dag-canvas |
| d1-dag-xyflow | dag 换 xyflow | d1-diagram-lib |
| w1-write | 写盘 | d0-dag-canvas |
| s1-session | sessionRefs | w1-write |
| t-templates | 文档/composition 模板 | d0-dag-canvas |
| t-index | 组件概览 MVP | t-templates |

---

## 10. 安全

写路径围栏 `.pier/plans/**`；图库仅白名单；plan 禁止凭据；Trust = 打开项目。

---

## 11. 测试

plan schema / layeredLayout 纯函数；编译 plans/dag；D1+ 白名单解析；手动打开 dag → 改 JSON → 刷新。

---

## 12. Key Decisions

1. **底座无 DAG 引擎；必须有 DAG canvas 产物**（dogfood 第一步）。  
2. **库 = 通用节点图画布（推荐 @xyflow/react），不是 DAG 专用库**；布局可插拔。  
3. **领域在 plan.json，与渲染解耦**。  
4. **D0 自绘（围栏零改动）→ D1 受控接入图库**。  
5. **Session 软链在 L3 数据；host 只提供通用开会话能力**。  
6. **设计态台账在项目文件**，非宿主任务库。

---

## 13. Open Questions（已按默认锁定）

| # | 问题 | 决议 |
|---|---|---|
| 1 | 图库进 pier/canvas 还是 `pier/diagram` runtime | **`pier/diagram`（或等价 runtime external）**，不塞进 UI 白名单大杂烩 |
| 2 | D1 布局 | **D0/D1 先用自研 `layeredLayout`；需要时再加 dagre**（elk 后置） |
| 3 | plan.json commit | **是** |
| 4 | 写盘 | **W0 改 JSON → W1 files → W2 专用命令** |

---

## 14. PR Plan

| PR | 标题 | 依赖 |
|---|---|---|
| **PR-D0** | feat(plans): plan.json + 只读 dag/todo（自绘） | — |
| PR-D0b | chore(canvases): 瘦身 smoke | 可并行 |
| PR-D1a | feat(live-modules): 图库受控接入 | D0 |
| PR-D1b | feat(plans): dag 换通用节点图库 | D1a |
| PR-W1 | 写盘 | D0 |
| PR-S1 | sessionRefs | W1 |
| PR-T | 模板 + 组件概览 | D0 |

实施细节同步：[`../plans/2026-07-26-canvas-product-design-workflow.md`](../plans/2026-07-26-canvas-product-design-workflow.md)

---

## 15. 成功标准

1. **D0：** 打开 `dag.canvas.tsx` 见依赖图，与 plan.json 一致。  
2. **D1：** 同数据可平移缩放选中；领域逻辑不进图库封装。  
3. **W1+：** status 可 git diff。  
4. **S1+：** 节点可挂 sessionId。  
5. L1 无 PlanService / DAG 引擎。
