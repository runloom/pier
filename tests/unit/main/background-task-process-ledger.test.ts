import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataPath = await mkdtemp(join(tmpdir(), "pier-bg-ledger-"));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "userData") {
        return userDataPath;
      }
      throw new Error(`unexpected app.getPath(${name})`);
    },
  },
}));

const {
  clearBackgroundTaskProcessLedgerQueueForTests,
  forgetBackgroundTaskProcess,
  reconcileOrphanedBackgroundProcesses,
  rememberBackgroundTaskProcess,
} = await import("@main/state/background-task-process-ledger.ts");

function ledgerFilePath(): string {
  return join(userDataPath, "background-task-process-ledger.json");
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("background-task-process-ledger", () => {
  beforeEach(() => {
    clearBackgroundTaskProcessLedgerQueueForTests();
  });

  afterEach(async () => {
    clearBackgroundTaskProcessLedgerQueueForTests();
    await writeFile(
      ledgerFilePath(),
      `${JSON.stringify({ entries: [], version: 1 })}\n`
    );
  });

  it("serializes remember/forget writes without dropping entries", async () => {
    await Promise.all([
      rememberBackgroundTaskProcess({
        command: "npm test",
        pid: 1001,
        runId: "run-a",
        startedAt: 1,
      }),
      rememberBackgroundTaskProcess({
        command: "npm lint",
        pid: 1002,
        runId: "run-b",
        startedAt: 2,
      }),
      forgetBackgroundTaskProcess("run-a"),
    ]);

    const file = JSON.parse(await readFile(ledgerFilePath(), "utf8")) as {
      entries: Array<{ runId: string; pid: number }>;
    };
    expect(file.entries).toEqual([
      expect.objectContaining({ pid: 1002, runId: "run-b" }),
    ]);
  });

  it("skips reclaim when the live process command no longer matches", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTypeOf("number");
    child.unref();

    try {
      await rememberBackgroundTaskProcess({
        command: "npm test",
        pid: pid as number,
        runId: "run-stale",
        startedAt: Date.now(),
      });

      const reclaimed = await reconcileOrphanedBackgroundProcesses({
        graceMs: 0,
      });

      expect(reclaimed).toBe(0);
      expect(processAlive(pid as number)).toBe(true);
      const file = JSON.parse(await readFile(ledgerFilePath(), "utf8")) as {
        entries: unknown[];
      };
      expect(file.entries).toEqual([]);
    } finally {
      try {
        process.kill(-(pid as number), "SIGKILL");
      } catch {
        try {
          process.kill(pid as number, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });

  it("reclaims an orphan whose command still matches the ledger hint", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTypeOf("number");
    child.unref();

    try {
      await rememberBackgroundTaskProcess({
        command: "sleep 30",
        pid: pid as number,
        runId: "run-live",
        startedAt: Date.now(),
      });

      const reclaimed = await reconcileOrphanedBackgroundProcesses({
        graceMs: 50,
      });

      expect(reclaimed).toBe(1);
      await vi.waitFor(() => {
        expect(processAlive(pid as number)).toBe(false);
      });
    } finally {
      try {
        process.kill(-(pid as number), "SIGKILL");
      } catch {
        try {
          process.kill(pid as number, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });

  it("drops ledger entries older than the max age without signaling", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    expect(pid).toBeTypeOf("number");
    child.unref();

    try {
      await rememberBackgroundTaskProcess({
        command: "sleep 30",
        pid: pid as number,
        runId: "run-old",
        startedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      });

      const reclaimed = await reconcileOrphanedBackgroundProcesses({
        graceMs: 0,
        now: () => Date.now(),
      });

      expect(reclaimed).toBe(0);
      expect(processAlive(pid as number)).toBe(true);
    } finally {
      try {
        process.kill(-(pid as number), "SIGKILL");
      } catch {
        try {
          process.kill(pid as number, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });
});
