import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorktreeDevProfile,
  isNoRendererWindowError,
  isPackagedPierCli,
  NO_RENDERER_WINDOW_MESSAGE,
  retryUntilRendererWindow,
  shouldOpenApplication,
  shouldWaitForControlSocket,
  waitForSocket,
} from "../../../bin/pier-cli-launch.js";

describe("packaged CLI launch policy", () => {
  it("detects pier.mjs inside Pier.app plus ELECTRON_RUN_AS_NODE", () => {
    expect(
      isPackagedPierCli({
        argv1: "/Applications/Pier.app/Contents/Resources/bin/pier.mjs",
        env: {},
        execPath: "/usr/local/bin/node",
        platform: "darwin",
      })
    ).toBe(true);
    expect(
      isPackagedPierCli({
        argv1: "/tmp/bin/pier.mjs",
        env: { ELECTRON_RUN_AS_NODE: "1" },
        execPath: "/Applications/Pier.app/Contents/MacOS/Pier",
        platform: "darwin",
      })
    ).toBe(true);
  });

  it("does not treat pnpm dev as packaged", () => {
    expect(
      isPackagedPierCli({
        argv1: "/Users/dev/pier/bin/pier.mjs",
        env: { PIER_DEV_PROFILE: "1" },
        execPath: "/Users/dev/pier/node_modules/.bin/electron",
        platform: "darwin",
      })
    ).toBe(false);
    expect(
      shouldOpenApplication({
        env: { PIER_DEV_PROFILE: "1" },
        packaged: true,
      })
    ).toBe(false);
  });

  it("does not open -a when a custom user-data dir is set", () => {
    expect(
      shouldOpenApplication({
        env: { PIER_USER_DATA_DIR: "/tmp/pier-custom-user" },
        hasDevProfile: false,
        packaged: true,
      })
    ).toBe(false);
    expect(
      shouldOpenApplication({
        env: { ELECTRON_USER_DATA_DIR: "/tmp/pier-electron-user" },
        hasDevProfile: false,
        packaged: true,
      })
    ).toBe(false);
    expect(
      shouldWaitForControlSocket({
        canLaunch: false,
        env: { PIER_USER_DATA_DIR: "/tmp/pier-custom-user" },
      })
    ).toBe(false);
  });

  it("waits without open -a when a socket env is set", () => {
    expect(
      shouldOpenApplication({
        env: { PIER_CONTROL_SOCKET: "/tmp/pier-control.sock" },
        packaged: true,
      })
    ).toBe(false);
  });

  it("does not open -a when .pier-dev/profile.json is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-launch-profile-"));
    mkdirSync(join(dir, ".pier-dev"));
    writeFileSync(
      join(dir, ".pier-dev", "profile.json"),
      JSON.stringify({ electronUserDataDir: "/tmp/pier-dev-user" })
    );
    try {
      expect(
        shouldOpenApplication({
          cwd: join(dir, "src"),
          env: {},
          packaged: true,
        })
      ).toBe(false);
      expect(findWorktreeDevProfile(join(dir, "src"))?.dir).toBe(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("opens packaged Pier only when there is no worktree profile", () => {
    expect(
      shouldOpenApplication({
        env: {},
        hasDevProfile: false,
        packaged: true,
      })
    ).toBe(true);
    expect(
      shouldWaitForControlSocket({
        canLaunch: true,
        env: {},
      })
    ).toBe(true);
    expect(
      shouldWaitForControlSocket({
        canLaunch: false,
        env: {},
      })
    ).toBe(false);
  });

  it("retries only the no-renderer-window platform_unavailable", () => {
    expect(
      isNoRendererWindowError({
        error: {
          code: "platform_unavailable",
          message: NO_RENDERER_WINDOW_MESSAGE,
        },
        ok: false,
      })
    ).toBe(true);
    expect(
      isNoRendererWindowError({
        error: {
          code: "platform_unavailable",
          message: "Files is not available",
        },
        ok: false,
      })
    ).toBe(false);
  });

  it("waitForSocket retries until connect", async () => {
    let attempts = 0;
    await waitForSocket("/tmp/pier-control.sock", {
      connectFn: () => {
        attempts += 1;
        const socket = Object.assign(new EventEmitter(), {
          destroy() {},
        });
        queueMicrotask(() => {
          if (attempts < 3) {
            socket.emit("error", new Error("ENOENT"));
            return;
          }
          socket.emit("connect");
        });
        return socket;
      },
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(attempts).toBe(3);
  });

  it("retries no-window errors until a window exists", async () => {
    const results = [
      {
        error: {
          code: "platform_unavailable",
          message: NO_RENDERER_WINDOW_MESSAGE,
        },
        ok: false,
      },
      { data: { panelId: "t1" }, ok: true },
    ];
    let index = 0;
    let now = 0;
    const result = await retryUntilRendererWindow({
      now: () => {
        now += 1;
        return now;
      },
      pollMs: 1,
      request: async () => results[index++] ?? results.at(-1),
      sleep: async () => undefined,
      timeoutMs: 10,
    });
    expect(result).toEqual({ data: { panelId: "t1" }, ok: true });
    expect(index).toBe(2);
  });

  it("does not retry other platform_unavailable errors after launch wait", async () => {
    const once = {
      error: {
        code: "platform_unavailable",
        message: "Files is not available",
      },
      ok: false,
    };
    const result = await retryUntilRendererWindow({
      request: async () => once,
      sleep: async () => {
        throw new Error("should not sleep");
      },
    });
    expect(result).toEqual(once);
  });
});
