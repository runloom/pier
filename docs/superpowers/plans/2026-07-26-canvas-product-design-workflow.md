# Canvas 产品技术设计工作流 · 实施方案

> **For agentic workers:** 按 Task 顺序交付；每 Task 先红测再实现。  
> **规范规格：** [`../specs/2026-07-26-canvas-product-design-workflow-design.md`](../specs/2026-07-26-canvas-product-design-workflow-design.md)（**已确认 2026-07-26**）  
> **前置：** Live Modules C 轨可编译项目 canvas（[`2026-07-25-live-modules-c-track.md`](./2026-07-25-live-modules-c-track.md)）  
> **开工顺序：** 先 **PR-D0**（plan + 只读 dag/todo 自绘），不阻塞图库。

**Goal:** **Dogfood 第一步交付可用的 DAG canvas 产物**（+ 同源 plan 数据）；底座不实现 DAG 引擎。随后：通用节点图库受控接入、写盘、session 软链、模板与组件概览。

**Architecture:**  
- L1 Live Modules：编译/围栏/预览（无 PlanService）  
- L2 通用节点图（目标 `@xyflow/react`，非 DAG 专用库）+ 可选写文件/开会话  
- L3 `plan.json` + `dag.canvas.tsx` / todo / 文档（产物层）

**Tech Stack:** Electron · Live Modules · `pier/canvas` · Zod · Vitest；  
**D0** 自绘 SVG+分层布局（零新 npm）；**D1** `@xyflow/react`（+ 可选 dagre/elk 仅布局）经围栏白名单或 `pier/diagram` runtime。

**Out of scope:** 宿主任务库、自动调度、canvas 内 node:fs、完整 pier.canvas Library UX、内核 DAG 引擎。

**规格 §2（库选型必读）：** [`../specs/2026-07-26-canvas-product-design-workflow-design.md`](../specs/2026-07-26-canvas-product-design-workflow-design.md)

---

## 0. 文件落点（拟）

```text
src/shared/contracts/project-plan.ts     # PlanDocument Zod + 无环校验 + column 映射
docs/superpowers/specs/2026-07-26-...    # 规格（已有）
docs/superpowers/plans/2026-07-26-...    # 本文

.pier/canvases/
  smoke/*                                # 保留四框架
  templates/blank.canvas.tsx             # 最小起稿
  README.md                              # 更新角色说明

.pier/plans/
  README.md
  canvas-capabilities-v1/
    plan.json
    overview.canvas.tsx
    dag.canvas.tsx
    todo.canvas.tsx

tests/unit/shared/project-plan.test.ts
tests/unit/main/live-modules-project-canvases.test.ts  # 改锚 smoke + plans
tests/component/project-canvas-scenarios.test.tsx        # 改 glob / 期望
```

写盘 W1（Todo/DAG 可写）可能触及：

```text
# 复用 files 写文件 API 或新增窄命令（实施时选一）
src/shared/contracts/… 
src/plugins/builtin/files/… 或 src/main/services/live-modules/…
```

Agent 绑定 P4 可能触及：

```text
src/renderer/… agent runtime open/focus
# 仅 facade 调用，不新建任务服务
```

---

## 1. Task 列表

### Task D0 — dogfood 第一步：plan.json + 只读 DAG/Todo canvas（**优先**）

**目标：** 不引入图库、不改围栏；交付可打开的 **dag.canvas.tsx** 产物。

**步骤：**

1. `src/shared/contracts/project-plan.ts`：Zod schema、`assertPlanAcyclic`、`statusToColumn`、纯函数 `layeredLayout(nodes)`（按 deps 分层算 x/y）。
2. 单测：schema / 成环 / layout 层序。
3. `.pier/plans/canvas-capabilities-v1/plan.json`（节点见规格 §9）。
4. `dag.canvas.tsx`：import plan → layout → SVG 边 + `pier/canvas` 节点卡（title/status Badge）。
5. `todo.canvas.tsx`：同源列表；`overview.canvas.tsx` 可选。
6. `.pier/plans/README.md`：说明 L3 约定、D0/D1 渲染策略。
7. 编译测试纳入 plans 路径。

**验收：** Files 打开 `dag.canvas.tsx` 见依赖图；改 plan.json 后刷新一致。

**非目标：** xyflow、写盘、session、瘦身（可并行 Task D0b）。

---

### Task D0b — canvases 瘦身与测试改锚（可与 D0 并行）

**目标：** smoke 四框架 + blank；删 scenarios/stress/厚 templates；测试绿。

**步骤：** 盘点测试引用 → blank 模板 → 删除厚样例 → 改测试 → README。

**验收：** 无悬空路径；四框架 hello 仍过。

---

### Task D1a — 通用节点图库受控接入

