import { type ChildProcess, spawn } from "node:child_process";
import {
  parseProgressPercent,
  sanitizeProcessOutput,
} from "@shared/agent-lifecycle/process-output.ts";
import { mergeLifecycleChildEnv } from "./child-env.ts";

/** Cap captured stdout/stderr so progress spam cannot blow memory. */
const MAX_CAPTURE_CHARS = 512 * 1024;

function appendCapped(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURE_CHARS) {
    return current;
  }
  const room = MAX_CAPTURE_CHARS - current.length;
  return room >= chunk.length
    ? current + chunk
    : current + chunk.slice(0, room);
}

export function isNotFoundError(stderr: string, code: number | null): boolean {
  if (code === 127) {
    return true;
  }
  const s = stderr.toLowerCase();
  return (
    s.includes("enoent") ||
    s.includes("not found") ||
    s.includes("is not recognized") ||
    s.includes("command not found")
  );
}

export function runProcess(
  file: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal | undefined;
    shell?: boolean | undefined;
    onPercent?: ((percent: number) => void) | undefined;
  }
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({
        code: null,
        stdout: "",
        stderr: "cancelled",
        cancelled: true,
        timedOut: false,
      });
      return;
    }

    let settled = false;
    const settle = (result: {
      code: number | null;
      stdout: string;
      stderr: string;
      cancelled: boolean;
      timedOut: boolean;
    }): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

    let cancelled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let child: ChildProcess;

    try {
      child = spawn(file, [...args], {
        env: mergeLifecycleChildEnv(options.env),
        windowsHide: true,
        shell: options.shell === true,
        // stdin ignore: installers that read TTY prompts must not block forever.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      settle({
        code: 1,
        stdout: "",
        stderr: message,
        cancelled: false,
        timedOut: false,
      });
      return;
    }

    const onAbort = (): void => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout?.on("data", (buf: Buffer | string) => {
      stdout = appendCapped(
        stdout,
        typeof buf === "string" ? buf : buf.toString()
      );
    });
    child.stderr?.on("data", (buf: Buffer | string) => {
      const text = typeof buf === "string" ? buf : buf.toString();
      stderr = appendCapped(stderr, text);
      const percent = parseProgressPercent(text);
      if (percent !== null) {
        options.onPercent?.(percent);
      }
    });

    child.on("error", (err) => {
      settle({
        code: 1,
        stdout,
        stderr: err.message || stderr,
        cancelled,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      if (cancelled) {
        settle({
          code: null,
          stdout,
          stderr: sanitizeProcessOutput(stderr) || "cancelled",
          cancelled: true,
          timedOut: false,
        });
        return;
      }
      if (timedOut) {
        settle({
          code: 124,
          stdout,
          stderr: sanitizeProcessOutput(stderr) || "timeout",
          cancelled: false,
          timedOut: true,
        });
        return;
      }
      settle({
        code: code ?? 1,
        stdout,
        stderr,
        cancelled: false,
        timedOut: false,
      });
    });
  });
}
