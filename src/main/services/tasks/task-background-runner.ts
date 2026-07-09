import { spawn } from "node:child_process";

export interface SpawnBackgroundTaskArgs {
  command: string;
  cwd: string;
  env: Record<string, string>;
  onError(error: Error): void;
  onExit(exitCode: number | null): void;
}

export interface BackgroundTaskProcess {
  kill(): void;
}

export type SpawnBackgroundTask = (
  args: SpawnBackgroundTaskArgs
) => BackgroundTaskProcess;

export const spawnBackgroundTask: SpawnBackgroundTask = ({
  command,
  cwd,
  env,
  onError,
  onExit,
}) => {
  const shell = env.SHELL ?? process.env.SHELL ?? "/bin/sh";
  const child = spawn(shell, ["-lc", command], {
    cwd,
    env,
    stdio: "ignore",
  });
  child.on("error", onError);
  child.on("close", (code) => {
    onExit(code);
  });
  return {
    kill: () => {
      child.kill();
    },
  };
};
