# Canvas 双模式壳与 UI 能力扩展 · 设计

- 日期：2026-08-26
- 状态：产品闭环已收口（壳、JIT、积木、阅读 13px、金样锚点）。§9 由 Playwright Electron e2e 守门（`tests/e2e/files/canvas-dual-stage-gold.spec.ts`）；打包 native 由 `build:dist` 后 `verify-canvas-tailwind-native-unpack.mjs` 硬校验。e2e 锁的是相机契约「普通滚轮只平移、`ctrl+wheel` 才缩放」（无聚焦门控，见 §3.4）。
- **2026-08-30 移除**：`FlowGraph` / `layoutFlowGraph`、`dag-viewer` 模板与 `orchestration` 配方整体下线（实现效果不达标，活图 viewer 撤出 Canvas v1 能力面；后续 DAG 需求按具体产品能力重新设计，不再以通用画图原语形态提供）。§5.1 保留为历史设计记录；DnD / `useCanvasFile` / `canvasCommand` / loopback 数据通道不受影响。
- 前置：Live Modules 运行时（编译 / 围栏 / `pier-live://`）；工作台迁入 Canvas 金标准（2026-08-24，已落地）；Canvas 方法论三轴 content / presentation / ui（2026-08-08，归档）

## 1. 背景与问题

Canvas 现状是代码优先的 Live Modules 组装面：`.canvas.tsx` 由 main esbuild 运行时编译，renderer 同 realm 挂载，`pier/canvas` 提供精选原语，`pier/host` 提供只读通道。文档、决策稿、仪表盘组合三类场景已经成立，但还有两个产品缺口：

1. **原型 / UI 设计稿表达弱。** 根因在管线与画板两层：Tailwind 靠宿主构建期 `@source` 扫描（只扫仓库自身），用户项目 canvas 的任意值 class（`bg-[#ff6b35]`）静默不生效；esbuild 无图片 / 字体 loader；React 侧禁 node_modules 无动效；`Artboard` 只有固定尺寸 fit-all，缩放平移仅全屏，无设备预设、无绝对定位。
2. **动态管理类 UI（任务 / 看板 / DAG）没有积木与数据通道。** 只有静态 `Mermaid`（可点选、不可拖）；无 DnD 原语；生产 CSP `connect-src` 无 localhost，canvas 连不上本地编排服务；`useCanvasFile` 无 watch；canvas 无法触发任何命令执行。

业界对照（2026-08 时点）：行业二分为「任意代码 + 沙箱 iframe」（Claude Artifacts、MCP Apps / SEP-1865）与「受控组件目录 + 原生渲染」（Cursor Canvases、Vercel json-render）。Pier 独占「任意代码 + 同 realm + 项目信任」的位置——表达力与宿主融合度最高，短板全部在积木和管线，不在架构。因此本设计**不动渲染 / 信任 / 编译架构**，只补两层：壳的空间模式，以及骑在壳上的能力积木。

动态管理的参照系是 Orca-dag（skill 建图 + viewer 只读轮询渲染 + 声明式动作回调外部系统）：任务状态所有权永远在外部系统，viewer 只做渲染、本地偏好持久化、把用户动作翻译成外部原语。Pier 不做任务生命周期 / 台账 / 调度（AGENTS.md 01），Canvas 的角色就是这种 viewer。

## 2. 产品设计

### 2.1 定位

Canvas = 项目内可版本化的「活文档 + 活面板」。四类目标场景：

| 场景 | 现状 | 本设计 |
|---|---|---|
| 文档 / 决策稿 / 手册 | 已成立（DocsShell） | 阅读模式打磨（阅读偏好对齐） |
| 仪表盘 / 工作台组合 | 已成立（金标准落地） | 不动 |
| 原型 / UI 设计稿 | 弱 | 画板模式 + 管线 + 画板积木 |
| 动态管理 viewer（DAG / 看板 / 任务） | 缺 | 画板模式 + 图 / DnD 积木 + 数据通道 |

### 2.2 壳双模式（产品契约）

预览壳支持两种 stage 几何。**模式由根原语决定，作者零仪式，不引入 meta 声明或 instance.json 第二真源。**

