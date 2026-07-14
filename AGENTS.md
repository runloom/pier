# Pier Agent Context

本文件是开发 Pier 时给 Claude Code、Codex 和 OpenCode 共用的项目级上下文。

## 01 项目定位

Pier 是本地 AI 开发工作台。参考 loomdesk 产品形态，使用 bay 的工具链栈重写。

- 核心能力：稳定终端、dockview panel 布局、代码变更预览、文件查看、多 agent 状态可见性。
- 不做：任务生命周期、SQLite 任务台账、看板、自动调度。
- 持久化分层：用户偏好/布局写 userData JSON；原始终端输出写 transcript 分段文件；代码变更实时读 Git；密钥走 safeStorage。

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

宿主级确认/提示弹窗统一走 `src/renderer/components/common/app-dialog-host.tsx`：

- 业务代码不要直接 import `@pier/ui/alert-dialog.tsx`；宿主 renderer 使用 `showAppConfirm` / `showAppAlert`，插件使用 `RendererPluginContext.dialogs`。
- 短确认弹窗必须显式传 `size: "sm"`，例如退出确认、打开 Review、删除/撤销/丢弃类确认。
- 只有需要承载较长说明、错误详情或复杂内容的弹窗才显式传 `size: "default"`。
- 破坏性确认必须显式传 `intent: "destructive"`，普通确认显式传 `intent: "default"`；不要在 `AppDialogHost` 里按标题、按钮文案或业务字符串猜测危险程度。
- `showAppAlert` 可保持默认尺寸，用于错误详情时避免把长输出塞进小弹窗；短 alert 如需小尺寸应由调用方显式传 `size: "sm"`。
- 检查点在 `tests/unit/renderer/app-dialog-governance.test.ts`：锁定文档存在、禁止绕过 `AppDialogHost` 直接使用 shadcn `AlertDialog` primitive，并要求 confirm API 的 `size` / `intent` 保持必填。

### 操作反馈规范

所有用户触发的动作必须有可识别的完成或失败信号，静默失败（`catch (err) { console.error(...) }` 就结束）一律禁止。选择反馈方式时按以下顺序判断，防止漏报也防止重复：

- 已经有**强自然 UI 反馈**（列表新增/删除、导航切换、Modal 关闭、面板打开、表单值即时更新等）→ **不再加 toast**；重复反馈是噪声。
- 只有**弱 UI 反馈**（Save 按钮从 enabled → disabled、dirty 位清零等）或**完全无 UI 反馈**（写盘、无 refetch 的写请求、后台任务触发） → 成功走 `toast.success(t("..."))`。
- 短失败（用户能从 title 理解、无技术详情）→ `toast.error(t("...Failed"))`。
- 带技术详情的失败（`Error.message`、IPC 错误串、多行说明）→ **直接** `showAppAlert({ title: t("...Failed"), body: err instanceof Error ? err.message : String(err) })`，禁止 `toast.*(…, { description })`。`console.error` 不面向用户，只能作为额外日志。
- Toast 复用 `sonner`（胶囊短 title；可选 action 如撤销）；宿主代码从 `sonner` 直接 `import { toast }`，插件走 `context.notifications.{success,error}`；文案必须走 i18n key，禁止内联字符串。

**代码审查检查点**：
- 每个 `onClick` / `onSubmit` / async mutation 都要能回答"用户怎么知道刚才发生了什么"。答不出 → finding。
- 遇到 `catch` 里只有 `console.error` / `console.warn` 而没有 `toast.error` / `showAppAlert` → finding，除非注释里明确说明不面向用户的路径（如启动阶段 boot log）。
- 遇到"有明显 UI 变化 + 又加了 toast"的双反馈 → minor finding，建议删掉冗余 toast。
- 遇到内联 toast 文案字符串（未走 i18n） → finding。
- 遇到 `toast.*(…, { description })` → finding，详情应走 `showAppAlert`。

### 交互控件密度规范

Pier 桌面端的单行交互控件统一使用 28px 高度：

