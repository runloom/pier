# Pier Agent Context

本文件是开发 Pier 时给 Claude Code、Codex 和 OpenCode 共用的项目级上下文（硬约束与治理规则）。  
人类贡献者请从 [`README.md`](README.md) / [`docs/README.md`](docs/README.md) / [`CONTRIBUTING.md`](CONTRIBUTING.md) 进入；不要把本文当作用户手册全文复制进 PR 描述。

## 01 项目定位

Pier 是本地 AI 开发工作台。参考 loomdesk 产品形态，使用 bay 的工具链栈重写。

跨端产品定义见 [`PRODUCT.md`](PRODUCT.md)：桌面端与所有移动端（Web / PWA、后续 iOS / Android App、小程序等）共同遵循同一份用户目标、定位、术语与能力边界。各端专项文档只补充平台差异与交付阶段；架构、交互和工程治理仍以本文为准。

- 核心能力：稳定终端、dockview panel 布局、代码变更预览、文件查看、多 agent 状态可见性。
- 不做：任务生命周期、SQLite 任务台账、看板、自动调度。
- **核心逻辑优先，拒绝业界能力二次封装**：只实现本产品独有、且依赖 Pier 宿主身份/运行时才能成立的能力；业界已成熟支持的能力（如各 agent 原生 one-shot CLI）直接走原生入口，禁止为「统一抽象 / 便利封装」再造第二套 API 或宿主服务。判定：去掉 Pier 后用户仍能用原生工具完成同一动作 → 不做 Pier 产品封装。
- 持久化分层：用户偏好/布局写 userData JSON；代码变更实时读 Git；密钥走 safeStorage。

## 02 技术栈

- Electron 43 · React 19 · TypeScript 6 strict
- electron-vite 5 + Vite 8（main / preload / renderer 三端）
- dockview-react 6.6.1（panel 布局核心：tab + split + floating + drag）
- Tailwind CSS v4 + shadcn primitives
- Zustand 5（client state）
- Biome 2.5 + Ultracite（lint + format 单工具栈）
- pnpm 11
- Vitest 4 + Playwright（测试）

## 03 架构边界

进程边界由 dependency-cruiser 守护：

- `main/` ⊥ `renderer/`（双向禁止）
- `preload/` 只可 import `shared/` + `electron`
- `main/` 内 L1 持久化 ⊥ L2/L3/L4（单向依赖）
- **renderer 业务代码不可直接 import dockview-core/dockview 运行时 API**，必经 `components/workspace/` 边界；panel kit 可使用共享 dockview 类型
- renderer 不同 panel-kits 不跨域 import（走 `components/common` 或 `stores`）
- `src/plugins/builtin/*` 只可 import `src/plugins/api` + `src/shared` + `packages/ui`；宿主只在两个 builtin-catalog 处 import 插件包

### 插件边界是纪律边界，不是安全边界

内置插件与 v1 官方受管理外部插件都属于可信代码：renderer 与宿主同 realm 运行，external main
是普通 Node ESM，可访问 Node 能力。capability 断言（`assertPluginCapability`）、manifest 声明校验、
插件 RPC 的 `pluginId` 作用域和包扫描测试都是工程纪律边界，不构成对恶意代码的防护——main 侧
`authorizeCommand` 当前按 client-kind 授权，不区分插件主体身份。

当前只允许两类插件：

- `src/plugins/builtin/*` 内置插件。
- 官方 bundled / official managed external plugin（例如 `pier.codex`），必须经受管理安装索引、签名官方索引、包校验、不可变版本目录和启动时运行态快照加载。

dev override 只允许开发/测试运行时使用；生产包默认不显示入口、命令返回拒绝结果，即使历史 `index.json` 中已有 dev override 也必须忽略本地路径，并且不得把本地目录标记为官方来源。不得开放第三方插件、任意 registry、任意 git/local 扫描或 marketplace 加载路径。引入第三方插件前必须先设计真正隔离：独立 realm/进程、每插件主体身份、main 侧按插件主体授权、最小权限 host API、供应链签名与回滚策略。

### 宿主弹窗使用规范

权威规格：[`docs/superpowers/specs/2026-09-09-dialog-system-gold-standard.md`](docs/superpowers/specs/2026-09-09-dialog-system-gold-standard.md)（简单弹窗布局 / `size` / `intent` 细则、选型决策树、弹窗表单提交型 / 即时偏好两模型与「记住上次」禁令、浮层后打开）。

- 简单弹窗唯一入口：宿主 `showAppConfirm` / `showAppAlert` / `showAppChoice` / `showAppPrompt`，插件 `context.dialogs`；builtin 与 external 插件的简单弹窗 API **同构**；复杂内容走 `dialogs.open`（content dialog）。
- **`size` 禁止调用方传入**（按 kind 固定）；`intent` 调用方必填，宿主不按标题或文案猜危险程度。
- 插件 renderer 禁止 import `@pier/ui/dialog` / `@pier/ui/alert-dialog`（含嵌套插件 Dialog）；宿主业务代码不直接 import `@pier/ui/alert-dialog.tsx`。
- 弹窗表单只有提交型 / 即时偏好两种模型，共享 class 单一来源 `@pier/ui/dialog-form-layout.ts`；规格沉默处禁止发明第三套。
- 检查点：`tests/unit/renderer/notifications/app-dialog-governance.test.ts`、`tests/unit/renderer/app/dialog-form-governance.test.ts`、`tests/unit/renderer/plugins/plugin-product-dialog-governance.test.ts`、`tests/component/app/dialog-host.test.tsx`。

### 浮层后打开 Dialog / 设置

权威规格：[`docs/superpowers/specs/2026-09-09-dialog-system-gold-standard.md`](docs/superpowers/specs/2026-09-09-dialog-system-gold-standard.md)（浮层后打开）。

- 从 Radix overlay（DropdownMenu / ContextMenu / Select）打开 Dialog 或设置：业务只写普通 controlled `open`，组件内部等待 overlay 关闭 / body 指针锁解锁后再挂载，超时放弃打开；业务侧禁止 `setTimeout` / `scheduleAfterOverlay` / `modal={false}`。
- 检查点在 `tests/unit/renderer/app/overlay-dialog-governance.test.tsx`、`tests/unit/renderer/app/use-deferred-dialog-open.test.tsx` 与 `tests/unit/renderer/app/schedule-after-overlay.test.ts`。

### 操作反馈规范

权威规格：[`docs/superpowers/specs/2026-09-09-action-feedback-gold-standard.md`](docs/superpowers/specs/2026-09-09-action-feedback-gold-standard.md)（反馈选型顺序、双反馈禁令、代码审查检查点）。

- 每个用户动作都必须有可识别的完成 / 失败信号；静默失败（`catch` 里只有 `console.error`）一律禁止。
- 强自然 UI 反馈 → 不再加 toast；弱 / 无反馈的成功 → `toast.success`；短失败 → `toast.error`；带技术详情的失败 → `showAppAlert`，禁止 `toast.*(…, { description })`。
- 后台 / 系统事件一律经 `systemNotify()` 落 NCS，打断由 main `resolveDeliveryPlan` 统一调度；toast 文案走 i18n key，禁止内联字符串。

### 消息中心（统一系统消息）

权威规格：[`docs/superpowers/specs/2026-09-09-notification-center-gold-standard.md`](docs/superpowers/specs/2026-09-09-notification-center-gold-standard.md)（toast 双形态、路由与聚焦互斥、去重下沉、agent 通知同构、入口与 popover 四条例、设置三卡）。

