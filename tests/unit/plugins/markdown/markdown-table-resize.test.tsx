import {
  TableColumnResizeHandle,
  useTableColumnResize,
} from "@plugins/builtin/files/renderer/markdown/table/table-resize.tsx";
import {
  readTableWidths,
  resetTableWidths,
  TABLE_MIN_COLUMN_WIDTH_PX,
  TABLE_WIDTHS_CHANGED_EVENT,
  writeTableColumnWidth as writeWidthForTest,
} from "@plugins/builtin/files/renderer/markdown/table/table-width-preferences.ts";
import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  configurable: true,
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  configurable: true,
  value: () => false,
});

const HEADER_RECTS = [
  { left: 0, right: 100, width: 100 },
  { left: 100, right: 160, width: 60 },
];

function mountWrapWithTable(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
    "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
  document.body.appendChild(wrap);
  wrap.querySelectorAll("thead th").forEach((th, index) => {
    const rect = HEADER_RECTS[index];
    if (!rect) return;
    Object.defineProperty(th, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: rect.left,
        y: 0,
        left: rect.left,
        right: rect.right,
        top: 0,
        bottom: 24,
        width: rect.width,
        height: 24,
        toJSON: () => ({}),
      }),
    });
  });
  return wrap;
}

function cellPointerEvent(
  wrap: HTMLDivElement,
  cell: Element,
  clientX: number,
  pointerId = 1
): React.PointerEvent<HTMLDivElement> {
  return {
    pointerId,
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
  let containerRef: React.RefObject<HTMLDivElement | null>;
  let tableRef: React.RefObject<HTMLTableElement | null>;

  beforeEach(() => {
    localStorage.clear();
    resetTableWidths("/t.md", "h1");
    resetTableWidths("/t.md", "h2");
    document.body.innerHTML = "";
    wrap = mountWrapWithTable();
    table = wrap.querySelector("table") as HTMLTableElement;
    containerRef = { current: wrap };
    tableRef = { current: table };
  });

  function renderResize(widthsKey = "h1") {
    return renderHook(
      ({ key }: { key: string }) =>
        useTableColumnResize({
          sourcePath: "/t.md",
          widthsKey: key,
          columnCount: 2,
          containerRef,
          tableRef,
        }),
      { initialProps: { key: widthsKey } }
    );
  }

  function seedWidth(widthPx: number, columnIndex = 0, key = "h1") {
    act(() => {
      writeWidthForTest({
        sourcePath: "/t.md",
        widthsKey: key,
        columnIndex,
        widthPx,
      });
    });
  }

  it("applies widths locally on the first dirty move and persists on release", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    const events = vi.fn();
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, events);
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    expect(result.current.dragLine?.x).toBe(99);
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 100 });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 50));
    });
    expect(events).not.toHaveBeenCalled();
    expect(result.current.dragLine?.x).toBe(152);
    expect(result.current.widths).toEqual({ "0": 153, "1": 60 });
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 100 });
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, 50)
      );
    });
    window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, events);
    expect(events).toHaveBeenCalledTimes(1);
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 153, "1": 60 });
  });

  it("does not persist a click or a zero-delta move", () => {
    const { result } = renderResize();
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, -3)
      );
    });
    expect(readTableWidths("/t.md", "h1")).toBeNull();
    expect(result.current.widths).toBeNull();
  });

  it("keeps the drag line glued to the clamped border at minimum width", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, -600));
    });
    expect(result.current.widths?.["0"]).toBe(TABLE_MIN_COLUMN_WIDTH_PX);
    expect(result.current.dragLine?.x).toBe(TABLE_MIN_COLUMN_WIDTH_PX - 1);
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, -600)
      );
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(
      TABLE_MIN_COLUMN_WIDTH_PX
    );
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
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 100 });
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
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, handle, 3));
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    expect(result.current.dragLine?.x).toBe(99);
  });

  it("hits the boundary from the next cell's left band and resizes the previous column", () => {
    const { result } = renderResize();
    seedWidth(100);
    const secondTh = wrap.querySelectorAll("th")[1] as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(
        cellPointerEvent(wrap, secondTh, 101)
      );
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    act(() => {
      result.current.wrapProps.onPointerMove(
        cellPointerEvent(wrap, secondTh, 151)
      );
    });
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, secondTh, 151)
      );
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(150);
  });

  it("clears drag chrome on lostpointercapture", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, -3)
      );
    });
    expect(result.current.dragLine).toBeNull();
    expect(wrap.hasAttribute("data-md-resizing")).toBe(false);
  });

  it("ignores concurrent pointers during an active drag", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    const cells = wrap.querySelectorAll("tbody td");
    const secondTd = cells[1] as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    // 第二根指针按下：不得顶掉进行中的会话。
    act(() => {
      result.current.wrapProps.onPointerDown(
        cellPointerEvent(wrap, secondTd, -3, 2)
      );
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 20));
    });
    // 异指针 move / lostcapture 一律忽略。
    act(() => {
      result.current.wrapProps.onPointerMove(
        cellPointerEvent(wrap, td, 500, 2)
      );
    });
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, 500, 2)
      );
    });
    expect(wrap.hasAttribute("data-md-resizing")).toBe(true);
    expect(result.current.widths?.["0"]).toBe(123);
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, 20)
      );
    });
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 123, "1": 60 });
  });

  it("ignores keyboard resize while a pointer drag is active", () => {
    const { result } = renderResize();
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 17));
    });
    act(() => {
      result.current.headProps(1).onKeyDown({
        key: "ArrowLeft",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });
    // 键盘那一笔不得在拖拽中落盘（Escape 只回滚内存，会留下脏写）。
    expect(readTableWidths("/t.md", "h1")).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(readTableWidths("/t.md", "h1")).toBeNull();
  });

  it("Escape and pointercancel roll back without persisting", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 50));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 100 });
    expect(result.current.widths).toEqual({ "0": 100 });
    expect(result.current.dragLine).toBeNull();

    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 40));
    });
    act(() => {
      result.current.wrapProps.onPointerCancel(cellPointerEvent(wrap, td, 40));
    });
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 100 });
  });

  it("commits on unmount if the drag was dirty", () => {
    const { result, unmount } = renderResize();
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 17));
    });
    expect(readTableWidths("/t.md", "h1")).toBeNull();
    unmount();
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 120, "1": 60 });
  });

  it("aborts an in-flight drag when the structure key changes", () => {
    const { result, rerender } = renderResize();
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 17));
    });
    rerender({ key: "h2" });
    expect(result.current.dragLine).toBeNull();
    expect(readTableWidths("/t.md", "h1")).toBeNull();
    expect(readTableWidths("/t.md", "h2")).toBeNull();
  });

  it("ignores storage sync while a drag session is active", () => {
    const { result } = renderResize();
    seedWidth(100);
    const td = wrap.querySelector("tbody td") as HTMLTableCellElement;
    act(() => {
      result.current.wrapProps.onPointerDown(cellPointerEvent(wrap, td, -3));
    });
    act(() => {
      result.current.wrapProps.onPointerMove(cellPointerEvent(wrap, td, 50));
    });
    act(() => {
      writeWidthForTest({
        sourcePath: "/t.md",
        widthsKey: "h1",
        columnIndex: 0,
        widthPx: 999,
      });
    });
    expect(result.current.widths?.["0"]).toBe(153);
    act(() => {
      result.current.wrapProps.onLostPointerCapture(
        cellPointerEvent(wrap, td, 50)
      );
    });
    expect(readTableWidths("/t.md", "h1")?.["0"]).toBe(153);
  });

  it("double-click restores automatic sizing for the whole table", () => {
    const { result } = renderResize();
    writeWidthForTest({
      sourcePath: "/t.md",
      widthsKey: "h1",
      columnIndex: 0,
      widthPx: 120,
    });
    writeWidthForTest({
      sourcePath: "/t.md",
      widthsKey: "h1",
      columnIndex: 1,
      widthPx: 80,
    });
    act(() => {
      result.current.headProps(0).onDoubleClick({
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });
    expect(readTableWidths("/t.md", "h1")).toBeNull();
  });

  it("keyboard arrows adjust by 16px within min clamp", () => {
    writeWidthForTest({
      sourcePath: "/t.md",
      widthsKey: "h1",
      columnIndex: 0,
      widthPx: 100,
    });
    writeWidthForTest({
      sourcePath: "/t.md",
      widthsKey: "h1",
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
    expect(readTableWidths("/t.md", "h1")).toEqual({
      "0": 100,
      "1": TABLE_MIN_COLUMN_WIDTH_PX,
    });
  });

  it("keyboard resize freezes the remaining columns from rendered widths", () => {
    const { result } = renderResize();
    act(() => {
      result.current.headProps(0).onKeyDown({
        key: "ArrowRight",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);
    });
    expect(readTableWidths("/t.md", "h1")).toEqual({ "0": 116, "1": 60 });
  });

  it("announces honest ARIA values: auto uses valuetext, widths stay in range", () => {
    const head = () => ({ onDoubleClick: vi.fn(), onKeyDown: vi.fn() });
    const { container: autoContainer } = render(
      <TableColumnResizeHandle
        ariaLabel="Resize column"
        autoValueText="Automatic width"
        columnIndex={0}
        head={head}
        width={undefined}
      />
    );
    const autoHandle = autoContainer.querySelector(".md-col-resizer");
    // auto 态：valuenow 回退最小值仅满足 separator 必填，语义由 valuetext 表达。
    expect(autoHandle?.getAttribute("aria-valuetext")).toBe("Automatic width");
    expect(autoHandle?.getAttribute("aria-valuemax")).toBe("4096");

    const { container: sizedContainer } = render(
      <TableColumnResizeHandle
        ariaLabel="Resize column"
        autoValueText="Automatic width"
        columnIndex={0}
        head={head}
        width={153}
      />
    );
    const sizedHandle = sizedContainer.querySelector(".md-col-resizer");
    expect(sizedHandle?.getAttribute("aria-valuenow")).toBe("153");
    expect(sizedHandle?.hasAttribute("aria-valuetext")).toBe(false);
  });

  it("locks fixed layout with an explicit total width once all columns are set", () => {
    const { result, rerender } = renderResize();
    expect(result.current.tableStyle).toBeUndefined();
    seedWidth(100);
    rerender({ key: "h1" });
    expect(result.current.tableStyle).toEqual({
      maxWidth: "none",
      tableLayout: "fixed",
      width: "100%",
    });
    act(() => {
      writeWidthForTest({
        sourcePath: "/t.md",
        widthsKey: "h1",
        columnIndex: 1,
        widthPx: 60,
      });
    });
    rerender({ key: "h1" });
    expect(result.current.tableStyle).toEqual({
      maxWidth: "none",
      tableLayout: "fixed",
      width: 160,
    });
  });
});
