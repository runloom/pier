# File 插件组级文件标签修复实施计划

> **给执行代理:** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行本计划。步骤使用复选框（`- [ ]`）格式跟踪。

**目标:** 根治 file 插件在 dockview 多组、多标签、跨组拖拽时的文件内容串扰，让 B 组文件操作不会影响 A 组剩余文件标签。

**架构:** 拆开三种身份：文件文档身份、dockview 标签实例身份、dockview 组状态。文件文档按 `root + path` 或 untitled id 全局共享；标签实例使用独立随机 id；组级文件工作区只读取本组 `activePanel.params`。宿主 panels facade 提供只读实例快照和目标 group 内打开/替换能力；files 插件保留文件语义，但不直接 import dockview。

**技术栈:** Electron 42、React 19、TypeScript 6 strict、dockview-react 7.0.2、Zustand 5、Vitest 4、Testing Library、dependency-cruiser。

---

## 架构敏感判断

这是架构敏感任务，涉及插件系统、dockview 组边界、UI 扩展点、数据流和测试体系。禁止用以下方式处理：

- 多监听一个 active 事件后强行刷新。
- 用延迟、点击、focus 让 UI 自愈。
- 在宿主层继续全局扫描并关闭所有未固定文件标签。
- 用文件路径 hash 作为全局 panel id 规避同文件复用问题。

## 目标和完成标准

目标：

- A 组打开 a1/a2，拖 a2 到 B 组后，A 组立即展示 a1，B 组展示 a2。
- B 组打开或替换预览文件时，只影响 B 组未固定预览标签。
- 同一磁盘文件可以在多个 group 中各有一个标签；内容 buffer 可共享。
- 同一 group 内再次打开同一文件时复用已有同源标签，不创建重复标签。
- 复用已有标签时保留完整 params，不能丢 `context`、`dirty`、`pluginComponentId`。
- 关闭同文件的一个标签时，只有没有其它同源标签后才允许保存/丢弃共享 disk document；非最后一个 dirty 标签关闭时不弹保存确认。
- 命令面板触发文件树搜索时只定位到当前活动文件标签所在 group；没有活动文件标签 group 时静默 no-op，不再按 root 命中最后注册的树。
- 文件树展开/折叠仍是项目级偏好，这是当前产品行为；本计划只要求树搜索、导航历史、视图模式、预览替换按 group 隔离。
- files 插件不得直接 import `dockview-react` / `dockview-core` / `dockview`。

完成标准：

- 新增失败测试证明旧的全局 preview 替换会误伤其它 group。
- 新增测试覆盖 `targetGroupId` 失效、无 active group 时不会全局关闭。
- 新增测试覆盖共享 disk document 的干净关闭策略和 dirty 关闭守卫策略。
- 新增测试覆盖 `groupContent` 从 manifest 声明到 `createRendererPluginContext()` 注入再到真实 DOM claim/release 的完整宿主链路。
- 新增 dependency-cruiser 规则锁住插件不得直接 import dockview。
- `pnpm typecheck`、`pnpm depcruise` 通过。
- `pnpm vitest run tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/files-document-store.test.ts tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts tests/unit/renderer/files-terminal-action.test.tsx tests/unit/renderer/workspace-host-invariants.test.ts` 通过。

## 当前结构为什么不足

已有正确方向：

- `FilePanelContent` 通过 `onDidGroupChange` 处理跨组拖拽，跨组时重新 claim/release 组视图。
- `FilesGroupView` 直接读取 `group.activePanel + activePanel.params`，不维护并行 active 镜像。
- `FilesGroupViewHost` 用 owner 计数避免 tab 切换时重建 group 视图。

仍不足：

- `host-panels-context.ts` 的 `dropUnpinnedInstances` 仍可能按 `api.panels` 全局关闭。
- `fileFilePanelInstanceId(source)` 将文件身份与标签实例身份绑定，同一文件跨 group 无法自然拥有独立标签。
- `listInstances` 能力不存在，files 插件只能靠全局 deterministic id 找实例。
- 关闭一个干净 disk tab 会直接 `removeDocument(diskDocumentId)`，这会清掉其它 group 仍在使用的共享文档。
- 关闭一个 dirty disk tab 时，`registerDirtyCloseGuard` 的“不保存”分支会直接 `removeDocument(document.id)`，这同样会清掉其它 group 仍在使用的共享文档。
- 命令面板文件树搜索按 root fallback，可能命中另一个 group 的树。
- 当前 `FilesGroupViewHost` 在插件目录里知道 `.dv-content-container`，长期不应让插件掌握 dockview DOM 细节。

## 所有权划分

数据：

- `files-document-store.ts` 拥有文档内容、dirty、mtime、草稿、加载和保存状态。
- `panel.params` 拥有标签自己的 `source`、`context`、`pinned`、`dirty`。
- `file-panel-id.ts` 只提供文件身份 key 和新标签实例 id。

策略：

- files 插件决定“同一 group 内是否已有同 source 标签”。
- files 插件决定“关闭 disk tab 时是否还有其它同 source 标签”。
- 宿主 panels facade 只决定“目标 group 内如何打开、激活、关闭 preview”。

执行：

- `host-panels-context.ts` 是插件打开 dockview panel 的唯一执行层。
- `host-group-content-context.tsx` 是 group content DOM 注入的唯一执行层，并校验 manifest `groupContent` 声明。
- files 插件只调用 `context.panels` 和 `context.groupContent`。

UI：

- `FilesGroupView` 是 group 级文件工作区。
- `FilePanelContent` 是标签薄壳，只负责生命周期、dirty 写入 params、group view owner 计数。

状态：

- `group.activePanel + activePanel.params` 是 group 当前文件展示的唯一权威来源。
- `context.panels.listInstances` 是插件查看自身 panel 分布的只读快照。

## 入口到效果的数据流

单击 B 组文件树中的 `b.md`：

1. `FilesGroupView(groupB)` 收到 `onOpenFile(entry, { pinned: false })`。
2. 它调用 `context.panels.listInstances(FILES_FILE_PANEL_ID)`。
3. 它只在 `groupId === groupB.id` 的实例中用 `params.source` 查同源标签。
4. 找到同源标签：调用 `openInstance` 激活该标签，并合并保留 `existing.params`。
5. 没找到同源标签：创建新随机标签实例 id，调用 `openInstance({ targetGroupId: groupB.id, dropUnpinnedInstances: true })`。
6. 宿主只在 groupB 内关闭未固定 preview；`targetGroupId` 失效或无 active group 时跳过关闭，绝不扫描 `api.panels`。
7. 新标签通过 `{ position: { referenceGroup: groupB, direction: "within" } }` 加进 B 组。

跨组拖拽 a2：

1. dockview 改变 a2 的 group，React 内容不可靠 remount。
2. 薄壳收到 `onDidGroupChange` 后 release A owner、claim B owner。
3. A 组视图读取 A 的 active panel params，显示 a1。
4. B 组视图读取 B 的 active panel params，显示 a2。

关闭 A 组同文件标签：

1. dirty close guard 先通过 `listInstances` 查询其它同 source 标签。
2. 如果其它 group 仍有同 source 标签，guard 直接允许关闭当前标签，不弹保存/丢弃确认，也不移除 document。
3. `onDidRemovePanel` 标记该 panel 真关闭。
4. cleanup 时再次查询其它同 source 标签。
5. 如果其它 group 仍有同 source 标签，不移除 disk document。
6. 如果这是最后一个同 source 标签，且文档干净，才 `removeDocument(documentId)`；若 dirty，则由 guard 的保存/丢弃选择决定。

## 明确禁止的反模式

- 禁止 files 插件直接 import dockview。
- 禁止任何 destructive preview close fallback 到 `api.panels`。
- 禁止 group view 写局部 params 覆盖完整 params。
- 禁止把 `panel.params` live object 作为可变引用暴露给插件。
- 禁止用 deterministic 文件 id 作为唯一 panel id。
- 禁止 `groupContent` 使用未声明、未命名空间化的 slot id。
- 禁止命令面板树搜索在找不到活动 file panel group 时按 root fallback。
- 禁止未经用户确认执行 `git add` / `git commit`。

## 文件结构

需要修改：

- `src/plugins/api/renderer.ts`
  - 增加 `PluginPanelInstanceSnapshot`、`targetGroupId`、`listInstances`。
  - 增加 `groupContent` facade 类型。

- `src/shared/contracts/plugin.ts`
  - 增加 `groupContent` manifest 贡献点 schema。

- `src/renderer/lib/plugins/host-panels-context.ts`
  - 实现只读实例快照。
  - 实现目标 group 内打开和 preview 替换。
  - 失效 group 不全局关闭。

- `src/renderer/lib/plugins/host-group-content-context.tsx`
  - 新建宿主拥有的 group content DOM 注入适配层。

- `src/renderer/lib/plugins/host-context.ts`
  - 把 `groupContent` 注入 `RendererPluginContext`。
  - 扩展 `assertDeclaredContribution` 支持 `groupContent`。

- `src/renderer/lib/plugins/runtime.ts`
  - 插件 dispose 后清理该插件命名空间下的 group content host。

- `src/plugins/builtin/files/manifest.ts`
  - 声明 `pier.files.groupView` group content 贡献点。

- `src/plugins/builtin/files/renderer/files-group-view-host.tsx`
  - 删除 DOM 注入实现，改为调用 `context.groupContent`。

- `src/plugins/builtin/files/renderer/file-panel-id.ts`
  - 拆分 identity key 和实例 id。

- `src/plugins/builtin/files/renderer/files-document-types.ts`
  - 增加 `sameFilesDocumentPanelSource`。

- `src/plugins/builtin/files/renderer/files-group-view.tsx`
  - 按 group 复用同 source 标签。
  - 传 `targetGroupId`。
  - 复用已有标签时合并完整 params。

- `src/plugins/builtin/files/renderer/file-panel.tsx`
  - 关闭 disk tab 前检查其它同 source 标签。

- `src/plugins/builtin/files/renderer/index.tsx`
  - 文件树搜索 action 定位当前 active file panel 的 groupId。
  - dirty close guard 在非最后一个同源标签关闭时不保存、不丢弃共享 document。
  - 删除旧 `clearFilesGroupViewHost` 清理路径，改由宿主 runtime 统一清理。