| | 阅读模式（flow，默认） | 画板模式（world） |
|---|---|---|
| 几何 | 纵向滚动流 + 版心 | viewport 锁定，缩放平移，内容摆在世界坐标 |
| 根原语 | 任意流式组合 / `DocsShell` | `WorldStage`（新） |
| 典型内容 | docs、决策稿、组合 overview | 多画板设计稿、DAG、多屏原型、白板布局 |
| 预览 chrome | 现状 + 阅读偏好 | fit / 100%（`ImagePreviewControls`）；滚轮平移、`ctrl+wheel` 光标锚定缩放（无聚焦门控，见 §3.4）。全屏只在 `ArtboardStage` 等 fit-all 卡片走 ContentPreviewHost，files 预览内联 world **不做全屏** |
| 滚动条 | 产品统一滑块 | `overflow-hidden` 相机视口天然无滚动条（无需 `data-scrollbar`） |

**不加第三个「应用模式」。** 满幅看板 / 仪表盘用 flow 的 fill 挡位（单屏撑满、内部自滚）或 world 单帧 fit 退化表达；三模式会让 skill 教法与治理组合面翻倍。

**一个壳铁律。** 两模式是 `FileCanvasPreview` 同一壳的两种 stage 几何，不是第二套预览组件；toolbar、信任门、诊断 Empty、评论系统全部共享（对齐 Markdown 大纲「一个壳」的教训）。

### 2.3 用户旅程

- **设计稿**：agent 用 skill 写 world canvas，多 `Artboard` 挂设备预设摆在世界坐标上；用户滚轮缩放浏览、**双击切换 fit / 100%**（与图片预览同款 `toggleZoom`）；用评论 pin（既有 Design Mode pick）在具体元素上留标注；改稿走 agent 重写文件，热重载即时生效。细看靠滚轮与缩放控件，不是进入单板编辑器。
- **DAG viewer（已移除，见文首注记）**：原设计为 agent 在外部编排系统建图、`FlowGraph` 轮询着色渲染；2026-08-30 随 FlowGraph 一并下线。localhost fetch / 声明式命令 / `run.output` 回流等数据通道保留，供后续具体 DAG 能力复用。
- **看板**：满幅 **fill** 流（不是 world）；列 / 卡数据存兄弟 JSON（或来自插件投影），DnD 原语拖卡，`useCanvasFile` watch 让多窗实例即时同步。

### 2.4 非目标

- 不做可视化拖拽编辑器（改图、改拓扑、改设计稿 = 找 agent 重写源码；对齐 Orca「no interface for editing a single task」哲学）。双击不进入单板细看。
- 不做宿主任务台账 / 看板域 / 调度器（AGENTS.md 01 铁律；状态所有权在外部系统或 canvas 兄弟文件）。
- 不做矢量编辑 / Figma 复刻：world 模式是**浏览与摆放**，不是绘图工具。
- 不做 `Artboard` 设备壳描边 / bezel（preset 只提供尺寸表）。
- 不做 slide deck 播放器（翻页 chrome、演讲者视图）；v1 用 world 多画板表达。
- 不为第三方插件开投影面；不放开 https 外网 fetch（仅 loopback）。
- 不把项目完整 Vite / Tailwind config 搬进 canvas 管线（canvas 有自己的单一管线）。

## 3. 技术设计 A：壳 stage 契约

### 3.1 壳树（现行）

`FileCanvasPreview`（`src/plugins/builtin/files/renderer/preview/canvas.tsx`）一个壳、两种 stage 几何。stage/zoom 包装层在 flow 下 `display: contents`，live-module host **跨模式不重挂**。

```text
file-canvas-preview（相对根）
├─ file-canvas-scroll（flow: overflow-auto · world: overflow-hidden）
│  └─ file-canvas-stage（flow: contents · world: overflow-hidden 视口 + tabIndex=0）
│     └─ file-canvas-zoom（flow: contents · world: 相机 transform translate+scale）
│        └─ [data-pier-canvas-shell]（flow 版心 class 只出自 canvas-stage.ts · 评论 overlay 几何盒）
│           ├─ file-canvas-host（mount 目标）
│           └─ CanvasCommentOverlay
└─ CommentNavigator（底中；markdown / git / canvas 同款）
└─ ImagePreviewControls（仅 world；底右；与图片 / mermaid 同款 `justify-end`）
   （DocsShell flow 无浮动字号控件；阅读偏好经 CSS 变量被动应用）
```

`ArtboardStage` 的 fit-all **卡片**仍用 `HtmlWorldCanvas`；全屏 zoom/pan 只在 ContentPreviewHost。files 预览内联 world **不得**包 `HtmlWorldCanvas presentation="stage"`。

### 3.2 模式判定

