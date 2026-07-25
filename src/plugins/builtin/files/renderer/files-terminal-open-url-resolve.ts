import type { PanelContext } from "@shared/contracts/panel.ts";

export type ParsedTerminalOpenUrl =
  | { kind: "remote"; url: string }
  | { kind: "local-path"; path: string }
  | {
      kind: "unresolved";
      reason: "relative-without-cwd" | "unsupported-scheme" | "invalid";
    };

export type ResolvedTerminalLocalTargets =
  | { kind: "remote"; url: string }
  | {
      kind: "unresolved";
      reason: "relative-without-cwd" | "unsupported-scheme" | "invalid";
    }
  | { kind: "local-paths"; paths: string[] };

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveAgainstAbsoluteCwd(cwd: string, relative: string): string {
  const cwdNorm = cwd.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const segments = relative.replace(/\\/g, "/").split("/");
  const stack = cwdNorm === "/" ? [""] : cwdNorm.split("/");
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 1 && stack[0] === "") {
    return "/";
  }
  return stack.join("/");
}

function fileUrlToPath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "file:") {
      return null;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname.length > 0 ? pathname : null;
  } catch {
    return null;
  }
}

function schemeOf(raw: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*:)/i.exec(raw);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Strip common agent / prose wrappers so selection and OSC text can open.
 * Examples: `docs/a.md`, "docs/a.md", docs/a.md:12:3, (docs/a.md)
 */
export function normalizeTerminalPathText(rawInput: string): string {
  let raw = rawInput.trim();
  if (!raw) {
    return "";
  }

  // Prefer the first non-empty line when the selection spans multiple lines.
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  raw = firstLine ?? "";

  // Unwrap matching quotes / backticks a few times (nested rare but cheap).
  for (let i = 0; i < 3; i += 1) {
    const unwrapped =
      /^`([^`]+)`$/.exec(raw)?.[1] ??
      /^"([^"]+)"$/.exec(raw)?.[1] ??
      /^'([^']+)'$/.exec(raw)?.[1] ??
      /^\(([^)]+)\)$/.exec(raw)?.[1];
    if (!unwrapped) {
      break;
    }
    raw = unwrapped.trim();
  }

  // Agent outputs often append :line or :line:col after a path.
  raw = raw.replace(/:\d+(?::\d+)?$/, "");

  // Trailing prose punctuation that Ghostty / users may include.
  raw = raw.replace(/[.,;:!?]+$/u, "");

  return raw.trim();
}

/**
 * Ordered unique absolute roots for resolving agent-relative paths.
 * Prefer the live terminal cwd, then worktree / project / git roots.
 */
export function listTerminalPathResolveRoots(
  context: PanelContext | null | undefined
): string[] {
  if (!context) {
    return [];
  }
  const ordered = [
    context.cwd,
    context.worktreeRoot,
    context.projectRootPath,
    context.gitRoot,
  ];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of ordered) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    if (!isAbsolutePath(value)) {
      continue;
    }
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

/**
 * Resolve open targets for a terminal path / URL.
 * Relative paths produce multiple absolute candidates (cwd first, then roots).
 */
export function resolveTerminalLocalPathTargets(
  rawInput: string,
  context: PanelContext | null | undefined
): ResolvedTerminalLocalTargets {
  const raw = normalizeTerminalPathText(rawInput);
  if (!raw) {
    return { kind: "unresolved", reason: "invalid" };
  }

  const scheme = schemeOf(raw);
  if (scheme) {
    if (EXTERNAL_SCHEMES.has(scheme)) {
      return { kind: "remote", url: raw };
    }
    if (scheme === "file:") {
      const path = fileUrlToPath(raw);
      if (!path) {
        return { kind: "unresolved", reason: "invalid" };
      }
      return { kind: "local-paths", paths: [path] };
    }
    return { kind: "unresolved", reason: "unsupported-scheme" };
  }

  if (isAbsolutePath(raw)) {
    return { kind: "local-paths", paths: [raw] };
  }

  const roots = listTerminalPathResolveRoots(context);
  if (roots.length === 0) {
    return { kind: "unresolved", reason: "relative-without-cwd" };
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const absolute = resolveAgainstAbsoluteCwd(root, raw);
    if (seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    paths.push(absolute);
  }
  return { kind: "local-paths", paths };
}

/** Single-root parse used by unit tests and simple callers. */
export function parseTerminalOpenUrl(
  rawInput: string,
  cwd: string | null
): ParsedTerminalOpenUrl {
  const raw = normalizeTerminalPathText(rawInput);
  if (!raw) {
    return { kind: "unresolved", reason: "invalid" };
  }
  const scheme = schemeOf(raw);
  if (scheme) {
    if (EXTERNAL_SCHEMES.has(scheme)) {
      return { kind: "remote", url: raw };
    }
    if (scheme === "file:") {
      const path = fileUrlToPath(raw);
      if (!path) {
        return { kind: "unresolved", reason: "invalid" };
      }
      return { kind: "local-path", path };
    }
    return { kind: "unresolved", reason: "unsupported-scheme" };
  }
  if (isAbsolutePath(raw)) {
    return { kind: "local-path", path: raw };
  }
  if (!(cwd && isAbsolutePath(cwd))) {
    return { kind: "unresolved", reason: "relative-without-cwd" };
  }
  return {
    kind: "local-path",
    path: resolveAgainstAbsoluteCwd(cwd, raw),
  };
}
