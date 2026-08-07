import type { CodeViewLineSelection } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";

type SelectionSide = "additions" | "deletions";

export interface DiffPointerLineHit {
  readonly fromNumberColumn: boolean;
  readonly id: string;
  readonly lineNumber: number;
  readonly side: SelectionSide;
}

/** 正文拖选超过该像素才写入行选，避免「点一下 = 选中当前行」。 */
export const CONTENT_DRAG_THRESHOLD_PX = 4;

function isElement(value: EventTarget | null | undefined): value is Element {
  return value instanceof Element;
}

function parseLineNumber(value: string | null): number | null {
  if (value == null || value === "") {
    return null;
  }
  const lineNumber = Number.parseInt(value, 10);
  return Number.isFinite(lineNumber) ? lineNumber : null;
}

function sideFromElements(
  lineElement: Element | null,
  codeElement: Element | null
): SelectionSide {
  if (codeElement?.hasAttribute("data-deletions")) {
    return "deletions";
  }
  if (codeElement?.hasAttribute("data-additions")) {
    return "additions";
  }
  const lineType = lineElement?.getAttribute("data-line-type") ?? "";
  if (lineType.includes("deletion")) {
    return "deletions";
  }
  return "additions";
}

function itemIdFromPath(
  path: readonly EventTarget[],
  viewer: CodeViewHandle<PierDiffAnnotationMetadata>
): string | null {
  const rendered = viewer.getInstance()?.getRenderedItems() ?? [];
  if (rendered.length === 0) {
    return null;
  }
  for (const node of path) {
    if (!isElement(node)) {
      continue;
    }
    for (const item of rendered) {
      if (item.element === node) {
        return item.id;
      }
    }
  }
  return null;
}

/**
 * Pierre 默认 + 按钮 / gutter utility 槽（含 shadow 内节点）。
 * 与 InteractionManager.isGutterUtilityPath 对齐。
 */
export function isGutterUtilityPath(path: readonly EventTarget[]): boolean {
  for (const node of path) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (
      node.hasAttribute("data-utility-button") ||
      node.hasAttribute("data-gutter-utility-slot") ||
      node.getAttribute("slot") === "gutter-utility-slot" ||
      node.getAttribute("name") === "gutter-utility-slot"
    ) {
      return true;
    }
  }
  return false;
}

function hitFromPath(
  path: readonly EventTarget[],
  viewer: CodeViewHandle<PierDiffAnnotationMetadata>
): DiffPointerLineHit | null {
  let lineElement: Element | null = null;
  let numberElement: Element | null = null;
  let codeElement: Element | null = null;
  for (const node of path) {
    if (!isElement(node)) {
      continue;
    }
    if (!numberElement && node.hasAttribute("data-column-number")) {
      numberElement = node;
    }
    if (!lineElement && node.hasAttribute("data-line")) {
      lineElement = node;
    }
    if (!codeElement && node.hasAttribute("data-code")) {
      codeElement = node;
    }
    if (lineElement && numberElement && codeElement) {
      break;
    }
  }
  const marker = lineElement ?? numberElement;
  if (!marker) {
    return null;
  }
  const lineNumber = parseLineNumber(
    marker.getAttribute("data-line") ??
      marker.getAttribute("data-column-number")
  );
  if (lineNumber == null) {
    return null;
  }
  const id = itemIdFromPath(path, viewer);
  if (!id) {
    return null;
  }
  return {
    fromNumberColumn:
      numberElement != null && lineElement == null
        ? true
        : numberElement != null &&
          path.indexOf(numberElement) <
            (lineElement
              ? path.indexOf(lineElement)
              : Number.POSITIVE_INFINITY),
    id,
    lineNumber,
    side: sideFromElements(lineElement ?? numberElement, codeElement),
  };
}

function pathFromPoint(clientX: number, clientY: number): EventTarget[] {
  // jsdom 等测试环境可能没有 elementFromPoint。
  if (typeof document.elementFromPoint !== "function") {
    return [];
  }
  // open shadow 下 document.elementFromPoint 已返回最深节点；再沿 host 爬出 shadow。
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) {
    return [];
  }
  const path: EventTarget[] = [];
  let node: Element | null = el;
  while (node) {
    path.push(node);
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) {
      path.push(root);
      node = root.host;
      continue;
    }
    node = node.parentElement;
  }
  return path;
}

/**
 * 从 pointer 事件解析 diff 行命中（行号栏 / 正文）。
 * 优先 composedPath；拖选时 path 可能落在缝隙，再 fallback 到坐标 hit-test。
 */
