# Canvas 双模式壳与 UI 能力扩展 · 实施计划

- 日期：2026-08-26
- 状态：W1–W6 能力已通；W7 产品闭环已收口。§9 由 Playwright Electron e2e 守门；`build:dist` 后硬校验 oxide / lightningcss unpack。
- 设计稿：`docs/superpowers/specs/2026-08-26-canvas-dual-stage-and-ui-expansion-design.md`
- 规模标注：S ≤ 半天 · M ≈ 1–2 天 · L ≈ 3 天+
- 后续（2026-08-28）：仓库 `.pier/canvases/` 去掉 per-recipe 金样（design-mockup / dag-viewer / kanban / smoke/world 等）；权威模板改在 `resources/system-skills/pier-canvas/templates/`。下文实施记录保留当时路径，不再作为现行真源。

## 0. 相对设计稿的优化修正（实现级核对结论）

1. **world 交互层零新缩放数学**：共享 `useZoomPanViewport` + `ImagePreviewControls`。`HtmlWorldCanvas presentation="stage"` **只给 ContentPreviewHost 全屏**；files 预览内联 world **不得**包它（会重挂 live-module host）。flow 下 stage/zoom 包装层 `display: contents`。
2. **pin 补偿方案简化**：world 缩放走 CSS `zoom` 而非 transform，`getBoundingClientRect` 反映缩放后几何；pin 方案从「预设逆缩放补偿」改为「组件测试先行验证，按需修正」。
3. **`instance.json` 是新表面**：当前仅为 authoring 约定（`references/verification.md` 提及），宿主无加载器。`canvasCommand` 的声明加载 / 校验 / hash 记忆全是新代码，维持 P2 不提前。
4. **阅读偏好决策落定**：flow 模式 DocsShell 直接复用 `useMarkdownPreviewPrefsStore`（文档就是文档，同一份字号 / 舒适宽屏偏好）；复用受阻再拆，不预先建第二 store。

## 1. 工作流总览与依赖

```text
W1 壳 stage 契约 ──┬──▶ W3 画板积木（WorldStage/Layer/preset 依赖 stage 判定）
                   └──▶ W4 图与 DnD 积木（FlowGraph world 铺放依赖 W1）
W2 Tailwind JIT ───────▶（独立，与 W1 并行；W3 资产 loader 同管线顺路）
W5 数据通道 ───────────▶（独立于 W1–W4，可穿插）
W6 配方与 skill ───────▶（收尾，依赖 W1–W5 全部 API 定型）
```

合入节奏：每个工作流独立成 PR 车道，过 `pnpm preflight:push`；W1/W2 先行，W3/W4 并行跟进，W5 穿插，W6 收尾。

## 2. W1 · 壳 stage 契约（P0，规模 L）

### T1.1 stage 判定单一来源（S）

- 新建 `src/plugins/builtin/files/renderer/preview/canvas-stage.ts`：`detectCanvasStage(host: HTMLElement): "flow" | "world"`——查 `:scope` 首层内容的 `[data-canvas-stage="world"]`；含 fill 判定 `[data-canvas-fill]`。
- 挂载完成（`state.kind === "ready"` 且 host 就绪）后判定一次；热重载 remount 重判。判定结果进 `FileCanvasPreview` 本地 state。

### T1.2 壳布局切换（M）

- `preview/canvas.tsx` 一个壳：
  - flow：stage/zoom 为 `display: contents`；`[data-pier-canvas-shell]` 版心 class 只出自 `canvasFlowMeasureClass`（fill 去掉版心与 pad；docs+wide 去掉 `max-w-5xl`）。
  - world：`file-canvas-scroll` `overflow-hidden`；stage 锁定视口 + 共享 `useZoomPanViewport`；zoom 层 CSS `zoom`；控件为 `ImagePreviewControls`（文案 `filePanel.canvas.stage.*`，不是 `filePanel.image.*`）。
  - **不包 `HtmlWorldCanvas presentation="stage"`。**
  - `CanvasLoadingSkeleton` / error / trust 态判定前默认 flow。