- main 侧 NCS 是唯一写入方；toast 双形态：确认型 = 触发窗胶囊（`position="top-center"`），消息型 = main 单投标准卡片（`position: "top-right"`，必备详情、无前置状态图标）；inbox 卡片唯一实现 `NotificationCard`（仅 Popover 列表，无 dockview panel）。
- 投递判定唯一实现 `resolveDeliveryPlan`（inbox / toast / OS 互斥）；**OS 发送权唯一在 NCS**；同 `dedupeKey` 窗口内由 NCS 合并，调用方不做记录级去重。
- 入口 = 标题栏铃铛 + Popover 全量列表（无筛选 / 搜索）；popover 叠终端的四条例见规格。
- 检查点在 `tests/unit/renderer/notifications/notification-center-governance.test.ts`。

### 用户可见文案规范

权威规格：[`docs/superpowers/specs/2026-09-09-user-copy-gold-standard.md`](docs/superpowers/specs/2026-09-09-user-copy-gold-standard.md)（写作规则、产品词表、严格度分层、审查检查点）。

- 说用户动作，不说内部概念；失败与空态要带下一步；文案一律进 locale，禁止在业务代码里内联用户串。
- 产品词全产品统一：智能体、工作树、Canvas 发现面「物料」、需要你处理；git 产品名用全大写 GIT。
- 实现词（选区 / 上下文 / renderer / 耐久性等）禁止进入前台主路径文案；中文界面少夹英文状态码。
- **根 README 与产品语言集合一致**（`SUPPORTED_LOCALES` 四语）；**CLI GitHub 手册同样四语**，`data.json` 保持单一语义真源。
- 检查点在 `tests/unit/renderer/app/user-copy-governance.test.ts`；根 README 四语检查点在 `tests/unit/docs/readme-locale-governance.test.ts`。

### Markdown 预览大纲布局复用（最高优先级）

`src/plugins/builtin/files/renderer/markdown/preview*.tsx` 的大纲与正文布局必须先复用，再分交互态。交互态差异只能落在**细轨 / hover 浮层**，不得复制第二套壳、高度或间距。

硬规则：

1. **一个大纲壳**：只允许 `MarkdownPreviewToc` 渲染大纲 UI（Notion 细轨横线 + hover/focus-within 浮层列表）。禁止再写一份 aside。
2. **布局分工**：正文在 `data-slot="markdown-preview-layout"`；大纲始终走右侧 `data-slot="markdown-preview-outline-rail"`，必须与字号控件挂在**同一预览框包含块**；大纲右缘用 `MARKDOWN_TOC_EDGE_INSET_PX`（比字号控件更松），垂直用 `MARKDOWN_TOC_TOP_RATIO` 居中偏上，禁止在带 padding 的 scroll 内容盒里用负偏移猜对齐。
3. **共享几何**：顶距比例、细轨槽位宽、浮层面板宽、右边距、底边预留、tick 尺寸只来自 `markdown-preview-toc-layout.ts` 常量 / `markdownOutlineHoverMaxHeightPx` / `markdownOutlineHoverWidthPx` / `markdownTocTickWidthPx`。hover 卡片必须落在预览框内的右侧槽位（`inset-0`），禁止浮层再写 `max-h-[min(70%,…)]` 或另一套 px 公式；禁止 TOC 与布局各自手写 `top-2` / `right-3` / `w-56` 而不读共享常量。
4. **版心单一来源**：可见行宽由 `[data-slot="markdown-prose"]` 的 `--md-measure`（CSS）决定；舒适档为根 `42rem`（禁止 `ch`）；TS 只允许与 CSS 同值的 `MARKDOWN_COMFORTABLE_MEASURE_REM` 作治理锁定，禁止平行测宽 helper。权威规格：[`docs/superpowers/specs/2026-08-28-markdown-reading-measure-gold-standard.md`](docs/superpowers/specs/2026-08-28-markdown-reading-measure-gold-standard.md)。
5. **默认不遮挡正文**：持久态只显示细轨横线（按 heading depth 变宽，active 高亮并跟随滚动）；完整标题列表仅在 hover / focus-within 淡入，**相对细轨垂直居中**覆盖；槽位宽高按预览框 clamp（`markdownOutlineHoverWidthPx` / `markdownOutlineHoverMaxHeightPx`），禁止卡片溢出 `overflow-hidden` 预览根；有大纲时滚动区右侧使用 `MARKDOWN_TOC_CONTENT_INSET_PX`（宽屏 `100%` 版心也不得压到细轨）；离开即隐藏；浮层无关闭按钮，不提供左右位置切换。Scroll-spy 必须每次滚动重新 query heading DOM（适配懒加载分页），不得缓存节点。
6. **git 变更色条在左侧、随正文滚动**：文件预览用 `data-slot="markdown-preview-git-bars"` 画块级色条，槽位 `MARKDOWN_GIT_BAR_SLOT_PX` 加在评论左缘 **外侧**（不得压评论图标、不得给 TOC tick 上 diff 色、不得复用 CodeMirror minimap / 右侧 overview）。几何只来自 `markdown/git-bars/layout.ts`。点击与源码 gutter 同构：打开只读局部修改预览（HEAD → 当前文档，包含未保存修改）。两处共享 `files/renderer/git-changes/` 的文档资源；Markdown 仅在渲染文本与差异快照相同后画色条，按 range ID 打开，不从像素猜源码行。完整审查仅作为显式次级动作，并校验已保存内容后定位。规格见 [`docs/superpowers/specs/2026-09-05-files-local-diff-peek-design.md`](docs/superpowers/specs/2026-09-05-files-local-diff-peek-design.md)。

反例（禁止）：

- 默认展开 overlay 卡片长期压在正文上
- 浮动大纲在 scroll 内容盒内绝对定位，却期望与预览框上的字号控件右对齐
- 细轨 / 浮层各抄一份定位 class 且数值不一致

检查点在 `tests/unit/plugins/markdown/markdown-preview-layout-governance.test.ts`。

### Markdown 预览阅读版心

权威规格：[`docs/superpowers/specs/2026-08-28-markdown-reading-measure-gold-standard.md`](docs/superpowers/specs/2026-08-28-markdown-reading-measure-gold-standard.md)。

- 舒适：`--md-measure: 42rem`（根 rem）。禁止 `ch`、正文字体 `0` 宽、或随 `--md-scale` 派生栏宽。
- 宽屏：`--md-measure: 100%`。窄面板 `min(容器, 42rem)`。
- 左齐（`text-align: start`）；禁止 `justify`（含 HTML `align="justify"` / `text-justify`）。折满行共用右缘；未折满的参差右缘是正确表现。
- 长路径 / 行内代码：`overflow-wrap: anywhere`。列表与引用只缩进 start 侧，右缘对齐版心盒。正文列表 `text-wrap: wrap`（不受 callout `text-balance` 继承）。
- `MARKDOWN_COMFORTABLE_MEASURE_REM` 只与 CSS 同值作治理锁定。Canvas flow `max-w-5xl` 是积木壳，不是文章栏。

检查点在 `tests/unit/plugins/markdown/markdown-reading-measure-governance.test.ts`。

Markdown 预览阅读偏好（字号、舒适/宽屏、纸面明暗）必须走
`useMarkdownPreviewPrefsStore`（`markdown-preview-preferences.ts`）：全局一份、
`localStorage` 持久化、多预览实例共享。**正文字体**不走 Markdown 插件设置，而走宿主
外观「文档字体」（`font.store` → `--pier-document-font-family`）；docs 类 Canvas 经
`DocsShell` 继承同一变量，composition / kit 不得套用。大纲固定右侧细轨 + hover 淡入浮层，
不提供左右切换或持久收起偏好。

### Markdown 预览表格列宽

权威规格：[`docs/superpowers/specs/2026-08-31-markdown-table-column-width-gold-standard.md`](docs/superpowers/specs/2026-08-31-markdown-table-column-width-gold-standard.md)。

- 静止：`width: max-content; max-width: 100%`。禁止给预览 `<table>` 设 `display: block`。横向滚动只由 `.md-table-wrap` 承担。
- 拖拽：加法物理（只动被拖列），首次 dirty 必须冻结全列；表宽 = Σ。松手才落盘；Escape 取消。
- 偏好键：结构键（列数 + 表头），不是全表正文哈希。`(path, key)` 变化须重读并中止拖拽。
- 禁止：版心磁吸、拖拽中逐帧写盘、百分比随面板缩放。