export function resolveDiffPointerLineHit(
  event: Pick<PointerEvent, "composedPath" | "target" | "clientX" | "clientY">,
  viewer: CodeViewHandle<PierDiffAnnotationMetadata> | null | undefined
): DiffPointerLineHit | null {
  if (!viewer) {
    return null;
  }
  const fromEventPath = hitFromPath(event.composedPath(), viewer);
  if (fromEventPath) {
    return fromEventPath;
  }
  if (!(Number.isFinite(event.clientX) && Number.isFinite(event.clientY))) {
    return null;
  }
  return hitFromPath(pathFromPoint(event.clientX, event.clientY), viewer);
}

export function selectionFromPointerDrag(
  anchor: DiffPointerLineHit,
  current: DiffPointerLineHit
): CodeViewLineSelection | null {
  if (anchor.id !== current.id) {
    return null;
  }
  // 跨侧拖选时钉在锚点侧，避免拼出无意义的跨栏 range。
  const side = anchor.side;
  if (current.side !== side) {
    return {
      id: anchor.id,
      range: {
        end: anchor.lineNumber,
        side,
        start: anchor.lineNumber,
      },
    };
  }
  return {
    id: anchor.id,
    range: {
      end: current.lineNumber,
      side,
      start: anchor.lineNumber,
    },
  };
}

export function clearBrowserTextSelection(): void {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
}

function normalizeSelectionText(raw: string): string {
  return raw.replace(/\u00a0/g, " ");
}

/**
 * 浏览器字符选区是否落在 diff 代码正文（含 open shadow 内节点）。
 * 沿 parentNode / ShadowRoot.host 上爬，不读 host 的 shadow 属性。
 */
export function isDiffCodeSelection(selection: Selection | null): boolean {
  if (!(selection && selection.rangeCount > 0)) {
    return false;
  }
  let current: Node | null = selection.getRangeAt(0).commonAncestorContainer;
  while (current) {
    if (
      current instanceof Element &&
      (current.hasAttribute("data-line") ||
        current.hasAttribute("data-code") ||
        current.hasAttribute("data-content") ||
        current.tagName === "PRE" ||
        current.getAttribute("data-testid") === "pierre-diff-root")
    ) {
      return true;
    }
    if (current.parentNode) {
      current = current.parentNode;
      continue;
    }
    if (current instanceof ShadowRoot) {
      current = current.host;
      continue;
    }
    break;
  }
  return false;
}

/**
 * 浏览器字符选区文本；无有效 range 时返回 ""。
 * 不依赖 `selection.isCollapsed`（shadow 内偶发误报）。
 * 顺序：range.toString → 临时节点 innerText（保留换行）→ textContent → selection.toString。
 */
export function readBrowserSelectedText(): string {
  const selection = window.getSelection();
  if (!(selection && selection.rangeCount > 0)) {
    return "";
  }
  const parts: string[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) {
      continue;
    }
    let piece = range.toString();
    if (piece.length === 0) {
      const fragment = range.cloneContents();
      const holder = document.createElement("div");
      holder.append(fragment);
      piece = holder.innerText || holder.textContent || "";
    }
    if (piece.length > 0) {
      parts.push(piece);
    }
  }
  if (parts.length > 0) {
    return normalizeSelectionText(parts.join(""));
  }
  if (!selection.isCollapsed) {
    return normalizeSelectionText(selection.toString());
  }
  return "";
}

function closestDataLine(node: Node | null): Element | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element && current.hasAttribute("data-line")) {
      return current;
    }
    if (current.parentNode) {
      current = current.parentNode;
      continue;
    }
    if (current instanceof ShadowRoot) {
      current = current.host;
      continue;
    }
    break;
  }
  return null;
}

/**
 * 从浏览器选区 anchor/focus 解析起止行号（整行复制回退用）。
 * 字符级 toString 失败时，至少能按行从模型取文本。
 */
export function readBrowserSelectionLineSpan(): {
  readonly end: number;
  readonly start: number;
} | null {
  const selection = window.getSelection();
  if (!(selection && selection.rangeCount > 0)) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return null;
  }
  const startEl = closestDataLine(range.startContainer);
  const endEl = closestDataLine(range.endContainer);
  if (!(startEl && endEl)) {
    return null;
  }
  const start = Number.parseInt(startEl.getAttribute("data-line") ?? "", 10);
  const end = Number.parseInt(endEl.getAttribute("data-line") ?? "", 10);
  if (!(Number.isFinite(start) && Number.isFinite(end))) {
    return null;
  }
  return {
    end: Math.max(start, end),
    start: Math.min(start, end),
  };
}
