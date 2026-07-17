# Files 编辑器 Git 变更条（Gutter）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pier.files` 的 CodeMirror 源码编辑器在行号旁显示相对 HEAD 的磁盘变更条（新增/修改/删除）。

**Architecture:** 纯函数把 `GitDiffFilePatch` 映射成行号→kind 的 Map；CodeMirror 自定义窄 gutter + `GutterMarker` 经 `StateField`/`StateEffect` 渲染色条；编排类 `FilesEditorGitGutterController` 负责 `getDiffPatch` 拉取、`git.watch` 订阅、防抖与 generation 竞态，接到 `FileEditorController` 的 attach/detach/save 钩子。

**Tech Stack:** CodeMirror 6（`@codemirror/view` `gutter`/`GutterMarker`/`RangeSetBuilder`、`@codemirror/state` `StateField`/`StateEffect`/`Compartment`）、TypeScript strict、Vitest 4、现有 `context.git.getDiffPatch` / `context.git.watch` facade。

**配套设计：** `docs/superpowers/specs/2026-07-17-files-editor-git-gutter-design.md`

## Global Constraints

- 基准：磁盘相对 HEAD（`getDiffPatch(cwd, { from: "HEAD", path })`，含 stage+unstaged）；**不**纳入未保存缓冲。
- 仅 `document.source.kind === "disk"` + `mode === "source"` 启用；untitled / preview / rich / diff 模式不挂。
- 颜色只用语义 token：added→`var(--status-success-fg)`、modified→`var(--status-info-fg)`、deleted→`var(--status-danger-fg)`；禁止硬编码 hex/rgb/hsl/oklch/Tailwind 色阶。
- 失败静默清空（不 toast、不面向用户 `console.error`）；非 git / binary / 空 patch → 空 gutter。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- Git 默认只读：本计划步骤含 commit 时，执行前先向用户确认；未确认则只改文件不提交。
- 单文件 ≤ 500 行（仓库 file-size 治理）。`FileEditorController` 已 438 行，编排逻辑**必须**放在独立类，控制器只新增薄委托。

---

## 文件结构

**新建**

- `src/plugins/builtin/files/renderer/files-editor-git-markers.ts`：纯函数 `markersFromDiffPatch` + `GitGutterKind` 类型。
- `src/plugins/builtin/files/renderer/files-editor-git-gutter.ts`：CodeMirror 扩展 `createGitGutterExtension()` + `setGitGutterMarkers(view, markers)` + theme。
- `src/plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts`：编排类 `FilesEditorGitGutterController`（拉取 / watch / 防抖 / generation / 路径解析）。
- `tests/unit/renderer/files-editor-git-markers.test.ts`
- `tests/unit/renderer/files-editor-git-gutter-controller.test.ts`

**修改**

- `src/plugins/builtin/files/renderer/file-editor-view-session.ts`：加 `setGitGutterMarkers` / `clearGitGutterMarkers`；`#extensions` 挂初始空 gutter。
- `src/plugins/builtin/files/renderer/file-editor-controller.ts`：新增 `#gitGutter: FilesEditorGitGutterController`；`attachView`/`detachView`/`saveDocument`/`settleDocument`/`dispose` 加薄委托。
- `src/plugins/builtin/files/renderer/file-panel-body.tsx`：`ResolvedFilePanel` 在 mode/source 变化时调 `controller.refreshGitGutter`（mode 非源码时清空）。

---

