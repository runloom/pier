# Files 源码编辑器右侧缩略图（Minimap）

**日期**：2026-07-17  
**范围**：`pier.files` 源码编辑器右侧缩略图，以及插件设置开关  
**关联文档**：

- [2026-07-02-plugin-configuration-and-statusbar-design.md](2026-07-02-plugin-configuration-and-statusbar-design.md)（插件 configuration 与设置页）
- [2026-07-17-files-editor-git-gutter-design.md](2026-07-17-files-editor-git-gutter-design.md)（编辑器 Compartment / session 挂载先例）
- 现有实现：`file-editor-view-session.ts`、`file-editor-controller.ts`、`settings.ts`、`manifest.ts` configuration

## 1. 背景与问题

Files 插件源码编辑走 CodeMirror 6（`FileEditorViewSession` + `basicSetup`）。已有：

- 行号 / fold gutter
- 搜索栏
- Git 行级变更条
- 插件 configuration：`autoSave`、树排除 / 忽略可见性

**没有**文档级缩略图（minimap）。长文件导航只能靠滚动条或搜索，缺少 VS Code / Cursor 式右侧鸟瞰。

约束已确认：

| 决策 | 选择 |
|---|---|
| 归属 | 仅 files 插件，不进宿主全局 preferences |
| 形态 | 编辑器右侧 minimap |
| 设置 | 一个 boolean 开关 |
| 默认 | **开** |
| 二级样式 | 不做（固定 blocks + always overlay） |

## 2. 目标 / 非目标

### 目标

1. source 模式 CodeMirror 编辑器右侧显示 minimap（字符块鸟瞰 + 视口覆盖层）。
2. 插件设置 `pier.files.editor.minimap`（boolean，默认 `true`）控制显示。
3. 切换设置后，**已打开**的 source 会话立即 reconfigure，无需关 tab。
4. 深浅色主题可读；颜色只用产品语义 token（禁止业务硬编码 hex）。
5. 声明 + 中英文文案有契约测试；运行时接线对齐现有 configuration 订阅模式。

### 非目标

- characters 显示模式、overlay 仅 hover、宽度 / 缩放自定义
- 大文件行数阈值自动关闭
- git 变更色点映射进 minimap gutter
- preview / rich / image / 冲突 Compare（`FilesLineDiff`）模式
- 宿主全局 preferences 或 appearance 区开关
- 自研 canvas minimap（除非第三方包与当前 CM 版本不兼容且无法最小修补）

## 3. 方案选择

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A. `@replit/codemirror-minimap` + plugin configuration（选定）** | `showMinimap` facet + `Compartment`；设置走 files manifest | 与 autoSave / git gutter 同构；实现量小 |
| B. 自研 canvas | 完全可控 | 滚动 / 主题 / 大文件维护成本高，本轮不做 |
| C. 宿主 preferences | 全局 mono/appearance 旁挂开关 | minimap 只服务 files 编辑器，污染宿主边界 |

**依赖**：`@replit/codemirror-minimap@0.5.2`  
peer：`@codemirror/view` / `state` / `language`、`@lezer/*`、`@codemirror/lint`。  
仓库已有前四类；**若运行时解析需要 `@codemirror/lint`，一并加入 dependencies**（即使业务未用 lint UI）。接入前做一次 dev smoke：打开中等 `.ts` 文件，确认 DOM 出现 minimap 且无控制台错误。

## 4. 设计

### 4.1 配置契约

| 项 | 值 |
|---|---|
| Key | `pier.files.editor.minimap` |
| 常量 | `FILES_EDITOR_MINIMAP_SETTING_KEY`（`src/plugins/builtin/files/settings.ts`） |
| type | `boolean` |
| default | `true` |
| order | `15`（紧挨 `autoSave` order 10，形成编辑器组；树相关保持 20/21/30） |

Manifest `configuration.properties` 增加属性；`description` 英文 fallback 写在 manifest，用户可见 label/description 走插件 locale：

- `en` / `zh-CN`：`settings["pier.files.editor.minimap"].label` / `.description`