**目标：** React canvas 能合法使用 **@xyflow/react**（通用节点图，非 DAG 引擎）。

**步骤（二选一，规格默认 A）：**

- **A.** `pier-live://runtime/diagram` 或 compile external + 宿主 install 注册 xyflow（与 React 单例策略一致）  
- **B.** fence 白名单 bare：`@xyflow/react`（及必要 peer）；从 **项目** node_modules resolve  

另：布局可选 `@dagrejs/dagre` 白名单，或继续用 `layeredLayout`。

**验收：** 最小 fixture canvas `import { ReactFlow } from ...` 可 compile+mount。

**风险：** 包体、CSS（xyflow 需样式注入策略，类似 Vue style inject 或 host CSS）。

---

### Task D1b — dag.canvas 换通用图库渲染

**目标：** 同一 plan.json；渲染层换 xyflow；领域逻辑仍在 canvas/plan。

**步骤：** nodes/edges 从 plan 映射到 ReactFlow；nodeTypes 用 pier/canvas 风格卡片；保留 D0 文件或 `dag.canvas.tsx` 原地升级。

**验收：** 平移缩放选中；改 plan 仍驱动图。

---

### Task 2 — （并入 D0）plan 契约

已含于 Task D0；不必单独 PR，除非拆契约先行。

---

### Task 3 — Todo 写盘（W1）

**目标：** 在 todo 视图改 status，写回 `plan.json`。

**步骤：**

1. 选定写盘通道（优先序）：
   - A. files 插件 / `window.pier` 已有写项目文件 API
   - B. 新增 `plans.writeDocument` 命令：参数 `projectRoot` 隐含 + `planId` + 全文；main 围栏 `.pier/plans/<id>/plan.json`
2. canvas 内：改 status → `updatedAt=now` → serialize → 写盘 → 本地 state 乐观更新；失败 `showAppAlert` / canvas 内 Alert（canvas 无 toast 宿主时用 Alert + 文案）。
3. 写前 `parsePlanDocument` + `assertPlanAcyclic`。
4. 单测：序列化往返；命令围栏拒绝 `../` 与仓库外路径。
5. dogfood：把一节点标为 `in_progress` 应出现在 git diff。

**验收：** 仅改 status 的 diff 干净；非法 JSON 不落盘。

---

### Task 4 — DAG 可编辑写盘

**目标：** 增删节点、编辑 deps/title、改 status，写回同一 plan.json。

**步骤：**

1. UI：选中节点检查器（title、status、deps 多选、notes）；「添加节点」「删除节点」。
2. 布局：编辑后可仍用拓扑自动布局（v1 不持久化 x,y；若需可后加 `layout?: {x,y}`）。
3. 保存防抖（300ms）或显式「保存」按钮（推荐 **显式保存** 降低误写）。
4. 与 Todo 同时打开时：以磁盘 + 热更为准，不做 CRDT。
5. 单测：删除被依赖节点时拒绝或自动摘 deps（**默认拒绝并提示**）。

**验收：** 只通过 DAG 添加节点后 Todo 刷新可见。

---

### Task 5 — 节点绑定 Agent 会话

**目标：** 「用 Agent 做这个」/「继续」写入或复用 `sessionRefs`。

**步骤：**

1. 调研现有 API：创建 agent 终端/会话、focus panel、runtime index 中的 sessionId 字段（实施时写明具体 `invoke` 名）。
2. 构造首轮上下文字符串（规格 §6.3）。
3. 成功后写盘更新 `sessionRefs`（依赖 Task 3 写盘）。
4. UI：有 ref 时显示「继续」+ sessionId 短码；支持「新开一轮」。
5. 失败路径：会话开了但写 ref 失败 → Alert 说明可手改 plan。
6. 单测：sessionRefs 追加逻辑纯函数；不测真实 agent 子进程（mock invoke）。

**验收：** dogfood 节点可留下至少一条 sessionRef；聚焦不重复造会话（继续路径）。

---

### Task 6 — 文档与设计稿模板

**目标：** 可复制的 canvas 模板，支撑能力 ③④⑤ 的「形状」。

**步骤：**

1. `.pier/canvases/templates/` 下增加（或 plans 下 `_templates`）：
   - `doc-product-screen.canvas.tsx` — 一屏规格
   - `doc-product-journey.canvas.tsx` — 关键旅程
   - `doc-product-feedback.canvas.tsx` — 反馈选型
   - `doc-tech-overview.canvas.tsx` — 技术目标/边界
   - `composition-blank` 已有则扩展注释
2. 每模板顶部注释：复制到 `plans/<id>/docs|slices/` 后改内容。
3. 可选：skill 文案片段（若 project-skills 有约定，另 PR）。
4. 不强制删历史「好句子」——可从已删 scenarios 的 git 历史取。

