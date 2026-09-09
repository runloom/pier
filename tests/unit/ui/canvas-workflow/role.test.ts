import { WORKFLOW_STROKE } from "@pier/ui/canvas-workflow/metrics.ts";
import {
  workflowEdgeDash,
  workflowPaintRole,
} from "@pier/ui/canvas-workflow/role.ts";
import { describe, expect, it } from "vitest";

describe("workflow edge marks", () => {
  it("uses one stroke width and dashes side roles", () => {
    expect(WORKFLOW_STROKE).toBe(1.5);
    expect(workflowEdgeDash("main", true)).toBeUndefined();
    expect(workflowEdgeDash("error", false)).toBe("5 4");
    expect(workflowEdgeDash("return", false)).toBe("4 4");
    expect(workflowEdgeDash("branch", false)).toBe("5 4");
  });

  it("paints a drop into the recovery band as a caution mark", () => {
    expect(workflowPaintRole(true, "main", false, true)).toBe("error");
    expect(workflowPaintRole(true, "main", true, false)).toBe("main");
    expect(workflowPaintRole(false, "branch", false, false)).toBe("branch");
  });
});
