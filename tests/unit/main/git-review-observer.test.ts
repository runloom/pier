import { createGitReviewFingerprinter } from "@main/services/git-review/git-review-fingerprint.ts";
import {
  createGitReviewObserver,
  GIT_REVIEW_SLOW_DOCUMENT_MS,
  GIT_REVIEW_SLOW_INDEX_MS,
  GIT_REVIEW_SLOW_QUEUE_MS,
} from "@main/services/git-review/git-review-observer.ts";
import type {
  GitReviewObservationEvent,
  GitReviewStructuredLog,
} from "@main/services/git-review/git-review-observer-contract.ts";
import { describe, expect, it, vi } from "vitest";

const PRIVATE_ROOT = "/Users/private/work/project";
const PRIVATE_BODY = "@@ -1 +1 @@\n-secret\n+more-secret";

function startOperation(
  observer: ReturnType<typeof createGitReviewObserver>,
  operationId: string,
  operationKind: "document" | "index" = "document"
): void {
  observer.queued({
    operationId,
    operationKind,
    queryKind: "uncommitted",
    sourceFingerprintParts: [PRIVATE_ROOT, "src/private.ts", PRIVATE_BODY],
  });
}

describe("git review source fingerprint", () => {
  it("uses a process-local HMAC without exposing source parts", () => {
    const first = createGitReviewFingerprinter();
    const second = createGitReviewFingerprinter();
    const parts = [PRIVATE_ROOT, "src/private.ts"];

    const firstHash = first.fingerprint(parts);
    expect(firstHash).toBe(first.fingerprint(parts));
    expect(firstHash).toMatch(/^hmac-sha256:[A-Za-z0-9_-]{43}$/);
    expect(firstHash).not.toContain(PRIVATE_ROOT);
    expect(second.fingerprint(parts)).not.toBe(firstHash);
  });

  it("frames fields so concatenation boundaries cannot collide", () => {
    const fingerprinter = createGitReviewFingerprinter();

    expect(fingerprinter.fingerprint(["ab", "c"])).not.toBe(
      fingerprinter.fingerprint(["a", "bc"])
    );
  });
});

