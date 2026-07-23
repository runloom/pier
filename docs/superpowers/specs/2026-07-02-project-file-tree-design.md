# Project File Tree 与 Git Review Tree 统一设计

更新时间：2026-07-02

## 背景

Pier 后续要支持两类相近但数据源不同的树：

1. **Project Files Tree**：当前项目文件树，用于文件查看、打开、重命名、移动、删除、新建、reveal 当前文件。
2. **Git Changes / Review Files Tree**：Git 变更文件树，用于审查 staged / unstaged / untracked / conflict 文件，点选后打开 diff、HEAD 内容或工作区内容。

当前子 worktree `/Users/dev/Xyz/pier-file-tree-plugins` 状态：

- `packages/ui/package.json` 已引入 `@pierre/trees@1.0.0-beta.5`，`pnpm-lock.yaml` 已锁定 `packages/ui` importer。
- `packages/ui/src/file-tree.tsx` 已有第一版 `PierFileTree` wrapper，但当前只覆盖静态 path 列表、尾部 text decoration、selection/open 回调。
- `src/plugins/builtin/git/renderer/git-changes-panel.tsx` 已将 `GitStatus.files` 渲染为 tree，并覆盖 restored panel runtime Git API、watch snapshot、stale refresh generation、staged-only diff、rename/copy old-side content 等测试场景。
- `src/plugins/builtin/files/renderer/index.tsx` 已有 Files panel，但当前只调用 `context.files.list(root, { path: "" })` 读取 root direct children，尚未具备目录展开懒加载、ProjectTreeService session、watch/reveal/文件操作状态机。
- `src/shared/contracts/file.ts`、`src/preload/file-api.ts`、`src/main/services/file-service.ts` 已覆盖基础 list/read/write/move/rename/trash 合同；Project Files Tree 需要在此之上新增 project-tree session 合同，不应把高层 tree 状态塞回低级 `FileService`。

问题不是“要不要做两个树组件”，而是“要不要有一个 Pier 自己的树抽象”。结论：**必须统一封装**。业务 panel 不应直接 import `@pierre/trees`，也不应各自维护点击、选择、路径归一化、装饰、scrollbar、a11y、context menu、rename、drag/drop 逻辑。

## 目标与非目标

目标：

- 引入统一的 `PierFileTree` 组件，作为 Project Files、Git Changes、Review Files 的唯一树入口。
- 使用 `@pierre/trees` 作为第一版渲染引擎，但将其包在 `packages/ui` 内，业务层只消费 Pier API。
- Project Files Tree 支持大项目与大文件夹：初始只加载 root direct children，展开目录时只加载该目录 direct children，不递归扫描整个项目。
- Git Changes Tree 复用同一树 wrapper，但数据来自 `GitStatus.files`，不走文件系统扫描。
- 明确与 VS Code Explorer 的实现差异，采用其成熟模式中适合 Pier 的部分，避免照搬其完整 workbench 复杂度。

非目标：

- 不做通用第三方文件系统 provider 平台；Pier 第一版只支持本地 workspace root。
- 不在第一版实现文件内容编辑器。树只负责导航、选择、文件操作入口；内容查看/编辑由后续 panel 承接。
- 不把 task 生命周期、看板或自动调度带回 Pier；这仍然不是 Pier 的产品方向。
- 不让 renderer 业务代码直接访问 Node FS；所有文件系统操作经过 main/preload 合同。
- 不在业务 panel 直接 import `@pierre/trees`、dockview 或跨 panel-kit 复用内部实现。

## 核心决策

### 1. 统一 wrapper，而不是各自实现

新增 `packages/ui/src/file-tree.tsx`，导出 Pier 自己的文件树 API：

```ts
export type PierTreeSource = "project" | "git" | "review";

export type PierFileTreeItemKind =
  | "directory"
  | "file"
  | "symlink"
  | "unknown";

export type PierDirectoryLoadState =
  | "unloaded"
  | "loading"
  | "loaded"
  | "dirty"
  | "empty"
  | "error";

export interface PierFileTreeItem {
  readonly kind: PierFileTreeItemKind;
  readonly path: string;
  readonly name?: string;
  readonly source?: PierTreeSource;
  readonly hasChildren?: boolean | "unknown";
  readonly loadState?: PierDirectoryLoadState;
  readonly decorations?: readonly PierFileTreeDecoration[];
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export interface PierFileTreeDecoration {
  readonly kind: "badge" | "icon" | "text";
  readonly label: string;
  readonly tone?: "default" | "muted" | "success" | "warning" | "danger";
  readonly title?: string;
}

export interface PierTreeGitStatus {
  readonly path: string;
  readonly code:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "conflict"
    | "ignored";
  readonly staged?: boolean;
}

export interface PierFileTreeProps {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly density?: "compact" | "default";
  readonly decorations?: ReadonlyMap<string, readonly PierFileTreeDecoration[]>;
  readonly gitStatus?: readonly PierTreeGitStatus[];
  readonly initialExpandedPaths?: readonly string[];
  readonly items: readonly PierFileTreeItem[];
  readonly directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  readonly loadingDirectories?: ReadonlySet<string>;
  readonly onLoadDirectory?: (path: string) => Promise<void> | void;
  readonly onOpenPath?: (path: string) => void;
  readonly onRevealPath?: (path: string) => Promise<void> | void;
  readonly onSelectPaths?: (paths: readonly string[]) => void;
  readonly selectedPaths?: readonly string[];
}
```

业务代码只知道 root-relative POSIX path：

```text
src/renderer/App.tsx
src/renderer
```

`@pierre/trees` 的内部路径约定由 wrapper 独占处理，例如目录是否需要 trailing slash、官方 path 与业务 path 的互转、selection 回调的路径清洗、directory decoration 的 lookup key。

