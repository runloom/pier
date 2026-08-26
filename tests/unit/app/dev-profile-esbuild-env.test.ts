import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  withDevProfileEnv,
  withElectronUserDataCliArgs,
} from "../../../scripts/dev-profile.mjs";
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
    expect(JSON.parse(String(env.ELECTRON_CLI_ARGS))).toEqual([
      "--user-data-dir=/tmp/pier-dev",
    ]);
  });

  it("pins --user-data-dir onto electron-vite CLI args without dropping inspect flags", () => {
    expect(withElectronUserDataCliArgs(undefined, "/tmp/pier-dev")).toBe(
      JSON.stringify(["--user-data-dir=/tmp/pier-dev"])
    );
    expect(
      withElectronUserDataCliArgs(
        JSON.stringify(["--inspect=9229"]),
        "/tmp/pier-dev"
      )
    ).toBe(JSON.stringify(["--inspect=9229", "--user-data-dir=/tmp/pier-dev"]));
    expect(
      withElectronUserDataCliArgs(
        JSON.stringify(["--user-data-dir=/already"]),
        "/tmp/pier-dev"
      )
    ).toBe(JSON.stringify(["--user-data-dir=/already"]));
  });

  it("persists PierDev launch env to the worktree profile so a packaged shell can restore it", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/dev-profile.mjs"),
      "utf8"
    );
    expect(source).toContain(
      'writeJson(path.join(profile.profileDir, "launch-env.json")'
    );
    expect(source).toContain(
      "ELECTRON_USER_DATA_DIR: profile.electronUserDataDir"
    );
    expect(source).toContain('NODE_ENV_ELECTRON_VITE: "development"');
  });
});
