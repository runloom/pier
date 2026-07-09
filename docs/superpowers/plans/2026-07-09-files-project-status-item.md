# Files 终端状态栏「当前项目」入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pier.files` 在终端状态栏贡献 `pier.files.project`：展示当前项目根并点击打开 Files 树（锚定项目根，不对齐 shell cwd）。

**Architecture:** 纯函数解析项目锚点与路径展示；`openProjectFiles` 复用/打开无 `source` 的 Files 实例并展开树；状态项组件形态对齐 `pier.worktree.status`，经 manifest + `terminalStatusItems.register` 接入现有合并管道。

**Tech Stack:** React 19、TypeScript strict、`@pier/ui` Button、Vitest 4、现有 plugin terminalStatusItems / panels.openInstance / files-tree-registry。

**配套设计：** `docs/superpowers/specs/2026-07-09-files-project-status-item-design.md`

## Global Constraints

- 展示与打开锚定**项目根**，不随 shell `cd` 变化。
- 归属 `pier.files`，不做 core 状态项、不新建 header 池。
- 用户可见文案全部走插件 i18n；失败用 `notifications.error`，成功不加 toast。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 默认 git 只读：本计划步骤含 commit 时，执行前先向用户确认；未确认则只改文件不提交。

---

## 文件结构

**新建**

- `src/plugins/builtin/files/renderer/files-project-anchor.ts`：`projectAnchor` + `formatProjectPath` 纯函数。
- `src/plugins/builtin/files/renderer/files-open-project.ts`：`openProjectFiles`（打开/复用 Files + 展开树 + reveal 根）。
- `src/plugins/builtin/files/renderer/files-project-status-item.tsx`：状态项 UI + `registerFilesProjectStatusItem`。
- `tests/unit/renderer/files-project-anchor.test.ts`
- `tests/unit/renderer/files-open-project.test.ts`
- `tests/unit/renderer/files-project-status-item.test.tsx`

**修改**

- `src/plugins/builtin/files/manifest.ts`：声明 `terminalStatusItems` + 导出 id 常量。
- `src/plugins/builtin/files/locales/en.json` / `zh-CN.json`：`terminalStatusItems` + 打开失败文案。
- `src/plugins/builtin/files/renderer/file-tree-preferences.ts`：导出 `ensureProjectFileTreeExpanded`。
- `src/plugins/builtin/files/renderer/index.tsx`：activate 注册状态项。

---

### Task 1: 项目锚点与路径折叠纯函数

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-project-anchor.ts`
- Test: `tests/unit/renderer/files-project-anchor.test.ts`

**Interfaces:**
- Produces:
  - `projectAnchor(context: PanelContext | undefined): string | null`
  - `formatProjectPath(path: string, homeDirectory?: string | null): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  formatProjectPath,
  projectAnchor,
} from "../../../src/plugins/builtin/files/renderer/files-project-anchor.ts";

function ctx(partial: Partial<PanelContext> & Pick<PanelContext, "contextId" | "projectRootPath" | "updatedAt">): PanelContext {
  return partial;
}

describe("projectAnchor", () => {
  it("returns null when context is missing", () => {
    expect(projectAnchor(undefined)).toBeNull();
  });

  it("prefers projectRootPath over worktree/git/cwd", () => {
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "/repo",
          updatedAt: 1,
          worktreeRoot: "/repo-wt",
          gitRoot: "/repo-git",
          cwd: "/repo/src",
        })
      )
    ).toBe("/repo");
  });

  it("falls back worktreeRoot → gitRoot → cwd when projectRootPath is empty", () => {
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          worktreeRoot: "/wt",
        })
      )
    ).toBe("/wt");
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          gitRoot: "/git",
        })
      )
    ).toBe("/git");
    expect(
      projectAnchor(
        ctx({
          contextId: "c",
          projectRootPath: "",
          updatedAt: 1,
          cwd: "/cwd",
        })
      )
    ).toBe("/cwd");
  });
});