### T1.3 内联 wheel 捕获策略核对（M）

- 读 `packages/ui/src/image-preview/use-zoom-pan-viewport.ts`：确认 `handleWheel` 的捕获条件（全屏语境可常捕获；内联进 dockview 滚动面板需避免劫持页面滚动）。
- 若常捕获：给 `ZoomPanWorldStage` 增加 `captureWheel?: "always" | "focus"` 策略位，内联传 `"focus"`（聚焦后捕获，Esc / 失焦释放）；全屏路径默认值不变。带终端布局手测滚轮不串。

### T1.4 toolbar 控件（S）— 已取消

- 不把 zoom 放进 `canvas-chrome-store` / files toolbar。world 缩放只走 stage 内 `ImagePreviewControls`。toolbar 仅 Reload。
- 内联 world **不做全屏**。全屏仍是 `ArtboardStage` / FlowGraph 卡片的 ContentPreviewHost。

### T1.5 评论 pin 双模式验证（M，先行）

- 组件测试先落：world 模式缩放 0.5× / 2× 后 `useCanvasCommentPins` 对同一锚元素的 pin 命中不变；Design Mode pick（`elementFromPoint`）在缩放下拾取正确。
- 验证不过则修：pin 视觉尺寸逆补偿、pick 坐标换算。

### T1.6 阅读偏好复用（S）

- DocsShell 为根的 flow canvas 接 `useMarkdownPreviewPrefsStore`（字号 / 舒适宽屏；纸面明暗不适用 canvas）。

### T1.7 治理与测试（M）

- 新 `tests/unit/renderer/live-modules/canvas-stage-governance.test.ts`：锁「一个壳」（preview 目录无第二个 stage 推断 / 无 fork 的 world 交互实现）、判定单一来源、`canvas.tsx` 不得 import `HtmlWorldCanvas`、world `data-scrollbar="none"`。
- `chart-focus-governance` 白名单登记 canvas world 用途；`scrollbar-visual-governance` 扩 world 断言。
- 组件测试：`tests/component/` flow/world 切换、fill 挡位、T1.5 pin 矩阵。

验收：`.pier/canvases/smoke/` 增 world smoke（`WorldStage` 根）——打开即 viewport 锁定 + 缩放平移可用；既有全部 flow canvas 渲染零变化。

## 3. W2 · Tailwind JIT（P0，规模 L）

### T2.1 编译器接入（L）

- 新建 `src/main/services/live-modules/tailwind.ts`：用 `@tailwindcss/node` 对入口 + 依赖图源文件（复用 `graph.ts` 已跟踪的文件集）做 candidate 扫描 → 产出 utility CSS。theme 层不重复产出（语义令牌变量由宿主 `globals.css` 供给），产出限 utilities。
- `compile.ts`：编译成功后调 tailwind 产出，与 `pickJsAndCssOutputs` 的显式 CSS 合并，一并交 `appendScopedCssInjector`（scope 机制现成）。
- 依赖新增：`pnpm add @tailwindcss/node`（main 侧 devDeps→prod 视打包情况，与 esbuild 同层）。

### T2.2 缓存（M）

- 源文件集内容 hash → CSS 产出缓存，键随 esbuild context 生命周期；热路径目标 < 100ms，超标降级「仅入口 + 一层依赖」并在编译 diagnostics 里记录降级。

### T2.3 过渡态清理（S）

- `src/renderer/app/globals.css` 删 `.pier/canvases` 的 `@source`；仓库 canvas 与用户项目 canvas 统一走 JIT。

### T2.4 治理与测试（M）

- `canvas-tailwind-source-governance.test.ts` 重写：锁「宿主无 canvas @source」「JIT 产出必须经 scoped 注入」「无全局选择器逃逸」。
- 单测：任意值 class（`bg-[#ff6b35]`）经编译进入 scoped CSS；语义 class（`bg-background`）不重复产出变量层；缓存命中路径。

