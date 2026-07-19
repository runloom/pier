import { spawn } from "node:child_process";
import {
  type SshHost,
  type SshTestConnectionResult,
  sshTargetArgs,
} from "../shared/hosts.ts";

const TEST_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_SECONDS = 8;

/**
 * Non-interactive reachability probe: `ssh -oBatchMode=yes <target> true`.
 * BatchMode disables prompts, so passphrase-gated keys or unknown host keys
 * fail fast with a readable stderr instead of hanging on user input.
 */
export function testSshConnection(
  host: SshHost,
  env: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal
): Promise<SshTestConnectionResult> {
  if (signal?.aborted) {
    return Promise.resolve({ detail: "cancelled", ok: false });
  }
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
        ...sshTargetArgs(host),
        "true",
      ],
      { env: { ...env }, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    let settled = false;
    const abort = (): void => {
      child.kill("SIGKILL");
      settle({ detail: "cancelled", ok: false });
    };
    const settle = (result: SshTestConnectionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ detail: "timeout", ok: false });
    }, TEST_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: unknown) => {
      stderr += String(chunk);
    });
    child.on("error", (error: Error) => {
      settle({ detail: error.message, ok: false });
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        settle({ ok: true });
        return;
      }
      const detail = stderr.trim().split("\n").filter(Boolean).at(-1);
      settle({ ...(detail ? { detail } : {}), ok: false });
    });
  });
}
