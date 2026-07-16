import type {
  GitReviewFailure,
  GitReviewIndexOk,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";

export type GitReviewIndexLoaderSnapshot =
  | { readonly kind: "error"; readonly failure: GitReviewFailure }
  | {
      readonly generation: number;
      readonly kind: "loaded";
      readonly refreshFailure: GitReviewFailure | null;
      readonly refreshing: boolean;
      readonly result: GitReviewIndexOk;
    }
  | { readonly kind: "loading" };

interface GitReviewIndexLoaderOptions {
  readonly cancel: (operationId: string) => Promise<void>;
  readonly createOperationId?: () => string;
  readonly debounceMs?: number;
  readonly load: (operationId: string) => Promise<GitReviewIndexResult>;
  readonly watch: (
    listener: () => void,
    onStartFailure: (error: Error) => void,
    onReady: () => void
  ) => () => void;
}

interface ActiveRequest {
  cancelRequested: boolean;
  invalidated: boolean;
  readonly operationId: string;
  readonly revision: number;
}

type Listener = () => void;

const DEFAULT_REFRESH_DEBOUNCE_MS = 120;

function internalFailure(error: unknown): GitReviewFailure {
  return {
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
    reason: "internal",
    retryable: true,
  };
}

/**
 * Review index 的私有刷新控制器：事件合并、最新代校验和取消只在这里拥有。
 * 同一时间最多一个 index 请求；在飞期间的任意事件只形成一轮尾随刷新。
 */
export class GitReviewIndexLoader {
  readonly #cancel: GitReviewIndexLoaderOptions["cancel"];
  readonly #createOperationId: () => string;
  readonly #debounceMs: number;
  readonly #listeners = new Set<Listener>();
  readonly #load: GitReviewIndexLoaderOptions["load"];
  readonly #watch: GitReviewIndexLoaderOptions["watch"];
  #active: ActiveRequest | null = null;
  #disposed = false;
  #refreshQueued = true;
  #revision = 0;
  #snapshot: GitReviewIndexLoaderSnapshot = { kind: "loading" };
  #timer: ReturnType<typeof setTimeout> | null = null;
  #unsubscribeWatch: () => void = () => undefined;
  #watchAttempt = 0;
  #watchFailed = false;
  #watchFailure: GitReviewFailure | null = null;

  constructor(options: GitReviewIndexLoaderOptions) {
    this.#cancel = options.cancel;
    this.#createOperationId =
      options.createOperationId ?? (() => crypto.randomUUID());
    this.#debounceMs = options.debounceMs ?? DEFAULT_REFRESH_DEBOUNCE_MS;
    if (!(Number.isSafeInteger(this.#debounceMs) && this.#debounceMs >= 0)) {
      throw new Error("Git Review 刷新合并窗口必须是非负安全整数");
    }
    this.#load = options.load;
    this.#watch = options.watch;
    this.#startWatch();
    this.#pump();
  }

  getSnapshot = (): GitReviewIndexLoaderSnapshot => this.#snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  retry(): void {
    if (this.#watchFailed) {
      this.#startWatch();
    }
    this.#requestRefresh();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#unsubscribeWatch();
    this.#cancelActive();
    this.#listeners.clear();
  }

  #startWatch(): void {
    this.#unsubscribeWatch();
    this.#unsubscribeWatch = () => undefined;
    const attempt = ++this.#watchAttempt;
    let failedSynchronously = false;
    const onStartFailure = (error: Error): void => {
      if (this.#disposed || attempt !== this.#watchAttempt) {
        return;
      }
      failedSynchronously = true;
      this.#watchFailed = true;
      this.#watchFailure = internalFailure(error);
      this.#unsubscribeWatch();
      this.#unsubscribeWatch = () => undefined;
      if (this.#snapshot.kind === "loaded") {
        this.#snapshot = {
          ...this.#snapshot,
          refreshFailure: this.#watchFailure,
          refreshing: false,
        };
        this.#emit();
      }
    };
    let unsubscribe: () => void;
    try {
      unsubscribe = this.#watch(
        this.#requestRefresh,
        onStartFailure,
        this.#requestRefresh
      );
    } catch (error) {
      onStartFailure(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (this.#disposed || attempt !== this.#watchAttempt) {
      unsubscribe();
      return;
    }
    if (failedSynchronously) {
      unsubscribe();
      return;
    }
    this.#unsubscribeWatch = unsubscribe;
    this.#watchFailed = false;
    this.#watchFailure = null;
  }

  readonly #requestRefresh = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#revision += 1;
    this.#refreshQueued = true;
    if (this.#snapshot.kind === "loaded" && !this.#snapshot.refreshing) {
      this.#snapshot = {
        ...this.#snapshot,
        refreshFailure: null,
        refreshing: true,
      };
      this.#emit();
    } else if (this.#snapshot.kind === "error") {
      // 初次失败重试立即进入忙碌态，避免按钮在 debounce/请求期间被重复触发。
      this.#snapshot = { kind: "loading" };
      this.#emit();
    }
    if (this.#active) {
      this.#active.invalidated = true;
      this.#cancelActive();
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#pump();
    }, this.#debounceMs);
  };

  #applyFailure(failure: GitReviewFailure): void {
    if (this.#snapshot.kind === "loaded") {
      this.#snapshot = {
        ...this.#snapshot,
        refreshFailure: failure,
        refreshing: false,
      };
    } else {
      this.#snapshot = { failure, kind: "error" };
    }
    this.#emit();
  }

  #applyResult(result: GitReviewIndexResult, generation: number): void {
    if (result.kind !== "ok") {
      this.#applyFailure(result);
      return;
    }
    this.#snapshot = {
      generation,
      kind: "loaded",
      refreshFailure: this.#watchFailure,
      refreshing: false,
      result,
    };
    this.#emit();
  }

  #cancelActive(): void {
    if (!(this.#active && !this.#active.cancelRequested)) {
      return;
    }
    this.#active.cancelRequested = true;
    this.#cancel(this.#active.operationId).catch(() => undefined);
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #pump(): void {
    if (this.#disposed || this.#active || !this.#refreshQueued) {
      return;
    }
    this.#refreshQueued = false;
    const active: ActiveRequest = {
      cancelRequested: false,
      invalidated: false,
      operationId: this.#createOperationId(),
      revision: this.#revision,
    };
    this.#active = active;
    let pending: Promise<GitReviewIndexResult>;
    try {
      pending = this.#load(active.operationId);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (result) => this.#settle(active, result),
      (error: unknown) => this.#settle(active, internalFailure(error))
    );
  }

  #settle(active: ActiveRequest, result: GitReviewIndexResult): void {
    if (this.#active !== active) {
      return;
    }
    this.#active = null;
    if (this.#disposed) {
      return;
    }
    if (!active.invalidated && active.revision === this.#revision) {
      this.#applyResult(result, active.revision);
    }
    if (this.#refreshQueued && this.#timer === null) {
      this.#pump();
    }
  }
}
