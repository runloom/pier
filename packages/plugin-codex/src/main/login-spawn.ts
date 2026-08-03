import { spawn } from "node:child_process";

export type SpawnLoginFn = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
) => Promise<void>;

/** Merge host-resolved shell env with optional spawn overrides (Class A). */
export async function hostSpawnEnv(
  resolveProcessEnv:
    | ((request?: { cwd?: string }) => Promise<{ env: Record<string, string> }>)
    | undefined,
  processEnv: Readonly<Record<string, string | undefined>> | undefined,
  overrides?: Record<string, string | undefined>
): Promise<Record<string, string | undefined>> {
  if (resolveProcessEnv) {
    const { env } = await resolveProcessEnv({});
    return { ...env, ...overrides };
  }
  // Tests / fallback: live processEnv slice + process.env.
  return {
    ...process.env,
    ...processEnv,
    ...overrides,
  };
}

/**
 * Default spawn login — real `codex login`.
 * Production uses this; tests replace via opts.spawnLogin.
 */
export function defaultSpawnLogin(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Abort may already have fired (cancel raced ahead of the spawn); the
    // "abort" event will never fire again, so check before spawning.
    if (opts.signal.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    // Class A: opts.env is host-hydrated (resolveProcessEnv + overrides).
    const child = spawn(cmd, args, {
      env: opts.env as NodeJS.ProcessEnv,
      // `signal` kills the child on abort even when abort fires between the
      // aborted-check above and listener registration below.
      signal: opts.signal,
      stdio: "inherit",
    });

    opts.signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Login cancelled"));
      },
      { once: true }
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.name === "AbortError") {
        reject(new Error("Login cancelled"));
        return;
      }
      if (error.code === "ENOENT") {
        reject(new Error("Codex CLI not found on PATH"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (opts.signal.aborted) {
        reject(new Error("Login cancelled"));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with code ${code}`));
      }
    });
  });
}