describe("formatProjectPath", () => {
  it("returns absolute path when home is null", () => {
    expect(formatProjectPath("/Users/a/proj", null)).toBe("/Users/a/proj");
  });

  it("folds home to ~", () => {
    expect(formatProjectPath("/Users/a", "/Users/a")).toBe("~");
    expect(formatProjectPath("/Users/a/proj", "/Users/a")).toBe("~/proj");
  });

  it("strips trailing separators before compare", () => {
    expect(formatProjectPath("/Users/a/proj/", "/Users/a/")).toBe("~/proj");
  });
});
```

修正「fallback」用例为不依赖非法 `projectRootPath: undefined`：用类型断言构造仅含 `worktreeRoot` / `gitRoot` / `cwd` 的对象，或在实现里对 `projectRootPath` 做空串忽略。推荐实现：

```ts
function nonEmpty(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}
```

优先级：`projectRootPath` → `worktreeRoot` → `gitRoot` → `cwd`（与 spec 一致；**不要**用 `openedPath`，避免与 `filePanelProjectRoot` 在「打开文件路径」场景分叉——本状态项只要项目根）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/files-project-anchor.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`src/plugins/builtin/files/renderer/files-project-anchor.ts`:

```ts
import type { PanelContext } from "@shared/contracts/panel.ts";

function nonEmpty(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export function projectAnchor(
  context: PanelContext | undefined
): string | null {
  if (!context) {
    return null;
  }
  return (
    nonEmpty(context.projectRootPath) ??
    nonEmpty(context.worktreeRoot) ??
    nonEmpty(context.gitRoot) ??
    nonEmpty(context.cwd)
  );
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "") || value;
}

export function formatProjectPath(
  path: string,
  homeDirectory: string | null = null
): string {
  const normalized = stripTrailingSeparators(path);
  const home = homeDirectory ? stripTrailingSeparators(homeDirectory) : null;
  if (!(home && home !== "/" && home !== "\\")) {
    return normalized;
  }
  if (normalized === home) {
    return "~";
  }
  if (normalized.startsWith(`${home}/`)) {
    return `~/${normalized.slice(home.length + 1)}`;
  }
  if (normalized.startsWith(`${home}\\`)) {
    return `~/${normalized.slice(home.length + 1).replace(/\\/g, "/")}`;
  }
  return normalized;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/files-project-anchor.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/files-project-anchor.ts tests/unit/renderer/files-project-anchor.test.ts
git commit -m "$(cat <<'EOF'
feat(files): add project anchor and path fold helpers

Pure helpers for the terminal project status item display and open target.
EOF
)"
```

---

### Task 2: `openProjectFiles` 打开/复用 Files 并展开树

**Files:**
- Modify: `src/plugins/builtin/files/renderer/file-tree-preferences.ts`
- Create: `src/plugins/builtin/files/renderer/files-open-project.ts`
- Test: `tests/unit/renderer/files-open-project.test.ts`

**Interfaces:**
- Consumes: `projectAnchor`；`revealFilesTreePath` / `findFilesTreeInstanceId`；`FILES_FILE_PANEL_ID`；`panels.openInstance` / `listInstances`
- Produces:
  - `ensureProjectFileTreeExpanded(root: string): void`
  - `openProjectFiles(pluginContext, panelContext): { ok: true } | { ok: false; reason: "no-anchor" | "open-failed" }`
  - `createProjectFilesInstanceId(root: string): string`（稳定空面板 id）

打开策略（锁定）：

1. `anchor = projectAnchor(panelContext)`；无则 `{ ok: false, reason: "no-anchor" }`。
2. `listInstances(FILES_FILE_PANEL_ID)`，找 `projectAnchor(instance.params.context) === anchor` 的已有实例（params.context 经 `panelContextSchema.safeParse`）。
3. 若有：`openInstance` 同 `instanceId`，带上 `context: panelContext`，保留已有 `params`（含 source），只激活/聚焦。
4. 若无：`openInstance` 新实例，`instanceId = pier.files.filePanel:project:${hash(anchor)}`，`params: {}`（无 source → empty + 树），`title = projectNameFromRoot(anchor)`，`context: panelContext`。
5. `ensureProjectFileTreeExpanded(anchor)`（写 localStorage collapsed=false）。
6. `setTimeout(80ms)` 后 `revealFilesTreePath({ root: anchor, path: "" })` 或 path=`anchor` 的相对空——树 API 对根用 `""` 或 `"."`；若 `revealPath("")` 无效则 reveal 根目录名。以现有 `PierFileTree.revealPath` 行为为准：对项目根传 `""`；若测试/运行无效，改为不传 reveal、仅展开树（仍算达标「打开到项目根」）。
7. `openInstance` 抛错 → catch → `{ ok: false, reason: "open-failed" }`。

- [ ] **Step 1: Export tree expand helper**

在 `file-tree-preferences.ts` 增加：

```ts
export function ensureProjectFileTreeExpanded(root: string): void {
  writeTreeCollapsed(root, false);
}
```

- [ ] **Step 2: Write the failing openProjectFiles tests**

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../../../src/plugins/builtin/files/manifest.ts";
import { openProjectFiles } from "../../../src/plugins/builtin/files/renderer/files-open-project.ts";
import * as treeRegistry from "../../../src/plugins/builtin/files/renderer/files-tree-registry.ts";
import * as prefs from "../../../src/plugins/builtin/files/renderer/file-tree-preferences.ts";

const baseContext: PanelContext = {
  contextId: "ctx:1",
  projectRootPath: "/Users/a/proj",
  updatedAt: 1,
  cwd: "/Users/a/proj/src",
};

function makePlugin(overrides?: {
  listInstances?: PluginPanelInstance[];
  openInstance?: ReturnType<typeof vi.fn>;
}): RendererPluginContext {
  // 最小 mock：panels.listInstances / openInstance；其余用 vi.fn
}

describe("openProjectFiles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no-anchor when context lacks project fields", () => {
    const plugin = makePlugin();
    expect(
      openProjectFiles(plugin, {
        contextId: "x",
        projectRootPath: "",
        updatedAt: 1,
      } as PanelContext)
    ).toEqual({ ok: false, reason: "no-anchor" });
  });

  it("opens a new empty files instance for the project root", () => {
    const openInstance = vi.fn();
    const plugin = makePlugin({ listInstances: [], openInstance });
    const expand = vi.spyOn(prefs, "ensureProjectFileTreeExpanded");
    expect(openProjectFiles(plugin, baseContext)).toEqual({ ok: true });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        context: baseContext,
        params: {},
      })
    );
    expect(expand).toHaveBeenCalledWith("/Users/a/proj");
  });

  it("reuses an existing instance for the same project anchor", () => {
    const openInstance = vi.fn();
    const plugin = makePlugin({
      listInstances: [
        {
          id: "existing-id",
          componentId: FILES_FILE_PANEL_ID,
          groupId: "g1",
          title: "proj",
          params: { context: baseContext, source: { kind: "disk", path: "a.ts", root: "/Users/a/proj" } },
        },
      ],
      openInstance,
    });
    openProjectFiles(plugin, baseContext);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: "existing-id" })
    );
  });

  it("schedules reveal after open", () => {
    const reveal = vi.spyOn(treeRegistry, "revealFilesTreePath").mockReturnValue(true);
    const plugin = makePlugin({ listInstances: [], openInstance: vi.fn() });
    openProjectFiles(plugin, baseContext);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/Users/a/proj" })
    );
  });
});
```

