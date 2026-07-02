import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { pluginText } from "./git-plugin-text.ts";

export interface ActiveGitTarget {
  branch: null | string;
  cwd: string;
  gitRoot: string;
  label: string;
}

export type GitTargetResult =
  | { enabled: true; target: ActiveGitTarget }
  | { enabled: false; reason: string };

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: string): string {
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

function labelForContext(context: PanelContext, gitRoot: string): string {
  return (
    context.branch ??
    (context.worktreeRoot ? basename(context.worktreeRoot) : null) ??
    basename(gitRoot)
  );
}

export function unsupportedGitReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "gitUnsupported",
    "Current directory is not a Git repository"
  );
}

export function activeGitTarget(
  context: RendererPluginContext
): GitTargetResult {
  const panelContext = context.panels.getActiveContext();
  const gitRoot = panelContext?.gitRoot ?? null;
  if (!(panelContext && gitRoot)) {
    return {
      enabled: false,
      reason: unsupportedGitReason(context),
    };
  }
  return {
    enabled: true,
    target: {
      branch: panelContext.branch ?? null,
      cwd: gitRoot,
      gitRoot,
      label: labelForContext(panelContext, gitRoot),
    },
  };
}
