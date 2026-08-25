# Markdown 预览能力增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 files 插件 markdown 预览落地八项能力（单元格换行、列宽拖拽、全局代码换行开关、标题锚点复制、脚注浮层、图片全屏补缺、阅读位置记忆、任务列表回写）。

**Architecture:** 全部改动收敛在 `src/plugins/builtin/files/renderer/markdown/` 及其挂载壳（`panel/body.tsx`）。视图偏好沿用仓库既有手写 localStorage 范式（键前缀 `pier.files.markdown.*`，CustomEvent + storage 事件双通道同步）；内容编辑走 `document/store.ts` 的 `updateDocumentContents` 唯一事务口；配置类开关消费既有 `pier.files.editor.wordWrap` 配置键。

**Tech Stack:** React 19 + TypeScript strict · zustand（无 persist 中间件，手写 localStorage）· vitest + @testing-library/react · Tailwind v4 语义 token。

**Spec:** `docs/superpowers/specs/2026-08-25-markdown-preview-capabilities-design.md`

## Global Constraints

- 单文件 ≤500 行（`pnpm check:file-size`）；新文件遵循 dir-density 命名（去父目录冗余词）。
- 用户可见文案一律 i18n key（`locales/{en,zh-CN,ja,ko}.json` 扁平 `filePanel.*`，英文 fallback 作 translate 第二参）；禁止内联用户串。
- 颜色只用语义 token；禁硬编码色值。
- 新增 `tabIndex={0}` 必须登记进 `tests/unit/renderer/app/chart-focus-governance.test.ts` 白名单 Set 并附理由注释。
- Git 默认只读：每个任务的 commit 步骤执行前，执行者必须先向用户展示 `git diff --staged` 与 Conventional Commits 拟用消息并获得确认；禁止 `git add .`。
- 测试命令一律从仓库根运行；单文件测试模板：`pnpm vitest run <path> --typecheck.disabled` 若报参数错则退化为 `pnpm vitest run <path>`。

---

### Task 1: 单元格内容自适应换行

**Files:**
- Modify: `src/plugins/builtin/files/renderer/markdown/prose.css`
- Test: `tests/unit/plugins/markdown-prose-css.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `.md-table-wrap th, td` 的 `overflow-wrap: anywhere` 规则（Task 3 的拖拽依赖列宽不再被长 token 撑大的行为）

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/plugins/markdown-prose-css.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(
    import.meta.dirname,
    "../../../src/plugins/builtin/files/renderer/markdown/prose.css"
  ),
  "utf8"
);

describe("markdown prose table cell wrapping", () => {
  it("declares overflow-wrap anywhere for table cells", () => {
    expect(css).toMatch(
      /\[data-slot="markdown-prose"\] \.md-table-wrap th,\s*\n\[data-slot="markdown-prose"\] \.md-table-wrap td \{[^}]*overflow-wrap:\s*anywhere/s
    );
  });

  it("does not reintroduce nowrap on cell code spans", () => {
    const tableBlock = css.slice(css.indexOf(".md-table-wrap"));
    expect(tableBlock).not.toMatch(/white-space:\s*nowrap/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-prose-css.test.ts`
Expected: FAIL（第一条规则不存在）

- [ ] **Step 3: 实现**

在 `prose.css` 现有表格段（`.md-table-wrap th, td` 规则，约 L236-240）内追加一行声明：

```css
[data-slot="markdown-prose"] .md-table-wrap th,
[data-slot="markdown-prose"] .md-table-wrap td {
  padding-block: 0.45em;
  padding-inline: 0.65em;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-prose-css.test.ts`
Expected: PASS ×2

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/prose.css tests/unit/plugins/markdown-prose-css.test.ts
git commit -m "feat(files): wrap long tokens inside markdown table cells"
```

---

### Task 2: 列宽偏好存储模块

**Files:**
- Create: `src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts`
- Test: `tests/unit/plugins/markdown-table-width-preferences.test.ts`

**Interfaces:**
- Consumes: 无
- Produces（Task 3 依赖，逐字签名）:

```ts
export type TableColumnWidths = Record<string, number>;
export function readTableWidths(sourcePath: string, contentHash: string): TableColumnWidths | null;
export function writeTableColumnWidth(input: {
  sourcePath: string;
  contentHash: string;
  columnIndex: number;
  widthPx: number;
}): void;
export function resetTableWidths(sourcePath: string, contentHash: string): void;
export const TABLE_WIDTHS_CHANGED_EVENT: string;
export const TABLE_MIN_COLUMN_WIDTH_PX = 48;
export function clampColumnWidth(widthPx: number): number;
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/plugins/markdown-table-width-preferences.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TABLE_WIDTHS_CHANGED_EVENT,
  clampColumnWidth,
  readTableWidths,
  resetTableWidths,
  writeTableColumnWidth,
} from "../../src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts";

