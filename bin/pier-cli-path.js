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

/**
 * Argv-only `:line[:col]` strip. 1-based. Same C: guard as
 * `parseTerminalPathLocation`, without quote/prose unwrapping.
 */
export function parsePathLocationToken(raw) {
  const match = LINE_COLUMN_SUFFIX.exec(raw);
  if (!match) {
    return { path: raw };
  }
  const path = match[1] ?? raw;
  const lineText = match[2];
  const columnText = match[3];
  if (!(path && lineText)) {
    return { path: raw };
  }
  if (DRIVE_LETTER.test(path) && isAbsolutePathToken(`${path}:`)) {
    return { path: raw };
  }
  const line = Number(lineText);
  if (!Number.isInteger(line) || line < 1) {
    return { path: raw };
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
  const { path } = parsePathLocationToken(token);
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
  const expanded = expandHome(path);
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  return existsSync(absolute);
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
    const location = parsePathLocationToken(token);
    const expanded = expandHome(location.path);
    const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    const entry = { path: absolute };
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
