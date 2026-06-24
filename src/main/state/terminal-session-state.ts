/**
 * Terminal session state persistence.
 *
 * This is intentionally smaller than a full session restore system: it only
 * remembers the last cwd per stable Pier window id + terminal panel id, so a
 * relaunched app can create a fresh shell in the same directory.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { app } from "electron";
import lockfile, { type LockOptions } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";

const terminalPanelSessionSchema = z.object({
  cwd: z.string(),
  updatedAt: z.string(),
});

const terminalWindowSessionSchema = z.object({
  panels: z.record(z.string(), terminalPanelSessionSchema),
});

const terminalSessionStateSchema = z.object({
  version: z.literal(1),
  windows: z.record(z.string(), terminalWindowSessionSchema),
});

export type TerminalPanelSession = z.infer<typeof terminalPanelSessionSchema>;
type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;

const LOCK_OPTIONS: LockOptions = {
  retries: {
    factor: 1,
    maxTimeout: 100,
    minTimeout: 20,
    retries: 5,
  },
};

let stateMutationQueue: Promise<void> = Promise.resolve();

function createEmptyState(): TerminalSessionState {
  return {
    version: 1,
    windows: {},
  };
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "terminal-session-state.json");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readStateFromPath(path: string): Promise<TerminalSessionState> {
  if (!existsSync(path)) {
    return createEmptyState();
  }
  try {
    const raw = await readFile(path, "utf-8");
    return terminalSessionStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn(
      "[terminal-session-state] parse failed, using empty state:",
      err
    );
    return createEmptyState();
  }
}

function readState(): Promise<TerminalSessionState> {
  const path = resolveFilePath();
  return readStateFromPath(path);
}

async function ensureStateFile(path: string): Promise<void> {
  await ensureDir(path);
  if (!(await fileExists(path))) {
    await writeFileAtomic(
      path,
      `${JSON.stringify(createEmptyState(), null, 2)}\n`
    );
  }
}

async function mutateState(
  mutator: (state: TerminalSessionState) => boolean
): Promise<void> {
  const path = resolveFilePath();
  await ensureStateFile(path);
  const release = await lockfile.lock(path, LOCK_OPTIONS);
  try {
    const state = await readStateFromPath(path);
    if (mutator(state)) {
      await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
    }
  } finally {
    await release();
  }
}

function enqueueStateMutation(
  mutator: (state: TerminalSessionState) => boolean
): Promise<void> {
  const run = stateMutationQueue.then(
    () => mutateState(mutator),
    () => mutateState(mutator)
  );
  stateMutationQueue = run.catch(() => undefined);
  return run;
}

function isNonEmptyId(value: string): boolean {
  return value.trim().length > 0;
}

function isRestorableCwd(cwd: string): boolean {
  return cwd.trim() === cwd && cwd.length > 0 && isAbsolute(cwd);
}

export async function readTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<TerminalPanelSession | null> {
  if (!(isNonEmptyId(windowId) && isNonEmptyId(panelId))) {
    return null;
  }
  const state = await readState();
  return state.windows[windowId]?.panels[panelId] ?? null;
}

export async function updateTerminalPanelCwd(
  windowId: string,
  panelId: string,
  cwd: string
): Promise<void> {
  if (!(isNonEmptyId(windowId) && isNonEmptyId(panelId))) {
    return;
  }
  if (!isRestorableCwd(cwd)) {
    return;
  }
  await enqueueStateMutation((state) => {
    const windowState = state.windows[windowId] ?? { panels: {} };
    state.windows[windowId] = windowState;
    windowState.panels[panelId] = {
      cwd,
      updatedAt: new Date().toISOString(),
    };
    return true;
  });
}

export async function removeTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<void> {
  if (!(isNonEmptyId(windowId) && isNonEmptyId(panelId))) {
    return;
  }
  await enqueueStateMutation((state) => {
    const windowState = state.windows[windowId];
    if (!windowState?.panels[panelId]) {
      return false;
    }
    delete windowState.panels[panelId];
    if (Object.keys(windowState.panels).length === 0) {
      delete state.windows[windowId];
    }
    return true;
  });
}
