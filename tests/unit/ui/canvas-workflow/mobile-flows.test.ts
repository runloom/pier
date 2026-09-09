import { compileWorkflowLayout } from "@pier/ui/canvas-workflow/compile.ts";
import { validateWorkflowSpec } from "@pier/ui/canvas-workflow/validate.ts";
import { describe, expect, it } from "vitest";
import { MOBILE_WEB_FLOWS } from "../../../../.pier/canvases/mobile-web-flows/flows.ts";

describe("mobile-web-flows specs", () => {
  it("compiles each F1–F5 diagram as a paintable picture", () => {
    expect(MOBILE_WEB_FLOWS).toHaveLength(5);
    for (const spec of MOBILE_WEB_FLOWS) {
      const receipt = validateWorkflowSpec(spec);
      expect(receipt.status, spec.title).toBe(0);
      expect(
        receipt.diagnostics.filter((item) => item.severity === "error"),
        spec.title
      ).toEqual([]);
      const layout = compileWorkflowLayout(spec);
      expect(
        layout.diagnostics.filter((item) => item.severity === "error"),
        spec.title
      ).toEqual([]);
    }
  });
});
