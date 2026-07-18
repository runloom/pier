# Files Path Query + Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **树搜索 UI 修正（2026-07-18）**：Task 7 原「独立结果列表」已作废；以 `docs/superpowers/specs/2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md` 为准（path query 物化进 `PierFileTree` + `setSearch`）。

**Goal:** Deliver main-process path query, `Cmd+P` quick open, and tree search that share the same top-K path ranking—so `theme.ts` stably finds `code-mirror-editor-theme.ts` without flooding the tree store.

**Architecture:** Main walks the project root (BFS), applies exclude/gitignore, scores paths, returns ≤200 items via directed IPC events. Renderer owns MRU hints and two consumers (async command-palette quick pick + tree result list). Selecting a result opens the file and reveals only the ancestor chain.

**Tech Stack:** Electron main IPC, Zod contracts, Node `fs/promises` + `path`, `minimatch`, existing Files open/reveal helpers, command palette controller, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md`
- Path-only: **no** content search / `Cmd+Shift+F` / packed `rg`
- Renderer **must not** recurse `files.list` for search indexing
- Top-K hard cap **200**; MRU hints ≤ **100**, memory-only, per window/root
- Capability: `file:read` before start
- Feedback: no silent `console.error`-only failures; details → `showAppAlert` / plugin dialogs
- File size hard cap 500 lines; prefer new focused files over growing monsters
- Git: stage explicit paths only; Conventional Commits; no `git add .`

## File map

| File | Responsibility |
|---|---|
| `src/shared/contracts/file-query.ts` | Zod schemas + types for path query request/events |
| `src/shared/ipc-channels.ts` | `FILE_QUERY_START` / `CANCEL` / event channel |
| `src/main/services/file-query/path-score.ts` | Pure normalize + score + top-K |
| `src/main/services/file-query/path-walk.ts` | BFS walk with exclude + optional gitignore |
| `src/main/services/file-query/file-query-service.ts` | Session map, cancel, emit batches |
| `src/main/ipc/file-query.ts` | IPC registration + capability + lifecycle |
| `src/preload/file-query-api.ts` | Renderer bridge: start/cancel/onEvent |
| `src/preload/index.ts` | Expose `window.pier.fileQuery` |
| `src/plugins/api/renderer-facades.ts` + `renderer.ts` | `files.queryPaths` facade types |
| `src/renderer/lib/plugins/host-files-context.ts` | Wire facade to preload |
| `src/renderer/lib/command-palette/types.ts` | Async quick pick fields |
| `src/renderer/lib/command-palette/controller.ts` | Session update/close for async pick |
| `src/renderer/lib/plugins/host-command-palette-context.ts` | Plugin adapt layer |
| `src/plugins/builtin/files/renderer/files-path-ranking.ts` | Shared score helpers if needed client-side |
| `src/plugins/builtin/files/renderer/files-quick-open-mru.ts` | In-memory MRU |
| `src/plugins/builtin/files/renderer/files-quick-open.ts` | `pier.files.quickOpen` command |
| `src/plugins/builtin/files/renderer/files-path-query-client.ts` | Debounced start/cancel helper |
| `src/plugins/builtin/files/renderer/files-tree-search-results.tsx` | Result list UI |
| `src/plugins/builtin/files/renderer/use-files-tree-search.ts` | Switch to path query |
| `src/plugins/builtin/files/renderer/files-tree-search-loader.ts` | Shrink or delete whole-tree load |
| `src/plugins/builtin/files/manifest.ts` + locales + keybindings | Commands / i18n / `Cmd+P` |
| Tests under `tests/unit/**` and `tests/component/**` | Contracts, service, ranking, UI |

---

### Task 1: Path score pure functions + contract schemas

**Files:**
- Create: `src/shared/contracts/file-query.ts`
- Create: `src/main/services/file-query/path-score.ts`
- Create: `tests/unit/shared/file-query-contract.test.ts`
- Create: `tests/unit/main/file-path-score.test.ts`
- Modify: `src/shared/ipc-channels.ts` (add three channels)

**Interfaces:**
- Produces:
  - `normalizeFilePathQuery(query: string): string`
  - `scoreFilePath(path: string, query: string, mruIndex: number | null): number | null` (`null` = no match when query non-empty)
  - `selectTopFilePaths(paths: readonly string[], query: string, mruPaths: readonly string[], limit: number): { path: string; score: number }[]`
  - Zod: `filePathQueryStartSchema`, `fileQueryEventSchema`
  - `PIER.FILE_QUERY_START`, `PIER.FILE_QUERY_CANCEL`, `PIER_BROADCAST` not used—events directed via invoke callback or dedicated `webContents.send` channel `pier://file-query:event` listed in `PIER` as `FILE_QUERY_EVENT` for preload subscribe pattern (mirror FILE_WATCH style: start/stop invoke + event send)

- [ ] **Step 1: Write failing contract + score tests**

```ts
// tests/unit/main/file-path-score.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeFilePathQuery,
  selectTopFilePaths,
} from "../../../src/main/services/file-query/path-score.ts";

describe("selectTopFilePaths", () => {
  const paths = [
    "src/main/ipc/theme.ts",
    "src/renderer/components/workspace/workspace-theme.ts",
    "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
    "packages/ui/src/file-icon-theme.ts",
    "README.md",
  ];

  it("normalizes query", () => {
    expect(normalizeFilePathQuery("  Theme.TS\\x  ")).toBe("theme.ts/x");
  });

  it("matches theme.ts inside code-mirror-editor-theme.ts", () => {
    const top = selectTopFilePaths(paths, "theme.ts", [], 200);
    expect(top.map((x) => x.path)).toContain(
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
    );
  });

  it("prefers basename hits and MRU", () => {
    const top = selectTopFilePaths(paths, "theme.ts", ["src/main/ipc/theme.ts"], 3);
    expect(top[0]?.path).toBe("src/main/ipc/theme.ts");
  });

  it("returns empty-query shallow/MRU ordering without dumping everything unbounded", () => {
    const top = selectTopFilePaths(paths, "", ["packages/ui/src/file-icon-theme.ts"], 2);
    expect(top).toHaveLength(2);
    expect(top[0]?.path).toBe("packages/ui/src/file-icon-theme.ts");
  });
});
```

```ts
// tests/unit/shared/file-query-contract.test.ts
import { filePathQueryStartSchema, fileQueryEventSchema } from "@shared/contracts/file-query.ts";
import { describe, expect, it } from "vitest";

it("accepts a path query start payload", () => {
  const parsed = filePathQueryStartSchema.parse({
    queryId: "q1",
    owner: "quick-open:1",
    root: "/repo",
    query: "theme.ts",
    limit: 200,
    mruPaths: ["src/main/ipc/theme.ts"],
    options: { applyGitIgnore: true, applyExcludePatterns: true },
  });
  expect(parsed.limit).toBe(200);
});

it("accepts done event", () => {
  expect(
    fileQueryEventSchema.parse({
      kind: "done",
      queryId: "q1",
      reason: "completed",
      truncated: false,
      scanned: 10,
      elapsedMs: 12,
    }).kind
  ).toBe("done");
});
```

- [ ] **Step 2: Run tests — expect FAIL (modules missing)**

```bash
pnpm exec vitest run tests/unit/main/file-path-score.test.ts tests/unit/shared/file-query-contract.test.ts
```

- [ ] **Step 3: Implement schemas, channels, scoring**

`path-score.ts` rules (lock in tests):
- `normalizeFilePathQuery`: trim, `\`→`/`, lower-case
- Non-empty query: path must include normalized query (case-insensitive on path)
- Score = basename continuous bonus (e.g. +1000 if basename includes query) + earlier index bonus + shallow path bonus (`-depth * 2`) + MRU bonus (`(100 - mruIndex) * 10` if present)
- Sort score desc, path asc; slice `limit` (clamp 1..200, default 200)

`file-query.ts` schemas match the design types exactly (path mode only).

IPC channels:
```ts
FILE_QUERY_START: "pier://file-query:start",
FILE_QUERY_CANCEL: "pier://file-query:cancel",
FILE_QUERY_EVENT: "pier://file-query:event",
```

- [ ] **Step 4: Re-run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/file-query.ts src/shared/ipc-channels.ts \
  src/main/services/file-query/path-score.ts \
  tests/unit/main/file-path-score.test.ts \
  tests/unit/shared/file-query-contract.test.ts
git commit -m "feat(files): add path query scoring and contracts"
```

---

### Task 2: Path walk + FileQueryService sessions

**Files:**
- Create: `src/main/services/file-query/path-walk.ts`
- Create: `src/main/services/file-query/file-query-service.ts`
- Create: `tests/unit/main/file-query-service.test.ts`
- Modify: reuse `FILES_TREE_DEFAULT_EXCLUDE_PATTERNS` from `src/plugins/builtin/files/settings.ts` **only via shared constant**—if main cannot import plugin package, **duplicate the default pattern list** into `src/shared/contracts/file-tree-exclude.ts` or `file-query.ts` and have files settings re-export it (prefer extract shared defaults to `src/shared/contracts/files-tree-exclude.ts`).

**Interfaces:**
- Consumes: scoring helpers from Task 1
- Produces:
  - `createFileQueryService(deps): { start(senderId, request, emit); cancel(senderId, queryId); cancelAll(senderId) }`
  - Walk yields relative posix file paths only (not directories)

- [ ] **Step 1: Failing service tests with temp fixture**

```ts
// tests/unit/main/file-query-service.test.ts (sketch — expand fully)
// Create tmp root:
//   src/main/ipc/theme.ts
//   src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts
//   node_modules/pkg/x.ts  (if exclude includes node_modules — default list does NOT; add **/.git only)
// Use default excludes from shared constant.
// Assert start emits started → batch containing code-mirror path for "theme.ts" → done.
// Assert second start same owner cancels first (first gets done reason cancelled OR no further batches after cancel).
// Assert cancel is idempotent.
```

Implement tests with `mkdtemp` + `writeFile` + `mkdir` recursive.

- [ ] **Step 2: Run — FAIL**

```bash
pnpm exec vitest run tests/unit/main/file-query-service.test.ts
```

- [ ] **Step 3: Implement walk + service**

`path-walk.ts`:
- BFS queue of directories
- `readdir` with `withFileTypes`
- Skip names matching exclude via `minimatch` (same semantics as `isExcludedFileTreePath` — match path and ancestors)
- Symlink: if realpath escapes root, skip; track visited realpaths
- Optional gitignore: v1 simple approach — if `applyGitIgnore`, call existing `listIgnoredPaths` once (or `git check-ignore --stdin` batch) and skip ignored relative paths; if git unavailable, proceed without ignore and do not fail the query
- Yield files only; caps: e.g. `MAX_SCANNED = 50_000`, cooperative cancel via `AbortSignal`

`file-query-service.ts`:
- Map key: `${senderId}\0${owner}` → active `{ queryId, abort }`
- `start`: abort previous same key; emit `started`; walk; score; emit one `batch` with top-K (v1 single batch is OK); emit `done`
- On abort: emit `done { reason: "cancelled" }` if not already finished; never emit batch after cancel
- Errors: emit `error` with message

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add src/main/services/file-query src/shared/contracts/files-tree-exclude.ts \
  src/plugins/builtin/files/settings.ts tests/unit/main/file-query-service.test.ts
git commit -m "feat(files): add main path walk query service"
```

