import {
  TASK_EXIT_TITLE_PREFIX,
  type TaskPresentation,
} from "@shared/contracts/tasks.ts";
import { shellQuote } from "./utils.ts";

export type TaskPresentationShellFamily =
  | "zsh"
  | "bash"
  | "fish"
  | "nu"
  | "posix";

/**
 * Inner script typed into a live login shell (or passed to `$SHELL -c`).
 * POSIX families disable errexit so a failing command still writes the OSC
 * trailer. Fish/nu do not have bash `set +e` (fish `set -e` erases vars).
 */
export function buildTaskPresentationScript(input: {
  command: string;
  family: TaskPresentationShellFamily;
  presentation: TaskPresentation;
}): string {
  if (input.family === "fish") {
    return joinFishPresentation(input.command, input.presentation);
  }
  if (input.family === "nu") {
    return joinNuPresentation(input.command, input.presentation);
  }
  return joinPosixPresentation(input.command, input.presentation);
}

function joinPosixPresentation(
  command: string,
  presentation: TaskPresentation
): string {
  const parts: string[] = ["set +e"];
  if (presentation.clear) {
    parts.push("clear");
  }
  if (presentation.showCommand) {
    parts.push(`printf '%s\\n' ${shellQuote(`+ ${command}`)}`);
  }
  parts.push(command);
  parts.push("code=$?");
  parts.push(`printf '\\033]0;${TASK_EXIT_TITLE_PREFIX}%s\\007' "$code"`);
  if (presentation.showSummary) {
    parts.push("printf '\\n[pier] task exited with %s\\n' \"$code\"");
  }
  parts.push('exit "$code"');
  return parts.join("; ");
}

function joinFishPresentation(
  command: string,
  presentation: TaskPresentation
): string {
  const parts: string[] = [];
  if (presentation.clear) {
    parts.push("clear");
  }
  if (presentation.showCommand) {
    parts.push(`printf '%s\\n' ${shellQuote(`+ ${command}`)}`);
  }
  parts.push(command);
  parts.push("set code $status");
  parts.push(`printf '\\033]0;${TASK_EXIT_TITLE_PREFIX}%s\\007' $code`);
  if (presentation.showSummary) {
    parts.push("printf '\\n[pier] task exited with %s\\n' $code");
  }
  parts.push("exit $code");
  return parts.join("; ");
}

function joinNuPresentation(
  command: string,
  presentation: TaskPresentation
): string {
  const parts: string[] = [];
  if (presentation.clear) {
    parts.push("clear");
  }
  if (presentation.showCommand) {
    parts.push(`print ${JSON.stringify(`+ ${command}`)}`);
  }
  parts.push(command);
  parts.push("let code = $env.LAST_EXIT_CODE");
  parts.push(`print -n $"\\e]0;${TASK_EXIT_TITLE_PREFIX}($code)\\u{07}"`);
  if (presentation.showSummary) {
    parts.push('print $"\\n[pier] task exited with ($code)"');
  }
  parts.push("exit $code");
  return parts.join("; ");
}