describe("table width preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a column width per file+hash", () => {
    writeTableColumnWidth({
      sourcePath: "/a.md",
      contentHash: "h1",
      columnIndex: 2,
      widthPx: 120,
    });
    expect(readTableWidths("/a.md", "h1")).toEqual({ "2": 120 });
    expect(readTableWidths("/a.md", "other")).toBeNull();
    expect(readTableWidths("/b.md", "h1")).toBeNull();
  });

  it("clamps below minimum", () => {
    expect(clampColumnWidth(10)).toBe(48);
    expect(clampColumnWidth(300)).toBe(300);
  });

  it("reset removes hash entry and keeps others", () => {
    writeTableColumnWidth({ sourcePath: "/a.md", contentHash: "h1", columnIndex: 0, widthPx: 80 });
    writeTableColumnWidth({ sourcePath: "/a.md", contentHash: "h2", columnIndex: 0, widthPx: 90 });
    resetTableWidths("/a.md", "h1");
    expect(readTableWidths("/a.md", "h1")).toBeNull();
    expect(readTableWidths("/a.md", "h2")).toEqual({ "0": 90 });
  });

  it("notifies same-window listeners via CustomEvent", () => {
    const spy = vi.fn();
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, spy);
    writeTableColumnWidth({ sourcePath: "/a.md", contentHash: "h1", columnIndex: 0, widthPx: 80 });
    window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-table-width-preferences.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现完整模块**

```ts
// src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts
/**
 * Per-file markdown table column widths (reading preference).
 * Keyed by file path → block content hash → column index, so edits to the
 * table invalidate stale widths automatically. Hand-written localStorage
 * persistence mirrors the preview-preferences.ts convention (no zustand
 * persist middleware anywhere in this plugin).
 */
export const TABLE_WIDTHS_CHANGED_EVENT = "pier:files:markdown-table-widths-changed";
export const TABLE_MIN_COLUMN_WIDTH_PX = 48;

const STORAGE_PREFIX = "pier.files.markdown.tableWidths:";
/** hash → (columnIndex → px) */
type FileWidths = Record<string, Record<string, number>>;

function storageKey(sourcePath: string): string {
  return `${STORAGE_PREFIX}${sourcePath}`;
}

function readStorage(sourcePath: string): FileWidths {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(sourcePath));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FileWidths) : {};
  } catch {
    return {};
  }
}

function writeStorage(sourcePath: string, widths: FileWidths): void {
  try {
    globalThis.localStorage?.setItem(storageKey(sourcePath), JSON.stringify(widths));
  } catch {
    // Storage unavailable/quota: preference degrades to session-only no-op.
  }
  window.dispatchEvent(new CustomEvent(TABLE_WIDTHS_CHANGED_EVENT));
}

export function clampColumnWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return TABLE_MIN_COLUMN_WIDTH_PX;
  return Math.max(TABLE_MIN_COLUMN_WIDTH_PX, Math.round(widthPx));
}

export function readTableWidths(
  sourcePath: string,
  contentHash: string
): TableColumnWidths | null {
  const entry = readStorage(sourcePath)[contentHash];
  if (!entry || Object.keys(entry).length === 0) return null;
  return entry;
}

export type TableColumnWidths = Record<string, number>;

export function writeTableColumnWidth(input: {
  sourcePath: string;
  contentHash: string;
  columnIndex: number;
  widthPx: number;
}): void {
  const widths = readStorage(input.sourcePath);
  const entry = widths[input.contentHash] ?? {};
  entry[String(input.columnIndex)] = clampColumnWidth(input.widthPx);
  widths[input.contentHash] = entry;
  writeStorage(input.sourcePath, widths);
}

export function resetTableWidths(sourcePath: string, contentHash: string): void {
  const widths = readStorage(sourcePath);
  if (!(contentHash in widths)) return;
  delete widths[contentHash];
  writeStorage(sourcePath, widths);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-table-width-preferences.test.ts`
Expected: PASS ×4

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts tests/unit/plugins/markdown-table-width-preferences.test.ts
git commit -m "feat(files): per-file markdown table column width preferences"
```

---

### Task 3: 列宽拖拽把手与 colgroup 应用

**Files:**
- Create: `src/plugins/builtin/files/renderer/markdown/table-resize.tsx`
- Modify: `src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx`（table 分支，L270-311）
- Modify: `src/plugins/builtin/files/renderer/markdown/prose.css`（把手样式）
- Test: `tests/unit/plugins/markdown-table-resize.test.tsx`

**Interfaces:**
- Consumes: Task 2 全部导出；`target.ts` 的 `contentHashForBlock(block)`；渲染上下文已有 `source: MarkdownDiskSource | undefined`（`ir-renderer.tsx:87`）
- Produces（ir-renderer 消费，逐字签名）:

```tsx
export interface TableColumnResizeState {
  widths: Record<string, number> | null;
  colgroup: ReactNode;
  headProps: (columnIndex: number) => {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  };
}
export function useTableColumnResize(input: {
  sourcePath: string | undefined;
  contentHash: string;
  columnCount: number;
}): TableColumnResizeState;
```

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/plugins/markdown-table-resize.test.tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TABLE_MIN_COLUMN_WIDTH_PX,
  readTableWidths,
  resetTableWidths,
} from "../../src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts";
import { useTableColumnResize } from "../../src/plugins/builtin/files/renderer/markdown/table-resize.tsx";

describe("useTableColumnResize", () => {
  beforeEach(() => {
    localStorage.clear();
    resetTableWidths("/t.md", "h1");
  });

  it("starts drag on pointerdown and persists delta on move", () => {
    const { result } = renderHook(() =>
      useTableColumnResize({ sourcePath: "/t.md", contentHash: "h1", columnCount: 3 })
    );
    const startWidth = 100;
    // Simulate: column starts at 100px (test seeds storage directly).
    act(() => {
      writeWidthForTest("/t.md", "h1", 0, startWidth);
    });
    const handle = result.current.headProps(0);
    act(() => {
      handle.onPointerDown({
        currentTarget: { getBoundingClientRect: () => ({ left: 200, width: 8 }) },
        pointerId: 1,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 260 }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(String(startWidth + 60));
  });

  it("double-click resets all widths for the table", () => {
    writeWidthForTest("/t.md", "h1", 0, 120);
    const { result } = renderHook(() =>
      useTableColumnResize({ sourcePath: "/t.md", contentHash: "h1", columnCount: 2 })
    );
    act(() => {
      result.current.headProps(0).onDoubleClick({ stopPropagation: () => {} } as React.MouseEvent);
    });
    expect(readTableWidths("/t.md", "h1")).toBeNull();
  });

  it("keyboard arrows adjust by 16px within min clamp", () => {
    writeWidthForTest("/t.md", "h1", 1, TABLE_MIN_COLUMN_WIDTH_PX + 4);
    const { result } = renderHook(() =>
      useTableColumnResize({ sourcePath: "/t.md", contentHash: "h1", columnCount: 2 })
    );
    act(() => {
      result.current.headProps(1).onKeyDown({
        key: "ArrowLeft",
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(readTableWidths("/t.md", "h1")?.["1"]).toBe(String(TABLE_MIN_COLUMN_WIDTH_PX));
  });
});
```

辅助函数放在测试文件顶部（vi.hoisted 不需要，直接 import write 后调用即可——补一行导入并实现）：

```tsx
import { writeTableColumnWidth as writeWidthForTest } from "../../src/plugins/builtin/files/renderer/markdown/table-width-preferences.ts";
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-table-resize.test.tsx`
Expected: FAIL（hook 不存在）

- [ ] **Step 3: 实现 hook 与把手渲染**

```tsx
// src/plugins/builtin/files/renderer/markdown/table-resize.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TABLE_MIN_COLUMN_WIDTH_PX,
  TABLE_WIDTHS_CHANGED_EVENT,
  clampColumnWidth,
  readTableWidths,
  resetTableWidths,
  writeTableColumnWidth,
} from "./table-width-preferences.ts";

export interface TableColumnResizeState {
  /** null = 表格处于 auto 自适应（无任何自定义宽度） */
  widths: Record<string, number> | null;
  /** 存在自定义宽度时渲染 <colgroup>，否则 null */
  colgroup: ReactNode;
  headProps: (columnIndex: number) => {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  };
}

interface DragState {
  columnIndex: number;
  startX: number;
  startWidth: number;
}

function columnWidthAt(widths: Record<string, number>, index: number): number {
  return widths[String(index)] ?? 0;
}

export function useTableColumnResize(input: {
  sourcePath: string | undefined;
  contentHash: string;
  columnCount: number;
}): TableColumnResizeState {
  const { sourcePath, contentHash, columnCount } = input;
  const [widths, setWidths] = useState<Record<string, number> | null>(() =>
    sourcePath ? readTableWidths(sourcePath, contentHash) : null
  );
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!sourcePath) return;
    const sync = () => setWidths(readTableWidths(sourcePath, contentHash));
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
  }, [sourcePath, contentHash]);

  const persist = useCallback(
    (columnIndex: number, widthPx: number) => {
      if (!sourcePath) return;
      writeTableColumnWidth({ sourcePath, contentHash, columnIndex, widthPx });
    },
    [sourcePath, contentHash]
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      persist(drag.columnIndex, clampColumnWidth(drag.startWidth + event.clientX - drag.startX));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.removeAttribute("data-md-col-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [persist]);

  const beginDrag = useCallback(
    (columnIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const current =
        columnWidthAt(widthsRef.current ?? {}, columnIndex) ||
        event.currentTarget.parentElement?.getBoundingClientRect().width ||
        TABLE_MIN_COLUMN_WIDTH_PX;
      dragRef.current = { columnIndex, startX: event.clientX, startWidth: current };
      document.body.setAttribute("data-md-col-resizing", "");
    },
    []
  );

  const headProps = useCallback(
    (columnIndex: number) => ({
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => beginDrag(columnIndex, event),
      onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!sourcePath) return;
        resetTableWidths(sourcePath, contentHash);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const current = columnWidthAt(widthsRef.current ?? {}, columnIndex);
        if (!current) return;
        const delta = event.key === "ArrowLeft" ? -16 : 16;
        persist(columnIndex, clampColumnWidth(current + delta));
      },
    }),
    [beginDrag, contentHash, persist, sourcePath]
  );

  const colgroup = useMemo(() => {
    if (!widths) return null;
    if (Object.keys(widths).length === 0) return null;
    return (
      <colgroup>
        {Array.from({ length: columnCount }, (_, index) => (
          <col
            key={index}
            style={widths[String(index)] ? { width: widths[String(index)] } : undefined}
          />
        ))}
      </colgroup>
    );
  }, [columnCount, widths]);

  return { widths, colgroup, headProps };
}

/** 把手元素（th 内绝对定位右缘）。 */
export function TableColumnResizeHandle(props: {
  ariaLabel: string;
  head: (columnIndex: number) => {
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  };
  columnIndex: number;
}) {
  return (
    <div
      {...props.head(props.columnIndex)}
      aria-label={props.ariaLabel}
      aria-orientation="vertical"
      role="separator"
      className="md-col-resizer"
      tabIndex={0}
    />
  );
}
```

`prose.css` 追加：

```css
[data-slot="markdown-prose"] .md-table-wrap th {
  position: relative;
}
[data-slot="markdown-prose"] .md-col-resizer {
  position: absolute;
  inset-block: 0;
  right: -4px;
  width: 8px;
  cursor: col-resize;
  z-index: 2;
}
[data-slot="markdown-prose"] .md-col-resizer:hover,
[data-slot="markdown-prose"] .md-col-resizer:focus-visible {
  background-color: color-mix(in oklab, var(--ring) 30%, transparent);
  outline: none;
}
body[data-md-col-resizing] * {
  user-select: none !important;
  cursor: col-resize !important;
}
```

`ir-renderer.tsx` table 分支改造（保持 `@pier/ui` 子组件组合）：`TableHead` 外包相对定位（prose.css 给 `[data-slot="markdown-prose"] .md-table-wrap th { position: relative; }`），内部：

```tsx
{header.cells.map((cell, index) => (
  <TableHead
    className={cn(tableAlignment(block.align[index]))}
    key={cellKey(cell)}
  >
    <div className="md-th-inner">
      {renderInlines(cell.children, context)}
      <TableColumnResizeHandle
        ariaLabel={labels.resizeColumn}
        columnIndex={index}
        head={resize.headProps}
      />
    </div>
  </TableHead>
))}
```

其中 `resize = useTableColumnResize({ sourcePath: context.source?.path, contentHash: contentHashForBlock(block) ?? "", columnCount: header.cells.length })`；存在 `resize.colgroup` 时把它插到 `<Table>` 子组件树的 `<table>` 首位并把 `table-layout: fixed` 经 `style` 挂上（无宽度时保持现状结构不动）。注意：`contentHashForBlock` 对空表返回 null 时直接不启用手把（传空串前先判空短路渲染）。i18n 标签经现有 labels 通道传入（见 Task 4）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-table-resize.test.tsx`
Expected: PASS ×3

- [ ] **Step 5: 回归既有预览测试**

Run: `pnpm vitest run tests/unit/plugins/markdown-preview.test.tsx`
Expected: PASS（table 分支改动不破坏既有断言）

- [ ] **Step 6: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/table-resize.tsx src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx src/plugins/builtin/files/renderer/markdown/prose.css tests/unit/plugins/markdown-table-resize.test.tsx
git commit -m "feat(files): drag-to-resize markdown preview table columns"
```

---

### Task 4: 把手焦点白名单与 i18n 文案

**Files:**
- Modify: `tests/unit/renderer/app/chart-focus-governance.test.ts`（tabIndex 白名单 Set）
- Modify: `src/plugins/builtin/files/locales/{en,zh-CN,ja,ko}.json`
- Modify: `src/plugins/builtin/files/renderer/panel/markdown-labels.ts` 与 `markdown/preview-defaults.ts`（label 通道）

**Interfaces:**
- Consumes: Task 3 的 `md-col-resizer`（含 `tabIndex={0}`）
- Produces: `DEFAULT_RENDERER_LABELS.resizeColumn: string`（Task 3 已引用）

- [ ] **Step 1: 登记白名单**

在 chart-focus-governance.test.ts 的 allow Set 中加入（保持既有排序位置插入）：

```ts
"src/plugins/builtin/files/renderer/markdown/table-resize.tsx", // table column resize separator (arrow-key adjustable, mirrors image diff slider)
```

- [ ] **Step 2: 四语言文案**

en.json（`messages` 下，紧邻现有 `filePanel.markdown.*`）：

```json
"filePanel.markdown.resizeColumn": "Drag to adjust column display width. Double-click to reset.",
```

zh-CN.json：

```json
"filePanel.markdown.resizeColumn": "拖动调整此列显示宽度，双击恢复自适应。",
```

ja.json：

```json
"filePanel.markdown.resizeColumn": "ドラッグで列の表示幅を調整します。ダブルクリックでリセット。",
```

ko.json：

```json
"filePanel.markdown.resizeColumn": "드래그하여 열 표시 너비를 조정합니다. 두 번 클릭하면 초기화됩니다.",
```

- [ ] **Step 3: 接通 label 通道**

`preview-defaults.ts` 的 `DEFAULT_RENDERER_LABELS` 增加 `resizeColumn: "Drag to adjust this column's display width. Double-click to reset."`；`panel/markdown-labels.ts` 的对应工厂增加 `resizeColumn: t("filePanel.markdown.resizeColumn", "<同 en fallback>")`。（若该工厂为逐字段构造则照抄相邻字段模式。）

- [ ] **Step 4: 验证**

Run: `pnpm vitest run tests/unit/renderer/app/chart-focus-governance.test.ts tests/unit/renderer/app/user-copy-governance.test.ts`
Expected: PASS ×2（白名单命中、四语言无实现词）

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add tests/unit/renderer/app/chart-focus-governance.test.ts src/plugins/builtin/files/locales src/plugins/builtin/files/renderer/panel/markdown-labels.ts src/plugins/builtin/files/renderer/markdown/preview-defaults.ts
git commit -m "feat(files): i18n labels and focus whitelist for table resize handle"
```

---

### Task 5: 标题锚点复制

**Files:**
- Modify: `src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx`（heading 分支 L151-160）
- Modify: `src/plugins/builtin/files/renderer/markdown/prose.css`
- Test: `tests/unit/plugins/markdown-heading-anchor-copy.test.tsx`

**Interfaces:**
- Consumes: 渲染上下文 `source.path`（已存在）；heading `block.id`（GithubSlugger 产物）；`cross-mode-anchor.ts` 的 slug 即该 id（粘贴回 Pier 由既有锚点解析定位）
- Produces: 复制产物格式 `"<sourcePath>#<headingId>"`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/plugins/markdown-heading-anchor-copy.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// 复用 markdown-preview.test.tsx 的注入范式：真实 parse + 假 runtime。
// 断言：hover 标题出现复制按钮；点击写入剪贴板 "<path>#<slug>" 并弹 toast key。

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

import { MarkdownPreview } from "../../src/plugins/builtin/files/renderer/markdown/preview.tsx";
// runtime/source/labels 构造与 tests/unit/plugins/markdown-preview.test.tsx 保持一致（immediateRuntime 工厂照抄）。

describe("heading anchor copy", () => {
  it("copies path#slug on button click", async () => {
    render(
      <MarkdownPreview
        sessionId="s1"
        value={"# Hello World\n\nbody"}
        source={{ kind: "disk", path: "/docs/a.md", root: "/docs" }}
        openExternal={vi.fn()}
        // …其余必填 props 与既有测试相同
      />
    );
    const button = screen.getByRole("button", { name: /copy.*anchor|复制.*锚点/i });
    fireEvent.click(button);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/docs/a.md#hello-world")
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-heading-anchor-copy.test.tsx`
Expected: FAIL（找不到按钮）

- [ ] **Step 3: 实现**

heading 分支改为（保留原 createElement 结构，包一层 group 容器）：

```tsx
case "heading": {
  return createElement(
    `h${block.depth}`,
    {
      ...sourceBlockProps(block.range, context, {
        className: `${headingClassName(block.depth)} md-heading-group`,
        id: block.id,
      }),
    },
    renderInlines(block.children, context),
    context.source
      ? createElement(
          "button",
          {
            "aria-label": context.labels.copyAnchor,
            className: "md-anchor-copy",
            type: "button",
            onClick: async (event: MouseEvent) => {
              event.stopPropagation();
              try {
                await navigator.clipboard.writeText(`${context.source!.path}#${block.id}`);
                toast.success(context.labels.anchorCopied);
              } catch {
                showAppAlertFallback(); // 剪贴板失败走宿主 alert 通道（见下）
              }
            },
          },
          createElement(LinkIcon) // lucide-react Link2
        )
      : null
  );
}
```

toast 从 `sonner` 直接 import（AGENTS 操作反馈规范：宿主插件 renderer 允许；若 lint 报边界则改走 `context.notifications` 等价面——以实际 PluginContext 类型为准）。剪贴板失败分支：复用本插件既有错误上报路径（grep `clipboardFailed` 在 editor 侧的用法并对齐）。

`prose.css` 追加：

```css
[data-slot="markdown-prose"] .md-heading-group {
  position: relative;
}
[data-slot="markdown-prose"] .md-anchor-copy {
  opacity: 0;
  margin-left: 0.5em;
  vertical-align: middle;
}
[data-slot="markdown-prose"] .md-heading-group:hover .md-anchor-copy,
[data-slot="markdown-prose"] .md-anchor-copy:focus-visible {
  opacity: 1;
}
```

- [ ] **Step 4: 运行确认通过 + i18n 补齐（同 Task 4 模式，新增 key）**

新增四语言 key：`filePanel.markdown.copyAnchor`（aria："Copy heading anchor"/「复制标题锚点链接」）、`filePanel.markdown.anchorCopied`（toast："Anchor copied"/「锚点已复制」）。落点同 Task 4 Step 3 两个文件。

Run: `pnpm vitest run tests/unit/plugins/markdown-heading-anchor-copy.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx src/plugins/builtin/files/renderer/markdown/prose.css src/plugins/builtin/files/locales src/plugins/builtin/files/renderer/markdown/preview-defaults.ts tests/unit/plugins/markdown-heading-anchor-copy.test.tsx
git commit -m "feat(files): copy heading anchors from markdown preview"
```

---

### Task 6: 脚注 hover 浮层

**Files:**
- Create: `src/plugins/builtin/files/renderer/markdown/footnote-popover.tsx`
- Modify: `src/plugins/builtin/files/renderer/markdown/ir-inlines.tsx`（footnoteReference 分支 L153-165）
- Test: `tests/unit/plugins/markdown-footnote-popover.test.tsx`

**Interfaces:**
- Consumes: 定义块 DOM 锚 `#footnote-${identifier}`（ir-renderer L359-367 已渲染）；浮层挂 `createPortal(document.body)` + 视口钳制
- Produces: `<sup>` hover 时显示定义内容浮层；点击跳转行为不变

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/plugins/markdown-footnote-popover.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// 同样复用 markdown-preview.test.tsx 注入范式；value 含：
// "Text[^1]\n\n[^1]: The footnote body."
// 断言：fireEvent.mouseEnter sup 引用 → 出现包含 "The footnote body." 的浮层；
// mouseLeave → 浮层移除；点击仍触发 onOpenAnchor（以 props spy 断言）。
```

（测试主体照抄 Task 5 的构造骨架，仅替换 value 与三组断言——此处不再整段重复。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-footnote-popover.test.tsx`
Expected: FAIL（无浮层）