Wrapper 映射规则：

- `directory` 使用 official directory path，可以 expand/collapse。
- `file` 使用 official file path，只触发 open/select。
- `symlink` 第一版映射为 file-like row，加 symlink decoration，不跟随目录 symlink 展开；显式打开时由 file service 决定是否 resolve target。
- `unknown` 映射为 file-like row，加 muted/error decoration，不允许 rename/move/delete 以外的隐式打开行为。
- `PierTreeGitStatus` 不直接等同 `@pierre/trees` 的 `GitStatusEntry`。`added/deleted/ignored/modified/renamed/untracked` 可映射到官方 git lane；`copied/conflict/staged/unstaged` 通过 Pier row decorations 或后续 patched status API 渲染，避免类型和值域泄漏。

### 2. `@pierre/trees` 作为渲染 primitive，不作为 Pier 业务 API

选择 `@pierre/trees` 的理由：

- 它是 path-first file tree，和 Git status / project files 的路径数据天然匹配。
- 它已有 React 包装、虚拟渲染、搜索、选择、rename、drag/drop、Git status、row decoration、SSR/prepared input 等能力。
- 它的 public API 支持 `model.add`、`model.batch`、`model.move`、`model.remove`、`model.resetPaths`、`model.getItem(path)?.expand()`，足够支撑 Git Changes Tree、静态 Project Tree、增量插入 children。

限制：

- 它不是 VS Code 那种完整 async data tree；公开 API 没有一等 `onExpandDirectory` / `hasUnloadedChildren` 数据源合同。
- `hasChildren` 当前由已知 child path 推导；一个未加载但实际有 children 的目录，在没有 child path 时不会天然显示可展开 twistie。
- row label 由 path 派生，row decoration 只能做尾部装饰，不适合塞 `Load more…`、`Loading…`、`Retry` 这类控制行。
- 因此大目录分页、真正的文件管理列表，不应全部压进 tree row。

Patch gate：

- 如果 `@pierre/trees` 不能表达“目录未加载但可展开”，**必须 patch `@pierre/trees` 或向上游补 API**，不能用递归预加载、fake child path、`Load more...` path、业务 panel 直接操作 Shadow DOM 来绕过。
- Patch 应通过 `pnpm patch @pierre/trees@1.0.0-beta.5` 进入 `pnpm.patchedDependencies`，随 lockfile 一起提交；禁止直接修改 `node_modules` 作为交付物。
- Patch API 目标是最小化：初始化可接收 `FileTreeOptions.directoryHints`，运行时必须提供 `model.setDirectoryHints(hints)` 或等价的 `resetPaths({ preparedInput, directoryHints })` 更新入口；否则 React prop 变化不会进入已创建的 virtualized model。
- Patch 只提供 `hasUnloadedChildren` / `loading` / `error` / `onDirectoryExpansionChange`；不把 Pier 的 ProjectTreeService 类型泄漏进 `@pierre/trees`。
- Patch 行为必须保持 click、Enter/Space、ArrowRight、ArrowLeft、a11y `aria-expanded`、virtual rows、sticky folders、selection、drag/drop 不退化。
- `PierFileTree` 必须在 `directoryStates` 或 `items[*].hasChildren/loadState` 变化时调用运行时更新入口，保证 unloaded → loading → loaded/error 的 row state 不 stale。
- 如果 patch 不能在合理范围内完成，Project Files Tree 的 lazy expand 阶段应阻塞在树 primitive，而不是降级成全仓递归扫描。

决策：

```text
业务 panel -> PierFileTree -> @pierre/trees
```

不允许：

```text
GitChangesPanel -> @pierre/trees
ProjectFilesPanel -> @pierre/trees
ReviewPanel -> @pierre/trees
```

### 3. Project Files Tree 用 lazy direct-children，不做启动递归扫描

Project Files Tree 的核心约束：

```text
打开 Files panel：只读取 root direct children
展开 src：只读取 src/*
展开 src/renderer：只读取 src/renderer/*
不因为打开 Files panel 而读取 repo/**/*
```

新增 main-side `ProjectTreeService`，不要把这些能力塞进低级 `FileService`：

```ts
export interface ProjectTreeService {
  open(request: ProjectTreeOpenRequest): Promise<ProjectTreeOpenResult>;
  close(sessionId: string): Promise<void>;
  listChildren(request: ProjectTreeListChildrenRequest): Promise<ProjectTreeListChildrenResult>;
  refreshDirectory(request: ProjectTreeRefreshDirectoryRequest): Promise<ProjectTreeListChildrenResult>;
  reveal(request: ProjectTreeRevealRequest): Promise<ProjectTreeRevealResult>;
  watch(
    request: ProjectTreeWatchRequest,
    listener: ProjectTreeWatchListener
  ): ProjectTreeWatcherDispose;
}

export interface ProjectTreeOpenRequest {
  readonly root: string;
}

export interface ProjectTreeOpenResult {
  readonly root: string;
  readonly sessionId: string;
  readonly version: number;
  readonly entries: readonly ProjectTreeEntry[];
}

export interface ProjectTreeListChildrenRequest {
  readonly cursor?: string | null;
  readonly limit?: number;
  readonly path: string;
  readonly sessionId: string;
  readonly sort?: "default" | "mixed" | "filesFirst" | "modified";
}

export interface ProjectTreeListChildrenResult {
  readonly directoryState: ProjectTreeDirectoryState;
  readonly entries: readonly ProjectTreeEntry[];
  readonly nextCursor: string | null;
  readonly path: string;
  readonly root: string;
  readonly sessionId: string;
  readonly totalCount: number | null;
  readonly version: number;
}

export interface ProjectTreeRefreshDirectoryRequest {
  readonly path: string;
  readonly sessionId: string;
}

export interface ProjectTreeRevealRequest {
  readonly path: string;
  readonly sessionId: string;
}

export interface ProjectTreeRevealResult {
  readonly entriesByDirectory: Readonly<Record<string, readonly ProjectTreeEntry[]>>;
  readonly path: string;
  readonly parentChain: readonly string[];
  readonly sessionId: string;
  readonly version: number;
}

export interface ProjectTreeWatchRequest {
  readonly sessionId: string;
}

export type ProjectTreeWatchReason =
  | "create"
  | "delete"
  | "rename"
  | "move"
  | "change"
  | "unknown";

export type ProjectTreeWatchEvent =
  | {
      readonly kind: "directoryChanged";
      readonly path: string;
      readonly reason: ProjectTreeWatchReason;
      readonly sessionId: string;
      readonly version: number;
    }
  | {
      readonly kind: "rootUnavailable";
      readonly message: string;
      readonly sessionId: string;
      readonly version: number;
    };

export type ProjectTreeWatchListener = (
  event: ProjectTreeWatchEvent
) => void;

export type ProjectTreeWatcherDispose = () => void;
```