### Task 1: Hunk → 行标记纯函数

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-editor-git-markers.ts`
- Test: `tests/unit/renderer/files-editor-git-markers.test.ts`

**Interfaces:**
- Produces:
  - `type GitGutterKind = "added" | "modified" | "deleted"`
  - `markersFromDiffPatch(patch: GitDiffFilePatch | null): ReadonlyMap<number, GitGutterKind>`（1-based 行号，磁盘新文件侧）

**行映射规则（实现须与测试锁定）：**

1. 遍历 `patch.hunks`，每 hunk 维护 `newLine = hunk.newStart`。
2. 按 `lines` 顺序分组：连续 `del` 后接连续 `add`。
   - 配对数 `m = min(delCount, addCount)`：前 `m` 个 add 行标 `modified`（`newLine` 递增）。
   - 剩余 `addCount - m` 个 add 行标 `added`。
   - 纯 `del`（`delCount > addCount` 的溢出部分）：在**删除块结束后的下一行 new 位置**标 `deleted`（删除发生在该行上方）；若删除直达 hunk 末尾无后续 new 行，锚在**最后一个出现过的 new 行**；若整个 hunk 无任何 new 侧行（纯删整 hunk 且无 context/add），锚在 `hunk.newStart`。
3. `context`：`newLine++`，不标记。
4. 同一行多规则优先级：`modified` > `added` > `deleted`。
5. `patch === null` 或 `patch.binary`：返回空 Map。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/files-editor-git-markers.test.ts
import { markersFromDiffPatch } from "@plugins/builtin/files/renderer/files-editor-git-markers.ts";
import type { GitDiffFilePatch } from "@shared/contracts/git.ts";
import { describe, expect, it } from "vitest";

function patch(hunks: GitDiffFilePatch["hunks"]): GitDiffFilePatch {
  return { binary: false, hunks, oldPath: "a", path: "a" };
}

function hunk(
  lines: { kind: "add" | "context" | "del"; text: string }[],
  newStart: number
): GitDiffFilePatch["hunks"][number] {
  return {
    lines,
    newLines: lines.filter((l) => l.kind !== "del").length,
    newStart,
    oldLines: lines.filter((l) => l.kind !== "add").length,
    oldStart: newStart,
  };
}

describe("markersFromDiffPatch", () => {
  it("returns empty for null patch", () => {
    expect(markersFromDiffPatch(null).size).toBe(0);
  });

  it("returns empty for binary patch", () => {
    expect(
      markersFromDiffPatch({ binary: true, hunks: [], oldPath: null, path: "a" }).size
    ).toBe(0);
  });

  it("marks pure additions as added", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "add", text: "b" },
            { kind: "add", text: "c" },
            { kind: "context", text: "d" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, "added"],
      [3, "added"],
    ]);
  });

  it("marks del+add pairing as modified", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "old1" },
            { kind: "del", text: "old2" },
            { kind: "add", text: "new1" },
            { kind: "add", text: "new2" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, "modified"],
      [3, "modified"],
    ]);
  });

  it("marks del>add overflow as modified+added, pure-del remainder as deleted on next line", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
            { kind: "del", text: "o3" },
            { kind: "add", text: "n1" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, "modified"],
      [3, "deleted"],
    ]);
  });

  it("anchors pure deletion at hunk end on last new line when no trailing new line", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "context", text: "b" },
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[2, "deleted"]]);
  });

  it("anchors del-only hunk with no new lines at newStart", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
          ],
          5
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[5, "deleted"]]);
  });

  it("merges multiple hunks independently", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk([{ kind: "add", text: "x" }], 1),
        hunk(
          [
            { kind: "del", text: "y" },
            { kind: "context", text: "z" },
          ],
          10
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [1, "added"],
      [10, "deleted"],
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-git-markers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/plugins/builtin/files/renderer/files-editor-git-markers.ts
import type { GitDiffFilePatch } from "@shared/contracts/git.ts";

export type GitGutterKind = "added" | "modified" | "deleted";

const PRIORITY: Record<GitGutterKind, number> = {
  modified: 3,
  added: 2,
  deleted: 1,
};

function setMarker(
  markers: Map<number, GitGutterKind>,
  line: number,
  kind: GitGutterKind
): void {
  const existing = markers.get(line);
  if (!existing || PRIORITY[kind] > PRIORITY[existing]) {
    markers.set(line, kind);
  }
}

export function markersFromDiffPatch(
  patch: GitDiffFilePatch | null
): ReadonlyMap<number, GitGutterKind> {
  const markers = new Map<number, GitGutterKind>();
  if (!patch || patch.binary) {
    return markers;
  }
  for (const hunk of patch.hunks) {
    let newLine = hunk.newStart;
    let lastNewLine = hunk.newStart;
    let sawNewLine = false;
    let i = 0;
    while (i < hunk.lines.length) {
      const line = hunk.lines[i];
      if (line.kind === "context") {
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
        i += 1;
        continue;
      }
      if (line.kind === "add") {
        let j = i;
        while (j < hunk.lines.length && hunk.lines[j].kind === "add") j += 1;
        const addCount = j - i;
        for (let k = 0; k < addCount; k += 1) {
          setMarker(markers, newLine, "added");
          lastNewLine = newLine;
          sawNewLine = true;
          newLine += 1;
        }
        i = j;
        continue;
      }
      // del 块
      let j = i;
      while (j < hunk.lines.length && hunk.lines[j].kind === "del") j += 1;
      const delCount = j - i;
      let addCount = 0;
      let k = j;
      while (k < hunk.lines.length && hunk.lines[k].kind === "add") {
        addCount += 1;
        k += 1;
      }
      const modifiedCount = Math.min(delCount, addCount);
      for (let m = 0; m < modifiedCount; m += 1) {
        setMarker(markers, newLine, "modified");
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
      }
      const addedRemainder = addCount - modifiedCount;
      for (let m = 0; m < addedRemainder; m += 1) {
        setMarker(markers, newLine, "added");
        lastNewLine = newLine;
        sawNewLine = true;
        newLine += 1;
      }
      const pureDel = delCount - modifiedCount;
      if (pureDel > 0) {
        if (k < hunk.lines.length) {
          setMarker(markers, newLine, "deleted");
        } else if (sawNewLine) {
          setMarker(markers, lastNewLine, "deleted");
        } else {
          setMarker(markers, hunk.newStart, "deleted");
        }
      }
      i = k;
    }
  }
  return markers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-git-markers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/files-editor-git-markers.ts tests/unit/renderer/files-editor-git-markers.test.ts
git commit -m "$(cat <<'EOF'
feat(files): add hunk-to-git-gutter marker mapping

Pure function mapping GitDiffFilePatch hunks to line→kind markers for
the editor git change gutter.
EOF
)"
```