- `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
  - 传入 `instanceId` 时严格按 group 树查找；精确未命中不得按 root fallback。

- `src/plugins/builtin/files/renderer/files-panel-instance-utils.ts`
  - 新建同源实例查询 helper，供 close guard 和 file panel cleanup 复用。

- `dependency-cruiser.config.cjs`
  - 增加插件不得直接 import dockview 的规则。

需要修改测试：

- `tests/unit/renderer/plugin-panel-instances.test.ts`
- `tests/component/files-file-panel.test.tsx`
- `tests/unit/renderer/files-document-store.test.ts`
- `tests/unit/renderer/plugin-host-context.test.tsx`
- `tests/unit/renderer/host-group-content-context.test.tsx`
- `tests/unit/renderer/plugin-runtime.test.ts`
- `tests/unit/renderer/workspace-host-invariants.test.ts`

---

## Task 1: 扩展 panels facade 类型和只读快照

**Files:**

- Modify: `src/plugins/api/renderer.ts`
- Modify: `tests/unit/renderer/plugin-panel-instances.test.ts`

- [ ] **Step 1: 写失败测试，插件只能列出自己声明的 panel 实例**

在 `tests/unit/renderer/plugin-panel-instances.test.ts` 的 `describe("plugin panel instances", () => { ... })` 内加入：

```ts
it("lists only declared plugin panel instances with readonly params snapshots", () => {
  const filePanelA = mockPanel("file-a", "pier.files.filePanel", {
    source: { kind: "disk", path: "README.md", root: "/repo" },
  });
  const filePanelB = mockPanel("file-b", "pier.files.filePanel", {
    source: { kind: "disk", path: "NOTES.md", root: "/repo" },
  });
  const terminal = mockPanel("terminal-1", "terminal");
  const { api } = createMockApi([filePanelA, filePanelB, terminal], [
    { id: "group-a", panels: [filePanelA, terminal] },
    { id: "group-b", panels: [filePanelB] },
  ]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  const instances = context.panels.listInstances("pier.files.filePanel");

  expect(instances).toEqual([
    {
      componentId: "pier.files.filePanel",
      groupId: "group-a",
      id: "file-a",
      params: filePanelA.params,
      title: "file-a",
    },
    {
      componentId: "pier.files.filePanel",
      groupId: "group-b",
      id: "file-b",
      params: filePanelB.params,
      title: "file-b",
    },
  ]);
  expect(instances[0]?.params).not.toBe(filePanelA.params);
  const snapshotSource = instances[0]?.params?.source as
    | Record<string, unknown>
    | undefined;
  const originalSource = filePanelA.params?.source as
    | Record<string, unknown>
    | undefined;
  expect(snapshotSource).not.toBe(originalSource);
  if (!(snapshotSource && originalSource)) {
    throw new Error("expected source params");
  }
  snapshotSource.path = "MUTATED.md";
  expect(originalSource.path).toBe("README.md");
});
```

再加入越权测试：

```ts
it("rejects listInstances for undeclared panel components", () => {
  const { api } = createMockApi([mockPanel("terminal-1", "terminal")]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  expect(() => context.panels.listInstances("terminal")).toThrow(/panel/i);
});
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
pnpm vitest run tests/unit/renderer/plugin-panel-instances.test.ts -t "listInstances"
```

Expected: FAIL，错误包含 `listInstances is not a function`。

- [ ] **Step 3: 扩展 `src/plugins/api/renderer.ts`**

在 `PluginPanelInstanceOptions` 前加入：

```ts
export type PluginPanelGroupId = string;

export interface PluginPanelInstanceSnapshot {
  readonly componentId: string;
  readonly groupId: PluginPanelGroupId | null;
  readonly id: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly title: string;
}
```

将 `PluginPanelInstanceOptions` 改为：

```ts
export interface PluginPanelInstanceOptions {
  componentId: string;
  context?: PanelContext;
  /**
   * 指定目标 dockview group。传入后,宿主只在该 group 内执行 preview 替换。
   * 若 group 不存在,宿主仍可激活已有 instanceId,但不得关闭任何 preview。
   */
  targetGroupId?: PluginPanelGroupId;
  /**
   * true 表示打开前替换目标 group 内同 componentId 的未固定 preview。
   * 未传 targetGroupId 时只回退当前 active group；没有 active group 时跳过关闭。
   */
  dropUnpinnedInstances?: boolean;
  instanceId: string;
  params?: Record<string, unknown>;
  title?: string;
}
```

在 `RendererPluginContext["panels"]` 内加入：

```ts
    listInstances(componentId: string): readonly PluginPanelInstanceSnapshot[];
```

- [ ] **Step 4: 提交门禁**

Run:

```bash
git status --short src/plugins/api/renderer.ts tests/unit/renderer/plugin-panel-instances.test.ts
git diff -- src/plugins/api/renderer.ts tests/unit/renderer/plugin-panel-instances.test.ts
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/api/renderer.ts tests/unit/renderer/plugin-panel-instances.test.ts
git diff --staged
# proposed: refactor(plugins): expose readonly panel instance snapshots
```

## Task 2: 实现 group-scoped preview 替换，禁止全局 close fallback

**Files:**

- Modify: `src/renderer/lib/plugins/host-panels-context.ts`
- Modify: `tests/unit/renderer/plugin-panel-instances.test.ts`

- [ ] **Step 1: 修正 host 测试夹具**

在 `tests/unit/renderer/plugin-panel-instances.test.ts` 中加入 group 类型：

```ts
interface MockGroup {
  id: string;
  panels: MockPanel[];
}
```

将 `MockPanel["api"]` 扩展为：

```ts
  api: {
    close: ReturnType<typeof vi.fn>;
    isActive?: boolean;
    isVisible?: boolean;
    setTitle: ReturnType<typeof vi.fn>;
    updateParameters: ReturnType<typeof vi.fn>;
  };
```

将 `mockPanel` 改为：

```ts
function mockPanel(
  id: string,
  component: string,
  params?: Record<string, unknown>
): MockPanel {
  return {
    api: {
      close: vi.fn(),
      setTitle: vi.fn(),
      updateParameters: vi.fn(),
    },
    id,
    ...(params ? { params } : {}),
    title: id,
    view: { contentComponent: component },
  };
}
```

将 `createMockApi` 改为：

```ts
function createMockApi(
  initialPanels: readonly MockPanel[] = [],
  initialGroups?: readonly MockGroup[],
  options: { activeGroupId?: string | null } = {}
) {
  const groups: MockGroup[] =
    initialGroups?.map((group) => ({
      id: group.id,
      panels: [...group.panels],
    })) ?? [{ id: "group-1", panels: [...initialPanels] }];

  const allPanels = () => {
    const seen = new Set<string>();
    const result: MockPanel[] = [];
    for (const group of groups) {
      for (const panel of group.panels) {
        if (!seen.has(panel.id)) {
          seen.add(panel.id);
          result.push(panel);
        }
      }
    }
    for (const panel of initialPanels) {
      if (!seen.has(panel.id)) {
        seen.add(panel.id);
        result.push(panel);
      }
    }
    return result;
  };

  const removePanelFromAllGroups = (panel: MockPanel) => {
    for (const group of groups) {
      const index = group.panels.indexOf(panel);
      if (index >= 0) {
        group.panels.splice(index, 1);
      }
    }
  };

  for (const panel of initialPanels) {
    panel.api.close.mockImplementation(() => {
      removePanelFromAllGroups(panel);
    });
    panel.api.updateParameters.mockImplementation(
      (params: Record<string, unknown>) => {
        panel.params = params;
      }
    );
    panel.api.setTitle.mockImplementation((title: string) => {
      panel.title = title;
    });
  }

  const api = {
    get activeGroup() {
      if (options.activeGroupId === null) {
        return null;
      }
      if (options.activeGroupId) {
        return (
          groups.find((group) => group.id === options.activeGroupId) ?? null
        );
      }
      return groups[0] ?? null;
    },
    addPanel: vi.fn((addOptions: AddPanelOptions) => {
      const panel = mockPanel(
        addOptions.id,
        addOptions.component,
        addOptions.params
      );
      panel.title = addOptions.title;
      panel.api.close.mockImplementation(() => {
        removePanelFromAllGroups(panel);
      });
      panel.api.updateParameters.mockImplementation(
        (params: Record<string, unknown>) => {
          panel.params = params;
        }
      );
      panel.api.setTitle.mockImplementation((title: string) => {
        panel.title = title;
      });
      const position = addOptions.position as
        | { referenceGroup?: MockGroup }
        | undefined;
      const targetGroup = position?.referenceGroup ?? groups[0];
      targetGroup?.panels.push(panel);
    }),
    get groups() {
      return groups;
    },
    get panels() {
      return allPanels();
    },
    get totalPanels() {
      return allPanels().length;
    },
    removePanel: vi.fn((panel: MockPanel) => {
      removePanelFromAllGroups(panel);
    }),
  } as unknown as DockviewApi;
  return { api, groups };
}
```

- [ ] **Step 2: 写失败测试，目标 group 内替换不影响其它 group**

加入：

```ts
it("drops unpinned preview instances only inside the target group", () => {
  const previewA = mockPanel("preview-a", "pier.files.filePanel", {
    pinned: false,
  });
  const previewB = mockPanel("preview-b", "pier.files.filePanel", {
    pinned: false,
  });
  const pinnedB = mockPanel("pinned-b", "pier.files.filePanel", {
    pinned: true,
  });
  const { api, groups } = createMockApi([previewA, previewB, pinnedB], [
    { id: "group-a", panels: [previewA] },
    { id: "group-b", panels: [previewB, pinnedB] },
  ]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    dropUnpinnedInstances: true,
    instanceId: "new-preview-b",
    params: { pinned: false },
    targetGroupId: "group-b",
    title: "New.md",
  });

  expect(groups[0]?.panels.map((panel) => panel.id)).toEqual(["preview-a"]);
  expect(groups[1]?.panels.map((panel) => panel.id)).toEqual([
    "pinned-b",
    "new-preview-b",
  ]);
});
```

- [ ] **Step 3: 写失败测试，缺失和失效目标 group 不全局关闭**

加入：

```ts
it("drops previews only in the active group when targetGroupId is omitted", () => {
  const previewA = mockPanel("preview-a", "pier.files.filePanel", {
    pinned: false,
  });
  const previewB = mockPanel("preview-b", "pier.files.filePanel", {
    pinned: false,
  });
  const { api, groups } = createMockApi([previewA, previewB], [
    { id: "group-a", panels: [previewA] },
    { id: "group-b", panels: [previewB] },
  ]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    dropUnpinnedInstances: true,
    instanceId: "new-preview-a",
    params: { pinned: false },
    title: "New.md",
  });

  expect(groups[0]?.panels.map((panel) => panel.id)).toEqual([
    "new-preview-a",
  ]);
  expect(groups[1]?.panels.map((panel) => panel.id)).toEqual(["preview-b"]);
});

it("does not drop previews globally when targetGroupId is invalid", () => {
  const previewA = mockPanel("preview-a", "pier.files.filePanel", {
    pinned: false,
  });
  const previewB = mockPanel("preview-b", "pier.files.filePanel", {
    pinned: false,
  });
  const { api, groups } = createMockApi([previewA, previewB], [
    { id: "group-a", panels: [previewA] },
    { id: "group-b", panels: [previewB] },
  ]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    dropUnpinnedInstances: true,
    instanceId: "new-preview",
    params: { pinned: false },
    targetGroupId: "missing-group",
    title: "New.md",
  });

  expect(previewA.api.close).not.toHaveBeenCalled();
  expect(previewB.api.close).not.toHaveBeenCalled();
  expect(groups[0]?.panels.map((panel) => panel.id)).toEqual([
    "preview-a",
    "new-preview",
  ]);
  expect(groups[1]?.panels.map((panel) => panel.id)).toEqual(["preview-b"]);
});