关键数据：

```ts
export interface ProjectTreeEntry {
  readonly root: string;
  readonly path: string;
  readonly name: string;
  readonly parentPath: string;
  readonly kind: "directory" | "file" | "symlink" | "unknown";
  readonly depth: number;
  readonly hasChildren: boolean | "unknown";
  readonly loaded: boolean;
  readonly dirty: boolean;
  readonly size?: number;
  readonly mtimeMs?: number;
}

export type ProjectTreeDirectoryState =
  | { readonly state: "unloaded"; readonly path: string; readonly version: number }
  | { readonly state: "loading"; readonly path: string; readonly version: number }
  | { readonly state: "loaded"; readonly path: string; readonly version: number; readonly childCount: number }
  | { readonly state: "dirty"; readonly path: string; readonly version: number; readonly childCount: number | null }
  | { readonly state: "error"; readonly path: string; readonly version: number; readonly message: string };
```

第一版允许 `listChildren` 返回一个目录的全部 direct children。对 10k 级平铺目录，依赖 tree virtual rows 保持 DOM 数量可控。对 100k 级平铺目录，树可显示但不是最佳操作 surface；正式文件管理应增加 Directory Content List/Table。

### 4. 大文件夹由 tree 导航 + content list/table 管理

大文件夹场景：

```text
assets/
  000001.png
  000002.png
  ...
  100000.png
```

树视图职责：

- 选中 `assets`。
- 展开后可看到 direct children。
- 支持 reveal 和少量文件操作入口。

目录内容列表职责：

- 大量文件排序、筛选、多选、批量 move/delete。
- 列显示 size、mtime、kind、Git status。
- 可以做分页、cursor、streaming、worker sort。

因此第一版 Project Files 可以先只有 tree，但 service 合同必须为 list/table 留出 `cursor`、`limit`、`sort` 字段；不要把 `Load more…` 伪装成 fake path 放进 tree。

### 5. Git Changes Tree 只消费 Git status，不扫文件系统

Git Changes Tree 的输入来自：

```ts
GitStatus.files: GitFileStatus[]
```

映射规则：

```ts
export interface GitChangeTreeItem extends PierFileTreeItem {
  readonly kind: "file";
  readonly path: string;
  readonly metadata: {
    readonly index: string;
    readonly worktree: string;
    readonly origPath: string | null;
    readonly staged: boolean;
    readonly unstaged: boolean;
    readonly untracked: boolean;
    readonly conflict: boolean;
  };
}
```

目录节点由 paths 派生，不代表磁盘 listing。它只用于 grouping：

```text
src/
  renderer/
    App.tsx  M
```

点击文件：

- staged-only：`git.getDiffPatch(cwd, { path, staged: true })`
- unstaged-only：`git.getDiffPatch(cwd, { path })`
- both：第一版默认打开 unstaged diff，并用 decoration 标记 staged；后续可拆 staged / unstaged 两段。
- untracked：不请求 HEAD content；显示 worktree content 或 “new file” diff view。
- rename/copy：显示 `origPath -> path`，打开 diff 时用 `path`，读取 old side 时用 `origPath ?? path`。

当前 `RendererPluginContext.git` 已暴露 Git review 所需的 `getStatus/watch/getDiffPatch/getFileContent/stage/unstage/discardChanges`，Git panel 不应绕到 `window.pier.git`。

### 6. Watcher 更新只作用于已加载目录

Project Files watcher 规则：

| 事件 | Parent loaded | Parent unloaded |
|---|---|---|
| create file | add row | mark parent dirty |
| delete file | remove row | no visible change |
| rename file | move row | mark source/target parent dirty |
| change file | update decoration/mtime | no visible change |
| many events | debounce + refresh loaded affected dirs | mark dirty only |

不要因为 `node_modules` 或 `dist` 变化而展开或刷新未加载子树。

Git watcher 规则：

- 继续使用现有 `git.watch(gitRoot, listener)`。
- watcher event 有 status snapshot 时，Git Changes panel 直接消费 snapshot。
- watcher event 没有 status 时，再调用 `git.getStatus(cwd)`。
- 用 generation/root guard 防旧请求覆盖新状态。

### 7. Exclude / reveal 策略参考 VS Code，但默认更保守

Project Files 默认：

```ts
files.exclude = {
  "**/.git": true,
  "**/.svn": true,
  "**/.hg": true,
  "**/.DS_Store": true,
  "**/Thumbs.db": true,
};

projectTree.autoRevealExclude = {
  "**/node_modules": true,
  "**/bower_components": true,
};

projectTree.searchExclude = {
  "**/node_modules": true,
  "**/dist": true,
  "**/out": true,
  "**/build": true,
  "**/coverage": true,
};
```