- [ ] **Step 3: 实现组件与接入**

```tsx
// src/plugins/builtin/files/renderer/markdown/footnote-popover.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Floating definition preview for a footnote reference.
 * Content is cloned from the already-rendered (sanitized-by-construction)
 * definition node `#footnote-${identifier}` inside the preview root, so the
 * popover always matches what clicking through would show.
 */
export function FootnotePopover(props: {
  identifier: string;
  anchorElement: HTMLElement;
  searchRoot: HTMLElement | null;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const update = () => setRect(props.anchorElement.getBoundingClientRect());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [props.anchorElement]);

  useEffect(() => {
    const root = props.searchRoot ?? props.anchorElement.ownerDocument.body;
    const definition = root.querySelector(`[id="footnote-${CSS.escape(props.identifier)}"]`);
    setContent(definition ? definition.innerHTML : null);
  }, [props.identifier, props.searchRoot]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  if (!rect || !content) return null;
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 340);
  const top = rect.top > 220 ? rect.top - 12 : rect.bottom + 12;
  return createPortal(
    <div
      className="md-footnote-popover"
      role="tooltip"
      style={{ left, top: top > rect.top ? top : undefined, bottom: top <= rect.top ? window.innerHeight - rect.top + 12 : undefined }}
      dangerouslySetInnerHTML={{ __html: content }}
    />,
    document.body
  );
}
```

`ir-inlines.tsx` reference 分支：外层 `<sup>` 增加 `onMouseEnter/onMouseLeave/onFocus/onBlur` 状态（useState 存 hovered），hovered 且能取到最近预览根（`(anchorEl.closest("[data-scrollbar]") as HTMLElement | null) ?? anchorEl.ownerDocument.body`）时挂 `<FootnotePopover identifier={inline.identifier} anchorElement={supRef.current!} searchRoot={…} />`；onClick 跳转逻辑原样保留。`dangerouslySetInnerHTML` 安全性依据：内容是本渲染器产出的 DOM 序列化，非外部输入。

`prose.css` 追加浮层样式（语义 token、圆角、阴影、max-width 320px、z-index 高于 sticky 表头）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-footnote-popover.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/footnote-popover.tsx src/plugins/builtin/files/renderer/markdown/ir-inlines.tsx src/plugins/builtin/files/renderer/markdown/prose.css tests/unit/plugins/markdown-footnote-popover.test.tsx
git commit -m "feat(files): hover popover for markdown footnote references"
```

