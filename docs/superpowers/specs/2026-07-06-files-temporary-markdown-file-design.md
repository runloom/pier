# 文件面板与终端选区临时 Markdown 文件设计

- 日期：2026-07-06
- 状态：已被 `docs/superpowers/plans/2026-07-10-files-core-stability.md` 取代，仅保留历史背景
- 相关前作：
  - `docs/superpowers/specs/2026-07-02-project-file-tree-design.md`
  - `docs/superpowers/specs/2026-06-30-plugin-panel-mechanism-design.md`
- 触发问题：终端里 AI 输出经常包含 Markdown，用户需要一个明确的 `Markdown 内容预览` 入口，把选中内容放进文件面板的 Markdown 源码/预览体验。

## 1. 目标与完成标准

### 1.1 本期目标

1. `pier.files` 插件可以注册到终端内容区右键菜单，并在 `清屏` 后贡献菜单项：`Markdown 内容预览`。
2. 用户在终端选中内容后触发菜单，Pier 将选区创建为一个未保存的临时 Markdown 文件，并用 files 插件的 `file-panel` 打开。
3. 新的 `file-panel` 成为文件打开统一入口：项目文件、临时文件、未来差异视图（diff）和类 Notion 富文本体验都从这个面板体系扩展。
4. `file-panel` 支持多个实例：同一时间可以打开多个磁盘文件或多个临时文件。
5. 依赖选型明确，文件编辑器固定采用 CodeMirror 6，采用 `react-markdown` 渲染 Markdown 预览；后续保留富文本块编辑器接入点。

### 1.2 完成标准

- 终端右键菜单中 `清屏` 后出现 files 插件贡献的 `Markdown 内容预览`。
- 该菜单项由 `pier.files` 插件注册，终端核心代码不 import `src/plugins/builtin/files/*`。
- 有终端选区时，菜单动作读取选区文本并打开一个 `Untitled-*.md` 的 `file-panel` 实例。
- `pier.files` 只注册一个共享 `file-panel`；目录树是 `file-panel` 内部按项目 context 显示的可折叠侧边栏。
- `file-panel` 至少支持源码编辑、Markdown 预览切换、未保存状态展示。
- 临时文件不自动写入项目目录；磁盘文件保存仍走 `context.files.writeText`。
- Markdown 渲染不启用原始 HTML，使用安全清洗。
- `file-panel` 的业务文档状态不与 CodeMirror 实例状态耦合；差异视图和类 Notion 富文本体验走独立视图边界，不预留 Monaco 迁移路径。

## 2. 当前结构为什么不足

### 2.1 files 插件必须收敛为单一 file-panel

`pier.files` 不应同时注册独立目录树 panel 和 file panel。插件只注册 `pier.files.filePanel`；该组件根据 params/context 组合呈现四类状态：是否显示项目目录树、空文件状态、临时文件、具体磁盘文件。目录树不再是独立 dockview panel，而是当前 tab 内部可折叠侧边。

现有面板注册模型把三个概念绑成同一个 id：

```text
插件 panel contribution id
  = dockview component id
  = dockview panel instance id
```

旧的单例 explorer 模型不适合新的文件工作台。文件打开仍需要稳定的多实例 identity：

```text
component id: pier.files.filePanel
instance id: pier.files.file:<root+path hash>
instance id: pier.files.untitled:<id>
```

### 2.2 终端没有面向插件的选区读取能力

终端已有 `performOperation("copy")`，但这是“执行复制动作”，不是“读取选区文本”。用复制到剪贴板再读回来的方式会污染用户剪贴板，也无法表达权限边界。

需要一个窄接口：

```ts
context.terminal.readSelectionText(panelId?: string)
```

该接口只读取指定终端 panel 的选区文本，受 `terminal:read` 权限约束。命令面板等无来源场景可以省略
`panelId` 并回退到当前活动终端；右键菜单必须传入触发菜单的来源 `panelId`，避免多终端或焦点变化时读错选区。

### 2.3 action 可以挂终端菜单，但 files 插件尚未使用

现有插件 action 已支持 `surfaces: ["terminal/content"]`，这说明“files 插件注册终端右键菜单”不需要新增专门的菜单注册系统。需要做的是：

