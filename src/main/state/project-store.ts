import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Project, projectSchema } from "@shared/contracts/project.ts";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

/**
 * Project 持久化：id + rootPath + 派生 name + updatedAt。
 * 存 `${userData}/project-state.json`，500ms debounced write。
 * 消费方：panel-context-resolver 在 gitRoot/openedPath 派生完 rootPath 后
 * `upsertProjectFromPath()` 拿到稳定 projectId。
 */

const projectStateSchema = z
  .object({
    projects: z.array(projectSchema),
    version: z.literal(1),
  })
  .strict();
type ProjectState = z.infer<typeof projectStateSchema>;
const DEFAULTS: ProjectState = { projects: [], version: 1 };

let store: DebouncedJsonStore<ProjectState> | undefined;

function getStore(): DebouncedJsonStore<ProjectState> {
  if (!store) {
    store = debouncedJsonStore<ProjectState>({
      debounceMs: 500,
      defaults: DEFAULTS,
      filePath: join(app.getPath("userData"), "project-state.json"),
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<ProjectState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    const parsed = projectStateSchema.parse(raw);
    if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
      s.replace(parsed);
    }
  } catch {
    // 旧 schema / 损坏——清空并重启, 用户丢失最多 20 条最近记录（可接受）。
    await s.clear();
    await s.init();
  }
  return s;
}

/** package.json / deno.json 的 name 字段解析（一次性 zod schema）。 */
const namedJsonSchema = z.object({ name: z.string().min(1) }).passthrough();

async function tryJsonName(
  rootPath: string,
  fileName: string
): Promise<string | null> {
  try {
    const raw = await readFile(join(rootPath, fileName), "utf8");
    const parsed = namedJsonSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Cargo.toml `[package] name = "..."` 段锚定正则。
 *
 * 之前用 `^\s*name\s*=\s*"([^"]+)"/m` 只匹配第一个 `name`，会误命中
 * `[[bin]] name = "my-bin"` 或 workspace 根 `[workspace] name`。
 * 收紧成先命中 `[package]` header 再在同 section 内（`[^[]*?` 不跨 section）
 * 找 `name = "..."`；`m` 让 `^`/`$` 认行边界。
 */
const CARGO_PACKAGE_NAME_RE = /^\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/ms;

async function tryCargoName(rootPath: string): Promise<string | null> {
  try {
    const raw = await readFile(join(rootPath, "Cargo.toml"), "utf8");
    const match = raw.match(CARGO_PACKAGE_NAME_RE);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function deriveProjectName(rootPath: string): Promise<string> {
  const fromManifest =
    (await tryJsonName(rootPath, "package.json")) ??
    (await tryJsonName(rootPath, "deno.json")) ??
    (await tryCargoName(rootPath));
  if (fromManifest) {
    return fromManifest;
  }
  return basename(rootPath) || rootPath;
}

/**
 * 从 rootPath 查/建 Project。已存在 → touch updatedAt 保 id + name 稳定；
 * 不存在 → 新建（随机 uuid + 派生 name）。
 *
 * **并发安全**：同一 rootPath 的 in-flight upsert 通过 `inflight` map 去重，
 * 并且在 `mutate` callback 内再次 `find` 兜底——防止两个终端同时打开同一
 * project 时 read-derive-mutate 竞态落两条不同 UUID 的记录。
 */
const inflight = new Map<string, Promise<Project>>();

export async function upsertProjectFromPath(
  rootPath: string,
  now: () => number = Date.now
): Promise<Project> {
  const pending = inflight.get(rootPath);
  if (pending) {
    return pending;
  }
  const promise = doUpsert(rootPath, now);
  inflight.set(rootPath, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(rootPath);
  }
}

async function doUpsert(rootPath: string, now: () => number): Promise<Project> {
  const s = await ensureStore();
  const state = s.get();
  const existing = state.projects.find((p) => p.rootPath === rootPath);
  if (existing) {
    const touched: Project = { ...existing, updatedAt: now() };
    s.mutate((next) => ({
      ...next,
      projects: next.projects.map((p) => (p.id === existing.id ? touched : p)),
    }));
    return touched;
  }
  const project: Project = {
    id: randomUUID(),
    rootPath,
    name: await deriveProjectName(rootPath),
    updatedAt: now(),
  };
  // mutate 回调是同步的, 我们借它做二次 find 兜底: 若其它调用方在
  // deriveProjectName await 期间已经写入了同 rootPath 的记录（比如
  // filesystem mock 在测试里瞬时创建）, 我们复用它的 id 而非新增一条。
  let committed: Project = project;
  s.mutate((next) => {
    const collision = next.projects.find((p) => p.rootPath === rootPath);
    if (collision) {
      committed = { ...collision, updatedAt: now() };
      return {
        ...next,
        projects: next.projects.map((p) =>
          p.id === collision.id ? committed : p
        ),
      };
    }
    return { ...next, projects: [...next.projects, project] };
  });
  return committed;
}

export async function readProjectById(id: string): Promise<Project | null> {
  const s = await ensureStore();
  return s.get().projects.find((p) => p.id === id) ?? null;
}

export async function readProjectByRootPath(
  rootPath: string
): Promise<Project | null> {
  const s = await ensureStore();
  return s.get().projects.find((p) => p.rootPath === rootPath) ?? null;
}

export async function listProjects(): Promise<readonly Project[]> {
  const s = await ensureStore();
  return structuredClone(s.get().projects);
}

export async function flushProjectStore(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}

/** 测试专用：清空缓存单例 + 磁盘 + inflight map, 每个 test isolation。 */
export async function _resetProjectStoreForTests(): Promise<void> {
  if (store) {
    await store.clear();
  }
  store = undefined;
  inflight.clear();
}
