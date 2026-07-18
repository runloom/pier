import type { CodeViewLineSelection } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";

type SelectionSide = "additions" | "deletions";

export interface DiffPointerLineHit {
  readonly fromNumberColumn: boolean;
  readonly id: string;
  readonly lineNumber: number;
  readonly side: SelectionSide;
}

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
  viewer: CodeViewHandle<undefined>
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
 * 从 pointer 事件解析 Pierre 行选目标。
 * 行号栏 / 正文行均可；用于把原生正文拖选统一映射到 line selection。
 */
export function resolveDiffPointerLineHit(
  event: Pick<PointerEvent, "composedPath" | "target">,
  viewer: CodeViewHandle<undefined> | null | undefined
): DiffPointerLineHit | null {
  if (!viewer) {
    return null;
  }
  const path = event.composedPath();
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
