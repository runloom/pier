import { mkdtemp, readFile, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeProcessOutput } from "@shared/agent-lifecycle/process-output.ts";
import { assertAllowedScriptUrl } from "../official-script.ts";
import type { PlannedInvocation, PlannedPlan } from "../plan/types.ts";
import { isNotFoundError, runProcess } from "./process.ts";
import type {
  LifecycleRunner,
  LifecycleRunOptions,
  LifecycleRunResult,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Package managers we spawn by bare name; ENOENT → try next channel. */
const PACKAGE_MANAGER_BINS = new Set(["npm", "brew", "pipx", "uv"]);

function stepFailureLabel(step: PlannedInvocation): string {
  if (step.kind === "argv") {
    return step.file;
  }
  if (step.kind === "official-script") {
    return "install script";
  }
  if (step.kind === "shell") {
    return "shell";
  }
  if (step.kind === "wsl") {
    return "wsl";
  }
  return "step";
}

async function runOfficialScript(
  step: Extract<PlannedInvocation, { kind: "official-script" }>,
  options: LifecycleRunOptions,
  timeoutMs: number,
  progressContext?: { stepIndex: number; stepCount: number }
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
}> {
  assertAllowedScriptUrl(step.url);
  const reportPercent = (percent: number): void => {
    if (!progressContext) {
      return;
    }
    options.onProgress?.({
      stepIndex: progressContext.stepIndex,
      stepCount: progressContext.stepCount,
      label: "install script",
      percent,
    });
  };
  if (step.platform === "win") {
    return runProcess(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `irm '${step.url}' | iex`,
      ],
      {
        env: options.env,
        timeoutMs,
        signal: options.signal,
        onPercent: reportPercent,
      }
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "pier-agent-install-"));
  const scriptPath = join(dir, "install.sh");
  try {
    const download = await runProcess(
      "curl",
      ["-fsSL", step.url, "-o", scriptPath],
      {
        env: options.env,
        timeoutMs: Math.min(timeoutMs, 120_000),
        signal: options.signal,
      }
    );
    if (download.cancelled || download.code !== 0) {
      return download;
    }
    await readFile(scriptPath);
    return await runProcess("bash", [scriptPath], {
      env: options.env,
      timeoutMs,
      signal: options.signal,
      onPercent: reportPercent,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runArgv(
  step: Extract<PlannedInvocation, { kind: "argv" }>,
  options: LifecycleRunOptions,
  timeoutMs: number,
  progressContext?: { stepIndex: number; stepCount: number }
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  packageManagerMissing?: boolean;
}> {
  const isWin = platform() === "win32";
  // On Windows, npm/brew-like shims are often .cmd — shell:true for bare names only.
  const useShell =
    isWin &&
    !step.file.includes("\\") &&
    !step.file.includes("/") &&
    !step.file.endsWith(".exe");

  const result = await runProcess(step.file, step.args, {
    env: options.env,
    timeoutMs,
    signal: options.signal,
    shell: useShell,
    onPercent: (percent) => {
      if (!progressContext) {
        return;
      }
      options.onProgress?.({
        stepIndex: progressContext.stepIndex,
        stepCount: progressContext.stepCount,
        label: step.file,
        percent,
      });
    },
  });

  if (
    result.code !== 0 &&
    isNotFoundError(result.stderr, result.code) &&
    PACKAGE_MANAGER_BINS.has(step.file)
  ) {
    return {
      ...result,
      stderr: `${step.file} not found on PATH`,
      packageManagerMissing: true,
    };
  }
  return result;
}

async function runInvocation(
  step: PlannedInvocation,
  options: LifecycleRunOptions,
  timeoutMs: number,
  progressContext?: { stepIndex: number; stepCount: number }
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  packageManagerMissing?: boolean;
}> {
  switch (step.kind) {
    case "argv":
      return runArgv(step, options, timeoutMs, progressContext);
    case "official-script":
      return runOfficialScript(step, options, timeoutMs, progressContext);
    case "shell": {
      const isWin = platform() === "win32";
      if (isWin) {
        return runProcess(
          "powershell",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            step.command,
          ],
          {
            env: options.env,
            timeoutMs,
            signal: options.signal,
            onPercent: (percent) => {
              if (!progressContext) {
                return;
              }
              options.onProgress?.({
                stepIndex: progressContext.stepIndex,
                stepCount: progressContext.stepCount,
                label: "shell",
                percent,
              });
            },
          }
        );
      }
      return runProcess("sh", ["-lc", step.command], {
        env: options.env,
        timeoutMs,
        signal: options.signal,
        onPercent: (percent) => {
          if (!progressContext) {
            return;
          }
          options.onProgress?.({
            stepIndex: progressContext.stepIndex,
            stepCount: progressContext.stepCount,
            label: "shell",
            percent,
          });
        },
      });
    }
    case "wsl": {
      const parts = step.inner.map((inner) => {
        if (inner.kind === "argv") {
          const q = [inner.file, ...inner.args]
            .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
            .join(" ");
          return q;
        }
        if (inner.kind === "official-script") {
          return `tmp=$(mktemp) && curl -fsSL ${inner.url} -o "$tmp" && bash "$tmp"; rm -f "$tmp"`;
        }
        if (inner.kind === "shell") {
          return inner.command;
        }
        return "false";
      });
      const script = parts.join(" || ");
      return runProcess(
        "wsl.exe",
        ["-d", step.distro, "--", "sh", "-lc", script],
        {
          env: options.env,
          timeoutMs,
          signal: options.signal,
        }
      );
    }
    default:
      return {
        code: 1,
        stdout: "",
        stderr: "unknown step",
        cancelled: false,
        timedOut: false,
      };
  }
}

function cleanStderr(raw: string): string {
  return sanitizeProcessOutput(raw);
}

/**
 * Exit 0 but no real success — keep trying fallbacks.
 * Cursor Agent: "Update failed: [unauthenticated] Error"
 */
function isSoftSuccessFailure(output: string): boolean {
  const s = output.toLowerCase();
  return (
    s.includes("update failed") ||
    s.includes("[unauthenticated]") ||
    s.includes("authentication required") ||
    s.includes("not authenticated") ||
    s.includes("error: update failed")
  );
}

export function createNodeLifecycleRunner(): LifecycleRunner {
  return {
    async run(
      plan: PlannedPlan,
      options: LifecycleRunOptions
    ): Promise<LifecycleRunResult> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let last: LifecycleRunResult = {
        ok: false,
        code: 1,
        stepIndex: 0,
        stdout: "",
        stderr: "no steps",
      };
      /** Only report packageManagerMissing when every failed step was a missing PM. */
      let allFailuresWerePmMissing = true;
      const missingManagers: string[] = [];
      const failureNotes: string[] = [];
      const stepCount = plan.steps.length;

      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        if (!step) {
          continue;
        }
        if (options.signal?.aborted) {
          return {
            ok: false,
            code: null,
            stepIndex: i,
            stdout: "",
            stderr: "cancelled",
            cancelled: true,
          };
        }

        const label = stepFailureLabel(step);
        options.onProgress?.({
          stepIndex: i,
          stepCount,
          label,
        });

        const result = await runInvocation(step, options, timeoutMs, {
          stepIndex: i,
          stepCount,
        });

        if (result.cancelled) {
          return {
            ok: false,
            code: result.code,
            stepIndex: i,
            stdout: result.stdout,
            stderr: cleanStderr(result.stderr) || "cancelled",
            cancelled: true,
            timedOut: result.timedOut,
          };
        }
        if (result.code === 0) {
          // Self-upgrade CLIs (cursor-agent update) may exit 0 while printing a
          // hard error — fall through only for non-package-manager argv steps.
          const combined = `${result.stdout}\n${result.stderr}`;
          const isSelfArgv =
            step.kind === "argv" && !PACKAGE_MANAGER_BINS.has(step.file);
          if (isSelfArgv && isSoftSuccessFailure(combined)) {
            allFailuresWerePmMissing = false;
            failureNotes.push(
              `${label}: ${cleanStderr(result.stderr) || "reported failure with exit 0"}`
            );
            last = {
              ok: false,
              code: 1,
              stepIndex: i,
              stdout: result.stdout,
              stderr: cleanStderr(result.stderr),
              timedOut: result.timedOut,
            };
            continue;
          }
          options.onProgress?.({
            stepIndex: i,
            stepCount,
            label,
            percent: 100,
          });
          return {
            ok: true,
            code: 0,
            stepIndex: i,
            stdout: result.stdout,
            stderr: cleanStderr(result.stderr),
            timedOut: result.timedOut,
          };
        }

        if (result.packageManagerMissing) {
          if (step.kind === "argv" && !missingManagers.includes(step.file)) {
            missingManagers.push(step.file);
          }
          failureNotes.push(`${label}: not found`);
        } else {
          allFailuresWerePmMissing = false;
          const note = cleanStderr(result.stderr) || `exit ${result.code ?? 1}`;
          failureNotes.push(`${label}: ${note}`);
        }

        last = {
          ok: false,
          code: result.code,
          stepIndex: i,
          stdout: result.stdout,
          stderr: cleanStderr(result.stderr),
          timedOut: result.timedOut,
        };
        // try next fallback step
      }

      if (allFailuresWerePmMissing && missingManagers.length > 0) {
        return {
          ...last,
          packageManagerMissing: true,
          stderr: `Missing: ${missingManagers.join(", ")}`,
        };
      }

      if (failureNotes.length > 1) {
        return {
          ...last,
          stderr: sanitizeProcessOutput(failureNotes.join(" · "), {
            maxLines: 6,
            maxChars: 720,
          }),
        };
      }
      return last;
    },
  };
}