---

### Task 7: 全局代码换行开关（复用 pier.files.editor.wordWrap）

**Files:**
- Modify: `src/plugins/builtin/files/renderer/markdown/preview-preferences.ts`（store 增内存态 `codeWrap` + 绑定函数）
- Modify: `src/plugins/builtin/files/renderer/markdown/code-block.tsx`（头部动作区加切换按钮 + pre-wrap 应用）
- Modify: `src/plugins/builtin/files/renderer/index.tsx`（activate 中绑定，参照 `bindMarkdownSettingsFromConfiguration` 注册点）
- Test: `tests/unit/plugins/markdown-code-wrap.test.tsx`

**Interfaces:**
- Consumes: `FILES_EDITOR_WORD_WRAP_SETTING_KEY`（settings.ts:30）；`PluginConfigurationApi.get/onDidChange/set`（src/plugins/api/configuration.ts）；既有 `filePanel.editor.action.wordWrap.on/off` i18n key
- Produces: `useMarkdownPreviewPrefsStore` 新增字段 `codeWrap: boolean`（内存态，durable source 是 configuration）；`bindMarkdownCodeWrapFromConfiguration(configuration: Pick<RendererPluginContext["configuration"], "get" | "onDidChange">): () => void`；`MarkdownCodeBlock` 新 props `wordWrap: boolean` / `onToggleWordWrap?: () => void`（写回由挂载壳经 `configuration.set` 完成，单向链：UI→set→onDidChange→store）