`node_modules` 不默认从 Explorer 隐藏；用户主动展开时允许加载 direct children。它只默认排除 autoReveal 与 project-wide search。

### 8. Compact folders 第一版开启

单子目录链压缩对 monorepo 和 deeply nested package 很有价值：

```text
src/foo/bar/baz
```

只对**已加载到 model 的单子目录链**显示 compact row；不要为了 compact folder 额外递归读取未知 descendants。`@pierre/trees` 有 `flattenEmptyDirectories`；Pier wrapper 暴露为：

```ts
flattenSingleChildDirectories?: boolean;
```

默认：

```text
Project Files Tree: true, but only for already-loaded chains
Git Changes Tree: true
Review Files Tree: true
```

Project Files 如果后续需要 VS Code 那种首次展开即压缩完整单子目录链，必须在 `ProjectTreeService.listChildren` 增加显式、可配置、有限深度的 `resolveSingleChildDescendants`，而不是在 UI wrapper 递归扫描。

如果 screen reader 优化模式后续接入，可像 VS Code 一样在可访问性模式下关闭 compact folders。

## 组件与文件边界

### UI package

```text
packages/ui/src/file-tree.tsx
```

责任：

- 唯一 import `@pierre/trees/react` 的位置。
- 将 `PierFileTreeItem[]` 转换为 `@pierre/trees` paths / gitStatus / rowDecoration / directory hints。
- 处理 directory trailing slash 与 official path 互转。
- 统一 selection、open、lazy load、expand、scrollToPath、focusPath。
- 根据 `loadState` 渲染 loading/error/empty decoration，但不创造 fake filesystem path。
- dependency-cruiser 增加 `no-direct-pierre-trees-imports`：除 `packages/ui/src/file-tree.tsx` 和测试夹具外，`src/**`、`packages/*/src/**` 不得 import `@pierre/trees` 或 `@pierre/trees/react`。
- 注入 Pier scrollbar/theme CSS。
- 不知道 Git API、file API、workspace store、dockview。

### Project tree contracts

```text
src/shared/contracts/file.ts
src/shared/contracts/project-tree.ts
```

责任：

- zod schemas for file operations and project tree operations。
- root-scoped POSIX path 校验。
- request/result 类型供 main/preload/renderer 共用。

### Main service

```text
src/main/services/file-service.ts
src/main/services/project-tree-service.ts
```

责任：

- `file-service`：低级 read/write/move/rename/trash。
- `project-tree-service`：session、directory cache、lazy list、watcher coalesce、reveal parent chain、exclude matching。
- 文件操作先走 `file-service`，成功后由 `project-tree-service` refresh 受影响父目录；不要复制一套 create/rename/move/delete 到 tree service。
- 所有路径必须 resolve 到 root 内，拒绝绝对路径逃逸和 `..` 逃逸。

### Preload

```text
src/preload/file-api.ts
src/preload/project-tree-api.ts
src/preload/index.ts
```

责任：

- 暴露 `window.pier.files` 和 `window.pier.projectTree`。
- `projectTree.watch(request, listener)` 在 preload 内注册 listener，main 通过 `project-tree:watch-event` 广播 `ProjectTreeWatchEvent`，preload 按 `sessionId` 过滤并在 dispose 时移除 listener。
- `projectTree.close(sessionId)` 必须停止该 session 的 main watcher、清 directory cache、拒绝后续旧 session event。
- 只做 command/event facade，不包含业务逻辑。

### Plugin API

```text
src/plugins/api/renderer.ts
src/renderer/lib/plugins/host-context.ts
```

责任：

- 给 files plugin 暴露 `context.projectTree` / `context.files`；`context.projectTree.watch(request, listener)` 返回 dispose。
- Git review 主路径已由 `context.git.getStatus/watch/getDiffPatch/getFileContent/stage/unstage/discardChanges` 覆盖；后续 row action 继续走 plugin context，不绕 `window.pier.git`。
- 权限按 `file:read`、`file:write`、`git:read`、`git:write` 展示和校验；Files plugin 在只读树阶段只声明 `file:read`，进入 rename/move/trash/writeText 阶段必须同步给 manifest/panel 加 `file:write`。

### Builtin Files plugin

```text
src/plugins/builtin/files/manifest.ts
src/plugins/builtin/files/renderer/index.ts
src/plugins/builtin/files/renderer/project-files-panel.tsx
```

责任：

- 贡献 `pier.files.project` panel。
- 调 `context.projectTree.open/listChildren/reveal/watch/close`。
- 只读树阶段 manifest 保持 `file:read`；启用 context menu 写操作时，同一变更必须给 `src/plugins/builtin/files/manifest.ts` 的 plugin/panel capability 增加 `file:write`。
- 调 `context.files.rename/move/trash/writeText` 等执行真实文件操作，再刷新受影响目录。
- 渲染 `PierFileTree`，维护 sessionId、entries map、directoryStates、selectedPaths、focusedPath、pending generations。
- panel unmount 或 root change 时先 dispose watch，再 `context.projectTree.close(sessionId)`。
- 不直接访问 Node FS。

### Builtin Git plugin

```text
src/plugins/builtin/git/renderer/git-changes-panel.tsx
```

责任：

- 已从占位 panel 升级为 Git Changes Tree；后续补 diff preview 宿主、row actions、batch stage/unstage/discard。
- 调 `context.git.getStatus/watch/getDiffPatch/getFileContent`，写操作继续走 `context.git.stage/unstage/discardChanges`。
- 将 `GitFileStatus[]` 映射为 `PierFileTreeItem[]`，目录只用于 grouping，不触发 file-system listing。
- 不实现自己的 tree。

## 数据流

### Project Files 初始加载

