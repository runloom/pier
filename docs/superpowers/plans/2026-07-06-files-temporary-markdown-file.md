# 文件面板与终端选区临时 Markdown 文件实施计划

> **历史文档：请勿继续执行。** 本计划已被
> `docs/superpowers/plans/2026-07-10-files-core-stability.md` 取代，仅保留早期设计背景。
> 其中关于顶部保存按钮、暂不支持另存为和暂不实现关闭保护的步骤不再代表当前需求；
> 当前实现与验收一律以后者为准。

**目标：** 让 `pier.files` 插件把终端选区作为临时 Markdown 文件打开，并建立后续项目文件管理、文件编辑、差异视图和类 Notion Markdown 体验共用的 `file-panel` 架构。

**架构：** 保持终端、插件宿主和 files 插件三层解耦。终端只提供选区读取能力和右键菜单 surface；插件宿主提供 action 投影、调用上下文、权限断言和多实例 panel 打开能力；files 插件只注册一个共享 `file-panel`，由该组件拥有可折叠项目目录树、文档缓冲区、编辑器适配层和 Markdown 预览。目录树是当前 tab 的侧边状态，不是独立 panel。

**技术栈：** Electron 42、React 19、TypeScript strict、dockview-react 6、Zustand 5、Vitest 4、Testing Library、CodeMirror 6、`react-markdown`、`remark-gfm`、`rehype-sanitize`、Tailwind CSS v4、`@pier/ui`。

**配套设计：** `docs/superpowers/specs/2026-07-06-files-temporary-markdown-file-design.md`

**提交约束：** 本仓库默认 git 只读。执行本计划时只修改明确路径；除非用户单独确认，不执行 `git add`、`git commit`、`git push`。需要提交时先展示 staged diff 和 Conventional Commits message。

---

## 文件结构

**新建**

- `src/plugins/builtin/files/renderer/file-panel.tsx`：唯一文件面板，支持空状态、临时文件、具体磁盘文件和内嵌目录树侧边栏。
- `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`：file-panel 内部的可折叠项目目录树侧边栏。
- `src/plugins/builtin/files/renderer/files-tree-store.ts`：按项目 root 共享的目录树加载状态。
- `src/plugins/builtin/files/renderer/files-document-store.ts`：files 插件内部文档缓冲区。
- `src/plugins/builtin/files/renderer/files-document-types.ts`：文件来源、视图模式、文档状态类型。
- `src/plugins/builtin/files/renderer/file-editor-adapter.tsx`：源码、预览、后续富文本和差异视图的统一入口。
- `src/plugins/builtin/files/renderer/code-mirror-editor.tsx`：CodeMirror 6 源码编辑适配器。
- `src/plugins/builtin/files/renderer/markdown-preview.tsx`：安全 Markdown 预览。
- `src/renderer/lib/plugins/host-terminal-context.ts`：插件宿主提供的终端窄能力。
- `tests/unit/renderer/plugin-panel-instances.test.ts`：插件多实例 panel 能力测试。
- `tests/unit/renderer/context-menu-action-invocation.test.ts`：右键菜单 action 来源上下文测试。
- `tests/unit/main/terminal-selection-ipc.test.ts`：终端选区读取 IPC 测试。
- `tests/unit/renderer/plugin-terminal-context.test.ts`：插件宿主终端上下文测试。
- `tests/unit/renderer/files-document-store.test.ts`：files 文档缓冲区测试。
- `tests/unit/renderer/files-terminal-action.test.tsx`：终端右键菜单动作测试。
- `tests/component/files-file-panel.test.tsx`：file-panel 组件测试，覆盖内嵌目录树、空状态、临时文件和具体磁盘文件。

**修改**

- `package.json`、`pnpm-lock.yaml`：新增编辑器和 Markdown 预览依赖。
- `src/plugins/api/renderer.ts`：新增 `panels.openInstance`、`context.terminal` 和相关类型。
- `src/renderer/lib/actions/types.ts`、`src/renderer/lib/actions/contribution-types.ts`、`src/renderer/lib/actions/contribution-runtime.ts`、`src/renderer/lib/actions/registry.ts`：让 action handler 接收并透传调用上下文。
- `src/renderer/lib/context-menu/use-context-menu.ts`：弹出右键菜单时传递来源 panel 上下文。
- `src/renderer/panel-kits/terminal/terminal-panel.tsx`：native 右键转发调用 `popupContextMenuAt` 时传入触发菜单的终端 panelId。
- `src/renderer/lib/plugins/host-context.ts`：实现多实例 panel 打开和终端上下文注入。
- `src/renderer/lib/plugins/plugin-panel-registry.ts`：支持按 component id 关闭所有插件 panel 实例。
- `src/renderer/components/workspace/panel-registry.ts`、`workspace-host.tsx`：确保 dockview 按 component id 渲染插件 panel。
- `src/shared/contracts/permissions.ts`：确认 `terminal:read`、`panel:open` 已存在；本期只更新 manifest、权限断言和测试。
- `src/shared/contracts/terminal.ts`：新增读取选区文本的契约。
- `src/preload/terminal-api.ts`：暴露 `readSelectionText`。
- `src/main/ipc/terminal.ts`、`src/main/ipc/terminal-operations.ts` 或相邻模块：注册读取选区 IPC。
- `src/main/ipc/terminal-native-addon.ts`：接入 native addon 的选区读取。
- `native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+PublicInput.swift`：新增公开 selection wrapper。
- `native/Sources/GhosttyBridge/GhosttyBridge.swift`：桥接 Ghostty surface selection。
- `native/src/addon.mm`：暴露 `readSelectionText` 给 Electron main。
- `src/plugins/builtin/files/manifest.ts`：声明 `pier.files.filePanel` 和 `pier.files.openSelectionAsMarkdown`。
- `src/plugins/builtin/files/renderer/index.tsx`：只注册 file-panel 和终端菜单 action。
- `src/plugins/builtin/files/locales/en.json`、`zh-CN.json`：新增面板和命令文案。

