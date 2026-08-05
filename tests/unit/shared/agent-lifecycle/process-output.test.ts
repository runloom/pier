import { describe, expect, it } from "vitest";
import {
  isProgressNoiseLine,
  parseProgressPercent,
  sanitizeProcessOutput,
} from "../../../../src/shared/agent-lifecycle/process-output.ts";

describe("agent lifecycle process output", () => {
  it("detects uv-style progress bars as noise", () => {
    expect(isProgressNoiseLine("99.2%################################")).toBe(
      true
    );
    expect(isProgressNoiseLine("################")).toBe(true);
    expect(isProgressNoiseLine("error: failed to fetch")).toBe(false);
  });

  it("strips progress bars from error detail", () => {
    const raw = [
      "99.2%################################",
      "99.3%################################",
      "error: HTTP 403 Forbidden",
      "hint: check credentials",
    ].join("\n");
    const cleaned = sanitizeProcessOutput(raw);
    expect(cleaned).toContain("HTTP 403");
    expect(cleaned).toContain("credentials");
    expect(cleaned).not.toContain("####");
    expect(cleaned).not.toMatch(/99\.\d%/);
  });

  it("handles CR redraw progress streams", () => {
    const raw =
      "10%####\r50%##########\r99%####################\rerror: boom\n";
    const cleaned = sanitizeProcessOutput(raw);
    expect(cleaned).toBe("error: boom");
  });

  it("parses last percent from a chunk", () => {
    expect(parseProgressPercent("99.2%####\n99.4%####")).toBeCloseTo(99.4);
    expect(parseProgressPercent("no percent here")).toBeNull();
  });
});