文案建议：

| locale | label | description |
|---|---|---|
| en | Minimap | Show a minimap overview on the right side of the source editor. |
| zh-CN | 缩略图 | 在源码编辑器右侧显示文档缩略图。 |

设置 UI：**不**新增 `settingsPages`；宿主 `PluginConfigurationSection` 按 schema 自动渲染 Switch。

### 4.2 运行时数据流

```
FileEditorController 构造
  → 读 context.configuration.get(FILES_EDITOR_MINIMAP_SETTING_KEY)
  → 默认 true：仅当显式 false 时关闭
  → 订阅 onDidChange(affectsConfiguration(key))
  → 变更时遍历 FileEditorViewCoordinator 全部 session.setMinimapEnabled(enabled)

FileEditorViewSession.attach / #extensions
  → #minimapCompartment.of(enabled ? minimapExtension() : [])
  → setMinimapEnabled → reconfigure compartment（不重建 EditorView）
```

**生效值语义**（与宿主 `effectiveConfigurationValue` 一致）：

- 用户未写过 → schema default `true`
- 用户设为 `false` → 关
- 读取兜底：`context.configuration.get<boolean>(key) !== false`  
  （避免测试 mock 返回 `undefined` 时误关；生产 get 已合并 default）

### 4.3 CodeMirror 接入

新小模块（建议）`files-editor-minimap.ts`：

```ts
import type { Extension } from "@codemirror/state";
import type { EditorView } from "codemirror";
import { showMinimap } from "@replit/codemirror-minimap";

export function createMinimapExtension(): Extension {
  return showMinimap.compute(["doc"], () => ({
    create: (_view: EditorView) => ({ dom: document.createElement("div") }),
    displayText: "blocks",
    showOverlay: "always",
  }));
}
```

`FileEditorViewSession`：

- `#minimapCompartment = new Compartment()`
- `#minimapEnabled: boolean`：**构造必填**（由 coordinator attach 透传 controller 当前值），禁止先挂默认再异步纠正
- `setMinimapEnabled(enabled: boolean): void`：值未变则 no-op；变则 reconfigure
- `#extensions()` 含 `this.#minimapCompartment.of(this.#minimapEnabled ? createMinimapExtension() : [])`

**attach 顺序（强制）**：

1. `FileEditorViewCoordinator.attach` / `new FileEditorViewSession(...)` 必须接收 `minimapEnabled: boolean`，与 controller 当前开关一致。
2. 全局开关变更只走已有 session 的 `setMinimapEnabled`，不 detach/reattach、不重建 `EditorView`。

### 4.4 谁订阅 configuration

**放在 `FileEditorController`（推荐）**，不放 React `CodeMirrorEditor`：

| 原因 | 说明 |
|---|---|
| 与 git gutter / autoSave 一致 | 配置与多 session 编排在 controller 层 |
| 生命周期清晰 | controller dispose 时注销 `onDidChange` |
| 避免重复订阅 | 每个 React mount 各订一次会泄漏 / 重复 reconfigure |

伪代码：

```ts
// FileEditorController constructor
this.#minimapEnabled =
  context.configuration.get<boolean>(FILES_EDITOR_MINIMAP_SETTING_KEY) !== false;
this.#minimapConfigDispose = context.configuration.onDidChange((event) => {
  if (!event.affectsConfiguration(FILES_EDITOR_MINIMAP_SETTING_KEY)) return;
  const enabled =
    context.configuration.get<boolean>(FILES_EDITOR_MINIMAP_SETTING_KEY) !== false;
  this.#minimapEnabled = enabled;
  for (const session of this.#views.values()) {
    session.setMinimapEnabled(enabled);
  }
});
// dispose() 里 this.#minimapConfigDispose?.()
```

`attachView` 创建 session 时传入 `minimapEnabled: this.#minimapEnabled`。

### 4.5 主题

在 `code-mirror-editor-theme.ts`（或 minimap 模块 `EditorView.baseTheme`）为 Replit minimap 容器补样式：