- [ ] **Step 1: 写失败测试**

```tsx
// tests/unit/plugins/markdown-code-wrap.test.tsx
import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindMarkdownCodeWrapFromConfiguration,
  useMarkdownPreviewPrefsStore,
} from "../../src/plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { MarkdownCodeBlock } from "../../src/plugins/builtin/files/renderer/markdown/code-block.tsx";

const listeners = new Set<(event: { key: string }) => void>();
const state = { wordWrap: false };
const configuration = {
  get: (key: string) => (key === "pier.files.editor.wordWrap" ? state.wordWrap : undefined),
  onDidChange: (listener: (event: { key: string }) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

function setKey(key: string, value: boolean) {
  state.wordWrap = value;
  for (const listener of listeners) listener({ key });
}

describe("markdown code wrap binding", () => {
  afterEach(() => {
    useMarkdownPreviewPrefsStore.setState({ codeWrap: false });
  });

  it("mirrors configuration into store and stops after dispose", () => {
    const dispose = bindMarkdownCodeWrapFromConfiguration(configuration);
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(false);
    act(() => setKey("pier.files.editor.wordWrap", true));
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(true);
    dispose();
    act(() => setKey("pier.files.editor.wordWrap", false));
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(true);
  });
});

describe("code block wrap toggle button", () => {
  it("invokes toggle handler", () => {
    const onToggleWordWrap = vi.fn();
    render(
      <MarkdownCodeBlock
        code={"a".repeat(80)}
        labels={{
          copiedCode: "Copied",
          copyCode: "Copy code",
          wrapOn: "Word Wrap: On",
          wrapOff: "Word Wrap: Off",
        }}
        onToggleWordWrap={onToggleWordWrap}
        wordWrap={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Word Wrap: Off" }));
    expect(onToggleWordWrap).toHaveBeenCalledTimes(1);
  });
});
```

