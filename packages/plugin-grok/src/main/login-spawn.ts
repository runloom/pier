import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

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
const LOGIN_OUTPUT_LIMIT = 8192;
const LOGIN_FAILURE_DETAIL_LIMIT = 512;
const SENSITIVE_LOGIN_OUTPUT_PATTERN =
  /(?:access|refresh|id)[_-]?token|authorization|bearer\s|xai-[a-z0-9_-]+/i;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function defaultRealGrokHome(
  processEnv?: Readonly<Record<string, string | undefined>>
): string {
  return (
    processEnv?.GROK_HOME ?? process.env.GROK_HOME ?? join(homedir(), ".grok")
  );
}

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
  return { ...process.env, ...processEnv, ...overrides };
}

function safeLoginFailureDetail(output: string): string | null {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.findLast(
    (line) => !SENSITIVE_LOGIN_OUTPUT_PATTERN.test(line)
  );
  if (!detail) return null;
  return detail.slice(0, LOGIN_FAILURE_DETAIL_LIMIT);
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
    // Class A: opts.env is host-hydrated (resolveProcessEnv + overrides).
    const child = spawn(cmd, args, {
      env: opts.env as NodeJS.ProcessEnv,
      // `signal` kills the child on abort even when abort fires between the
      // aborted-check above and listener registration below.
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const forward = (chunk: Buffer | string): void => {
      const plain = stripAnsi(String(chunk));
      output = (output + plain).slice(-LOGIN_OUTPUT_LIMIT);
      opts.onOutput?.(plain);
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
        const detail = safeLoginFailureDetail(output);
        reject(
          new Error(
            detail
              ? `Grok login failed (exit code ${code}): ${detail}`
              : `Grok login exited with code ${code}`
          )
        );
      }
    });
  });
}
