import { join } from "node:path";
import {
  type PanelContext,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const panelContextStateSchema = z.object({
  recent: z.array(panelContextSchema),
  version: z.literal(1),
});

type PanelContextState = z.infer<typeof panelContextStateSchema>;

const DEFAULTS: PanelContextState = {
  recent: [],
  version: 1,
};

const MAX_RECENT_PANEL_CONTEXTS = 20;

function resolveFilePath(): string {
  return join(app.getPath("userData"), "panel-context-state.json");
}

let store: DebouncedJsonStore<PanelContextState> | undefined;

function getStore(): DebouncedJsonStore<PanelContextState> {
  if (!store) {
    store = debouncedJsonStore<PanelContextState>({
      debounceMs: 500,
      defaults: DEFAULTS,
      filePath: resolveFilePath(),
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<PanelContextState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    const parsed = panelContextStateSchema.parse(raw);
    if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
      s.replace(parsed);
    }
  } catch (err) {
    console.warn(
      "[panel-context-state] parse failed, resetting to defaults:",
      err
    );
    await s.clear();
    await s.init();
  }
  return s;
}

function keyForContext(context: PanelContext): string {
  return (
    context.worktreeKey ??
    context.worktreeRoot ??
    context.projectRootPath ??
    context.cwd ??
    context.openedPath ??
    context.contextId
  );
}

export async function readRecentPanelContexts(): Promise<PanelContext[]> {
  const s = await ensureStore();
  return structuredClone(s.get().recent);
}

export async function recordRecentPanelContext(
  context: PanelContext
): Promise<void> {
  const s = await ensureStore();
  s.mutate((state) => {
    const key = keyForContext(context);
    state.recent = [
      context,
      ...state.recent.filter((recent) => keyForContext(recent) !== key),
    ].slice(0, MAX_RECENT_PANEL_CONTEXTS);
    return state;
  });
}

export async function flushPanelContextState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