---

### Task 3: IPC + preload + plugin files facade

**Files:**
- Create: `src/main/ipc/file-query.ts`
- Create: `src/preload/file-query-api.ts`
- Modify: `src/main/index.ts` (register IPC)
- Modify: `src/preload/index.ts`
- Modify: `src/plugins/api/renderer-facades.ts`, `src/plugins/api/renderer.ts`
- Modify: `src/renderer/lib/plugins/host-files-context.ts`
- Create: `tests/unit/main/file-query-ipc.test.ts` (capability deny / payload validation)
- Modify: existing host-context / preload type tests if present

**Interfaces:**
- Produces `window.pier.fileQuery.start/cancel/onEvent`
- Produces `context.files.queryPaths({ ... })` and `context.files.cancelPathQuery(queryId)` **or** single client helper returning async iterator / event subscription

Recommended facade:

```ts
// on RendererPluginContext["files"]
queryPaths(
  request: Omit<FilePathQueryRequest, "queryId"> & { queryId?: string }
): { queryId: string; cancel(): void };
onPathQueryEvent(listener: (event: FileQueryEvent) => void): () => void;
```

Main generates `queryId` if omitted (`crypto.randomUUID()`).

- [ ] **Step 1: Write IPC unit test for missing capability and bad payload**

- [ ] **Step 2: Implement registration mirroring `registerFileWatchIpc` capability pattern**