it("does not drop previews globally when no active group exists", () => {
  const previewA = mockPanel("preview-a", "pier.files.filePanel", {
    pinned: false,
  });
  const previewB = mockPanel("preview-b", "pier.files.filePanel", {
    pinned: false,
  });
  const { api, groups } = createMockApi(
    [previewA, previewB],
    [
      { id: "group-a", panels: [previewA] },
      { id: "group-b", panels: [previewB] },
    ],
    { activeGroupId: null }
  );
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  context.panels.openInstance({
    componentId: "pier.files.filePanel",
    dropUnpinnedInstances: true,
    instanceId: "new-preview",
    params: { pinned: false },
    title: "New.md",
  });

  expect(previewA.api.close).not.toHaveBeenCalled();
  expect(previewB.api.close).not.toHaveBeenCalled();
  expect(groups[0]?.panels.map((panel) => panel.id)).toEqual([
    "preview-a",
    "new-preview",
  ]);
  expect(groups[1]?.panels.map((panel) => panel.id)).toEqual(["preview-b"]);
});
```

- [ ] **Step 4: 写失败测试，已有实例不允许越过 `targetGroupId` 更新其它 group**

加入：

```ts
it("rejects updating an existing instance outside the requested target group", () => {
  const existing = mockPanel("shared-file-instance", "pier.files.filePanel", {
    pinned: true,
    source: { kind: "disk", path: "README.md", root: "/repo" },
  });
  const { api } = createMockApi([existing], [
    { id: "group-a", panels: [existing] },
    { id: "group-b", panels: [] },
  ]);
  useWorkspaceStore.setState({ api });
  const context = createRendererPluginContext(entryWithPanel());
  context.panels.register(testPanelRegistration);

  expect(() =>
    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "shared-file-instance",
      params: { pinned: false },
      targetGroupId: "group-b",
      title: "Should not apply",
    })
  ).toThrow(/target group/i);

  expect(existing.api.updateParameters).not.toHaveBeenCalled();
  expect(existing.api.setTitle).not.toHaveBeenCalled();
  expect(api.addPanel).not.toHaveBeenCalled();
  expect(activateWorkspacePanel).not.toHaveBeenCalled();
  expect(
    usePanelDescriptorStore.getState().descriptors["shared-file-instance"]
  ).toBeUndefined();
});
```

- [ ] **Step 5: 实现 helper，不能 fallback 到 `api.panels`**

在 `src/renderer/lib/plugins/host-panels-context.ts` 中加入：

```ts
interface DockviewPanelRef {
  api: {
    close: () => void;
    setTitle: (title: string) => void;
    updateParameters: (params: Record<string, unknown>) => void;
  };
  id: string;
  params?: Record<string, unknown>;
  title?: string;
  view: { contentComponent: string };
}

interface DockviewGroupRef {
  id: string;
  panels?: readonly DockviewPanelRef[];
}

interface DockviewApiLike {
  activeGroup?: DockviewGroupRef | null;
  groups?: readonly DockviewGroupRef[];
  panels: readonly DockviewPanelRef[];
}

function groupById(
  api: DockviewApiLike,
  groupId: string | undefined
): DockviewGroupRef | null {
  if (!groupId) {
    return api.activeGroup ?? null;
  }
  return api.groups?.find((group) => group.id === groupId) ?? null;
}

function groupForPanel(
  api: DockviewApiLike,
  panelId: string
): DockviewGroupRef | null {
  for (const group of api.groups ?? []) {
    if (group.panels?.some((panel) => panel.id === panelId)) {
      return group;
    }
  }
  return null;
}

function panelsForPreviewReplacement(
  targetGroup: DockviewGroupRef | null
): readonly DockviewPanelRef[] {
  return targetGroup?.panels ?? [];
}

function clonePanelParamValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clonePanelParamValue);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = clonePanelParamValue(nested);
    }
    return clone;
  }
  return value;
}

function clonePanelParams(
  params: Record<string, unknown> | undefined
): Readonly<Record<string, unknown>> | undefined {
  return params
    ? (clonePanelParamValue(params) as Readonly<Record<string, unknown>>)
    : undefined;
}
```

- [ ] **Step 6: 实现 `listInstances`**

在 `createPluginPanelsContext(...).panels` 返回对象中加入：

```ts
    listInstances: (componentId) => {
      assertDeclaredContribution(entry, "panel", componentId);
      const api = useWorkspaceStore.getState().api;
      if (!api) {
        return [];
      }
      return api.panels
        .filter((panel) => panel.view.contentComponent === componentId)
        .map((panel) => ({
          componentId,
          groupId: groupForPanel(api, panel.id)?.id ?? null,
          id: panel.id,
          ...(panel.params
            ? { params: clonePanelParams(panel.params as Record<string, unknown>) }
            : {}),
          title: panel.title || panel.id,
        }));
    },
```

- [ ] **Step 7: 改造 `openPluginPanelInstance`**

在 `if (!api) { return; }` 之后、`descriptorStore.upsert(...)` 之前添加：

```ts
  const targetGroup = groupById(api, options.targetGroupId);
  if (existing && options.targetGroupId) {
    const existingGroupId = groupForPanel(api, existing.id)?.id ?? null;
    if (existingGroupId !== options.targetGroupId) {
      throw new Error(
        `plugin panel instance target group mismatch: ${options.instanceId} belongs to ${existingGroupId ?? "unknown"}`
      );
    }
  }
```

如果当前实现里 `descriptorStore.upsert(...)` 位于这段检查之前，先把 `descriptorStore.upsert(...)` 下移到该检查之后。目标 group 不匹配时不能更新 descriptor、不能更新 params、不能激活旧 panel。

将 preview 替换改成：

```ts
  if (options.dropUnpinnedInstances && panelParams.pinned !== true) {
    for (const other of panelsForPreviewReplacement(targetGroup)) {
      if (
        other.id !== options.instanceId &&
        other.view.contentComponent === options.componentId &&
        (other.params as { pinned?: unknown } | undefined)?.pinned !== true
      ) {
        other.api.close();
      }
    }
  }
```

将新增 panel 改成：

```ts
  api.addPanel({
    id: options.instanceId,
    component: options.componentId,
    title: resolvedTitle,
    params: panelParams,
    ...(targetGroup
      ? { position: { referenceGroup: targetGroup, direction: "within" } }
      : {}),
});
```

- [ ] **Step 8: 运行测试**

Run:

```bash
pnpm vitest run tests/unit/renderer/plugin-panel-instances.test.ts
```

Expected: PASS。

- [ ] **Step 9: 提交门禁**

Run:

```bash
git status --short src/renderer/lib/plugins/host-panels-context.ts tests/unit/renderer/plugin-panel-instances.test.ts
git diff -- src/renderer/lib/plugins/host-panels-context.ts tests/unit/renderer/plugin-panel-instances.test.ts
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/renderer/lib/plugins/host-panels-context.ts tests/unit/renderer/plugin-panel-instances.test.ts
git diff --staged
# proposed: fix(plugins): scope preview replacement to dockview groups
```

## Task 3: 拆分文件 identity key 和标签实例 id

**Files:**

- Modify: `src/plugins/builtin/files/renderer/file-panel-id.ts`
- Modify: `tests/unit/renderer/files-document-store.test.ts`
- Modify: `tests/component/files-file-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/renderer/files-document-store.test.ts` 中替换旧的 panel id hash 测试：

```ts
it("uses a stable file identity key while creating distinct file panel instances", () => {
  const source = {
    kind: "disk" as const,
    path: "notes/𝌆-😀.md",
    root: "/repo/🚀",
  };

  const document = ensureDiskDocument(source);
  const identityKey = fileFilePanelIdentityKey(source);
  const firstPanelId = createFileFilePanelInstanceId(source, "first");
  const secondPanelId = createFileFilePanelInstanceId(source, "second");

  expect(identityKey.replace("pier.files.filePanel:disk:", "")).toBe(
    document.id.replace("pier.files.file:", "")
  );
  expect(firstPanelId).not.toBe(secondPanelId);
  expect(firstPanelId).toContain(identityKey);
  expect(secondPanelId).toContain(identityKey);
});
```

同步 import：

```ts
import {
  createFileFilePanelInstanceId,
  fileFilePanelIdentityKey,
} from "@plugins/builtin/files/renderer/file-panel-id.ts";
```

- [ ] **Step 2: 运行失败测试**

Run:

```bash
pnpm vitest run tests/unit/renderer/files-document-store.test.ts -t "stable file identity key"
```

Expected: FAIL，错误包含新函数未导出。

- [ ] **Step 3: 改造 `file-panel-id.ts`**

将文件改成：

```ts
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";

function sourceIdentitySuffix(source: FilesDocumentPanelSource): string {
  if (source.kind === "untitled") {
    return `untitled:${stableFileIdentityHash(source.id)}`;
  }
  return `disk:${stableFileIdentityHash(`${source.root}\u0000${source.path}`)}`;
}

export function fileFilePanelIdentityKey(
  source: FilesDocumentPanelSource
): string {
  return `${FILES_FILE_PANEL_ID}:${sourceIdentitySuffix(source)}`;
}

export function createFileFilePanelInstanceId(
  source: FilesDocumentPanelSource,
  nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
): string {
  return `${fileFilePanelIdentityKey(source)}:${stableFileIdentityHash(nonce)}`;
}
```

不要保留旧 `fileFilePanelInstanceId` 导出，让类型检查暴露所有旧调用。

- [ ] **Step 4: 更新组件测试中的 id 断言**

在 `tests/component/files-file-panel.test.tsx` 中替换 import：

```ts
import { createFileFilePanelInstanceId } from "@plugins/builtin/files/renderer/file-panel-id.ts";
```

将 `FILE_PANEL_DISK_INSTANCE_ID` 改成：

```ts
const FILE_PANEL_DISK_INSTANCE_ID =
  /^pier\.files\.filePanel:disk:[a-z0-9]+:[a-z0-9]+$/;
```

将测试里直接算当前 panel id 的地方改为：

```ts
const currentInstanceId = createFileFilePanelInstanceId(source, "current");
```

- [ ] **Step 5: 提交门禁**

Run:

```bash
git status --short src/plugins/builtin/files/renderer/file-panel-id.ts tests/unit/renderer/files-document-store.test.ts tests/component/files-file-panel.test.tsx
git diff -- src/plugins/builtin/files/renderer/file-panel-id.ts tests/unit/renderer/files-document-store.test.ts tests/component/files-file-panel.test.tsx
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/builtin/files/renderer/file-panel-id.ts tests/unit/renderer/files-document-store.test.ts tests/component/files-file-panel.test.tsx
git diff --staged
# proposed: refactor(files): separate file identity from tab instances
```

## Task 4: 按 group 复用同 source 标签，并保留完整 params

**Files:**

- Modify: `src/plugins/builtin/files/renderer/files-document-types.ts`
- Modify: `src/plugins/builtin/files/renderer/files-group-view.tsx`
- Modify: `src/plugins/builtin/files/renderer/file-panel.tsx`
- Modify: `tests/component/files-file-panel.test.tsx`
- Modify: `tests/unit/renderer/files-document-store.test.ts`

- [ ] **Step 1: 写 source 相等测试**

在 `tests/unit/renderer/files-document-store.test.ts` 中加入：

```ts
it("compares file panel sources by canonical document identity", () => {
  expect(
    sameFilesDocumentPanelSource(
      { kind: "disk", path: "README.md", root: "/repo" },
      { kind: "disk", path: "README.md", root: "/repo" }
    )
  ).toBe(true);
  expect(
    sameFilesDocumentPanelSource(
      { kind: "disk", path: "README.md", root: "/repo" },
      { kind: "disk", path: "README.md", root: "/other" }
    )
  ).toBe(false);
  expect(
    sameFilesDocumentPanelSource(
      { id: "pier.files.untitled:1", kind: "untitled", name: "Untitled-1.md" },
      { id: "pier.files.untitled:1", kind: "untitled", name: "Renamed.md" }
    )
  ).toBe(true);
});
```

- [ ] **Step 2: 实现 `sameFilesDocumentPanelSource`**

在 `src/plugins/builtin/files/renderer/files-document-types.ts` 中加入：

```ts
export function sameFilesDocumentPanelSource(
  left: FilesDocumentPanelSource | null | undefined,
  right: FilesDocumentPanelSource | null | undefined
): boolean {
  if (!(left && right) || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "untitled" && right.kind === "untitled") {
    return left.id === right.id;
  }
  if (left.kind === "disk" && right.kind === "disk") {
    return left.root === right.root && left.path === right.path;
  }
  return false;
}
```

- [ ] **Step 3: 更新组件测试 mock context**

在 `tests/component/files-file-panel.test.tsx` 的 `createMockContext` overrides 增加：

```ts
  listInstances?: RendererPluginContext["panels"]["listInstances"];
