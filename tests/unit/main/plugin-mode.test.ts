import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWorktreeDevElectronRuntime } from "../../../src/main/services/managed-plugins/plugin-mode.ts";

describe("managed plugin mode runtime classification", () => {
  const cwd = "/workspace/pier";
  const copiedElectron = join(
    cwd,
    ".pier-dev",
    "electron-runtime",
    "PierDev.app",
    "Contents",
    "MacOS",
    "PierDev"
  );

  it("recognizes the profile-owned copied Electron app as a worktree dev runtime", () => {
    expect(
      isWorktreeDevElectronRuntime({
        actualExecPath: copiedElectron,
        cwd,
        devProfile: "cursor-example",
        devRuntime: true,
        electronExecPath: copiedElectron,
      })
    ).toBe(true);
  });

  it.each([
    {
      actualExecPath: copiedElectron,
      devProfile: undefined,
      devRuntime: true,
      electronExecPath: copiedElectron,
      name: "has no dev profile",
    },
    {
      actualExecPath: copiedElectron,
      devProfile: "cursor-example",
      devRuntime: false,
      electronExecPath: copiedElectron,
      name: "is not a dev runtime",
    },
    {
      actualExecPath: "/Applications/Pier.app/Contents/MacOS/Pier",
      devProfile: "cursor-example",
      devRuntime: true,
      electronExecPath: copiedElectron,
      name: "only has a forged configured executable path",
    },
    {
      actualExecPath: "/Applications/Pier.app/Contents/MacOS/Pier",
      devProfile: "cursor-example",
      devRuntime: true,
      electronExecPath: "/Applications/Pier.app/Contents/MacOS/Pier",
      name: "actually runs outside the worktree runtime directory",
    },
  ])("keeps packaged classification when it $name", (input) => {
    expect(isWorktreeDevElectronRuntime({ cwd, ...input })).toBe(false);
  });
});