- [ ] **Step 3: Wire preload + host-files-context with `file:read` assert**

- [ ] **Step 4: Run unit tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(files): expose path query IPC and plugin facade"
```

---

### Task 4: MRU + path query client helper

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-quick-open-mru.ts`
- Create: `src/plugins/builtin/files/renderer/files-path-query-client.ts`
- Create: `tests/unit/renderer/files-quick-open-mru.test.ts`
- Create: `tests/unit/renderer/files-path-query-client.test.ts`

**Interfaces:**
```ts
// MRU
recordFilesPathMru(root: string, relativePath: string): void;
listFilesPathMru(root: string): readonly string[]; // ≤100, newest first

// Client
type PathQuerySnapshot = {
  status: "idle" | "loading" | "done" | "error";
  items: readonly { path: string; score: number }[];
  truncated: boolean;
  errorMessage?: string;
};

function createFilesPathQueryClient(files: FilesFacade): {
  search(input: {
    root: string;
    owner: string;
    query: string;
    debounceMs?: number; // default 80
    onUpdate: (snap: PathQuerySnapshot) => void;
  }): () => void; // dispose/cancel
};
```

- [ ] **Step 1: Tests for MRU cap/order and client cancel-on-new-query**

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(files): add path query client and window MRU"
```

---

### Task 5: Async quick pick host support

**Files:**
- Modify: `src/renderer/lib/command-palette/types.ts`
- Modify: `src/renderer/lib/command-palette/controller.ts`
- Modify: `src/renderer/components/common/command-palette.tsx` and/or `command-palette-quick-pick-view.tsx`
- Modify: `src/plugins/api/renderer.ts` (`RendererPluginQuickPick`)
- Modify: `src/renderer/lib/plugins/host-command-palette-context.ts`
- Create: `tests/unit/renderer/plugin-async-quick-pick.test.tsx` and/or component test

**Interfaces:**
Extend `QuickPick` / `RendererPluginQuickPick`:

```ts
onQueryChange?(query: string, signal: AbortSignal): void | Promise<void>;
loading?: boolean;
errorText?: string;
// items remain the current result set; host calls replaceQuickPick/update to refresh
```

Controller needs either:
- `replaceQuickPick` already exists — plugins call `openQuickPick` once then `replaceQuickPick` on each batch while preserving query string and selection id when possible  
**or** add `updateQuickPick(partial)` that merges `items/loading/errorText` without resetting input.

**Requirement:** typing must not lose input focus; rapid replace must not reset caret.

- [ ] **Step 1: Failing test — onQueryChange fires on input; abort on next keystroke**

- [ ] **Step 2: Implement minimal async session behavior**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(command-palette): support async query-driven quick picks"
```