```text
Files command / panel open
  -> context.projectTree.open({ root })
  -> main creates session
  -> main lists root direct children
  -> renderer stores sessionId + entries
  -> renderer subscribes context.projectTree.watch({ sessionId }, listener)
  -> PierFileTree renders loaded root rows
```

### Project Files 展开目录

```text
user activates directory row "src"
  -> PierFileTree checks item.hasChildren/loadState
  -> if loadState = unloaded/dirty/error: onLoadDirectory("src")
  -> renderer marks directory state loading with generation N
  -> context.projectTree.listChildren({ sessionId, path: "src" })
  -> main reads src/* only
  -> renderer ignores result unless sessionId/root/generation still current
  -> renderer merges entries into entriesByPath + childrenByDirectory
  -> PierFileTree model.batch(add children) or reset prepared input
  -> PierFileTree expands "src" and scroll/focus remains stable
```

如果 `@pierre/trees` 未 patch，`src` 在无 child path 时不会显示 expandable arrow；此阶段不得退回递归预加载，只能先完成 patch gate。

### Project Files reveal

```text
reveal("src/renderer/App.tsx")
  -> main validates path inside root
  -> main returns parent chain ["src", "src/renderer", "src/renderer/App.tsx"]
  -> renderer loads every missing parent in order with generation guard
  -> renderer expands src and src/renderer
  -> PierFileTree scrollToPath("src/renderer/App.tsx", { focus: true })
  -> if target is excluded/deleted, renderer shows scoped error and keeps current selection
```

### Project Files file operations

```text
create / rename / move / trash from context menu or toolbar
  -> renderer validates selected paths are still present in entries map
  -> context.files.* executes mutation through preload/main
  -> main resolves every source/target path under root and performs operation
  -> renderer refreshes affected parent directories through projectTree
  -> stale watcher events with older version are ignored
  -> selection moves to new path, parent, or nearest surviving sibling
```

### Project Files watch event

```text
filesystem event under root
  -> main maps event to nearest ProjectTree session directory path
  -> main emits ProjectTreeWatchEvent(sessionId, path, reason, version)
  -> preload filters by sessionId and calls renderer listener
  -> renderer refreshes loaded affected directories
  -> renderer marks unloaded affected directories dirty only
```

### Project Files dispose / root change

```text
panel unmount or root changes
  -> dispose projectTree.watch subscription
  -> context.projectTree.close(sessionId)
  -> main disposes watcher and cache for that session
  -> renderer ignores late events/results for closed sessionId
```

规则：

- create/write 只刷新 target parent。
- rename 只刷新 same parent；case-only rename 在 macOS 仍按 rename result 的 canonical path 更新。
- move 刷新 source parent 和 destination parent。
- trash/delete 刷新 source parent，并清理 selected/revealed path。
- symlink 不递归跟随；只显示 symlink entry，打开或 reveal 时交给 file service resolve 策略。

### Git Changes load

```text
Git Changes panel open
  -> context.git.getStatus(cwd)
  -> files -> GitChangeTreeItem[]
  -> PierFileTree renders grouped paths
  -> context.git.watch(gitRoot, event => apply status snapshot or refetch)
```

### Git Changes open file

```text
user opens changed file
  -> derive selected diff mode from GitFileStatus
  -> context.git.getDiffPatch(cwd, { path, staged })
  -> for non-added tracked rows, context.git.getFileContent(cwd, { path: origPath ?? path })
  -> render diff preview in same panel or sibling panel
```

## VS Code 实现对比

调研来源：

- `microsoft/vscode/src/vs/workbench/contrib/files/browser/views/explorerView.ts`
- `microsoft/vscode/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`
- `microsoft/vscode/src/vs/workbench/contrib/files/common/explorerModel.ts`
- `microsoft/vscode/src/vs/base/browser/ui/tree/asyncDataTree.ts`
- `microsoft/vscode/src/vs/base/browser/ui/list/listView.ts`
- `microsoft/vscode/src/vs/workbench/contrib/files/browser/files.contribution.ts`
- `microsoft/vscode/src/vs/base/browser/ui/scrollbar/media/scrollbars.css`

### VS Code 的关键做法

| 主题 | VS Code 实现 | Pier 采用方式 |
|---|---|---|
| Tree primitive | `WorkbenchCompressibleAsyncDataTree`，object-based async tree | 使用 `@pierre/trees`，但在 Pier wrapper 补 lazy adapter |
| 数据源 | `ExplorerDataSource implements IAsyncDataSource` | `ProjectTreeService` + `PierFileTree.onLoadDirectory` |
| 懒加载 | `ExplorerItem._isDirectoryResolved=false`；展开时 `fetchChildren()` | 每个目录有 `unloaded/loading/loaded/dirty/error` state |
| 子节点解析 | `fileService.resolve(resource, { resolveSingleChildDescendants: true })` | `listChildren(path)` 只读 direct children；compact folders 由 wrapper 展示 |
| 旧状态保留 | `ExplorerItem.mergeLocalWithDisk()` 合并磁盘与本地 model | version + path map 合并；不让旧响应覆盖新状态 |
| loading 反馈 | async tree 超过 800ms 将 node 标记 `slow`，twistie 显示 loading icon | directory state = `loading` 时 row decoration/spinner |
| 文件事件 | `ExplorerService` 500ms debounce，判断事件是否影响已解析 model 后 refresh | watcher coalesce；只刷新 loaded affected directories |
| 搜索 | `ExplorerFindProvider` 调 search service，max results 512；未加载结果用 phantom items | 第一版 project search 返回 limited results；reveal 按 parent chain 加载；可借鉴 phantom item 但不先做完整搜索树 |
| 虚拟渲染 | `ListView` 只渲染 viewport rows | 依赖 `@pierre/trees` virtual rows；大目录仍需要 content list/table |
| compact folders | `explorer.compactFolders=true` 默认；screen reader 优化时关闭 | `flattenSingleChildDirectories=true` 默认；后续接 a11y mode 时关闭 |
| excludes | `files.exclude` 默认隐藏 `.git/.svn/.hg/.DS_Store/Thumbs.db` | 同步采用 |
| auto reveal | `explorer.autoReveal=true`；`autoRevealExclude` 默认 `node_modules/bower_components` | 同步采用，但只加载 parent chain，不展开大依赖树 |
| file nesting | `explorer.fileNesting.enabled=false` 默认，可按 patterns 折叠相关文件 | 第一版不做；避免配置与 UI 复杂度过早进入 |
| undo/redo | Explorer file operations 接 `BulkEditService` + undo/redo source | 第一版不做全局 undo；危险操作用 confirm，后续可加 operation journal |
| DnD | Explorer 内部拖拽、外部拖入、确认 | 第一版仅选择/打开/rename；DnD 后续进入 file-management phase |
| scrollbar | Monaco `ScrollableElement` 自绘 scrollbar + VS Code theme variables | 不引入 Monaco scrollbar；用 `@pierre/trees` Shadow DOM CSS variables 映射 Pier tokens |