- 高度所有权在 `packages/ui/src/interactive-density.ts`；基础控件消费统一定义，业务代码不得用 `h-8`、`h-8!` 或额外纵向内边距把标准控件恢复到 32px。
- Button、Input、InputGroup、Select trigger、Toggle、Tabs、Menubar、命令面板输入框和同类单行控件默认高度为 28px；纯图标默认控件为 28×28px。
- Select、Dropdown Menu、Context Menu、Menubar、Command 和 Navigation Menu 的内容型选项统一使用“最小 28px”：单行必须为 28px，多行说明可按内容自然增高，禁止为了固定 28px 裁切文字。
- `asChild` 触发器由子控件持有尺寸；应优先组合 `@pier/ui` 的 Button 等统一控件，不在业务层复制高度。
- Textarea、卡片内容、头像、骨架内容块、导航分组标题等非单行交互控件不适用本规则。
- 检查点在 `tests/unit/renderer/interactive-density-governance.test.ts`；新增通用交互原语必须接入统一密度定义，例外必须在测试中说明原因。

### 颜色使用规范

产品界面颜色按“主题原色 → 语义令牌 → 组件变体 → 业务映射”单向使用：

- `src/renderer/app/globals.css` 是产品 UI 调色板和语义令牌的唯一所有者。`info`、
  `success`、`warning`、`destructive`、`done` 不随编辑器或终端主题改变。
- `src/renderer/lib/theme/` 只负责中性外壳、主强调色、图表序列和终端 ANSI 色派生，
  不得重新派生产品状态色。
- `packages/ui` 组件只消费 `background`、`foreground`、`status-*`、`action-*` 等
  语义令牌；业务代码只选择语义，不持有具体颜色值。
- 普通动作使用 `action-accent`，破坏性动作使用 `action-danger`，结构性控件使用
  `action-muted`；不要用成功绿表达导航或普通按钮。
- 业务源码禁止新增十六进制、`rgb()`、`hsl()`、`oklch()` 和 Tailwind 固定色阶。
  允许的例外只有主题/终端颜色引擎、原生窗口启动兜底、第三方图表选择器和品牌图标。
- 检查点在 `tests/unit/renderer/color-token-governance.test.ts`，新增颜色例外必须同时说明
  所有权和无法使用现有语义令牌的原因。
- 对比度治理分层：Tier 1（严格 WCAG 4.5:1）覆盖正文、toast 容器、shimmer 文字，
  两个主题都强制；Tier 3（设计决策）覆盖暗色主题 badge 内 glyph 对比度——
  `:root` 使用亮色状态色 + 统一亮色 `--status-solid-foreground`，WCAG 亮度公式
  报告 1.6–2.7（低于 3:1），但 glyph 是简单形状、暗色 surround 提升感知亮度、
  色相对比提供额外辨识线索，由设计决策覆盖，测试只验证 token 存在。如设计
  变更需恢复严格检查，把 `:root` 加回 Tier 1 循环。

### shadcn 组件使用规范

宿主 renderer 与官方插件 renderer 的业务界面统一以 `packages/ui` 中的 shadcn 组件为
组合边界：

- 头像必须使用 `Avatar` 并提供 `AvatarFallback`；有独立卡片标题的卡片使用完整的
  `CardHeader` / `CardContent` 组合。设置页一级标题位于卡片外，不得为了补齐
  `CardHeader` 把页面标题移入卡片；列表项、提示、空态、进度、骨架和分隔线分别使用
  `Item`、`Alert`、`Empty`、`Progress`、`Skeleton` 和 `Separator`。
- 表单使用 `FieldSet` / `FieldGroup` / `Field`；输入内附加元素使用 `InputGroup`；
  选项组使用 `ToggleGroup`。业务代码不得直接渲染原生 `input`、`select`、`textarea`
  或 `hr`。
- `SelectItem`、菜单条目、`CommandItem` 和 `TabsTrigger` 必须处于对应 Group / List
  容器中；对外拆出的条目渲染函数也必须由调用方在同一文件内提供容器。
