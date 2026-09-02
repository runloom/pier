import type { RendererPluginContext } from "@plugins/api/renderer.ts";

export interface GitIgnoredIndex {
  directoryPaths: ReadonlySet<string>;
  entries: readonly string[];
  filePaths: ReadonlySet<string>;
  signature: string;
}

interface GitIgnoredCacheEntry {
  generation: number;
  index: GitIgnoredIndex;
  /** 探针失败后的重试时刻；成功命中不设。 */
  retryAt?: number;
}

interface GitIgnoredLoad {
  generation: number;
  promise: Promise<GitIgnoredIndex>;
}

export const EMPTY_GIT_IGNORED_INDEX: GitIgnoredIndex = {
  directoryPaths: new Set(),
  entries: [],
  filePaths: new Set(),
  signature: "",
};

/** 非 git 根 / 瞬时失败：短 TTL 负缓存，避免每次展开目录都 spawn git。 */
export const GIT_IGNORED_PROBE_FAILURE_TTL_MS = 30_000;

function normalizeIgnoredEntry(path: string): string {
  return path.replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function createGitIgnoredIndex(entries: readonly string[]): GitIgnoredIndex {
  const directoryPaths = new Set<string>();
  const filePaths = new Set<string>();
  for (const rawEntry of entries) {
    const entry = normalizeIgnoredEntry(rawEntry);
    if (!entry) {
      continue;
    }
    if (entry.endsWith("/")) {
      directoryPaths.add(entry.replace(/\/+$/, ""));
    } else {
      filePaths.add(entry);
    }
  }
  const normalizedEntries = [
    ...[...directoryPaths].map((path) => `${path}/`),
    ...filePaths,
  ].sort((left, right) => left.localeCompare(right));
  return {
    directoryPaths,
    entries: normalizedEntries,
    filePaths,
    signature: normalizedEntries.join("\0"),
  };
}

export function isGitIgnoredPath(
  path: string,
  index: GitIgnoredIndex
): boolean {
  if (index.filePaths.has(path)) {
    return true;
  }
  let candidate = path;
  while (candidate) {
    if (index.directoryPaths.has(candidate)) {
      return true;
    }
    const slash = candidate.lastIndexOf("/");
    candidate = slash < 0 ? "" : candidate.slice(0, slash);
  }
  return false;
}

export class FilesTreeGitIgnoredIndex {
  readonly #context: RendererPluginContext;
  readonly #indexesByRoot = new Map<string, GitIgnoredCacheEntry>();
  readonly #generationsByRoot = new Map<string, number>();
  readonly #loadsByRoot = new Map<string, GitIgnoredLoad>();

  constructor(context: RendererPluginContext) {
    this.#context = context;
  }

  current(root: string, now = Date.now()): GitIgnoredIndex | undefined {
    const cached = this.#indexesByRoot.get(root);
    if (!cached || cached.generation !== this.#generation(root)) {
      return;
    }
    if (cached.retryAt !== undefined && now >= cached.retryAt) {
      // 过期仍留在 map 里：refresh() 要用它当基线；load() 命中 miss 后覆盖。
      return;
    }
    return cached.index;
  }

  invalidate(root: string): void {
    this.#generationsByRoot.set(root, this.#generation(root) + 1);
    this.#loadsByRoot.delete(root);
  }

  async load(root: string): Promise<GitIgnoredIndex> {
    const generation = this.#generation(root);
    const cached = this.current(root);
    if (cached) {
      return cached;
    }
    const active = this.#loadsByRoot.get(root);
    if (active?.generation === generation) {
      return await active.promise;
    }
    const gitApi = (this.#context as Partial<RendererPluginContext>).git;
    const load = (async () => {
      let index = EMPTY_GIT_IGNORED_INDEX;
      let probeFailed = false;
      if (gitApi?.listIgnored) {
        try {
          index = createGitIgnoredIndex(await gitApi.listIgnored(root));
        } catch {
          // 瞬时失败与非 git 根都走短 TTL 负缓存，避免每次展开都 spawn；
          // TTL 到期或 invalidate 后重试。
          probeFailed = true;
          index = EMPTY_GIT_IGNORED_INDEX;
        }
      }
      if (this.#generation(root) !== generation) {
        const currentLoad = this.#loadsByRoot.get(root);
        if (currentLoad?.generation === this.#generation(root)) {
          return await currentLoad.promise;
        }
        return this.current(root) ?? EMPTY_GIT_IGNORED_INDEX;
      }
      this.#indexesByRoot.set(root, {
        generation,
        index,
        ...(probeFailed
          ? { retryAt: Date.now() + GIT_IGNORED_PROBE_FAILURE_TTL_MS }
          : {}),
      });
      return index;
    })();
    this.#loadsByRoot.set(root, { generation, promise: load });
    try {
      return await load;
    } finally {
      if (this.#loadsByRoot.get(root)?.promise === load) {
        this.#loadsByRoot.delete(root);
      }
    }
  }

  async refresh(
    root: string
  ): Promise<{ changed: boolean; entries: readonly string[] }> {
    // 基线取树最后一次可能用过的索引（含已过 TTL 的负缓存、已被 invalidate 的旧代），
    // 而不是 current()：否则 TTL 到期恰逢 git 事件时会漏掉 reload。
    // 首次挂载尚无索引时 changed=false——list() 已等待过同一索引，无需再重刷。
    const previous = this.#indexesByRoot.get(root)?.index;
    this.invalidate(root);
    const next = await this.load(root);
    return {
      changed: previous !== undefined && previous.signature !== next.signature,
      entries: next.entries,
    };
  }

  #generation(root: string): number {
    return this.#generationsByRoot.get(root) ?? 0;
  }
}