### 关键差异

#### 1. VS Code 是 workbench 平台，Pier 是本地 AI workbench

VS Code Explorer 需要覆盖：

- local / remote / virtual file systems
- workspace folders 多 root
- web 端 file access
- decorations service
- editor service
- search service
- undo/redo service
- configuration service
- file nesting
- external drag/drop

Pier 第一版只需要：

- 本地 workspace root
- dockview panel 内文件树
- Git review tree
- 文件管理基础操作
- 多 agent 场景下的路径和变更可见性

因此 Pier 不应复制 VS Code 的 service graph；应复制它的核心模式：**async data source + resolved directory state + event coalescing + virtual rows + reveal parent chain**。

#### 2. VS Code tree 自带 async contract；`@pierre/trees` 当前是 path-first model

VS Code node 可以在没有 children 的时候仍知道 `hasChildren=true`，因此折叠箭头天然存在，展开时触发 async refresh。

`@pierre/trees` 第一版更适合“已有 paths 的 file tree”。Pier wrapper 需要补：

```text
directory activated
  -> if unloaded, load children
  -> add children paths
  -> expand directory
```

第一版 UX 要求：未加载但 `hasChildren=true | "unknown"` 的目录必须能显示 expandable state，并在 click / Enter / ArrowRight 时触发加载。当前 `@pierre/trees@1.0.0-beta.5` public API 不足以直接表达这个状态，因此 Project Files lazy expand 落地前要先完成 patch gate：

```ts
interface FileTreeDirectoryHint {
  readonly hasUnloadedChildren?: boolean;
  readonly loading?: boolean;
  readonly error?: string | null;
}

interface FileTreeExpansionEvent {
  readonly path: string;
  readonly expanded: boolean;
  readonly source: "pointer" | "keyboard" | "api";
}

interface FileTreeOptions {
  readonly directoryHints?: ReadonlyMap<string, FileTreeDirectoryHint>;
  readonly onDirectoryExpansionChange?: (event: FileTreeExpansionEvent) => void;
}

interface FileTree {
  setDirectoryHints(
    hints?: ReadonlyMap<string, FileTreeDirectoryHint>
  ): void;
}
```

Patch 只补 tree primitive 缺口。ProjectTreeService、IPC、权限、文件操作仍留在 Pier 层。

#### 3. VS Code 搜索可以依赖全局 SearchService；Pier 先做 reveal/search 的窄实现

VS Code Explorer find 会调用 SearchService，并为未加载结果创建 phantom items。Pier 第一版不需要完整搜索平台：

- tree 内搜索：只搜已加载 rows。
- project file search：返回有限结果，点击结果用 reveal parent chain 加载。
- Git Changes search：只搜 `GitStatus.files`。

后续若有全局搜索 service，再补 phantom item 模式。

#### 4. VS Code 文件操作有完整 undo/redo；Pier 第一版不做

VS Code 通过 bulk edit 和 undo/redo source 支撑 Explorer 操作回滚。Pier 第一版应保持简单：

- write 操作先走 confirm。
- 删除优先 trash，不直接 unlink。
- move/rename 成功后 patch tree。
- 失败时显示 toast，不伪造 UI 成功。

若后续文件管理变成核心重操作，再增加 operation journal 或 undo stack。

#### 5. Pier 需要同时服务 Git review 和 Project files

VS Code 的 Explorer 是文件系统树；Source Control view 另有自己的变更树。Pier 的差异是希望统一基础组件：

```text
Project Files Tree: data source = ProjectTreeService
Git Changes Tree: data source = GitStatus.files
Review Files Tree: data source = review session / patch files
```

共用：

- path grouping
- compact folders
- selection/focus/open
- decoration
- scrollbar/theming
- context menu shell
- keyboard behavior

不共用：

- data loading
- file operation semantics
- Git diff mode
- review metadata

## 大文件夹策略

### 目录状态机

```text
unloaded
  -> loading
  -> loaded
  -> dirty
  -> loading
  -> loaded

loading
  -> error
```

规则：

- `unloaded`：未读取 children。row 可点击，显示 muted `…` 或 folder badge。
- `loading`：正在读取 direct children。显示 spinner/Loading。
- `loaded`：children 已在 tree model 中。
- `dirty`：磁盘事件命中该目录，但当前缓存可能过期。
- `error`：读取失败，row 显示错误 decoration；允许 retry。

完整性不变量：