- Button 和菜单中的图标不设置尺寸类，由组件变体控制；Button 图标必须声明
  `data-icon`。组件 `className` 只承担布局、尺寸约束和交互状态，不覆盖组件色彩或字体。
- 不得用上一条机械删除产品语义：命令、路径、环境变量和格式标识继续使用等宽字体，
  `Kbd` 只表示键盘输入；终端状态栏、搜索栏和响应式物料可保留已验证的紧凑几何。
- 禁止 `space-x-*` / `space-y-*`、`className` 模板字符串、手写加载占位、提示卡、
  徽标和普通交互按钮。条件类统一走 `cn()`。
- 允许保留专用渲染：Dockview tab 原生动作、shadcn Sidebar 自身实现、终端/调试几何
  画布、图表及物料静态预览。这些例外不得扩展为普通业务表单或信息卡。

检查点在 `tests/unit/renderer/shadcn-governance.test.ts`；新增例外必须写明组件边界和
无法使用现有 shadcn 原语的原因。

### 前台活动模块 `src/main/services/foreground-activity/`

统一 agent / task / shell / idle 四态活动聚合器：

- 契约在 `src/shared/contracts/foreground-activity.ts`（`ForegroundActivity` discriminated union）
- broadcast 通道 `pier://foreground-activity:changed` 是 renderer 侧 canonical UI 状态源
- 双源迁移已完成：老 `agent-session` broadcast 已下线，此通道是唯一活动广播源
- 模块内不 import `services/agents/`（agent 只是 activity 的一种 kind，边界单向）
- Agent 提供方（Provider）原生 session / transcript 只可作为对应适配器内部的兼容输入；宿主不提供公共 Transcript capability、读取 API、统一存储、索引或回放

### 路径锚点上下文 `src/main/services/panel-context-resolver.ts` + `src/shared/contracts/panel.ts`

- `PanelContext.projectRootPath` 是当前工作区路径锚点：Git 项目优先为 `gitRoot`，非 Git 目录为 `cwd`。
- `contextId` 由 `worktreeKey` 稳定派生，用于面板上下文身份；任务、终端和插件上下文不再依赖额外 `projectId`。
- 主体不维护 `Project` 注册表，也不把 `projectId` 作为跨模块外键；需要项目粒度能力时优先使用 `projectRootPath` / `gitRoot` / `worktreeRoot`。

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
- 命令授权走 `CommandMetadata.allowedClientKinds`：`plugin.catalog.list` 允许 `desktop-renderer` + `cli-local`；其它 managed 命令 + `app.relaunch` 只允许 `desktop-renderer`
- 插件 RPC 走独立 IPC 通道（`PIER.PLUGIN_RPC_INVOKE`），不进 `PierCommand`、不经 CLI local-control

### 工作台组件贡献点 `workbenchWidgets`

插件可经 manifest `workbenchWidgets` 声明 + renderer 运行时 `context.workbenchWidgets.register` 注册工作台卡片组件：

- 纪律链与 `panels` / `terminalStatusItems` 一致：`assertDeclaredContribution("workbenchWidget")` → 运行时注册表 → 宿主容器渲染
- 注册表在 `src/renderer/lib/plugins/plugin-workbench-widget-registry.ts`（镜像 `plugin-panel-registry.ts` 结构）
- Core-owned widget 走 `CORE_WORKBENCH_WIDGETS` 静态声明（平行于 `CORE_TERMINAL_STATUS_ITEMS`），不经插件通道
- 工作台 panel 为 core panel kit（`component: "workbench"`，多实例 `workbench-<uuid>`），组装状态存 dockview panel params 随 layout 持久化

#### 物料协议 v3（响应式有序网格）

