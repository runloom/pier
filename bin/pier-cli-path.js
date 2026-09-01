import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/** First-token command words (case-sensitive). `files` / `git` are not reserved. */
const ABSOLUTE_WIN_PATH = /^[A-Za-z]:[\\/]/;
const DRIVE_LETTER = /^[A-Za-z]$/;
const LINE_COLUMN_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;

export const PIER_CLI_RESERVED_COMMANDS = new Set([
  "status",
  "snapshot",
  "watch",
  "open",
  "terminal",
  "windows",
  "panels",
  "worktrees",
  "tasks",
  "plugins",
  "preferences",
  "agents",
  "notifications",
]);

function isAbsolutePathToken(path) {
  return path.startsWith("/") || ABSOLUTE_WIN_PATH.test(path);
}

function resolveAgainstCwd(path, cwd) {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/**
 * Argv-only `:line[:col]` strip. 1-based. Same C: guard as
 * `parseTerminalPathLocation`, without quote/prose unwrapping.
 *
 * Edge whitespace matches editor CLIs, not POSIX argv-as-opaque:
 * VS Code `preparePath` strips U+0020 then U+0009; Zed
 * `PathWithPosition::parse_str` uses `str::trim` (Unicode White_Space).
 * JS `String#trim` is the Zed set (includes VS Code's).
 */
export function parsePathLocationToken(raw) {
  const token = raw.trim();
  if (!token) {
    return { path: "" };
  }
  const match = LINE_COLUMN_SUFFIX.exec(token);
  if (!match) {
    return { path: token };
  }
  const path = match[1] ?? token;
  const lineText = match[2];
  const columnText = match[3];
  if (!(path && lineText)) {
    return { path: token };
  }
  if (DRIVE_LETTER.test(path) && isAbsolutePathToken(`${path}:`)) {
    return { path: token };
  }
  const line = Number(lineText);
  if (!Number.isInteger(line) || line < 1) {
    return { path: token };
  }
  const location = { line, path };
  if (columnText) {
    const column = Number(columnText);
    if (Number.isInteger(column) && column >= 1) {
      location.column = column;
    }
  }
  return location;
}

export function expandHome(path) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return `${homedir()}${path.slice(1)}`;
  }
  return path;
}

export function looksLikePathToken(token, cwd) {
  if (existsSync(resolveAgainstCwd(token, cwd))) {
    return true;
  }
  const { path } = parsePathLocationToken(token);
  if (!path) {
    return false;
  }
  if (path === "." || path === "..") {
    return true;
  }
  if (
    path.startsWith("./") ||
    path.startsWith("../") ||
    path.startsWith("/") ||
    path.startsWith("~/")
  ) {
    return true;
  }
  if (path.includes("/")) {
    return true;
  }
  const leaf = path.split("/").pop() ?? path;
  if (leaf.includes(".") && !PIER_CLI_RESERVED_COMMANDS.has(path)) {
    return true;
  }
  return existsSync(resolveAgainstCwd(path, cwd));
}

function nestedOrigin(hasExplicitWindow) {
  if (hasExplicitWindow) {
    return {};
  }
  const panelId = process.env.PIER_PANEL_ID;
  const windowId = process.env.PIER_WINDOW_ID;
  if (panelId && windowId) {
    return { referencePanelId: panelId, windowId };
  }
  return {};
}

export function parsePathOpenArgs({ cwd, hasExplicitWindow, route, tokens }) {
  if (!tokens || tokens.length === 0) {
    throw new Error("missing required pier CLI argument");
  }
  const paths = [];
  for (const token of tokens) {
    // Zed `parse_path_with_position`: canonicalize the raw token if it
    // exists, else trim + `:line[:col]`. VS Code always `preparePath`.
    const rawAbsolute = resolveAgainstCwd(token, cwd);
    if (existsSync(rawAbsolute)) {
      paths.push({ path: rawAbsolute });
      continue;
    }
    const location = parsePathLocationToken(token);
    if (!location.path) {
      throw new Error("missing required pier CLI argument");
    }
    const entry = { path: resolveAgainstCwd(location.path, cwd) };
    if (location.line !== undefined) {
      entry.line = location.line;
    }
    if (location.column !== undefined) {
      entry.column = location.column;
    }
    paths.push(entry);
  }
  const first = paths[0];
  return {
    path: first.path,
    paths,
    type: "panel.open",
    ...route,
    ...nestedOrigin(hasExplicitWindow),
  };
}

export function parseNestedBareCommand({ hasExplicitWindow, route }) {
  const panelId = process.env.PIER_PANEL_ID;
  const originWindowId = process.env.PIER_WINDOW_ID;
  if (!(panelId && originWindowId)) {
    return null;
  }
  if (hasExplicitWindow) {
    return {
      type: "window.focus",
      windowId: route.windowId,
    };
  }
  return {
    panelId,
    type: "panel.focus",
    windowId: originWindowId,
    ...(route.focus === undefined ? {} : { focus: route.focus }),
  };
}
