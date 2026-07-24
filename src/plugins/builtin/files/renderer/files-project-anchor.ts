import type { PanelContext } from "@shared/contracts/panel.ts";

function nonEmpty(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export function projectAnchor(
  context: PanelContext | undefined
): string | null {
  if (!context) {
    return null;
  }
  return (
    nonEmpty(context.projectRootPath) ??
    nonEmpty(context.worktreeRoot) ??
    nonEmpty(context.gitRoot) ??
    nonEmpty(context.cwd)
  );
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "") || value;
}

export function formatProjectPath(
  path: string,
  homeDirectory: string | null = null
): string {
  const normalized = stripTrailingSeparators(path);
  const home = homeDirectory ? stripTrailingSeparators(homeDirectory) : null;
  if (!(home && home !== "/" && home !== "\\")) {
    return normalized;
  }
  if (normalized === home) {
    return "~";
  }
  if (normalized.startsWith(`${home}/`)) {
    return `~/${normalized.slice(home.length + 1)}`;
  }
  if (normalized.startsWith(`${home}\\`)) {
    return `~/${normalized.slice(home.length + 1).replace(/\\/g, "/")}`;
  }
  return normalized;
}

/** 状态栏短标签：只显示末段；全路径留给 tooltip。 */
export function formatProjectStatusLabel(path: string): string {
  const normalized = stripTrailingSeparators(path);
  if (normalized === "/" || normalized === "\\") {
    return normalized;
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}