- 持久化参数 `{layoutVersion: 3, widgets: [{id, widgetId?, params?, w, h}]}`：数组顺序是唯一阅读顺序；`w/h` 是用户尺寸偏好；`x/y` 只在渲染期按容器宽度派生，不持久化。`id` 是实例 id（多实例物料为 uuid），`widgetId` 是物料 id；`params` 是物料私有配置，宿主视为黑盒 JSON，校验责任在物料边界。
- 旧版 `x/y/locked/placementDirection` 只在读取时转换：条目按 `y → x → 原始索引` 得到稳定顺序，废弃字段不进入 v3。打开面板不得主动写回；首次添加、删除、排序、调整尺寸或设置修改时自然写入 v3。
- 组件 props：`size / instanceId / params / updateParams / refreshToken / visible`。拉取型物料把 `refreshToken` 放进 effect 依赖；`visible=false` 时**必须停轮询**（数据源用 acquire/release 引用计数，参考 `system-stats.store.ts`）。
- 声明元数据：`category`（物料库分类）、`searchTerms`（搜索命中面）、`multiInstance`（可复制/重复添加）、`configurable`（注册时须提供 `settingsComponent`，渲染进宿主设置弹窗）、`refreshable`（菜单显示"刷新"）；注册可带 `previewComponent`（物料库预览卡，样例数据静态渲染）。
- 添加入口是物料库对话框（分类 + 搜索 + 预览），不是下拉菜单；空态和底部添加入口只打开物料库，不提供快速开始预设。
- 指标目录（`src/renderer/lib/workbench/metric-registry.ts`）：core/插件用代码贡献指标（instant/series/grouped × 格式），"自定义卡片"物料把区块（kpi/gauge/trend/ranking）绑定到指标做用户级组装；不做查询语言、不做自由画布。

#### 物料 UI 质量红线（每个物料 PR 逐条过）

1. 节奏：间距落在 12px 网格节奏；卡内 padding 走 `--card-spacing`。
2. 三态：loading / empty / error 齐备且用 `@pier/ui/widget-state.tsx` 统一组件（`WidgetSkeleton` / `WidgetEmpty` / `WidgetError`），禁止裸文字占位。
3. 响应：窄（2 格）/ 中（4 格）/ 宽（6+ 格）三档 container query 均不破版、不横向溢出；`size` prop 只用于逻辑分支。
4. 主题：深浅色都验收；无硬编码色值；数据色只承载状态与系列，文本一律走前景 token。
5. 数字：一律走 `@pier/ui/format.tsx` 共享 formatter（compact/bytes/percent/duration/relative）；高频跳动数字 `tabular-nums`。
6. 反馈：每个动作能回答"用户怎么知道刚才发生了什么"（操作反馈规范）；文案全部 i18n key。
7. 无障碍：图标按钮有 `aria-label`；拖拽只从显式抓手开始，交互元素必须在拖拽 `cancel` 名单内（`button/a/input/...`），特殊容器用 `[data-no-drag]` 逃生舱。
8. 尺寸适配：`size` prop 做结构决策（是否渲染某区块、图表显示天数/范围），container query 做布局密度（列数、横排↔纵排）；两者不可互换。禁止用 container query `display: none` 静默删除有意义内容（时间戳、余额、次要指标等）——compact 尺寸应摘要化或重排，辅以 tooltip / 渐进式披露保留可访问性。`minSize` 必须能容纳物料核心信息（至少一个指标 + 状态），不得声明小于核心内容所需的最小格数。
9. 重复指标自适应：重复指标是同构且均有意义的数据项，必须保留数据契约中的源顺序和语义标识；只有存在独立标题、操作或说明时才拆成占整行的可见分区，普通指标不得仅因数据分组键不同而强制换行。指标集合优先使用浏览器原生内在尺寸网格 `repeat(auto-fit, minmax(min(100%, var(--item-min-width)), 1fr))`：集合只有单项时占满整行，多项在核心内容最小宽度允许时横排，否则纵向重排。`--item-min-width` 由标签、数值、状态和操作等核心内容共同决定，不得从宿主 `size.w` 换算像素，也不得用固定列数留下空轨道。所有数据必须进入可访问的 DOM，不得按尺寸丢弃、用 `hidden` 隐藏或只保留部分数据；高度不足时保持 `min-content` 并交由宿主滚动，高度富余时按内容自然高度顶部对齐，不得靠居中或拉大项目内部间距伪造填满效果。重复指标之间留白优先于分割线，只有存在无法由标题、标签或间距表达的独立语义章节时才使用 `Separator`。
- 网格几何：`CELL_WIDTH = 88`、`ROW_HEIGHT = 88`、`MARGIN = [12, 12]` 为目标节奏；容器宽度自动换算为 `2..12` 列。布局严格按实例数组做 Z 字逐行排布，当前行放不下即换行，行高取本行最高物料，不用后续小物料回填纵向空洞。删除后由同一派生算法立即压实；添加和复制追加到数组末尾；拖拽只修改数组顺序。
- Dockview 宽度变化只重新派生列数与 `x/y`，不得写 panel params。窄容器可把卡片显示宽度临时夹到当前列数，容器恢复后继续使用原 `w/h` 偏好；普通布局禁止横向滚动。
- 调整尺寸仍由 RGL 处理，停止时只持久化目标实例的 `w/h`；不得把 RGL compactor 与自定义排序求解器混用。全局菜单不提供“整理布局”“锁定布局”或新增方向，自动布局始终生效。
- widget 内容响应的分工：`size` prop 决定渲染哪些区块（结构决策），container query
  决定已渲染区块的排列密度（布局决策）。不要用 `size` prop 换算像素宽度（实际宽度取决于
  容器，非格数）；不要用 container query `display: none` 隐藏有意义内容（违反 WCAG
  Reflow）。注意 containment 会让 `position: fixed` 后代以卡片内容区为包含块——浮层一律
  走 portal（Radix 组件默认如此）。
