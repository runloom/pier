import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  prefixRepoPath,
  repoDirectoryAbsolute,
  revealsRepoRoot,
} from "./repo-scope.ts";

export interface GitIgnoredIndex {
  directoryPaths: ReadonlySet<string>;
  entries: readonly string[];
  filePaths: ReadonlySet<string>;
  signature: string;
}

interface GitIgnoredCacheEntry {
  generation: number;
  index: GitIgnoredIndex;
  /** 有仓库探测失败时的重试时刻；全部成功不设。 */
  retryAt?: number;
  /** 参与聚合的仓库前缀集合签名；集合变了旧索引就不再完整。 */
  scopeKey: string;
}

interface GitIgnoredLoad {
  generation: number;
  promise: Promise<GitIgnoredIndex>;
  scopeKey: string;
}

/** 一个树根上已知的仓库边界：`""` 是树根本身，其余是树根相对目录。 */
interface RepoScope {
  key: string;
  list: readonly string[];
  readonly set: Set<string>;
}

/**
 * 仓库边界快照。只有边界或「根是不是仓库」真的变了才换引用，因此可以直接
 * 作为 React 外部 store 的快照反复读取。
 */
export interface RepoScopeSnapshot {
  readonly prefixes: readonly string[];
  readonly rootIsRepo: boolean;
}

export const EMPTY_GIT_IGNORED_INDEX: GitIgnoredIndex = {
  directoryPaths: new Set(),
  entries: [],
  filePaths: new Set(),
  signature: "",
};

/**
 * 探测失败后的重试间隔。非 git 根、瞬时失败都走这条负缓存，避免每次展开目录
 * 都 spawn 一次 `git`；TTL 到期或 invalidate 后重试。
 */
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

function createScope(): RepoScope {
  return { key: "", list: [""], set: new Set([""]) };
}

/**
 * 树根的 Git 忽略索引。
 *
 * 一个树根可能不是仓库本身，而是装着多个仓库的父目录。索引因此按**仓库边界**
 * 聚合：每个已发现的仓库各自跑一次 `git ls-files --ignored`，结果按 `prefix/`
 * 拼回树根相对路径。没被任何仓库覆盖的路径不属于任何仓库，也就没有忽略规则。
 */
export class FilesTreeGitIgnoredIndex {
  readonly #context: RendererPluginContext;
  readonly #indexesByRoot = new Map<string, GitIgnoredCacheEntry>();
  readonly #generationsByRoot = new Map<string, number>();
  readonly #loadsByRoot = new Map<string, GitIgnoredLoad>();
  readonly #listenersByRoot = new Map<string, Set<() => void>>();
  readonly #repoScopeByRoot = new Map<string, RepoScopeSnapshot>();
  readonly #rootIsRepoByRoot = new Map<string, boolean>();
  readonly #scopesByRoot = new Map<string, RepoScope>();

  constructor(context: RendererPluginContext) {
    this.#context = context;
  }