---

## 任务 1：依赖和编辑器边界

**文件：**

- 修改：`package.json`
- 修改：`pnpm-lock.yaml`
- 新建：`src/plugins/builtin/files/renderer/files-document-types.ts`
- 新建：`src/plugins/builtin/files/renderer/file-editor-adapter.tsx`

- [ ] **步骤 1：安装第一版依赖**

运行：

```bash
pnpm add codemirror@6.0.2 @codemirror/lang-markdown@6.5.0 react-markdown@10.1.0 remark-gfm@4.0.1 rehype-sanitize@6.0.0
```

第一版不安装 Monaco；差异视图依赖 `@codemirror/merge` 留到实现 diff 时再加。

- [ ] **步骤 2：定义文件文档类型**

`src/plugins/builtin/files/renderer/files-document-types.ts`：

```ts
import type { PanelContext } from "@shared/contracts/panel.ts";
import { nonEmptyFileRootRelativePathSchema } from "@shared/contracts/file.ts";
import { z } from "zod";

export type FilesDocumentLanguage = "markdown" | "text";

export interface FilesDocumentOrigin {
  panelId?: string;
  source: "project-file-tree" | "terminal-selection";
}

export type FilesDocumentSource =
  | { kind: "disk"; path: string; root: string }
  | {
      id: string;
      initialContents: string;
      kind: "untitled";
      language: FilesDocumentLanguage;
      name: string;
      origin?: FilesDocumentOrigin;
    };

export const filesDocumentPanelSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("disk"),
    path: nonEmptyFileRootRelativePathSchema,
    root: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("untitled"),
    name: z.string().min(1),
  }),
]);

export type FilesDocumentPanelSource = z.infer<
  typeof filesDocumentPanelSourceSchema
>;

export function parseFilesDocumentPanelSource(
  params: unknown
): FilesDocumentPanelSource | null {
  if (!params || typeof params !== "object" || !("source" in params)) {
    return null;
  }
  const parsed = filesDocumentPanelSourceSchema.safeParse(params.source);
  return parsed.success ? parsed.data : null;
}

export function isDiskSourceRootAllowed(
  root: string,
  context: PanelContext | null | undefined
): boolean {
  return [
    context?.projectRootPath,
    context?.worktreeRoot,
    context?.gitRoot,
    context?.cwd,
    context?.openedPath,
  ].some((candidate) => candidate === root);
}

export type FileViewMode = "diff" | "preview" | "rich" | "source";

export type FilesDocumentCapability =
  | "delete"
  | "move"
  | "rename"
  | "reveal"
  | "save"
  | "saveAs";

export interface FilesDocument {
  capabilities: readonly FilesDocumentCapability[];
  currentContents: string;
  dirty: boolean;
  error: string | null;
  id: string;
  language: FilesDocumentLanguage;
  loadState: "error" | "idle" | "loaded" | "loading";
  name: string;
  readOnly: boolean;
  savedContents: string;
  source: FilesDocumentSource;
}

export interface FileEditorAdapterProps {
  language: FilesDocumentLanguage | string;
  mode: FileViewMode;
  onChange?: (value: string) => void;
  originalValue?: string;
  readOnly?: boolean;
  value: string;
}
```

`FilesDocumentPanelSource` 是 layout 恢复边界，必须通过 `parseFilesDocumentPanelSource` 解析；磁盘 source 还必须用 `isDiskSourceRootAllowed` 对照恢复出的 `PanelContext` 校验 root，校验失败时渲染只读错误状态，不调用 `readText` / `writeText`。

- [ ] **步骤 3：建编辑器适配层骨架**

`src/plugins/builtin/files/renderer/file-editor-adapter.tsx`：

```tsx
import { CodeMirrorEditor } from "./code-mirror-editor.tsx";
import { MarkdownPreview } from "./markdown-preview.tsx";
import type { FileEditorAdapterProps } from "./files-document-types.ts";

export function FileEditorAdapter(props: FileEditorAdapterProps) {
  if (props.mode === "preview") {
    return <MarkdownPreview value={props.value} />;
  }

  if (props.mode === "diff") {
    return <UnsupportedFileView label="差异视图暂未启用。" />;
  }

  if (props.mode === "rich") {
    return <UnsupportedFileView label="富文本 Markdown 编辑暂未启用。" />;
  }

  return <CodeMirrorEditor {...props} />;
}

function UnsupportedFileView({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
```

- [ ] **步骤 4：验证依赖和类型入口**

运行：

```bash
pnpm typecheck
```

预期：新增依赖可解析；如果 `CodeMirrorEditor` 和 `MarkdownPreview` 尚未创建，先在本任务末尾创建最小占位组件或把类型检查放到任务 6 完成后执行。

---

## 任务 2：插件多实例 panel 能力

**文件：**

- 修改：`src/plugins/api/renderer.ts`
- 修改：`src/renderer/lib/actions/types.ts`
- 修改：`src/renderer/lib/actions/contribution-types.ts`
- 修改：`src/renderer/lib/actions/contribution-runtime.ts`
- 修改：`src/renderer/lib/actions/registry.ts`
- 修改：`src/renderer/lib/context-menu/use-context-menu.ts`
- 修改：`src/renderer/panel-kits/terminal/terminal-panel.tsx`
- 修改：`src/renderer/lib/plugins/host-context.ts`
- 修改：`src/renderer/lib/plugins/plugin-panel-registry.ts`
- 修改：`src/renderer/components/workspace/panel-registry.ts`
- 修改：`src/renderer/components/workspace/workspace-host.tsx`
- 测试：`tests/unit/renderer/plugin-panel-instances.test.ts`
- 测试：`tests/unit/renderer/context-menu-action-invocation.test.ts`

