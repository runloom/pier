# 插件详情页重构 · 设置贡献点 · 终端状态栏用户控制 — 设计文档

日期：2026-07-02
状态：已修订（吸收干净视角评审：2 blocker / 5 major / 11 minor）

## 变更记录

### 2026-07-03 — §3.1 取舍反悔：删除详情展开区

调研 7 家（VSCode/JetBrains/Chrome/Obsidian/Raycast/Zed/Neovim）后确认：Pier 当前所有插件均为 `builtin` source，详情页的每一区块对内置插件都是冗余（命令走 Command Palette；设置有 Sidebar 独立入口；面板/状态项本身可见；权限对一方代码无信任门禁需求；元数据全为 Pier v1.0.0 无信息量）。§3.1 的“保留行内 Collapsible 展开”在这种信息量下被证伪。

新决策：Plugins 列表页每行以一行摘要（图标+名字+状态+计数+设置内链）呈现，不做展开区；未来出现非 builtin source 时再按 VSCode/JetBrains 3-tabs 方案实现独立详情页。

## 1. 背景与目标

当前插件详情页（`src/renderer/pages/settings/components/plugin-details.tsx`）用 badge flex-wrap 铺排贡献点，pier.git 的 13 个命令挤成难以扫读的瀑布；插件系统没有设置项（configuration）贡献点；终端状态栏项只有运行时注册对象上的数字 `order`，无左右分组、无用户级显隐与排序。

目标（三个独立可交付的工作流 + 一个共同前置）：

0. 前置设施：renderer 侧响应式插件列表镜像 store + 插件启停广播。
1. 详情页信息架构重构 —— 贡献点用分区紧凑表格展示。
2. 新增 `configuration` 贡献点 —— schema 驱动的插件设置，自动扩展设置对话框。
3. 终端状态栏 —— 左/右分组 + 用户级显隐与排序覆盖。

### 调研结论（依据 VSCode 官方文档/源码与 JetBrains SDK）

- VSCode Features tab：每类贡献点注册数据驱动 renderer（表格 headers+rows），无贡献则整类隐藏。
- `contributes.configuration`：JSON Schema 驱动设置 UI（boolean→checkbox、enum→dropdown、string/number→input），settings.json 只存用户改过的值；扩展经 `getConfiguration().get()` + `onDidChangeConfiguration(affectsConfiguration)` 读取/监听。扩展详情页不放编辑控件，只跳转到中央 Settings Editor。
- 状态栏：VSCode 为 `Left/Right` alignment + 数字 priority（方向语义模糊是十年悬案 issue #18458）；JetBrains 为声明式相对顺序。两家都支持用户右键显隐（按 item 的 id/name 识别），都不支持用户级重排（呼声高、常年搁置）。

### 已确认的取舍

- 设置作用域：**仅应用级**（userData JSON），不做项目/工作区级。
- 状态栏用户控制：**左右分组 + 显隐 + 设置页排序** 全量做。
- 详情页布局：**保留行内 Collapsible 展开**，展开内容表格化，不做独立详情页。
- 设置编辑面：**设置对话框是唯一编辑入口**，插件详情页只读 + 跳转。
- 状态栏 order/alignment：**manifest 是唯一声明源**（见 3.3）。

## 2. 范围外（YAGNI）

- 项目/工作区级设置、语言级覆盖、settings sync。
- `markdownDescription`、`deprecationMessage`、`editPresentation`、object/array 类型设置（首版 string/number/boolean/enum 四类）。
- enum 仅支持 string（**有意取舍**：现有原生设置的 select 也全是 string，见 `terminal-section.tsx`；数字档位类设置将来以 string enum 表达或届时扩展）。
- 远程插件市场相关（评分/下载数/README tab）。
- 状态栏项在状态栏本体上的拖拽重排（重排只在设置页做）。

## 3. 设计

### 3.0 前置设施：插件列表镜像 store 与启停广播（Phase 2/3 共同依赖）