  current(root: string, now = Date.now()): GitIgnoredIndex | undefined {
    const cached = this.#indexesByRoot.get(root);
    if (!cached || cached.generation !== this.#generation(root)) {
      return;
    }
    if (cached.scopeKey !== this.#scope(root).key) {
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

  /**
   * 记录一次目录 listing 暴露的仓库边界。
   *
   * 返回是否发现了新仓库；发现意味着同根的聚合索引不再完整，调用方要在同一拍
   * 重新取一次索引，否则这个仓库的直接子项会绕过忽略规则显示出来。
   */
  observeListing(
    root: string,
    directoryPath: string,
    entries: Parameters<typeof revealsRepoRoot>[1]
  ): boolean {
    if (!revealsRepoRoot(directoryPath, entries)) {
      return false;
    }
    const scope = this.#scope(root);
    if (scope.set.has(directoryPath)) {
      return false;
    }
    scope.set.add(directoryPath);
    scope.list = [...scope.set].sort((left, right) =>
      left.localeCompare(right)
    );
    scope.key = scope.list.join("\0");
    this.#repoScopeByRoot.delete(root);
    this.invalidate(root);
    this.#notify(root);
    return true;
  }

  /** 已知仓库前缀（含代表树根本身的 `""`）；引用稳定，可直接作 store 快照。 */
  repoPrefixes(root: string): readonly string[] {
    return this.#scope(root).list;
  }

  /** 树根本身是不是 Git 仓库。未探测过时为 false。 */
  isRootRepo(root: string): boolean {
    return this.#rootIsRepoByRoot.get(root) === true;
  }

  /**
   * 仓库边界快照；引用只在边界或「根是不是仓库」变化时更换。
   * `useSyncExternalStore` 依赖这个稳定性判断是否需要重新渲染。
   */
  repoScope(root: string): RepoScopeSnapshot {
    const cached = this.#repoScopeByRoot.get(root);
    if (cached) {
      return cached;
    }
    const snapshot: RepoScopeSnapshot = {
      prefixes: this.#scope(root).list,
      rootIsRepo: this.isRootRepo(root),
    };
    this.#repoScopeByRoot.set(root, snapshot);
    return snapshot;
  }

  subscribeRepoPrefixes(root: string, listener: () => void): () => void {
    let listeners = this.#listenersByRoot.get(root);
    if (!listeners) {
      listeners = new Set();
      this.#listenersByRoot.set(root, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.#listenersByRoot.get(root);
      if (!current?.delete(listener)) {
        return;
      }
      if (current.size === 0) {
        this.#listenersByRoot.delete(root);
      }
    };
  }

  /** 测试与根切换复用：丢掉某根（或全部）的缓存与仓库边界。 */
  reset(root?: string): void {
    if (root !== undefined) {
      this.#forgetRoot(root);
      return;
    }
    for (const key of this.#scopesByRoot.keys()) {
      this.#forgetRoot(key);
    }
  }

  async load(root: string): Promise<GitIgnoredIndex> {
    const generation = this.#generation(root);
    const scope = this.#scope(root);
    const cached = this.current(root);
    if (cached) {
      return cached;
    }
    const active = this.#loadsByRoot.get(root);
    if (active?.generation === generation && active.scopeKey === scope.key) {
      return await active.promise;
    }
    const gitApi = (this.#context as Partial<RendererPluginContext>).git;
    const load = (async (): Promise<GitIgnoredIndex> => {
      if (!gitApi?.listIgnored) {
        this.#store(
          root,
          generation,
          scope.key,
          EMPTY_GIT_IGNORED_INDEX,
          false
        );
        return EMPTY_GIT_IGNORED_INDEX;
      }
      const prefixResults = await Promise.all(
        scope.list.map(async (prefix) => {
          try {
            const entries = await gitApi.listIgnored(
              repoDirectoryAbsolute(root, prefix)
            );
            return { entries, ok: true as const, prefix };
          } catch {
            return { entries: [], ok: false as const, prefix };
          }
        })
      );
      if (
        this.#generation(root) !== generation ||
        this.#scope(root).key !== scope.key
      ) {
        const currentLoad = this.#loadsByRoot.get(root);
        if (currentLoad?.generation === this.#generation(root)) {
          return await currentLoad.promise;
        }
        return this.current(root) ?? EMPTY_GIT_IGNORED_INDEX;
      }
      const aggregated: string[] = [];
      let succeeded = 0;
      let rootIsRepo = false;
      for (const result of prefixResults) {
        if (!result.ok) {
          continue;
        }
        succeeded += 1;
        if (result.prefix.length === 0) {
          rootIsRepo = true;
        }
        for (const entry of result.entries) {
          aggregated.push(prefixRepoPath(result.prefix, entry));
        }
      }
      const wasRootRepo = this.#rootIsRepoByRoot.get(root) === true;
      this.#rootIsRepoByRoot.set(root, rootIsRepo);
      const index = createGitIgnoredIndex(aggregated);
      // 只要有一个仓库探测成功，索引对已知仓库就是可信的：多仓库父目录里
      // 「根不是仓库」是常态而不是故障，不能让它的失败把整份索引打成过期。
      this.#store(root, generation, scope.key, index, succeeded === 0);
      // 「根是不是仓库」决定要不要在根上订阅 git 状态；只在结论翻转时通知，
      // 首次探测判定为「不是仓库」对消费方没有任何可观察变化。
      if (wasRootRepo !== rootIsRepo) {
        this.#repoScopeByRoot.delete(root);
        this.#notify(root);
      }
      return index;
    })();
    this.#loadsByRoot.set(root, {
      generation,
      promise: load,
      scopeKey: scope.key,
    });
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

  #forgetRoot(root: string): void {
    this.#indexesByRoot.delete(root);
    this.#generationsByRoot.delete(root);
    this.#loadsByRoot.delete(root);
    this.#repoScopeByRoot.delete(root);
    this.#rootIsRepoByRoot.delete(root);
    this.#scopesByRoot.delete(root);
    this.#listenersByRoot.delete(root);
  }

  #generation(root: string): number {
    return this.#generationsByRoot.get(root) ?? 0;
  }

  #notify(root: string): void {
    for (const listener of this.#listenersByRoot.get(root) ?? []) {
      listener();
    }
  }

  #scope(root: string): RepoScope {
    const existing = this.#scopesByRoot.get(root);
    if (existing) {
      return existing;
    }
    const scope = createScope();
    this.#scopesByRoot.set(root, scope);
    return scope;
  }

  #store(
    root: string,
    generation: number,
    scopeKey: string,
    index: GitIgnoredIndex,
    shouldRetry: boolean
  ): void {
    this.#indexesByRoot.set(root, {
      generation,
      index,
      scopeKey,
      ...(shouldRetry
        ? { retryAt: Date.now() + GIT_IGNORED_PROBE_FAILURE_TTL_MS }
        : {}),
    });
  }
}