- [ ] **步骤 1：写失败测试**

覆盖四个行为：

```ts
it("passes context-menu source panel to the selected action", async () => {
  const handler = vi.fn();
  actionRegistry.register({
    handler,
    id: "pier.test.action",
    surfaces: ["terminal/content"],
    title: () => "Test",
  });

  await popupContextMenuAt(
    "terminal/content",
    { x: 10, y: 20 },
    {
      sourcePanelComponent: "terminal",
      sourcePanelContext: terminalPanelContext,
      sourcePanelId: "terminal:2",
    }
  );

  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      sourcePanelContext: terminalPanelContext,
      sourcePanelId: "terminal:2",
    })
  );
});

it("opens two dockview panel instances with the same plugin component", () => {
  const context = createRendererPluginContext(entryWithPanel());

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    instanceId: "pier.files.untitled:1",
    title: "Untitled-1.md",
  });
  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    instanceId: "pier.files.untitled:2",
    title: "Untitled-2.md",
  });

  const panels = useWorkspaceStore.getState().api?.panels ?? [];
  expect(panels.map((panel) => panel.id)).toContain("pier.files.untitled:1");
  expect(panels.map((panel) => panel.id)).toContain("pier.files.untitled:2");
});

it("focuses an existing instance when instance id already exists", () => {
  const context = createRendererPluginContext(entryWithPanel());
  const instanceId = "pier.files.file:test-readme";

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    instanceId,
    title: "README.md",
  });
  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    instanceId,
    title: "README.md",
  });

  expect(
    (useWorkspaceStore.getState().api?.panels ?? []).filter(
      (panel) => panel.id === instanceId
    )
  ).toHaveLength(1);
});

it("closes all panel instances for a disabled plugin component", () => {
  registerPluginPanel({ component: TestPanel, icon: FileText, id: "pier.files.filePanel", kind: "web" });
  closePanelsByPluginComponent("pier.files.filePanel");
  expect(hasPanelWithComponent("pier.files.filePanel")).toBe(false);
});

it("keeps a valid workspace when closing the last plugin panel", () => {
  openOnlyPluginPanels("pier.files.filePanel");
  closePanelsByPluginComponent("pier.files.filePanel");
  expect(
    useWorkspaceStore
      .getState()
      .api?.panels.some((panel) => panel.view.contentComponent === "welcome")
  ).toBe(true);
});

it("requires panel:open for both singleton and instance panel open", () => {
  const context = createRendererPluginContext(entryWithoutPanelOpen());
  expect(() => context.panels.open("pier.files.filePanel")).toThrow();
  expect(() =>
    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "pier.files.untitled:1",
    })
  ).toThrow();
});

it("requires register capabilities for action and panel registration", () => {
  const context = createRendererPluginContext(entryWithoutRegisterCapabilities());
  expect(() => context.actions.register(testAction)).toThrow();
  expect(() => context.panels.register(testPanelRegistration)).toThrow();
});

it("allows non-context-menu callers to invoke actions without invocation", async () => {
  const handler = vi.fn();
  actionRegistry.register({
    handler,
    id: "pier.test.noInvocation",
    surfaces: ["command-palette"],
    title: () => "No Invocation",
  });

  await actionRegistry.get("pier.test.noInvocation")?.handler();

  expect(handler).toHaveBeenCalledWith();
});
```

运行：

```bash
pnpm vitest run tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/context-menu-action-invocation.test.ts
```

预期：失败，因为 `openInstance` 和按 component 关闭尚不存在。

- [ ] **步骤 2：扩展插件 API**

`src/plugins/api/renderer.ts` 增加：

```ts
export interface ActionInvocation {
  sourcePanelContext?: PanelContext;
  sourcePanelComponent?: string;
  sourcePanelId?: string;
  surface?: string;
}

export type RendererPluginActionInvocation = ActionInvocation;

export interface RendererPluginAction {
  // 保留现有字段，仅修改 handler 签名。
  handler: (invocation?: RendererPluginActionInvocation) => Promise<void> | void;
}

export interface PluginPanelInstanceOptions {
  componentId: string;
  context?: PanelContext;
  instanceId: string;
  params?: Record<string, unknown>;
  title?: string;
}

export interface RendererPluginPanelContext {
  getActiveContext(): PanelContext | null;
  open(panelId: string, options?: { context?: PanelContext }): void;
  openInstance(options: PluginPanelInstanceOptions): void;
  register(registration: PluginPanelRegistration): () => void;
}
```

现有无参 action 调用点必须继续工作，所以 invocation 是可选参数。终端右键菜单传来源 panelId 和来源 `PanelContext`；命令面板、快捷键、标题栏按钮等非右键入口可以省略 invocation。
实现时必须保证整条调用链都透传 invocation：`popupAndDispatch` 调 `action.handler(invocation)`，`Action.handler` 接收可选 invocation；host-only `ActionContribution.handler` 只在 `src/renderer/lib/actions/contribution-types.ts` 修改，不放进插件 API；`host-context` 的 `adaptAction` 权限包装器校验命令权限后继续调用 `action.handler(invocation)`，`createActionFromContribution` 也把 invocation 传给 contribution handler。

保留 `open(panelId)` 给单例面板，`openInstance` 只服务同一个 component 多个 dockview 实例。

- [ ] **步骤 3：host-context 实现 openInstance**

实现规则：

