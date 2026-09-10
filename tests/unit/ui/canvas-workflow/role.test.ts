import {
  isScreenFlowFrame,
  WORKFLOW_STROKE,
  WORKFLOW_STROKE_SIDE,
} from "@pier/ui/canvas-workflow/metrics.ts";
import { workflowPaintRole } from "@pier/ui/canvas-workflow/role.ts";
import { describe, expect, it } from "vitest";

describe("workflow edge marks", () => {
  it("uses a heavier main stroke than side roles", () => {
    expect(WORKFLOW_STROKE).toBe(1.8);
    expect(WORKFLOW_STROKE_SIDE).toBe(1.4);
    expect(isScreenFlowFrame({ h: 120, w: 200 })).toBe(true);
    expect(isScreenFlowFrame({ h: 52, w: 132 })).toBe(false);
  });

  it("paints a drop into the recovery band as a caution mark", () => {
    expect(workflowPaintRole(true, "main", false, true)).toBe("error");
    expect(workflowPaintRole(true, "main", true, false)).toBe("main");
    expect(workflowPaintRole(false, "branch", false, false)).toBe("branch");
  });
});