**验收：** 复制模板可编译；README 链到模板列表。

---

### Task 7 — 项目组件概览 MVP

**目标：** 能力 ② 最小版。

**步骤：**

1. 约定：优先 `import * as preview from "../../preview-exports"` 或读 `.pier/preview-exports.ts` 导出表。
2. canvas：`component-index.canvas.tsx`（可放 `templates/` 或 plans 工具区）列出导出名称 + 点击挂载预览（若导出为组件）。
3. 无 barrel：Empty + 文案「添加 preview-exports 或让 Agent 生成」。
4. 不做全仓 AST 扫描（后置）。

**验收：** 有 barrel 时可见列表；无 barrel 时空态清晰。

---

## 2. plan.json 初始内容（Task 2 写入）

```json
{
  "version": 1,
  "id": "canvas-capabilities-v1",
  "title": "Canvas 产品技术设计工作流",
  "description": "本仓库 dogfood：plan 真源 + canvas 视图 + 分阶段写盘与 Agent 绑定。",
  "updatedAt": "2026-07-26T00:00:00.000Z",
  "nodes": [
    {
      "id": "p0-slim",
      "title": "canvases 瘦身与测试改锚",
      "status": "todo",
      "deps": [],
      "paths": [".pier/canvases", "tests/unit/main/live-modules-project-canvases.test.ts"],
      "acceptance": ["仅 smoke(+blank) 保留", "相关 vitest 绿"]
    },
    {
      "id": "p0-plan-skeleton",
      "title": "plan.json + 只读 overview/todo/dag",
      "status": "todo",
      "deps": ["p0-slim"],
      "paths": [".pier/plans/canvas-capabilities-v1"],
      "acceptance": ["三视图与 JSON 一致"]
    },
    {
      "id": "p1-schema",
      "title": "shared plan 契约与校验单测",
      "status": "todo",
      "deps": ["p0-plan-skeleton"],
      "paths": ["src/shared/contracts/project-plan.ts"]
    },
    {
      "id": "p2-todo-write",
      "title": "Todo 状态写盘",
      "status": "todo",
      "deps": ["p1-schema"]
    },
    {
      "id": "p3-dag-edit",
      "title": "DAG 可编辑写盘",
      "status": "todo",
      "deps": ["p1-schema"]
    },
    {
      "id": "p4-session",
      "title": "节点绑定 Agent 会话",
      "status": "todo",
      "deps": ["p2-todo-write"]
    },
    {
      "id": "p5-templates",
      "title": "产品/技术/composition 模板",
      "status": "todo",
      "deps": ["p0-plan-skeleton"]
    },
    {
      "id": "p6-component-index",
      "title": "项目组件概览 MVP",
      "status": "todo",
      "deps": ["p5-templates"]
    }
  ]
}
```

---

## 3. 风险与缓解

| 风险 | 缓解 |
|---|---|
| JSON import 不触发 watch | graph 跟踪 json 依赖；或文档要求改 plan 后点 Reload |
| 写盘 API 权限过大 | 路径前缀锁死 `.pier/plans/` |
| Agent sessionId 不稳定 | 允许 ref 失效；UI 显示「会话不可用」可解绑 |
| DAG 编辑误删 | 显式保存 + 删前校验 deps |
| 瘦身删掉有用文案 | git 历史仍在；模板 PR 再提炼 |

---

## 4. 实施顺序（PR 映射）

| PR | Task | 可独立合并 |
|---|---|---|
| **PR-D0** | Task D0（DAG 产物 dogfood） | **是，优先** |
| PR-D0b | Task D0b 瘦身 | 可与 D0 并行 |
| PR-D1a | Task D1a 图库接入 | 依赖 D0 |
| PR-D1b | Task D1b dag 换库 | 依赖 D1a |
| PR-W1 | Task 3 写盘 | 依赖 D0 |
| PR-S1 | Task 5 session | 依赖 W1 |
| PR-T | Task 6–7 模板/概览 | 依赖 D0 |

**先合 PR-D0**：立刻用自绘 DAG 管后续工作；图库是体验升级不是门禁。

---

## 5. 开工检查清单

- [ ] 规格 §2 库选型评审通过  
- [ ] **Task D0** 分支：plan + dag/todo 可打开  
- [ ] （并行）D0b 瘦身  
- [ ] 新工作项先写 plan 节点  

---

## 6. 成功标准

1. **D0：** `dag.canvas.tsx` 可见依赖图且与 plan.json 一致（dogfood 第一步）  
2. CI：smoke + plans/dag 编译  
3. D1：通用节点图库渲染，数据层不变  
4. W1+：status 可 git diff  
5. L1 无 DAG 引擎 / PlanService