- `assertDeclaredContribution(entry, "panel", componentId)`。
- `assertPluginCapability(entry, "panel:open")`。
- 同步补齐既有 `panels.open(panelId)` 的 `panel:open` 权限断言，确保单例 panel 和多实例 panel 入口权限一致。
- `actions.register` 必须断言 `command:register`，`panels.register` 必须断言 `panel:register`，避免 manifest 只声明贡献但没有注册权限。
- 确认 `componentId` 已注册在 `plugin-panel-registry`。
- 先解析标题：`const resolvedTitle = title ?? resolveRegistrationTitle(registration, componentId)`，不要直接使用可能是函数的 `registration.title`。
- 复用现有 `openPluginPanel` 的 descriptor 写入语义：用 `instanceId` 调 `usePanelDescriptorStore.getState().upsert(...)`，保留或写入 `options.context`，并把 display title 写成 `resolvedTitle`。
- 打开实例时不要复用当前 `useWorkspaceStore.addPanel` 的 `TerminalPanelParams` 窄类型；实现必须直接使用 `useWorkspaceStore.getState().api.addPanel(...)`（沿用现有 `openPluginPanel` 模式）或先新增专用 generic plugin panel 打开方法，`params` 类型为 `Record<string, unknown>`。
- 调用 dockview 时使用：
  - dockview panel id = `instanceId`
  - dockview component = `componentId`
  - title = `resolvedTitle`
  - params = `{ ...(registration.getParams?.() ?? {}), ...params, ...(context ? { context } : {}), pluginComponentId: componentId }`
- 同一个 `instanceId` 已存在时，更新 params、descriptor 和 title，然后激活现有 panel；不得用 `as any` 绕过 params 类型。

- [ ] **步骤 4：插件禁用关闭所有实例**

现有 `WorkspaceHost` 已经在插件 disposer 注入的 closer 中按 `panel.view.contentComponent` 匹配并在最后一批 plugin panel 关闭前补 welcome。修订要求：

- 把 `plugin-panel-registry` 中 closer 参数语义从 `panelId` 明确改名为 `componentId`。
- 保留实际关闭实现位于 `WorkspaceHost`，不要新增通用 `closePanelsWhere`，避免把“插件禁用清理时补 welcome”的语义和用户主动关闭最后 panel 时“关闭窗口”的语义混在一起。
- 如需导出测试 helper，命名为 `closePanelsByPluginComponent(componentId)`，内部只委托当前插件 closer，不绕过 workspace 边界直接 import dockview。

- [ ] **步骤 5：验证**

运行：

```bash
pnpm vitest run tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/context-menu-action-invocation.test.ts
pnpm typecheck
```

---

## 任务 3：终端选区读取能力

**文件：**

- 修改：`src/shared/contracts/terminal.ts`
- 修改：`src/preload/terminal-api.ts`
- 修改：`src/main/ipc/terminal.ts`
- 修改：`src/main/ipc/terminal-operations.ts`
- 修改：`src/main/ipc/terminal-native-addon.ts`
- 修改：`native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+PublicInput.swift`
- 修改：`native/Sources/GhosttyBridge/GhosttyBridge.swift`
- 修改：`native/src/addon.mm`
- 测试：`tests/unit/main/terminal-selection-ipc.test.ts`

- [ ] **步骤 1：写失败测试**

测试覆盖：

- 没有 panelId、非 string panelId、空字符串或纯空白 panelId 时返回 `{ kind: "empty" }` 或明确错误，不构造 `win::undefined` / `win::` native key。
- panelId 不存在时返回 `{ kind: "empty" }`，与无选区一样不抛未处理异常。
- native addon 返回字符串时 IPC 返回 `{ kind: "ok", text }`。
- 多窗口同名 renderer panelId 通过 `toNativePanelKey(win, panelId)` 隔离，不会串读。

运行：

```bash
pnpm vitest run tests/unit/main/terminal-selection-ipc.test.ts
```

- [ ] **步骤 2：定义共享契约**

`src/shared/contracts/terminal.ts`：

```ts
export type TerminalSelectionTextResult =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; text: string };

// 在现有 TerminalAPI 中新增；不要替换现有 terminal 方法。
readSelectionText(panelId: string): Promise<TerminalSelectionTextResult>;
```

- [ ] **步骤 3：preload 暴露窄 API**

`src/preload/terminal-api.ts`：

```ts
readSelectionText(panelId: string) {
  return ipcRenderer.invoke("pier:terminal:read-selection-text", panelId);
}
```

- [ ] **步骤 4：main IPC 接 native addon**

在 terminal IPC 注册：

```ts
ipcMain.handle("pier:terminal:read-selection-text", async (event, panelId: unknown) => {
  const trimmedPanelId = typeof panelId === "string" ? panelId.trim() : "";
  if (!trimmedPanelId) {
    return { kind: "empty" } satisfies TerminalSelectionTextResult;
  }
  const win = windowFromWebContents(event.sender);
  if (!win) {
    return { kind: "error", message: "Terminal window is not available." } satisfies TerminalSelectionTextResult;
  }
  const text = readTerminalSelectionText({
    addon,
    loadError,
    panelId: trimmedPanelId,
    win,
  });
  if (!text) {
    return { kind: "empty" } satisfies TerminalSelectionTextResult;
  }
  return { kind: "ok", text } satisfies TerminalSelectionTextResult;
});
```

错误转成 `{ kind: "error", message }`，不要让 renderer 收到未分类异常。
`readTerminalSelectionText` 必须按现有 native 操作模式先用 `toNativePanelKey(win, panelId)` 得到窗口作用域的 native panel key，不能直接把 renderer panelId 传给 native addon。测试要覆盖错误 panelId 和多窗口不会串读。

- [ ] **步骤 5：native bridge 读取 Ghostty selection**

实现方向：

