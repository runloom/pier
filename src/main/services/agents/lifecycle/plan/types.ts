/**
 * Typed install/update plan. Runner is the only place that spawns processes.
 * `preview` is always UI-safe (basename for argv files). Execution uses `steps`.
 */

import { basename } from "node:path";

export type PlannedInvocation =
  | {
      kind: "argv";
      file: string;
      args: readonly string[];
    }
  | {
      kind: "official-script";
      platform: "posix" | "win";
      url: string;
    }
  | {
      /** User- or default-authored shell one-liner (sh -lc / powershell). */
      kind: "shell";
      command: string;
    }
  | {
      kind: "wsl";
      distro: string;
      /** Inner plan steps run inside the distro (posix). */
      inner: readonly PlannedInvocation[];
    };

export interface PlannedPlan {
  /**
   * UI / default-command one-liner (no absolute bin paths).
   * Derived from steps — never a second hand-authored command source.
   */
  readonly preview: string;
  /** Ordered fallbacks: stop at first successful step (logical ||). */
  readonly steps: readonly PlannedInvocation[];
}

/** UI: bare command name, not /Users/…/.nvm/…/bin/cli. */
function displayArgvFile(file: string): string {
  if (!(file.includes("/") || file.includes("\\"))) {
    return file;
  }
  const base = basename(file);
  return base.length > 0 ? base : file;
}

export function previewInvocation(step: PlannedInvocation): string {
  switch (step.kind) {
    case "argv":
      return [displayArgvFile(step.file), ...step.args].join(" ");
    case "official-script":
      return step.platform === "win"
        ? `irm '${step.url}' | iex`
        : `curl -fsSL ${step.url} | sh`;
    case "shell":
      return step.command;
    case "wsl":
      return `wsl -d ${step.distro} -- ${step.inner.map(previewInvocation).join(" || ")}`;
    default:
      return "";
  }
}

export function previewPlan(steps: readonly PlannedInvocation[]): string {
  return steps.map(previewInvocation).filter(Boolean).join(" || ");
}
