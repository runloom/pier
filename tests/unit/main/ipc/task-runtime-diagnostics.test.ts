import { sanitizeTaskRuntimeDiagnosticCtx } from "@main/ipc/sanitize-task-runtime-diagnostic-ctx.ts";
import { describe, expect, it } from "vitest";

describe("sanitizeTaskRuntimeDiagnosticCtx", () => {
  it("returns undefined for missing ctx", () => {
    expect(sanitizeTaskRuntimeDiagnosticCtx(undefined)).toBeUndefined();
  });

  it("clips key count, string length, depth, and array length", () => {
    const manyKeys = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, i])
    );
    const long = "x".repeat(500);
    const deep = {
      a: {
        b: {
          c: { d: "too-deep" },
        },
      },
    };
    const clippedKeys = sanitizeTaskRuntimeDiagnosticCtx(manyKeys);
    expect(Object.keys(clippedKeys ?? {}).length).toBe(24);

    const cleaned = sanitizeTaskRuntimeDiagnosticCtx({
      arr: Array.from({ length: 30 }, (_, i) => i),
      deep,
      long,
      ok: true,
    });
    expect(cleaned).toBeDefined();
    expect(typeof cleaned?.long).toBe("string");
    expect((cleaned?.long as string).length).toBe(200);
    expect(Array.isArray(cleaned?.arr)).toBe(true);
    expect((cleaned?.arr as unknown[]).length).toBe(16);
    // depth 2 collapses nested objects (root → a → b becomes summary)
    const deepA = cleaned?.deep as Record<string, unknown>;
    expect(typeof deepA?.a).toBe("object");
    const deepB = deepA?.a as Record<string, unknown>;
    expect(typeof deepB?.b).toBe("string");
    expect(deepB?.b).toMatch(/^\[object:/);
  });

  it("drops non-JSON-safe values", () => {
    const cleaned = sanitizeTaskRuntimeDiagnosticCtx({
      fn: () => 1,
      n: Number.NaN,
      ok: 1,
      sym: Symbol("x"),
    });
    expect(cleaned).toEqual({
      n: "NaN",
      ok: 1,
    });
  });
});
