import {
  GIT_REVIEW_EXCERPT_BATCH_DEFAULT,
  type GitReviewExcerptBatchResult,
  type GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import {
  cancelLoaderOperation,
  emitLoaderChange,
  type GitReviewDocumentLoaderRuntime,
  settleLoaderLoad,
} from "./loader-runtime.ts";

export type GitReviewExcerptBatchLoader = (
  entries: readonly GitReviewIndexEntry[],
  operationId: string
) => Promise<GitReviewExcerptBatchResult>;

/**
 * 一批占 1 个并发槽；另留 1 槽给选中项单文件 boost。
 * 选中项 idle 时必须先单文件起载，禁止塞进同一轮刚启动的批摘录——
 * 否则树点选要等最多 32 个文件的 batch IPC，正文预算必爆。
 */
export function pumpLoaderExcerptBatch(
  runtime: GitReviewDocumentLoaderRuntime,
  emitChange = true
): boolean {
  const loadBatch = runtime.loadBatch;
  if (loadBatch === undefined || runtime.disposed.value) {
    return false;
  }
  let changed = false;
  const idleKeys = runtime.waiting.filter(
    (entryKey) => runtime.resources.get(entryKey)?.kind === "idle"
  );
  const selected = runtime.selectedDemandedEntryKey.value;
  const selectedIdle =
    selected !== null &&
    runtime.resources.get(selected)?.kind === "idle" &&
    idleKeys.includes(selected);
  if (selectedIdle && runtime.activeCount.value < runtime.maxConcurrent) {
    changed = startSingleLoad(runtime, selected) || changed;
  }
  const batchInFlight = runtime.batchOperationIds.size > 0;
  const canStartBatch =
    !batchInFlight && runtime.activeCount.value < runtime.maxConcurrent;
  if (canStartBatch) {
    const batchKeys = idleKeys
      .filter(
        (entryKey) =>
          entryKey !== selected &&
          runtime.resources.get(entryKey)?.kind === "idle"
      )
      .slice(0, GIT_REVIEW_EXCERPT_BATCH_DEFAULT);
    if (batchKeys.length > 0) {
      changed = startBatchLoad(runtime, loadBatch, batchKeys) || changed;
    }
  }
  if (changed && emitChange) {
    emitLoaderChange(runtime);
  }
  return changed;
}

function startSingleLoad(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string
): boolean {
  const resource = runtime.resources.get(entryKey);
  if (resource?.kind !== "idle") {
    return false;
  }
  const operationId = runtime.createOperationId();
  runtime.setResource(entryKey, {
    entry: resource.entry,
    kind: "loading",
    operationId,
  });
  runtime.activeCount.value += 1;
  runtime.activeEntryKeys.add(entryKey);
  runtime.operationActiveCount.set(operationId, 1);
  const loaded = Promise.resolve(runtime.load(resource.entry, operationId));
  loaded.then(
    (result) => settleLoaderLoad(runtime, entryKey, operationId, result),
    (error: unknown) =>
      settleLoaderLoad(runtime, entryKey, operationId, {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        reason: "internal",
        retryable: true,
      })
  );
  return true;
}

function startBatchLoad(
  runtime: GitReviewDocumentLoaderRuntime,
  loadBatch: GitReviewExcerptBatchLoader,
  entryKeys: readonly string[]
): boolean {
  const entries: GitReviewIndexEntry[] = [];
  for (const entryKey of entryKeys) {
    const resource = runtime.resources.get(entryKey);
    if (resource?.kind !== "idle") {
      continue;
    }
    entries.push(resource.entry);
  }
  if (entries.length === 0) {
    return false;
  }
  const operationId = runtime.createOperationId();
  runtime.activeCount.value += 1;
  runtime.operationActiveCount.set(operationId, entries.length);
  runtime.batchOperationIds.add(operationId);
  for (const entry of entries) {
    runtime.setResource(entry.entryKey, {
      entry,
      kind: "loading",
      operationId,
    });
    runtime.activeEntryKeys.add(entry.entryKey);
  }
  let pending: Promise<GitReviewExcerptBatchResult>;
  try {
    pending = loadBatch(entries, operationId);
  } catch (error) {
    pending = Promise.reject(error);
  }
  pending.then(
    (batch) => settleExcerptBatch(runtime, entries, operationId, batch),
    (error: unknown) => {
      const failure = {
        kind: "error" as const,
        message: error instanceof Error ? error.message : String(error),
        reason: "internal" as const,
        retryable: true,
      };
      for (const entry of entries) {
        settleLoaderLoad(runtime, entry.entryKey, operationId, failure);
      }
    }
  );
  return true;
}

function settleExcerptBatch(
  runtime: GitReviewDocumentLoaderRuntime,
  entries: readonly GitReviewIndexEntry[],
  operationId: string,
  batch: GitReviewExcerptBatchResult
): void {
  if (batch.kind !== "ok") {
    for (const entry of entries) {
      settleLoaderLoad(runtime, entry.entryKey, operationId, batch);
    }
    return;
  }
  const byPath = new Map(batch.items.map((item) => [item.path, item.result]));
  for (const entry of entries) {
    settleLoaderLoad(
      runtime,
      entry.entryKey,
      operationId,
      byPath.get(entry.path) ?? {
        kind: "error",
        message: "Git Review excerpt 缺少该路径",
        reason: "internal",
        retryable: true,
      }
    );
  }
}

export function cancelObsoleteLoaderBatchLoads(
  runtime: GitReviewDocumentLoaderRuntime,
  requiredEntryKeys: ReadonlySet<string>
): void {
  const requiredOps = new Set<string>();
  for (const entryKey of requiredEntryKeys) {
    const resource = runtime.resources.get(entryKey);
    if (resource?.kind === "loading") {
      requiredOps.add(resource.operationId);
    }
  }
  const cancelledOps = new Set<string>();
  for (const entryKey of runtime.activeEntryKeys) {
    const resource = runtime.resources.get(entryKey);
    if (resource?.kind !== "loading" || requiredEntryKeys.has(entryKey)) {
      continue;
    }
    runtime.setResource(entryKey, {
      entry: resource.entry,
      kind: "cancelling",
      operationId: resource.operationId,
    });
    if (
      requiredOps.has(resource.operationId) ||
      cancelledOps.has(resource.operationId)
    ) {
      continue;
    }
    cancelledOps.add(resource.operationId);
    cancelLoaderOperation(runtime, resource.operationId);
  }
}