（按仓库现有 mock 风格补全 `makePlugin`；可参考 `tests/unit/renderer/files-tree-create.test.ts`。）

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/files-open-project.test.ts`

Expected: FAIL

- [ ] **Step 4: Implement `files-open-project.ts`**

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { panelContextSchema } from "@shared/contracts/panel.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { projectNameFromRoot, ensureProjectFileTreeExpanded } from "./file-tree-preferences.ts";
import { projectAnchor } from "./files-project-anchor.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";

const REVEAL_DELAY_MS = 80;

export function createProjectFilesInstanceId(root: string): string {
  return `${FILES_FILE_PANEL_ID}:project:${stableFileIdentityHash(root)}`;
}

function contextFromParams(params: unknown): PanelContext | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const parsed = panelContextSchema.safeParse(
    (params as { context: unknown }).context
  );
  return parsed.success ? parsed.data : undefined;
}

export function openProjectFiles(
  pluginContext: RendererPluginContext,
  panelContext: PanelContext
): { ok: true } | { ok: false; reason: "no-anchor" | "open-failed" } {
  const anchor = projectAnchor(panelContext);
  if (!anchor) {
    return { ok: false, reason: "no-anchor" };
  }

  try {
    const instances = pluginContext.panels.listInstances(FILES_FILE_PANEL_ID);
    const existing = instances.find(
      (instance) => projectAnchor(contextFromParams(instance.params)) === anchor
    );

    if (existing) {
      pluginContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        instanceId: existing.id,
        params: existing.params ? { ...existing.params } : {},
        title: existing.title,
        ...(existing.groupId ? { targetGroupId: existing.groupId } : {}),
      });
    } else {
      pluginContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        instanceId: createProjectFilesInstanceId(anchor),
        params: {},
        title: projectNameFromRoot(anchor),
      });
    }

    ensureProjectFileTreeExpanded(anchor);
    globalThis.setTimeout(() => {
      revealFilesTreePath({ path: "", root: anchor });
    }, REVEAL_DELAY_MS);

    return { ok: true };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}
```

