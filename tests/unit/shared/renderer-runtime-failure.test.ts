import {
  parseRendererRuntimeFailureReport,
  RENDERER_RUNTIME_FAILURE_LIMITS,
} from "@shared/contracts/renderer-runtime-failure.ts";
import { describe, expect, it } from "vitest";

describe("renderer runtime failure report", () => {
  it("accepts known fields, trims them, and drops unknown data", () => {
    expect(
      parseRendererRuntimeFailureReport({
        componentStack: "  at WorkspaceHost  ",
        message: "  render failed  ",
        name: "  TypeError  ",
        secret: "not forwarded",
        stack: "  TypeError: render failed  ",
      })
    ).toEqual({
      componentStack: "at WorkspaceHost",
      message: "render failed",
      name: "TypeError",
      stack: "TypeError: render failed",
    });
  });

  it("rejects malformed required fields and bounds diagnostic text", () => {
    expect(parseRendererRuntimeFailureReport(null)).toBeNull();
    expect(
      parseRendererRuntimeFailureReport({ message: "", name: "Error" })
    ).toBeNull();

    const parsed = parseRendererRuntimeFailureReport({
      componentStack: "c".repeat(
        RENDERER_RUNTIME_FAILURE_LIMITS.componentStack + 20
      ),
      message: "m".repeat(RENDERER_RUNTIME_FAILURE_LIMITS.message + 20),
      name: "n".repeat(RENDERER_RUNTIME_FAILURE_LIMITS.name + 20),
      stack: "s".repeat(RENDERER_RUNTIME_FAILURE_LIMITS.stack + 20),
    });
    expect(parsed?.componentStack).toHaveLength(
      RENDERER_RUNTIME_FAILURE_LIMITS.componentStack
    );
    expect(parsed?.message).toHaveLength(
      RENDERER_RUNTIME_FAILURE_LIMITS.message
    );
    expect(parsed?.name).toHaveLength(RENDERER_RUNTIME_FAILURE_LIMITS.name);
    expect(parsed?.stack).toHaveLength(RENDERER_RUNTIME_FAILURE_LIMITS.stack);
  });
});
