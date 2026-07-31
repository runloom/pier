import { describe, expect, it } from "vitest";
import { withDevProfileEnv } from "../../../scripts/dev-profile.mjs";
import { withoutEsbuildBinaryOverride } from "../../../scripts/esbuild-process-env.mjs";

const PROFILE = {
  devPort: 5173,
  electronUserDataDir: "/tmp/pier-dev",
  hmrPort: 5183,
  host: "127.0.0.1",
  profile: "test-profile",
  profileDir: "/repo/.pier-dev",
  profileFile: "/repo/.pier-dev/profile.json",
  rendererUrl: "http://127.0.0.1:5173",
  runtimeFile: "/repo/.pier-dev/runtime.json",
  version: 1 as const,
  worktreeRoot: "/repo",
};

describe("development esbuild environment", () => {
  it("repository tool commands remove inherited packaged-app overrides without mutating the caller", () => {
    const baseEnv = {
      ESBUILD_BINARY_PATH:
        "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild",
      PATH: "/usr/bin",
    };

    const env = withoutEsbuildBinaryOverride(baseEnv);

    expect(env.ESBUILD_BINARY_PATH).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(baseEnv.ESBUILD_BINARY_PATH).toContain("app.asar.unpacked");
  });

  it("does not pass a global esbuild binary override to Electron Vite", () => {
    const env = withDevProfileEnv(
      {
        ESBUILD_BINARY_PATH:
          "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild",
        PATH: "/usr/bin",
      },
      PROFILE
    ) as NodeJS.ProcessEnv;

    expect(env.ESBUILD_BINARY_PATH).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