检查点在 `tests/unit/plugins/markdown/markdown-table-column-width-governance.test.ts`。

### Markdown 打开姿态（阅读位置与变更计数）

权威规格：[`docs/superpowers/specs/2026-09-06-files-markdown-open-restore-gold-standard.md`](docs/superpowers/specs/2026-09-06-files-markdown-open-restore-gold-standard.md)。

- 阅读位置：落盘源码 offset（`MarkdownCrossModeAnchor`，`align: "start"`），经既有内容锚点管线还原；禁止裸 `scrollTop`、禁止全文哈希作废、**不进 userData**。scroll 事件当时写入 pending；隐藏 / `scrollTop <= 0` 不冲掉 pending；切走与卸载 flush。只在 `ready` 且 `sourceValue === value` 时还原；隐藏后再显示换新 request id。无记忆或更高意图（标题 / 评论 / 源码对焦 / 搜索）时从顶部开始。
- 顶栏禁止 FileDiff + 数字（含非 0）。变更入口是色条 / gutter、命令面板、`Alt+F5`。

检查点在 `tests/unit/plugins/markdown/markdown-open-restore-governance.test.ts`。

### Canvas 画板视口记忆

权威规格：[`docs/superpowers/specs/2026-09-01-canvas-world-camera-memory-gold-standard.md`](docs/superpowers/specs/2026-09-01-canvas-world-camera-memory-gold-standard.md)。

- 意图：未动手则适应窗口并跟随尺寸；用户平移/缩放后自由视口优先。
- 落盘：`(项目根, 画板路径)` → `localStorage`；自由态存视口中心对准的世界点 + 缩放（`worldX` / `worldY`），适应态只存 `fit`。禁止 nonce、禁止把屏幕平移当真源、**不进 userData**。
- 热更新与切源码不得抢视口；`free` 改窗口只保世界中心，不重新 fit。

检查点在 `tests/unit/plugins/files/canvas-world-camera-memory-governance.test.ts`。

### Canvas 流程图与界面流程

权威规格：[`docs/superpowers/specs/2026-09-10-canvas-workflow-screen-flow-gold-standard.md`](docs/superpowers/specs/2026-09-10-canvas-workflow-screen-flow-gold-standard.md)。

- 作者只写 IR；宿主编译正交折线。失败画 `Empty`，不画残缺图。
- 主线 1.8、旁路 1.4、镖 10×7；idle 实线；hover 只抬高相关组。
- `compile*` 不进 `pier/canvas`。审批走 `WorkflowDiagram`，多屏路径走 `ScreenFlow`。

检查点在 `tests/unit/ui/canvas-workflow/governance.test.ts`。

### 交互控件密度规范

Pier 桌面端的单行交互控件统一使用 28px 高度：

- 高度所有权在 `packages/ui/src/interactive-density.ts`；业务代码不得用 `h-8` 或额外纵向内边距把标准控件恢复到 32px；纯图标默认控件 28×28px。
- 内容型选项（Select / Dropdown / Context Menu / Menubar / Command / Navigation Menu）：单行必须为 28px，多行说明可按内容自然增高，禁止为固定 28px 裁切文字。
- 检查点在 `tests/unit/renderer/app/interactive-density-governance.test.ts`；新增通用交互原语必须接入统一密度定义，例外必须在测试中说明原因。

### 焦点与 Tab 序规范

权威规格：[`docs/superpowers/specs/2026-09-09-focus-and-tab-order-gold-standard.md`](docs/superpowers/specs/2026-09-09-focus-and-tab-order-gold-standard.md)（七条硬规则与 `tabIndex={0}` 白名单全文）。

- 鼠标点中不画 UA outline（`:focus:not(:focus-visible)` 底座在 `globals.css`）；可操作控件只用产品 `focus-visible` ring，禁止 `ring-primary` 当 focus 铬。
- 展示型 / 只读表面不进 Tab 序：图表默认 `accessibilityLayer={false}`、状态徽标、纯展示节点图、装饰 SVG。
- `tabIndex={0}` 走白名单（规格 §5），新增必须在治理测试登记理由；业务高亮 ≠ focus（轻量 `ring-1 ring-ring/40`）。
- 检查点在 `tests/unit/renderer/app/chart-focus-governance.test.ts`。

### 颜色使用规范

权威规格：[`docs/superpowers/specs/2026-09-09-color-token-gold-standard.md`](docs/superpowers/specs/2026-09-09-color-token-gold-standard.md)（所有权分层、例外清单、对比度 Tier 1 / Tier 3 治理）。

- 产品界面颜色按“主题原色 → 语义令牌 → 组件变体 → 业务映射”单向使用；`src/renderer/app/globals.css` 是产品 UI 调色板和语义令牌的唯一所有者。
- `packages/ui` 只消费语义令牌；普通动作 `action-accent`、破坏性 `action-danger`、结构性 `action-muted`；业务源码禁止新增十六进制 / `rgb()` / `hsl()` / `oklch()` / Tailwind 固定色阶（例外见规格）。
- 检查点在 `tests/unit/renderer/app/color-token-governance.test.ts`，新增颜色例外必须同时说明所有权和无法使用现有语义令牌的原因。

### 透明 web 叠 Ghostty 合成

权威规格：[`docs/superpowers/specs/2026-09-04-transparent-web-over-ghostty-compositing-gold-standard.md`](docs/superpowers/specs/2026-09-04-transparent-web-over-ghostty-compositing-gold-standard.md)。

- 终端洞必须透出 native：禁止产品源码 `backdrop-filter` / `backdrop-blur*` / `filter: blur()` 与 `translate3d` / `translateZ` / `transform-gpu` / `will-change: transform`。
- 分栏 / 浮层改大小不藏 native，只拦输入；扫描范围必须含 `packages/ui/src`、`src/renderer`、`src/plugins/builtin`；例外在治理测试 allowlist 写明原因。
- 检查点在 `tests/unit/renderer/app/gpu-compositing-governance.test.ts`。

### shadcn 组件使用规范

权威规格：[`docs/superpowers/specs/2026-09-09-shadcn-usage-gold-standard.md`](docs/superpowers/specs/2026-09-09-shadcn-usage-gold-standard.md)（组合边界、表单原语、专用渲染例外）。

- 头像必须使用 `Avatar` 并提供 `AvatarFallback`；有独立卡片标题的卡片使用完整的 `CardHeader` / `CardContent` 组合。
- 允许保留专用渲染：Dockview tab 原生动作、shadcn Sidebar 自身实现、终端/调试几何画布、图表及物料静态预览。这些例外不得扩展为普通业务表单或信息卡。
- 检查点在 `tests/unit/renderer/app/shadcn-governance.test.ts`；新增例外必须写明组件边界和无法使用现有 shadcn 原语的原因。

### 设置页状态提示布局

宿主设置页（`src/renderer/pages/settings/**`）里用于权限、错误、模式说明的 `@pier/ui/Alert` **必须放在 `Card` / `CardContent` 内**，不得与 `Card` 并列作为 section 根节点下的裸子节点。

- 设置页一级标题（`h1`）仍在卡片外；健康/错误提示并入内容 Card 顶部，禁止空壳 Card 套 Alert。
- 检查点在 `tests/unit/renderer/settings/section-alert-layout-governance.test.ts`（仅扫描 `settings-dialog` 直接挂载的 `*-section.tsx`；嵌套在父 Card 内的子块不扫）。

### 前台活动模块 `src/main/services/foreground-activity/`

统一 agent / task / shell / idle 四态活动聚合器。权威规格：[`docs/superpowers/specs/2026-09-06-agent-status-evidence-gold-standard.md`](docs/superpowers/specs/2026-09-06-agent-status-evidence-gold-standard.md)。