- files manifest 声明 command。
- files renderer activate 时注册 action。
- host 侧给 action handler 提供终端选区读取能力。

### 2.4 没有编辑器和 Markdown 渲染依赖

当前项目没有 CodeMirror、Monaco、`react-markdown`、`remark-gfm`、`rehype-sanitize` 等依赖。已有 `@shikijs/themes` 只是主题数据，不是编辑器或代码高亮引擎。

如果直接用 `<textarea>`，后续差异视图、Markdown 语法体验、选择/滚动状态、可替换编辑器适配层都会很快返工。

## 3. 目标所有权划分

### 3.1 main 进程

负责文件系统真实读写和终端 native 能力：

- `FileService`：低级文件读写、移动、删除。
- 后续 `ProjectTreeService`：项目文件树会话、懒加载、watch、reveal；不塞回低级 `FileService`。
- `TerminalSelectionService` 或 terminal IPC：读取指定 panel 的原生终端选区文本。

main 不负责 Markdown 渲染、不负责编辑器状态、不负责临时文档内容。
终端选区 IPC 必须从 `event.sender` 解析 BrowserWindow，并用窗口作用域的 native panel key 读取选区；不能直接把 renderer panelId 传给 native addon。

### 3.2 preload

负责暴露窄 API：

```ts
window.pier.terminal.readSelectionText(panelId)
window.pier.files.readText(request)
window.pier.files.writeText(request)
```

preload 不做业务判断，不知道 files 插件如何使用选区。

### 3.3 renderer 插件宿主

负责平台能力：

- action 注册和菜单 surface 投影。
- action 调用上下文：右键菜单触发时把 `surface`、来源 `panelId`、来源 component 和来源 `PanelContext` 传给 handler。
- 插件权限断言。
- 插件 panel component 注册。
- 新增多实例打开能力：`panels.openInstance(...)`。
- 提供 `context.terminal` 窄能力。

宿主不维护 files 插件的文档状态，不把 Markdown 逻辑放入核心。

### 3.4 terminal 面板

负责终端自身：

- 维护 active terminal panel。
- 提供终端右键 surface。
- 弹出右键菜单时把触发菜单的终端 `panelId` 和当前 `PanelContext` 写入 action invocation context。
- native 层提供选区读取。

terminal 不 import files 插件，不知道 `file-panel` 的实现，也不判断选区是否“像 Markdown”。

### 3.5 files 插件

负责文件管理领域：

- 单一文件面板组件 `pier.files.filePanel`。
- 项目文件树作为 `file-panel` 内部侧边栏，由项目 root 共享加载状态和折叠偏好。
- 文档缓冲区：磁盘文件和临时文件。
- 文件打开、保存、脏状态展示。
- Markdown 源码编辑、预览切换。
- 本期不实现 dirty close 拦截/关闭确认；关闭脏文档的统一 close guard 后续单独设计。
- 后续差异视图、富文本块编辑器适配层。

### 3.6 packages/ui

承载跨业务可复用 UI 原语：

- `PierFileTree` 继续作为树入口。
- 未来可新增纯展示组件，例如 `FileTabTitle`、`MarkdownPreviewFrame`，但不要把业务状态放入 `packages/ui`。

## 4. 核心抽象

### 4.1 文件打开来源

```ts
export type FilesDocumentSource =
  | {
      kind: "disk";
      root: string;
      path: string;
    }
  | {
      kind: "untitled";
      id: string;
      name: string;
      initialContents: string;
      language: FilesDocumentLanguage;
      origin?: FilesDocumentOrigin;
    };

export type FilesDocumentLanguage = "markdown" | "text";

export interface FilesDocumentOrigin {
  panelId?: string;
  source: "terminal-selection" | "project-file-tree";
}
```

磁盘文件以 `root + path` 作为身份。临时文件以 `id` 作为身份，内容只进 renderer 内存，不自动落盘。
面板布局参数使用单独的可序列化来源，避免把临时正文写入 dockview layout：

```ts
export type FilesDocumentPanelSource =
  | {
      kind: "disk";
      root: string;
      path: string;
    }
  | {
      kind: "untitled";
      id: string;
      name: string;
    };
```