现状：`settings-dialog.tsx` 导航完全静态；插件列表唯一的 renderer 消费方是 `PluginsSection` 的组件级 `useState`；不存在 main→renderer 的插件启停广播。动态设置导航、状态栏管理块、多窗口一致性都依赖响应式插件数据，故先补：

- **广播**：`PIER_BROADCAST` 新增 `PLUGINS_CHANGED` 通道；main 在插件 setEnabled / registry refresh 后向所有窗口广播（携带最新 registry 快照或触发拉取）。
- **镜像 store**：新增 `src/renderer/stores/plugin-registry.store.ts`（Zustand）——bootstrap 时全量拉取，订阅 `PLUGINS_CHANGED` 更新。
- **消费方收编**：`PluginsSection` 从组件级 state 改读该 store；设置导航动态项（3.2）与状态栏管理块/合并管道（3.3）同样读它。
- preload：`PierWindowAPI` 增加对应订阅入口（沿用 `subscribeIpc` + `PIER_BROADCAST` 常量表模式，`ALLOWED_RENDERER_CHANNELS` 随之派生）。

### 3.1 插件详情页重构（纯 renderer UI）

改动集中在 `plugin-details.tsx`：

- 元数据行保留 ID / 版本 / 发布者，补 `homepage` / `repository` 外链（manifest 已有字段；**pier.git 的 manifest 目前未填这两个字段，Phase 1 需补上**，否则唯一内置插件上无法验证）。
- 新建通用 `ContributionTable` 组件（列定义 + 行数据，text-xs 紧凑密度），每类贡献点一张表，**无贡献则整区隐藏**：
  - 命令表：标题 | ID（等宽）| 分类
  - 面板表：标题 | ID | 描述
  - 终端状态项表：标题 | ID | 描述
  - 设置表（Phase 3 后）：设置名 | 当前生效值 | 描述（只读）+「打开设置」按钮跳转到该插件的设置 section；**插件处于禁用态时按钮 disabled**（其导航项不存在）。
- 权限保留 chips 形式单独一行。
- 移除 `md:grid-cols-2` 双列网格，各区块纵向堆叠。
- 标题/描述继续走现有 i18n resolve（`src/renderer/lib/plugins/display.ts`）。
- 命令「分类」列 i18n：`PluginLocaleMessages.commands` 条目增加 `category?: string`，缺省回落 manifest 裸值。

### 3.2 configuration 贡献点

#### Manifest schema（`src/shared/contracts/plugin.ts`，Zod）

```ts
configuration?: {
  title?: string;   // 设置分组标题，默认插件名（走 i18n）
  properties: Record<string, {
    type: "string" | "number" | "boolean";
    enum?: string[];              // 仅限 type: "string"，存在则渲染下拉
    enumDescriptions?: string[];  // 长度须等于 enum
    default: string | number | boolean;   // 必填，类型须与 type 匹配
    description?: string;
    order?: number;               // 组内排序，缺省按 key 字典序
    minimum?: number;             // 仅 number
    maximum?: number;             // 仅 number
  }>;
}
```

校验规则与位置（违反则该插件走现有 `invalid_manifest` 诊断路径）：

- **`pluginManifestSchema` 顶层 `superRefine`**（需要访问兄弟字段 `id`，不能放在 configuration 子 schema 内）：每个设置 key 必须以 `<pluginId>.` 为前缀。
- configuration 子 schema 内：`default` 类型与 `type` 匹配；有 `enum` 时 `default` ∈ `enum`；`enum` 仅配合 `type: "string"`；`enumDescriptions` 与 `enum` 等长。
- registry 层兜底：**插件 id 之间不得互为点分前缀**（`pier.git` 与 `pier.git.extras` 不能共存），保证平铺 key 的归属与 `affectsConfiguration` 前缀匹配无歧义；前缀匹配一律按点分段精确匹配（`pier.git` 匹配 `pier.git.*`，不匹配 `pier.gitx.*`）。

