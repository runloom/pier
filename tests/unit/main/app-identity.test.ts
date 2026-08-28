import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const setName = vi.fn();
const setPath = vi.fn();

vi.mock("electron", () => ({
  app: {
    setName,
    setPath,
  },
}));

const { configureMainAppIdentity, resolveMainUserDataDir } = await import(
  "../../../src/main/app-identity.ts"
);

describe("main app identity", () => {
  const originalEnv = process.env.ELECTRON_USER_DATA_DIR;
  const originalArgv = process.argv;

  afterEach(() => {
    setName.mockClear();
    setPath.mockClear();
    if (originalEnv === undefined) {
      delete process.env.ELECTRON_USER_DATA_DIR;
    } else {
      process.env.ELECTRON_USER_DATA_DIR = originalEnv;
    }
    process.argv = originalArgv;
    delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
  });

  it("pins userData after setName so the installed app lock is not reused", () => {
    process.env.ELECTRON_USER_DATA_DIR =
      "/Users/me/Library/Application Support/Pier-dev/feat-bug";
    configureMainAppIdentity(true);
    expect(setName).toHaveBeenCalledWith("Pier");
    expect(setPath).toHaveBeenCalledWith(
      "userData",
      "/Users/me/Library/Application Support/Pier-dev/feat-bug"
    );
    const setNameOrder = setName.mock.invocationCallOrder[0];
    const setPathOrder = setPath.mock.invocationCallOrder[0];
    if (setNameOrder === undefined || setPathOrder === undefined) {
      throw new Error("Both app identity calls must be recorded");
    }
    expect(setNameOrder).toBeLessThan(setPathOrder);
  });

  it("reapplies --user-data-dir from argv after setName", () => {
    delete process.env.ELECTRON_USER_DATA_DIR;
    process.argv = ["electron", ".", "--user-data-dir=/tmp/e2e-user-data"];
    configureMainAppIdentity(false);
    expect(setPath).toHaveBeenCalledWith("userData", "/tmp/e2e-user-data");
  });

  it("does not invent a userData path for production", () => {
    delete process.env.ELECTRON_USER_DATA_DIR;
    process.argv = ["electron", "."];
    expect(
      resolveMainUserDataDir({ isDev: false, argv: ["electron"] })
    ).toBeUndefined();
    configureMainAppIdentity(false);
    expect(setName).toHaveBeenCalledWith("Pier");
    expect(setPath).not.toHaveBeenCalled();
  });

  it("falls back to a worktree-local Pier-dev dir in unpackaged dev", () => {
    delete process.env.ELECTRON_USER_DATA_DIR;
    expect(
      resolveMainUserDataDir({
        argv: ["electron"],
        cwd: "/repo/worktree",
        env: {},
        isDev: true,
      })
    ).toBe(join("/repo/worktree", ".pier-dev", "userData"));
  });
});
