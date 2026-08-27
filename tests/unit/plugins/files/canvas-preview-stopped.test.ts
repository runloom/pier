import { describe, expect, it } from "vitest";
import { isCanvasPreviewStoppedFailure } from "../../../../src/plugins/builtin/files/renderer/preview/canvas-states.tsx";

describe("isCanvasPreviewStoppedFailure", () => {
  it("treats a dead compiler helper as preview-stopped, not a bad file", () => {
    expect(
      isCanvasPreviewStoppedFailure({
        diagnostics: [
          { message: "The service is no longer running", severity: "error" },
        ],
        message: "Couldn’t compile canvas",
      })
    ).toBe(true);
    expect(
      isCanvasPreviewStoppedFailure({
        diagnostics: [],
        message: "The canvas compiler stopped. Reload to try again.",
      })
    ).toBe(true);
  });

  it("leaves ordinary compile errors as file fixes", () => {
    expect(
      isCanvasPreviewStoppedFailure({
        diagnostics: [
          {
            file: "board.canvas.tsx",
            line: 12,
            message: "Cannot find name 'WorldStage'",
            severity: "error",
          },
        ],
        message: "Couldn’t compile canvas",
      })
    ).toBe(false);
  });
});