#### 持久化（main L1）

新增 `plugin-settings.json`，复用 `DebouncedJsonStore` + **照抄 `plugin-state.ts` 的 `ensureStore` 包装模式**（zod 校验层，损坏/不合法即重置默认），flush 挂进 `window-service.ts` 既有的退出 flush 链：

```ts
interface PluginSettingsState {
  version: 1;
  values: Record<string /* settingKey，已带插件前缀，平铺 */, JsonValue>;
}
```

- **只存用户显式设置过的值**；生效值 = 存储值 ?? schema default。「恢复默认」= 删除 key。
- 写入前按当前已启用插件的 schema 校验（类型、enum 成员、min/max），不合法则拒绝。
- 插件被禁用/卸载时**保留**其存储值（与 VSCode 一致）。

#### IPC 与数据流

- main 为唯一数据源。invoke 类走 **PierCommand envelope**（与 plugins 域一致，command 类型加进 `shared/contracts/commands.ts`，错误复用 `PierCommandErrorCode`）：`getAll` / `set(key, value)` / `reset(key)`。
- 变更广播：`PIER_BROADCAST` 新增 `PLUGIN_SETTINGS_CHANGED`（携带 changedKeys + 新值），preload `PierWindowAPI` 增补订阅入口。
- renderer 侧 `src/renderer/stores/plugin-settings.store.ts`（Zustand）镜像：bootstrap 全量拉取 + 订阅广播。设置 UI 与 renderer 插件 API 都从该 store 读。
- **`set()` 的 resolve 语义**：IPC resolve 时 main 内存态已提交（磁盘写仍是防抖异步）；发起窗口的镜像 store 在 resolve 路径**同步更新**，广播用于其它窗口与其它来源——保证插件 `await set()` 后立即 `get()` 读到新值。

#### 插件 API（main + renderer context 同形）

```ts
context.configuration.get<T>(key: string): T;                       // 生效值（用户值 ?? default）；允许读任意插件的 key
context.configuration.set(key: string, value: JsonValue): Promise<void>;   // 仅允许写自己 `<pluginId>.` 前缀的 key
context.configuration.reset(key: string): Promise<void>;                   // 同上所有权约束
context.configuration.onDidChange(
  listener: (e: { affectsConfiguration(prefix: string): boolean }) => void
): () => void;   // 返回注销函数，与现有 register 惯例一致
```

- **所有权约束**：`set`/`reset` 在 context 层断言 key 前缀 = 自身 pluginId（对齐现有 `assertDeclaredContribution` 的"贡献点操作不越权"惯例）；`get`/`onDidChange` 不受限。设置 UI 走 IPC 直连，不经插件 context，不受此限。
- **main 侧改造**：`MainPluginContext` 从无参单例改为 **`createMainPluginContext(entry)` 按插件创建**（所有权断言需要身份）；plugin-settings store 的异步 `init()` 必须在 `MainPluginRuntime.refresh()` 之前完成（在 `host-api.ts` 的 refresh 入口 await），保证同步 `get()` 可用。main context 直读 main store，renderer context 读镜像 store。

#### 设置 UI 自动扩展

- 导航模型拆成两种 variant：**静态项**（现有 `NAV_ITEMS`，label 走 `t("settings.nav.*")`，icon 各自指定）与**插件项**（源自插件列表镜像 store 中已启用且声明了 `configuration` 的插件；label = `configuration.title ?? resolvePluginDisplay().name` 走 manifest i18n；icon 统一用 lucide `Puzzle`）。插件项归入侧边栏新的「插件设置」`SidebarGroup`。
- 通用 `PluginConfigurationSection` 组件按 schema 渲染：`boolean→Switch`、带 `enum→Select`、`string→Input`、`number→Input[type=number]`（min/max 校验）。
- 每行显示：label（i18n，缺省从 key 去掉插件前缀后的**全部剩余段**生成，避免尾段撞名）、description、值 ≠ default 时「已修改」标记 + 恢复默认按钮。
- 修改即写入（经 IPC），无保存按钮，与现有设置页交互一致。
- 插件禁用 → 导航项隐藏；**若 `activeSection` 正指向该插件 section（含多窗口场景），fallback 到 `plugins` section**。重新启用 → 导航项恢复。