- 新根原语 `WorldStage` 渲染 `data-canvas-stage="world"` 属性。判定单一来源是 `canvas-stage.ts` 的 `detectCanvasStage`：从 host 的 `firstElementChild` 起，沿单子节点包装最多走 4 层；先命中 world，再 `data-canvas-fill`，再 `data-canvas-docs`（`DocsShell`），否则 flow。不在壳内再写第二套 querySelector。
- 同 realm + DOM 属性判定与评论 anchor 扫描（`useCanvasHostAnchorIds`）同款机制，无需扩 mount 契约。检测 effect 依赖 `hostEl` + `nonce` + `stateKind`：热重载 remount 后即使 host 节点身份不变也要重走。
- 治理测试锁定 preview 目录除 `canvas-stage.ts` 外不出现 `data-canvas-stage` 字符串。

### 3.3 flow 模式（现状 + 阅读增强）

- 几何不变；`DocsShell` 为根时打 `data-canvas-docs`。壳（files 插件）直接复用 `useMarkdownPreviewPrefsStore`（字号 / 舒适宽屏；纸面明暗不适用 canvas）。store **不**提升到 `src/shared`。字号经 `--md-scale` 被动作用在 DocsShell 上——**无浮动字号控件**（`CanvasReadingChrome` 已于 2026-08-28 摘除；Markdown 预览仍有自己的字号浮控）。「文档就是文档」。
- **版心只归壳**：comfortable 为 `max-w-5xl`；docs + wide 去掉上限（对齐 markdown `--md-measure: 100%`）。`DocsShell` 填满壳，不再自带 1080 第二套版心。
- 新增 fill 挡位：根内容声明 `data-canvas-fill`（由 `Stack` 等原语的 `fill` prop 渲染）时，壳去掉版心与 py，交给内容自滚——满幅仪表盘 / 看板的归宿。fill / world 不应用阅读偏好。

### 3.4 world 模式（相机模型）

- `file-canvas-scroll` 切换为 viewport 锁定（`overflow-hidden`）。
- **相机而非滚动**：world 视口是 `WorldCamera { x, y, scale }` 一次变换（`translate(x,y) scale(s)`，origin 0 0），不再用 CSS `zoom` + 原生滚动。纯函数在 `canvas-math.ts`（`fitCamera` / `zoomCameraAt` / `softClampCamera`），交互在 `useWorldCamera`（`packages/ui/src/image-preview/use-world-camera.ts`）。图片 / Mermaid / fit 卡片是文档查看器语义，仍留在 `useZoomPanViewport`；两个 hook 共享同一数学模块。
- **交互矩阵（对齐画布工具）**：普通滚轮 / 双指 = 平移（rAF 合帧，无聚焦门控——旧门控只因 wheel 曾是缩放）；`ctrl+wheel`（触控板捏合）= 光标锚定平滑缩放（无滚动钳制，锚点精确）；背景拖拽 = 平移（`INTERACTIVE_PAN_IGNORE`；Design Mode pick 禁 pan）；双击 = fit ↔ 100%；`+`/`-`/`0`/方向键保留。相机自由,仅软约束（内容包络至少留 `CAMERA_KEEP_VISIBLE_PX` 在视口内,防甩丢）。
- **fit 是相机位不是特殊态**：初始 = `fitCamera(内容包络, 视口, padding)`；用户未动相机（`fit` 模式）时视口 / 包络变化自动跟随,动过（`free`）不再打扰。「不再打扰」= 不重新 contain-fit；`free` 下窗口改尺寸只改 translate，使原世界中心仍在视口中心。
- **离开再回来**（files 预览画板）：视口记忆见 [`2026-09-01-canvas-world-camera-memory-gold-standard.md`](2026-09-01-canvas-world-camera-memory-gold-standard.md)。落盘真源是世界中心点 + 缩放，禁止把屏幕 `x/y` 当持久化；热更新 nonce 不得重置相机。
- **壳 chrome 单一来源 `WorldViewportFrame`**（`packages/ui/src/image-preview/world-canvas.tsx`）：section + 相机盒由它渲染，`ZoomPanWorldStage` 与 files 预览共同消费；files 预览传 `active=false` 时两层皆 `display: contents`，flow ↔ world 翻转不重挂命令式 host。
- **不包 `HtmlWorldCanvas presentation="stage"`。** 该挡位是 ContentPreviewHost 全屏路径；包进 files 预览会重挂 live-module host。治理锁定 `canvas.tsx` 只消费 `WorldViewportFrame`。
- 文本清晰度：交互期挂 `will-change: transform`,静止 200ms 后摘除,合成层按最终 scale 重栅格化。
- 缩放控件走 stage 内置 `ImagePreviewControls`（不经 `canvas-chrome-store`）。toolbar 仅保留 Reload。
- 版心 / padding 不适用；overflow-hidden 视口天然无滚动条。
- **评论 pin 坐标系**：gBCR 含 transform,整条 overlay / 拾取链路零改动；locate 除以 `canvasShellVisualScale`。pin 视觉尺寸随缩放（v1 接受）。