- 契约 `src/shared/contracts/foreground-activity.ts`；广播 `pier://foreground-activity:changed` 是 renderer 唯一活动源；模块内不 import `services/agents/`。宿主不提供公共 Transcript capability。
- **Transcript 终态对账纪律**：原生终态行带回合身份时 `classifyLine` 必须提取为 `turnId`（Grok `prompt_id`、Codex `turn_id`），缺席则丢弃该终态行，禁止空 id + owner 回退；无原生身份的空 `turnId` 终态受 PromptSubmit 文件水位约束（行尾 offset ≤ 该 scope 最近一次 PromptSubmit 时的文件 size 则丢弃；文件截断须清水位）；PromptSubmit 须先完成 transcript observe（写下水位）再 ingest；transcript 封账是软封，可被封账之后、同回合（或空 turnId）的新鲜 hook `ToolStart` 解封（事件 `ts` 若为 epoch 纳秒须先收到毫秒再比 `turnEndedAt`），`ToolComplete` 不解封；无回合身份（空 turnId）的 hook `error` 也可被后续空 turnId 的 hook `ToolStart` 解封；有 turnId 的 hook 终态与宿主合成终态（裸 Esc，`evidenceSource=host`）仍是硬封。检查点：`tests/unit/main/agents/transcript/tail-reconciler.test.ts`、`tests/unit/main/agents/grok/transcript-reconciler.test.ts`、`tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts`、`tests/unit/main/agents/transcript/turn-identity-governance.test.ts`、`tests/unit/main/panel/foreground-activity-transcript-unseal.test.ts`
- 命令行 → 智能体身份只走 `src/shared/agent-command-detection.ts` 的 `matchAgentCommand`（OSC 133 C 先验点亮）：词元只来自 catalog 命令字段；`agent` / `acli` 泛名进 `AGENT_OSC_BIN_DENYLIST`。检查点：`tests/unit/agent/command-detection-governance.test.ts`。

#### 智能体 CLI 版本检测与更新 — 金标准

权威规格：[`docs/superpowers/specs/2026-08-29-agent-latest-version-gold-standard.md`](docs/superpowers/specs/2026-08-29-agent-latest-version-gold-standard.md)。检查点：`tests/unit/main/agents/lifecycle/latest-governance.test.ts`。

#### 宿主发布候选版 — 金标准

权威规格：[`docs/superpowers/specs/2026-08-29-host-release-candidate-gold-standard.md`](docs/superpowers/specs/2026-08-29-host-release-candidate-gold-standard.md)。检查点：`tests/unit/main/app-core/release-workflow.test.ts`。

#### 终端 tab 标题与 Agent 身份（标题 ≠ 身份）— 金标准

tab short = OSC 0/2 → cwd basename → `"Terminal"`。用户钉名优先于后续 OSC。智能体列表主标题 = tab short（`resolveAgentListTitle`）。身份与标题无关。检查点：`tests/unit/agent/session-title-governance.test.ts`、`tests/unit/renderer/agent-runtime/list-title.test.ts`。

### 窗口系统标题与多窗显示名

权威规格：[`docs/superpowers/specs/2026-09-04-window-os-title-gold-standard.md`](docs/superpowers/specs/2026-09-04-window-os-title-gold-standard.md)。

- 对外单行名只来自 `src/shared/window-display` 的 `menuLabel`。main 写入 `WindowInfo.title` 与 `setTitle`。macOS `BaseWindow` 必须显式 `setTitle`，禁止依赖 `document.title`。
- **叶子名的输入是窗口记录的锚 tile**（该窗口第一个工作树 tile；关闭时按创建序顺延；可「设为窗口名称」重钉）。主窗口切换可见 tile 不改窗口名。多 tile 格式 `锚叶子 · +N · 限定`（N = 可见 tile 数 − 1，0 不显示，隐藏 tile 不计）；撞名限定只比锚叶子。欢迎态退化单元的叶子名是 `~`。
- 消歧集合是全部活窗口。撞名限定：分支 → 父目录 → 稳定 tab 名（文件名或用户钉名）→ ` · N`。OSC / cwd 派生 tab / 任务 chrome 不得进 `menuLabel` 任何一段。
- 右键「移动/复制到其他窗口」子菜单、Index 跨窗行、协作会话跨窗定位、`window.list` 只读 `title`。本窗用「本窗口」。
- 窗内标题栏长路径与 tab OSC 不是窗口名。
- 检查点：`tests/unit/shared/window-display.test.ts`、`tests/unit/main/windows/os-title.test.ts`、`tests/unit/renderer/window-display-governance.test.ts`。

### 工作台骨架：工作树 tile 与主 / 子窗口

权威规格：[`docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md`](docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md)。

- **工作树是单元**，tile（用户词「区域」）是它在某个窗口里的一棵 pane 树；窗口装 1…N 个 tile，恰好一个窗口带侧栏。
- 工作树事实（身份、分支、`±N`、`↑↓`、聚合状态）只写在 **tile 底部状态栏**；tab 不带工作树标识；每终端状态栏与窗口级状态行都不存在。
- 侧栏上半是**项目**树（工作树行只切主窗，会话行定位可跳窗，会话用智能体品牌图标）；下半是工作区级插件目的地（「任务」只有一条，在项目树之下，打开已有面板，不嵌进某个项目、不列出议题）。分支名不进侧栏。视觉词汇见规格 §5.3。tab 只能落在自己工作树的 tile 里（含隐藏集 = 已有 → 恢复）。
- 身份色 `--identity-1…6` 由 `src/renderer/app/globals.css` 持有。
- 检查点：`tests/unit/renderer/workbench/tile-governance.test.ts`。整窗 IA 设计稿 `.pier/canvases/workbench-shell/`（不是视觉真源）。

### 路径锚点上下文 `src/main/services/panel-context-resolver.ts` + `src/shared/contracts/panel.ts`

- `PanelContext.projectRootPath` 是当前工作区路径锚点：Git 项目优先为 `gitRoot`，非 Git 目录为 `cwd`。
- `contextId` 由 `worktreeKey` 稳定派生，用于面板上下文身份；任务、终端和插件上下文不再依赖额外 `projectId`。
- 主体不维护 `Project` 注册表，也不把 `projectId` 作为跨模块外键；需要项目粒度能力时优先使用 `projectRootPath` / `gitRoot` / `worktreeRoot`。

### 终端面板 git 身份

终端 OSC 7 与状态栏 git 芯片共用一份身份：**只有 `PanelContext.gitRoot`**，只由 `resolvePanelContextForPath` 写入。同 cwd 且本会话已解析且未失效则不解析、不广播（避免每个提示符闪底栏）。`.git` 创建/删除只作失效信号，禁止 `stat(.git)` 或魔法节流当第二套身份。`worktreeRoot` 只驱动独立工作树徽章，不得点亮分支/变更/同步芯片。

权威规格：[`docs/superpowers/specs/2026-09-02-terminal-git-identity-gold-standard.md`](docs/superpowers/specs/2026-09-02-terminal-git-identity-gold-standard.md)。  
检查点：`tests/unit/main/terminal/cwd-identity/governance.test.ts`、`tests/unit/main/terminal/cwd-forwarding.test.ts`、`tests/unit/main/git/identity-discovery.test.ts`。

### 右键菜单顺序

右键第一项必须是该表面该目标的主工作，且不把人带离当前工作。同组 `menuHidden` 之后禁止让「打开目录 / 在访达中显示」继承第一名（面包屑这种只有路径动作的表面除外）。按表面家族排：审查树 = 暂存优先；Files 树 = 新建优先；文档/终端 = 复制粘贴优先；标签关闭在最后。菜单位置稳定，不用 MRU。

权威规格：[`docs/superpowers/specs/2026-08-31-context-menu-order-gold-standard.md`](docs/superpowers/specs/2026-08-31-context-menu-order-gold-standard.md)。  
检查点：`tests/unit/renderer/context-menu/order-governance.test.ts`、`tests/unit/renderer/context-menu/order-sketches.test.ts`、`tests/unit/renderer/context-menu/order-sketches-composed.test.ts`。

