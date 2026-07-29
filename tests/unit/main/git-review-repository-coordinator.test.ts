import { GitReviewRepositoryCoordinator } from "@main/services/git-review/git-review-repository-coordinator.ts";
import { describe, expect, it } from "vitest";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("GitReviewRepositoryCoordinator", () => {
  it("records the mutation sequence before releasing a waiting read", async () => {
    const coordinator = new GitReviewRepositoryCoordinator();
    const writer = deferred();
    const mutation = coordinator.runMutation(
      "repo",
      new AbortController().signal,
      async () => {
        await writer.promise;
        return coordinator.recordMutation("repo");
      }
    );
    const read = coordinator
      .runConsistentRead(
        "repo",
        new AbortController().signal,
        async () => "index"
      )
      .then((result) => ({
        result,
        stamped: coordinator.stampIndexResult("repo", {
          entries: [],
          groupSummaries: {},
          indexRevision: "revision:1",
          kind: "ok" as const,
          warnings: [],
        }),
      }));

    writer.resolve();
    const [mutationSequence, readResult] = await Promise.all([mutation, read]);
    expect(readResult.result).toBe("index");
    expect(readResult.stamped).toMatchObject({
      kind: "ok",
      stateSequence: mutationSequence,
    });
  });

  it("re-runs a read whose snapshot overlaps a mutation", async () => {
    const coordinator = new GitReviewRepositoryCoordinator();
    const firstRead = deferred();
    const calls: number[] = [];
    const read = coordinator.runConsistentRead(
      "repo",
      new AbortController().signal,
      async () => {
        calls.push(calls.length + 1);
        if (calls.length === 1) {
          await firstRead.promise;
        }
        return calls.length;
      }
    );
    await Promise.resolve();
    const mutation = coordinator.runMutation(
      "repo",
      new AbortController().signal,
      async () => coordinator.recordMutation("repo")
    );
    firstRead.resolve();

    expect(await mutation).toBe(1);
    expect(await read).toBe(2);
    expect(calls).toEqual([1, 2]);
  });

  it("stamps an index inside the final consistency commit without a microtask gap", async () => {
    const coordinator = new GitReviewRepositoryCoordinator();
    let calls = 0;
    let mutation: Promise<number> | null = null;
    const result = await coordinator.runConsistentIndexRead(
      "repo",
      new AbortController().signal,
      async () => {
        calls += 1;
        if (calls === 1) {
          queueMicrotask(() => {
            queueMicrotask(() => {
              mutation = coordinator.runMutation(
                "repo",
                new AbortController().signal,
                async () => coordinator.recordMutation("repo")
              );
            });
          });
        }
        return {
          entries: [],
          groupSummaries: {},
          indexRevision: `revision:${calls}`,
          kind: "ok" as const,
          warnings: [],
        };
      }
    );

    expect(await mutation).toBe(1);
    expect(calls).toBe(2);
    expect(result).toMatchObject({
      indexRevision: "revision:2",
      kind: "ok",
      stateSequence: 1,
    });
  });

  it("cleans up an aborted queued mutation and leaves later reads and writes usable", async () => {
    const coordinator = new GitReviewRepositoryCoordinator();
    const writer = deferred();
    const first = coordinator.runMutation(
      "repo",
      new AbortController().signal,
      async () => {
        await writer.promise;
        return coordinator.recordMutation("repo");
      }
    );
    const queuedAbort = new AbortController();
    const second = coordinator.runMutation(
      "repo",
      queuedAbort.signal,
      async () => coordinator.recordMutation("repo")
    );
    queuedAbort.abort();
    writer.resolve();

    await expect(first).resolves.toBe(1);
    await expect(second).rejects.toThrow("cancelled");
    await expect(
      coordinator.runConsistentRead(
        "repo",
        new AbortController().signal,
        async () => "read-after-abort"
      )
    ).resolves.toBe("read-after-abort");
    await expect(
      coordinator.runMutation("repo", new AbortController().signal, async () =>
        coordinator.recordMutation("repo")
      )
    ).resolves.toBe(2);
  });
});