（若 `MarkdownCodeBlock` 存在本测试未传的必填 prop，按 `tests/unit/plugins/markdown-preview.test.tsx` 中该组件的实际渲染处补齐同值——以 TS 编译报错为准逐个补。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-code-wrap.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

`preview-preferences.ts`：接口与 store 增 `codeWrap: boolean` + `setCodeWrap`（仅内存，同 blockHeightLimit 先例，注释注明 durable source 是 plugin configuration）；新增：

```ts
export function bindMarkdownCodeWrapFromConfiguration(
  configuration: Pick<RendererPluginContext["configuration"], "get" | "onDidChange">
): () => void {
  const KEY = FILES_EDITOR_WORD_WRAP_SETTING_KEY; // import 自 ../../settings.ts
  const apply = () =>
    useMarkdownPreviewPrefsStore.setState({ codeWrap: configuration.get(KEY) === true });
  apply();
  return configuration.onDidChange((event) => {
    if (event.key === KEY) apply();
  });
}
```

`MarkdownCodeBlock`：新 props `wordWrap: boolean` 与可选 `onToggleWordWrap?: () => void`；头部 Copy 旁加图标按钮（lucide `WrapText`，`size="icon-xs"`，aria-label 取 `labels.wrapOn/wrapOff`），onClick 调 `onToggleWordWrap`；`pre` 元素 className 按 `wordWrap` 加 `whitespace-pre-wrap`。`MarkdownRendererLabels`/defaults 增加 `wrapOn/wrapOff`，值复用既有 locale key `filePanel.editor.action.wordWrap.on/off`（在 panel/markdown-labels.ts 工厂里 `t()` 引用，不新增 key）。挂载壳接线：grep `copyCode=` 定位 `<MarkdownPreview>` 的调用点，在同处以插件 `context.configuration` 定义 `onToggleWordWrap={() => context.configuration.set(FILES_EDITOR_WORD_WRAP_SETTING_KEY, context.configuration.get(FILES_EDITOR_WORD_WRAP_SETTING_KEY) !== true)}`；`index.tsx` activate 内注册 `bindMarkdownCodeWrapFromConfiguration(context.configuration)`（dispose 进既有 disposers 数组，紧邻 bindMarkdownSettingsFromConfiguration 调用处）。

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `pnpm vitest run tests/unit/plugins/markdown-code-wrap.test.tsx tests/unit/plugins/markdown-preview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/preview-preferences.ts src/plugins/builtin/files/renderer/markdown/code-block.tsx src/plugins/builtin/files/renderer/index.tsx tests/unit/plugins/markdown-code-wrap.test.tsx
git commit -m "feat(files): unified code word-wrap toggle across editor and preview"
```

---

### Task 8: 阅读位置记忆

**Files:**
- Create: `src/plugins/builtin/files/renderer/markdown/scroll-memory.ts`
- Modify: `src/plugins/builtin/files/renderer/markdown/preview.tsx`（scrollRootRef 挂捕获/恢复）
- Test: `tests/unit/plugins/markdown-scroll-memory.test.ts`

**Interfaces:**
- Consumes: `preview.tsx` 的 `value`（全文，用于哈希失效）与 `source.path`；`initialAnchor` 有值时让位（跨模式锚点优先）
- Produces:

```ts
export function rememberScrollPosition(input: { sourcePath: string; source: string; top: number }): void;
export function recallScrollPosition(input: { sourcePath: string; source: string }): number | null;
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/plugins/markdown-scroll-memory.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  recallScrollPosition,
  rememberScrollPosition,
} from "../../src/plugins/builtin/files/renderer/markdown/scroll-memory.ts";

describe("scroll memory", () => {
  beforeEach(() => localStorage.clear());

  it("recalls position while source unchanged", () => {
    rememberScrollPosition({ sourcePath: "/m.md", source: "abc", top: 480 });
    expect(recallScrollPosition({ sourcePath: "/m.md", source: "abc" })).toBe(480);
  });

  it("drops memory when source changed", () => {
    rememberScrollPosition({ sourcePath: "/m.md", source: "abc", top: 480 });
    expect(recallScrollPosition({ sourcePath: "/m.md", source: "abcd" })).toBeNull();
  });

  it("ignores zero-top captures (panel hidden guard)", () => {
    rememberScrollPosition({ sourcePath: "/z.md", source: "x", top: 0 });
    expect(recallScrollPosition({ sourcePath: "/z.md", source: "x" })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-scroll-memory.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/plugins/builtin/files/renderer/markdown/scroll-memory.ts
const STORAGE_PREFIX = "pier.files.markdown.scroll:";

function djb2(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return String(hash);
}

export function rememberScrollPosition(input: {
  sourcePath: string;
  source: string;
  top: number;
}): void {
  if (!(input.top > 0)) return; // hidden-panel scrollTop=0 must not poison memory (view-scroll-capture 先例)
  try {
    globalThis.localStorage?.setItem(
      `${STORAGE_PREFIX}${input.sourcePath}`,
      JSON.stringify({ h: djb2(input.source), top: Math.round(input.top) })
    );
  } catch {
    /* degrade silently */
  }
}

export function recallScrollPosition(input: {
  sourcePath: string;
  source: string;
}): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${input.sourcePath}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { h: string; top: number };
    return parsed.h === djb2(input.source) && parsed.top > 0 ? parsed.top : null;
  } catch {
    return null;
  }
}
```