### 跨表面偏好分工

显式控制改目录；隐式学习只做副本；空间菜单位置永不漂。创建走稳定目录，找回走最近，对象操作走右键，工具箱裁剪走设置。

- **A 热路径**（默认智能体 / 快捷键）与 **B 目录裁剪**（禁用智能体）写在设置；新建菜单用「默认」标记 + 「管理智能体…」发现，不改排序。
- **C 习惯副本**只出现在命令面板空态「最近」和有 query 时的同分；新建菜单 / 右键 / 空 `/` 不按频次重排。
- 算法三层：衰减只走 `usageFrecency`；命令/技能/动作有 query 只走 `rankSearchDocuments`（Action 经 `rankActionsForPalette`，`/` 经 skill → `SearchDocument` 薄适配）；空态共用 `presentCommandListGroups`（面板 `recentsLimit: 8`，新建菜单 `0`）。文件路径只走 `scoreFilePath`。禁止第二套 `includes` 保序或第二套半衰期。

权威规格：[`docs/superpowers/specs/2026-09-03-command-surface-preference-gold-standard.md`](docs/superpowers/specs/2026-09-03-command-surface-preference-gold-standard.md)。  
检查点：`tests/unit/renderer/command-surface-preference-governance.test.ts`、`tests/component/workspace/create-menu-preference.test.tsx`、`tests/unit/renderer/terminal/composer-skill-suggest.test.ts`。

### 浮层分割线

浮层发丝线贴齐菜单壳，不跟圆角行高亮左右对齐。class 只来自 `packages/ui/src/separator.tsx`。`p-1` 壳用 `OVERLAY_MENU_SEPARATOR_CLASS`（`-mx-1`）；`p-0` 壳 `overflow-hidden`，区域切开用通栏 `Separator` 或页脚 `border-t`。颜色 `bg-border/50` / `border-border/50`。Popover+Command 杂交壳的内层 Command 禁止第二层 `rounded-3xl`。禁止给页脚加 `mx-*` 追高亮，禁止手写 `hr`。

权威规格：[`docs/superpowers/specs/2026-09-03-overlay-separator-gold-standard.md`](docs/superpowers/specs/2026-09-03-overlay-separator-gold-standard.md)。  
检查点：`tests/unit/renderer/overlay-separator-governance.test.ts`。

### 面板落点浮层生命周期

拖还在，浮层才能在；拖一结束，所有窗口的落点层必须同一拍消失，同一 `transferId` 不能被晚到的 preview 或 `offer()` 再点亮。寿命主人是 renderer overlay session（按 `transferId`）；广播主人是 main `seal`（先于 `waitForOffer` / claim）；dockview 绝对层补丁只做 fail-closed 拆视觉，不拥有寿命。视觉层与 `panel-transfer-drop-preview` 全屏命中区必须同拍 `idle()`；`end(id)` 在没有 live B 时也要拆残留；main tick 见过按下再抬起则 `seal`。禁止用智能体 `Esc` 关浮层。不改双通道 claim，不改 `dndOverlayMounting: "absolute"`。

权威规格：[`docs/superpowers/specs/2026-09-04-panel-drop-overlay-lifecycle-gold-standard.md`](docs/superpowers/specs/2026-09-04-panel-drop-overlay-lifecycle-gold-standard.md)。  
检查点：`tests/unit/renderer/workspace/panel-drop-overlay-lifecycle-governance.test.ts`、`tests/unit/main/panel/transfer-overlay-preview.test.ts`、`tests/unit/renderer/workspace/panel-transfer-overlay-preview.test.ts`、`tests/unit/renderer/workspace/panel-transfer-attach.test.ts`。

### 命令列表分组标题

命令面板空态与新建菜单共用同一套标题规则：标题只表示该块有多条同类命令；1 条不写标题；相邻无标题组合并；分类顺序稳定。使用频次只出现在命令面板「最近」块（新建菜单不设）。`pier.agent.start.*` ≥ 2 时抽成「智能体」子组。新建菜单把运行 / 智能体以外的条目收成展示组「工作区」（标签、文件、工作树、窗口、任务跟踪等打开面板的命令）；命令面板仍按领域分桶。有查询的搜索结果与 Quick Pick section 不套本规则。

权威规格：[`docs/superpowers/specs/2026-09-02-command-list-heading-gold-standard.md`](docs/superpowers/specs/2026-09-02-command-list-heading-gold-standard.md)。  
检查点：`tests/unit/renderer/command-list-group-heading-governance.test.ts`、`tests/unit/command/present-groups.test.ts`。

### 审查打开项目目录

从 git 审查进入 Files **项目目录标签**（只有树、不打开文档）走宿主 `context.files.openProjectDirectory`，与 `openInEditor` 同构。git 不得 import files 插件；不得抢审查主点击；不得把「打开目录」放进 `GitReviewToolbar` 或审查顶栏芯片。在场入口是树 / diff / 审查 tab 右键「打开目录」。审查树「打开文件」与「打开目录」同在 `5_open`（暂存 / 展开之后、复制路径 / 在访达中显示之前）；diff「跳转到源码」仍在 `1_open`。tab 只在 `pier.git.changes` 上显示，打开该次审查 git 根。组序以「右键菜单顺序」金标准为准。

权威规格：[`docs/superpowers/specs/2026-08-30-review-open-project-directory-gold-standard.md`](docs/superpowers/specs/2026-08-30-review-open-project-directory-gold-standard.md)。  
检查点：`tests/unit/renderer/git/review/open-directory-governance.test.ts`。

### MCP 跨智能体清单

设置 → 项目 / 本机工作台 → MCP 是跨智能体**只读清单**：按服务器名聚合，标明从哪来、谁能用、已装智能体里谁还没有。Pier 不改这些文件，也不启动这些服务器。智能体识别必须带名称（Grok 的 X 徽标禁止单独出现）。`pier-memory` 在仓库项目跳到「项目记忆」Tab。禁止宿主 spawn / 启停 / 工具探测 / 连接绿点 / 统一写入 / 市场。

权威规格：[`docs/superpowers/specs/2026-09-03-mcp-inventory-gold-standard.md`](docs/superpowers/specs/2026-09-03-mcp-inventory-gold-standard.md)。  
检查点：`tests/unit/renderer/settings/mcp-inventory-governance.test.ts`、`tests/unit/main/agents/agent-mcp-catalog-parse.test.ts`、`tests/unit/main/agents/agent-mcp-catalog-service.test.ts`、`tests/unit/renderer/settings/mcp-panel.test.tsx`、`tests/unit/plugins/file-panel-breadcrumb-reveal.test.ts`。

### LSP Gateway `src/main/services/lsp/session-broker.ts`

语言服务的进程树按 `(workspaceKey, serverId, rootPath)` 全局唯一（`sessionOwnerKey` 不含窗口与
消费角色）；renderer editor 消费者持**虚拟会话 id**经 broker 路由，language-tools 是 main 侧
消费者直连真实会话：

- broker 职责：请求 id 重写（含 `$/cancelRequest`）、通知扇出、initialize 一次化（`client-capabilities.ts`
 的 Pier 超集 + 结果缓存合成）、server→client 请求路由到最近活跃消费者、didOpen/didClose
 引用计数（`document-gate.ts`；language-tools 短命引用 TTL+LRU）
- 生命周期活动驱动：会话不持有 policy refCount，空闲回收统一按 `lastTouchAt`；renderer 可见
 编辑器周期 `touch()` 保活（`FILES_LSP_VISIBLE_TOUCH_INTERVAL_MS`），隐藏 tab 自然进入空闲窗口，
 回收后经 root-recovery 透明复活（focusin / 可见性恢复触发 `resume()`）