- 在 `AppTerminalView+PublicInput.swift` 新增公开 `readSelectionText()` wrapper，优先薄封装已有 `surface?.readSelection()`；只有需要区分空选区和异常时才额外公开 `hasSelection()`。
- 如果实现层直接调用 `ghostty_surface_read_selection`，必须把 `ghostty_text_s.text[0..<text_len]` 拷贝成 Swift/JS 字符串，并在所有成功路径用 `ghostty_surface_free_text` 释放 native buffer。
- Swift bridge 在 `GhosttyBridge` 里按 native panel key 找到 terminal view，并调用公开 wrapper；若无选区返回 `nil`。
- `addon.mm` 暴露 `readSelectionText(nativePanelKey)`，JS 层拿到 `string | null`。

约束：

- 不执行 copy action。
- 不读系统剪贴板。
- 不把选区写入 transcript 或布局。

- [ ] **步骤 6：验证**

运行：

```bash
pnpm vitest run tests/unit/main/terminal-selection-ipc.test.ts
pnpm typecheck
pnpm build:native
```

---

## 任务 4：插件宿主终端上下文

**文件：**

- 修改：`src/plugins/api/renderer.ts`
- 新建：`src/renderer/lib/plugins/host-terminal-context.ts`
- 修改：`src/renderer/lib/plugins/host-context.ts`
- 测试：`tests/unit/renderer/plugin-terminal-context.test.ts`

- [ ] **步骤 1：写失败测试**

覆盖：

- 插件没有 `terminal:read` 权限时，调用 `context.terminal.readSelectionText` 抛权限错误。
- 不传 panelId 时，只用于命令面板等无来源场景，读取当前活动终端 panel。
- 当前活动 panel 不是终端时，返回 `{ kind: "empty" }`。
- 传入 panelId 时调用 `window.pier.terminal.readSelectionText(panelId)`。
- governance 扫描测试覆盖 builtin plugin 代码不得直接调用 `window.pier.terminal.readSelectionText`，必须经 `context.terminal` facade；这是同 realm builtin 插件下的工程纪律边界，不是恶意代码安全沙箱。

- [ ] **步骤 2：扩展 RendererPluginContext**

`src/plugins/api/renderer.ts`：

```ts
export interface RendererPluginTerminalContext {
  activePanelId(): string | null;
  readSelectionText(panelId?: string): Promise<TerminalSelectionTextResult>;
}

export interface RendererPluginContext {
  terminal: RendererPluginTerminalContext;
}
```

- [ ] **步骤 3：实现 host-terminal-context**

实现规则：

- 使用 workspace store 或现有 terminal action runtime 获取 active terminal panel id。
- `readSelectionText(panelId)` 先断言 `terminal:read`。
- 终端右键菜单 action 必须传入 invocation 的 `sourcePanelId`；不要依赖 active panel。
- 如果没有目标 panel，返回 `{ kind: "empty" }`。
- 调用 preload API，不允许绕过 preload 访问 main。

- [ ] **步骤 4：验证**

运行：

```bash
pnpm vitest run tests/unit/renderer/plugin-terminal-context.test.ts
pnpm typecheck
```

---

## 任务 5：files 文档缓冲区

**文件：**

- 新建：`src/plugins/builtin/files/renderer/files-document-store.ts`
- 测试：`tests/unit/renderer/files-document-store.test.ts`

- [ ] **步骤 1：写失败测试**

覆盖：

- 创建临时 Markdown 文档，id 为 `pier.files.untitled:<n>`，name 为 `Untitled-<n>.md`。
- 创建磁盘文档 shell，id 为 `pier.files.file:<stable hash>`，不重复创建。
- `updateDocumentContents` 修改 `currentContents` 后 `dirty === true`。
- `markSaved` 同步 `savedContents`，并把 `dirty` 置为 false。
- `markDocumentLoading` 把磁盘文档从 `idle` 同步切到 `loading`，避免 React rerender/StrictMode 重复发起 `readText`。
- `removeDocument` 删除临时文档后，`getDocument(id) === null`，终端选区正文不再留在 renderer 内存。
- `clearFilesDocumentStore` 在 files 插件 deactivate 时清空本插件文档缓冲区。
- `subscribe` 在文档变化时通知 React。
- 从 `{ kind: "disk", root, path }` panel source 能重建磁盘 document shell。
- 从 `{ kind: "untitled", id, name }` panel source 不会携带临时正文。

- [ ] **步骤 2：实现 store**

实现原则：

- 模块内 `Map<string, FilesDocument>` 保存状态。
- 模块内自增计数只用于临时文档命名。
- 用 `useSyncExternalStore` 对 React 暴露订阅。
- 磁盘文件 id 使用 `pier.files.file:<stable hash>`，hash 输入为 `root + "\0" + path`。
- 临时文件正文保存为 renderer 本地草稿缓存，用于强制退出/重启后按 `id` 恢复；dockview layout params 仍只保存 `FilesDocumentPanelSource`，不直接携带正文。对应 file-panel 关闭或 files 插件 deactivate 后必须释放内存与草稿缓存。

关键导出：

```ts
export function createUntitledMarkdownDocument(input: {
  contents: string;
  origin?: FilesDocumentOrigin;
}): FilesDocument;

export function ensureDiskDocument(input: {
  name?: string;
  path: string;
  root: string;
}): FilesDocument;

export function getDocument(documentId: string): FilesDocument | null;
export function updateDocumentContents(documentId: string, contents: string): void;
export function markDocumentLoading(documentId: string): void;
export function markDocumentLoaded(documentId: string, contents: string): void;
export function markDocumentSaved(documentId: string): void;
export function markDocumentError(documentId: string, message: string): void;
export function removeDocument(documentId: string): void;
export function clearFilesDocumentStore(): void;
export function useFilesDocument(documentId: string): FilesDocument | null;
```

- [ ] **步骤 3：验证**

运行：