```

在返回的 `panels` 对象中加入：

```ts
      listInstances: overrides?.listInstances ?? vi.fn(() => []),
```

- [ ] **Step 4: 写同文件跨 group 独立标签测试**

在 `tests/component/files-file-panel.test.tsx` import 中加入：

```ts
import { fileFilePanelIdentityKey } from "@plugins/builtin/files/renderer/file-panel-id.ts";
```

加入：

```ts
it("opens the same disk file as independent tab instances in different groups", async () => {
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const identityKey = fileFilePanelIdentityKey(source);
  const openInstance = vi.fn<RendererPluginContext["panels"]["openInstance"]>();
  const context = createMockContext({
    list: vi.fn(async () => [{ kind: "file", path: source.path, root: source.root }]),
    listInstances: vi.fn(() => [
      {
        componentId: "pier.files.filePanel",
        groupId: "group-a",
        id: `${identityKey}:existing`,
        params: { context: panelContext, pinned: true, source },
        title: "README.md",
      },
    ]),
    openInstance,
  });
  const Panel = createFilePanel(context);
  const groupB = createFakeGroup("group-b");
  const filePanel = groupB.makeFilesPanel("empty-b", { context: panelContext });
  groupB.setActivePanel(filePanel);

  render(
    <Panel
      {...makeProps(
        { context: panelContext },
        { group: groupB, id: "empty-b", isActive: true }
      )}
    />
  );

  await waitFor(() => {
    expect(groupB.element.querySelector('file-tree-container[data-slot="pier-file-tree"]')).toBeInstanceOf(HTMLElement);
  });
  fireEvent.click(
    within(getFileTree(groupB.element)).getByRole("treeitem", {
      name: "README.md",
    })
  );

  expect(openInstance).toHaveBeenCalledWith(
    expect.objectContaining({
      dropUnpinnedInstances: true,
      params: { pinned: false, source },
      targetGroupId: "group-b",
      title: "README.md",
    })
  );
  const instanceId = openInstance.mock.calls[0]?.[0].instanceId;
  expect(instanceId).not.toBe(identityKey);
  expect(instanceId).not.toBe(`${identityKey}:existing`);
  expect(instanceId?.startsWith(`${identityKey}:`)).toBe(true);
  groupB.element.remove();
});
```

- [ ] **Step 5: 写同 group 复用且保留 dirty 测试**

加入：

```ts
it("reuses an existing same-source file tab without dropping dirty params", async () => {
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const openInstance = vi.fn<RendererPluginContext["panels"]["openInstance"]>();
  const existingParams = {
    context: panelContext,
    dirty: true,
    pinned: false,
    pluginComponentId: "pier.files.filePanel",
    source,
  };
  const context = createMockContext({
    list: vi.fn(async () => [{ kind: "file", path: source.path, root: source.root }]),
    listInstances: vi.fn(() => [
      {
        componentId: "pier.files.filePanel",
        groupId: "group-a",
        id: "file-a-existing",
        params: existingParams,
        title: "README.md",
      },
    ]),
    openInstance,
  });
  const Panel = createFilePanel(context);
  const groupA = createFakeGroup("group-a");
  const filePanel = groupA.makeFilesPanel("empty-a", { context: panelContext });
  groupA.setActivePanel(filePanel);

  render(
    <Panel
      {...makeProps(
        { context: panelContext },
        { group: groupA, id: "empty-a", isActive: true }
      )}
    />
  );

  await waitFor(() => {
    expect(groupA.element.querySelector('file-tree-container[data-slot="pier-file-tree"]')).toBeInstanceOf(HTMLElement);
  });
  fireEvent.click(
    within(getFileTree(groupA.element)).getByRole("treeitem", {
      name: "README.md",
    })
  );

  expect(openInstance).toHaveBeenCalledWith(
    expect.objectContaining({
      instanceId: "file-a-existing",
      params: existingParams,
      targetGroupId: "group-a",
    })
  );
  groupA.element.remove();
});
```

- [ ] **Step 6: 改造 `FilesGroupView` 打开逻辑**

替换 import：

```ts
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
```

从 `files-document-types.ts` import：

```ts
  sameFilesDocumentPanelSource,
```

在 `FilesGroupView` 内加入：

```ts
  const findExistingSourceInstance = useCallback(
    (source: FilesDocumentPanelSource) =>
      context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find((instance) => {
          if (instance.groupId !== groupId) {
            return false;
          }
          const instanceSource = parseFilesDocumentPanelSource(instance.params);
          return sameFilesDocumentPanelSource(instanceSource, source);
        }),
    [context, groupId]
  );

  const paramsForOpen = useCallback(
    (
      existing: ReturnType<typeof findExistingSourceInstance>,
      source: FilesDocumentPanelSource,
      pinned: boolean
    ): Record<string, unknown> => {
      if (existing?.params) {
        return {
          ...existing.params,
          ...(pinned ? { pinned: true } : {}),
          source,
        };
      }
      return { pinned, source };
    },
    []
  );
```

将 `handleOpenFileFromTree` 的 `openInstance` 改成：

```ts
      const existing = findExistingSourceInstance(nextSource);
      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: !pinned && !existing,
        instanceId: existing?.id ?? createFileFilePanelInstanceId(nextSource),
        params: paramsForOpen(existing, nextSource, pinned),
        targetGroupId: groupId,
        title: nextName,
      });
```

更新 dependency array：

```ts
    [context, findExistingSourceInstance, groupId, panelContext, paramsForOpen]
```

- [ ] **Step 7: 更新导航打开逻辑**

在 `openNavSource` 中使用同样策略：

```ts
      const existing = findExistingSourceInstance(source);
      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: !existing,
        instanceId: existing?.id ?? createFileFilePanelInstanceId(source),
        params: paramsForOpen(existing, source, existing?.params?.pinned === true),
        targetGroupId: groupId,
        title:
          source.kind === "untitled"
            ? source.name
            : (source.path.split("/").at(-1) ?? source.path),
      });
```

- [ ] **Step 8: 更新 `file-panel.tsx` fallback**

把 import 改成：

```ts
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
```

fallback `handleOpenFileFromTree` 中改成：

```ts
        instanceId: createFileFilePanelInstanceId(nextSource),
```

- [ ] **Step 9: 运行测试**

Run:

```bash
pnpm vitest run tests/component/files-file-panel.test.tsx tests/unit/renderer/files-document-store.test.ts
```

Expected: PASS。

- [ ] **Step 10: 提交门禁**

Run:

```bash
git status --short src/plugins/builtin/files/renderer/files-document-types.ts src/plugins/builtin/files/renderer/files-group-view.tsx src/plugins/builtin/files/renderer/file-panel.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-document-store.test.ts
git diff -- src/plugins/builtin/files/renderer/files-document-types.ts src/plugins/builtin/files/renderer/files-group-view.tsx src/plugins/builtin/files/renderer/file-panel.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-document-store.test.ts
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/builtin/files/renderer/files-document-types.ts src/plugins/builtin/files/renderer/files-group-view.tsx src/plugins/builtin/files/renderer/file-panel.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-document-store.test.ts
git diff --staged
# proposed: fix(files): reuse file tabs within dockview groups
```

## Task 5: 修复共享 disk document 关闭生命周期

**Files:**

- Create: `src/plugins/builtin/files/renderer/files-panel-instance-utils.ts`
- Modify: `src/plugins/builtin/files/renderer/file-panel.tsx`
- Modify: `src/plugins/builtin/files/renderer/index.tsx`
- Modify: `tests/component/files-file-panel.test.tsx`
- Modify: `tests/unit/renderer/files-terminal-action.test.tsx`

- [ ] **Step 1: 扩展 unit test mock，允许测试 dirty close guard**

在 `tests/unit/renderer/files-terminal-action.test.tsx` 的 imports 中加入：

```ts
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  getDocument,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import { FILES_FILE_PANEL_ID } from "@plugins/builtin/files/manifest.ts";
```

在 `createMockContext(...).panels` mock 中加入：

```ts
      listInstances: vi.fn(() => []),
```

在 `afterEach` 中加入：

```ts
  clearFilesDocumentStore();
```

增加 helper：

```ts
function findFileCloseGuard(context: RendererPluginContext): NonNullable<
  Parameters<RendererPluginContext["panels"]["registerCloseGuard"]>[1]
