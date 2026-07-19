import { createExternalPluginProcessEnv } from "@main/plugins/external-plugin-process-env.ts";
import { afterEach, describe, expect, it } from "vitest";

describe("createExternalPluginProcessEnv", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it("reads PATH live so post-activate hydration is visible", () => {
    process.env.PATH = "/gui/bin";
    const env = createExternalPluginProcessEnv();
    expect(env.PATH).toBe("/gui/bin");

    process.env.PATH = "/live/shell/bin:/gui/bin";
    expect(env.PATH).toBe("/live/shell/bin:/gui/bin");
    expect({ ...env }.PATH).toBe("/live/shell/bin:/gui/bin");
  });
});