```bash
pnpm vitest run tests/unit/renderer/files-document-store.test.ts
pnpm typecheck
```

---

## 任务 6：file-panel 源码编辑和 Markdown 预览

**文件：**

- 新建：`src/plugins/builtin/files/renderer/code-mirror-editor.tsx`
- 新建：`src/plugins/builtin/files/renderer/markdown-preview.tsx`
- 新建：`src/plugins/builtin/files/renderer/file-panel.tsx`
- 测试：`tests/component/files-file-panel.test.tsx`

- [ ] **步骤 1：写失败组件测试**

覆盖：

- 临时 Markdown 文档打开后显示标题和未保存状态。
- `源码` 模式显示 CodeMirror 编辑器。
- 点击 `预览` 后渲染 Markdown 表格、列表和代码块。
- Markdown 中的原始 HTML 被转义或移除，不渲染为真实 DOM。
- Markdown 链接中的 `javascript:`、`vbscript:`、危险 `data:` URL 不可点击执行；点击普通链接不导航当前 Electron renderer window。
- 测试代码扫描或断言实现没有引入 `rehype-raw`，也没有使用 `dangerouslySetInnerHTML`。
- dockview params 只包含 `FilesDocumentPanelSource`，不包含临时文件正文。
- 缺失、损坏或旧版本 `params.source` 显示只读错误状态，不调用 `readText` / `writeText`。
- 磁盘 source 在 document store 为空时能重建 document shell，先 `markDocumentLoading`，再调用一次 `readText` 加载；rerender 不重复读。
- 磁盘 source 的 `root` 不属于恢复出的 `PanelContext` 时显示只读错误状态，不调用 `readText` / `writeText`。
- 临时 source 在 document store 为空时先按 `id` 尝试从本地草稿缓存恢复；草稿不存在时显示只读不可恢复状态，并且不尝试从磁盘读取。
- 修改内容后调用 `updateDocumentContents` 并显示 dirty 状态。
- file-panel unmount 时释放 untitled document；disk document 可以保留缓冲区。

- [ ] **步骤 2：实现 CodeMirror 编辑器**

`code-mirror-editor.tsx`：

- 使用 `codemirror` 基础 setup。
- Markdown 文件加载 `@codemirror/lang-markdown`。
- 按 `readOnly` 配置编辑状态。
- `onChange` 只回传字符串，不暴露 CodeMirror 内部状态给 `file-panel`。

- [ ] **步骤 3：实现 Markdown 预览**

`markdown-preview.tsx`：

- 使用 `react-markdown`。
- 启用 `remark-gfm`。
- 启用 `rehype-sanitize`。
- 不启用 `rehype-raw`。
- 自定义 `a` 渲染：默认 `preventDefault`，只允许安全协议；如果后续要打开外链，必须走宿主外链打开策略，不直接导航当前窗口。
- 容器处理宽表格横向滚动。

- [ ] **步骤 4：实现 file-panel**

`file-panel.tsx` 行为：

- 从 dockview params 读取可序列化 `source`，而不是只读内存态 `documentId`；必须先用 `parseFilesDocumentPanelSource(props.params)` 解析，解析失败显示只读错误状态。
- 如果 source 是磁盘文件，先用 `isDiskSourceRootAllowed(source.root, props.params?.context)` 校验 root，再 mount；校验失败显示只读错误状态。
- 如果 source 是磁盘文件，mount 时用 `{ root, path }` 调 `ensureDiskDocument` 重建或获取 document shell，再用 `useFilesDocument(document.id)` 读文档。
- 如果 source 是临时文件，mount 时先用 `id` 查 document store；找不到时尝试从本地草稿缓存恢复；仍找不到时显示“临时文件已不可恢复”的只读状态，并展示 params 中的 `name`。
- 磁盘文档且 `loadState === "idle"` 时先同步 `markDocumentLoading(document.id)`，再调用 `context.files.readText`；失败调用 `markDocumentError`。
- 顶部显示文件名、dirty 状态、保存按钮和 `源码` / `预览` 切换。
- 临时文件不显示普通保存按钮；后续 `另存为` 单独设计。
- 磁盘文件保存调用 `context.files.writeText`，成功后 `markDocumentSaved`。
- 临时文档在内存和草稿缓存中都不存在时显示“临时文件已不可恢复”的只读状态。
- 本期只展示 dirty 状态和提供保存按钮，不实现 dockview close 拦截/关闭确认；关闭脏文档的统一 close guard 需要后续单独设计。

- [ ] **步骤 5：验证**

运行：

```bash
pnpm vitest run tests/component/files-file-panel.test.tsx
pnpm typecheck
```

---

## 任务 7：files 插件注册单一 file-panel 和打开动作

**文件：**

