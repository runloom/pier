import { join } from "node:path";
import {
  type TaskRecentState,
  taskRecentStateSchema,
} from "@shared/contracts/tasks.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export const EMPTY_TASK_RECENT_STATE: TaskRecentState = {
  entries: [],
  version: 1,
};

function resolveFilePath(): string {
  return join(app.getPath("userData"), "task-recent.json");
}

let store: DebouncedJsonStore<TaskRecentState> | undefined;

function getStore(): DebouncedJsonStore<TaskRecentState> {
  if (!store) {
    store = debouncedJsonStore<TaskRecentState>({
      debounceMs: 500,
      defaults: EMPTY_TASK_RECENT_STATE,
      filePath: resolveFilePath(),
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<TaskRecentState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    taskRecentStateSchema.parse(raw);
  } catch (error) {
    console.warn("[task-recent] parse failed, using empty state:", error);
    await s.clear();
    await s.init();
  }
  return s;
}

export async function readTaskRecentState(): Promise<TaskRecentState> {
  const s = await ensureStore();
  return s.get();
}

export async function writeTaskRecentState(
  state: TaskRecentState
): Promise<void> {
  const s = await ensureStore();
  s.replace(state);
}
