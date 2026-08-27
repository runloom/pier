import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hydrateDevLaunchEnv,
  isPierDevShellExecutable,
  launchEnvFileFromPierDevExec,
  resetDevLaunchEnvHydrationForTests,
} from "../../../src/main/dev-launch-env.ts";

const EXEC =
  "/repo/.pier-dev/electron-runtime/PierDev.app/Contents/MacOS/PierDev";

describe("dev launch env hydration", () => {
  afterEach(() => {
    resetDevLaunchEnvHydrationForTests();
  });

  it("recognizes the renamed PierDev shell executable", () => {
    expect(isPierDevShellExecutable(EXEC)).toBe(true);
    expect(isPierDevShellExecutable("/usr/local/bin/node")).toBe(false);
    expect(launchEnvFileFromPierDevExec(EXEC)).toBe(
      "/repo/.pier-dev/launch-env.json"
    );
  });

  it("fills stripped env keys from launch-env.json next to the PierDev shell", () => {
    const profileDir = join(
      mkdtempSync(join(tmpdir(), "pier-launch-env-")),
      ".pier-dev"
    );
    mkdirSync(
      join(profileDir, "electron-runtime", "PierDev.app", "Contents", "MacOS"),
      {
        recursive: true,
      }
    );
    writeFileSync(
      join(profileDir, "launch-env.json"),
      JSON.stringify({
        ELECTRON_USER_DATA_DIR: "/tmp/pier-dev-profile",
        NODE_ENV_ELECTRON_VITE: "development",
        PIER_DEV_ELECTRON_SHELL: "1",
      }),
      "utf8"
    );
    const execPath = join(
      profileDir,
      "electron-runtime",
      "PierDev.app",
      "Contents",
      "MacOS",
      "PierDev"
    );
    const env: NodeJS.ProcessEnv = {};
    hydrateDevLaunchEnv(env, execPath);
    expect(env.ELECTRON_USER_DATA_DIR).toBe("/tmp/pier-dev-profile");
    expect(env.NODE_ENV_ELECTRON_VITE).toBe("development");
    expect(env.PIER_DEV_ELECTRON_SHELL).toBe("1");
  });

  it("does not overwrite env keys the parent already provided", () => {
    const profileDir = join(
      mkdtempSync(join(tmpdir(), "pier-launch-env-keep-")),
      ".pier-dev"
    );
    mkdirSync(
      join(profileDir, "electron-runtime", "PierDev.app", "Contents", "MacOS"),
      { recursive: true }
    );
    writeFileSync(
      join(profileDir, "launch-env.json"),
      JSON.stringify({
        ELECTRON_USER_DATA_DIR: "/from-file",
        NODE_ENV_ELECTRON_VITE: "development",
      }),
      "utf8"
    );
    const env: NodeJS.ProcessEnv = {
      ELECTRON_USER_DATA_DIR: "/already",
    };
    hydrateDevLaunchEnv(
      env,
      join(
        profileDir,
        "electron-runtime",
        "PierDev.app",
        "Contents",
        "MacOS",
        "PierDev"
      )
    );
    expect(env.ELECTRON_USER_DATA_DIR).toBe("/already");
    expect(env.NODE_ENV_ELECTRON_VITE).toBe("development");
  });

  it("skips hydration for ordinary executables", () => {
    const env: NodeJS.ProcessEnv = {};
    hydrateDevLaunchEnv(env, "/usr/local/bin/node");
    expect(env.ELECTRON_USER_DATA_DIR).toBeUndefined();
  });
});
