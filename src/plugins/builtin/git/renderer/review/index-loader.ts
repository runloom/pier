import {
  GIT_REVIEW_GROUP_ORDER,
  type GitReviewFailure,
  type GitReviewIndexOk,
  type GitReviewIndexResult,
} from "@shared/contracts/git/review.ts";

export type GitReviewIndexLoaderSnapshot =
  | { readonly kind: "error"; readonly failure: GitReviewFailure }
  | {
      readonly generation: number;
      readonly kind: "loaded";
      readonly refreshFailure: GitReviewFailure | null;
      /**
       * True while a user-initiated refresh is in flight (toolbar click or
       * post-mutation barrier). Watch-driven refreshes stay silent.
       */
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

interface RefreshWaiter {
  readonly resolve: () => void;
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
  #recoveryPending = false;
  readonly #refreshWaiters = new Set<RefreshWaiter>();
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
    this.#queueRefresh(true, true);
  }

  /**
   * 用户 mutation 的提交刷新：绕过 watch 防抖，并在该轮或更新一轮 index 落定后完成。
   * 调用方可据此把局部 busy 保持到权威 index 已提交，而不是只覆盖 Git 写请求。
   */
  refreshNow(): Promise<void> {
    if (this.#disposed) {
      return Promise.resolve();
    }
    const revision = this.#queueRefresh(true, true);
    return new Promise<void>((resolve) => {
      this.#refreshWaiters.add({ resolve, revision });
    });
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
    for (const waiter of this.#refreshWaiters) {
      waiter.resolve();
    }
    this.#refreshWaiters.clear();
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
        this.#recoveryPending = true;
        this.#snapshot = {
          ...this.#snapshot,
          refreshFailure: this.#watchFailure,
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
    this.#queueRefresh(false, false);
  };

  /**
   * `userInitiated` 只影响 `refreshing` 的可见性：watch 事件合并的静默刷新
   * 不置位，工具栏旋转仅跟随用户动作（点击 Retry/刷新、mutation 提交屏障）。
   */
  #queueRefresh(immediate: boolean, userInitiated: boolean): number {
    if (this.#disposed) {
      return this.#revision;
    }
    this.#revision += 1;
    const revision = this.#revision;
    this.#refreshQueued = true;
    if (this.#snapshot.kind === "loaded" && !this.#snapshot.refreshing) {
      this.#snapshot = {
        ...this.#snapshot,
        refreshFailure: null,
        refreshing: userInitiated,
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
      this.#timer = null;
    }
    if (immediate) {
      this.#pump();
      return revision;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#pump();
    }, this.#debounceMs);
    return revision;
  }

  #applyFailure(failure: GitReviewFailure): void {
    if (this.#snapshot.kind === "loaded") {
      this.#recoveryPending = true;
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
    if (
      this.#snapshot.kind === "loaded" &&
      !this.#recoveryPending &&
      result.indexRevision !== undefined &&
      this.#snapshot.result.indexRevision === result.indexRevision &&
      hasSameGroupSummaries(
        this.#snapshot.result.groupSummaries,
        result.groupSummaries
      ) &&
      (result.stateSequence ?? 0) <= (this.#snapshot.result.stateSequence ?? 0)
    ) {
      this.#snapshot = {
        ...this.#snapshot,
        refreshFailure: this.#watchFailure,
        refreshing: false,
      };
      this.#emit();
      return;
    }
    const authoritativeGeneration = Math.max(
      generation,
      result.stateSequence ?? 0
    );
    if (
      this.#snapshot.kind === "loaded" &&
      authoritativeGeneration < this.#snapshot.generation
    ) {
      // 被旧状态序列淘汰的结果仍结束本轮用户刷新，避免旋转卡死。
      if (this.#snapshot.refreshing) {
        this.#snapshot = { ...this.#snapshot, refreshing: false };
        this.#emit();
      }
      return;
    }
    this.#recoveryPending = false;
    this.#snapshot = {
      generation: authoritativeGeneration,
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

  #resolveRefreshWaiters(settledRevision: number): void {
    for (const waiter of this.#refreshWaiters) {
      if (waiter.revision > settledRevision) {
        continue;
      }
      this.#refreshWaiters.delete(waiter);
      waiter.resolve();
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
      // mutation 提交屏障只能由已接受的权威 index 解除。失败时保留
      // waiter，局部操作继续 disabled；用户 retry 成功后再统一释放。
      if (result.kind === "ok") {
        this.#resolveRefreshWaiters(active.revision);
      }
    }
    if (this.#refreshQueued && this.#timer === null) {
      this.#pump();
    }
  }
}

function hasSameGroupSummaries(
  left: GitReviewIndexOk["groupSummaries"],
  right: GitReviewIndexOk["groupSummaries"]
): boolean {
  return GIT_REVIEW_GROUP_ORDER.every((group) => {
    const leftSummary = left[group];
    const rightSummary = right[group];
    if (leftSummary === undefined || rightSummary === undefined) {
      return leftSummary === rightSummary;
    }
    if (
      leftSummary.kind !== rightSummary.kind ||
      leftSummary.changedFiles !== rightSummary.changedFiles
    ) {
      return false;
    }
    if (leftSummary.kind === "lineDelta" && rightSummary.kind === "lineDelta") {
      return (
        leftSummary.deletions === rightSummary.deletions &&
        leftSummary.excludedFiles === rightSummary.excludedFiles &&
        leftSummary.insertions === rightSummary.insertions
      );
    }
    if (leftSummary.kind !== "filesOnly" || rightSummary.kind !== "filesOnly") {
      return false;
    }
    return (
      leftSummary.omittedFiles === rightSummary.omittedFiles &&
      sameSummaryReasons(leftSummary.reasons, rightSummary.reasons)
    );
  });
}

function sameSummaryReasons(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedRight = right.toSorted();
  return left
    .toSorted()
    .every((reason, index) => reason === sortedRight[index]);
}
