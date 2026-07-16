import { describe, expect, it } from "vitest";
import {
  parsePluginMode,
  resolvePierPluginMode,
} from "../../../src/shared/plugin-mode.ts";

describe("resolvePierPluginMode", () => {
  it("forces release for packaged apps", () => {
    expect(
      resolvePierPluginMode({
        envMode: "workspace",
        configMode: "workspace",
        isDevRuntime: true,
        isPackagedApp: true,
      })
    ).toBe("release");
  });

  it("prefers env over config", () => {
    expect(
      resolvePierPluginMode({
        envMode: "release",
        configMode: "workspace",
        isDevRuntime: true,
        isPackagedApp: false,
      })
    ).toBe("release");
  });

  it("defaults to workspace in dev when unset", () => {
    expect(
      resolvePierPluginMode({
        envMode: null,
        configMode: null,
        isDevRuntime: true,
        isPackagedApp: false,
      })
    ).toBe("workspace");
  });

  it("defaults to release outside dev", () => {
    expect(
      resolvePierPluginMode({
        envMode: null,
        configMode: null,
        isDevRuntime: false,
        isPackagedApp: false,
      })
    ).toBe("release");
  });

  it("parses mode tokens", () => {
    expect(parsePluginMode("workspace")).toBe("workspace");
    expect(parsePluginMode("release")).toBe("release");
    expect(parsePluginMode("other")).toBeNull();
  });

  it("honors config mode when env is unset", () => {
    expect(
      resolvePierPluginMode({
        envMode: null,
        configMode: "release",
        isDevRuntime: true,
        isPackagedApp: false,
      })
    ).toBe("release");
  });
});
