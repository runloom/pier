import { describe, expect, it } from "vitest";
import {
  isInstallerKillRattleLine,
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

  it("drops npm SIGTERM / --force rattle from a timed-out install", () => {
    const raw = [
      "npm warn using --force Recommended protections disabled.",
      "npm error process terminated",
      "npm error signal SIGTERM",
      "npm error A complete log of this run can be found in: /Users/dev/.npm/_logs/debug.log",
    ].join("\n");
    expect(isInstallerKillRattleLine(raw.split("\n")[0] ?? "")).toBe(true);
    expect(sanitizeProcessOutput(raw)).toBe("");
  });

  it("keeps real errors while dropping npm self-error companions", () => {
    const raw = [
      "npm warn using --force Recommended protections disabled.",
      "npm error Exit handler never called!",
      "npm error This is an error with npm itself. Please report this error at:",
      "npm error   <https://github.com/npm/cli/issues>",
      "npm error code EACCES",
      "npm error A complete log of this run can be found in:",
      "    /Users/dev/.npm/_logs/debug-0.log",
    ].join("\n");
    const cleaned = sanitizeProcessOutput(raw);
    expect(cleaned).toBe("npm error code EACCES");
    expect(cleaned).not.toContain("Exit handler");
    expect(cleaned).not.toContain("github.com/npm");
    expect(cleaned).not.toContain("_logs");
  });

  it("parses last percent from a chunk", () => {
    expect(parseProgressPercent("99.2%####\n99.4%####")).toBeCloseTo(99.4);
    expect(parseProgressPercent("no percent here")).toBeNull();
  });
});
