import { spawn } from "node:child_process";
import type { TaskOutputStream } from "@shared/contracts/tasks.ts";

export interface SpawnBackgroundTaskArgs {
  command: string;
  cwd: string;
  env: Record<string, string>;
  onError(error: Error): void;
  onExit(exitCode: number | null): void;
  onOutput(stream: TaskOutputStream, text: string): void;
}

export interface BackgroundTaskProcess {
  forceKill?(): boolean;
  interrupt?(): boolean;
  kill(): boolean;
}

export type SpawnBackgroundTask = (
  args: SpawnBackgroundTaskArgs
) => BackgroundTaskProcess;

export function signalBackgroundTaskProcess(
  process: BackgroundTaskProcess | undefined,
  force: boolean
): boolean {
  if (!process) {
    return false;
  }
  if (force) {
    return process.forceKill?.() ?? process.kill();
  }
  return process.interrupt?.() ?? process.kill();
}

export const spawnBackgroundTask: SpawnBackgroundTask = ({
  command,
  cwd,
  env,
  onError,
  onExit,
  onOutput,
}) => {
  const shell = env.SHELL ?? process.env.SHELL ?? "/bin/sh";
  const child = spawn(shell, ["-lc", command], {
    cwd,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forwardOutput = (stream: TaskOutputStream, text: string) => {
    if (text.length > 0) {
      onOutput(stream, text);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => forwardOutput("stdout", text));
  child.stderr.on("data", (text: string) => forwardOutput("stderr", text));
  child.on("error", onError);
  child.on("close", (code) => {
    onExit(code);
  });
  const signal = (value: NodeJS.Signals): boolean => {
    if (process.platform !== "win32" && child.pid) {
      try {
        return process.kill(-child.pid, value);
      } catch {
        // Process group may already be gone; fall back to the direct child.
      }
    }
    return child.kill(value);
  };
  return {
    forceKill: () => signal("SIGKILL"),
    interrupt: () => signal("SIGINT"),
    kill: () => signal("SIGTERM"),
  };
};
