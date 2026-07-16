interface PathCacheEntry<T> {
  readonly marker: string;
  readonly value: T;
}

/** 路径身份缓存：每次命中都校验 `.git` 标记，并按真正访问顺序执行 LRU 淘汰。 */
export class GitWatchPathCache<T> {
  readonly #capacity: number;
  readonly #entries = new Map<string, PathCacheEntry<T>>();

  constructor(capacity: number) {
    if (!(Number.isSafeInteger(capacity) && capacity > 0)) {
      throw new Error("Git watch path cache capacity must be positive");
    }
    this.#capacity = capacity;
  }

  clear(): void {
    this.#entries.clear();
  }

  delete(path: string): void {
    this.#entries.delete(path);
  }

  get(path: string, marker: string): T | undefined {
    const cached = this.#entries.get(path);
    if (!cached) {
      return;
    }
    if (cached.marker !== marker) {
      this.#entries.delete(path);
      return;
    }
    this.#entries.delete(path);
    this.#entries.set(path, cached);
    return cached.value;
  }

  has(path: string): boolean {
    return this.#entries.has(path);
  }

  set(path: string, marker: string, value: T): void {
    this.#entries.delete(path);
    this.#entries.set(path, { marker, value });
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.#entries.delete(oldest);
    }
  }
}