### 3.5 `WorldStage` / 画板积木（`pier/canvas` 新导出）

- `WorldStage`：`children` / `width?` / `height?` / `background?`。**始终 `flex-wrap`**（与 `ArtboardStage` 同款）。未写 `width` 时：纯 `Layer` 子项按坐标包络；流式子项（Artboard 等）用与 `ArtboardStage` 相同的 3×desktop 行宽，这样 wrap 真会发生。`max-content` 行会让 wrap 永不触发，不是默认。子项可用 `Layer`（`x` / `y` / `w?` / `h?` 绝对摆放）。
- **DOM 实测包络**：mount 后 ResizeObserver 量 `Layer` 子项实际边界（`offsetLeft + offsetWidth`），平面取 `max(声明值, 实测 + padding)`——声明尺寸是下限不是裁刀,Layer 缺 `w`/`h` 不再按 0 计。金样 / 模板不写死 stage 尺寸。
- `Artboard` 增 `preset`：尺寸表（`desktop` 1280×800 · `laptop` 1440×900 · `phone` 393×852 · `tablet` 834×1194）；`width`/`height` 显式值仍最高优先。设备壳描边不做（§2.4）。
- `ArtboardStage` 保留为 flow 内嵌卡片（现状语义不破坏存量 canvas）；world 根一律 `WorldStage`。
- SDK：`PIER_CANVAS_COMPONENT_EXPORT_NAMES` 增 `WorldStage` / `Layer`；`sdk/core.d.ts` 与导出名测试同步。

## 4. 技术设计 B：编译管线（设计稿硬前提，与壳并行）

### 4.1 Tailwind 运行时 JIT

- main 编译流程内，对 canvas 入口 + 依赖图源文件跑 Tailwind v4 扫描（`@tailwindcss/node` 嵌入式编译），产出 CSS 并入现有 `appendScopedCssInjector` 管线，按 moduleId scope 注入 / 撕除。
- 主题继承：产出 CSS 只含 utility，语义令牌变量由宿主 `globals.css` 供给——canvas 里 `bg-background` 与 `bg-[#ff6b35]` 同时成立；颜色治理测试本就不扫 `.pier/canvases`，无纪律冲突。
- 缓存：源内容 hash 增量，与 esbuild context 同生命周期；热路径目标 < 100ms。
- 过渡态清理：删除宿主 `globals.css` 对 `.pier/canvases` 的 `@source`（仓库 canvas 与用户项目 canvas 从此同一条管线）。
- 治理：canvas 产出 CSS 必须 scoped、禁止全局选择器逃逸；检查点扩展 `canvas-tailwind-source-governance`。

### 4.2 资产 loader

- esbuild 增 loader：`.png/.jpg/.webp/.gif` ≤ 96KB 走 `dataurl`，超限走 `file` → `pier-live://` asset ticket 分支（协议已有 ticket registry，扩 asset 类型）；`.svg` 默认 `dataurl`；`.woff/.woff2` 走 `dataurl`（CSP `font-src` 已允许 `data:`）。
- 围栏：资产路径必须落在 content directory 内（复用现有路径围栏），bundle 8MB 上限不变（大资产倒逼 ticket 分支）。
- 字体随之解决：canvas 内 `@font-face` + data URL；不开 `font-src https:`。

### 4.3 动效（低优先）

- fence 对 React root 增加 per-root bare package 白名单（`allowNodeModules` 机制既有，收窄为包名单），首个候选 `framer-motion`；`react` / `react-dom` external 到共享 runtime，无双 React。
- 不做 `pier/canvas` 动效封装（业界能力二次封装，违反 01 原则）。

## 5. 技术设计 C：动态管理积木与数据通道

### 5.1 `FlowGraph` 原语（已移除，历史记录）

> **2026-08-30**：本节原语已整体删除（见文首注记）。保留原文供后续「具体 DAG 能力」设计参考。