- 背景：透明或 `color-mix` 极浅前景，避免破坏编辑器透明底
- 覆盖层 / 边框：`var(--border)` / `color-mix(in oklab, var(--foreground) …)`
- 禁止新增 hex / 固定 Tailwind 色阶
- 宽度由库默认；本轮不引入自定义 CSS 宽度旋钮

接入后用深浅色各打开一文件目视验收；若库默认 class 名与文档不一致，以实际 DOM（如 `.cm-minimap`）为准微调选择器。

### 4.6 模式边界

| 模式 | Minimap |
|---|---|
| source（disk / untitled） | 受设置开关控制 |
| preview / rich / image | 否（无 CodeMirror session 或非 source） |
| 冲突 Compare `FilesLineDiff` | 否 |

### 4.7 测试策略（最佳实践）

| 层 | 内容 | 必须？ |
|---|---|---|
| 契约单测 | manifest 声明 `default: true, type: boolean, order: 15`；en/zh-CN label+description 齐全 | **是**（扩展 `files-tree-settings.test.ts` 或新建 `files-editor-minimap-settings.test.ts`） |
| 纯函数 / 扩展工厂 | `createMinimapExtension()` 返回非空 Extension（可选，价值低） | 否 |
| Controller 单测 | mock configuration：默认 / false / onDidChange → `setMinimapEnabled` 被调用 | **建议**（若现有 harness 易扩） |
| 组件 / e2e | 真实 canvas DOM | 不强制 |

**不要**为第三方库内部 canvas 像素写脆弱快照。

### 4.8 性能与风险

| 风险 | 缓解 |
|---|---|
| 包较旧（0.5.2 / 2023） | 接入时 smoke；不兼容则最小 fork 或 pin 补丁，不扩大为自研 |
| 超大文件 canvas 重绘 | 本轮不做阈值；若后续反馈再加「关」引导或行数阈值 |
| peer `@codemirror/lint` 缺失 | 安装时显式依赖 |
| reconfigure 布局抖动 | Compartment 切换；不重建 EditorView；构造时带上正确初始值减少闪动 |

## 5. 验收标准

1. 默认偏好下，打开任意 source 文本文件：右侧出现 minimap。
2. 设置 → Files 插件配置：存在「缩略图 / Minimap」开关，默认开。
3. 关闭开关：所有已打开 source 会话 minimap **立即**消失；再开立即出现。
4. preview / image / Compare 模式无 minimap。
5. 搜索、git gutter、只读、自动保存行为不回归。
6. 深浅色主题下缩略图与覆盖层可读，无硬编码色。
7. 契约测试覆盖 schema + 中英文案。

## 6. 实现触点

| 路径 | 变更 |
|---|---|
| `package.json` | 加 `@replit/codemirror-minimap`（及必要时 `@codemirror/lint`） |
| `src/plugins/builtin/files/settings.ts` | 导出 `FILES_EDITOR_MINIMAP_SETTING_KEY` |
| `src/plugins/builtin/files/manifest.ts` | configuration 属性 order 15 |
| `src/plugins/builtin/files/locales/en.json` / `zh-CN.json` | settings 文案 |
| `src/plugins/builtin/files/renderer/files-editor-minimap.ts` | **新** extension 工厂 |
| `src/plugins/builtin/files/renderer/file-editor-view-session.ts` | Compartment + `setMinimapEnabled` + 构造参数 |
| `src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts` | attach 透传 `minimapEnabled` |
| `src/plugins/builtin/files/renderer/file-editor-controller.ts` | 读配置、订阅、广播、dispose |
| `src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts` | minimap 主题补丁 |
| `tests/unit/renderer/files-*-settings.test.ts` | 契约测试 |

## 7. 后续可选（不在本 spec）

- 大文件自动关闭或降采样
- git 标记映射到 minimap gutters
- `displayText: "characters"` 或 overlay hover 设置
- 编辑器右键「隐藏缩略图」快捷入口（仍写同一 configuration key）
