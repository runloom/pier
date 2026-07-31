// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSandboxedPreloadConfig } from "../../../scripts/preload-build-config.ts";

describe("sandboxed preload build configuration", () => {
  it("bundles third-party dependencies into the CommonJS preload", () => {
    const config = createSandboxedPreloadConfig("/repo");

    expect(config.build.externalizeDeps).toBe(false);
    expect(config.build.lib).toMatchObject({
      entry: "/repo/src/preload/index.ts",
      formats: ["cjs"],
    });
    expect(config).not.toHaveProperty("plugins");
  });
});