---

### Task 6: `pier.files.quickOpen` + `Cmd+P`

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-quick-open.ts`
- Modify: `src/plugins/builtin/files/renderer/index.tsx` (register command)
- Modify: `src/plugins/builtin/files/manifest.ts` (command id + title)
- Modify: locales en/zh-CN
- Modify: `src/shared/keybindings.ts` (bind `Cmd+P` / `Ctrl+P` if free; if conflict, document chosen binding)
- Create: `tests/component/files-quick-open.test.tsx`

**Behavior:**
1. Resolve `projectRootPath` from active panel context (same as other files commands).
2. If missing → open quick pick with single disabled item explaining no project.
3. Else open async quick pick; `onQueryChange` → path query client owner `quick-open:<session>`.
4. On accept → open file via existing panel open path used by tree (same as clicking a file): prefer the helper used by tree open / `files.openPath` / group open — **grep for the current open-file-from-tree path and reuse it**.
5. `recordFilesPathMru(root, path)` on success.

- [ ] **Step 1: Component test with mocked `queryPaths` events**

- [ ] **Step 2: Implement command + i18n + keybinding**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(files): add Cmd+P path quick open"
```

---

### Task 7: Tree search result layer on path query

**Files:**
- Create: `src/plugins/builtin/files/renderer/files-tree-search-results.tsx`
- Modify: `src/plugins/builtin/files/renderer/use-files-tree-search.ts`
- Modify: `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- Modify: `src/plugins/builtin/files/renderer/files-tree-search-loader.ts` — **delete whole-tree load API** or reduce to no-op deprecated export if tests require temporary shim; remove recursive list usage
- Modify: locales for truncated/empty/error
- Create/modify: `tests/unit/renderer/use-files-tree-search.test.ts`, `tests/component/files-file-panel.test.tsx` (search cases), update `files-tree-search-loader.test.ts` (delete or rewrite)

**Behavior:**
- When search open + non-empty query (or empty with MRU): show **result list** above/instead of filtered Pierre search; do **not** call `loadFilesTreeForSearch`.
- Progressive updates from batches; `loading` true until `done|error`.
- Empty state only after `done` with 0 items.
- Truncated: show `200+` / i18n truncated hint.
- Navigate up/down / Enter: open selected path + `revealFilesTreePath({ root, path })` after ensuring ancestor directories loaded via **existing** single-directory loaders (`loadFilesTreeDirectory` along parents only)—not full-tree search loader.
- Stop using Pierre `setSearch` as the primary matcher (may clear Pierre search when using result layer).

- [ ] **Step 1: Failing tests proving no whole-tree list and theme.ts hit via mocked query**

- [ ] **Step 2: Implement UI + hook switch**

- [ ] **Step 3: Remove/disable `files-tree-search-loader` whole-tree path; fix tests**

- [ ] **Step 4: PASS targeted suites**

```bash
pnpm exec vitest run \
  tests/unit/main/file-path-score.test.ts \
  tests/unit/main/file-query-service.test.ts \
  tests/unit/shared/file-query-contract.test.ts \
  tests/unit/renderer/files-quick-open-mru.test.ts \
  tests/unit/renderer/files-path-query-client.test.ts \
  tests/component/files-quick-open.test.tsx \
  tests/unit/renderer/files-tree-search-loader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(files): power tree search with shared path query"