describe("GitReviewObserver lifecycle", () => {
  it("publishes queued/running/settled and exactly one terminal event", () => {
    let now = 100;
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      now: () => now,
      onEvent: (event) => events.push(event),
    });

    startOperation(observer, "operation-1");
    now += 20;
    expect(observer.running("operation-1")).toBe(true);
    expect(observer.running("operation-1")).toBe(false);

    now += 5;
    expect(
      observer.stage("operation-1", { durationMs: 4.5, phase: "identity" })
    ).toBe(true);
    expect(
      observer.command("operation-1", { stderrBytes: 11, stdoutBytes: 29 })
    ).toBe(true);
    expect(
      observer.cache("operation-1", { cacheHit: true, dedupeHit: true })
    ).toBe(true);

    now += 15;
    expect(observer.settled("operation-1", { result: "success" })).toBe(true);
    expect(observer.cancelled("operation-1", "caller")).toBe(false);
    expect(observer.settled("operation-1", { result: "success" })).toBe(false);

    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "running",
      "settled",
    ]);
    expect(events.at(-1)).toMatchObject({
      abortReason: null,
      cacheHit: true,
      commandCount: 1,
      dedupeHit: true,
      durationMs: 40,
      queueWaitMs: 20,
      result: "success",
      stages: [{ durationMs: 4.5, phase: "identity" }],
      stderrBytes: 11,
      stdoutBytes: 29,
    });
    expect(observer.snapshot()).toMatchObject({
      active: 0,
      byOperationKind: {
        document: { cancelled: 0, settled: 1, started: 1 },
      },
    });
  });

  it("cancels directly from the queue and emits one cancelled terminal", () => {
    let now = 10;
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      now: () => now,
      onEvent: (event) => events.push(event),
    });
    startOperation(observer, "operation-cancel", "index");
    now += 7;

    expect(observer.cancelled("operation-cancel", "superseded")).toBe(true);
    expect(observer.cancelled("operation-cancel", "superseded")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      abortReason: "superseded",
      durationMs: 7,
      queueWaitMs: 7,
      result: "aborted",
      state: "cancelled",
    });
  });

  it("never publishes or logs raw paths and document text", () => {
    const events: GitReviewObservationEvent[] = [];
    const logs: GitReviewStructuredLog[] = [];
    const observer = createGitReviewObserver({
      logger: (entry) => logs.push(entry),
      onEvent: (event) => events.push(event),
    });
    startOperation(observer, "operation-private");
    observer.settled("operation-private", {
      failureReason: "command-failed",
      result: "failure",
    });

    const serialized = JSON.stringify({ events, logs });
    expect(serialized).not.toContain(PRIVATE_ROOT);
    expect(serialized).not.toContain("src/private.ts");
    expect(serialized).not.toContain(PRIVATE_BODY);
    expect(events[0]?.sourceHash).toMatch(/^hmac-sha256:/);
  });

  it("removes terminal operations even when observer sinks throw", () => {
    const observer = createGitReviewObserver({
      logger: () => {
        throw new Error("logger unavailable");
      },
      onEvent: () => {
        throw new Error("listener unavailable");
      },
    });
    startOperation(observer, "operation-sink");

    expect(() =>
      observer.settled("operation-sink", {
        failureReason: "internal",
        result: "failure",
      })
    ).not.toThrow();
    expect(observer.snapshot().active).toBe(0);
  });

  it("keeps only active metadata and bounded aggregate counters", () => {
    const observer = createGitReviewObserver();
    for (let index = 0; index < 500; index += 1) {
      const operationId = `bounded-${index}`;
      startOperation(observer, operationId, "index");
      observer.settled(operationId, { result: "success" });
    }

    expect(observer.snapshot()).toEqual({
      active: 0,
      byOperationKind: {
        action: { cancelled: 0, settled: 0, started: 0 },
        "commit-search": { cancelled: 0, settled: 0, started: 0 },
        document: { cancelled: 0, settled: 0, started: 0 },
        hydrate: { cancelled: 0, settled: 0, started: 0 },
        index: { cancelled: 0, settled: 500, started: 500 },
        patch: { cancelled: 0, settled: 0, started: 0 },
      },
    });
  });

  it("aggregates repeated timings into the fixed stage set", () => {
    let terminal: GitReviewObservationEvent | undefined;
    const observer = createGitReviewObserver({
      onEvent: (event) => {
        if (event.state === "settled") {
          terminal = event;
        }
      },
    });
    startOperation(observer, "bounded-stages");
    observer.running("bounded-stages");
    for (let index = 0; index < 1000; index += 1) {
      observer.stage("bounded-stages", { durationMs: 0.25, phase: "git" });
    }
    observer.settled("bounded-stages", { result: "success" });

    expect(terminal?.stages).toEqual([{ durationMs: 250, phase: "git" }]);
  });
});