- 全局内存预算安全网：`memory-budget.ts` 周期采样会话进程树 RSS（`pier-resource/process-table`），
 超 `lsp.memoryBudgetMb`（默认 4096，0=不限）按 LRU 关最冷 workspace；禁止改用 per-process
 `maxTsServerMemory` 之类到线自杀方案
- 检查点：`tests/unit/main/lsp/session-broker-governance.test.ts`（同键恒一棵进程树）、
 `tests/unit/main/lsp/document-gate.test.ts`、`tests/unit/main/lsp/memory-budget.test.ts`

### 终端 scrollback `0108-live-scrollback-limit`

终端可见历史只走 ghostty 原生主屏 scrollback（用户偏好上限，默认 64MB）。设置变更经
`setTerminalConfig` 即时写回该窗口存量 surface。

- **不做**磁盘 transcript、状态栏「查看完整历史」、隐藏 tab 热窗收缩：会话历史由各 agent
  原生能力承担（去掉 Pier 后用户仍能用原生工具完成同一动作）；隐藏面板不得裁掉用户已配的
  scrollback，否则切回即丢行。
- 任务输出面板仍只在堆内保留 replay 尾部（`TaskOutputBuffer`：200K 字符 × 20 任务）。
- 检查点：`tests/unit/main/terminal/scrollback-governance.test.ts`、
 `native/Tests/GhosttyBridgeTests/TerminalScrollbackLimitTests.swift`

### 终端 PTY 写入 UTF-8 边界 `0111-utf8-safe-pty-write-chunk`

写进 PTY 的每一块必须落在 UTF-8 字符边界上。ghostty `Exec.queueWrite` 按 64 字节硬切，
增强输入 / `initialInput` / runtime-control 走 `pasteTerminalText` → `ghostty_surface_text`
整段注入时，第 64n 字节常落在汉字中间，逐块解码的 TUI（cursor-agent）会显示 `���`。

- **写端对齐在 ghostty 里做**：`utf8ChunkEnd` 让下一块首字节是续字节时把整个字符让给下一次
  write；快路径与 `\r`→`\r\n` 慢路径同用；畸形输入回退字节边界、绝不产生空块。缓冲仍 64 字节。
- **禁止在 renderer / main 侧绕**：`pasteTerminalText` 只调一次 `sendText` 送整段正文，
  不得逐字 `sendText`、不得按字节数预切、不得插 sleep 等接收端。
- 读端流式解码是 TUI 自己的责任（Ink `setEncoding('utf8')`、crossterm `parse_utf8_char`）；
  内核在读端慢、队列满时仍可能任意切读，本 patch 只消掉确定性的高频触发点。
- 检查点：`tests/unit/native/terminal-pty-write-utf8-boundary-governance.test.ts`

### 终端文件链接在 Pier 中打开

权威规格：[`docs/superpowers/specs/2026-09-04-terminal-file-open-in-pier-gold-standard.md`](docs/superpowers/specs/2026-09-04-terminal-file-open-in-pier-gold-standard.md)。

- 终端视口里点到的文件进 Files 面板，不是 OS 默认应用。http(s)/mailto 走 `openExternal`。
- 宿主在 AppKit `mouseDown` 消费 OSC 8 单击（`HostLinkClick.shouldConsume`），即使 TUI 开着鼠标上报；消费后禁止再把 press 发给 Ghostty。
- 源码/文本继续 `shouldNeverSystemOpen`，禁止 `shell.openPath`。
- 不劫持系统 `open`、不把 `TERM_PROGRAM` 伪装成 vscode、不抢 Markdown UTI、不收 `vscode://`。
- `pier://file/<abs>{#Lline}` 与 OSC 8 同一条 Files 链。
- 检查点：`tests/unit/main/terminal/file-open/governance.test.ts`、`tests/unit/app-core/pier-file-protocol.test.ts`、`native/Tests/GhosttyBridgeTests/HostLinkClickTests.swift`、`native/Tests/GhosttyBridgeTests/TerminalLinkWrapDetectionTests.swift`。

### 终端视口按键所有权 — 金标准

权威规格：[`docs/superpowers/specs/2026-09-04-terminal-viewport-key-ownership-gold-standard.md`](docs/superpowers/specs/2026-09-04-terminal-viewport-key-ownership-gold-standard.md)。

- **视口归 libghostty**：宿主 `NSScrollView` 只镜像 chrome；live 拖条 / 滚轮才 `scroll_to_row`。
- **裸 ↑↓ / Page 只进 PTY**：shell 历史、Cursor / Codex 选单。`FocusNotifyingScrollView` 不得 first responder、不得把 AppKit 文档导航变成 clip 移动；键落到壳上转给 `terminalView.keyDown`。
- **键表由 Ghostty 执行**：禁止裸 `arrow_*=scroll_*` / `scroll_page_lines`。macOS 仅增加 `super+arrow_down=scroll_to_bottom`，让 `Cmd+↓` 在无 shell 提示符标记的 TUI 中也能回到底部；`Cmd+End` 仍可用。`Cmd+↑` / `Cmd+Shift+↑↓` 保留 Ghostty `jump_to_prompt`。不得注册宿主全局滚动键；增强输入框 `Cmd+↓` 保留文本编辑语义。
- **keystroke follow 收窄（方案 C）**：保持 Ghostty 默认「打字回 live」。禁止 appearance 写 `no-keystroke`。裸 ↑↓ / Page 不 `scrollViewport(.bottom)`，只走 Pier patch `0109-keystroke-follow-skip-nav-keys`。
- 检查点：`tests/unit/native/terminal-viewport-key-ownership-governance.test.ts`、`tests/unit/native/terminal-key-routing.test.ts`、`native/Tests/GhosttyBridgeTests/TerminalViewportKeyOwnershipTests.swift`、`native/Tests/GhosttyBridgeTests/TerminalScrollToBottomKeystrokeTests.swift`。

### 终端剪贴板 — 金标准

权威规格：[`docs/superpowers/specs/2026-08-31-terminal-clipboard-gold-standard.md`](docs/superpowers/specs/2026-08-31-terminal-clipboard-gold-standard.md)。

- **种类路由**（`GhosttyTerminal/Host/ClipboardRouting.swift` 单一来源，对齐 Ghostty.app）：只有 standard 触碰 `NSPasteboard.general`；selection（copy-on-select / 中键粘贴 / OSC 52 `s`）住私有 `io.pier.app.terminal.selection`；**未知种类（zig `primary = 2` / OSC 52 `p`）fail-closed 拒绝**（failable init，禁止「非 selection 即 standard」fail-open）。`supports_selection_clipboard = true` 不得改 false（ghostty 会 fallback 直写 standard）。
- **写入防御**：confirm=true（clipboard-write=ask，Pier 无 authorize-copy UI）fail-closed；**空串拒绝仅限 standard**（空 flavor 读侧等价「无内容」，空白选区 / OSC 52 空载荷不得清系统剪贴板；私有 selection 板接受空写以清陈旧中键内容）。
- **抑制恢复**：`endClipboardImageSuppress` 还原前必须验证窗口期无其他写入者（文本变化或新光栅 → 保留新内容放弃还原）；禁止无条件回写 begin 快照。
- **不吞键**：`copy(_:)` / `paste(_:)` / `selectAll(_:)` responder 动作（单派发显式命令）禁止 `hostKeyboardActive` 门禁；环境键事件（`keyDown` / `performKeyEquivalent` 等）门禁必须保留。
- 检查点：`tests/unit/native/terminal-clipboard-routing.test.ts`、`native/Tests/GhosttyBridgeTests/TerminalClipboardRoutingTests.swift`、`tests/unit/main/preferences/clipboard-image-suppress.test.ts`。

### 账号域模块迁移：`src/main/services/agent-accounts/` → `pier.codex`

迁移前，宿主 `src/main/services/agent-accounts/` 仍负责多 AI agent 账号的 CRUD、凭据托管与用量轮询：