---

### Task 2: CodeMirror Git Gutter 扩展

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-editor-git-gutter.ts`

**Interfaces:**
- Consumes: `GitGutterKind` from Task 1
- Produces:
  - `createGitGutterExtension(): Extension`
  - `setGitGutterMarkers(view: EditorView, markers: ReadonlyMap<number, GitGutterKind>): void`
  - `clearGitGutterMarkers(view: EditorView): void`

- [ ] **Step 1: Write the implementation**

```ts
// src/plugins/builtin/files/renderer/files-editor-git-gutter.ts
import { gutter, GutterMarker, type Extension } from "@codemirror/view";
import { EditorView } from "codemirror";
import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { GitGutterKind } from "./files-editor-git-markers.ts";

const setGitGutterMarkersEffect = StateEffect.define<RangeSet<GutterMarker>>();

class GitGutterMarker extends GutterMarker {
  constructor(readonly kind: GitGutterKind) {
    super();
  }
  override eq(other: GitGutterMarker): boolean {
    return this.kind === other.kind;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-gitGutter-bar cm-gitGutter-${this.kind}`;
    return el;
  }
}

class EmptyGutterMarker extends GutterMarker {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-gitGutter-bar cm-gitGutter-spacer";
    return el;
  }
}

const ADDED = new GitGutterMarker("added");
const MODIFIED = new GitGutterMarker("modified");
const DELETED = new GitGutterMarker("deleted");
const SPACER = new EmptyGutterMarker();

function markerFor(kind: GitGutterKind): GitGutterMarker {
  return kind === "added" ? ADDED : kind === "modified" ? MODIFIED : DELETED;
}

const gitGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setGitGutterMarkersEffect)) {
        return e.value;
      }
    }
    return value;
  },
});

function buildGutterRangeSet(
  markers: ReadonlyMap<number, GitGutterKind>,
  doc: { line: (n: number) => { from: number } }
): RangeSet<GutterMarker> {
  const sorted = [...markers.entries()].sort((a, b) => a[0] - b[0]);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const [line, kind] of sorted) {
    const from = doc.line(line).from;
    builder.add(from, from, markerFor(kind));
  }
  return builder.finish();
}

export function setGitGutterMarkers(
  view: EditorView,
  markers: ReadonlyMap<number, GitGutterKind>
): void {
  view.dispatch({
    effects: setGitGutterMarkersEffect.of(
      buildGutterRangeSet(markers, view.state.doc)
    ),
  });
}

export function clearGitGutterMarkers(view: EditorView): void {
  view.dispatch({ effects: setGitGutterMarkersEffect.of(RangeSet.empty) });
}

const gitGutterTheme = EditorView.baseTheme({
  ".cm-gitGutter": {
    width: "4px",
    borderRight: "none",
  },
  ".cm-gitGutter .cm-gutterElement": {
    padding: "0",
    minWidth: "4px",
  },
  ".cm-gitGutter-bar": {
    width: "4px",
    height: "100%",
  },
  ".cm-gitGutter-spacer": { backgroundColor: "transparent" },
  ".cm-gitGutter-added": { backgroundColor: "var(--status-success-fg)" },
  ".cm-gitGutter-modified": { backgroundColor: "var(--status-info-fg)" },
  ".cm-gitGutter-deleted": { backgroundColor: "var(--status-danger-fg)" },
});

export function createGitGutterExtension(): Extension {
  return [
    gitGutterField,
    gutter({
      class: "cm-gitGutter",
      markers: (view) => view.state.field(gitGutterField),
      initialSpacer: () => SPACER,
    }),
    gitGutterTheme,
  ];
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | rg -i 'files-editor-git-gutter\.ts' || echo OK`
Expected: 无该文件报错

- [ ] **Step 3: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/files-editor-git-gutter.ts
git commit -m "feat(files): add CodeMirror git gutter extension"
```

---

### Task 3: ViewSession 挂载 gutter + setGitGutterMarkers

**Files:**
- Modify: `src/plugins/builtin/files/renderer/file-editor-view-session.ts`

**Interfaces:**
- Consumes: `createGitGutterExtension`, `setGitGutterMarkers`, `clearGitGutterMarkers`, `GitGutterKind` from Task 2/1
- Produces:
  - `FileEditorViewSession.setGitGutterMarkers(markers: ReadonlyMap<number, GitGutterKind>): void`
  - `FileEditorViewSession.clearGitGutterMarkers(): void`

- [ ] **Step 1: Add imports**

在 `file-editor-view-session.ts` 顶部 import 区加：

```ts
import {
  clearGitGutterMarkers,
  createGitGutterExtension,
  setGitGutterMarkers,
} from "./files-editor-git-gutter.ts";
import type { GitGutterKind } from "./files-editor-git-markers.ts";
```

- [ ] **Step 2: Mount extension at front of `#extensions`**

`#extensions(document)` 返回数组**最前面**插入 `createGitGutterExtension()`（先于 `Prec.highest(...)` 与 `basicSetup`，保证 gutter 在行号左侧）：

```ts
return [
  createGitGutterExtension(),
  Prec.highest(EditorView.domEventHandlers({ /* 原有 */ })),
  codeMirrorSearch(),
  basicSetup,
  // ... 其余不变
];
```

- [ ] **Step 3: Add public methods**

在 `selectMatches()` 附近加：

```ts
setGitGutterMarkers(markers: ReadonlyMap<number, GitGutterKind>): void {
  const view = this.#view;
  if (view) {
    setGitGutterMarkers(view, markers);
  }
}

clearGitGutterMarkers(): void {
  const view = this.#view;
  if (view) {
    clearGitGutterMarkers(view);
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | rg -i 'file-editor-view-session\.ts' || echo OK`
Expected: 无报错

- [ ] **Step 5: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/file-editor-view-session.ts
git commit -m "feat(files): mount git gutter extension in editor view session"
```

---

### Task 4: Git gutter 编排类

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts`
- Test: `tests/unit/renderer/files-editor-git-gutter-controller.test.ts`

**Interfaces:**
- Consumes:
  - `RendererPluginContext`（`context.git.getDiffPatch`、`context.git.watch`）
  - `FileEditorViewSession`（`.setGitGutterMarkers` / `.clearGitGutterMarkers`）
  - `FilesDocument`（`source.kind === "disk"` → `source.root` / `source.path`）
  - `markersFromDiffPatch` from Task 1
- Produces:
  - `class FilesEditorGitGutterController`
    - `attach(editorSessionId: string, document: FilesDocument, session: FileEditorViewSession): void`
    - `detach(editorSessionId: string): void`
    - `refreshByDocument(documentId: string): void`
    - `refreshByRoot(root: string): void`（watch 命中时按 root 刷新所有匹配会话）
    - `clearSession(editorSessionId: string): void`（mode 非源码时清空当前会话）
    - `dispose(): void`

**行为：**

- `attach`：若 `document.source.kind !== "disk"` → return。否则记 `{ editorSessionId, documentId, root, path, session, generation }`；若该 root 尚未 watch，`context.git.watch(root, listener, onStartFailure)` 订阅，listener 在事件时调 `refreshByRoot(root)`（watch 返回 unsubscribe；存入 root→{unsubscribe, sessionIds:Set}）。attach 后立即 `#refresh(entry)`。
- `detach`：移除 entry；从 root 集合删该 sessionId；若集合空 → unsubscribe watch。
- `clearSession`：`session.clearGitGutterMarkers()`。
- `refreshByDocument`：找到所有 `entry.documentId === documentId`，对每个 `#refresh`。
- `refreshByRoot`：找到所有 `entry.root === root`，对每个 `#refresh`（watch 命中后防抖 ~200ms 按 root 合并）。
- `#refresh(entry)`：
  1. `generation += 1`，记 `entry.generation = generation`。
  2. `context.git.getDiffPatch(entry.root, { from: "HEAD", path: entry.path })`。
  3. 成功：从 `patch.files` 找 `file.path === entry.path` 的 `GitDiffFilePatch`（找不到 → null → 空 markers）。
  4. 若 `entry.generation === generation`（未过期）：`session.setGitGutterMarkers(markersFromDiffPatch(filePatch))`。
  5. 失败（reject / throw）：若 `entry.generation === generation` → `session.clearGitGutterMarkers()`。不抛、不 toast。
- 防抖：`refreshByRoot` 用 `setTimeout(200ms)` 合并同 root 多次事件；`#refresh` 本身不防抖（attach/refreshByDocument 直达）。
- `dispose`：清所有 setTimeout、unsubscribe 所有 watch、清 entries。

**路径解析：** `getDiffPatch(root, { from: "HEAD", path })` 直接用 `document.source.root` 作 cwd、`document.source.path` 作 path（git `-C root` 解析 path 相对 root 正确，无需重映射到 gitRoot）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/renderer/files-editor-git-gutter-controller.test.ts
import { FilesEditorGitGutterController } from "@plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts";
import type { FileEditorViewSession } from "@plugins/builtin/files/renderer/file-editor-view-session.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitDiffPatch } from "@shared/contracts/git.ts";
import { describe, expect, it, vi } from "vitest";

function makeSession(): FileEditorViewSession {
  return {
    setGitGutterMarkers: vi.fn(),
    clearGitGutterMarkers: vi.fn(),
  } as unknown as FileEditorViewSession;
}

function makeContext(getDiffPatch: (cwd: string, opts?: { from?: string; path?: string }) => Promise<GitDiffPatch>): RendererPluginContext {
  const watchListeners = new Map<string, (e: unknown) => void>();
  return {
    git: {
      getDiffPatch: vi.fn(getDiffPatch),
      watch: vi.fn((root: string, listener: (e: unknown) => void) => {
        watchListeners.set(root, listener);
        return () => watchListeners.delete(root);
      }),
    },
  } as unknown as RendererPluginContext;
}

function diskDocument(root: string, path: string) {
  return {
    id: `${root}/${path}`,
    source: { kind: "disk" as const, path, root },
  } as never;
}

describe("FilesEditorGitGutterController", () => {
  it("does nothing for untitled documents", async () => {
    const ctx = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(ctx);
    const session = makeSession();
    ctrl.attach("s1", { id: "u1", source: { kind: "untitled", id: "u1", name: "x", language: "text" } } as never, session);
    await Promise.resolve();
    expect((session.setGitGutterMarkers as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((session.clearGitGutterMarkers as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("fetches diff on attach and sets markers", async () => {
    const filePatch = {
      binary: false,
      path: "src/a.ts",
      oldPath: "src/a.ts",
      hunks: [
        {
          newStart: 1,
          newLines: 2,
          oldStart: 1,
          oldLines: 1,
          lines: [
            { kind: "context", text: "a" },
            { kind: "add", text: "b" },
          ],
        },
      ],
    };
    const ctx = makeContext(async () => ({ files: [filePatch] }));
    const ctrl = new FilesEditorGitGutterController(ctx);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    await Promise.resolve();
    await Promise.resolve();
    expect((session.setGitGutterMarkers as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.any(Map)
    );
  });

  it("clears markers when diff fetch fails", async () => {
    const ctx = makeContext(async () => Promise.reject(new Error("boom")));
    const ctrl = new FilesEditorGitGutterController(ctx);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    await Promise.resolve();
    await Promise.resolve();
    expect((session.clearGitGutterMarkers as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("detach unsubscribes watch when last session for root leaves", () => {
    const unsub = vi.fn();
    const ctx = {
      git: {
        getDiffPatch: vi.fn(async () => ({ files: [] })),
        watch: vi.fn(() => unsub),
      },
    } as unknown as RendererPluginContext;
    const ctrl = new FilesEditorGitGutterController(ctx);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    ctrl.detach("s1");
    expect(unsub).toHaveBeenCalled();
  });

  it("clearSession clears without fetch", () => {
    const ctx = makeContext(async () => ({ files: [] }));
    const ctrl = new FilesEditorGitGutterController(ctx);
    const session = makeSession();
    ctrl.attach("s1", diskDocument("/repo", "src/a.ts"), session);
    ctrl.clearSession("s1");
    expect((session.clearGitGutterMarkers as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-git-gutter-controller.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorViewSession } from "./file-editor-view-session.ts";
import { markersFromDiffPatch } from "./files-editor-git-markers.ts";
import type { FilesDocument } from "./files-document-types.ts";

interface GitGutterEntry {
  documentId: string;
  editorSessionId: string;
  path: string;
  root: string;
  session: FileEditorViewSession;
  generation: number;
}

interface WatchSlot {
  sessionIds: Set<string>;
  unsubscribe: () => void;
  refreshTimer: ReturnType<typeof setTimeout> | null;
}

const REFRESH_DEBOUNCE_MS = 200;

export class FilesEditorGitGutterController {
  readonly #context: RendererPluginContext;
  readonly #entries = new Map<string, GitGutterEntry>();
  readonly #watches = new Map<string, WatchSlot>();
  #generation = 0;

  constructor(context: RendererPluginContext) {
    this.#context = context;
  }

  attach(
    editorSessionId: string,
    document: FilesDocument,
    session: FileEditorViewSession
  ): void {
    if (document.source.kind !== "disk") {
      session.clearGitGutterMarkers();
      return;
    }
    const root = document.source.root;
    const path = document.source.path;
    const entry: GitGutterEntry = {
      documentId: document.id,
      editorSessionId,
      generation: 0,
      path,
      root,
      session,
    };
    this.#entries.set(editorSessionId, entry);
    this.#ensureWatch(root, editorSessionId);
    void this.#refresh(entry);
  }

  detach(editorSessionId: string): void {
    const entry = this.#entries.get(editorSessionId);
    if (!entry) {
      return;
    }
    this.#entries.delete(editorSessionId);
    const slot = this.#watches.get(entry.root);
    if (slot) {
      slot.sessionIds.delete(editorSessionId);
      if (slot.sessionIds.size === 0) {
        if (slot.refreshTimer !== null) {
          clearTimeout(slot.refreshTimer);
        }
        slot.unsubscribe();
        this.#watches.delete(entry.root);
      }
    }
  }

  clearSession(editorSessionId: string): void {
    this.#entries.get(editorSessionId)?.session.clearGitGutterMarkers();
  }

  refreshByDocument(documentId: string): void {
    for (const entry of this.#entries.values()) {
      if (entry.documentId === documentId) {
        void this.#refresh(entry);
      }
    }
  }

  refreshByRoot(root: string): void {
    const slot = this.#watches.get(root);
    if (!slot || slot.sessionIds.size === 0) {
      return;
    }
    if (slot.refreshTimer !== null) {
      clearTimeout(slot.refreshTimer);
    }
    slot.refreshTimer = setTimeout(() => {
      slot.refreshTimer = null;
      for (const entry of this.#entries.values()) {
        if (entry.root === root) {
          void this.#refresh(entry);
        }
      }
    }, REFRESH_DEBOUNCE_MS);
  }

  dispose(): void {
    for (const slot of this.#watches.values()) {
      if (slot.refreshTimer !== null) {
        clearTimeout(slot.refreshTimer);
      }
      slot.unsubscribe();
    }
    this.#watches.clear();
    this.#entries.clear();
  }

  #ensureWatch(root: string, editorSessionId: string): void {
    let slot = this.#watches.get(root);
    if (!slot) {
      const gitApi = (this.#context as Partial<RendererPluginContext>).git;
      if (!gitApi?.watch) {
        return;
      }
      const unsubscribe = gitApi.watch(
        root,
        () => this.refreshByRoot(root),
        () => undefined
      );
      slot = { refreshTimer: null, sessionIds: new Set(), unsubscribe };
      this.#watches.set(root, slot);
    }
    slot.sessionIds.add(editorSessionId);
  }

  async #refresh(entry: GitGutterEntry): Promise<void> {
    const gitApi = (this.#context as Partial<RendererPluginContext>).git;
    if (!gitApi?.getDiffPatch) {
      entry.session.clearGitGutterMarkers();
      return;
    }
    this.#generation += 1;
    const generation = this.#generation;
    entry.generation = generation;
    try {
      const patch = await gitApi.getDiffPatch(entry.root, {
        from: "HEAD",
        path: entry.path,
      });
      if (entry.generation !== generation) {
        return;
      }
      const filePatch = patch.files.find((f) => f.path === entry.path) ?? null;
      entry.session.setGitGutterMarkers(markersFromDiffPatch(filePatch));
    } catch {
      if (entry.generation === generation) {
        entry.session.clearGitGutterMarkers();
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-git-gutter-controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/files-editor-git-gutter-controller.ts tests/unit/renderer/files-editor-git-gutter-controller.test.ts
git commit -m "feat(files): add git gutter orchestration controller"
```

---

### Task 5: 接入 FileEditorController

**Files:**
- Modify: `src/plugins/builtin/files/renderer/file-editor-controller.ts`
- Modify: `src/plugins/builtin/files/renderer/file-panel-body.tsx`

**Interfaces:**
- Consumes: `FilesEditorGitGutterController` from Task 4；`FileEditorViewCoordinator` 需暴露 `getSession(editorSessionId)`
- Produces:
  - `FileEditorController.attachGitGutter(editorSessionId, document): void`
  - `FileEditorController.detachGitGutter(editorSessionId): void`
  - `FileEditorController.clearGitGutter(editorSessionId): void`
  - `FileEditorController.refreshGitGutterByDocument(documentId): void`

- [ ] **Step 1: Expose session getter on ViewCoordinator**

在 `file-editor-view-coordinator.ts` 加：

```ts
getSession(editorSessionId: string): FileEditorViewSession | undefined {
  return this.#sessions.get(editorSessionId);
}
```

- [ ] **Step 2: Add git gutter controller to FileEditorController**

在 `file-editor-controller.ts`：

import：
```ts
import { FilesEditorGitGutterController } from "./files-editor-git-gutter-controller.ts";
```

字段（`#views` 附近）：
```ts
readonly #gitGutter: FilesEditorGitGutterController;
```

构造器末尾：
```ts
this.#gitGutter = new FilesEditorGitGutterController(context);
```

`attachView`（在 `this.#views.attach(...)` 之后）：
```ts
const session = this.#views.getSession(input.editorSessionId);
if (session) {
  this.#gitGutter.attach(input.editorSessionId, document, session);
}
```

`detachView`（在 `this.#views.detach(...)` 之前或之后均可，改为之前以避免 session 已 dispose）：
```ts
this.#gitGutter.detach(editorSessionId);
this.#views.detach(editorSessionId);
```

`saveDocument` / `settleDocument`：在 await 成功且 outcome === `"saved"` 后调 `this.#gitGutter.refreshByDocument(documentId)`。具体：`saveDocument` 末尾：
```ts
const outcome = await this.#saveCoordinator.saveDocument(documentId, panelId, feedback);
if (outcome === "saved") {
  this.#gitGutter.refreshByDocument(documentId);
}
return outcome;
```
`settleDocument` 同理（`result.outcome === "saved"` 时刷新）。

`dispose`（末尾）：
```ts
this.#gitGutter.dispose();
```

新增薄委托方法（公开给 panel 层用于 mode 切换）：
```ts
clearGitGutter(editorSessionId: string): void {
  this.#gitGutter.clearSession(editorSessionId);
}
```

- [ ] **Step 3: Wire mode/source changes in ResolvedFilePanel**

在 `file-panel-body.tsx` 的 `ResolvedFilePanel` 中，加 effect（依赖 `mode`、`document.source`、`editorSessionId`）：

```ts
useEffect(() => {
  if (mode !== "source") {
    controller.clearGitGutter(editorSessionId);
    return;
  }
  if (document.source.kind === "disk") {
    // attach 在 controller.attachView 时已发生；mode 切回 source 时刷新一次
    controller.refreshGitGutterByDocument(document.id);
  } else {
    controller.clearGitGutter(editorSessionId);
  }
}, [controller, document.id, document.source, editorSessionId, mode]);
```

> 注：`attachView` 由 `CodeMirrorEditor.bindEditorHost` 触发，已在 `controller.attachView` 里调 `#gitGutter.attach`。mode 切换不 remount 编辑器，故此 effect 仅做清空/刷新。

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | rg -i 'file-editor-controller\.ts|file-panel-body\.ts|file-editor-view-coordinator\.ts' || echo OK`
Expected: 无报错

- [ ] **Step 5: Run unit tests**

Run: `pnpm exec vitest run tests/unit/renderer/files-editor-git-markers.test.ts tests/unit/renderer/files-editor-git-gutter-controller.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**（需用户确认后）

```bash
git add src/plugins/builtin/files/renderer/file-editor-controller.ts src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts src/plugins/builtin/files/renderer/file-panel-body.tsx
git commit -m "feat(files): wire git gutter into editor controller and panel"
```

---

### Task 6: 验证与治理

**Files:** 无新文件

- [ ] **Step 1: 类型 + lint + 依赖巡航 + file-size**

Run: `pnpm check 2>&1 | tail -40`
Expected: typecheck/lint/depcruise/file-size 全绿；确认新增三文件均 < 500 行（`files-editor-git-gutter-controller.ts` 约 150 行、`files-editor-git-gutter.ts` 约 120 行、`files-editor-git-markers.ts` 约 90 行）。

- [ ] **Step 2: 单元测试全量**

Run: `pnpm test:unit 2>&1 | tail -30`
Expected: 全绿（含新两个测试文件与既有 files 测试无回归）

- [ ] **Step 3: 手动 smoke**

1. `pnpm dev`
2. 打开一个有未提交修改的 git 项目文件 → 编辑器行号左侧出现绿/蓝/红竖条
3. 编辑未保存 → gutter 不变
4. 保存 → gutter 在短延迟后更新
5. 终端 `git checkout -- <file>` → watch 触发后 gutter 清空
6. 切到 Markdown preview 模式 → gutter 消失；切回 source → gutter 恢复
7. untitled 文件 → 无 gutter
8. 深浅色主题切换 → 色条颜色随 token 正确变化

- [ ] **Step 4: 更新 memory（可选）**

若实现与 spec 偏离，更新 `memory://root` 相关条目。

---

## 自检

**Spec 覆盖：**
- 4.1 数据流 → Task 4 `#refresh`
- 4.2 行映射规则 → Task 1
- 4.3 CodeMirror 接入 → Task 2/3
- 4.4 刷新编排 → Task 4/5
- 4.5 模式边界 → Task 5 Step 3 effect
- 4.6 Git 插件职责 → 不涉及 Git 插件，无任务
- 5 测试 → Task 1/4 单测
- 6 验收 → Task 6 smoke

**Placeholder 扫描：** 无 TBD/TODO；所有步骤含完整代码或确切命令。

**类型一致性：** `GitGutterKind`、`markersFromDiffPatch`、`setGitGutterMarkers`、`clearGitGutterMarkers`、`createGitGutterExtension`、`FilesEditorGitGutterController` 在跨任务引用处签名一致。
