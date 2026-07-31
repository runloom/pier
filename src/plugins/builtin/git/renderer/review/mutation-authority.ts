import type { GitReviewScope } from "@shared/contracts/git/review.ts";

type AuthorityListener = () => void;
type AuthoritativeRefresher = () => Promise<void>;

interface RepositoryAuthorityState {
  blocked: boolean;
  listeners: Set<AuthorityListener>;
  refreshers: Map<symbol, AuthoritativeRefresher>;
  refreshPromise: Promise<void> | null;
}

/**
 * 插件生命周期内的仓库级修改权限。它只持有 UI 策略与刷新屏障；
 * main 的 GitReviewRepositoryCoordinator 仍是跨窗口写入顺序的最终所有者。
 */
export class GitReviewMutationAuthority {
  readonly #states = new Map<string, RepositoryAuthorityState>();

  acquire(source: GitReviewScope): boolean {
    const state = this.#state(source);
    if (state.blocked) {
      return false;
    }
    state.blocked = true;
    this.#emit(state);
    return true;
  }

  blocked(source: GitReviewScope | null): boolean {
    return source
      ? (this.#states.get(authorityKey(source))?.blocked ?? false)
      : false;
  }

  dispose(): void {
    this.#states.clear();
  }

  registerRefresher(
    source: GitReviewScope,
    refresher: AuthoritativeRefresher
  ): () => void {
    const key = authorityKey(source);
    const state = this.#state(source);
    const token = Symbol(key);
    state.refreshers.set(token, refresher);
    return () => {
      const current = this.#states.get(key);
      current?.refreshers.delete(token);
      this.#deleteIfUnused(key, current);
    };
  }

  refreshAndRelease(source: GitReviewScope): Promise<void> {
    const state = this.#state(source);
    state.blocked = true;
    this.#emit(state);
    if (state.refreshPromise !== null) {
      return state.refreshPromise;
    }
    const refreshers = [...state.refreshers.values()];
    const refreshPromise = Promise.all(
      refreshers.map((refresh) => refresh())
    ).then(() => {
      if (state.refreshPromise !== refreshPromise) {
        return;
      }
      state.refreshPromise = null;
      state.blocked = false;
      this.#emit(state);
      this.#deleteIfUnused(authorityKey(source), state);
    });
    state.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  subscribe(
    source: GitReviewScope | null,
    listener: AuthorityListener
  ): () => void {
    if (source === null) {
      return () => undefined;
    }
    const key = authorityKey(source);
    const state = this.#state(source);
    state.listeners.add(listener);
    return () => {
      const current = this.#states.get(key);
      current?.listeners.delete(listener);
      this.#deleteIfUnused(key, current);
    };
  }

  #deleteIfUnused(
    key: string,
    state: RepositoryAuthorityState | undefined
  ): void {
    if (
      state &&
      !state.blocked &&
      state.listeners.size === 0 &&
      state.refreshers.size === 0 &&
      state.refreshPromise === null
    ) {
      this.#states.delete(key);
    }
  }

  #emit(state: RepositoryAuthorityState): void {
    for (const listener of state.listeners) {
      listener();
    }
  }

  #state(source: GitReviewScope): RepositoryAuthorityState {
    const key = authorityKey(source);
    let state = this.#states.get(key);
    if (state === undefined) {
      state = {
        blocked: false,
        listeners: new Set(),
        refreshers: new Map(),
        refreshPromise: null,
      };
      this.#states.set(key, state);
    }
    return state;
  }
}

export function gitReviewMutationAuthorityKey(source: GitReviewScope): string {
  return authorityKey(source);
}

function authorityKey(source: GitReviewScope): string {
  return JSON.stringify([source.contextId, source.gitRootPath]);
}