- 契约在 `src/shared/contracts/agent-accounts.ts`（`AgentAccountsSnapshot` 全量快照）
- 广播通道 `pier://agent-accounts:changed` 是 renderer 侧镜像 store 的唯一数据源
- 模块内不 import `services/agents/`（账号是独立域，与 agent 集成层单向隔离，对齐 foreground-activity 先例）
- capability 门控：`account:read` / `account:write`；`desktop-renderer` 两者皆有，`cli-local` 仅 `account:read`
- 插件经 `context.accounts` facade 消费（读路径走 renderer 镜像 store，写路径走 `window.pier.accounts`）

本分支的目标终态是把 Codex 账号域迁入官方 `pier.codex` managed external plugin，并删除宿主
`agent-accounts` service、`window.pier.accounts`、`RendererPluginContext.accounts`、`account:*`
capability 和 `accounts.*` 命令。迁移完成后，Codex 账号状态是插件私有域：renderer 通过插件 RPC
读取快照和订阅事件，宿主只提供插件运行、密钥、安全持久化、路径和进程环境等通用能力。

### Managed 官方外部插件模块 `src/main/services/managed-plugins/`

受管理官方插件的安装底座（本分支交付）：

- 契约在 `src/shared/contracts/managed-plugin.ts`
- 签名根：Ed25519 公钥硬编码在 `official-index.ts.OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID`；索引 canonical JSON + 签名校验先于 strict schema
- 安装路径固定 `{userData}/plugins/{index.json,installed/<id>/<version>,staging,work/<id>}`；`installed/<id>/<version>` 不可变；staging → temp sibling → atomic rename
- 生产环境无条件忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 和持久化的 `devOverride` 路径
- **插件模式（终态，对齐 VS Code extensionDevelopmentPath 思路）**：
  - `PIER_PLUGIN_MODE=workspace|release`（生产打包恒为 `release`；dev 默认 `workspace`）。
  - worktree 配置 `.pier-dev/plugin-workspace.json`（示例见 `.pier-dev/plugin-workspace.example.json`）：
    `{ "mode": "workspace", "roots": [{ "id": "my.plugin", "path": "../my-plugin" }] }`。
  - **workspace**：安装只用本地 `dist-pkg`；启动自动装回未安装的 first-party；`devOverride` 钉到 first-party 包与自定义 `roots`；禁用官方 Update/检查更新（GitHub release 不得覆盖本地）。
  - **release**：行为接近生产（官方索引 / HTTP）；即便在 electron-vite 下设 `PIER_PLUGIN_MODE=release` 也可模拟生产安装。
  - **自定义插件开发（友好路径）**：
    1. 在仓库外或 monorepo 旁建插件目录，含完整 `plugin.json`（`id` 与 roots 一致）+ 构建产物 `dist/main.js` / `dist/renderer.js`。
    2. 在 `.pier-dev/plugin-workspace.json` 的 `roots` 增加 `{ "id": "<plugin.json id>", "path": "<相对 cwd 或绝对路径>" }`。
    3. 重启 `pnpm dev`：宿主 path-seed 索引项 + `devOverride`，无需官方 tgz / GitHub。
    4. 生产包仍禁止任意第三方加载；本路径仅 workspace/dev 运行时，正式分发须走官方 managed 管线。
- 命令授权走 `CommandMetadata.allowedClientKinds`：`plugin.catalog.list` 允许 `desktop-renderer` + `cli-local`；其它 managed 命令 + `app.relaunch` 只允许 `desktop-renderer`
- 插件 RPC 走独立 IPC 通道（`PIER.PLUGIN_RPC_INVOKE`），不进 `PierCommand`、不经 CLI local-control

### 退役官方插件彻底不可见

退役 id 在产品里彻底不可见：签名官方索引不卖、设置已安装/未安装不出现、不能安装。宿主 `RETIRED_MANAGED_PLUGIN_IDS` 挡住旧缓存索引；`generate-plugin-index` 合并历史条目时丢掉退役 id。改名（`pier.tmux` → `pier.agent-splits`）与折入宿主（语言包）同一纪律，不做「已退役」灰名、不双卖。

权威规格：[`docs/superpowers/specs/2026-09-04-retired-managed-plugin-invisibility-gold-standard.md`](docs/superpowers/specs/2026-09-04-retired-managed-plugin-invisibility-gold-standard.md)。  
检查点：`tests/unit/main/plugins/retired-plugin-invisibility-governance.test.ts`。

### 项目设置贡献点 `projectSettings`

插件可经 manifest `projectSettings` 声明 + renderer 运行时 `context.projectSettings.register` 注册「设置 → 项目」详情 tab：

- 纪律链与 `panels` / `settingsPages` 一致：`assertDeclaredContribution("projectSettings")` → `src/renderer/lib/plugins/project-settings-registry.ts` → `ProjectsSectionDetail` 渲染
- 宿主按 `visible({ isPierHome })` 过滤；省略 `visible` 时默认 `!isPierHome`
- 插件不自列项目、不挂侧栏 `settingsPages` 充当项目偏好；`projectRootPath` 由宿主 focused 项目传入
- contribution `id` 必须带插件 id 前缀（`pluginManifestSchema` superRefine）

### 插件数据投影与 Canvas 动作

宿主给通道和积木；`.canvas.tsx` 是唯一组装层。Canvas **不承载领域组件**（无 `AccountsCard` / `UsageMeter` / `Kpi` / 账号成品模板），也不增加 `canvasWidgets` 或复活 `workbenchWidgets`。

- Manifest：`dataProjections` 声明可投影只读键；`canvasActions` 声明画布可调用的 RPC 方法名。纪律链与 `panels` 同款：未声明键一律拒绝。
- 读：`pluginData.snapshot` → 插件 RPC `projection.<key>`；renderer 经 `useHostSnapshot("plugin:<pluginId>/<key>")` 订阅广播，类型为 `unknown`，画布本地收窄。禁止 `useCodexAccounts` 一类插件 hook，禁止把三家 snapshot DTO 写进 `pier/canvas` sdk。
- Watch 租约：`pluginData.watchStart` / `watchStop` 按 **全键（基键 + 规范化 params）** 计数；声明校验按基键。`useHostSnapshot("plugin:<id>/<key>?repo=…")` 把 query 拆成 params。禁止把 `?` 后整串当投影键。
- 写：仅 `pluginAction.invoke` `{ pluginId, key, payload? }`，方法名即声明键（不加 `projection.` 前缀）。能力 `plugin:action`；宿主命令路径不出现业务键字符串。
- **Applets**：`manifest.applets` 声明源码积木（id 必须带插件前缀）。画布 `import X from "@pier-applet/<pluginId>/<appletId>"`；编译围栏第二根是 applet 目录。`.applet.tsx` 不是 live-module canvas 入口后缀。类型文件由 `scripts/generate-canvas-applet-types.mjs` 生成到 `.pier/types/applets.d.ts`，不启动宿主也能 typecheck。authoring 发现走 `pier plugins applets [id]`（`plugin.applets`，`cli-local`）。
- Chrome：`settings.open` `{ section?: string }` 打开宿主设置（插件 CRUD / OAuth 仍在设置页，Canvas 不复制登录流）。`usageData.refresh` 刷新宿主用量聚合。
- 宿主聚合 hook 只读：`useActivityOverview` / `useSystemResources` / `useCostOverview`。`useSystemResources` 不可删：`useHostSnapshot("resources")` 不含 `cpuHistory`。禁止再为插件加第四个 hook。
- 格式化函数进 `pier/canvas` VALUE 导出（`formatPercent` / `formatBytes` 等），不是组件。
- skill 只教发现 API + 原语组合（至少两种拼法）；不设官方 `templates/accounts.canvas.tsx`，物料页不登记「账号管理」行。

检查点：plugin-data-projections、canvas-host、canvas-hooks、只读例外治理。

### 滚动条外观