- 修改：`src/plugins/builtin/files/manifest.ts`
- 修改：`src/plugins/builtin/files/renderer/index.tsx`
- 新建：`src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- 新建：`src/plugins/builtin/files/renderer/files-tree-store.ts`
- 修改：`src/plugins/builtin/files/locales/en.json`
- 修改：`src/plugins/builtin/files/locales/zh-CN.json`
- 测试：`tests/unit/renderer/files-terminal-action.test.tsx`
- 测试：`tests/component/files-file-panel.test.tsx`

- [ ] **步骤 1：写失败测试**

覆盖：

- files manifest 只声明一个 panel：`pier.files.filePanel`。
- files manifest 声明 `pier.files.openSelectionAsMarkdown` 命令，且命令级 permissions 包含 `terminal:read`、`panel:open`。
- activate 后 `terminal/content` surface 在 `清屏` 后出现 `Markdown 内容预览`。
- action 从调用上下文读取触发菜单的 terminal panelId，并调用 `context.terminal.readSelectionText(panelId)`。
- 有选区时创建 untitled Markdown 文档并调用 `context.panels.openInstance`。
- action 测试覆盖：右键菜单来源 panelId 不等于当前活动终端时，读取来源 panelId 的选区。
- action 测试覆盖：来源 terminal context 不等于当前 active context 时，`openInstance.context` 使用 `invocation.sourcePanelContext`。
- terminal-panel native 右键转发路径测试覆盖：`popupContextMenuAt("terminal/content", coords, { sourcePanelComponent: "terminal", sourcePanelContext: effectiveContext, sourcePanelId: req.panelId })`。
- file-panel 组件测试覆盖：项目 context 下显示内嵌可折叠目录树；点击文件节点在当前 tab 更新 params/title 并加载文件，不调用 `context.panels.openInstance`。
- 无选区时不打开 panel，并显示通知。
- deactivate files 插件会移除 file-panel/action registration，并调用 `clearFilesDocumentStore` 和 `clearFilesTreeStore`。
- locales 沿用当前 files 插件格式：贡献标题写 `panels[panelId].title` / `commands[commandId].title`，运行时 UI 文案写 `messages`（例如 `filePanel.title`、`files.actions.openSelectionAsMarkdown.title`、`files.notifications.noTerminalSelection`）。

- [ ] **步骤 2：更新 manifest**

新增常量：

```ts
export const FILES_FILE_PANEL_ID = "pier.files.filePanel";
export const FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID =
  "pier.files.openSelectionAsMarkdown";
```

manifest：

- `commands` 增加 `pier.files.openSelectionAsMarkdown`，命令级 `permissions` 至少包含 `terminal:read`、`panel:open`，用于审计和触发时校验。
- `panels` 仅包含 `pier.files.filePanel`。
- 插件级 `permissions` 包含 `command:register`、`panel:register`、`panel:open`、`file:read`、`file:write`、`terminal:read`。

- [ ] **步骤 3：把目录树并入 file-panel**

新增 `file-tree-sidebar.tsx` 和 `files-tree-store.ts`。`file-panel` 根据 `PanelContext` 推导项目 root；有 root 时显示可折叠目录树侧边栏，无 source 时显示空文件状态。

文件点击逻辑在当前 tab 内完成：

```ts
function openTreeFile(entry: FileEntry): void {
  const source = { kind: "disk", path: entry.path, root: entry.root };
  ensureDiskDocument({ name: nameFromPath(entry.path), path: entry.path, root: entry.root });
  setSelectedSource(source);
  props.api.updateParameters({ ...props.params, source });
  props.api.setTitle(nameFromPath(entry.path));
}
```

目录点击继续懒加载子节点，不打开新的 dockview panel。目录树加载状态按项目 root 共享；折叠偏好写入 renderer 本地存储并按项目 root 区分。

- [ ] **步骤 4：注册唯一 file-panel**

`index.tsx` activate 必须只注册 `FILES_FILE_PANEL_ID` 一个 panel，并聚合 registration/action disposer，返回单个反向清理函数：

```ts
const disposers = [
  context.panels.register({
    component: createFilesFilePanel(context),
    icon: FileText,
    id: FILES_FILE_PANEL_ID,
    kind: "web",
    title: () => t("filePanel.title", "File"),
  }),
  context.actions.register(openSelectionAsMarkdownAction),
];

return () => {
  clearFilesDocumentStore();
  clearFilesTreeStore();
  for (const dispose of disposers.toReversed()) {
    dispose();
  }
};
```

- [ ] **步骤 5：注册终端右键菜单动作**

```ts
context.actions.register({
  category: "file",
  handler: async (invocation) => {
    const sourcePanelId = invocation?.sourcePanelId;
    if (!sourcePanelId) {
      context.notifications.info(t("files.notifications.noTerminalSelection"));
      return;
    }
    const result = await context.terminal.readSelectionText(sourcePanelId);
    if (result.kind !== "ok" || result.text.trim().length === 0) {
      context.notifications.info(t("files.notifications.noTerminalSelection"));
      return;
    }

    const document = createUntitledMarkdownDocument({
      contents: result.text,
      origin: { panelId: sourcePanelId, source: "terminal-selection" },
    });
    if (document.source.kind !== "untitled") {
      return;
    }

    context.panels.openInstance({
      componentId: FILES_FILE_PANEL_ID,
      instanceId: document.id,
      context: invocation?.sourcePanelContext,
      params: {
        source: {
          id: document.source.id,
          kind: "untitled",
          name: document.name,
        },
      },
      title: document.name,
    });
  },
  id: FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
  surfaces: ["terminal/content"],
  title: () => t("files.actions.openSelectionAsMarkdown.title"),
});
```

- [ ] **步骤 6：验证**

运行：

```bash
pnpm vitest run tests/unit/renderer/files-terminal-action.test.tsx tests/component/files-file-panel.test.tsx
pnpm typecheck
```

---

## 任务 8：项目文件管理预留点

**文件：**

- 修改：`src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- 修改：`src/plugins/builtin/files/renderer/files-tree-store.ts`
- 修改：`src/plugins/builtin/files/renderer/file-panel.tsx`
- 修改：`src/plugins/builtin/files/renderer/files-document-types.ts`

- [ ] **步骤 1：保持文件树会话边界**

本期不递归扫描仓库，不把树状态塞进 `FileService`，也不新建 `project-tree-service.ts`。`ProjectTreeService` 只作为后续方向保留在设计文档中：未来提供 `listChildren`、`refresh`、`reveal` 三类能力，并由 main 侧拥有目录 watch 和会话状态。

第一版内嵌目录树仍可直接用 `context.files.list`，但所有调用点都要集中在 `files-tree-store.ts` / `file-tree-sidebar.tsx`，方便后续切到 `ProjectTreeService`。