> {
  const registerCloseGuard = context.panels
    .registerCloseGuard as ReturnType<typeof vi.fn>;
  const guard = registerCloseGuard.mock.calls.find(
    ([componentId]) => componentId === FILES_FILE_PANEL_ID
  )?.[1];
  expect(guard).toBeDefined();
  return guard as NonNullable<
    Parameters<RendererPluginContext["panels"]["registerCloseGuard"]>[1]
  >;
}
```

- [ ] **Step 2: 写失败测试，非最后一个 dirty 同源标签关闭时不弹保存确认、不移除 document**

在 `tests/unit/renderer/files-terminal-action.test.tsx` 中加入：

```ts
it("allows closing a dirty disk tab without discarding the shared document while another same-source tab remains", async () => {
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const document = ensureDiskDocument(source);
  updateDocumentContents(document.id, "# dirty shared contents");
  const context = createMockContext();
  (
    context.panels.listInstances as ReturnType<typeof vi.fn>
  ).mockReturnValue([
    {
      componentId: FILES_FILE_PANEL_ID,
      groupId: "group-b",
      id: "panel-b",
      params: { source },
      title: "README.md",
    },
  ]);
  filesRendererPlugin.activate(context);
  const guard = findFileCloseGuard(context);

  const result = await guard({
    componentId: FILES_FILE_PANEL_ID,
    panelId: "panel-a",
    params: { source },
  });

  expect(result).toBe(true);
  expect(context.dialogs.choice).not.toHaveBeenCalled();
  expect(getDocument(document.id)).not.toBeNull();
});
```

- [ ] **Step 3: 写失败测试，最后一个 dirty 同源标签仍走保存/丢弃确认**

加入：

```ts
it("discards a dirty disk document only when the last same-source tab chooses dont-save", async () => {
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const document = ensureDiskDocument(source);
  updateDocumentContents(document.id, "# dirty shared contents");
  const context = createMockContext();
  (
    context.dialogs.choice as ReturnType<typeof vi.fn>
  ).mockResolvedValue("alt");
  (
    context.panels.listInstances as ReturnType<typeof vi.fn>
  ).mockReturnValue([]);
  filesRendererPlugin.activate(context);
  const guard = findFileCloseGuard(context);

  const result = await guard({
    componentId: FILES_FILE_PANEL_ID,
    panelId: "panel-a",
    params: { source },
  });

  expect(result).toBe(true);
  expect(context.dialogs.choice).toHaveBeenCalledTimes(1);
  expect(getDocument(document.id)).toBeNull();
});
```

- [ ] **Step 4: 写失败测试，同文件跨 group 关闭一个干净标签不移除共享文档**

在 `tests/component/files-file-panel.test.tsx` 中加入：

```ts
it("keeps a clean disk document while another same-source tab is still open", async () => {
  const removeListeners = new Set<(panel: { id?: string }) => void>();
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const context = createMockContext({
    listInstances: vi.fn(() => [
      {
        componentId: "pier.files.filePanel",
        groupId: "group-b",
        id: "panel-b",
        params: { context: panelContext, source },
        title: "README.md",
      },
    ]),
    readText: vi.fn(async () => "# Shared\n"),
  });
  const Panel = createFilePanel(context);
  const props = {
    ...makeProps(
      {
        context: panelContext,
        source,
      },
      { id: "panel-a" }
    ),
    containerApi: {
      onDidRemovePanel: vi.fn(
        (listener: (panel: { id?: string }) => void) => {
          removeListeners.add(listener);
          return { dispose: () => removeListeners.delete(listener) };
        }
      ),
    },
  } as unknown as IDockviewPanelProps<FilesPanelParams>;

  const rendered = render(<Panel {...props} />);
  const diskDocument = ensureDiskDocument(source);
  await screen.findByRole("heading", { name: "README.md" });

  act(() => {
    for (const listener of removeListeners) {
      listener({ id: "panel-a" });
    }
  });
  rendered.unmount();

  expect(getDocument(diskDocument.id)).not.toBeNull();
});
```

- [ ] **Step 5: 写最后一个干净同源标签关闭后移除文档测试**

加入：

```ts
it("drops a clean disk document when the last same-source tab is closed", async () => {
  const removeListeners = new Set<(panel: { id?: string }) => void>();
  const source = { kind: "disk" as const, path: "README.md", root: PROJECT_ROOT };
  const context = createMockContext({
    listInstances: vi.fn(() => []),
    readText: vi.fn(async () => "# Shared\n"),
  });
  const Panel = createFilePanel(context);
  const props = {
    ...makeProps(
      {
        context: panelContext,
        source,
      },
      { id: "panel-a" }
    ),
    containerApi: {
      onDidRemovePanel: vi.fn(
        (listener: (panel: { id?: string }) => void) => {
          removeListeners.add(listener);
          return { dispose: () => removeListeners.delete(listener) };
        }
      ),
    },
  } as unknown as IDockviewPanelProps<FilesPanelParams>;

  const rendered = render(<Panel {...props} />);
  const diskDocument = ensureDiskDocument(source);
  await screen.findByRole("heading", { name: "README.md" });

  act(() => {
    for (const listener of removeListeners) {
      listener({ id: "panel-a" });
    }
  });
  rendered.unmount();

  expect(getDocument(diskDocument.id)).toBeNull();
});
```

- [ ] **Step 6: 新建同源实例查询 helper**

创建 `src/plugins/builtin/files/renderer/files-panel-instance-utils.ts`：

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";

export function hasOtherOpenFilesSourceInstance(input: {
  context: RendererPluginContext | undefined;
  panelId: string | undefined;
  source: FilesDocumentPanelSource;
}): boolean {
  if (!input.context) {
    return false;
  }
  return input.context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .some((instance) => {
      if (instance.id === input.panelId) {
        return false;
      }
      const instanceSource = parseFilesDocumentPanelSource(instance.params);
      return sameFilesDocumentPanelSource(instanceSource, input.source);
    });
}
```

- [ ] **Step 7: 实现 dirty close guard 的同源实例检查**

在 `src/plugins/builtin/files/renderer/index.tsx` import：

```ts
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";
```

在 `registerDirtyCloseGuard` 中，`if (!document?.dirty) { return true; }` 之后立刻加入：

```ts
      if (
        hasOtherOpenFilesSourceInstance({
          context,
          panelId: input.panelId,
          source,
        })
      ) {
        return true;
      }
```

这段必须在 `context.dialogs.choice(...)` 之前执行；非最后一个 dirty 同源标签关闭时只关闭当前标签，不能保存、丢弃或移除共享 document。

- [ ] **Step 8: 实现干净 document cleanup 的同源实例检查**

在 `file-panel.tsx` import：

```ts
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";
```

修改 disk document cleanup：

```ts
  useEffect(() => {
    if (!(diskDocumentId && sourceFromParams?.kind === "disk")) {
      return;
    }
    const source = sourceFromParams;
    const panelId = props.api?.id;
    return () => {
      if (!closedViaRemoveRef.current) {
        return;
      }
      if (
        hasOtherOpenFilesSourceInstance({
          context: runtimeContext,
          panelId,
          source,
        })
      ) {
        return;
      }
      const latest = getDocument(diskDocumentId);
      if (latest && !latest.dirty) {
        removeDocument(diskDocumentId);
      }
    };
  }, [diskDocumentId, props.api?.id, runtimeContext, sourceFromParams]);
```

- [ ] **Step 9: 运行测试**

Run:

```bash
pnpm vitest run tests/component/files-file-panel.test.tsx -t "same-source tab|last same-source"
pnpm vitest run tests/unit/renderer/files-terminal-action.test.tsx -t "dirty disk"
```

Expected: PASS。

- [ ] **Step 10: 提交门禁**

Run:

```bash
git status --short src/plugins/builtin/files/renderer/files-panel-instance-utils.ts src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
git diff -- src/plugins/builtin/files/renderer/files-panel-instance-utils.ts src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/builtin/files/renderer/files-panel-instance-utils.ts src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
git diff --staged
# proposed: fix(files): keep shared disk documents while tabs remain
```

## Task 6: 锁定连续交互和命令面板搜索的 group 作用域

**Files:**

- Modify: `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- Modify: `src/plugins/builtin/files/renderer/index.tsx`
- Modify: `tests/component/files-file-panel.test.tsx`
- Modify: `tests/unit/renderer/files-terminal-action.test.tsx`

- [ ] **Step 1: 改造双击测试为有状态 mock**

在 `tests/component/files-file-panel.test.tsx` 中更新 double-click 测试，让第一次 `listInstances` 返回空，`openInstance` 记录新 id，第二次 `listInstances` 返回该 id：

```ts
const instances: RendererPluginContext["panels"]["listInstances"] = vi.fn(
  () => openedInstance ? [openedInstance] : []
);
let openedInstance:
  | ReturnType<RendererPluginContext["panels"]["listInstances"]>[number]
  | null = null;
const openInstance = vi.fn<RendererPluginContext["panels"]["openInstance"]>(
  (options) => {
    openedInstance = {
      componentId: options.componentId,
      groupId: "group-a",
      id: options.instanceId,
      params: {
        ...(options.context ? { context: options.context } : {}),
        ...(options.params ?? {}),
      },
      title: options.title ?? options.instanceId,
    };
  }
);
```

断言第二次调用：

```ts
expect(openInstance.mock.calls[1]?.[0]).toMatchObject({
  dropUnpinnedInstances: false,
  instanceId: openInstance.mock.calls[0]?.[0].instanceId,
  params: expect.objectContaining({ pinned: true }),
  targetGroupId: "group-a",
});
```

- [ ] **Step 2: 写命令面板搜索定位当前 group 测试**

在 `tests/unit/renderer/files-terminal-action.test.tsx` 中找到 tree search action 相关测试，加入：

```ts
it("opens tree search for the active file panel group instead of root fallback", async () => {
  const search = vi.spyOn(fileTreeSidebar, "openFilesTreeSearch");
  const context = createMockContext();
  (
    context.panels.getActiveInstanceId as ReturnType<typeof vi.fn>
  ).mockReturnValue("active-file-panel");
  (
    context.panels.listInstances as ReturnType<typeof vi.fn>
  ).mockReturnValue([
    {
      componentId: "pier.files.filePanel",
      groupId: "group-active",
      id: "active-file-panel",
      params: { context: panelContext },
      title: "README.md",
    },
  ]);
  const action = createTreeSearchActionForTests(context);

  await action.handler();

  expect(search).toHaveBeenCalledWith({
    instanceId: "group-active",
    root: PROJECT_ROOT,
  });
});
```

再加入无活动文件 group 的 no-op 测试：

```ts
it("does not open tree search by root fallback when no active file panel group exists", async () => {
  const search = vi.spyOn(fileTreeSidebar, "openFilesTreeSearch");
  const context = createMockContext();
  (
    context.panels.getActiveInstanceId as ReturnType<typeof vi.fn>
  ).mockReturnValue(null);
  (
    context.panels.listInstances as ReturnType<typeof vi.fn>
  ).mockReturnValue([]);
  const action = createTreeSearchActionForTests(context);

  await action.handler();

  expect(search).not.toHaveBeenCalled();
});
```

再加入 active panel 有 id 但快照无 group 的 no-op 测试：

```ts
it("does not open tree search when the active file panel has no group snapshot", async () => {
  const search = vi.spyOn(fileTreeSidebar, "openFilesTreeSearch");
  const context = createMockContext();
  (
    context.panels.getActiveInstanceId as ReturnType<typeof vi.fn>
  ).mockReturnValue("active-file-panel");
  (
    context.panels.listInstances as ReturnType<typeof vi.fn>
  ).mockReturnValue([
    {
      componentId: "pier.files.filePanel",
      groupId: null,
      id: "active-file-panel",
      params: { context: panelContext },
      title: "README.md",
    },
  ]);
  const action = createTreeSearchActionForTests(context);

  await action.handler();

  expect(search).not.toHaveBeenCalled();
});
```

在 `tests/component/files-file-panel.test.tsx` 的 file tree search 隔离测试附近加入：

```tsx
it("does not fall back to another same-root tree when a target tree instance is missing", async () => {
  const list = vi.fn<RendererPluginContext["files"]["list"]>(
    async () =>
      [
        { kind: "file", path: "README.md", root: PROJECT_ROOT },
      ] satisfies FileEntry[]
  );
  const context = createMockContext({ list });
  const { container } = render(
    <>
      <div data-testid="sidebar-a">
        <FileTreeSidebar
          context={context}
          instanceId="tree-instance-a"
          onOpenFile={vi.fn()}
          root={PROJECT_ROOT}
        />
      </div>
      <div data-testid="sidebar-b">
        <FileTreeSidebar
          context={context}
          instanceId="tree-instance-b"
          onOpenFile={vi.fn()}
          root={PROJECT_ROOT}
        />
      </div>
    </>
  );
  await waitFor(() => {
    expect(list).toHaveBeenCalled();
  });

  act(() => {
    expect(
      openFilesTreeSearch({
        instanceId: "tree-instance-missing",
        root: PROJECT_ROOT,
      })
    ).toBe(false);
  });

  expect(
    container.querySelector('[data-testid="files-tree-search-bar"]')
  ).toBeNull();
});
```

If `createTreeSearchAction` is not exported, export it only under its existing name from `index.tsx`; do not create test-only branches. If the file already uses a registration flow test, get the action from `filesRendererPlugin.activate(context)`.

- [ ] **Step 3: 更新 `createTreeSearchAction`**

在 `src/plugins/builtin/files/renderer/index.tsx` 中改造 handler：

```ts
    handler: async () => {
      const root = filePanelProjectRoot(context.panels.getActiveContext());
      if (!root) {
        return await Promise.resolve();
      }
      const activePanelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      const activeGroupId = activePanelId
        ? (context.panels
            .listInstances(FILES_FILE_PANEL_ID)
            .find((instance) => instance.id === activePanelId)?.groupId ?? null)
        : null;
      if (!activeGroupId) {
        return await Promise.resolve();
      }
      openFilesTreeSearch({ instanceId: activeGroupId, root });
      return await Promise.resolve();
    },
