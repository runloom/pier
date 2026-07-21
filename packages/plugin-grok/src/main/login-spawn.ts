import { spawn } from "node:child_process";

export type SpawnLoginFn = (
  cmd: string,
  args: string[],
  opts: {
    env: Record<string, string | undefined>;
    onOutput?: (chunk: string) => void;
    signal: AbortSignal;
  }
) => Promise<void>;

/** Strip ANSI escape sequences so parsed CLI output is plain text. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape bytes is the point
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function defaultSpawnLogin(
  cmd: string,
  args: string[],
  opts: {
    env: Record<string, string | undefined>;
    onOutput?: (chunk: string) => void;
    signal: AbortSignal;
  }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Abort may already have fired (cancel raced ahead of the spawn); the
    // "abort" event will never fire again, so check before spawning.
    if (opts.signal.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    // Capture output instead of inheriting: a GUI-launched Electron app has
    // no visible stdout, and device-code login prints the verification URL
    // and user code there.
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      // `signal` kills the child on abort even when abort fires between the
      // aborted-check above and listener registration below.
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const forward = (chunk: Buffer | string): void => {
      opts.onOutput?.(stripAnsi(String(chunk)));
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);

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
        reject(new Error("Grok CLI not found on PATH"));
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
        reject(new Error(`Grok login exited with code ${code}`));
      }
    });
  });
}