`preview.tsx` 接入：滚动容器 `onScroll` 里 `lodash` 式手写 debounce（250ms trailing，`useRef` 定时器）调 `rememberScrollPosition({ sourcePath: source.path, source: value, top: el.scrollTop })`；挂载后 `requestAnimationFrame` 两帧（等分页布局完成）且 `initialAnchor == null && contentAnchorRequestId == null` 时 `el.scrollTop = recallScrollPosition(...) ?? 0`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-scroll-memory.test.ts`
Expected: PASS ×3

- [ ] **Step 5: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/scroll-memory.ts src/plugins/builtin/files/renderer/markdown/preview.tsx tests/unit/plugins/markdown-scroll-memory.test.ts
git commit -m "feat(files): per-file markdown reading position memory"
```

---

### Task 9: 图片全屏缺口审计与补缺

**Files:**
- Audit targets（只读）: `packages/ui/src/image-preview/{canvas.tsx,controls.tsx,media-fullscreen-button.tsx}`；宿主 contentPreview 提供面（从 `resources.contentPreview` 类型定义处顺藤摸瓜，`resource-elements.tsx:267`）
- Modify: 视审计结论而定（预期 `resource-elements.tsx` 或宿主 image surface 增「复制图片」动作）

**Interfaces:**
- Consumes: `resources.filePreviews.issue/release`（已用于内联图）；zoom/pan 基建（use-zoom-pan-viewport）
- Produces: 审计记录 + 缺口实现（预期为剪贴板复制位图）

- [ ] **Step 1: 审计（产出勾选清单，不写码）**

核对三点并记录 文件:行号 证据：(a) 全屏视图是否已支持 zoom/pan；(b) 是否已有复制图片动作；(c) 是否有「在目录树中显示」。已知 zoom/pan 基建存在于包内（use-zoom-pan-viewport.ts），确认其确实被 canvas.tsx 消费。

- [ ] **Step 2: 仅对确认缺口实现（预期形态）**

复制位图（挂在全屏工具栏，紧邻既有控件）：

```tsx
async function copyImage(url: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
```

成功弱反馈 toast（复用 Task 5 的 toast 通道与 i18n 模式：`filePanel.markdown.imageCopied` 四语言）。若审计发现 reveal 动作宿主已有命令（grep command-ids.ts `reveal|locate`），则以插件 action 形式接入；若无现成命令则放弃该项并在计划执行报告中注明原因（不发明新 IPC）。

- [ ] **Step 3: 验证**

Run: `pnpm dev` 手动冒烟：md 内联图 → 全屏 → 缩放平移可用 → 复制成功提示 → 粘贴到访达验证位图。
另跑：`pnpm vitest run tests/unit/plugins/markdown-preview.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit（如有代码改动；先展示 staged diff 获用户确认）**

```bash
git add -u src/plugins/builtin/files src/renderer
git commit -m "feat(files): clipboard copy for fullscreen markdown images"
```

---

### Task 10: 任务列表回写源文件

**Files:**
- Modify: `src/plugins/builtin/files/renderer/panel/body.tsx`（下发回调）
- Modify: `src/plugins/builtin/files/renderer/markdown/preview.tsx`（透传）
- Modify: `src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx`（list/task 分支 L234-258 启用交互）
- Test: `tests/unit/plugins/markdown-task-toggle.test.tsx` + `tests/unit/plugins/markdown-task-patch.test.ts`

**Interfaces:**
- Consumes: `updateDocumentContents(documentId: string, contents: string): void`（document/state-actions.ts:153，经 store 导出）；`FileDocument.id`（types.ts）；IR list item `range.startOffset/endOffset` 与 `checked`
- Produces: `MarkdownPreview` 新可选 prop `onToggleTask?: (input: { rangeStart: number; rangeEnd: number; checked: boolean }) => void`——由 body.tsx 实现为文档事务

- [ ] **Step 1: 纯函数补丁的失败测试**

```ts
// tests/unit/plugins/markdown-task-patch.test.ts
import { describe, expect, it } from "vitest";
import { patchTaskMarker } from "../../src/plugins/builtin/files/renderer/markdown/task-patch.ts";

