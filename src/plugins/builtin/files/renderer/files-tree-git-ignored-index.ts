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

  current(root: string): GitIgnoredIndex | undefined {
    const cached = this.#indexesByRoot.get(root);
    return cached?.generation === this.#generation(root)
      ? cached.index
      : undefined;
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
      if (gitApi?.listIgnored) {
        try {
          index = createGitIgnoredIndex(await gitApi.listIgnored(root));
        } catch {
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
      this.#indexesByRoot.set(root, { generation, index });
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
    const previous = this.current(root);
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