`FilesDocumentPanelSource` 是持久化 layout 恢复边界，必须通过运行时 schema/type guard 解析；磁盘 source 的 `path` 必须保持 root-relative，`root` 必须能匹配恢复出的 `PanelContext`（例如 `projectRootPath`、`worktreeRoot`、`gitRoot`、`cwd` 或 `openedPath`）。解析或 root 校验失败时，`file-panel` 只渲染只读错误状态，不调用文件读写 API。

### 4.2 文件面板实例

```ts
export interface PluginPanelInstanceOptions {
  componentId: string;
  instanceId: string;
  title?: string;
  params?: Record<string, unknown>;
  context?: PanelContext;
}
```

现有 `context.panels.open(panelId)` 保留给单例面板；新增：

```ts
context.panels.openInstance({
  componentId: FILES_FILE_PANEL_ID,
  instanceId,
  title,
  params,
});
```

`componentId` 用于找 React 组件；`instanceId` 用于 dockview panel 唯一身份。

### 4.3 文档缓冲区

files 插件内部维护文档缓冲区，不放到全局 renderer store：

```ts
export interface FilesDocument {
  id: string;
  source: FilesDocumentSource;
  name: string;
  language: FilesDocumentLanguage;
  savedContents: string;
  currentContents: string;
  dirty: boolean;
  readOnly: boolean;
  loadState: "idle" | "loading" | "loaded" | "error";
  error: string | null;
}
```

实现上用 files 插件模块内的小型外部 store + `useSyncExternalStore`，避免 builtin 插件直接依赖 renderer store。这样符合插件边界：插件只依赖 `@plugins/api`、`@shared`、`@pier/ui` 和自身模块。

磁盘文档加载必须有 `idle -> loading -> loaded/error` 转换，`file-panel` 在发起 `readText` 前同步标记 `loading`，避免 React rerender 或 StrictMode 下重复读取。

临时文档正文存入 renderer 本地草稿缓存，用于强制退出/重启后按 untitled `id` 恢复；dockview layout params 仍不携带正文。对应 untitled `file-panel` 关闭或 files 插件 deactivate 时必须删除内存文档和草稿缓存，避免终端选区中的 token/secret 无限期保留。

### 4.4 编辑器适配层

第一版内部实现用 CodeMirror 6，但 `file-panel` 只依赖适配层接口：

```ts
export type FileViewMode = "source" | "preview" | "rich" | "diff";

export interface FileEditorAdapterProps {
  language: FilesDocumentLanguage | string;
  value: string;
  originalValue?: string;
  mode: FileViewMode;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}
```

本期实现：

- `source`：CodeMirror 6。
- `preview`：`react-markdown`。
- `rich`：暂不实现，只保留切入点。
- `diff`：暂不实现，只保留切入点；后续用 `@codemirror/merge`。

## 5. 数据流与控制流

### 5.1 终端选区打开临时 Markdown 文件

```text
用户在终端选中文本
  -> 右键 terminal/content
  -> context-menu 记录来源 terminal panelId
  -> actionRegistry 投影菜单
  -> files 插件 action: pier.files.openSelectionAsMarkdown
  -> context.terminal.readSelectionText(invocation.sourcePanelId)
  -> files 文档 store 创建 untitled Markdown 文档
  -> context.panels.openInstance(componentId=pier.files.filePanel, instanceId=pier.files.untitled:<id>)
  -> file-panel 读取文档 store
  -> 默认源码模式展示；预览只由用户主动切换
```

菜单文案必须是 `Markdown 内容预览`，并放在终端右键菜单 `清屏` 后。这里表达“把当前选区作为 Markdown 内容打开预览/编辑”，同时避免和普通文件打开命令混淆。

### 5.2 项目文件树打开文件

```text
file-panel 内嵌目录树读取 root direct children
  -> 用户点击文件
  -> files 插件创建 disk document shell
  -> 当前 tab 更新 params.source 和标题
  -> file-panel 用 context.files.readText(root/path) 加载内容
  -> 文档 store 写入 loaded 内容
  -> 用户编辑
  -> 保存时 context.files.writeText(root/path, currentContents)
```

文件树仍只负责导航，不承载文件编辑状态；编辑状态由同一个 file-panel 的文档区承载。

