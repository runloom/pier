import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { TaskBoardParams, TaskBoardSnapshot } from "../shared/types.ts";
import { encodeScopeId } from "./scope-id.ts";

export interface BoardCache {
  get(params: TaskBoardParams): TaskBoardSnapshot | undefined;
  init(): Promise<void>;
  set(params: TaskBoardParams, snapshot: TaskBoardSnapshot): Promise<void>;
}

export function createBoardCache(filePath: string): BoardCache {
  const memory = new Map<string, TaskBoardSnapshot>();
  let loaded = false;

  const load = async () => {
    if (loaded) {
      return;
    }
    loaded = true;
    try {
      const raw: unknown = JSON.parse(await readFile(filePath, "utf8"));
      if (!raw || typeof raw !== "object") {
        return;
      }
      for (const [key, value] of Object.entries(raw)) {
        memory.set(key, value as TaskBoardSnapshot);
      }
    } catch {
      // First run or corrupt cache: stay empty.
    }
  };

  return {
    get(params) {
      return memory.get(encodeScopeId(params));
    },
    init: load,
    async set(params, snapshot) {
      await load();
      memory.set(encodeScopeId(params), snapshot);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFileAtomic(
        filePath,
        `${JSON.stringify(Object.fromEntries(memory.entries()))}\n`,
        "utf8"
      );
    },
  };
}