describe("GitReviewObserver structured logging", () => {
  function createLoggingHarness() {
    let now = 0;
    const logger = vi.fn<(entry: GitReviewStructuredLog) => void>();
    const observer = createGitReviewObserver({
      logger,
      now: () => now,
    });
    return {
      advance(deltaMs: number) {
        now += deltaMs;
      },
      logger,
      observer,
    };
  }

  it("does not log normal successful or superseded operations", () => {
    const harness = createLoggingHarness();
    startOperation(harness.observer, "success");
    harness.observer.running("success");
    harness.advance(100);
    harness.observer.settled("success", { result: "success" });

    startOperation(harness.observer, "superseded");
    harness.observer.cancelled("superseded", "superseded");

    expect(harness.logger).not.toHaveBeenCalled();
  });

  it("uses strict queue/document/index slow thresholds", () => {
    const atBoundary = createLoggingHarness();
    startOperation(atBoundary.observer, "queue-boundary");
    atBoundary.advance(GIT_REVIEW_SLOW_QUEUE_MS);
    atBoundary.observer.running("queue-boundary");
    atBoundary.observer.settled("queue-boundary", { result: "success" });
    expect(atBoundary.logger).not.toHaveBeenCalled();

    const slowQueue = createLoggingHarness();
    startOperation(slowQueue.observer, "queue-slow");
    slowQueue.advance(GIT_REVIEW_SLOW_QUEUE_MS + 1);
    slowQueue.observer.running("queue-slow");
    slowQueue.observer.settled("queue-slow", { result: "success" });
    expect(slowQueue.logger).toHaveBeenCalledWith(
      expect.objectContaining({ triggers: ["slow-queue"] })
    );

    const documentBoundary = createLoggingHarness();
    startOperation(documentBoundary.observer, "document-boundary");
    documentBoundary.observer.running("document-boundary");
    documentBoundary.advance(GIT_REVIEW_SLOW_DOCUMENT_MS);
    documentBoundary.observer.settled("document-boundary", {
      result: "success",
    });
    expect(documentBoundary.logger).not.toHaveBeenCalled();

    const slowDocument = createLoggingHarness();
    startOperation(slowDocument.observer, "document-slow");
    slowDocument.observer.running("document-slow");
    slowDocument.advance(GIT_REVIEW_SLOW_DOCUMENT_MS + 1);
    slowDocument.observer.settled("document-slow", { result: "success" });
    expect(slowDocument.logger).toHaveBeenCalledWith(
      expect.objectContaining({ triggers: ["slow-operation"] })
    );

    const slowIndex = createLoggingHarness();
    startOperation(slowIndex.observer, "index-slow", "index");
    slowIndex.observer.running("index-slow");
    slowIndex.advance(GIT_REVIEW_SLOW_INDEX_MS + 1);
    slowIndex.observer.settled("index-slow", { result: "success" });
    expect(slowIndex.logger).toHaveBeenCalledWith(
      expect.objectContaining({ triggers: ["slow-operation"] })
    );
  });

  it("logs failures and budget termination with safe structured fields", () => {
    const failure = createLoggingHarness();
    startOperation(failure.observer, "failure");
    failure.observer.running("failure");
    failure.observer.command("failure", {
      stderrBytes: 12,
      stdoutBytes: 34,
    });
    failure.observer.stage("failure", { durationMs: 5, phase: "git" });
    failure.observer.settled("failure", {
      failureReason: "command-failed",
      result: "failure",
    });
    expect(failure.logger).toHaveBeenCalledWith(
      expect.objectContaining({
        commandCount: 1,
        failureReason: "command-failed",
        stderrBytes: 12,
        stages: [{ durationMs: 5, phase: "git" }],
        stdoutBytes: 34,
        triggers: ["failure"],
      })
    );

    const budget = createLoggingHarness();
    startOperation(budget.observer, "budget");
    budget.observer.cancelled("budget", "output-limit");
    expect(budget.logger).toHaveBeenCalledWith(
      expect.objectContaining({
        abortReason: "output-limit",
        result: "aborted",
        triggers: ["budget"],
      })
    );
  });

  it("rejects invalid durations and byte counters", () => {
    const harness = createLoggingHarness();
    startOperation(harness.observer, "invalid");
    harness.observer.running("invalid");

    expect(() =>
      harness.observer.stage("invalid", {
        durationMs: Number.NaN,
        phase: "git",
      })
    ).toThrow(RangeError);
    expect(() =>
      harness.observer.command("invalid", {
        stderrBytes: 0,
        stdoutBytes: 1.5,
      })
    ).toThrow(RangeError);
  });

  it("累计字节溢出时不留下部分 command mutation", () => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      onEvent: (event) => events.push(event),
    });
    startOperation(observer, "atomic-command");
    observer.running("atomic-command");
    expect(
      observer.command("atomic-command", {
        stderrBytes: 0,
        stdoutBytes: Number.MAX_SAFE_INTEGER,
      })
    ).toBe(true);

    expect(() =>
      observer.command("atomic-command", { stderrBytes: 1, stdoutBytes: 1 })
    ).toThrow(RangeError);
    observer.settled("atomic-command", { result: "success" });

    expect(events.at(-1)).toMatchObject({
      commandCount: 1,
      stderrBytes: 0,
      stdoutBytes: Number.MAX_SAFE_INTEGER,
    });
  });
});