若 `projectNameFromRoot` / `ensureProjectFileTreeExpanded` 导出路径需微调，以编译为准。

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/unit/renderer/files-open-project.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/file-tree-preferences.ts \
  src/plugins/builtin/files/renderer/files-open-project.ts \
  tests/unit/renderer/files-open-project.test.ts
git commit -m "$(cat <<'EOF'
feat(files): open project Files panel from status item helper

Reuse same-project instances, expand the tree, and reveal the project root.
EOF
)"
```

---

### Task 3: Manifest、i18n 与状态项 UI 注册

**Files:**
- Modify: `src/plugins/builtin/files/manifest.ts`
- Modify: `src/plugins/builtin/files/locales/en.json`
- Modify: `src/plugins/builtin/files/locales/zh-CN.json`
- Create: `src/plugins/builtin/files/renderer/files-project-status-item.tsx`
- Modify: `src/plugins/builtin/files/renderer/index.tsx`
- Test: `tests/unit/renderer/files-project-status-item.test.tsx`

**Interfaces:**
- Consumes: `projectAnchor` / `formatProjectPath` / `openProjectFiles`
- Produces: `FILES_PROJECT_STATUS_ITEM_ID = "pier.files.project"`；`registerFilesProjectStatusItem(context): () => void`

- [ ] **Step 1: Manifest + locale**

`manifest.ts` 增加：

```ts
export const FILES_PROJECT_STATUS_ITEM_ID = "pier.files.project";
```

`terminalStatusItems` 改为：

```ts
terminalStatusItems: [
  {
    alignment: "right",
    id: FILES_PROJECT_STATUS_ITEM_ID,
    order: 9,
    permissions: ["panel:open", "file:read"],
    title: "Project",
  },
],
```

`en.json` 增加顶层（与 git 插件同级结构）：

```json
"terminalStatusItems": {
  "pier.files.project": {
    "title": "Project",
    "description": "Shows the current project and opens its file tree."
  }
}
```

`messages` 增加：

```json
"files.projectStatus.openLabel": "Open project files",
"files.projectStatus.openTooltip": "Open project files",
"files.projectStatus.openFailed": "Unable to open project files"
```

`zh-CN.json` 对应：

```json
"terminalStatusItems": {
  "pier.files.project": {
    "title": "项目",
    "description": "显示当前项目并打开其文件树。"
  }
}
```

```json
"files.projectStatus.openLabel": "打开项目文件",
"files.projectStatus.openTooltip": "打开项目文件",
"files.projectStatus.openFailed": "无法打开项目文件"
```

- [ ] **Step 2: Write status item tests**

覆盖：

1. `isVisible` / render：无锚点 → register 的 `isVisible` 为 false；有 `projectRootPath` → true。
2. 点击调用 `openProjectFiles`；失败时 `notifications.error`。
3. 按钮 `data-testid="files-project-status-trigger"` 存在；主文案为 `formatProjectPath(anchor)`（home=null → 绝对路径）。

可用 `vi.mock("./files-open-project.ts")`。注册后从 registry 取 item 较重时，改为直接测导出的 `FilesProjectStatusItem` 组件 + 单独测 `isVisible` 函数（若抽出 `isFilesProjectStatusVisible`）。

推荐抽出：

```ts
export function isFilesProjectStatusVisible(
  statusContext: RendererTerminalStatusItemContext
): boolean {
  return projectAnchor(statusContext.context) != null;
}
```

- [ ] **Step 3: Implement status item**

`files-project-status-item.tsx`（对齐 git 触发器）：

```tsx
import { Button } from "@pier/ui/button.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { Folder } from "lucide-react";
import { FILES_PROJECT_STATUS_ITEM_ID } from "../manifest.ts";
import {
  formatProjectPath,
  projectAnchor,
} from "./files-project-anchor.ts";
import { openProjectFiles } from "./files-open-project.ts";

export function isFilesProjectStatusVisible(
  statusContext: RendererTerminalStatusItemContext
): boolean {
  return projectAnchor(statusContext.context) != null;
}

