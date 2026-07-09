import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type LocalEnvironmentProjectFile,
  localEnvironmentProjectFileSchema,
  localEnvironmentWorktreeBindingSchema,
} from "@shared/contracts/environment.ts";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "../state/debounced-store.ts";

/**
 * 全局注册表格式:
 * - `projects`: 用户显式加入 Pier 的项目路径, 只存映射, 不存具体配置.
 * - `worktreeBindings`: worktree 与项目的绑定 (跨会话保留, 供 cleanup 判定).
 * 具体 setup/cleanup/env/copyPatterns 由每项目的 `.pier/environment.json` 承担.
 */
const localEnvironmentIndexEntrySchema = z
  .object({ projectRootPath: z.string().min(1) })
  .strict();

export const localEnvironmentGlobalStateSchema = z
  .object({
    projects: z.array(localEnvironmentIndexEntrySchema).default([]),
    version: z.literal(1).default(1),
    worktreeBindings: z
      .array(localEnvironmentWorktreeBindingSchema)
      .default([]),
  })
  .strict();

export type LocalEnvironmentIndexEntry = z.infer<
  typeof localEnvironmentIndexEntrySchema
>;
export type LocalEnvironmentGlobalState = z.infer<
  typeof localEnvironmentGlobalStateSchema
>;

export const DEFAULT_LOCAL_ENVIRONMENT_GLOBAL_STATE: LocalEnvironmentGlobalState =
  {
    projects: [],
    version: 1,
    worktreeBindings: [],
  };

export interface LocalEnvironmentStateStore {
  mutateState(
    fn: (state: LocalEnvironmentGlobalState) => LocalEnvironmentGlobalState
  ): Promise<LocalEnvironmentGlobalState>;
  readState(): Promise<LocalEnvironmentGlobalState>;
}

export function createLocalEnvironmentStateStore(
  filePath: string
): LocalEnvironmentStateStore {
  const store: DebouncedJsonStore<LocalEnvironmentGlobalState> =
    debouncedJsonStore({
      debounceMs: 500,
      defaults: DEFAULT_LOCAL_ENVIRONMENT_GLOBAL_STATE,
      filePath,
    });

  let storeInitPromise: Promise<
    DebouncedJsonStore<LocalEnvironmentGlobalState>
  > | null = null;

  async function initializeStore(): Promise<
    DebouncedJsonStore<LocalEnvironmentGlobalState>
  > {
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, "utf-8");
        localEnvironmentGlobalStateSchema.parse(JSON.parse(raw));
      } catch (err) {
        console.warn(
          "[local-environments] parse failed, resetting to defaults:",
          err
        );
        try {
          await unlink(filePath);
        } catch {
          // store.init will use defaults if cleanup fails.
        }
      }
    }

    try {
      const raw = await store.init();
      const parsed = localEnvironmentGlobalStateSchema.parse(raw);
      if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
        store.replace(parsed);
      }
    } catch (err) {
      console.warn(
        "[local-environments] parse failed, resetting to defaults:",
        err
      );
      await store.clear();
      await store.init();
    }
    return store;
  }

  function ensureStore(): Promise<
    DebouncedJsonStore<LocalEnvironmentGlobalState>
  > {
    storeInitPromise ??= initializeStore();
    return storeInitPromise;
  }

  return {
    async mutateState(fn) {
      const initialized = await ensureStore();
      const result = initialized.mutate(fn);
      await initialized.flush();
      return result;
    },
    async readState() {
      const initialized = await ensureStore();
      return initialized.get();
    },
  };
}

// ---------------------------------------------------------------------------
// Per-project file I/O
// ---------------------------------------------------------------------------

/** 项目跟随的配置文件相对路径. */
export const PROJECT_CONFIG_RELATIVE = join(".pier", "environment.json");

/** `<projectRootPath>/.pier/environment.json` 绝对路径. */
export function projectConfigFilePath(projectRootPath: string): string {
  return join(projectRootPath, PROJECT_CONFIG_RELATIVE);
}

/**
 * 读取项目文件. 文件不存在返回 null; 解析失败返回 null 并打印 warn.
 * 不会有副作用 (不建目录不写盘).
 */
export async function readProjectFile(
  projectRootPath: string
): Promise<LocalEnvironmentProjectFile | null> {
  const filePath = projectConfigFilePath(projectRootPath);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    return localEnvironmentProjectFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn(
      "[local-environments] project file parse failed",
      { filePath },
      err
    );
    return null;
  }
}

/**
 * 写项目文件. `.pier/` 目录不存在则先建. 用 writeFileAtomic 保证原子性.
 */
export async function writeProjectFile(
  projectRootPath: string,
  config: LocalEnvironmentProjectFile
): Promise<void> {
  const filePath = projectConfigFilePath(projectRootPath);
  await mkdir(dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await writeFileAtomic(filePath, serialized, "utf-8");
}

/**
 * 删除项目文件. 若 `.pier/` 目录随后为空一并清理, 保持工作树整洁.
 * 文件本身不存在时是幂等的.
 */
export async function deleteProjectFile(
  projectRootPath: string
): Promise<void> {
  const filePath = projectConfigFilePath(projectRootPath);
  const dir = dirname(filePath);
  try {
    await unlink(filePath);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return;
    }
    throw err;
  }
  try {
    const remaining = await readdir(dir);
    if (remaining.length === 0) {
      await rmdir(dir);
    }
  } catch {
    // 目录清理失败不影响主体; 空目录残留无害.
  }
}

interface NodeSystemError extends Error {
  code: string;
}

function isNodeError(err: unknown): err is NodeSystemError {
  return err instanceof Error && "code" in err && typeof err.code === "string";
}