验收：用户项目（非本仓库）canvas 写任意值 class 即时生效；热重载撕旧样式无残留（既有 CSS 撕除机制覆盖）。

## 4. W3 · 资产 loader 与画板积木（P1，规模 M+M）

### T3.1 资产 loader（M）

- `compile.ts` esbuild loader：`.png/.jpg/.webp/.gif/.svg` ≤ 96KB `dataurl`，超限 `file` → `pier-live://` asset ticket（`protocol-handler.ts` 扩 asset 分支）；`.woff/.woff2` `dataurl`。
- `fence.ts`：资产路径限 content directory 内（复用路径围栏）。
- 测试：`tests/unit/main/live-modules/` 增 loader 矩阵 + 围栏拒绝用例。

### T3.2 `WorldStage` / `Layer` / `Artboard` preset（M）

- `pier-canvas-artboard.tsx`：`WorldStage`（渲染 `data-canvas-stage="world"`；**始终 flex-wrap**；未写 `width` 时流式子项用与 `ArtboardStage` 相同的 3×desktop 行宽，纯 `Layer` 子项按坐标包络）、`Layer`、`Artboard` 增 `preset`（desktop/laptop/phone/tablet 尺寸表，显式 width/height 优先）。
- 同步四处：`pier-canvas-export-names.ts` 名单、runtime `pierCanvasExports`、`resources/system-skills/pier-canvas/sdk/core.d.ts`（`pnpm canvas-sdk:generate-types`）、`canvas-materials` catalog。
- 存量兼容：`ArtboardStage` 语义不变（flow 内嵌卡片）。

## 5. W4 · FlowGraph 与 DnD（P1，规模 L+M)

### T4.1 `FlowGraph`（L）

- 新建 `packages/ui/src/flow-graph/`：`nodes`/`edges` 数据驱动、Sugiyama-lite 分层布局（不引 dagre / react-flow）、状态着色仅 `status-*` 令牌、`onSelectNode`、节点拖拽 → `onNodePositionsChange`（受控 `positions` prop，持久化归调用方）。
- **无**建边 / 编辑拓扑 API（治理测试断言导出面）。
- flow 模式内包 fit-all 卡片（同 `Mermaid` 用 `HtmlWorldCanvas card`）；world 模式直接铺放。
- 接入 `pier/canvas` 导出四处同步（同 T3.2）。

### T4.2 DnD 薄原语（M）

- 新建 `packages/ui/src/dnd/`：`Sortable` / `Droppable`（指针事件实现，无新依赖）；拖拽把手产品 focus 环；结果纯回调。
- 接入导出四处同步；组件测试拖拽重排序。

## 6. W5 · 数据通道（P2，规模 S+M+L）

### T5.1 localhost connect-src（S）

- `src/main/csp.ts`：生产 `connect-src` 增 `http://localhost:* http://127.0.0.1:*`；治理测试锁「仅 loopback，无 https 通配」。

### T5.2 `useCanvasFile` watch + 子目录（M）

- `canvas-file-facade.ts`：`watch(fileName, cb)` 封装 `pier://file:changed`（channel 已在 allowlist）；路径校验放行单层子目录（仍禁 `..` / 绝对路径）。
- 单测：watch 触发 / 卸载清理 / 子目录围栏。

### T5.3 `canvasCommand.invoke`（L）

- 声明加载：main 侧读 canvas 同目录 `instance.json` 的 `commands: [{ key, command, cwd? }]`（strict schema，固定命令串）。
- `src/shared/contracts/canvas-host.ts`：allowlist 增 `canvasCommand.invoke`；新能力 `canvas:command`，`allowedClientKinds: ["canvas"]`。
- main 命令处理：信任门 grant 校验 → key 已声明校验 → 首次（或命令串 hash 变更）经发起窗 `showAppConfirm`（展示完整命令串，`intent: "default"`）→ 记忆 userData（canvas-trust 同层）→ 交 tasks 系统 spawn；输出走既有 `run.output` / `tasks:runs-changed` 只读链路。
- 治理：`canvas-host-readonly` 扩——`canvasCommand.invoke` 不带 `*:write`、allowlist 仍无 `run.spawn/stop` 直通；确认记忆不落项目目录。

