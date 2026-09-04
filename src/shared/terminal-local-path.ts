import type { PanelContext } from "@shared/contracts/panel.ts";

/** Sentinel panel id for OS `pier://file` deep links (no live terminal). */
export const PIER_FILE_PROTOCOL_PANEL_ID = "pier-file-protocol";

export interface TerminalPathLocation {
  column?: number;
  line?: number;
  path: string;
}

export type ParsedTerminalOpenUrl =
  | { kind: "remote"; url: string }
  | ({ kind: "local-path" } & TerminalPathLocation)
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
  | ({ kind: "local-paths"; paths: string[] } & Pick<
      TerminalPathLocation,
      "column" | "line"
    >);

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function homeDirectory(): string | null {
  const home =
    typeof process === "undefined"
      ? null
      : (process.env.HOME ?? process.env.USERPROFILE ?? null);
  if (!home) {
    return null;
  }
  const normalized = home.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return isAbsolutePath(normalized) ? normalized : null;
}

function expandHomePrefix(path: string): string {
  if (path === "~") {
    return homeDirectory() ?? path;
  }
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    const home = homeDirectory();
    if (!home) {
      return path;
    }
    return `${home}/${path.slice(2).replace(/\\/g, "/")}`;
  }
  return path;
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

const PIER_FILE_HASH = /^L(\d+)(?:C(\d+))?$/i;

/**
 * `pier://file/<absolute-path>{#Lline}` / `{#LlineCcol}` (1-based).
 * Hostname must be `file`. Returns null when the URL is not this scheme.
 */
export function parsePierFileUrl(
  rawInput: string
): TerminalPathLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(rawInput.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "pier:" || parsed.hostname !== "file") {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (!path.startsWith("/")) {
    return null;
  }
  if (/^\/[A-Za-z]:\//.test(path)) {
    path = path.slice(1);
  }
  const location: TerminalPathLocation = { path };
  const hash = parsed.hash.replace(/^#/, "");
  if (!hash) {
    return location;
  }
  const match = PIER_FILE_HASH.exec(hash);
  if (!match) {
    return location;
  }
  const line = Number(match[1]);
  if (!Number.isInteger(line) || line < 1) {
    return location;
  }
  location.line = line;
  if (match[2]) {
    const column = Number(match[2]);
    if (Number.isInteger(column) && column >= 1) {
      location.column = column;
    }
  }
  return location;
}

/**
 * Pull trailing :line or :line:col off a path-like string.
 * Column is 1-based when present (editor/terminal convention).
 */
function splitTrailingLocation(raw: string): TerminalPathLocation {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(raw);
  if (!match) {
    return { path: raw };
  }
  const path = match[1] ?? raw;
  const lineText = match[2];
  const columnText = match[3];
  if (!(path && lineText)) {
    return { path: raw };
  }
  // Avoid treating Windows drive roots like C: as a line suffix.
  if (/^[A-Za-z]$/.test(path) && isAbsolutePath(`${path}:`)) {
    return { path: raw };
  }
  const line = Number(lineText);
  if (!Number.isInteger(line) || line < 1) {
    return { path: raw };
  }
  const location: TerminalPathLocation = { line, path };
  if (columnText) {
    const column = Number(columnText);
    if (Number.isInteger(column) && column >= 1) {
      location.column = column;
    }
  }
  return location;
}

/**
 * Strip common agent / prose wrappers and optional :line[:col] suffix.
 * Examples: `docs/a.md`, "docs/a.md", docs/a.md:12:3, (docs/a.md)
 */
export function parseTerminalPathLocation(
  rawInput: string
): TerminalPathLocation {
  let raw = rawInput.trim();
  if (!raw) {
    return { path: "" };
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

  // Trailing prose punctuation that Ghostty / users may include — but only
  // after we try to read :line[:col], so "docs/a.md:12." still yields line 12.
  const trailingPunct = /[.,;!?]+$/u.exec(raw)?.[0];
  if (trailingPunct) {
    raw = raw.slice(0, -trailingPunct.length);
  }

  const location = splitTrailingLocation(raw);
  // Drop a leftover trailing colon from prose (path only).
  location.path = location.path.replace(/:+$/u, "").trim();
  return location;
}

/**
 * Strip wrappers and optional :line[:col]; return the filesystem/path text only.
 */
export function normalizeTerminalPathText(rawInput: string): string {
  return parseTerminalPathLocation(rawInput).path;
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

function withLocationFields(
  location: TerminalPathLocation
): Pick<TerminalPathLocation, "column" | "line"> {
  return {
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.column === undefined ? {} : { column: location.column }),
  };
}

/**
 * Resolve open targets for a terminal path / URL.
 * Relative paths produce multiple absolute candidates (cwd first, then roots).
 * Optional :line[:col] is preserved for editor reveal after open.
 */
export function resolveTerminalLocalPathTargets(
  rawInput: string,
  context: PanelContext | null | undefined
): ResolvedTerminalLocalTargets {
  const location = parseTerminalPathLocation(rawInput);
  const raw = location.path;
  if (!raw) {
    return { kind: "unresolved", reason: "invalid" };
  }
  const loc = withLocationFields(location);

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
      return { kind: "local-paths", paths: [path], ...loc };
    }
    if (scheme === "pier:") {
      const pier = parsePierFileUrl(raw);
      if (!pier) {
        return { kind: "unresolved", reason: "invalid" };
      }
      return {
        kind: "local-paths",
        paths: [pier.path],
        ...withLocationFields(pier),
      };
    }
    return { kind: "unresolved", reason: "unsupported-scheme" };
  }

  const expanded = expandHomePrefix(raw);
  if (isAbsolutePath(expanded)) {
    return { kind: "local-paths", paths: [expanded], ...loc };
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
  return { kind: "local-paths", paths, ...loc };
}

/** Single-root parse used by unit tests and simple callers. */
export function parseTerminalOpenUrl(
  rawInput: string,
  cwd: string | null
): ParsedTerminalOpenUrl {
  const location = parseTerminalPathLocation(rawInput);
  const raw = location.path;
  if (!raw) {
    return { kind: "unresolved", reason: "invalid" };
  }
  const loc = withLocationFields(location);
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
      return { kind: "local-path", path, ...loc };
    }
    if (scheme === "pier:") {
      const pier = parsePierFileUrl(raw);
      if (!pier) {
        return { kind: "unresolved", reason: "invalid" };
      }
      return {
        kind: "local-path",
        path: pier.path,
        ...withLocationFields(pier),
      };
    }
    return { kind: "unresolved", reason: "unsupported-scheme" };
  }
  const expanded = expandHomePrefix(raw);
  if (isAbsolutePath(expanded)) {
    return { kind: "local-path", path: expanded, ...loc };
  }
  if (!(cwd && isAbsolutePath(cwd))) {
    return { kind: "unresolved", reason: "relative-without-cwd" };
  }
  return {
    kind: "local-path",
    path: resolveAgainstAbsoluteCwd(cwd, raw),
    ...loc,
  };
}