```

---

### Task 8: Smoke verification + docs touch-up

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md` status → accepted/implemented note if needed
- Optional: one-line pointer in `docs/plugins.md` only if files search is documented there

- [ ] **Step 1: Manual smoke checklist (dev)**

1. Open pier repo in Pier  
2. Tree search `theme.ts` → list includes `code-mirror-editor-theme.ts` after done  
3. Confirm tree store does not explode with all of `src/plugins` merely from searching (spot-check: expand unrelated dirs still lazy)  
4. `Cmd+P` same query → same file selectable  
5. Rapid typing → no stale flash of previous query’s exclusive hits  
6. No project root → empty states  

- [ ] **Step 2: Commit any doc status nits**

```bash
git commit -m "docs(files): mark path query design implemented"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Main path query + cancel + top-K | 1–3 |
| Exclude + optional gitignore | 2 |
| MRU hints ≤100 | 4, 6 |
| Async quick pick | 5–6 |
| `Cmd+P` / quickOpen | 6 |
| Tree search without whole-tree list | 7 |
| Open + ancestor reveal only | 6–7 |
| No content search | all (out of scope) |
| `theme.ts` → `code-mirror-editor-theme.ts` | 1, 2, 7 tests |

## Placeholder scan

No TBD steps; scoring weights may be tuned but must keep test anchors.

## Type consistency

- Event union `FileQueryEvent` shared main/preload/renderer  
- `owner` string format `quick-open:*` / `tree-search:*`  
- Relative paths always posix, no leading `./`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-files-path-query-and-quick-open.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