## 7. W6 · 配方与 skill（P3，规模 M）

- fence React root bare 包白名单（首个 `framer-motion`，`react`/`react-dom` external 到共享 runtime）——可选，验收动效 smoke。
- `resources/system-skills/pier-canvas/`：SKILL.md 增两模式选型决策树（flow vs world vs fill）；新 pack `design`（多画板设备预设 + 标注拼法）与 `orchestration`（FlowGraph + 轮询 + canvasCommand 拼法，Orca-dag 形态参照）；`references/host-data.md` 增 localhost / watch / command 段。
- `.pier/canvases/` 增 `design-mockup/` 与 `dag-viewer/` 金样；物料页 catalog 补新原语行。

## 8. 测试与验收矩阵

| 层 | 覆盖 |
|---|---|
| 单测（main） | tailwind 产出 / 缓存 / 降级；asset loader + 围栏；instance.json schema + hash 记忆；CSP loopback |
| 单测（renderer） | stage 判定；chrome store 扩展；useCanvasFile watch；FlowGraph 布局纯函数 |
| 治理 | canvas-stage（新）；tailwind-source（重写）；canvas-host-readonly（扩）；chart-focus 白名单；scrollbar；materials catalog；SDK 导出名三方对齐 |
| 组件 | flow/world 切换；fill；pin 缩放矩阵（T1.5）；FlowGraph 无编辑 API；Sortable 重排 |
| smoke canvas | `smoke/` 增 world 入口；design-mockup / dag-viewer 金样可挂载（bundled templates 测试同款） |
| 手测 | 带终端布局滚轮不串；多窗 world 多实例帧率；热重载样式撕除 |

## 9. 风险熔断点

- T1.5 pin 矩阵**先于** T1.2 合入基线（红→绿驱动壳改动）；pin 无法在 `zoom` 下稳定 → 熔断为 world 模式 v1 禁用评论 pin（显式 Empty 提示），不阻塞壳落地。
- T2.2 缓存不达标 → 降级扫描已在设计内；仍超标 → JIT 移到 stale 事件后台预热，编译不阻塞。
- T1.3 wheel 策略与终端冲突无解 → world 内联退回「控件缩放 + 拖拽平移、不捕获 wheel」，全屏保留 wheel。
- T5.3 确认 UX 评审不过 → 回退每次执行都 confirm，其余链路不变。

## 10. 实施记录（2026-08-26，W1）

已落地（全部测试绿：unit / component / 静态门禁）：

- **T1.5**：pin/pick 数学经 `canvasShellVisualScale`（`shellRect.width / offsetWidth`）除缩放系数（`canvas-element-pick.ts`）；flow 恒为 1 零影响。zoom 缩放矩阵单测锁定。
- **T1.1**：`canvas-stage.ts` 判定单一来源（root marker 单链下走 ≤4 层；旁支 marker 不触发）；最小 `WorldStage` 原语进 `pier/canvas`（名单 / runtime / d.ts 生成 / 物料组 / 测试 support 五处同步）。
- **T1.2**：壳采用**稳定 DOM + className 切换**（flow 下 stage/zoom 包装层 `display: contents`），命令式挂载零重挂；world = viewport 锁定 + 共享 `useZoomPanViewport` + CSS `zoom`；fill 挡位经根 `data-canvas-fill`。
- **T1.3**：内联 wheel 缩放聚焦门控（未聚焦时 wheel 走原生滚动 = 平移）；pick 模式下禁 pan 捕获。
- **T1.7**：`canvas-stage-governance` 治理测试（单一判定源 / 无 fork / scrollbar / 聚焦门控 / marker 所有权）；`tabIndex` 白名单登记；`smoke/world.canvas.tsx` 金样（组件车道实挂）。

