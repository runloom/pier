import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { FileServiceError } from "../services/file-service.ts";
import { GitExecError } from "../services/git-exec.ts";
import {
  isLocalEnvironmentScriptError,
  LocalEnvironmentScriptError,
} from "../services/local-environment-scripts.ts";
import { LocalEnvironmentServiceError } from "../services/local-environments-service.ts";
import { PluginServiceError } from "../services/plugin-service.ts";
import { PluginSettingsServiceError } from "../services/plugin-settings-service.ts";
import { WorktreeServiceError } from "../services/worktree-service.ts";
import { commandFailure as failure } from "./command-results.ts";

export function mapCommandError(
  requestId: string,
  err: unknown
): PierCommandResult {
  if (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    return failure(requestId, "not_found", err.message);
  }
  if (err instanceof WorktreeServiceError) {
    return failure(requestId, err.reason, err.message);
  }
  if (err instanceof LocalEnvironmentServiceError) {
    return failure(requestId, "not_found", `${err.reason}: ${err.message}`);
  }
  if (
    err instanceof LocalEnvironmentScriptError ||
    isLocalEnvironmentScriptError(err)
  ) {
    return failure(requestId, "environment_script_failed", err.message);
  }
  if (err instanceof FileServiceError) {
    return failure(requestId, "invalid_command", err.message);
  }
  if (err instanceof PluginServiceError) {
    const code = err.code === "invalid_manifest" ? "invalid_command" : err.code;
    return failure(requestId, code, err.message);
  }
  if (err instanceof PluginSettingsServiceError) {
    return failure(requestId, err.code, err.message);
  }
  if (err instanceof GitExecError) {
    const rawSummary = err.stderr.trim() || err.stdout.trim();
    const summary = rawSummary.split("\n").slice(0, 3).join(" | ");
    const detail = summary.length > 0 ? ` -- ${summary}` : "";
    // hook 被外部信号杀 → 换成专用 code，让 UI 走"重试建议"提示。
    // 详见 PierCommandErrorCode.git_hook_signal_killed 注释。
    if (err.hookSignal) {
      return failure(
        requestId,
        "git_hook_signal_killed",
        `git hook ${err.hookSignal.hookPath} died of signal ${err.hookSignal.signal}${detail}`
      );
    }
    return failure(requestId, "git_error", `${err.message}${detail}`);
  }
  return failure(
    requestId,
    "internal_error",
    err instanceof Error ? err.message : String(err)
  );
}
