import {
  compareAgentVersions,
  extractVersionFromOutput,
  isAgentUpdateAvailable,
} from "@shared/agent-lifecycle/version-compare.ts";
import { describe, expect, it } from "vitest";

describe("agent-lifecycle version-compare", () => {
  it("compares dotted versions", () => {
    expect(compareAgentVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareAgentVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareAgentVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("treats prerelease as older than release", () => {
    expect(compareAgentVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
  });

  it("detects update availability", () => {
    expect(isAgentUpdateAvailable("1.0.0", "1.0.1")).toBe(true);
    expect(isAgentUpdateAvailable("1.0.1", "1.0.0")).toBe(false);
    expect(isAgentUpdateAvailable(null, "1.0.0")).toBe(false);
  });

  it("extracts version from noisy stdout", () => {
    expect(extractVersionFromOutput("claude 2.1.221 (Claude Code)")).toBe(
      "2.1.221"
    );
    expect(extractVersionFromOutput("")).toBeNull();
  });
});
