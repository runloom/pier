import { FlowGraph } from "@pier/ui/flow-graph/index.tsx";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

describe("FlowGraph", () => {
  it("renders node labels in the card plane", () => {
    render(
      <FlowGraph
        aria-label="Pipeline"
        edges={[{ source: "a", target: "b" }]}
        expandable={false}
        nodes={[
          { id: "a", label: "Compile", status: "running" },
          { id: "b", label: "Publish", status: "queued" },
        ]}
      />
    );
    expect(screen.getByText("Compile")).toBeTruthy();
    expect(screen.getByText("Publish")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Pipeline" })).toBeTruthy();
  });

  it("renders ready and blocked status, meta, and badge", () => {
    render(
      <FlowGraph
        aria-label="Statuses"
        expandable={false}
        nodes={[
          {
            badge: "gate",
            id: "review",
            label: "Review",
            meta: "needs sign-off",
            status: "blocked",
          },
          { id: "ship", label: "Ship", status: "ready" },
        ]}
      />
    );
    expect(screen.getByText("needs sign-off")).toBeTruthy();
    expect(screen.getByText("gate")).toBeTruthy();
    expect(
      document.querySelector(
        '[data-slot="flow-graph-node"][data-status="blocked"]'
      )
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-slot="flow-graph-node"][data-status="ready"]'
      )
    ).toBeTruthy();
  });

  it("draws edge labels and a running source dash", () => {
    render(
      <FlowGraph
        aria-label="Edges"
        edges={[{ label: "ok", source: "a", target: "b" }]}
        expandable={false}
        nodes={[
          { id: "a", label: "Compile", status: "running" },
          { id: "b", label: "Publish", status: "queued" },
        ]}
      />
    );
    expect(screen.getByText("ok")).toBeTruthy();
    expect(
      document.querySelector(
        '[data-slot="flow-graph-edge"][data-status="running"]'
      )
    ).toBeTruthy();
  });

  it("divides pointer deltas by the stage scale when dragging a node", () => {
    const onNodePositionsChange = vi.fn();
    render(
      <FlowGraph
        aria-label="Drag"
        expandable={false}
        nodes={[{ id: "a", label: "A" }]}
        onNodePositionsChange={onNodePositionsChange}
        positions={{ a: { x: 100, y: 100 } }}
      />
    );
    const wrapper = document.querySelector(
      '[data-slot="flow-graph-plane"] [data-no-drag]'
    ) as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    if (!wrapper) {
      return;
    }
    // World rendered at 50% zoom: visual width is half the layout width.
    Object.defineProperty(wrapper, "offsetWidth", { value: 200 });
    wrapper.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
    fireEvent.pointerDown(wrapper, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10, pointerId: 1 });
    // 50 visual px at 0.5 scale = 100 world px.
    expect(onNodePositionsChange).toHaveBeenCalledWith({
      a: { x: 200, y: 100 },
    });
  });

  it("reserves node content and paints an overlay", () => {
    render(
      <FlowGraph
        aria-label="Slots"
        expandable={false}
        nodes={[
          {
            contentHeight: 20,
            id: "a",
            label: "Compile",
          },
        ]}
        renderNodeContent={() => <span>slot</span>}
        renderOverlay={() => <span>AND-gate</span>}
      />
    );
    expect(screen.getByText("slot")).toBeTruthy();
    expect(screen.getByText("AND-gate")).toBeTruthy();
    expect(
      document.querySelector('[data-slot="flow-graph-node-content"]')
    ).toBeTruthy();
    expect(
      document.querySelector('[data-slot="flow-graph-overlay"]')
    ).toBeTruthy();
  });
});
