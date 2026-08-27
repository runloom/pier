import { describe, expect, it } from "vitest";
import {
  isTerminalRunStatus,
  parseGraph,
  parsePositions,
  textFromRunOutput,
} from "../../../../.pier/canvases/dag-viewer/graph.ts";

describe("orchestration gold graph helpers", () => {
  it("parses graph.json shape", () => {
    const parsed = parseGraph(
      JSON.stringify({
        edges: [{ source: "a", target: "b" }],
        nodes: [{ id: "a", label: "A", status: "running" }],
      })
    );
    expect(parsed).toEqual({
      edges: [{ source: "a", target: "b" }],
      nodes: [{ id: "a", label: "A", status: "running" }],
    });
  });

  it("parses meta, badge, edge labels, ready/blocked, and dispatched", () => {
    const parsed = parseGraph(
      JSON.stringify({
        edges: [{ label: "ok", source: "a", target: "b" }],
        nodes: [
          {
            badge: "gate",
            id: "a",
            label: "A",
            meta: "needs sign-off",
            status: "blocked",
          },
          { id: "b", label: "B", status: "ready" },
          { id: "c", label: "C", status: "dispatched" },
        ],
      })
    );
    expect(parsed).toEqual({
      edges: [{ label: "ok", source: "a", target: "b" }],
      nodes: [
        {
          badge: "gate",
          id: "a",
          label: "A",
          meta: "needs sign-off",
          status: "blocked",
        },
        { id: "b", label: "B", status: "ready" },
        { id: "c", label: "C", status: "running" },
      ],
    });
  });

  it("joins run.output chunks and recognizes a finished run", () => {
    expect(
      textFromRunOutput({
        chunks: [
          { sequence: 1, stream: "stdout", text: '{"nodes":[]' },
          { sequence: 2, stream: "stdout", text: ',"edges":[]}' },
        ],
      })
    ).toBe('{"nodes":[],"edges":[]}');
    expect(isTerminalRunStatus({ status: "succeeded" })).toBe(true);
    expect(isTerminalRunStatus({ status: "running" })).toBe(false);
  });

  it("reads sibling position envelopes", () => {
    expect(
      parsePositions(
        JSON.stringify({ positions: { a: { x: 1, y: 2 } }, schemaVersion: 1 })
      )
    ).toEqual({ a: { x: 1, y: 2 } });
  });
});
