import { validateWorkflowSpec } from "@pier/ui/canvas-workflow/validate.ts";
import { describe, expect, it } from "vitest";
import {
  agentToolCallWorkflowSpec,
  crossingWorkflowSpec,
  reviewWorkflowSpec,
} from "./fixtures.ts";

describe("validateWorkflowSpec", () => {
  it("accepts the agent tool-call gallery gold", () => {
    const receipt = validateWorkflowSpec(agentToolCallWorkflowSpec);
    expect(receipt.status).toBe(0);
    expect(
      receipt.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });

  it("accepts the review gold sample", () => {
    const receipt = validateWorkflowSpec(reviewWorkflowSpec);
    expect(receipt.status).toBe(0);
    expect(
      receipt.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });

  it("requires an edge between adjacent mainPath nodes", () => {
    const receipt = validateWorkflowSpec({
      ...reviewWorkflowSpec,
      edges: reviewWorkflowSpec.edges.filter((edge) => edge.id !== "e-open"),
    });
    expect(receipt.status).toBe(1);
    expect(receipt.diagnostics[0]?.code).toBe("workflow/main-path-edge");
    expect(receipt.diagnostics[0]?.supportedFixes[0]).toContain("submit");
  });

  it("rejects a happy path that steps backward in col", () => {
    const receipt = validateWorkflowSpec({
      ...reviewWorkflowSpec,
      edges: [
        ...reviewWorkflowSpec.edges,
        { from: "pass", id: "e-back", label: "Go back", to: "submit" },
      ],
      mainPath: ["submit", "review", "pass", "submit"],
    });
    expect(receipt.status).toBe(1);
    expect(
      receipt.diagnostics.some(
        (item) => item.code === "workflow/main-path-retreat"
      )
    ).toBe(true);
  });

  it("rejects unknown node ids on edges", () => {
    const receipt = validateWorkflowSpec({
      ...reviewWorkflowSpec,
      edges: [
        ...reviewWorkflowSpec.edges,
        { from: "ghost", id: "e-ghost", label: "Haunt", to: "review" },
      ],
    });
    expect(receipt.status).toBe(1);
    expect(
      receipt.diagnostics.some((item) => item.code === "workflow/unknown-from")
    ).toBe(true);
  });

  it("lets a gate on the exception band stay on the happy path", () => {
    const receipt = validateWorkflowSpec(agentToolCallWorkflowSpec);
    expect(receipt.status).toBe(0);
    const approval = agentToolCallWorkflowSpec.nodes.find(
      (node) => node.id === "approval"
    );
    expect(approval?.lane).toBe("policy");
    expect(agentToolCallWorkflowSpec.mainPath).toContain("approval");
  });

  it("rejects overlapping groups on the same lane", () => {
    const receipt = validateWorkflowSpec({
      ...agentToolCallWorkflowSpec,
      groups: [
        ...(agentToolCallWorkflowSpec.groups ?? []),
        {
          fromCol: 4,
          id: "clash",
          label: "Clash",
          lane: "tools",
          toCol: 5,
        },
      ],
    });
    expect(receipt.status).toBe(1);
    expect(
      receipt.diagnostics.some((item) => item.code === "workflow/group-overlap")
    ).toBe(true);
  });

  it("fails closed when an elbow crosses an unrelated node", () => {
    const receipt = validateWorkflowSpec(crossingWorkflowSpec());
    expect(receipt.status).toBe(1);
    expect(
      receipt.diagnostics.some(
        (item) => item.code === "workflow/edge-crosses-node"
      )
    ).toBe(true);
    expect(receipt.diagnostics[0]?.supportedFixes[0]).toMatch(/col|lane/);
  });

  it("warns when the primary node budget is exceeded", () => {
    const nodes = Array.from({ length: 13 }, (_, index) => ({
      col: index % 9,
      id: `step${index}`,
      label: `Step ${index}`,
      lane: index < 9 ? "happy" : "more",
    }));
    const receipt = validateWorkflowSpec({
      edges: [],
      lanes: [
        { id: "happy", label: "Happy path" },
        { id: "more", label: "More" },
      ],
      nodes,
      title: "Long",
    });
    expect(receipt.status).toBe(0);
    expect(
      receipt.diagnostics.some((item) => item.code === "workflow/node-budget")
    ).toBe(true);
  });
});
