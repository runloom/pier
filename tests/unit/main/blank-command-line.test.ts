import { isBlankShellCommandLine } from "@main/services/foreground-activity/blank-command-line.ts";
import { describe, expect, it } from "vitest";

describe("isBlankShellCommandLine", () => {
  it("treats empty and whitespace-only cmdline as blank (empty Enter)", () => {
    expect(isBlankShellCommandLine("")).toBe(true);
    expect(isBlankShellCommandLine("   ")).toBe(true);
  });

  it("keeps real commands", () => {
    expect(isBlankShellCommandLine("ls")).toBe(false);
    expect(isBlankShellCommandLine("  pwd")).toBe(false);
  });
});