```

- [ ] **Step 4: 更新文件树 registry 查找语义**

在 `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx` 中修改 `findTreeEntry`：

```ts
function findTreeEntry(target: {
  instanceId?: string | undefined;
  root?: string | undefined;
}): TreeRegistryEntry | null {
  if (target.instanceId) {
    return treeRegistry.get(target.instanceId) ?? null;
  }
  if (target.root) {
    let lastMatch: TreeRegistryEntry | null = null;
    for (const entry of treeRegistry.values()) {
      if (entry.root === target.root) {
        lastMatch = entry;
      }
    }
    return lastMatch;
  }
  return null;
}
```

这样保留旧的“只有 root 时取最近同 root 树”的兼容入口，但明确禁止“已经指定 group instanceId 时再落回 root”。

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm vitest run tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交门禁**

Run:

```bash
git status --short src/plugins/builtin/files/renderer/file-tree-sidebar.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
git diff -- src/plugins/builtin/files/renderer/file-tree-sidebar.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/builtin/files/renderer/file-tree-sidebar.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/files-terminal-action.test.tsx
git diff --staged
# proposed: fix(files): scope file tree search to active group
```

## Task 7: 宿主化 group content 注入适配层

**Files:**

- Create: `src/renderer/lib/plugins/host-group-content-context.tsx`
- Modify: `src/plugins/api/renderer.ts`
- Modify: `src/shared/contracts/plugin.ts`
- Modify: `src/renderer/lib/plugins/host-context.ts`
- Modify: `src/renderer/lib/plugins/runtime.ts`
- Modify: `src/plugins/builtin/files/manifest.ts`
- Modify: `src/plugins/builtin/files/renderer/index.tsx`
- Modify: `src/plugins/builtin/files/renderer/files-group-view-host.tsx`
- Modify: `tests/component/files-file-panel.test.tsx`
- Modify: `tests/unit/renderer/plugin-host-context.test.tsx`
- Test: `tests/unit/renderer/host-group-content-context.test.tsx`
- Test: `tests/unit/renderer/plugin-runtime.test.ts`

- [ ] **Step 1: 扩展 manifest 贡献点**

在 `src/shared/contracts/plugin.ts` 中，`pluginTerminalStatusItemContributionSchema` 后加入：

```ts
export const pluginGroupContentContributionSchema = z.object({
  description: z.string().min(1).optional(),
  id: z.string().min(1),
  title: z.string().min(1),
});
export type PluginGroupContentContribution = z.infer<
  typeof pluginGroupContentContributionSchema
>;
```

在 `pluginManifestSchema` object 中加入：

```ts
    groupContent: z.array(pluginGroupContentContributionSchema).optional(),
```

将 `superRefine` 的 configuration early return 改成只包住 configuration key 检查，然后无论是否存在 configuration 都执行 groupContent 前缀校验：

```ts
    if (manifest.configuration) {
      const prefix = `${manifest.id}.`;
      for (const key of Object.keys(manifest.configuration.properties)) {
        if (!(key.startsWith(prefix) && key.length > prefix.length)) {
          ctx.addIssue({
            code: "custom",
            message: `configuration key must start with "${prefix}": ${key}`,
            path: ["configuration", "properties", key],
          });
        }
      }
    }

    const groupContentPrefix = `${manifest.id}.`;
    for (const contribution of manifest.groupContent ?? []) {
      if (!contribution.id.startsWith(groupContentPrefix)) {
        ctx.addIssue({
          code: "custom",
          message: `groupContent id must start with "${groupContentPrefix}": ${contribution.id}`,
          path: ["groupContent", contribution.id],
        });
      }
    }
```

这让 group content 成为 manifest 声明贡献点，并额外要求 id 带插件命名空间，避免多个插件抢同一个 slot。字段保持可选；没有声明时等同空数组，避免为了新增扩展点机械修改所有既有插件和测试夹具。

- [ ] **Step 2: files 插件声明 group content 贡献点**

在 `src/plugins/builtin/files/manifest.ts` 顶部常量区加入：

```ts
export const FILES_GROUP_VIEW_CONTENT_ID = "pier.files.groupView";
```

在 manifest 中 `dashboardWidgets: [],` 后加入：

```ts
  groupContent: [
    {
      id: FILES_GROUP_VIEW_CONTENT_ID,
      title: "Files Group View",
    },
  ],
```

- [ ] **Step 3: 扩展插件 API 类型**

在 `src/plugins/api/renderer.ts` 中加入：

```ts
export interface PluginGroupContentClaim {
  group: PierDockviewGroupHandle;
  id: string;
  ownerId: symbol;
  render: () => ReactNode;
  visible: (group: PierDockviewGroupHandle) => boolean;
}
```

在 `RendererPluginContext` 中加入：

```ts
  groupContent: {
    claim(claim: PluginGroupContentClaim): boolean;
    release(input: { groupId: string; id: string; ownerId: symbol }): void;
  };
```

- [ ] **Step 4: 新建宿主 group content 适配层**

创建 `src/renderer/lib/plugins/host-group-content-context.tsx`：

```tsx
import type {
  PierDockviewGroupHandle,
} from "@shared/contracts/dockview.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { createRoot, type Root } from "react-dom/client";

const CONTENT_CONTAINER_SELECTOR = ".dv-content-container";
const CLEANUP_DELAY_MS = 1000;

type AssertDeclaredContribution = (
  entry: PluginRegistryEntry | undefined,
  kind: "groupContent",
  id: string
) => void;

interface GroupContentEntry {
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  disposables: Array<{ dispose: () => void }>;
  host: HTMLDivElement;
  namespace: string;
  owners: Set<symbol>;
  reactRoot: Root;
  visible: (group: PierDockviewGroupHandle) => boolean;
}

const entries = new Map<string, GroupContentEntry>();

function ownerNamespace(entry: PluginRegistryEntry | undefined): string {
  return entry?.manifest.id ?? "host";
}

function entryKey(namespace: string, groupId: string, id: string): string {
  return `${namespace}\u0000${id}\u0000${groupId}`;
}

function contentContainerForGroup(
  group: PierDockviewGroupHandle
): HTMLElement | null {
  const groupElement = group.element ?? group.model?.element;
  if (!(groupElement instanceof HTMLElement)) {
    return null;
  }
  return groupElement.querySelector<HTMLElement>(CONTENT_CONTAINER_SELECTOR);
}

function syncVisibility(
  entry: GroupContentEntry,
  group: PierDockviewGroupHandle
): void {
  const visible = entry.visible(group);
  entry.host.style.visibility = visible ? "visible" : "hidden";
  entry.host.style.pointerEvents = visible ? "auto" : "none";
}

function disposeEntry(key: string, entry: GroupContentEntry): void {
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  for (const disposable of entry.disposables) {
    disposable.dispose();
  }
  entry.reactRoot.unmount();
  entry.host.remove();
  entries.delete(key);
}

export function createHostGroupContentContext(
  entry: PluginRegistryEntry | undefined,
  assertDeclaredContribution: AssertDeclaredContribution
): RendererPluginContext["groupContent"] {
  const namespace = ownerNamespace(entry);
  return {
    claim: ({ group, id, ownerId, render, visible }) => {
      assertDeclaredContribution(entry, "groupContent", id);
      const key = entryKey(namespace, group.id, id);
      const existing = entries.get(key);
      if (existing) {
        existing.owners.add(ownerId);
        if (existing.cleanupTimer) {
          clearTimeout(existing.cleanupTimer);
          existing.cleanupTimer = null;
        }
        syncVisibility(existing, group);
        return true;
      }

      const container = contentContainerForGroup(group);
      if (!container) {
        return false;
      }
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      const host = document.createElement("div");
      host.dataset.pluginId = namespace;
      host.dataset.slot = id;
      host.dataset.groupId = group.id;
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.zIndex = "1";
      host.style.minHeight = "0";
      host.style.minWidth = "0";
      host.style.display = "flex";
      host.style.flexDirection = "column";
      container.appendChild(host);

      const reactRoot = createRoot(host);
      reactRoot.render(render());
      const entry: GroupContentEntry = {
        cleanupTimer: null,
        disposables: [],
        host,
        namespace,
        owners: new Set([ownerId]),
        reactRoot,
        visible,
      };
      entry.disposables.push(
        group.api.onDidActivePanelChange(() => syncVisibility(entry, group))
      );
      entries.set(key, entry);
      syncVisibility(entry, group);
      return true;
    },
    release: ({ groupId, id, ownerId }) => {
      assertDeclaredContribution(entry, "groupContent", id);
      const key = entryKey(namespace, groupId, id);
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      entry.owners.delete(ownerId);
      if (entry.owners.size > 0 || entry.cleanupTimer) {
        return;
      }
      entry.cleanupTimer = setTimeout(() => {
        entry.cleanupTimer = null;
        if (entry.owners.size === 0) {
          disposeEntry(key, entry);
        }
      }, CLEANUP_DELAY_MS);
    },
  };
}

export function clearHostGroupContentForTests(): void {
  for (const [key, entry] of [...entries.entries()]) {
    disposeEntry(key, entry);
  }
}

export function clearHostGroupContentForPlugin(pluginId: string): void {
  for (const [key, entry] of [...entries.entries()]) {
    if (entry.namespace === pluginId) {
      disposeEntry(key, entry);
    }
  }
}
```

- [ ] **Step 5: 注入 host context 并接入声明校验**

在 `src/renderer/lib/plugins/host-context.ts` 中将 `assertDeclaredContribution` 的 kind union 改为：

```ts
  kind:
    | "action"
    | "dashboardWidget"
    | "groupContent"
    | "panel"
    | "terminalStatusItem",
```

在判断分支中加入：

```ts
  } else if (kind === "groupContent") {
    declared = (entry.manifest.groupContent ?? []).some(
      (contribution) => contribution.id === id
    );
```

在 `src/renderer/lib/plugins/host-context.ts` 中 import：

```ts
import { createHostGroupContentContext } from "./host-group-content-context.tsx";
```

在 `createRendererPluginContext` 返回对象中加入：

```ts
    groupContent: createHostGroupContentContext(
      entry,
      assertDeclaredContribution
    ),
```

在 `src/renderer/lib/plugins/runtime.ts` 中 import：

```ts
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";
```

在 runtime 的 plugin disposer 中，和 `closeOverlaysForPlugin(entry.manifest.id)` 同级加入：

```ts
        clearHostGroupContentForPlugin(entry.manifest.id);
```

最终 disposer 顺序为：

```ts
      this.disposers.set(entry.manifest.id, () => {
        dispose();
        clearHostGroupContentForPlugin(entry.manifest.id);
        closeOverlaysForPlugin(entry.manifest.id);
      });
```

- [ ] **Step 6: 改造 files group view host**

将 `src/plugins/builtin/files/renderer/files-group-view-host.tsx` 改成只委托 `context.groupContent`：

```tsx
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_GROUP_VIEW_CONTENT_ID,
} from "../manifest.ts";
import { FilesGroupView } from "./files-group-view.tsx";

