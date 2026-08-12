import { CirclePauseIcon, TriangleAlertIcon } from "lucide-react";
import { describe, expect, it } from "vitest";
import { runtimeStatusVisual } from "@/components/common/runtime-status-visual.ts";

describe("runtimeStatusVisual", () => {
  it("waiting uses pause icon (awaiting confirmation), not warning triangle", () => {
    const visual = runtimeStatusVisual("waiting");
    expect(visual.Icon).toBe(CirclePauseIcon);
    expect(visual.textClassName).toContain("status-warning");
  });

  it("blocked keeps caution triangle", () => {
    const visual = runtimeStatusVisual("blocked");
    expect(visual.Icon).toBe(TriangleAlertIcon);
    expect(visual.textClassName).toContain("status-warning");
  });
});