产品滚动条必须是同一条滑块。权威规格：[`docs/superpowers/specs/2026-08-19-scrollbar-visual-gold-standard.md`](docs/superpowers/specs/2026-08-19-scrollbar-visual-gold-standard.md)。

- 空闲透明；滚动或槽位悬停显现。颜色走不透明 `--shell-scrollbar-thumb`。
- 检查点在 `tests/unit/renderer/styles/scrollbar-visual-governance.test.ts`。

## 04 项目命令

- 安装依赖：`pnpm install`
- Electron 桌面开发：`pnpm dev`（或 `pnpm electron:dev`）
- 类型检查：`pnpm typecheck`
- Lint + Format：`pnpm lint` / `pnpm lint:fix`
- 完整检查：`pnpm check`（typecheck + lint + depcruise + file-size + dir-density + unit + component 测试）
- **推送前正确性（默认 pre-push）**：`pnpm preflight:push`（static + unit + component + plugin-index）。目标 **CI 一次绿**；禁止用远程 coverage 当调试器。
- 合 main / 发版前：`pnpm preflight:ci`（+ coverage 棘轮 + build）；mac native：`pnpm preflight:full`
- 单文件行数：`pnpm check:file-size`（硬上限 500 行）
- 目录密度：`pnpm check:dir-density`（单目录直接源码文件硬上限见 `.pier/dir-density.json`；资源目录 skip，过渡债 allowlist 棘轮）
- 单元测试：`pnpm test` / `pnpm test:unit`；组件测试：`pnpm test:component`；覆盖率：`pnpm test:coverage`
- E2E 测试：优先 `pnpm test:e2e:auto`（见下节）；强制本机仍可用 `pnpm test:e2e`
- 构建：`pnpm build`（electron-vite build）
- 会合云本地：`pnpm dev:relay`（默认 `:8787`）；桌面联调 `PIER_RELAY_URL=ws://127.0.0.1:8787 pnpm dev`。操作说明 [`apps/relay/README.md`](apps/relay/README.md)
- 会合云 / Web 壳发布：tag `relay-v*` / `mobile-web-v*`（见 [`docs/release.md`](docs/release.md)）
- 图标重建：`pnpm build:icons`（母版 `build/app-icon-source.svg`）

### E2E 执行优先级（编码助手硬约定）

Pier e2e 会启动真实 Electron 窗。禁止在未探测闲置机的情况下把全量 e2e 默认打在主力机上。默认 `pnpm test:e2e:auto`。步骤与装机见 [`docs/development.md`](docs/development.md) 与 `scripts/e2e-runner/FIRST-BOOT.txt`。

### 新机首次 clone → dev 一键：`pnpm bootstrap`

人类步骤见 [`docs/development.md`](docs/development.md)。新 clone：`pnpm bootstrap`。CI：`BOOTSTRAP_YES=1 pnpm bootstrap`。

### 已有 worktree 首次启动 checklist

git worktree **不复制** `node_modules` 与 `native/build/`。第一次进 worktree 必须先 `pnpm setup:worktree`。细节见 [`docs/development.md`](docs/development.md)。

### 打包分发（`pnpm build:dist`）

步骤与公证凭证见 [`docs/app-release.md`](docs/app-release.md) 与 [`docs/development.md`](docs/development.md)。默认 `pnpm build:dist`；只签名不公证加 `--no-notarize`。

## 04b 目录密度与命名（强制门禁）

与 `check:file-size` 并列的静态门禁：`pnpm check:dir-density`（已挂入 `check:static`）。

### 密度

- 配置：`.pier/dir-density.json`（`maxDirectSourceFiles` 硬上限默认 40；`softCap` 告警；`skipDirPatterns` 跳过资源目录；`allowlist` 仅过渡债且 `max` 为棘轮）。
- 扫描：`src/`、`packages/*/src`、`tests/` 每个目录的**直接** `.ts/.tsx/.js/...` 文件数（不含子目录、不含 `.d.ts`）。
- 超过硬上限且不在 allowlist → 失败；allowlist 条目的实际数量不得超过 `max`；数量已 ≤ 硬上限时必须删除该 allowlist 条目（防陈旧白名单）。
- 资源类目录（`favicons`、`locales/**`、`status-traces`、`fixtures`、`resources` 等）走 skip，不计入。
- 拆分优先按**领域/功能**分子目录，不要按技术层无限堆 `hooks/`/`utils/`。

### 命名（去冗余）

目录已经表达领域时，**文件名不得再重复父目录语义**：

| 禁止 | 应为 |
|------|------|
| `services/git/git-service.ts` | `services/git/service.ts` |
| `ipc/terminal/terminal-create-handler.ts` | `ipc/terminal/create-handler.ts` |
| `review/git-review-document-loader.ts` | `review/document/loader.ts`（或 `review/document-loader.ts`） |
| `diff-view/diff-view-items.ts` | `diff-view/items.ts` |
| `host/host-context.ts` | `host/context.ts` |
| `commands/file-commands.ts` | `commands/file.ts` |

- 入口文件优先 `index.ts` / `index.tsx`，不要 `foo/foo.ts`。
- React hooks 在 `hooks/` 下可保留 `use-` 前缀，但应去掉领域重复段（`hooks/use-git-review-x.ts` → `hooks/use-x.ts`）。
- 角色与目录名不同时保留角色词（例如 `services/git/worktree-service.ts` 在迁入 `worktree/` 后变成 `worktree/service.ts`）。
- 一次性迁移脚本已归档至 `scripts/archive/`（`reorg-*` / `rename-strip-*`）；日常只跑 `pnpm check:dir-density` 与治理单测，勿再依赖 one-shot 作为门禁。
- 检查点：`tests/unit/scripts/dir-density-governance.test.ts`。

## 05 安全边界

- Git 默认只读。除非用户明确要求，不创建 commit、分支、PR 或 push。
- 需要 commit 时，先 stage 明确路径，展示 `git diff --staged` 和拟用 Conventional Commits message，等待用户确认。
- 禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend` 和 force-push。
- 不要用 `@ts-ignore`、`@ts-expect-error` 或 `as any` 压制类型错误。

## 06 设计稿与 UI 交付纪律（编码助手硬约定）

规格是合同，产品组件是视觉真源，测试是记忆。评审意见只留在对话里等于没提。

1. **先列表，后动手。** 改任何有规格的 UI 前，先把规格里涉及该表面的每一句抽成检查项，加上本文适用治理（密度、焦点、颜色、shadcn、文案、合成），交付时附逐项结果。没有检查表的 UI 改动不进评审。
2. **留白即停下。** 规格沉默处不得用「看起来合理」的默认值补齐（图标、chrome、徽标、入口、分组形态）；列为「未决」交决策，写进规格后再实现。
3. **偏离先改规格。** 认为规格错了，先改规格或在规格里写偏离记录，再改代码；禁止在画布描述、注释、提交说明里静默偏离。
4. **产品原语优先，禁止手绘复制。** 图标用 lucide / `AgentIcon` / `PierFileIcon`，事实用产品既有组件（如 `GitChangeSummaryInline`），几何用单一来源常量（行高、缩进步长、字形尺寸）。媒介不允许 import 产品原语时，该媒介只能做 IA 示意，不得充当视觉真源。
5. **画布不是金标准。** `.pier/canvases/*` 设计稿只表达结构与状态；视觉真源是产品组件；治理测试不得把画布当对照物。
6. **能算的先算，只能看的必须看。** 缩进阶梯、行高、字号先算数核对；对齐、对比度、光学重量、截断只能靠渲染截图（人眼 + 模型读图）判定，不得凭源码推断宣称通过。UI 改动交付附截图。
7. **意见变断言。** 每条被接受的评审意见落成测试断言或规格文字，否则视为未处理。

检查点：`tests/unit/docs/ui-delivery-discipline-governance.test.ts`（锁本节标题与七条编号；侧栏具体断言在 `tests/unit/renderer/workbench/`）。
