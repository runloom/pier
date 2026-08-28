import {
  assignFlowGraphRanks,
  layoutFlowGraph,
} from "@pier/ui/flow-graph/layout.ts";
import { describe, expect, it } from "vitest";

describe("assignFlowGraphRanks", () => {
  it("puts a chain into successive ranks", () => {
    const ranks = assignFlowGraphRanks(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ]
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("finishes a cycle without growing ranks forever", () => {
    const ranks = assignFlowGraphRanks(
      ["a", "b"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ]
    );
    expect(ranks.get("a")).toBeDefined();
    expect(ranks.get("b")).toBeDefined();
    expect(Math.max(ranks.get("a") ?? 0, ranks.get("b") ?? 0)).toBeLessThan(4);
  });
});

describe("layoutFlowGraph", () => {
  it("places a left-to-right chain in increasing x", () => {
    const laid = layoutFlowGraph({
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    const a = laid.positions.a;
    const b = laid.positions.b;
    const c = laid.positions.c;
    expect(a && b && c).toBeTruthy();
    if (!(a && b && c)) {
      return;
    }
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(laid.edges).toHaveLength(2);
  });

  it("places a top-to-bottom chain in increasing y", () => {
    const laid = layoutFlowGraph({
      direction: "top-to-bottom",
      edges: [{ source: "a", target: "b" }],
      nodes: [{ id: "a" }, { id: "b" }],
    });
    const a = laid.positions.a;
    const b = laid.positions.b;
    expect(a && b).toBeTruthy();
    if (!(a && b)) {
      return;
    }
    expect(a.y).toBeLessThan(b.y);
  });

  it("lets explicit positions beat auto layout", () => {
    const laid = layoutFlowGraph({
      edges: [{ source: "a", target: "b" }],
      nodes: [{ id: "a" }, { id: "b" }],
      positions: { a: { x: 10, y: 20 }, b: { x: 400, y: 20 } },
    });
    expect(laid.positions.a).toEqual({ x: 10, y: 20 });
    expect(laid.positions.b).toEqual({ x: 400, y: 20 });
  });

  it("grows the plane for meta and contentHeight", () => {
    const compact = layoutFlowGraph({
      edges: [],
      nodes: [{ id: "a" }],
    });
    const tall = layoutFlowGraph({
      edges: [],
      nodes: [{ contentHeight: 40, id: "a", meta: "worker-2" }],
    });
    expect(tall.height).toBeGreaterThan(compact.height);
  });

  it("spaces a taller sibling so the next node does not overlap", () => {
    const laid = layoutFlowGraph({
      edges: [],
      nodes: [
        { height: 180, id: "a" },
        { height: 64, id: "b" },
      ],
    });
    const a = laid.positions.a;
    const b = laid.positions.b;
    expect(a && b).toBeTruthy();
    if (!(a && b)) {
      return;
    }
    expect(b.y).toBeGreaterThanOrEqual(a.y + 180);
  });

  it("keeps labels on laid-out edges", () => {
    const laid = layoutFlowGraph({
      edges: [{ label: "then", source: "a", target: "b" }],
      nodes: [{ id: "a" }, { id: "b" }],
    });
    expect(laid.edges[0]?.label).toBe("then");
    expect(laid.edges[0]?.labelX).toBeTypeOf("number");
    expect(laid.edges[0]?.labelY).toBeTypeOf("number");
  });
});
