import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  resolveWindowsSupervisorPath,
  type WindowsSupervisor,
} from "./process-termination.ts";

const WINDOWS_SUPERVISOR_READY_TIMEOUT_MS = 2000;
const WINDOWS_SUPERVISOR_CONTROL_LIMIT_BYTES = 8 * 1024;

export function spawnWindowsSupervisor(): WindowsSupervisor {
  if (process.platform !== "win32") {
    throw new Error("The Windows LSP supervisor can only run on win32");
  }
  const child = spawn(process.execPath, [resolveWindowsSupervisorPath()], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams & {
    stdio: [
      unknown,
      unknown,
      unknown,
      NodeJS.WritableStream,
      NodeJS.ReadableStream & { destroy(): void },
    ];
  };
  const controlInput = child.stdio[3];
  const controlOutput = child.stdio[4];
  const ready = Promise.withResolvers<void>();
  const terminal = Promise.withResolvers<void>();
  let controlBytes = 0;
  let controlBuffer = "";
  let readySettled = false;
  const readyTimer = setTimeout(() => {
    if (!readySettled) {
      readySettled = true;
      ready.reject(new Error("Windows LSP supervisor readiness timed out"));
    }
  }, WINDOWS_SUPERVISOR_READY_TIMEOUT_MS);
  readyTimer.unref?.();

  const rejectReadyOrFailChild = (error: unknown) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimer);
      ready.reject(error);
      return;
    }
    child.emit("error", error);
  };

  controlOutput.on("data", (chunk: string | Buffer) => {
    controlBytes +=
      typeof chunk === "string"
        ? Buffer.byteLength(chunk, "utf8")
        : chunk.byteLength;
    if (controlBytes > WINDOWS_SUPERVISOR_CONTROL_LIMIT_BYTES) {
      rejectReadyOrFailChild(
        new Error("Windows LSP supervisor control output exceeded 8KiB")
      );
      controlOutput.destroy();
      return;
    }
    controlBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (;;) {
      const newline = controlBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      try {
        const message = JSON.parse(line) as {
          code?: number | null;
          message?: string;
          signal?: NodeJS.Signals | null;
          type?: unknown;
        };
        if (message.type === "supervisor-ready" && !readySettled) {
          readySettled = true;
          clearTimeout(readyTimer);
          ready.resolve();
        } else if (message.type === "server-exit") {
          child.emit("exit", message.code ?? null, message.signal ?? null);
        } else if (message.type === "spawn-error") {
          child.emit(
            "error",
            new Error(message.message ?? "Windows LSP provider failed to spawn")
          );
        }
      } catch (error) {
        rejectReadyOrFailChild(error);
      }
    }
  });
  controlInput.on("error", rejectReadyOrFailChild);
  controlOutput.on("error", rejectReadyOrFailChild);
  child.once("error", (error) => {
    if (!readySettled) {
      readySettled = true;
      clearTimeout(readyTimer);
      ready.reject(error);
    }
  });
  child.once("close", () => {
    clearTimeout(readyTimer);
    if (!readySettled) {
      readySettled = true;
      ready.reject(
        new Error("Windows LSP supervisor exited before becoming ready")
      );
    }
    terminal.resolve();
  });

  return {
    child,
    closeControl() {
      controlInput.end();
    },
    ready: ready.promise,
    sendStart(launch) {
      const body = `${JSON.stringify({ launch, type: "start" })}\n`;
      if (
        Buffer.byteLength(body, "utf8") > WINDOWS_SUPERVISOR_CONTROL_LIMIT_BYTES
      ) {
        throw new Error("Windows LSP supervisor start command exceeded 8KiB");
      }
      controlInput.write(body);
    },
    terminal: terminal.promise,
  };
}
