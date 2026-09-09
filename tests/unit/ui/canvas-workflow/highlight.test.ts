import { workflowHighlight } from "@pier/ui/canvas-workflow/highlight.ts";
import { describe, expect, it } from "vitest";
import { reviewWorkflowSpec } from "./fixtures.ts";

describe("workflowHighlight", () => {
  it("lights a card with every incident edge and the far ends", () => {
    const highlight = workflowHighlight(reviewWorkflowSpec, {
      id: "review",
      kind: "node",
    });
    expect([...highlight.nodes].toSorted()).toEqual([
      "pass",
      "reject",
      "review",
      "revise",
      "submit",
    ]);
    expect([...highlight.edges].toSorted()).toEqual([
      "e-open",
      "e-pass",
      "e-reject",
      "e-resubmit",
    ]);
  });

  it("lights an edge with both endpoints", () => {
    const highlight = workflowHighlight(reviewWorkflowSpec, {
      id: "e-reject",
      kind: "edge",
    });
    expect([...highlight.nodes].toSorted()).toEqual(["reject", "review"]);
    expect([...highlight.edges]).toEqual(["e-reject"]);
  });
});
