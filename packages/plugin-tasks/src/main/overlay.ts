import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod/mini";
import type { TaskBoardSnapshot } from "../shared/types.ts";

export const overlaySchema = z.object({
  createdAt: z.number(),
  itemKey: z.string(),
  panelId: z.optional(z.string()),
  worktreePath: z.string(),
});

export type TaskWorkOverlay = z.infer<typeof overlaySchema>;

const fileSchema = z.object({
  overlays: z.record(z.string(), overlaySchema),
});

export interface OverlayStore {
  clear(itemKey: string): Promise<void>;
  get(itemKey: string): Promise<TaskWorkOverlay | null>;
  list(): Promise<readonly TaskWorkOverlay[]>;
  set(overlay: TaskWorkOverlay): Promise<void>;
}

export function createOverlayStore(filePath: string): OverlayStore {
  let cache: Record<string, TaskWorkOverlay> | null = null;

  const load = async () => {
    if (cache) {
      return cache;
    }
    try {
      cache = fileSchema.parse(
        JSON.parse(await readFile(filePath, "utf8"))
      ).overlays;
    } catch {
      cache = {};
    }
    return cache;
  };

  const persist = async (overlays: Record<string, TaskWorkOverlay>) => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFileAtomic(
      filePath,
      `${JSON.stringify({ overlays }, null, 2)}\n`,
      "utf8"
    );
    cache = overlays;
  };

  return {
    async clear(itemKey) {
      const overlays = { ...(await load()) };
      delete overlays[itemKey];
      await persist(overlays);
    },
    async get(itemKey) {
      return (await load())[itemKey] ?? null;
    },
    async list() {
      return Object.values(await load());
    },
    async set(overlay) {
      const overlays = { ...(await load()) };
      overlays[overlay.itemKey] = overlay;
      await persist(overlays);
    },
  };
}

export function overlayFilePath(workDir: string): string {
  return join(workDir, "overlays.json");
}

export function applyOverlaysToBoard(
  snapshot: TaskBoardSnapshot,
  overlays: readonly TaskWorkOverlay[]
): TaskBoardSnapshot {
  if (overlays.length === 0) {
    return snapshot;
  }
  const byKey = new Map(overlays.map((overlay) => [overlay.itemKey, overlay]));
  return {
    ...snapshot,
    columns: snapshot.columns.map((column) => ({
      ...column,
      items: column.items.map((item) => {
        const overlay = byKey.get(item.key);
        if (!overlay) {
          return item;
        }
        return {
          ...item,
          work: {
            path: overlay.worktreePath,
            ...(overlay.panelId ? { panelId: overlay.panelId } : {}),
          },
        };
      }),
    })),
  };
}