### 5.3 多文件实例

磁盘文件实例 id：

```text
pier.files.file:<stable hash of root + "\0" + path>
```

临时文件实例 id：

```text
pier.files.untitled:<monotonic id>
```

同一磁盘文件再次打开时激活已有 panel；临时文件每次创建新实例。

### 5.4 插件禁用与关闭

插件禁用时，宿主要关闭该插件注册 component 的所有实例，而不只是关闭和 component id 同名的单例 panel。

需要把现有 `panelCloser(panelId)` 升级为：

```ts
closePanelsByPluginComponent(componentId: string): void
```

关闭逻辑按 dockview panel 的 `panel.view.contentComponent === componentId` 匹配。

### 5.5 布局持久化

不能把临时文件正文塞进 dockview params。原因：

- 内容可能很大。
- 用户没有明确保存。
- 布局 JSON 不应该变成文档存储。

策略：

- 磁盘文件 params 只存 `{ source: { kind: "disk", root, path } }`。
- 临时文件 params 只存 `{ source: { kind: "untitled", id, name } }`。
- 所有恢复出来的 `params.source` 都必须经过 runtime schema 解析；坏数据、未知 kind、非法 path、未知 root 都渲染只读错误状态。
- 应用强制退出/重启后临时文件 store 不存在时，`file-panel` 按 untitled `id` 从 renderer 本地草稿缓存恢复正文；草稿不存在时才显示“临时文件已不可恢复”的只读空状态。
- 关闭临时 file-panel 或禁用 files 插件时，renderer 内存中的临时正文必须释放。
- 后续如需恢复未保存文件，单独设计工作区草稿持久化，不混进布局层。

## 6. 依赖库调研与选型

### 6.1 编辑器：CodeMirror 6

推荐安装：

```text
codemirror@6.0.2
@codemirror/lang-markdown@6.5.0
```

理由：

- CodeMirror 6 是网页代码编辑器组件，核心由 state 和 view 组成，功能通过扩展组合，适合按需建设文件面板。
- Markdown 支持有官方 `@codemirror/lang-markdown`。
- 与多 `file-panel` 实例更匹配，启动和资源成本低于 Monaco。
- 后续差异视图可接 `@codemirror/merge`。

### 6.2 固定使用 CodeMirror，不迁移 Monaco

Monaco 是 VS Code 编辑器内核，优势是强语言服务、复杂代码编辑和成熟差异视图。但 files 插件当前更需要：

- 多实例轻量文件编辑。
- Markdown 临时文件。
- 未来类 Notion 富文本入口。
- Electron + Vite 低集成成本。

Monaco 需要处理 worker、模型 URI、语言服务和打包问题。当前没有必要先承担这些复杂度。

结论：采用 CodeMirror 6，不把 Monaco 作为后续待办，也不预留替换适配器。若未来出现 CodeMirror 无法合理满足的独立硬约束，必须重新提交专项架构方案和证据，不能沿用本文推定迁移。

### 6.3 Markdown 渲染：react-markdown

推荐安装：

```text
react-markdown@10.1.0
remark-gfm@4.0.1
rehype-sanitize@6.0.0
```

理由：

- `react-markdown` 将 Markdown 渲染为 React 元素，不需要 `dangerouslySetInnerHTML`。
- `remark-gfm` 支持表格、任务列表、删除线、脚注等 GitHub 风格 Markdown。
- `rehype-sanitize` 用于清洗插件处理后的 HTML AST，避免后续插件或配置引入风险。

本期不启用原始 HTML 渲染，不引入 `rehype-raw`。同时需要处理链接安全：危险协议（如 `javascript:`、`vbscript:`、不受信任的 `data:`）不可执行；Markdown 链接点击不得导航当前 Electron renderer window。如后续允许打开外链，必须走宿主统一外链打开策略。

### 6.4 暂不引入 DOMPurify

DOMPurify 适合清洗 HTML 字符串。如果后续改为 `markdown-it -> HTML string -> dangerouslySetInnerHTML`，或必须支持可信 HTML，再引入。

当前 `react-markdown + rehype-sanitize` 已覆盖本期风险面。

### 6.5 后续差异视图

后续差异视图优先评估：

