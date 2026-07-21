import { describe, expect, it } from "vitest";
import {
  isDevShellPackagedOverride,
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

describe("isDevShellPackagedOverride", () => {
  it("recognizes the renamed PierDev dev shell (isPackaged + dev env + marker)", () => {
    expect(
      isDevShellPackagedOverride({
        devShellMarker: "1",
        isDevRuntime: true,
        isPackagedApp: true,
      })
    ).toBe(true);
  });

  it("never overrides a production package without the dev runtime env", () => {
    expect(
      isDevShellPackagedOverride({
        devShellMarker: "1",
        isDevRuntime: false,
        isPackagedApp: true,
      })
    ).toBe(false);
  });

  it("requires the explicit dev-shell marker", () => {
    expect(
      isDevShellPackagedOverride({
        devShellMarker: undefined,
        isDevRuntime: true,
        isPackagedApp: true,
      })
    ).toBe(false);
  });

  it("is irrelevant for unpackaged runtimes", () => {
    expect(
      isDevShellPackagedOverride({
        devShellMarker: "1",
        isDevRuntime: true,
        isPackagedApp: false,
      })
    ).toBe(false);
  });
});
