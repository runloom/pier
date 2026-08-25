import { useTableColumnResize } from "@plugins/builtin/files/renderer/markdown/table/table-resize.tsx";
import {
  readTableWidths,
  resetTableWidths,
  TABLE_MIN_COLUMN_WIDTH_PX,
  writeTableColumnWidth as writeWidthForTest,
} from "@plugins/builtin/files/renderer/markdown/table/table-width-preferences.ts";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom lacks pointer capture APIs.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  configurable: true,
  value: vi.fn(),
});

function mountWrapWithTable(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
  document.body.appendChild(wrap);
  return wrap;
}

/** Pointer over a real cell in the wrap; jsdom rects are all-zero, so a
 *  clientX within [-6, 0] hits the cell's right boundary band. */
function cellPointerEvent(
  wrap: HTMLDivElement,
  cell: Element,
  clientX: number
): React.PointerEvent<HTMLDivElement> {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX,
    clientY: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    target: cell,
    currentTarget: wrap,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("useTableColumnResize", () => {
  let wrap: HTMLDivElement;
  let table: HTMLTableElement;

  beforeEach(() => {
    localStorage.clear();
    resetTableWidths("/t.md", "h1");
    document.body.innerHTML = "";
    wrap = mountWrapWithTable();
    table = wrap.querySelector("table") as HTMLTableElement;
  });

  function renderResize() {
    return renderHook(() =>
      useTableColumnResize({
        sourcePath: "/t.md",
        contentHash: "h1",
        columnCount: 2,
        containerRef: { current: wrap },
        tableRef: { current: table },
      })
    );
  }

  function seedWidth(widthPx: number) {
    act(() => {
      writeWidthForTest({
        sourcePath: "/t.md",
        contentHash: "h1",
        columnIndex: 0,
        widthPx,
      });
    });
  }

  it("starts drag from a body-cell boundary and persists clamped width", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    // 线与边框同源：columnLeft(jsdom 0) + 起始宽 100。
    expect(result.current.dragLine?.x).toBe(100);
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 50));
    });
    // 100 + (50 - (-3)) = 153。
    expect(result.current.dragLine?.x).toBe(153);
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(153);
  });

  it("keeps the drag line glued to the clamped border at minimum width", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    // 向左猛拖：宽度触底 24px，线停在 columnLeft + 24（与边框重合）。
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -600));
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(
      TABLE_MIN_COLUMN_WIDTH_PX
    );
    expect(result.current.dragLine?.x).toBe(TABLE_MIN_COLUMN_WIDTH_PX);
  });

  it("does not start a drag away from the column boundary", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -80));
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(false);
    expect(result.current.dragLine).toBeNull();
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -80));
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(100);
  });

  it("shows col-resize cursor near the boundary and clears it elsewhere", () => {
    const { result } = renderResize();
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -3));
    });
    expect(wrap.style.cursor).toBe("col-resize");
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -80));
    });
    expect(wrap.style.cursor).toBe("");
  });

  it("drags from anywhere on the header handle, including past the th edge", () => {
    const { result } = renderResize();
    seedWidth(100);
    const th = wrap.querySelector("th") as HTMLTableCellElement;
    th.insertAdjacentHTML("beforeend", '<div class="md-col-resizer"></div>');
    const handle = th.querySelector(".md-col-resizer") as Element;
    // jsdom th rect right = 0；clientX = +3 已越过 th 右缘（把手外侧一半）。
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, handle, 3));
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    expect(result.current.dragLine?.x).toBe(100);
  });

  it("hits the boundary from the next cell's left band and resizes the previous column", () => {
    const { result } = renderResize();
    seedWidth(100);
    const secondTh = wrap.querySelectorAll("th")[1] as HTMLTableCellElement;
    // 指针落在第二列左缘 2px 内 → 归属第 0 列的右缘分割线。
    act(() => {
      result.current.wrapProps.onPointerDown(
        cellPointerEvent(wrap, secondTh, 2)
      );
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    act(() => {
      result.current.wrapProps.onPointerMove(
        cellPointerEvent(wrap, secondTh, 52)
      );
    });
    // 第 0 列：100 + (52 - 2) = 150。
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(150);
  });
  it("clears drag state and line on lostpointercapture", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onLostPointerCapture({
        currentTarget: wrap,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });
    expect(result.current.dragLine).toBeNull();
    expect(wrap.hasAttribute("data-md-resizing")).toBe(false);
    expect(wrap.dataset.mdDragStartX).toBeUndefined();
  });

  it("double-click resets only that column", () => {
    const { result } = renderResize();
    writeWidthForTest({
      sourcePath: "/t.md",
      contentHash: "h1",
      columnIndex: 0,
      widthPx: 120,
    });
    writeWidthForTest({
      sourcePath: "/t.md",
      contentHash: "h1",
      columnIndex: 1,
      widthPx: 80,
    });
    act(() => {
      result.current.headProps(0).onDoubleClick({
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });
    const stored = readTableWidths("/t.md", "h1");
    expect(stored?.["0"]).toBeUndefined();
    expect(stored?.["1"]).toBe(80);
  });

  it("keyboard arrows adjust by 16px within min clamp", () => {
    writeWidthForTest({
      sourcePath: "/t.md",
      contentHash: "h1",
      columnIndex: 1,
      widthPx: TABLE_MIN_COLUMN_WIDTH_PX + 4,
    });
    const { result } = renderResize();
    act(() => {
      result.current.headProps(1).onKeyDown({
        key: "ArrowLeft",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });
    expect(readTableWidths("/t.md", "h1")?.["1"]).toBe(
      TABLE_MIN_COLUMN_WIDTH_PX
    );
  });
});