```text
@codemirror/merge@6.12.1
```

它支持 split merge view 和 unified merge view。差异视图不纳入本期安装依赖，除非本期直接实现 diff。

### 6.6 后续类 Notion 体验

类 Notion 体验不是 Monaco 的强项，也不是 CodeMirror 的源码编辑问题。后续需要单独的富文本块编辑器适配器，优先评估：

- Milkdown：Markdown-first，底层 ProseMirror，适合 Markdown 文件和富文本体验共存。
- Tiptap：ProseMirror 生态成熟，块编辑能力强，Markdown 往返需要专门设计。
- Lexical：高度自定义能力强，但工程量更大。

原则：Markdown 文本仍是 `.md` 文件真源；富文本编辑器只是另一种编辑视图，不把文件改成私有 JSON 块结构。

## 7. 明确禁止的反模式

- 禁止 `terminal -> files plugin` 的直接 import。
- 禁止 files 插件通过复制到剪贴板再读剪贴板获取终端选区。
- 禁止把临时 Markdown 自动保存到项目目录。
- 禁止把临时文件正文写进 dockview layout params。
- 禁止 builtin files 插件绕过 `context.terminal` 直接调用 `window.pier.terminal.readSelectionText`；当前同 realm 插件权限是工程纪律边界，不是恶意代码安全沙箱。
- 禁止在终端内原地替换渲染 Markdown。
- 禁止为了类 Notion 体验把 `.md` 文件真源改成私有 JSON。
- 禁止项目文件树启动时递归扫描整个仓库。
- 禁止业务 panel 直接 import `@pierre/trees` 或 dockview。
- 禁止用 `as any`、`@ts-ignore`、`@ts-expect-error` 压制类型问题。

## 8. 最小实施方案

### 8.1 第一阶段：平台能力

1. 扩展插件 panel API：新增 `openInstance`。
2. 扩展插件 terminal API：新增 `readSelectionText`。
3. main/preload 接上终端选区读取。
4. 插件禁用时关闭该插件 component 的所有实例。

### 8.2 第二阶段：files 插件文档模型

1. 新增 files 插件内部文档 store。
2. 注册唯一的 `pier.files.filePanel` component。
3. 在 `file-panel` 内实现项目目录树侧边栏；点击文件在当前 tab 更新 params/title 并加载对应磁盘文件，不再打开独立目录树 panel。
4. 目录树加载状态按项目 root 共享，折叠偏好按项目 root 记忆，避免同项目多 tab 重复拉取/渲染相同树状态。
5. 临时 Markdown 文档通过 store 创建，不写入项目文件；正文进入 renderer 本地草稿缓存用于强退恢复。

### 8.3 第三阶段：右键菜单动作

1. files manifest 声明 `pier.files.openSelectionAsMarkdown`。
2. files activate 注册 action 到 `terminal/content`。
3. action handler 读取终端选区，创建 `Untitled-*.md`，打开 file-panel。
4. 无选区时 action 置灰或给出明确提示。

### 8.4 第四阶段：编辑和预览

1. 安装 CodeMirror 与 Markdown 渲染依赖。
2. 实现 CodeMirror 源码编辑适配器。
3. 实现 Markdown 预览适配器。
4. file-panel 顶部提供 `源码` / `预览` 切换。
5. 磁盘文件保存走 `context.files.writeText`。

## 9. 验收矩阵

