import { describe, expect, it } from "vitest";
import {
  DAG_LAYOUT_CROSSING_EXIT,
  layerDagNodes,
} from "../../../../packages/plugin-tasks/applets/task-dag/layout.ts";

function nodes(...keys: string[]) {
  return keys.map((key) => ({ key, title: key }));
}

describe("experimental task DAG layout", () => {
  it("layers by longest blocker path with ready tasks first", () => {
    const layout = layerDagNodes({
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      nodes: nodes("a", "b", "c", "solo"),
    });
    expect(layout.layers).toEqual([["a", "solo"], ["b"], ["c"]]);
    expect(layout.crossings).toBe(0);
  });

  it("counts crossings between adjacent layers", () => {
    const layout = layerDagNodes({
      edges: [
        { from: "a", to: "d" },
        { from: "b", to: "c" },
      ],
      nodes: nodes("a", "b", "c", "d"),
    });
    // a(0)→d(1) crosses b(1)→c(0) between the two layers.
    expect(layout.crossings).toBe(1);
    expect(layout.crossings).toBeLessThanOrEqual(DAG_LAYOUT_CROSSING_EXIT);
  });

  it("parks cycle members in a trailing layer instead of looping", () => {
    const layout = layerDagNodes({
      edges: [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
        { from: "a", to: "x" },
      ],
      nodes: nodes("a", "x", "y"),
    });
    expect(layout.layers[0]).toEqual(["a"]);
    expect(layout.layers.at(-1)).toEqual(["x", "y"]);
  });

  it("ignores edges that reference unknown nodes", () => {
    const layout = layerDagNodes({
      edges: [{ from: "ghost", to: "a" }],
      nodes: nodes("a"),
    });
    expect(layout.layers).toEqual([["a"]]);
    expect(layout.crossings).toBe(0);
  });
});
