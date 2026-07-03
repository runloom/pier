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

const CARGO_NAME_RE = /^\s*name\s*=\s*"([^"]+)"/m;

/**
 * Cargo.toml 的 `[package] name = "..."` 单行正则匹配（不引 toml 库）。
 * workspace 根 `[workspace] name = "..."` 会误命中 - 若发现测试挂，
 * 收紧为 `[package]\s*\n[^\[]*?^\s*name = "..."` 明确锚定 section。
 */
async function tryCargoName(rootPath: string): Promise<string | null> {
  try {
    const raw = await readFile(join(rootPath, "Cargo.toml"), "utf8");
    const match = raw.match(CARGO_NAME_RE);
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
 */
export async function upsertProjectFromPath(
  rootPath: string,
  now: () => number = Date.now
): Promise<Project> {
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
  s.mutate((next) => ({ ...next, projects: [...next.projects, project] }));
  return project;
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

/** 测试专用：清空缓存单例 + 磁盘, 每个 test isolation。 */
export async function _resetProjectStoreForTests(): Promise<void> {
  if (store) {
    await store.clear();
  }
  store = undefined;
}