function FilesProjectStatusItem({
  pluginContext,
  ...statusContext
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const anchor = projectAnchor(statusContext.context);
  if (!anchor || !statusContext.context) {
    return null;
  }
  const label = formatProjectPath(anchor, null);
  const t = (key: string, fallback: string) =>
    pluginContext.i18n.t(key, undefined, fallback);
  const openLabel = t("files.projectStatus.openLabel", "Open project files");
  const openTooltip = t(
    "files.projectStatus.openTooltip",
    "Open project files"
  );

  return (
    <Button
      aria-label={openLabel}
      className="h-5 min-w-0 max-w-56 gap-1 px-2 font-normal text-xs"
      data-testid="files-project-status-trigger"
      onClick={() => {
        const result = openProjectFiles(
          pluginContext,
          statusContext.context as NonNullable<typeof statusContext.context>
        );
        if (!result.ok) {
          pluginContext.notifications.error(
            t(
              "files.projectStatus.openFailed",
              "Unable to open project files"
            )
          );
        }
      }}
      size="xs"
      title={`${openTooltip}\n${anchor}`}
      type="button"
      variant="outline"
    >
      <Folder className="size-3 shrink-0 opacity-70" aria-hidden="true" />
      <span className="min-w-0 truncate" dir="rtl">
        <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
          {label}
        </span>
      </span>
    </Button>
  );
}

export function registerFilesProjectStatusItem(
  context: RendererPluginContext
): () => void {
  return context.terminalStatusItems.register({
    id: FILES_PROJECT_STATUS_ITEM_ID,
    isVisible: isFilesProjectStatusVisible,
    render: (statusContext) => (
      <FilesProjectStatusItem {...statusContext} pluginContext={context} />
    ),
  });
}
```

避免 `as NonNullable`：在 `onClick` 前已 guard `statusContext.context`，把 `const panelContext = statusContext.context` 收窄后传入。

- [ ] **Step 4: Wire activate**

`index.tsx` 的 `disposers` 增加：

```ts
registerFilesProjectStatusItem(context),
```

- [ ] **Step 5: Run tests**

```bash
pnpm exec vitest run tests/unit/renderer/files-project-status-item.test.tsx tests/unit/renderer/files-project-anchor.test.ts tests/unit/renderer/files-open-project.test.ts
```

Expected: PASS

- [ ] **Step 6: Lint / typecheck touched files**

```bash
pnpm exec biome check src/plugins/builtin/files/manifest.ts \
  src/plugins/builtin/files/renderer/files-project-anchor.ts \
  src/plugins/builtin/files/renderer/files-open-project.ts \
  src/plugins/builtin/files/renderer/files-project-status-item.tsx \
  src/plugins/builtin/files/renderer/file-tree-preferences.ts \
  src/plugins/builtin/files/renderer/index.tsx
pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | head -40
```

（若全量 tsc 过慢，至少保证改动文件无新增诊断。）

- [ ] **Step 7: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/manifest.ts \
  src/plugins/builtin/files/locales/en.json \
  src/plugins/builtin/files/locales/zh-CN.json \
  src/plugins/builtin/files/renderer/files-project-status-item.tsx \
  src/plugins/builtin/files/renderer/index.tsx \
  tests/unit/renderer/files-project-status-item.test.tsx
git commit -m "$(cat <<'EOF'
feat(files): add terminal project status item

Contribute pier.files.project on the right status bar to open the
current project file tree, matching Git item contribution patterns.
EOF
)"
```

---

## Spec coverage（self-review）

| Spec 要求 | Task |
|---|---|
| `pier.files.project` manifest + order 9 right | Task 3 |
| `projectAnchor` 优先级 / 无锚点隐藏 | Task 1 + 3 |
| `~/` 折叠（无 home → 绝对路径） | Task 1 + 3（home=null） |
| 点击打开 Files、项目根、复用实例 | Task 2 |
| 展开树 + reveal | Task 2 |
| 失败 notifications.error，成功无 toast | Task 3 |
| 不随 shell cwd 变文案 | Task 1/3 只用 anchor，不用 statusContext.cwd 主文案 |
| 非 Git 仍显示 | Task 1 fallback 到 cwd |
| 设置页/右键自动出现 | Task 3 manifest 声明（现有合并管道） |
| 测试锚点/折叠/打开/注册 | Task 1–3 |

**有意不做（spec 非目标）：** shell cwd 指示器、header 池、core 项、编辑器 status bar。