| 需求 | 证据 |
|---|---|
| files 插件能注册终端右键菜单 | `pier.files.openSelectionAsMarkdown` 出现在 `buildMenuEntries("terminal/content")` |
| 终端不依赖 files 插件 | `src/renderer/panel-kits/terminal/*` 无 `src/plugins/builtin/files/*` import，depcruise 通过 |
| 选区作为临时 Markdown 文件打开 | action 调用 `context.terminal.readSelectionText` 并创建 `kind: "untitled"` 文档 |
| 临时文件不写入项目文件 | 不调用 `context.files.writeText`，layout params 不含正文；强退恢复使用 renderer 本地草稿缓存 |
| 布局参数可恢复且安全 | 磁盘文件 params 存 `{ kind: "disk", root, path }`，临时文件 params 只存 `{ kind: "untitled", id, name }`；正文按 id 从草稿缓存恢复；坏 params / 非法 path / 未知 root 不触发文件读写 |
| 临时正文生命周期 | 关闭 untitled file-panel 或禁用 files 插件后，document store 不再保留临时正文 |
| file-panel 支持多实例 | 同时打开两个 `pier.files.untitled:*` 或两个不同 `pier.files.file:*` panel |
| 单一 file-panel 架构 | manifest/activate 只声明并注册 `pier.files.filePanel`；目录树是其内部侧边栏 |
| 项目目录树复用 | 同项目 root 的多个 file-panel 共享 tree store；折叠偏好按 root 记忆 |
| 项目文件树只负责导航 | file-panel 内部目录树点击文件后更新当前 tab params/title，不调用 `openInstance` 新开另一个 panel |
| 磁盘文件可编辑保存 | file-panel 加载 `readText`，修改后 `writeText` 写回 |
| Markdown 预览安全 | 不使用 `dangerouslySetInnerHTML`；不启用 `rehype-raw`；使用 `rehype-sanitize`；危险 URL 不执行且链接点击不导航当前窗口 |
| 预留差异视图 | `FileViewMode` 包含 `diff`，编辑器适配层支持 `originalValue` |
| 预留类 Notion 体验 | `FileViewMode` 包含 `rich`，文档真源仍为 Markdown 文本 |
| 后续项目文件管理可扩展 | file tree、file-panel、ProjectTreeService 边界清晰，不把高层树状态塞进 `FileService` |

## 10. 测试计划

- 单元测试：
  - plugin host `openInstance` 使用 component id 打开多个 panel。
  - context-menu dispatch 会把来源 panelId 传给 action handler。
  - plugin host action 注册后能出现在 `terminal/content`。
  - files manifest 权限和 command 声明正确。
  - files 文档 store 能创建 disk / untitled 文档、更新 dirty 状态、`idle -> loading`、释放临时文档。
  - Markdown 预览不会渲染原始 HTML 脚本，危险 URL 不执行。

- 组件测试：
  - file-panel 在项目 context 下渲染内嵌可折叠目录树。
  - file-panel 内部目录树点击文件在当前 tab 打开，不调用 `openInstance`。
  - 同项目 root 多个 file-panel 共享目录树加载状态，折叠偏好按 root 记忆。
  - file-panel 对临时 Markdown 显示源码和预览。
  - file-panel 修改内容后显示未保存状态。
  - file-panel 对坏 params、非法 path、未知 root 显示只读错误状态。
  - 磁盘文件保存调用 `writeText`。

- 架构测试：
  - `depcruise` 确认 terminal 不 import files 插件。
  - `depcruise` 确认插件仍不直接 import dockview。
  - governance 扫描确认 builtin files 插件不绕过 `context.terminal` 直接调用 `window.pier.terminal.readSelectionText`。
  - 关闭 files 插件后，所有 files component 实例被关闭。

- 手工验证：
  - 终端选区右键打开临时 Markdown。
  - 同时打开多个临时文件。
  - 同时打开多个项目文件。
  - 宽 Markdown 表格不会自动弹预览，只在用户主动打开后作为文件处理。

## 11. 风险与处理

### 11.1 原生终端选区读取

Ghostty C header 暴露了 `ghostty_surface_read_selection`，但当前 native bridge 还没有 JS 绑定。实现时需要补 Swift/C++ 桥接。若读取选区失败，action 应提示“当前没有可打开的终端选区”，不能回退到剪贴板方案。
main 侧读取时必须复用现有终端 native 操作的窗口作用域策略：从 IPC `event.sender` 找到 BrowserWindow，再把 renderer panelId 转为 native panel key，避免多窗口读错选区。

### 11.2 多实例 panel 对保存布局的影响

多实例 panel 会进入 dockview layout。必须保证 params 可序列化且不含大正文。临时文件重启后先用 params 中的 `id` 从本地草稿缓存恢复，草稿缺失时显示明确状态。所有恢复参数都按不可信输入处理：先 schema 校验，再 root/context 校验，失败时不触发文件读写。

### 11.3 临时正文内存生命周期

