import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abortMissingSingleInstanceLock,
  formatDevSingleInstanceLockFailure,
} from "@main/startup-diagnostics.ts";
import { describe, expect, it, vi } from "vitest";

const MAIN_SOURCE = readFileSync(
  join(process.cwd(), "src/main/index.ts"),
  "utf8"
);

describe("startup diagnostics", () => {
  it("explains dev single-instance lock failures with the profile context", () => {
    const message = formatDevSingleInstanceLockFailure({
      profile: "pier-80345b16",
      rendererUrl: "http://127.0.0.1:5176",
      userDataDir:
        "/Users/example/Library/Application Support/Pier-dev/pier-80345b16",
    });

    expect(message).toContain(
      "[startup] another Pier instance already owns this dev profile"
    );
    expect(message).toContain("profile: pier-80345b16");
    expect(message).toContain("renderer: http://127.0.0.1:5176");
    expect(message).toContain(
      "userData: /Users/example/Library/Application Support/Pier-dev/pier-80345b16"
    );
    expect(message).toContain("Stop the existing Pier/Electron process");
  });

  it("fails the dev process instead of silently quitting when the lock is taken", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const host = {
      exit: vi.fn(),
      getPath: vi.fn(() => "/tmp/pier-dev-profile"),
      quit: vi.fn(),
    };
    const logError = vi.fn();
    try {
      abortMissingSingleInstanceLock(true, host, logError, {
        PIER_DEV_PROFILE: "feat-bug",
        ELECTRON_RENDERER_URL: "http://127.0.0.1:5178",
      });
    } finally {
      write.mockRestore();
    }
    expect(logError).toHaveBeenCalledOnce();
    expect(String(logError.mock.calls[0]?.[0])).toContain(
      "another Pier instance already owns this dev profile"
    );
    expect(host.exit).toHaveBeenCalledWith(1);
    expect(host.quit).not.toHaveBeenCalled();
    expect(MAIN_SOURCE).toContain("abortMissingSingleInstanceLock(isDev, app");
  });

  it("keeps production second-instance handling as a quiet quit", () => {
    const host = {
      exit: vi.fn(),
      getPath: vi.fn(() => "/tmp/Pier"),
      quit: vi.fn(),
    };
    abortMissingSingleInstanceLock(false, host, vi.fn());
    expect(host.quit).toHaveBeenCalledOnce();
    expect(host.exit).not.toHaveBeenCalled();
  });
});