- [ ] **步骤 2：保留文件操作扩展位**

`FilesDocument.capabilities` 已在文档类型中建模。本期能力规则：

- 磁盘文本文件：`["save"]`。
- 临时 Markdown 文件：`[]`，暂不启用 `saveAs`。
- 未来 delete/move/rename/reveal/saveAs 必须先补 UI、确认弹窗和测试，再加入 capabilities。

- [ ] **步骤 3：保留未来 watch 和 reveal**

不在本期实现目录 watch，但 file-panel 内嵌目录树状态要按 root/path 组织，不把全局树数据混入文档 store。后续 watch 更新只刷新目录树，不影响已打开文档的编辑缓冲区。

- [ ] **步骤 4：验证**

运行：

```bash
pnpm vitest run tests/unit/renderer/files-document-store.test.ts tests/component/files-file-panel.test.tsx
pnpm depcruise
```

---

## 任务 9：端到端验证和架构验收

**文件：**

- 按需修改 `tests/unit`、`tests/component` 和 `tests/e2e` 下的测试。

- [ ] **步骤 1：运行目标测试**

运行：

```bash
pnpm vitest run tests/unit/main/terminal-selection-ipc.test.ts tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/context-menu-action-invocation.test.ts tests/unit/renderer/plugin-terminal-context.test.ts tests/unit/renderer/files-document-store.test.ts tests/unit/renderer/files-terminal-action.test.tsx tests/component/files-file-panel.test.tsx
```

- [ ] **步骤 2：运行架构和类型检查**

运行：

```bash
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm build:native
```

- [ ] **步骤 3：运行完整检查**

运行：

```bash
pnpm check
```

- [ ] **步骤 4：手工验证**

1. 启动应用：`pnpm dev`。
2. 在终端选中一段包含 Markdown 表格或列表的输出。
3. 右键选择 `Markdown 内容预览`，确认菜单项位于 `清屏` 后。
4. 确认打开的是新的 `Untitled-*.md` file-panel。
5. 切换 `源码` / `预览`，确认源文本未被替换。
6. 在带项目 context 的 file-panel 内展开目录树，点击项目文件，确认当前 tab 切换到具体磁盘文件且目录树状态复用。
7. 强制退出后重启或模拟 dockview layout 恢复后，磁盘文件 panel 能通过 params.source 重新加载内容，临时文件 panel 能通过本地草稿缓存恢复正文；layout params 仍不含正文。
8. 禁用 files 插件或模拟插件卸载，确认所有 files component 实例关闭，且临时文档 store 被清空。
9. 尝试 Markdown 中的危险链接（如 `javascript:`），确认不会执行，也不会导航当前窗口。
10. 关闭 dirty 文档时确认本期行为与非目标一致：只显示 dirty 状态，不做 close 拦截。

---

## 需求到证据矩阵

| 需求 | 证据 |
|---|---|
| files 插件注册终端右键菜单 | `tests/unit/renderer/files-terminal-action.test.tsx` 断言 `terminal/content` 菜单包含 `pier.files.openSelectionAsMarkdown` |
| 终端与 files 解耦 | `pnpm depcruise` 通过，且 `src/renderer/panel-kits/terminal` 不 import files 插件 |
| 读取终端选区不污染剪贴板 | `tests/unit/main/terminal-selection-ipc.test.ts` 覆盖 `readSelectionText`，实现不调用 copy 或剪贴板 API |
| 临时 Markdown 文件不写入项目文件 | files action 测试断言不调用 `context.files.writeText`；强退恢复使用 renderer 本地草稿缓存 |
| 布局参数不保存正文 | component 测试断言 params 只含 `FilesDocumentPanelSource`；磁盘文件通过文件系统恢复，临时文件正文通过本地草稿缓存恢复 |
| 布局参数运行时安全 | component 测试覆盖 malformed source、非法 path、未知 root 时不调用 `readText` / `writeText` |
| 临时选区内存生命周期 | store/component 测试断言关闭 untitled panel 或插件 deactivate 后临时正文从 document store 删除 |
| file-panel 多实例 | `tests/unit/renderer/plugin-panel-instances.test.ts` 断言同 component 多 instance id 可共存 |
| 单一 file-panel 架构 | files manifest 和 activate 只注册 `pier.files.filePanel` |
| 项目文件树只负责导航 | `tests/component/files-file-panel.test.tsx` 证明内嵌目录树点击文件后更新当前 tab params/title，不调用 `openInstance` |
| 项目目录树复用 | `tests/component/files-file-panel.test.tsx` 证明同项目 root 多个 file-panel 共享 tree store，折叠偏好按 root 记忆 |
| 磁盘文件可编辑保存 | file-panel 组件测试断言 `readText` / `writeText` |
| Markdown 预览安全 | 组件测试断言 raw HTML 不渲染为真实 DOM；危险 URL 不执行；链接点击不导航当前窗口；代码不引入 `rehype-raw`，不使用 `dangerouslySetInnerHTML` |
| 后续差异视图可扩展 | `FileViewMode` 和 `FileEditorAdapterProps.originalValue` 存在 |
| 后续类 Notion 体验可扩展 | `FileViewMode.rich` 存在，文档 store 仍保存 Markdown 文本真源 |
| 后续项目文件管理可扩展 | file-panel、file tree store、document store 分离；`ProjectTreeService` 接口预留 |

## 实施顺序建议

1. 先完成任务 2、任务 3、任务 4，打通平台能力。
2. 再完成任务 5、任务 6，建立 files 插件自己的文档和面板。
3. 最后完成任务 7、任务 8、任务 9，接入用户可见入口并做架构验收。

这个顺序能尽早暴露进程边界和 native 选区读取风险，避免先写 UI 后发现能力链路不成立。
