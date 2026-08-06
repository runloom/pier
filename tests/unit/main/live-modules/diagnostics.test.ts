import { describe, expect, it } from "vitest";
import {
  compileFailureResult,
  diagnosticFromEsbuildMessage,
  diagnosticsFromBuildFailure,
} from "../../../../src/main/services/live-modules/diagnostics.ts";

describe("live-modules diagnostics", () => {
  it("maps esbuild location to 1-based column", () => {
    const diagnostic = diagnosticFromEsbuildMessage(
      {
        location: {
          column: 4,
          file: "entry.canvas.tsx",
          length: 1,
          line: 12,
          lineText: "const x = ",
          namespace: "",
          suggestion: "",
        },
        notes: [],
        pluginName: "",
        text: "Unexpected end of file",
      },
      "error"
    );
    expect(diagnostic).toMatchObject({
      column: 5,
      file: "entry.canvas.tsx",
      line: 12,
      message: "Unexpected end of file",
      severity: "error",
    });
  });

  it("flattens BuildFailure errors and warnings", () => {
    const diagnostics = diagnosticsFromBuildFailure({
      errors: [
        {
          location: {
            column: 0,
            file: "a.tsx",
            length: 1,
            line: 1,
            lineText: "!",
            namespace: "",
            suggestion: "",
          },
          notes: [],
          pluginName: "",
          text: "boom",
        },
      ],
      warnings: [
        {
          location: null,
          notes: [],
          pluginName: "",
          text: "slow",
        },
      ],
    });
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      column: 1,
      file: "a.tsx",
      line: 1,
      message: "boom",
      severity: "error",
    });
    expect(diagnostics[1]).toMatchObject({
      message: "slow",
      severity: "warning",
    });
  });

  it("always includes entry path on failure graph", () => {
    const failure = compileFailureResult(
      [{ message: "nope", severity: "error" }],
      new Set(["src/dep.ts"]),
      "/proj/.pier/canvases/x.canvas.tsx",
      "/proj",
      "/proj/.pier/canvases"
    );
    expect(failure.ok).toBe(false);
    expect(failure.graph).toContain("src/dep.ts");
    expect(failure.graph).toContain(".pier/canvases/x.canvas.tsx");
  });
});
