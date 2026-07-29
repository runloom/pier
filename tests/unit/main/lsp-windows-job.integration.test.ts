import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWindowsJobAddon } from "../../../src/main/services/lsp/lsp-process-termination.ts";

function resolveWindowsFixturePath(): string {
  if (process.platform !== "win32") {
    throw new Error("Windows LSP fixture path requested off win32");
  }
  return fileURLToPath(
    new URL("../../fixtures/lsp-windows-job-child.cjs", import.meta.url)
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

describe.skipIf(process.platform !== "win32")(
  "real Windows LSP Job Object addon",
  () => {
    it("contains a grandchild after server-first-exit and reaches active=0 after terminate and close", async () => {
      const fixturePath = resolveWindowsFixturePath();
      const addon = loadWindowsJobAddon();
      const job = addon.createJob();
      const supervisor = spawn(process.execPath, [fixturePath, "supervisor"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (!(supervisor.pid && supervisor.stdout)) {
        throw new Error("expected a spawned supervisor with stdout");
      }
      const supervisorClosed = once(supervisor, "close");
      const processHandle = addon.openProcess(supervisor.pid);
      const lines = createInterface({ input: supervisor.stdout })[
        Symbol.asyncIterator
      ]();
      let grandchildPid = 0;

      try {
        addon.assignProcess(job, processHandle);
        supervisor.stdin.write("start\n");

        for (;;) {
          const line = await lines.next();
          if (line.done) {
            throw new Error("supervisor output ended before grandchild pid");
          }
          const message = JSON.parse(line.value) as {
            grandchildPid?: number;
            serverExited?: boolean;
          };
          if (message.grandchildPid) {
            grandchildPid = message.grandchildPid;
            break;
          }
        }
        for (;;) {
          const line = await lines.next();
          if (line.done) {
            throw new Error("supervisor output ended before server exit");
          }
          const message = JSON.parse(line.value) as {
            serverExited?: boolean;
          };
          if (message.serverExited) {
            break;
          }
        }

        expect(grandchildPid).toBeGreaterThan(0);
        expect(isProcessAlive(grandchildPid)).toBe(true);
        expect(addon.queryActiveProcesses(job)).toBeGreaterThan(0);

        addon.terminateJob(job);
        await supervisorClosed;
        expect(addon.queryActiveProcesses(job)).toBe(0);
        expect(isProcessAlive(grandchildPid)).toBe(false);
      } finally {
        if (isProcessAlive(supervisor.pid)) {
          await addon.terminateProcessAndWait(processHandle, 2000);
          await supervisorClosed;
        }
        addon.close(processHandle);
        addon.close(job);
      }
    }, 20_000);

    it("directly terminates the supervisor after a real assign failure without starting its provider", async () => {
      const fixturePath = resolveWindowsFixturePath();
      const addon = loadWindowsJobAddon();
      const job = addon.createJob();
      const supervisor = spawn(process.execPath, [fixturePath, "supervisor"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (!(supervisor.pid && supervisor.stdout)) {
        throw new Error("expected a spawned supervisor with stdout");
      }
      const supervisorClosed = once(supervisor, "close");
      const processHandle = addon.openProcess(supervisor.pid);
      addon.close(job);
      expect(() => addon.assignProcess(job, processHandle)).toThrow();
      let output = "";
      supervisor.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });

      try {
        supervisor.stdin.end();
        await addon.terminateProcessAndWait(processHandle, 2000);
        await supervisorClosed;

        expect(output).toBe("");
        expect(isProcessAlive(supervisor.pid)).toBe(false);
      } finally {
        addon.close(processHandle);
      }
    }, 10_000);
  }
);