function isFilesActive(group: PierDockviewGroupHandle): boolean {
  const active = group.activePanel ?? group.model?.activePanel;
  return active?.view?.contentComponent === FILES_FILE_PANEL_ID;
}

export function claimFilesGroupView(input: {
  context: RendererPluginContext;
  group: PierDockviewGroupHandle;
  ownerId: symbol;
}): boolean {
  return input.context.groupContent.claim({
    group: input.group,
    id: FILES_GROUP_VIEW_CONTENT_ID,
    ownerId: input.ownerId,
    render: () => <FilesGroupView context={input.context} group={input.group} />,
    visible: isFilesActive,
  });
}

export function releaseFilesGroupView(input: {
  context: RendererPluginContext;
  groupId: string;
  ownerId: symbol;
}): void {
  input.context.groupContent.release({
    groupId: input.groupId,
    id: FILES_GROUP_VIEW_CONTENT_ID,
    ownerId: input.ownerId,
  });
}

export function filesGroupViewHostSlotSelector(): string {
  return `[data-slot="${FILES_GROUP_VIEW_CONTENT_ID}"]`;
}
```

同步更新 `file-panel.tsx` 调用：

```ts
      releaseFilesGroupView({ context: runtimeContext, groupId, ownerId });
```

同步更新 `src/plugins/builtin/files/renderer/index.tsx`：

删除 import：

```ts
import { clearFilesGroupViewHost } from "./files-group-view-host.tsx";
```

删除 deactivate 中的调用：

```ts
      clearFilesGroupViewHost();
```

group content 的全局兜底清理由 `RendererPluginRuntime` 调 `clearHostGroupContentForPlugin(FILES_PLUGIN_ID)` 完成；单个 tab 生命周期仍通过 `releaseFilesGroupView` 释放 owner。

- [ ] **Step 7: 组件测试 mock 接入真实 host group content**

在 `tests/component/files-file-panel.test.tsx` imports 中加入：

```ts
import {
  clearHostGroupContentForTests,
  createHostGroupContentContext,
} from "@/lib/plugins/host-group-content-context.tsx";
```

在 `createMockContext` 返回对象中加入真实 facade，不要用 `vi.fn()` 替代：

```ts
    groupContent: createHostGroupContentContext(undefined, () => undefined),
```

在 `beforeEach` 和 `afterEach` 中都加入：

```ts
  clearHostGroupContentForTests();
```

将 `react-dom/client` probe 的 slot 判断改成：

```ts
        container.dataset.slot === "pier.files.groupView"
```

现有 `keeps the injected files group view node across thin panel tab switches` 继续断言同一个 host 节点不重建；selector 改为 `[data-slot="pier.files.groupView"]`。

- [ ] **Step 8: 添加真实宿主链路测试**

在 `tests/unit/renderer/plugin-host-context.test.tsx` imports 中加入：

```ts
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import {
  clearHostGroupContentForTests,
} from "@/lib/plugins/host-group-content-context.tsx";
```

在 `afterEach` 中加入：

```ts
  clearHostGroupContentForTests();
