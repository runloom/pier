import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionPaneBinding {
  panelId: string;
  splitAxis?: "horizontal" | "vertical";
  windowId: string;
}

export interface SessionMap {
  createdAt: number;
  leaderPaneId: string;
  nextIndex: number;
  panes: Record<string, SessionPaneBinding>;
  sessionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSessionToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "default";
  }
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function sessionIdFromWindowId(windowId: string): string {
  return sanitizeSessionToken(windowId);
}

export function sessionIdForLeader(windowId: string, panelId: string): string {
  return `${sanitizeSessionToken(windowId)}__${sanitizeSessionToken(panelId)}`;
}

export function sessionsDir(workDir: string): string {
  return join(workDir, "sessions");
}

export function sessionFilePath(workDir: string, sessionId: string): string {
  return join(sessionsDir(workDir), `${sessionId}.json`);
}

export function tmuxValueForSession(
  workDir: string,
  sessionId: string,
  pid: number
): string {
  return `${join(sessionsDir(workDir), `${sessionId}.sock`)},${pid},0`;
}

export function parseTmuxValue(tmux: string): {
  sessionId: string;
  sockPath: string;
  workDir: string;
} | null {
  const sockPath = tmux.split(",")[0];
  if (!sockPath?.endsWith(".sock")) {
    return null;
  }
  const sessionId = basename(sockPath, ".sock");
  const dir = dirname(sockPath);
  if (basename(dir) !== "sessions") {
    return null;
  }
  return {
    sessionId,
    sockPath,
    workDir: dirname(dir),
  };
}

function parseBinding(value: unknown): SessionPaneBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.panelId !== "string" || typeof value.windowId !== "string") {
    return null;
  }
  const splitAxis =
    value.splitAxis === "horizontal" || value.splitAxis === "vertical"
      ? value.splitAxis
      : undefined;
  return {
    panelId: value.panelId,
    windowId: value.windowId,
    ...(splitAxis ? { splitAxis } : {}),
  };
}

export function parseSessionMap(value: unknown): SessionMap | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.sessionId !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.nextIndex !== "number" ||
    typeof value.leaderPaneId !== "string" ||
    !isRecord(value.panes)
  ) {
    return null;
  }
  const panes: Record<string, SessionPaneBinding> = {};
  for (const [paneId, binding] of Object.entries(value.panes)) {
    const parsed = parseBinding(binding);
    if (!parsed) {
      return null;
    }
    panes[paneId] = parsed;
  }
  return {
    createdAt: value.createdAt,
    leaderPaneId: value.leaderPaneId,
    nextIndex: value.nextIndex,
    panes,
    sessionId: value.sessionId,
  };
}

export function loadSessionMap(
  workDir: string,
  sessionId: string
): SessionMap | null {
  const path = sessionFilePath(workDir, sessionId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseSessionMap(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function sessionFileExpired(
  workDir: string,
  sessionId: string,
  now = Date.now()
): boolean {
  const path = sessionFilePath(workDir, sessionId);
  if (!existsSync(path)) {
    return true;
  }
  if (now - statSync(path).mtimeMs > SESSION_TTL_MS) {
    return true;
  }
  const map = loadSessionMap(workDir, sessionId);
  if (!map) {
    return true;
  }
  return now - map.createdAt > SESSION_TTL_MS;
}

export function saveSessionMap(workDir: string, map: SessionMap): void {
  const dir = sessionsDir(workDir);
  mkdirSync(dir, { recursive: true });
  const path = sessionFilePath(workDir, map.sessionId);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(map)}\n`, "utf8");
  renameSync(tmp, path);
}

export function bindLeaderSession(input: {
  panelId: string;
  windowId: string;
  workDir: string;
}): { map: SessionMap; tmuxValue: string } {
  const sessionId = sessionIdForLeader(input.windowId, input.panelId);
  const map: SessionMap = {
    createdAt: Date.now(),
    leaderPaneId: "%0",
    nextIndex: 1,
    panes: {
      "%0": { panelId: input.panelId, windowId: input.windowId },
    },
    sessionId,
  };
  saveSessionMap(input.workDir, map);
  return {
    map,
    tmuxValue: tmuxValueForSession(input.workDir, sessionId, process.pid),
  };
}

export function allocatePane(
  map: SessionMap,
  binding: SessionPaneBinding
): { map: SessionMap; paneId: string } {
  const used = new Set(Object.keys(map.panes));
  let index = map.nextIndex;
  while (used.has(`%${index}`)) {
    index += 1;
  }
  const paneId = `%${index}`;
  return {
    map: {
      ...map,
      nextIndex: index + 1,
      panes: { ...map.panes, [paneId]: binding },
    },
    paneId,
  };
}

export function saveAllocatedPane(input: {
  binding: SessionPaneBinding;
  map: SessionMap;
  workDir: string;
}): { map: SessionMap; paneId: string } {
  let current = input.map;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const latest = loadSessionMap(input.workDir, current.sessionId) ?? current;
    const allocated = allocatePane(latest, input.binding);
    saveSessionMap(input.workDir, allocated.map);
    const written = loadSessionMap(input.workDir, allocated.map.sessionId);
    const pane = written?.panes[allocated.paneId];
    if (pane && pane.panelId === input.binding.panelId) {
      return { map: written, paneId: allocated.paneId };
    }
    if (written) {
      current = written;
    }
  }
  const fallback = allocatePane(
    loadSessionMap(input.workDir, input.map.sessionId) ?? input.map,
    input.binding
  );
  saveSessionMap(input.workDir, fallback.map);
  return fallback;
}

export function paneIdForPanel(
  map: SessionMap,
  panelId: string
): string | undefined {
  for (const [paneId, binding] of Object.entries(map.panes)) {
    if (binding.panelId === panelId) {
      return paneId;
    }
  }
}

export function removePane(map: SessionMap, paneId: string): SessionMap {
  const panes = { ...map.panes };
  delete panes[paneId];
  return { ...map, panes };
}