- 同一个 `sessionId + path` 同时只能有一个有效 loading generation；后发请求必须压过先发请求。
- directory state 不得只存在于 React 局部闭包；panel restore 后必须能从 session snapshot 重建。
- `entriesByPath` 与 `childrenByDirectory` 必须同源更新；禁止只更新 visible rows 导致 reveal/selection 查不到节点。
- 所有 async result 都必须校验 `sessionId`、`root`、`generation`，避免切换 worktree 后旧响应污染新 panel。
- `error` 状态保留原 selection，但不得继续显示已知陈旧 children 为“成功加载”。

### 超大 direct children

第一版处理：

- `listChildren` 可返回全部 direct children。
- renderer 只交给 virtual tree，不创建全部 DOM。
- main service 对读取和排序做 generation guard；旧结果丢弃。
- 单次返回 entries 很大时记录 duration 与 count，便于后续性能阈值调整。

第二阶段处理：

- `ProjectTreeListChildrenRequest.limit/cursor/sort` 生效。
- Directory Content List/Table 使用 cursor、filter、worker sort。
- tree 不引入 fake `Load more…` path。

### Symlink

第一版：

- `ProjectTreeEntry.kind = "symlink"` 映射为 `PierFileTreeItem.kind = "symlink"`，wrapper 按 file-like row 渲染，不添加 trailing slash，不显示 expand trigger。
- `ProjectTreeEntry.kind = "unknown"` 映射为 `PierFileTreeItem.kind = "unknown"`，wrapper 按 muted file-like row 渲染，并禁用默认 open。
- 不默认 traverse symlink directory；用户显式打开 symlink 时按 file service 的 resolve/open 策略处理。
- 展开 symlink directory 需要后续显式设计，不能复用普通 directory lazy expand。

## Git Review Tree 设计

### 分组

`GitFileStatus[]` 映射为 paths，再由 `PierFileTree` 自动派生目录：

```text
src/plugins/builtin/git/renderer/git-changes-panel.tsx
src/shared/contracts/git.ts
```

显示：

```text
src/
  plugins/
    builtin/
      git/
        renderer/
          git-changes-panel.tsx   M
  shared/
    contracts/
      git.ts                      M
```

### 状态 decoration

| porcelain | decoration |
|---|---|
| `index !== "." && index !== "?"` | staged badge |
| `worktree !== "." && worktree !== "?"` | modified badge |
| `index === "?"` 或 `worktree === "?"` | untracked badge |
| `index === "u"` 或 `worktree === "u"` | conflict badge |
| `origPath !== null` | rename/copy decoration |

### 点击行为

- Directory：toggle expand/collapse。
- File：打开 diff/content。
- Conflict：打开 conflict-focused diff state。
- Binary：显示 binary placeholder + action buttons。
- Untracked：显示 full file content 或 “new file” diff view。

### 与 stage/unstage/discard 的关系

Tree row 只表达 selection。写操作通过 context menu 或 toolbar：

- Stage selected paths。
- Unstage selected paths。
- Discard selected paths。
- Open file。
- Copy path。
- Reveal in Project Files。

写操作必须走 `gitPathsSchema` 的非空 paths 校验；不允许空数组 fallback 到全部文件。

## Scrollbar 与主题

Pier 不引入 Monaco scrollbar。原因：

- Pier 已有自己的 `--shell-scrollbar-*` tokens。
- `@pierre/trees` 使用 Shadow DOM 和 `unsafeCSS`，可以在 wrapper 内注入 tree 专用 CSS。
- 引入另一套 scrollbar engine 会增加维护面。

`PierFileTree` 应注入：

```css
[data-file-tree-virtualized-scroll="true"] {
  scrollbar-color: var(--shell-scrollbar-thumb) var(--shell-scrollbar-track);
  scrollbar-width: thin;
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar {
  width: var(--shell-scrollbar-width-legacy);
  height: var(--shell-scrollbar-width-legacy);
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb {
  background: var(--shell-scrollbar-thumb);
  border-radius: var(--shell-scrollbar-radius);
}
```

Wrapper 提供 escape hatch：

```ts
scrollbarPolicy?: "pier" | "native" | "hidden";
```

默认 `pier`。

## 测试策略

### UI wrapper tests

目标文件：

```text
tests/component/ui-file-tree.test.tsx
```

覆盖：

- file click 调 `onOpenPath(path)`。
- directory click / Enter / ArrowRight 在 unloaded 状态下调 `onLoadDirectory(path)`。
- `hasChildren: true | "unknown"` 且无 child path 时仍显示 expandable state；这是 `@pierre/trees` patch 的强制验收。
- `directoryStates` 更新时调用 patched `model.setDirectoryHints(...)` 或等价 runtime update surface，loading/error 状态不 stale。
- loading/error/empty state 渲染为 decoration，不产生 fake path。
- selected directory path 返回业务 path，不泄漏 trailing slash。
- decorations by item path and official path both resolve to same row。
- Git status badge 渲染不影响 selection。
- `symlink` / `unknown` 渲染为 file-like row，不显示 expand trigger，且 selection path 仍返回业务 path。
- `copied/conflict/staged/unstaged` 使用 Pier decorations；只有 `@pierre/trees` 支持的 GitStatusEntry subset 进入官方 git lane。
- large tree smoke：10k paths 渲染不创建 10k visible rows。

### Project tree service tests

目标文件：

```text
tests/unit/project-tree-service.test.ts
```

覆盖：

- `open` 只列 root direct children。
- `listChildren` 只列 direct children。
- `..`、绝对路径、root 外 symlink escape 被拒绝。
- hidden/exclude defaults 生效，`.git` 不进入 tree。
- loaded directory 收到 create/delete/rename/move watch event 后发出 `ProjectTreeWatchEvent`。
- unloaded directory 收到 watcher event 只 mark dirty，不主动扫描。
- `watch(request, listener)` dispose 后不再投递 event。
- `close(sessionId)` 清理 watcher/cache，并让旧 session result/event 被忽略。
- stale generation response ignored。
- reveal deep file only loads parent chain。