- 顶部不放工具栏；网格全局动作走原生 Electron 右键菜单（只保留添加、全部刷新），物料级动作仍走卡片 Radix 菜单，两者不得串开。

## 04 项目命令

- 安装依赖：`pnpm install`
- Electron 桌面开发：`pnpm dev`（或 `pnpm electron:dev`）
- 类型检查：`pnpm typecheck`
- Lint + Format：`pnpm lint` / `pnpm lint:fix`
- 完整检查：`pnpm check`（typecheck + lint + depcruise + file-size + unit + component 测试）
- 单元测试：`pnpm test` / `pnpm test:unit`；组件测试：`pnpm test:component`
- E2E 测试：`pnpm test:e2e`
- 构建：`pnpm build`（electron-vite build）
- 图标重建：`pnpm build:icons`（改 `build/app-icon-*.svg` 后跑一次，产出 `build/icon.{icns,ico,png}`）

### 新机首次 clone → dev 一键：`pnpm bootstrap`

`scripts/bootstrap.sh` 会依次预检 & 安装依赖，然后调 `setup:worktree`：

```bash
git clone <repo> && cd pier
pnpm bootstrap        # 预检 Xcode CLI / brew / zig@0.15 / pnpm / node → pnpm install → setup:worktree
pnpm dev              # 起 Electron dev
```

CI / 无交互场景：`BOOTSTRAP_YES=1 pnpm bootstrap` 缺依赖直接自动装。

### 已有 worktree 首次启动 checklist

git worktree **不复制** `node_modules` 也不复制 `native/build/`。第一次进 worktree 必须先：

```bash
pnpm setup:worktree   # 用 pnpm store 建立本地 node_modules + 补 GhosttyKit.xcframework + 编译 native addon
pnpm dev              # 否则 panel 内会报 "Cannot find module .../ghostty_native.node"
```

`setup:worktree` 内部：

1. 建立 worktree 自己的 `node_modules` 布局，包内容由 pnpm store 去重复用；旧版主仓软链会自动迁移
2. 若 `native/Vendor/libghostty-spm/GhosttyKit.xcframework/` 缺失（首次 clone / 新电脑）自动跑 `pnpm build:libghostty`——**首次约 3-5 分钟**（含 fetch ghostty 上游、apply patches、跨 arch build），后续增量 60-90s
3. native addon（`ghostty_native.node` + `libGhosttyBridge.dylib`）过期则重编，约 30s