计划偏差（均为简化）：

1. **T1.4 取消 chrome-store 缩放管道**：world 模式直接复用 stage 内置 `ImagePreviewControls`（fit / 百分比 / ± 与图片预览同 UX），toolbar 仅保留既有 Reload。文案复用 `filePanel.image.*`，仅新增 `filePanel.canvas.stage.viewerLabel`。
2. **T1.6 阅读偏好复用推迟**：`useMarkdownPreviewPrefsStore` 在 files 插件内、`DocsShell` 在宿主 lib，直接复用跨 host↔plugin 边界。按设计稿"复用受阻再拆"熔断：待后续把阅读偏好 store 提升为宿主共享后再接（follow-up，不阻塞 W3+）。
3. 评论 pin 无需逆缩放补偿修 DOM：CSS `zoom` 下 locate 除以系数即可，pin 视觉尺寸随缩放（v1 接受，测试锁位置正确性）。

## 11. 实施记录（2026-08-26，W2）

已落地（定向 unit 绿；热路径远低于 100ms 预算）：

- **T2.1**：`src/main/services/live-modules/tailwind.ts` — oxide 扫描入口+依赖图，`@tailwindcss/node` 嵌入式编译 utilities；`theme(inline reference)` 零变量层；`@property` 拆到 scoped injector 的 unscoped 尾部。
- **T2.2**：缓存挂 `CompileContextEntry.tailwindCache`（随 esbuild context 生命周期）；超 100ms 降级为入口+直接依赖并记 warning。
- **T2.3**：宿主 `globals.css` 删除 `.pier/canvases` 的 `@source`。
- **T2.4**：`canvas-tailwind-source-governance` 重写；`tests/unit/main/live-modules/tailwind.test.ts` 覆盖任意值 class / 缓存 / 降级。

依赖：`@tailwindcss/node@4.3.3`、`@tailwindcss/oxide@4.3.3`、`tailwindcss@4.3.3` 进 dependencies（与 esbuild 同层，打包要带 `theme.css`）。

已知限制（不阻塞 W3）：`reference` 模式不产出 `@keyframes`（canvas `animate-*` 依赖宿主已发出的同名关键帧）；打包态 native `.node`（oxide / lightningcss）待下次 `build:dist` 验证。

## 12. 实施记录（2026-08-26，W3）

已落地（host typecheck 绿；定向 unit 绿，含资产编译 / 协议 / 围栏 / 画板 preset / SDK 四处对齐）：

- **T3.1**：`src/main/services/live-modules/assets.ts` — `.png/.jpe?g/.webp/.gif/.svg/.woff2?` esbuild `onLoad`；≤96KB 或字体走 `dataurl`，大图发 `pier-live://asset/<ticket>`。ticket registry 增加 `LiveAssetArtifact`；**revoke 模块票时级联删资产**。`protocol-handler` 按真实 `content-type` 供应。围栏复用 `assertPathInsideRoot`（content/project root）。
- **T3.2**：`WorldStage` 层包络（纯 Layer 子项按 x/y/w/h 算平面；混排流式仍 max-content）；`Layer` 绝对定位；`Artboard` `preset`（desktop/laptop/phone/tablet，显式宽高优先）。四处同步：导出名 / runtime / `sdk/core.d.ts`（手写，**未**跑 `canvas-sdk:generate-types`——会把 `primitives.d.ts` 压成一行）/ 物料组与 catalog。`ArtboardStage` 语义未改。

偏差：资产 URL 与模块 URL 共用 `src/shared/live-module-url.ts` 的 hostname=`asset` 分支，而不是平行第二套协议。

## 13. 实施记录（2026-08-26，W4）