- `pier/canvas` 导出：`nodes`（id / label / status / `meta` / `badge` / `data` / `contentHeight`）+ `edges`（含 `label`）数据驱动；分层布局为 **Sugiyama-lite**（Kahn 层 + 一次 barycenter，不引 dagre / react-flow）；状态着色只走 `status-*` 语义令牌。状态枚举：`queued` / `ready` / `running` / `blocked` / `success` / `failed` / `skipped`。源节点 `running` 时边 `data-status="running"`，短划线 + SVG SMIL `stroke-dashoffset` 流动（禁止 crayon / feTurbulence / hex）。
- 槽位：`renderNodeContent`（展示 chrome，该节点须设 `contentHeight`；交互控件放图旁，不进节点）+ `renderOverlay({ positions, width, height })`（关口 / 说明；overlay 根 `pointer-events-none`）。`onSelectNode` 配图旁 `Stack`/`Text` 做检视，不是宿主 NodePanel。
- 拖拽调位经 `onNodePositionsChange`（持久化交给 canvas → `useCanvasFile`）。导出 `layoutFlowGraph`：不传 `positions` 或传 `{}` 重新分层。不做力导向。
- World 金样：`presentation="plain"`（`HostFlowGraph` 在 `WorldStage` 内也会推断 plain）。Run / Refresh / 并行度是 canvas `Button`/`Select` 组合，不是宿主 RunToolbar。
- **明确不做**：拖拽建边、编辑拓扑、节点内嵌表单、react-flow / dagre、把编排调度收进 Pier。改图找 agent 重画。
- flow 模式内退化为 fit-all 卡片（同 `Mermaid` 心智）；world 模式内直接铺在世界坐标获得 zoom/pan。
- 与 `Mermaid` 分工：`Mermaid` = 静态图示（架构 / 时序），`FlowGraph` = 数据驱动活图（状态实时着色 + 位置可拖）。

### 5.2 DnD 薄原语

- `Sortable` / `Droppable` 一对（指针事件自实现，不引 @dnd-kit），配合 `Item` 拼看板列 / 卡；拖拽结果纯回调，状态归 canvas。
- **拖拽必须有过程反馈**：整卡表面可拖（4px slop；交互元素与把手除外，把手保留为可发现路径）；portal ghost 跟随指针（`pointer-events: none`,不干扰 `elementFromPoint`）；同列实时让位（预览序 state 驱动）；跨列在目标列表开插入缝（会话 pub/sub `publishSortableDrag`）；边缘自动滚动（rAF）。
- **跨容器单回调**：落点带序进目标 `Sortable.onDropItem(itemId, index)`（注册优先于外层 `Droppable.onDrop`）；源列表 `onReorder` 不触发——组合方一次写完成移动,避免双写竞争 revision。
- 焦点治理：拖拽把手 `focus-visible:ring` 产品环；密度规范不适用（非单行控件）。

### 5.3 数据通道

1. **localhost connect-src（生产放开）**：CSP `connect-src` 增 `http://localhost:* http://127.0.0.1:*`。Pier 是本地工作台，canvas 连本地服务（Orca-dag :8787 类编排器）是合理信任假设，dev 已如此。**仅 loopback，不开 https 外网**——外网数据走宿主代理或插件投影。
2. **`useCanvasFile` 增强**：`watch(fileName, cb)`（封装既有 `pier://file:changed` channel，allowlist 已含）；可选一层子目录（仍围栏在 canvas 目录内）；revision 乐观并发语义不变。
3. **声明式命令 `canvasCommand.invoke`**：
   - canvas 同目录 `instance.json` 预声明 `commands: [{ key, command, cwd?: "canvasDir" | "projectRoot" }]`（固定命令串，不接受运行时拼接参数；需要参数的场景由 agent 重写声明）。
   - 新 host 命令 `canvasCommand.invoke { key }`：校验信任门已 grant + key 已声明 → 交给既有 tasks 系统 spawn；输出经 `run.output` / `tasks:runs-changed` 既有只读链路回流 canvas。
   - 授权：独立能力 `canvas:command`（对齐 `plugin:action` 先例），`allowedClientKinds: ["canvas"]`；**`pier/host` 只读铁律不破**——执行不是 `*:write` 冒充，宿主命令路径不出现业务命令字符串。
   - 确认策略：每个 `(canvasPath, key)` 首次执行弹 `showAppConfirm`（展示完整命令串），确认后记忆在 userData（与 canvas-trust 同层，不写进项目）；声明变更（命令串 hash 变化）重新确认。