### File service mutation tests

目标文件：

```text
tests/unit/main/file-service.test.ts
```

覆盖：

- `writeText`、`rename`、`move`、`trash` 成功路径调用低级 FS，并返回 canonical path/newPath。
- 每个 mutation 拒绝 `..`、绝对路径逃逸、root 外 symlink escape。
- mutation 失败时返回/抛出可被 renderer 显示的错误，不更新 ProjectTreeService cache。
- case-only rename 在 macOS 返回 canonical `newPath`，供 Files panel 更新 selection。

### Files panel component tests

目标文件：

```text
tests/component/project-files-panel.test.tsx
```

覆盖：

- panel open 注册 `context.projectTree.watch({ sessionId }, listener)`。
- root change / unmount 先 dispose watch，再调用 `context.projectTree.close(sessionId)`。
- create/write 成功后刷新 target parent。
- rename 成功后选择 new path；case-only rename 使用 service 返回的 canonical path。
- move 成功后刷新 source parent 和 destination parent。
- trash/delete 成功后清理 selected/revealed path 并选择 parent 或 nearest sibling。
- mutation 失败时保留旧 rows/selection，显示错误，不伪造 UI 成功。

### Architecture gate tests

目标：

```text
dependency-cruiser.config.cjs
```

覆盖：

- `@pierre/trees` / `@pierre/trees/react` 只能从 `packages/ui/src/file-tree.tsx` 和明确测试夹具 import。
- Files plugin 进入写操作阶段时 manifest/panel capability 同时声明 `file:write`。

### Git changes panel tests

目标文件：

```text
tests/component/git-changes-plugin-panel.test.tsx
```

覆盖：

- `GitStatus.files` 渲染成 grouped tree。
- staged-only row 调 `getDiffPatch(..., { staged: true })`。
- unstaged row 调 `getDiffPatch(..., {})`。
- untracked row 不请求 HEAD content。
- rename row 显示 old/new path。
- watcher status snapshot 直接更新 tree，不额外 refetch。

### Manual QA

- 打开大 repo，Files panel 首屏只显示 root direct children。
- 展开 `src` 只加载 `src/*`。
- 展开 `node_modules` 不递归卡死。
- Git Changes panel 在有 staged/unstaged/untracked/conflict 时状态 badge 正确。
- 主题 light/dark 下 scrollbar、selection、focus ring 可见。
- dockview split/floating 后 tree layout 正确填满 panel。

## 风险

- `@pierre/trees@1.0.0-beta.5` 没有一等 async directory source。结论不是“用 selection/open 模拟即可”，而是 Project Files lazy expand 前必须 patch 或上游补 API。
- Patch 可能碰到 Shadow DOM、virtual row、keyboard navigation 的内部耦合；风险控制是最小 API、`model.setDirectoryHints(...)` 运行时更新入口、组件测试覆盖 pointer/keyboard/a11y，不碰 Pier 业务类型。
- 大 direct-children 目录的 IPC payload 可能很大；第一版通过 direct children + virtual rows 避免 DOM 卡死，但 100k+ entries 的排序和传输仍需后续 directory list/table 分担。
- Git Changes Tree 与 Project Files Tree 数据源不同，不能共享 service，只能共享 UI wrapper 与 path grouping。
- Plugin API 已暴露 Git review 主路径；后续新增 Git row action 时必须继续走 `RendererPluginContext.git`，避免回退到 `window.pier.git` 破坏 capability 边界。
- 文件写操作必须先补权限和确认路径，不能因为树 UI 先完成就允许无保护 delete/move。

## 推荐实施顺序

1. Patch gate：验证 `@pierre/trees` 是否支持 unloaded expandable directory；不支持则用 `pnpm patch` 增加 directory hints + runtime `setDirectoryHints` + expansion event，并加 UI wrapper regression tests。
2. `packages/ui/PierFileTree` wrapper：收敛 path normalization、directoryStates、selection/open、decoration、scrollbar，不让业务 panel import `@pierre/trees`。
3. Git Changes panel 收尾：当前 worktree 已有树化实现，补齐 Git action context menu / diff preview 宿主时继续复用 wrapper。
4. Project tree contracts + service + preload：建立 session、lazy direct-children、watch event subscription、close cleanup、reveal、generation guard。
5. Files plugin panel：用同一个 `PierFileTree` 消费 ProjectTreeService，并接文件操作 refresh flow；写操作阶段同步补 `file:write` capability。
6. Directory Content List/Table：只在大目录文件管理需求进入时实现，不把分页塞进 tree fake path。

## Spec 自检

- 范围覆盖：Project Files、Git Changes、Review Files 的共享与差异均已定义。
- VS Code 对比：已覆盖 async tree、resolved directory state、watch debounce、search phantom results、virtual list、compact folders、excludes、auto reveal、scrollbar、undo/DnD 差异。
- 架构边界：业务 panel 不直接 import `@pierre/trees` 或 dockview；main/preload/renderer 合同分层明确。
- 大文件夹：已明确 direct children lazy load、tree/list 分工、cursor 预留和 fake path 禁止。
- 无占位项：本文不含未决占位实现要求；未进入第一版的能力均列为明确非目标或阶段顺序。
- Worktree 归属：本文位于 `/Users/dev/Xyz/pier-file-tree-plugins` 子 worktree，不在主仓交付。
- Patch gate：已明确 `@pierre/trees` 不支持 unloaded expandable directory 时必须 patch，且 patch 必须含 runtime directory-hints update surface；上游 primitive 缺口不得由递归扫描或 fake path 绕过。
- 功能闭环：已覆盖初始加载、目录展开、watch event subscription、session close、reveal、file-service mutation、Files panel refresh、watch stale guard、Git diff/content 打开、测试验收。