如旧 worktree 仍把整个 `node_modules` 软链到主仓，pnpm 11 可能在进入
`setup:worktree` 脚本前就因依赖状态路径不匹配而中止。这种旧状态只需一次性执行
`node scripts/setup-worktree.mjs` 完成迁移；之后继续使用 `pnpm setup:worktree`。

`pnpm build:libghostty` 依赖：
- `brew install zig@0.15`（硬要求 zig 0.15.2）
- `xcode-select --install`

产出：`native/Vendor/libghostty-spm/GhosttyKit.xcframework/` universal（arm64 + x86_64）。xcframework 二进制不入库；patches 在 `native/Vendor/libghostty-spm/Patches/ghostty/` 下按 `0100-` 起编号（Lakr233 的 `0001-0010` 由 `.libghostty-spm-src/` 里的仓提供）。

`pnpm dev` 的 `predev` 阶段也已加 native addon 存在性守卫，缺了会清楚提示去跑 `pnpm setup:worktree`，不会进 Electron 后才在 panel 内炸。

### 打包分发（`pnpm build:dist`）

`build:dist` 走 `scripts/build-dist.sh`：加载 `electron-builder.env` → `NATIVE_ARCHS="arm64 x86_64" pnpm build:native` → `pnpm build:electron` → `electron-builder --mac --arm64 --x64 --publish never`。

- **native 分层**：`libGhosttyBridge.dylib` 和 `ghostty_native.node` 逐 arch 编译再 `lipo -create` 成 universal fat（GhosttyKit.xcframework 本身已 universal）。dev 不打 dist 时 `pnpm build:native` 默认只编 host arch，快。
- **electron-builder**：`electron-builder.yml` mac target `arch: [arm64, x64]`，产出两个 dmg（`Pier-<ver>-arm64.dmg` + `Pier-<ver>.dmg`）。universal native 二进制两份 dmg 都能吃。
- **产物**：`dist-builder/` 下的两个 dmg。Apple Silicon 用户下 `-arm64.dmg`，Intel 用户下不带 arch 后缀那个（electron-builder 对 x64 dmg 默认不带 suffix）。
- **首次约 30 分钟**（native 85s + electron-vite 5s + 每 arch rebuild/pack/sign/notarize 各 ~15 分钟串行）；之后增量 ~20 分钟。
- **只签名不 notarize**（本机测/CI 无 notarize 凭证）：`pnpm build:dist --no-notarize`。

#### 新机器上首次打包 checklist

`pnpm bootstrap` 只解决**编译依赖**（zig / Xcode CLI / pnpm / native addon）；签名 + notarize 凭证得手动补：

1. **签名证书**（`Developer ID Application`）：
   - 源机 Keychain Access → 找证书 → 右键 Export → `.p12`（设导出密码）→ 传目标机 → 双击导入。
   - 或去 Apple Developer 后台各自申请（Team ID 会变）。
   - 验证：`security find-identity -v -p codesigning` 能看到 `Developer ID Application: ...` 一行。
2. **notarize keychain profile**：
   ```bash
   xcrun notarytool store-credentials pier-notarize \
     --apple-id "<your-apple-id>" \
     --team-id <TEAM_ID>
   # 交互式提示 Password，粘贴 app-specific password（appleid.apple.com 生成，可重用）
   ```
   验证：`xcrun notarytool history --keychain-profile pier-notarize` 不报 profile 缺失即可。
3. **`electron-builder.env`**（gitignored，每台机各建）：
   ```
   APPLE_KEYCHAIN_PROFILE=pier-notarize
   APPLE_TEAM_ID=<TEAM_ID>
   ```
   `<TEAM_ID>` 换成签名证书括号里的 10 位。
4. `pnpm build:dist`。
## 05 安全边界

- Git 默认只读。除非用户明确要求，不创建 commit、分支、PR 或 push。
- 需要 commit 时，先 stage 明确路径，展示 `git diff --staged` 和拟用 Conventional Commits message，等待用户确认。
- 禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend` 和 force-push。
- 不要用 `@ts-ignore`、`@ts-expect-error` 或 `as any` 压制类型错误。