describe("patchTaskMarker", () => {
  const doc = "- [ ] alpha\n- [x] beta\n- [X] gamma";

  it("checks an unchecked item within range", () => {
    expect(patchTaskMarker(doc, { start: 0, end: 11 }, true)).toBe("- [x] alpha\n- [x] beta\n- [X] gamma");
  });

  it("unchecks checked items (lowercase x)", () => {
    expect(patchTaskMarker(doc, { start: 12, end: 23 }, false)).toBe("- [ ] alpha\n- [ ] beta\n- [X] gamma");
  });

  it("normalizes uppercase X when checking then unchecking", () => {
    const patched = patchTaskMarker(doc, { start: 24, end: 37 }, false);
    expect(patched.split("\n")[2]).toBe("- [ ] gamma");
  });

  it("preserves CRLF documents", () => {
    const crlf = "- [ ] one\r\n- [ ] two";
    expect(patchTaskMarker(crlf, { start: 12, end: 20 }, true)).toBe("- [ ] one\r\n- [x] two");
  });

  it("returns original when no marker found (nested edge)", () => {
    expect(patchTaskMarker("> quoted", { start: 0, end: 8 }, true)).toBe("> quoted");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/plugins/markdown-task-patch.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```ts
// src/plugins/builtin/files/renderer/markdown/task-patch.ts
export interface TaskRange {
  start: number;
  end: number;
}

/**
 * Byte-minimal task marker flip inside [start, end). Never reflows the rest
 * of the document; returns the original string when no GFM marker exists in
 * the slice (defensive against IR/drift mismatches).
 */
export function patchTaskMarker(
  contents: string,
  range: TaskRange,
  checked: boolean
): string {
  const slice = contents.slice(range.start, range.end);
  const marker = /\[( |x|X)\]/.exec(slice);
  if (!marker) return contents;
  const next = `[${checked ? "x" : " "}]`;
  const patchedSlice =
    slice.slice(0, marker.index) + next + slice.slice(marker.index + marker[0].length);
  return contents.slice(0, range.start) + patchedSlice + contents.slice(range.end);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/plugins/markdown-task-patch.test.ts`
Expected: PASS ×5

- [ ] **Step 5: 组件级失败测试（事务派发）**

```tsx
// tests/unit/plugins/markdown-task-toggle.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "../../src/plugins/builtin/files/renderer/markdown/preview.tsx";
// runtime/source/labels 构造照抄 tests/unit/plugins/markdown-preview.test.tsx 的 immediateRuntime 工厂。

const onToggleTask = vi.fn();

function renderPreview() {
  return render(
    <MarkdownPreview
      sessionId="task-1"
      value="- [ ] alpha"
      source={{ kind: "disk" as const, path: "/t.md", root: "/t" }}
      openExternal={vi.fn()}
      onToggleTask={onToggleTask}
      /* …其余必填 props 与 markdown-preview.test.tsx 相同 */
    />
  );
}

describe("preview task checkbox", () => {
  it("is interactive and dispatches range patch request", () => {
    renderPreview();
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(onToggleTask).toHaveBeenCalledWith({ rangeStart: 0, rangeEnd: 10, checked: true });
  });

  it("reflects optimistic checked state immediately", () => {
    renderPreview();
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    // Radix Checkbox 以 data-state 表达；乐观翻转后应为 "checked"。
    expect(box).toHaveAttribute("data-state", "checked");
  });
});
```

Run: `pnpm vitest run tests/unit/plugins/markdown-task-toggle.test.tsx`
Expected: FAIL

- [ ] **Step 6: 接线实现**

`ir-renderer.tsx` list/task 分支：props 增 `onToggleTask`（沿 `MarkdownIrRendererProps` → context 一路透传，与 `copyCode` 同模式）；Checkbox 改为：

```tsx
<Checkbox
  aria-label={item.checked ? context.labels.completedTask : context.labels.incompleteTask}
  checked={optimisticChecked ?? item.checked}
  className="mt-1.5"
  onCheckedChange={
    context.onToggleTask && item.checked !== null
      ? (next) => {
          setOptimisticChecked(next === true);
          context.onToggleTask!({
            rangeStart: item.range.startOffset,
            rangeEnd: item.range.endOffset,
            checked: next === true,
          });
        }
      : undefined
  }
/>
```

乐观态用局部 `useState`，在块重解析（contentHash 变化）时复位——`ir-blocks.tsx` 已按 contentHash 记忆化，天然触发重挂载即清零。

`preview.tsx`：透传 prop。`panel/body.tsx`（MarkdownPreview 挂载处）：

```tsx
onToggleTask={
  document && viewModeSupportsEdit(document)
    ? ({ rangeStart, rangeEnd, checked }) => {
        const next = patchTaskMarker(document.currentContents, { start: rangeStart, end: rangeEnd }, checked);
        if (next !== document.currentContents) {
          updateDocumentContents(document.id, next); // 唯一写入口；脏态/autosave/CAS 冲突全部继承
        }
      }
    : undefined
}
```

`updateDocumentContents` 从 document/store 导入（store.ts 动作解构处已导出）；`viewModeSupportsEdit` 即「非 diskConflict 冻结态」判断——直接复用 saver 侧现有守卫谓词（`disk-protection.ts` 的 `authorizeDiskReplace` 场景之外，冲突态下按钮自然无效：replaceDocument 内部已有保护；此处仅需判 `document.diskConflict` 时不启用回调）。**撤销语义如实呈现**：预览模式 CM 未挂载，本次写入不入 CM history（模型→CM 回写 addToHistory:false）；进入 source 后不可 Cmd+Z 此变更——在 PR 描述中注明，不阻塞。

- [ ] **Step 7: 组件测试确认通过 + 回归**

Run: `pnpm vitest run tests/unit/plugins/markdown-task-toggle.test.tsx tests/unit/plugins/markdown-preview.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit（先展示 staged diff 获用户确认）**

```bash
git add src/plugins/builtin/files/renderer/markdown/task-patch.ts src/plugins/builtin/files/renderer/markdown/ir-renderer.tsx src/plugins/builtin/files/renderer/markdown/preview.tsx src/plugins/builtin/files/renderer/panel/body.tsx tests/unit/plugins/markdown-task-patch.test.ts tests/unit/plugins/markdown-task-toggle.test.tsx
git commit -m "feat(files): toggle task checkboxes from markdown preview via document model"
```

---

### Task 11: 全量验证与收尾

**Files:** 无新增（只跑检查与手动冒烟）

- [ ] **Step 1: 静态门禁**

Run: `pnpm typecheck && pnpm lint && pnpm check:file-size && pnpm check:dir-density`
Expected: 全绿（重点盯 ir-renderer.tsx 是否逼近 500 行上限——若超限，把 table 渲染子树抽到 `markdown/table-view.tsx` 再复跑）

- [ ] **Step 2: 相关测试全量**

Run: `pnpm vitest run tests/unit/plugins/ tests/unit/renderer/app/user-copy-governance.test.ts tests/unit/renderer/app/chart-focus-governance.test.ts`
Expected: PASS

- [ ] **Step 3: 手动冒烟（pnpm dev）**

清单（对照 spec「验证」节）：
1. 长 URL / 长 code span 表格 → 单元格折行，列不被撑宽。
2. 拖拽列宽 → 重启 app 后保留；双击复位；改表格内容 → 旧宽度失效。
3. 代码块换行开关 → 编辑器与预览联动同一配置。
4. 标题 hover → 复制 `path#slug`，粘回 Pier 跳转正确。
5. 脚注 hover 浮层内容与点击跳转目标一致。
6. 图片全屏缩放/复制（按 Task 9 审计结论）。
7. 重开文件回到上次阅读位置；跳转锚点时不受记忆干扰。
8. 任务列表：预览勾选 → 落盘字节最小变更 → source 可见 → 外部改文件后勾选触发 saver 冲突策略。
9. 分页视图（pagination-view）下重复 1 与 2 的表现核对。

- [ ] **Step 4: 收尾提交（如冒烟产生修补；先展示 staged diff 获用户确认）**

```bash
git add -u
git commit -m "fix(files): address smoke-test findings for markdown preview capabilities"
```