```

加入 helper：

```tsx
function createMockDockviewGroup(activeComponent = "pier.files.filePanel"): {
  container: HTMLElement;
  group: PierDockviewGroupHandle;
  setActiveComponent: (component: string) => void;
  emitActiveChange: () => void;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const listeners = new Set<(event: unknown) => void>();
  const activePanel = {
    id: "active-panel",
    view: { contentComponent: activeComponent },
  };
  const group: PierDockviewGroupHandle = {
    activePanel,
    api: {
      onDidActivePanelChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    element: root,
    id: "group-a",
  };
  return {
    container,
    group,
    setActiveComponent: (component) => {
      activePanel.view.contentComponent = component;
    },
    emitActiveChange: () => {
      for (const listener of listeners) {
        listener({});
      }
    },
  };
}
```

在 `describe("createRendererPluginContext", () => { ... })` 内加入：

```tsx
it("claims declared group content through the real host context and releases it after the grace period", async () => {
  vi.useFakeTimers();
  const pluginEntryWithGroupContent: PluginRegistryEntry = {
    ...pluginEntry,
    manifest: {
      ...pluginEntry.manifest,
      groupContent: [
        {
          id: "sample.plugin.groupView",
          title: "Sample Group View",
        },
      ],
    },
  };
  const context = createRendererPluginContext(pluginEntryWithGroupContent);
  const ownerId = Symbol("owner");
  const { container, group, setActiveComponent, emitActiveChange } =
    createMockDockviewGroup();

  expect(
    context.groupContent.claim({
      group,
      id: "sample.plugin.groupView",
      ownerId,
      render: () => <div data-testid="sample-group-view">Sample</div>,
      visible: (candidate) =>
        candidate.activePanel?.view?.contentComponent === "pier.files.filePanel",
    })
  ).toBe(true);
  expect(
    container.querySelector('[data-slot="sample.plugin.groupView"]')
  ).toBeInstanceOf(HTMLElement);

  setActiveComponent("terminal");
  emitActiveChange();
  expect(
    container.querySelector<HTMLElement>('[data-slot="sample.plugin.groupView"]')
      ?.style.visibility
  ).toBe("hidden");

  context.groupContent.release({
    groupId: "group-a",
    id: "sample.plugin.groupView",
    ownerId,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    container.querySelector('[data-slot="sample.plugin.groupView"]')
  ).toBeNull();
});

it("rejects undeclared group content claims", () => {
  const context = createRendererPluginContext(pluginEntry);
  const ownerId = Symbol("owner");
  const { group } = createMockDockviewGroup();

  expect(() =>
    context.groupContent.claim({
      group,
      id: "sample.plugin.missingGroupView",
      ownerId,
      render: () => <div />,
      visible: () => true,
    })
  ).toThrow(undeclaredContributionErrorPattern);
});
```

- [ ] **Step 9: 添加 host adapter 单元测试**

创建 `tests/unit/renderer/host-group-content-context.test.tsx`：

```tsx
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearHostGroupContentForPlugin,
  clearHostGroupContentForTests,
  createHostGroupContentContext,
} from "@/lib/plugins/host-group-content-context.tsx";

function createMockGroup(activeComponent = "pier.files.filePanel"): {
  container: HTMLElement;
  group: PierDockviewGroupHandle;
  setActiveComponent: (component: string) => void;
  emitActiveChange: () => void;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const listeners = new Set<(event: unknown) => void>();
  const activePanel = {
    id: "active-panel",
    view: { contentComponent: activeComponent },
  };
  const group: PierDockviewGroupHandle = {
    activePanel,
    api: {
      onDidActivePanelChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    element: root,
    id: "group-a",
  };
  return {
    container,
    group,
    setActiveComponent: (component) => {
      activePanel.view.contentComponent = component;
    },
    emitActiveChange: () => {
      for (const listener of listeners) {
        listener({});
      }
    },
  };
}

afterEach(() => {
  clearHostGroupContentForTests();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("host group content context", () => {
  it("claims one DOM host per plugin slot and removes it after the last owner releases", async () => {
    vi.useFakeTimers();
    const context = createHostGroupContentContext(undefined, () => undefined);
    const ownerA = Symbol("owner-a");
    const ownerB = Symbol("owner-b");
    const { container, group } = createMockGroup();

    expect(
      context.claim({
        group,
        id: "host.test.groupView",
        ownerId: ownerA,
        render: () => <div>Sample</div>,
        visible: () => true,
      })
    ).toBe(true);
    expect(
      context.claim({
        group,
        id: "host.test.groupView",
        ownerId: ownerB,
        render: () => <div>Ignored</div>,
        visible: () => true,
      })
    ).toBe(true);
    expect(container.querySelectorAll('[data-slot="host.test.groupView"]')).toHaveLength(1);

    context.release({ groupId: "group-a", id: "host.test.groupView", ownerId: ownerA });
    await vi.advanceTimersByTimeAsync(1000);
    expect(container.querySelector('[data-slot="host.test.groupView"]')).toBeInstanceOf(HTMLElement);

    context.release({ groupId: "group-a", id: "host.test.groupView", ownerId: ownerB });
    await vi.advanceTimersByTimeAsync(1000);
    expect(container.querySelector('[data-slot="host.test.groupView"]')).toBeNull();
  });

  it("updates visibility when the dockview group active panel changes", () => {
    const context = createHostGroupContentContext(undefined, () => undefined);
    const ownerId = Symbol("owner");
    const { container, group, setActiveComponent, emitActiveChange } =
      createMockGroup();

    context.claim({
      group,
      id: "host.test.groupView",
      ownerId,
      render: () => <div>Sample</div>,
      visible: (candidate) =>
        candidate.activePanel?.view?.contentComponent === "pier.files.filePanel",
    });
    const host = container.querySelector<HTMLElement>('[data-slot="host.test.groupView"]');
    expect(host?.style.visibility).toBe("visible");

    setActiveComponent("terminal");
    emitActiveChange();

    expect(host?.style.visibility).toBe("hidden");
    expect(host?.style.pointerEvents).toBe("none");
  });

  it("clears all claimed group content for one plugin namespace", () => {
    const context = createHostGroupContentContext(undefined, () => undefined);
    const ownerId = Symbol("owner");
    const { container, group } = createMockGroup();

    context.claim({
      group,
      id: "host.test.groupView",
      ownerId,
      render: () => <div>Sample</div>,
      visible: () => true,
    });
    expect(container.querySelector('[data-slot="host.test.groupView"]')).toBeInstanceOf(HTMLElement);

    clearHostGroupContentForPlugin("host");

    expect(container.querySelector('[data-slot="host.test.groupView"]')).toBeNull();
  });
});
```

- [ ] **Step 10: 添加 runtime 生产清理测试**

创建 `tests/unit/renderer/plugin-runtime.test.ts`：

```ts
import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

const cleanupMocks = vi.hoisted(() => ({
  clearHostGroupContentForPlugin: vi.fn(),
  closeOverlaysForPlugin: vi.fn(),
}));

vi.mock("@/lib/plugins/host-group-content-context.tsx", () => ({
  clearHostGroupContentForPlugin: cleanupMocks.clearHostGroupContentForPlugin,
}));

vi.mock("@/stores/plugin-overlay.store.ts", () => ({
  closeOverlaysForPlugin: cleanupMocks.closeOverlaysForPlugin,
}));

import { RendererPluginRuntime } from "@/lib/plugins/runtime.ts";

function entry(id: string, enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("RendererPluginRuntime", () => {
  it("clears plugin-owned group content when a plugin is disposed", () => {
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: (_context: RendererPluginContext) => dispose,
      id: "sample.plugin",
    };
    const runtime = new RendererPluginRuntime([module]);

    runtime.refresh([entry("sample.plugin")]);
    runtime.refresh([]);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cleanupMocks.clearHostGroupContentForPlugin).toHaveBeenCalledWith(
      "sample.plugin"
    );
    expect(cleanupMocks.closeOverlaysForPlugin).toHaveBeenCalledWith(
      "sample.plugin"
    );
  });
});
```

- [ ] **Step 11: 运行测试**

Run:

```bash
pnpm vitest run tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts
```

Expected: PASS。

- [ ] **Step 12: 提交门禁**

Run:

```bash
git status --short src/renderer/lib/plugins/host-group-content-context.tsx src/plugins/api/renderer.ts src/shared/contracts/plugin.ts src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/manifest.ts src/plugins/builtin/files/renderer/files-group-view-host.tsx src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts
git diff -- src/renderer/lib/plugins/host-group-content-context.tsx src/plugins/api/renderer.ts src/shared/contracts/plugin.ts src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/manifest.ts src/plugins/builtin/files/renderer/files-group-view-host.tsx src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/renderer/lib/plugins/host-group-content-context.tsx src/plugins/api/renderer.ts src/shared/contracts/plugin.ts src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/manifest.ts src/plugins/builtin/files/renderer/files-group-view-host.tsx src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/index.tsx tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts
git diff --staged
# proposed: refactor(files): move group content hosting to renderer host
```

## Task 8: 依赖边界治理和最终验证

**Files:**

- Modify: `dependency-cruiser.config.cjs`
- Modify: `tests/unit/renderer/workspace-host-invariants.test.ts`

- [ ] **Step 1: 添加 depcruise 规则**

在 `dependency-cruiser.config.cjs` 的 forbidden rules 中加入：

```js
{
  name: "plugins-no-direct-dockview",
  severity: "error",
  from: { path: "^src/plugins(/|$)" },
  to: {
    path: "node_modules/(dockview-react|dockview-core|dockview)(/|$)",
  },
},
```

如果配置使用不同字段形态，保持同文件现有规则风格，但语义必须是：`src/plugins/**` 不得直接 import dockview 包。

- [ ] **Step 2: 添加静态治理测试**

在 `tests/unit/renderer/workspace-host-invariants.test.ts` 顶部 import 保持现状：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
```

在常量区加入：

```ts
const PLUGIN_DOCKVIEW_DIRECT_IMPORT_RE =
  /from\s+["'](?:dockview|dockview-react|dockview-core)["']/;
const PLUGIN_FILES_TO_CHECK = [
  "../../../src/plugins/builtin/files/renderer/file-panel.tsx",
  "../../../src/plugins/builtin/files/renderer/files-panel-instance-utils.ts",
  "../../../src/plugins/builtin/files/renderer/files-group-view.tsx",
  "../../../src/plugins/builtin/files/renderer/files-group-view-host.tsx",
  "../../../src/plugins/builtin/files/renderer/index.tsx",
  "../../../src/plugins/api/renderer.ts",
] as const;
```

在 `describe("workspace-host invariants (#17 #19)", () => { ... })` 内加入：

```ts
it("keeps dockview package imports out of plugin implementation files", () => {
  for (const relativePath of PLUGIN_FILES_TO_CHECK) {
    const source = readFileSync(resolve(import.meta.dirname, relativePath), "utf8");
    expect(source).not.toMatch(PLUGIN_DOCKVIEW_DIRECT_IMPORT_RE);
  }
});
```

- [ ] **Step 3: 搜索旧 API**

Run:

```bash
rg -n "fileFilePanelInstanceId|dropUnpinnedInstances: true|targetGroupId|listInstances|dockview-react|dockview-core|from ['\"]dockview" src tests
```

Expected:

- 没有 `fileFilePanelInstanceId`。
- group 级文件打开都传 `targetGroupId: groupId`。
- `src/plugins/**` 没有直接 import dockview 包。

- [ ] **Step 4: 运行类型检查、边界检查、测试**

Run:

```bash
pnpm typecheck
pnpm depcruise
pnpm vitest run tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/files-document-store.test.ts tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts tests/unit/renderer/files-terminal-action.test.tsx tests/unit/renderer/workspace-host-invariants.test.ts
```

Expected: PASS。

- [ ] **Step 5: 运行完整检查**

Run:

```bash
pnpm check
```

Expected: PASS。

- [ ] **Step 6: 提交门禁**

Run:

```bash
git status --short
git diff -- src/plugins/api/renderer.ts src/shared/contracts/plugin.ts src/renderer/lib/plugins/host-panels-context.ts src/renderer/lib/plugins/host-group-content-context.tsx src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/manifest.ts src/plugins/builtin/files/renderer/file-panel-id.ts src/plugins/builtin/files/renderer/files-document-types.ts src/plugins/builtin/files/renderer/files-panel-instance-utils.ts src/plugins/builtin/files/renderer/files-group-view.tsx src/plugins/builtin/files/renderer/files-group-view-host.tsx src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/file-tree-sidebar.tsx src/plugins/builtin/files/renderer/index.tsx dependency-cruiser.config.cjs tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/files-document-store.test.ts tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts tests/unit/renderer/files-terminal-action.test.tsx tests/unit/renderer/workspace-host-invariants.test.ts
```

Do not commit. 如果用户之后明确要求提交，拟用 message：

```bash
git add src/plugins/api/renderer.ts src/shared/contracts/plugin.ts src/renderer/lib/plugins/host-panels-context.ts src/renderer/lib/plugins/host-group-content-context.tsx src/renderer/lib/plugins/host-context.ts src/renderer/lib/plugins/runtime.ts src/plugins/builtin/files/manifest.ts src/plugins/builtin/files/renderer/file-panel-id.ts src/plugins/builtin/files/renderer/files-document-types.ts src/plugins/builtin/files/renderer/files-panel-instance-utils.ts src/plugins/builtin/files/renderer/files-group-view.tsx src/plugins/builtin/files/renderer/files-group-view-host.tsx src/plugins/builtin/files/renderer/file-panel.tsx src/plugins/builtin/files/renderer/file-tree-sidebar.tsx src/plugins/builtin/files/renderer/index.tsx dependency-cruiser.config.cjs tests/component/files-file-panel.test.tsx tests/unit/renderer/plugin-panel-instances.test.ts tests/unit/renderer/files-document-store.test.ts tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/host-group-content-context.test.tsx tests/unit/renderer/plugin-runtime.test.ts tests/unit/renderer/files-terminal-action.test.tsx tests/unit/renderer/workspace-host-invariants.test.ts
git diff --staged
# proposed: fix(files): isolate file previews by dockview group
```

## 验收矩阵

| 需求 | 证据 |
| --- | --- |
| A 组 a1/a2，拖 a2 到 B 后 A 展示 a1 | 现有 `keeps the source group on its remaining tab after dragging a sibling tab away` |
| 目标 group 内 preview 替换不影响其它 group | Task 2 `drops unpinned preview instances only inside the target group` |
| `targetGroupId` 失效不全局关闭 | Task 2 `does not drop previews globally when targetGroupId is invalid` |
| 无 active group 不全局关闭 | Task 2 `does not drop previews globally when no active group exists` |
| 已有实例不能越过 `targetGroupId` 更新其它 group | Task 2 `rejects updating an existing instance outside the requested target group` |
| `listInstances` 不泄漏嵌套 params 活引用 | Task 1 `lists only declared plugin panel instances with readonly params snapshots` |
| 同文件跨 group 可独立打开 | Task 4 `opens the same disk file as independent tab instances in different groups` |
| 同 group 同文件复用已有标签 | Task 4 `reuses an existing same-source file tab without dropping dirty params` |
| 复用已有标签不丢 dirty | Task 4 dirty params 测试 |
| 非最后一个 dirty 同源标签关闭不弹保存确认、不移除共享文档 | Task 5 `allows closing a dirty disk tab without discarding the shared document while another same-source tab remains` |
| 关闭一个干净同源标签不移除共享文档 | Task 5 `keeps a clean disk document while another same-source tab is still open` |
| 最后一个同源标签关闭后清理干净文档 | Task 5 `drops a clean disk document when the last same-source tab is closed` |
| 最后一个 dirty 同源标签可按“不保存”丢弃共享文档 | Task 5 `discards a dirty disk document only when the last same-source tab chooses dont-save` |
| 命令面板树搜索定位当前 group | Task 6 `opens tree search for the active file panel group instead of root fallback` |
| 没有活动文件 group 时树搜索不按 root fallback | Task 6 `does not open tree search by root fallback when no active file panel group exists` |
| 活动 panel 快照缺 group 时树搜索 no-op | Task 6 `does not open tree search when the active file panel has no group snapshot` |
| 指定 tree instanceId 未命中时不回退同 root 其它树 | Task 6 `does not fall back to another same-root tree when a target tree instance is missing` |
| group view 不由插件直接操作 dockview DOM | Task 7 `host-group-content-context.tsx` + sentinel 测试 + `claims declared group content through the real host context and releases it after the grace period` |
| 插件停用/刷新后清理该插件 group content host | Task 7 `clears plugin-owned group content when a plugin is disposed` |
| 插件不直接 import dockview | Task 8 depcruise 规则 + 静态测试 |

## 子 agent 审查反馈已处理

已处理的严重/高风险项：

- 取消 `panelsInGroup(api, null) => api.panels` 设计，改为没有 group 就不关闭 preview。
- 增加 invalid `targetGroupId`、无 active group 测试。
- 修正 invalid `targetGroupId`、无 active group 测试期望：只验证不全局 close，不错误要求 dockview 默认新增行为完全不发生。
- 修正测试夹具，让初始 panels 也有 `api.close()`。
- 增加共享 disk document 的 clean cleanup 和 dirty close guard 两条关闭策略。
- 复用 existing tab 时合并 `existing.params`，保留 `dirty`。
- 命令面板文件树搜索按 active file panel group 定位；没有 active file group 时 no-op，不按 root fallback。
- `listInstances` 返回递归克隆的 params 快照，避免嵌套 `source` / `context` 活引用泄漏。
- host facade 对已有 instance 也执行 `targetGroupId` 校验，禁止 B 组请求更新/激活 A 组同 id panel。
- 文件树 registry 在传入 `instanceId` 时严格精确查找，目标 group 树缺失时不按 root 回退到其它 group。
- 同文件跨 group 测试使用真实 identity key 前缀，防止旧 deterministic id 实现侥幸通过。
- 增加匹配当前仓库 `node_modules/...` 路径风格的 depcruise 规则。
- 将 group content DOM 注入迁到 renderer host 适配层，并纳入 manifest `groupContent` 声明校验。
- 组件测试 mock 使用真实 `createHostGroupContentContext`，并新增 `createRendererPluginContext` 到 DOM claim/release 的宿主链路测试。
- `groupContent` manifest 字段保持可选，避免破坏既有插件和测试夹具；声明校验使用 `?? []`。
- runtime 在插件 dispose 后统一调用 `clearHostGroupContentForPlugin(pluginId)`，files 插件不再自管旧 DOM host 清理。

明确保留的例外：

- untitled 终端选区每次创建新文档，`document.id` 可作为初始 panel id；后续如需要同一 untitled 文档跨 group 多实例，再按 disk 文件同样拆分。
- 文件树展开/折叠仍是项目级偏好，不纳入本次 group 隔离目标。

## 自查

覆盖性：

- 计划覆盖了 preview 全局误伤、panel id 与 document id 耦合、跨组拖拽、共享文档生命周期、命令面板搜索、宿主 DOM 注入边界、dependency-cruiser 治理。

占位扫描：

- 本计划没有 `TBD`、`TODO`、`implement later`。

类型一致性：

- 组 id 类型统一为 `PluginPanelGroupId`。
- 实例快照统一为 `PluginPanelInstanceSnapshot`。
- 目标 group 字段统一为 `targetGroupId`。
- 文件 identity 函数统一为 `fileFilePanelIdentityKey`。
- 新标签实例函数统一为 `createFileFilePanelInstanceId`。

## 执行建议

主会话按 Task 1 到 Task 8 串行实现。每完成一个 Task 运行该 Task 的测试；Task 8 前再次派干净子 agent 只读审查实现是否仍符合计划。子 agent 不直接修改文件，避免与主会话写同一批文件产生冲突。
