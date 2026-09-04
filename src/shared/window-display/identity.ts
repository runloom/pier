import type { PanelSnapshot } from "../contracts/panel.ts";

export function pathBasename(path: string): string {
  if (path === "" || path === "/" || path === "\\") {
    return path === "" ? "" : path;
  }
  const normalized = path.replaceAll("\\", "/");
  const trimmed = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function pathParentBasename(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const trimmed = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) {
    return null;
  }
  return pathBasename(trimmed.slice(0, idx)) || null;
}

export function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIdentity(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replaceAll("/", "-")
    .replaceAll(/-+/g, "-")
    .toLowerCase();
}

/**
 * True when `candidate` can sit in the right column without echoing `identity`.
 * Slash vs dash (`feat/foo` vs `feat-foo`) counts as the same visual identity.
 */
export function isDistinctQualifier(
  candidate: string,
  identity: string
): boolean {
  const trimmed = candidate.trim();
  const leaf = identity.trim();
  if (trimmed.length === 0 || leaf.length === 0) {
    return trimmed.length > 0;
  }
  return normalizeIdentity(trimmed) !== normalizeIdentity(leaf);
}

export function identityPathOf(
  panel: PanelSnapshot | null
): string | undefined {
  if (!panel?.context) {
    return;
  }
  return (
    nonEmpty(panel.context.worktreeRoot) ??
    nonEmpty(panel.context.projectRootPath) ??
    nonEmpty(panel.context.cwd)
  );
}

export function branchOf(panel: PanelSnapshot | null): string | undefined {
  return nonEmpty(panel?.context?.branch);
}

export function hasGitAnchor(panel: PanelSnapshot): boolean {
  return Boolean(
    nonEmpty(panel.context?.gitRoot) || nonEmpty(panel.context?.worktreeRoot)
  );
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

/** Files plugin tab icons (`fileTabIconId`); includes untitled documents. */
const FILE_TAB_ICON_PREFIX = "pier.file:";

function shortTitleQualifier(
  title: string,
  identity: string
): string | undefined {
  const candidate = isPathLike(title) ? pathBasename(title) : title.trim();
  if (candidate.length === 0 || !isDistinctQualifier(candidate, identity)) {
    return;
  }
  return candidate;
}

/**
 * Files plugin registers as dockview `kind: "web"`. Treat a tab as a file when
 * `display.long` is a filesystem path whose basename matches `display.short`.
 * Product titles (Welcome, Search, review chrome) do not look like that.
 */
function fileTabShort(panel: PanelSnapshot): string | undefined {
  const short = nonEmpty(panel.display?.short);
  if (!short) {
    return;
  }
  if (panel.kind === "file" || panel.kind === "diff") {
    return short;
  }
  if (panel.tab?.icon?.id?.startsWith(FILE_TAB_ICON_PREFIX)) {
    return short;
  }
  const long = nonEmpty(panel.display?.long);
  if (!(long && isPathLike(long))) {
    return;
  }
  if (pathBasename(long) !== pathBasename(short)) {
    return;
  }
  return short;
}

/** File/diff basename or user-pinned tab title. Never OSC / cwd / task chrome. */
export function stableTabQualifierFromPanel(
  panel: PanelSnapshot | null,
  identityLeaf: string
): string | undefined {
  if (!panel) {
    return;
  }
  if (panel.tab?.titleSource === "user") {
    const pinned = nonEmpty(panel.tab.title);
    if (pinned) {
      return shortTitleQualifier(pinned, identityLeaf);
    }
  }
  if (
    panel.kind === "terminal" ||
    panel.kind === "agent" ||
    nonEmpty(panel.display?.terminalTitle)
  ) {
    return;
  }
  const short = fileTabShort(panel);
  if (short) {
    return shortTitleQualifier(short, identityLeaf);
  }
  return;
}
