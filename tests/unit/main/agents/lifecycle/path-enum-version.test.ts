import { describe, expect, it } from "vitest";
import { shouldProbeInstallVersion } from "../../../../../src/main/services/agents/lifecycle/sources/path-enum.ts";

describe("shouldProbeInstallVersion", () => {
  it("only versions the PATH-default copy", () => {
    expect(shouldProbeInstallVersion(0)).toBe(true);
    expect(shouldProbeInstallVersion(1)).toBe(false);
    expect(shouldProbeInstallVersion(2)).toBe(false);
  });
});