#### i18n

`PluginLocaleMessages` 增加：

```ts
settings?: Record<settingKey, {
  label?: string;
  description?: string;
  enumDescriptions?: string[];
}>;
commands 条目增加 category?: string;   // 见 3.1
```

#### 试点

pier.git 增加 1–2 个真实设置（如 `pier.git.statusItem.showDirtyIndicator: boolean`），git-status-item 经 `context.configuration` 消费（`src/plugins` 禁 import main/renderer，链路合规），验证 manifest→存储→API→UI→消费 全链路。

### 3.3 终端状态栏：左右分组 + 用户控制

#### 声明侧 —— manifest 是唯一声明源

manifest 的 `terminalStatusItems` 贡献点增加：

```ts
alignment?: "left" | "right";   // 默认 "left"
order?: number;                 // 默认 0。语义：同侧内 order 越小越靠外侧
                                // （left 组：order 小 → 靠左；right 组：order 小 → 靠右）。
                                // 同 order 按 id 字典序。
```

- **`RendererTerminalStatusItem` 注册对象移除 `order` 字段**（现状 git 插件运行时传 `order: 10`，迁移到 manifest 声明）。消除双声明源；注册对象只保留 `id / isVisible / render`。
- 注册时沿用现有 `assertDeclaredContribution` 校验 `id` 与 manifest 匹配。
- 显隐菜单里的用户可读名 = **manifest 贡献点 `title` 经 `resolvePluginTerminalStatusItemDisplay` i18n 解析**（`display.ts`），不在注册对象上新增字段。

#### 用户覆盖存储（main L1）

新增 `terminal-status-bar-prefs.json`（`DebouncedJsonStore` + `ensureStore` 包装，flush 挂退出链）：

```ts
interface TerminalStatusBarPrefs {
  version: 1;
  items: Record<string /* itemId */, {
    hidden?: boolean;
    alignment?: "left" | "right";
    order?: number;
  }>;
}
```

- IPC：invoke 走 PierCommand envelope（`getAll` / `setItemOverride(itemId, override)` / `resetItem(itemId)`）；广播 `PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED`；renderer 镜像 `src/renderer/stores/terminal-status-bar-prefs.store.ts`。
- 生效值合并链固定为：**用户覆盖 ?? manifest 声明 ?? 默认**（alignment "left"、order 0）。

#### 生效值合并的数据管道

`TerminalStatusItemRegistry` 单例只持有运行时注册对象（`id/isVisible/render`），不做合并。合并发生在**组件层 hook**（`useTerminalStatusBarItems`）：

```
registry（注册对象） × plugin-registry.store（manifest 声明） × terminal-status-bar-prefs.store（用户覆盖）
  → 过滤 hidden → 按生效 alignment 分两组 → 组内按生效 order + id 排序
```

- panel-kits import `src/renderer/stores/` 合规（depcruise 仅禁 panel-kits 互相 import）。
- `hasVisibleTerminalStatusItems` / `visibleTerminalStatusItems` 一并改走该合并结果（含 hidden 过滤），保证外层"有无状态栏"（h-7 高度预留）判断与实际渲染一致。
- `isVisible` 动态可见性逻辑保留，在 hidden 过滤之后执行。

#### 渲染

底部栏布局：`[左组 items…] ←flex-1 spacer→ [右组 items…]`。

#### 交互