4. **插件投影**：现状（`dataProjections` / `canvasActions` / watch 租约）够用，本设计不扩；官方要长期维护的编排集成（如未来 agent 编排状态）走这条路。

## 6. 路线图

| 期 | 内容 | 解锁 |
|---|---|---|
| P0 | 壳 stage 契约（判定 + world 内联 zoom/pan + 评论 pin 坐标系）；Tailwind JIT | 画板空间 + 样式自由度 |
| P1 | 资产 loader；`WorldStage` / `Layer` / `Artboard` preset；`FlowGraph`（后移除）+ DnD | 设计稿成立；看板渲染层成立 |
| P2 | localhost connect-src；`useCanvasFile` watch + 子目录；`canvasCommand.invoke` | 动态 viewer 数据 / 动作闭环 |
| P3 | 动效白名单；design pack / orchestration pack + skill 更新（含两模式教法） | agent 生成配方 |

P0 两件并行（渲染壳层 ⊥ 编译管线层）；P1 起积木骑在壳上。

## 7. 治理检查点

| 检查点 | 锁定 |
|---|---|
| `canvas-stage-governance`（新） | 一个壳、stage 判定单一来源、world 缩放数学复用 image-preview（`useWorldCamera` / `canvas-math`）、预览壳不包 `HtmlWorldCanvas`、flow 版心归壳、world 视口 `overflow-hidden` 无滚动条、wheel 平移无聚焦门控 |
| `chart-focus-governance`（扩） | world 画布 `tabIndex={0}` 白名单登记 |
| `canvas-tailwind-source-governance`（改） | JIT 产出 scoped、无全局逃逸、宿主 `@source` 过渡态已删 |
| `canvas-host-readonly`（扩） | `canvasCommand.invoke` 独立能力、key 预声明、无 `*:write`；allowlist 仍无 spawn/stop 直通 |
| `canvas-materials` catalog（扩） | `WorldStage` / `Layer` / `Sortable` 登记；仍无领域组件行 |
| SDK 导出名 / bundled d.ts 测试（扩） | 新导出三方对齐（runtime / 名单 / d.ts） |
| 组件测试（新） | 缩放后评论 pin 命中同一锚元素 |

## 8. 已决取舍与残留风险

- **评论 pin × world zoom**：locate 除以视觉系数即可；v1 接受 pin 视觉随缩放。
- **Tailwind JIT 时延**：超 100ms 降级为入口 + 直接依赖并记 warning（已落地）。
- **canvasCommand 确认 UX（已决）**：每个 `(canvasPath, key)` 首次或命令串 hash 变更弹 `dialog.confirm`（完整命令串）；记忆在 `{userData}/canvas-command-grants.json`。不每次确认。任务 `source` 仍为 `history` + `recordRecent: false`（不扩 `TaskSource`）。
- **阅读偏好（已决）**：壳复用 files 插件 `useMarkdownPreviewPrefsStore`；不新建第二 store，不把 zustand store 提升到 `src/shared`。
- **world 多实例性能**：超预算时再引入画板级 `content-visibility`。
- **动效**：项目根默认允许 `framer-motion`；宿主不装箱。项目自装才会编过。
- **`animate-*`**：`theme(inline reference)` 不吐 `@keyframes`；动画要宿主 `globals.css` 已有同名关键帧。
- **§9 / 打包 native**：§9 三条由 `tests/e2e/files/canvas-dual-stage-gold.spec.ts` 在真实 Electron 里跑（滚轮只平移 / `ctrl+wheel` 光标缩放、双窗 world 帧预算、JIT 热重载撕旧 stylesheet）。打包态 oxide / lightningcss / esbuild 由 `scripts/verify-canvas-tailwind-native-unpack.mjs` 在 `build:dist` 后 `require` 解包 `.node`，不再只核对 yml glob。

## 9. 手测清单（Electron e2e 守门）

合入前跑 `pnpm test:e2e:auto tests/e2e/files/canvas-dual-stage-gold.spec.ts`（优先闲置机）。契约：

1. 带终端的分栏布局：world canvas 内普通滚轮 = 平移（缩放不变）；`ctrl+wheel`（触控板捏合）= 光标锚定缩放。
2. 两个 world 预览同时打开（两窗）：各自可缩放，rAF 中位帧间隔 < 40ms。
3. 改 canvas 任意值 class 后热重载：该模块只剩一份 `style[data-pier-live-css]`，探针计算色跟上新 class。
