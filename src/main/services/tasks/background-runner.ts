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
  pid?: number | undefined;
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
  // Non-login + POSIX sh: processEnvironment.resolve() already captured the
  // full login+interactive env (-lic). A login flag would re-run .zprofile/
  // .profile and clobber the resolved PATH (e.g. brew overriding nvm).
  // /bin/sh (not env.SHELL) keeps task command semantics independent of the
  // user's interactive shell (zsh/fish/nushell) and matches the inner
  // /bin/sh -c wrapper in task-execution-plan.
  const child = spawn("/bin/sh", ["-c", command], {
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
    ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
  };
};