1. **状态栏右键** → ContextMenu 勾选列表：逐项 checkbox 显隐（显示 i18n title），底部「管理状态栏…」入口打开设置对话框「终端」section。
2. **设置对话框「终端」section 内新增「状态栏」子块**：左/右两组列表，每项支持组内排序（首版**上移/下移按钮**，不引入 dnd 依赖；若后续需要拖拽再单独评估）、左右迁移、显隐开关、恢复默认（清除该项覆盖）。数据来源 = 插件列表镜像 store 中所有已启用插件 manifest 声明的 terminalStatusItems（含当前未注册渲染的，按声明展示）。

## 4. 架构边界与依赖

- 新增两个 store 均在 main L1（`src/main/state/`），遵守 L1 ⊥ L2/L3/L4；均照抄 `ensureStore` 包装 + 退出 flush 链。
- renderer 一律经 preload IPC 访问；新增三个 Zustand 镜像 store 位于 `src/renderer/stores/`（plugin-registry / plugin-settings / terminal-status-bar-prefs）。
- panel-kits 不跨域 import：终端状态栏读 `stores/` 镜像（合规，有 host-context import stores 先例）。
- `src/plugins` 禁 import main/renderer：试点设置消费只经 `context.configuration`。
- 不引入新依赖。dockview 边界不受影响。

## 5. 错误处理

- manifest `configuration` / `terminalStatusItems` 新字段校验失败 → 现有 `invalid_manifest` 诊断路径（插件标记 invalid，不激活）。
- 两个新 JSON store 损坏或 zod 校验不过 → `ensureStore` 模式重置为默认值。
- `set()` 类型不匹配 / key 未声明 / 越权前缀 → PierCommand envelope error（复用 `PierCommandErrorCode`），renderer toast 提示。
- 覆盖数据指向已卸载插件的 itemId/settingKey → 保留不清理，UI 只展示当前已启用插件的项。
- 设置 section 激活时插件被禁用（本窗口或其它窗口）→ activeSection fallback 到 `plugins`。

## 6. 测试策略

- **Vitest 单测**（参照现有 `tests/unit/preferences-schema.test.ts` 纯函数先例）：
  - configuration schema 校验：前缀 superRefine、default/type 匹配、default ∈ enum、enumDescriptions 等长、插件 id 互为前缀拒绝。
  - 生效值合并纯函数：设置（用户值 ?? default）；状态栏（覆盖 ?? manifest ?? 默认、两组划分、order 语义与 id tie-break、hidden 过滤）。
  - 两个新 store：注入 filePath 测读写与损坏恢复（electron `app` 依赖按 `plugin-state.ts` 同款方式 mock 或经参数注入规避）。
- **E2E（Playwright，沿用 `tests/e2e/agents-settings.spec.ts` 的 `_electron.launch` + 独立 `--user-data-dir` 模式）**：
  - 设置对话框出现插件设置导航项 → 改 boolean 设置 → git 状态项行为变化。
  - 状态栏右键隐藏一项 → 同 userDataDir 二次 launch 验证重启后仍隐藏。
- 每阶段跑 `pnpm check`（typecheck + lint + depcruise + file-size）。

## 7. 实施阶段

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| Phase 0 | 插件列表镜像 store + `PLUGINS_CHANGED` 广播 + `PluginsSection` 收编（3.0） | 无 |
| Phase 1 | 详情页表格化重构（3.1，不含设置表）+ pier.git manifest 补 homepage/repository | 无（与 Phase 0 可并行） |
| Phase 2 | 状态栏：manifest 字段 + 注册对象去 order + prefs store/IPC/广播 + 合并 hook + 右键菜单 + 设置页管理块（3.3） | Phase 0 |
| Phase 3 | configuration 贡献点全链路（3.2：schema、store、envelope 命令、镜像 store、main context 按插件创建、设置 UI 动态导航、i18n）+ 详情页补设置只读表 + pier.git 试点设置 | Phase 0；表格组件复用 Phase 1 |

四个阶段各自独立可交付、可分 PR。
