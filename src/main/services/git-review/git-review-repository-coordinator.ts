import type { GitReviewIndexResult } from "../../../shared/contracts/git-review.ts";
import { GitReviewSchedulerError } from "./git-review-scheduler.ts";

interface GitReviewRepositoryState {
  readonly awaitingRevision: boolean;
  readonly revision: string | null;
  readonly sequence: number;
}

/**
 * Coordinates repository-wide Git Review state. Mutations are FIFO per
 * repository, reads wait for pending mutations, and index responses carry the
 * authoritative sequence for their observed revision.
 */
export class GitReviewRepositoryCoordinator {
  readonly #mutationTails = new Map<string, Promise<void>>();
  readonly #states = new Map<string, GitReviewRepositoryState>();

  async runMutation<T>(
    repositoryKey: string,
    signal: AbortSignal,
    run: () => Promise<T>
  ): Promise<T> {
    const previous =
      this.#mutationTails.get(repositoryKey) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#mutationTails.set(repositoryKey, tail);
    await previous.catch(() => undefined);
    try {
      if (signal.aborted) {
        throw new GitReviewSchedulerError(
          "caller",
          "Git Review mutation cancelled"
        );
      }
      return await run();
    } finally {
      release();
      if (this.#mutationTails.get(repositoryKey) === tail) {
        this.#mutationTails.delete(repositoryKey);
      }
    }
  }

  async waitForMutation(
    repositoryKey: string,
    signal: AbortSignal
  ): Promise<void> {
    const tail = this.#mutationTails.get(repositoryKey);
    if (tail === undefined) {
      if (signal.aborted) {
        throw new GitReviewSchedulerError(
          "caller",
          "Git Review read cancelled while waiting for mutation"
        );
      }
      return;
    }
    await tail.catch(() => undefined);
    if (signal.aborted) {
      throw new GitReviewSchedulerError(
        "caller",
        "Git Review read cancelled while waiting for mutation"
      );
    }
  }

  /**
   * Reads may start before a mutation is queued. Re-run when the repository
   * mutation sequence changes while the read is in flight, so a late old
   * snapshot can never be stamped as the mutation's authoritative state.
   */
  async runConsistentRead<T>(
    repositoryKey: string,
    signal: AbortSignal,
    read: () => Promise<T>
  ): Promise<T> {
    return this.#runConsistentRead(
      repositoryKey,
      signal,
      read,
      (result) => result
    );
  }

  /**
   * Index 的状态序号必须与一致性判定在同一同步提交段内写入。若先返回 read、
   * 再由 service await 后 stamp，中间的微任务可以插入 mutation 并把旧快照
   * 错标成新序号。
   */
  async runConsistentIndexRead(
    repositoryKey: string,
    signal: AbortSignal,
    read: () => Promise<GitReviewIndexResult>
  ): Promise<GitReviewIndexResult> {
    return this.#runConsistentRead(repositoryKey, signal, read, (result) =>
      this.stampIndexResult(repositoryKey, result)
    );
  }

  async #runConsistentRead<T, Result>(
    repositoryKey: string,
    signal: AbortSignal,
    read: () => Promise<T>,
    commit: (result: T) => Result
  ): Promise<Result> {
    while (true) {
      await this.waitForMutation(repositoryKey, signal);
      if (this.#mutationTails.has(repositoryKey)) {
        continue;
      }
      const sequenceBefore = this.#states.get(repositoryKey)?.sequence ?? 0;
      const result = await read();
      await this.waitForMutation(repositoryKey, signal);
      // `await waitForMutation()` 会让出微任务；同步 tail 检查是最终
      // 线性化点。此后到 sequence/commit 之间没有 await。
      if (this.#mutationTails.has(repositoryKey)) {
        continue;
      }
      if (signal.aborted) {
        throw new GitReviewSchedulerError(
          "caller",
          "Git Review read cancelled while committing"
        );
      }
      const sequenceAfter = this.#states.get(repositoryKey)?.sequence ?? 0;
      if (sequenceBefore === sequenceAfter) {
        return commit(result);
      }
    }
  }

  recordMutation(repositoryKey: string): number {
    const previous = this.#states.get(repositoryKey);
    const next = {
      awaitingRevision: true,
      revision: previous?.revision ?? null,
      sequence: (previous?.sequence ?? 0) + 1,
    };
    this.#states.set(repositoryKey, next);
    return next.sequence;
  }

  stampIndexResult(
    repositoryKey: string,
    result: GitReviewIndexResult
  ): GitReviewIndexResult {
    if (result.kind !== "ok") {
      return result;
    }
    const revision = result.indexRevision ?? null;
    const previous = this.#states.get(repositoryKey);
    if (previous === undefined) {
      const initial = {
        awaitingRevision: false,
        revision,
        sequence: 1,
      };
      this.#states.set(repositoryKey, initial);
      return { ...result, stateSequence: initial.sequence };
    }
    const changed = revision !== previous.revision;
    const sequence =
      changed && !previous.awaitingRevision
        ? previous.sequence + 1
        : previous.sequence;
    this.#states.set(repositoryKey, {
      awaitingRevision: changed ? false : previous.awaitingRevision,
      revision: changed ? revision : previous.revision,
      sequence,
    });
    return { ...result, stateSequence: sequence };
  }
}