已落地（host typecheck 绿；定向 unit / 物料 / SDK / 画布场景绿）：

- **T4.1 `FlowGraph`**：`packages/ui/src/flow-graph/`（子目录，不占 `packages/ui/src` 已满的 70 文件配额）。Sugiyama-lite 分层布局（Kahn 层 + barycenter，循环节点落末层），**不引 dagre / react-flow**。状态着色只走 `status-*` 洗底 + 与 Mermaid 同款 run glyph。`onSelectNode` 才把节点做成可 Tab 的 button；`onNodePositionsChange` 才可拖。flow 默认 fit-all 卡片；world 经 `CanvasStageContext` 自动 `presentation="plain"`，全屏复用 `openHtmlWorldPreview`。治理测试锁无建边 / 无 `@xyflow`。
- **T4.2 DnD**：`packages/ui/src/dnd/` 指针事件 `Sortable` / `Droppable`，无 `@dnd-kit`。手柄是 28px button + 产品 `focus-visible:ring-ring/40`。跨列表：放到另一个 Droppable 时 `onDrop(itemId)` + 源列表 `onReorder` 去掉该项。

四处同步：导出名 / runtime / `sdk/visualizations.d.ts`（FlowGraph）+ `sdk/core.d.ts`（Sortable/Droppable）/ 物料组与 catalog（四语言 lead + prop）。

偏差：布局是自研分层而不是 vendored dagre 源码（更短、零新依赖，语义仍是分层 DAG）。

## 14. 实施记录（2026-08-26，W5）

已落地（host / canvases typecheck 绿；定向 unit 绿：CSP / path / facade watch / instance schema / invoke / grants / host 只读治理）：

- **T5.1**：生产 `connect-src` 增 `http://localhost:* http://127.0.0.1:*`；dev 同步 127.0.0.1。治理测试锁 loopback、无 `https:`、无裸 `*` host。
- **T5.2**：`useCanvasFile.watch` 封装 `files.watch`，按兄弟路径过滤；`isCanvasScopedFileName` 放行单层子目录（仍禁 `..` / 绝对 / 更深路径）。
- **T5.3**：`canvasCommand.invoke` 走 canvas 专属能力 `canvas:command`（非 `*:write`），allowlist 仍无 `run.spawn` / `run.stop`。main 读同目录 `instance.json` `commands`，信任门（pier-home 跳过）→ 首次或 hash 变更 `dialog.confirm` → 记忆 `{userData}/canvas-command-grants.json` → `startBackgroundRun({ recordRecent: false, source: "history" })`。公开 DX 是 `useCanvasFile().invokeCommand(key)`。

偏差：确认记忆与 canvas-trust 同层 userData，不落仓库；任务 source 仍用 `history`（不扩 `TaskSource`，避免 picker i18n）。

## 15. 实施记录（2026-08-26，W6）

已落地（host / canvases typecheck + 定向 unit / 物料 / 配方 pack / 金样挂载）：

- **动效白名单**：`LiveRootResolve.allowedBarePackages`；项目根默认 `framer-motion`，home 根空。electron / Node builtin 仍拒绝。未把 `framer-motion` 打进宿主依赖——项目自装才会编过。无动效 smoke。
- **`Stack fill`**：根上写 `data-canvas-fill`，满幅 flow 去掉阅读栏版心。
- **skill**：SKILL.md 增 flow / world / fill 选型表；`recipe=design|orchestration` 走 freeform（`packs/recipes/`，不是第四轴）。`host-data.md` 补 loopback / watch / `invokeCommand`。
- **金样**：`.pier/canvases/design-mockup/`、`.pier/canvases/dag-viewer/`；templates 同步。物料 catalog 补 `stackFill`。

偏差：配方不进 methodology content 轴，避免 mockup / DAG viewer 被套进四/五 tab 总览。

## 16. 实施记录（2026-08-27，W7 金标准收口）

已落地（契约与实现对齐；阅读偏好；配方旅程；打包证据）：