终端选区可能包含敏感内容。为满足强制退出后的恢复体验，本期将临时正文写入 renderer 本地草稿缓存，但不写入项目文件，也不写入 dockview layout params。临时 file-panel 关闭或 files 插件 deactivate 时删除对应内存文档与草稿缓存。

### 11.4 插件禁用清理

现有 plugin panel closer 只按 panel id 关闭。多实例后必须按 component id 关闭所有实例，否则禁用 files 插件后会残留找不到 component 的 dockview 实例。

### 11.5 Markdown 链接与 Electron 导航

`react-markdown + rehype-sanitize` 能覆盖 raw HTML 风险，但 Electron renderer 还需要防链接点击导航当前窗口。第一版应拦截链接点击并过滤危险协议；外链打开策略后续走宿主统一能力。

### 11.6 编辑器依赖体积

CodeMirror 仍会增加前端包体。第一版只引入 Markdown 语言包；其它语言包按文件类型按需后续增加。

### 11.7 类 Notion 体验与 Markdown 往返

富文本块编辑器可能引入 Markdown 往返损耗。必须先定义 Markdown 真源和可接受的格式化策略，不能让富文本编辑器静默重排用户文件。

## 12. 后续路线

### P0：本期闭环

- 终端选区作为临时 Markdown 文件打开。
- 多实例 file-panel。
- 项目文件树点击打开文件。
- 基础源码编辑和 Markdown 预览。

### P1：项目文件管理

- 接入 `ProjectTreeService` 会话。
- 目录 watch、刷新、reveal 当前文件。
- 新建、重命名、移动、删除。
- 文件类型识别和只读/二进制提示。

### P2：差异视图

- 用 `@codemirror/merge` 实现 unified / split 差异视图。
- Git changes 面板点击文件可打开 file-panel 的 diff 模式。

### P3：类 Notion Markdown 编辑

- 引入富文本块编辑器适配器。
- 保持 Markdown 文本为文件真源。
- 定义 Markdown 往返、格式化和不可表达结构的降级规则。

## 13. 产品参考和取舍

本设计参考的产品实现可以归成三类：

1. 编辑器型产品：VS Code、JetBrains IDE、Zed 都把 Markdown 预览作为“文件/编辑器”的能力，而不是终端原地渲染能力。VS Code 有 `Open Preview`、侧边预览和源码同步滚动；Zed 保留命令面板里的 Markdown preview 动作。
2. 代码托管产品：GitHub、GitLab 在评论、Issue、合并请求和 `.md` 文件里提供源码/预览切换，说明“预览”应是明确视图状态，不应替换原始输入。
3. 终端型产品：Warp 更接近 Pier 的场景，它把命令输出组织成 block，右键或菜单动作再进入复制、分享、书签、Markdown viewer 等后续动作。这个模型支持 Pier 把终端输出块或选区作为对象打开到独立 panel。

对 Pier 的结论：

- 终端仍保持原始输出，不做自动 Markdown 渲染。
- 菜单文案采用 `Markdown 内容预览`，并放在终端右键菜单 `清屏` 后，强调这是用户显式对选区内容发起的 Markdown 预览。
- files 插件拥有打开和预览能力，因为它后续也要承担项目文件管理、编辑、差异视图和 Markdown 富文本体验。
- 参考链接：
  - VS Code Markdown：https://code.visualstudio.com/docs/languages/markdown
  - Zed Actions：https://zed.dev/docs/all-actions
  - GitHub Markdown 写作：https://docs.github.com/en/get-started/writing-on-github
  - GitLab Markdown：https://docs.gitlab.com/user/markdown/
  - Warp Blocks：https://docs.warp.dev/terminal/blocks

## 14. 设计自检

- 本期关键路径已经收敛：终端选区、插件 action、多实例 file-panel、临时文档和 Markdown 预览都有明确所有权。
- 当前 `project-file-tree` 前作被保留：文件树仍是导航，不承担文件编辑；后续项目文件管理走 ProjectTreeService。
- 当前 plugin panel 机制前作被保留：新增多实例能力，不破坏单例 `panels.open`。
- 终端和 files 边界单向：files 消费终端能力，终端不依赖 files。
- 依赖选型支持本期目标，同时为差异视图和类 Notion 体验预留适配层。
