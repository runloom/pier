import { Droppable, Sortable } from "@pier/ui/dnd/index.tsx";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function mockRect(el: Element, top: number): void {
  (el as HTMLElement).getBoundingClientRect = () => ({
    bottom: top + 40,
    height: 40,
    left: 0,
    right: 100,
    toJSON() {
      return {};
    },
    top,
    width: 100,
    x: 0,
    y: top,
  });
}

function mockRows(container: HTMLElement): HTMLElement[] {
  const rows = [
    ...container.querySelectorAll("[data-sortable-id]"),
  ] as HTMLElement[];
  rows.forEach((row, index) => {
    mockRect(row, index * 50);
  });
  return rows;
}

function overrideElementFromPoint(value: () => Element | null): () => void {
  const original = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value,
  });
  return () => {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: original,
    });
  };
}

function overrideElementsFromPoint(
  value: (x: number, y: number) => Element[]
): () => void {
  const original = document.elementsFromPoint;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value,
  });
  return () => {
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: original,
    });
  };
}

describe("Sortable", () => {
  it("calls onReorder with the new order after a vertical handle drag", () => {
    const onReorder = vi.fn();
    const { container, getAllByLabelText } = render(
      <Sortable items={["a", "b", "c"]} onReorder={onReorder}>
        {(id, item) => (
          <div>
            {item.handle}
            <span>{id}</span>
          </div>
        )}
      </Sortable>
    );
    expect(mockRows(container)).toHaveLength(3);
    const handle = getAllByLabelText("Drag")[0];
    if (!handle) {
      return;
    }
    fireEvent.pointerDown(handle, { button: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 130, pointerId: 1 });
    expect(onReorder).toHaveBeenCalled();
    expect(onReorder.mock.calls.at(-1)?.[0]).toEqual(["b", "c", "a"]);
  });

  it("previews the order live and floats a ghost while dragging", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <Sortable items={["a", "b", "c"]} onReorder={onReorder}>
        {(id) => <span>{id}</span>}
      </Sortable>
    );
    const rows = mockRows(container);
    const first = rows[0];
    if (!first) {
      return;
    }
    // Whole-item surface drag (no handle needed).
    fireEvent.pointerDown(first, { button: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 130, pointerId: 1 });

    const ghost = document.querySelector("[data-slot='dnd-ghost']");
    expect(ghost).toBeTruthy();
    const liveOrder = [...container.querySelectorAll("[data-sortable-id]")].map(
      (el) => el.getAttribute("data-sortable-id")
    );
    expect(liveOrder).toEqual(["b", "c", "a"]);
    const draggedRow = container.querySelector('[data-sortable-id="a"]');
    expect(draggedRow?.className).toContain("opacity-30");

    fireEvent.pointerUp(window, { clientY: 130, pointerId: 1 });
    expect(document.querySelector("[data-slot='dnd-ghost']")).toBeNull();
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("does not start a drag from the text inside a button", () => {
    const onReorder = vi.fn();
    const { getByRole } = render(
      <Sortable items={["card"]} onReorder={onReorder}>
        {() => <button type="button">#48</button>}
      </Sortable>
    );
    const label = getByRole("button", { name: "#48" }).firstChild;
    if (!label) {
      throw new Error("missing button label");
    }
    fireEvent.pointerDown(label, { button: 0, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 130, pointerId: 1 });
    expect(document.querySelector("[data-slot='dnd-ghost']")).toBeNull();
    fireEvent.pointerUp(window, { clientY: 130, pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("drops onto a plain Droppable without firing the source onReorder", () => {
    const onReorder = vi.fn();
    const onDrop = vi.fn();
    const { container, getAllByLabelText } = render(
      <div>
        <Droppable id="todo">
          <Sortable items={["card"]} onReorder={onReorder}>
            {(id, item) => (
              <div>
                {item.handle}
                {id}
              </div>
            )}
          </Sortable>
        </Droppable>
        <Droppable id="done" onDrop={onDrop}>
          empty
        </Droppable>
      </div>
    );
    mockRows(container);
    const done = document.querySelector('[data-droppable-id="done"]');
    if (!done) {
      throw new Error("missing done droppable");
    }
    const restore = overrideElementFromPoint(() => done);
    const handle = getAllByLabelText("Drag")[0];
    if (!handle) {
      restore();
      return;
    }
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 1 });
    restore();
    expect(onDrop).toHaveBeenCalledWith("card");
    // Cross-container moves are a single callback: the composition owns the
    // removal, so no second write races the first.
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("drops into a foreign Sortable with a live gap and an insertion index", () => {
    const onReorder = vi.fn();
    const onTargetReorder = vi.fn();
    const onDropItem = vi.fn();
    const { container, getAllByLabelText } = render(
      <div>
        <Droppable id="todo">
          <Sortable items={["card"]} onReorder={onReorder}>
            {(id, item) => (
              <div>
                {item.handle}
                {id}
              </div>
            )}
          </Sortable>
        </Droppable>
        <Droppable id="done">
          <Sortable
            items={["x", "y"]}
            onDropItem={onDropItem}
            onReorder={onTargetReorder}
          >
            {(id) => <span>{id}</span>}
          </Sortable>
        </Droppable>
      </div>
    );
    const targetRows = [
      ...container.querySelectorAll(
        '[data-droppable-id="done"] [data-sortable-id]'
      ),
    ];
    targetRows.forEach((row, index) => {
      mockRect(row, index * 50);
    });
    const sourceRow = container.querySelector(
      '[data-droppable-id="todo"] [data-sortable-id]'
    );
    if (sourceRow) {
      mockRect(sourceRow, 0);
    }
    const done = document.querySelector('[data-droppable-id="done"]');
    if (!done) {
      throw new Error("missing done droppable");
    }
    const restore = overrideElementFromPoint(() => done);
    const handle = getAllByLabelText("Drag")[0];
    if (!handle) {
      restore();
      return;
    }
    // Pointer between x (mid 20) and y (mid 70): insertion index 1.
    fireEvent.pointerDown(handle, { button: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(document.querySelector("[data-slot='dnd-gap']")).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: 50, clientY: 40, pointerId: 1 });
    restore();
    expect(onDropItem).toHaveBeenCalledWith("card", 1);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onTargetReorder).not.toHaveBeenCalled();
    expect(document.querySelector("[data-slot='dnd-gap']")).toBeNull();
  });

  it("commits the painted gap index even if drop-time row rects have shifted", () => {
    const onDropItem = vi.fn();
    const { container, getAllByLabelText } = render(
      <div>
        <Droppable id="todo">
          <Sortable items={["card"]} onReorder={() => undefined}>
            {(id, item) => (
              <div>
                {item.handle}
                {id}
              </div>
            )}
          </Sortable>
        </Droppable>
        <Droppable id="done">
          <Sortable
            items={["x", "y"]}
            onDropItem={onDropItem}
            onReorder={() => undefined}
          >
            {(id) => <span>{id}</span>}
          </Sortable>
        </Droppable>
      </div>
    );
    const targetRows = [
      ...container.querySelectorAll(
        '[data-droppable-id="done"] [data-sortable-id]'
      ),
    ];
    targetRows.forEach((row, index) => {
      mockRect(row, index * 50);
    });
    const done = document.querySelector('[data-droppable-id="done"]');
    if (!done) {
      throw new Error("missing done droppable");
    }
    const restore = overrideElementFromPoint(() => done);
    const handle = getAllByLabelText("Drag")[0];
    if (!handle) {
      restore();
      return;
    }
    fireEvent.pointerDown(handle, { button: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(document.querySelector("[data-slot='dnd-gap']")).toBeTruthy();
    targetRows.forEach((row, index) => {
      mockRect(row, 80 + index * 50);
    });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 40, pointerId: 1 });
    restore();
    expect(onDropItem).toHaveBeenCalledWith("card", 1);
  });

  it("still drops when the floating ghost sits under the pointer", () => {
    const onDropItem = vi.fn();
    const { getAllByLabelText } = render(
      <div>
        <Droppable id="todo">
          <Sortable items={["card"]} onReorder={() => undefined}>
            {(id, item) => (
              <div>
                {item.handle}
                {id}
              </div>
            )}
          </Sortable>
        </Droppable>
        <Droppable id="done">
          <Sortable
            items={["parked"]}
            onDropItem={onDropItem}
            onReorder={() => undefined}
          >
            {(id) => <span>{id}</span>}
          </Sortable>
        </Droppable>
      </div>
    );
    const done = document.querySelector('[data-droppable-id="done"]');
    if (!done) {
      throw new Error("missing done droppable");
    }
    const handle = getAllByLabelText("Drag")[0];
    if (!handle) {
      return;
    }
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 10, pointerId: 1 });
    const ghost = document.querySelector("[data-slot='dnd-ghost']");
    const ghostHit = ghost?.querySelector("*") ?? ghost;
    if (!(ghostHit instanceof Element)) {
      throw new Error("missing drag ghost");
    }
    const restore = overrideElementsFromPoint(() => [ghostHit, done]);
    fireEvent.pointerUp(window, { clientX: 200, clientY: 10, pointerId: 1 });
    restore();
    expect(onDropItem).toHaveBeenCalledWith("card", expect.any(Number));
  });
});