- **World 壳终态**：稳定 DOM + 共享 `useZoomPanViewport`；预览不包 `HtmlWorldCanvas`（避免重挂 live-module host）。双击 = `toggleZoom`。设备壳描边明确非目标。
- **T1.6 阅读偏好**：`DocsShell` 打 `data-canvas-docs`；壳复用 files 插件 markdown prefs store（字号 / 舒适宽屏）；版心只归壳。wide 仅 docs 根去 `max-w-5xl`。
- **确认 UX**：首次 + 命令串 hash；`dialog.confirm` 保持通用命令、canvas 文案。任务 `source: "history"` 不扩 `TaskSource`。
- **配方**：`recipe=board` 金样 `.pier/canvases/kanban/`；`dag-viewer` 轮询 `http://127.0.0.1:8787/graph`，失败回落 `graph.json`。
- **打包**：`asarUnpack` 增 `@tailwindcss/oxide` / `lightningcss` native。
- **§9 / 打包**：见 §19（e2e 守门 + `build:dist` unpack `require`）。

## 17. 实施记录（2026-08-27，W7 文档 + 壳正确性）

- 设计稿 §3.1 改为现行 DOM；§2.2 world chrome 去掉内联全屏；状态改回部分落地。
- `detectCanvasStage` 在 `nonce` 变化后重走（host 节点身份不变也重判）。
- `WorldStage` 始终 wrap；流式子项默认行宽与 `ArtboardStage` 相同。
- 画板缩放控件文案走 `filePanel.canvas.stage.*`，不再复用 `filePanel.image.*`。

## 18. 实施记录（2026-08-27，阅读 + 旅程闭环）

- DocsShell 阅读面与 `Text` 正文 **13px**，与 markdown `--md-font-size` 对齐；`--md-scale` 只打在 `[data-canvas-reading]`。
- `dag-viewer`：`invokeCommand` → `run.output` / `pier://tasks:runs-changed`；`cat graph.json` 作为离线闭环；loopback 连续 miss 后停轮询，Refresh 再开。
- `design-mockup` 声明 `data-pier-comment-id`（不伪造 pin UI）。kanban 组件测试断言 DOM `data-canvas-fill`。
- pin locate 在 1× / 2× world zoom 下命中同一锚、同一本地坐标。
- 文档：`animate-*` 依赖宿主 keyframes。

## 19. 实施记录（2026-08-27，§9 / 打包 native 真跑）

- §9 三条收成 `tests/e2e/files/canvas-dual-stage-gold.spec.ts`（真实 Electron，闲置机 `pier-e2e` **3 passed**）：未聚焦不抢缩放、双窗 world 帧预算、JIT 热重载只留一份 live-css 且计算色跟上。
- 预览 `createRoot().render()` 是 concurrent：`ready` 可能早于 WorldStage 提交。`useCanvasStageViewport` 对 host 做 `MutationObserver`，composed root 出现后再切 world 壳。
- `scripts/verify-canvas-tailwind-native-unpack.mjs` 在 `build:dist` 后 `require` 解包 oxide / lightningcss，并按 `mac-arm64` / `mac` 核对对应 `darwin-*` 包。yml glob 仍由 `tailwind-native-packaging` 锁。
- 双 arch 可选 native：`package.json` optionalDependencies + `pnpm-workspace.yaml` `supportedArchitectures`（pnpm 11 不读 package.json 的 `pnpm` 字段）。本机 unpack 对两份 `Pier.app` **ok**。
- Ghostty 原生层是否吃到未聚焦滚轮无法用 Playwright 断言；e2e 锁的是画板侧不改缩放。
- `electron-builder` 双 arch **并行 dmgbuild** 仍会偶发把 Intel dmg 进程打死（exit null）。本次产出 arm64 dmg + 两份 zip + 两份已签名 app；Intel dmg 未齐，`verify-mac-release-artifacts` 未过。未公证。
