import type {
  GitReviewExcerptBatchResult,
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { isReviewEntryBodyHydratable } from "./body-class.ts";
import { resourceFromDocumentResult } from "./loader-utils.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentResource,
} from "./resource.ts";
import type { GitReviewDocumentRetention } from "./retention.ts";

/** 背景路径瞬态失败的静默重试次数（不含首次）。有 last-good 时由 generation 继续展示。 */
export const GIT_REVIEW_SILENT_RETRY_MAX = 3;

export interface GitReviewDocumentLoaderRuntime {
  readonly activeCount: { value: number };
  readonly activeEntryKeys: Set<string>;
  readonly batchOperationIds: Set<string>;
  readonly budgetDeferredEntryKeys: Set<string>;
  readonly bufferedEntryKeys: { value: readonly string[] };
  readonly cancel: (operationId: string) => Promise<void> | void;
  readonly changedEntryKeys: Set<string>;
  readonly createOperationId: () => string;
  readonly disposed: { value: boolean };
  isSettled(): boolean;
  readonly listeners: Set<(change: GitReviewDocumentLoaderChange) => void>;
  readonly load: (
    entry: GitReviewIndexEntry,
    operationId: string
  ) => Promise<GitReviewFileDocumentResult>;
  readonly loadBatch?: (
    entries: readonly GitReviewIndexEntry[],
    operationId: string
  ) => Promise<GitReviewExcerptBatchResult>;
  readonly maxConcurrent: number;
  readonly operationActiveCount: Map<string, number>;
  readonly preFreedOperationIds: Set<string>;
  pumpLoads(emitChange: boolean): boolean;
  readonly resources: Map<string, GitReviewDocumentResource>;
  readonly retention: GitReviewDocumentRetention;
  readonly selectedDemandedEntryKey: { value: string | null };
  setResource(entryKey: string, resource: GitReviewDocumentResource): void;
  readonly silentRetryCount: Map<string, number>;
  readonly visibleEntryKeys: { value: readonly string[] };
  readonly waiting: string[];
}

/** 将 loader 私有字段桥接为 runtime 读写壳（避免重复手写 getter/setter）。 */
export function bindLoaderRuntimeField<T>(
  get: () => T,
  set: (next: T) => void
): { value: T } {
  return {
    get value() {
      return get();
    },
    set value(next: T) {
      set(next);
    },
  };
}

export function loaderRequiredEntryKeys(
  runtime: GitReviewDocumentLoaderRuntime
): Set<string> {
  return new Set([
    ...(runtime.selectedDemandedEntryKey.value === null
      ? []
      : [runtime.selectedDemandedEntryKey.value]),
    ...runtime.visibleEntryKeys.value,
    ...runtime.bufferedEntryKeys.value.filter(
      (entryKey) => !runtime.budgetDeferredEntryKeys.has(entryKey)
    ),
  ]);
}

export function loaderIsSettled(
  runtime: GitReviewDocumentLoaderRuntime
): boolean {
  for (const entryKey of loaderRequiredEntryKeys(runtime)) {
    const resource = runtime.resources.get(entryKey);
    // meta 可出现在 demand 边角；永不 materialize，不阻塞 settle
    if (
      resource !== undefined &&
      !isReviewEntryBodyHydratable(resource.entry)
    ) {
      continue;
    }
    if (
      resource?.kind === "idle" ||
      resource?.kind === "loading" ||
      resource?.kind === "cancelling"
    ) {
      return false;
    }
  }
  return true;
}

export function cancelObsoleteLoaderLoads(
  runtime: GitReviewDocumentLoaderRuntime,
  requiredEntryKeys: ReadonlySet<string>
): void {
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
    cancelLoaderOperation(runtime, resource.operationId);
  }
}

/** 选中项 idle 且并发已满时，取消一条非选中 loading 让出槽位。 */
export function yieldLoaderConcurrencyForSelected(
  runtime: GitReviewDocumentLoaderRuntime
): void {
  const selected = runtime.selectedDemandedEntryKey.value;
  if (selected === null) {
    return;
  }
  const resource = runtime.resources.get(selected);
  if (resource?.kind !== "idle") {
    return;
  }
  if (runtime.activeCount.value < runtime.maxConcurrent) {
    return;
  }
  for (const entryKey of runtime.activeEntryKeys) {
    if (entryKey === selected) {
      continue;
    }
    const active = runtime.resources.get(entryKey);
    if (active?.kind !== "loading") {
      continue;
    }
    if ((runtime.operationActiveCount.get(active.operationId) ?? 1) > 1) {
      continue;
    }
    runtime.setResource(entryKey, {
      entry: active.entry,
      kind: "cancelling",
      operationId: active.operationId,
    });
    runtime.activeEntryKeys.delete(entryKey);
    runtime.activeCount.value -= 1;
    runtime.preFreedOperationIds.add(active.operationId);
    runtime.operationActiveCount.delete(active.operationId);
    runtime.batchOperationIds.delete(active.operationId);
    cancelLoaderOperation(runtime, active.operationId);
    break;
  }
}

/** 从 in-flight 批/单文件扣掉该 entry；末成员则取消 IPC 并释放并发槽。 */
export function detachLoaderInFlightEntry(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string
): boolean {
  const resource = runtime.resources.get(entryKey);
  if (resource?.kind !== "loading" && resource?.kind !== "cancelling") {
    return false;
  }
  const remaining =
    (runtime.operationActiveCount.get(resource.operationId) ?? 1) - 1;
  runtime.activeEntryKeys.delete(entryKey);
  if (remaining <= 0) {
    finishLoaderOperation(runtime, resource.operationId);
    runtime.activeCount.value = Math.max(0, runtime.activeCount.value - 1);
    runtime.preFreedOperationIds.add(resource.operationId);
    cancelLoaderOperation(runtime, resource.operationId);
  } else {
    runtime.operationActiveCount.set(resource.operationId, remaining);
  }
  return true;
}

export function cancelLoaderOperation(
  runtime: GitReviewDocumentLoaderRuntime,
  operationId: string
): void {
  try {
    const result = runtime.cancel(operationId);
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // 取消是尽力而为；operationId 围栏仍会拒绝迟到结果。
  }
}

export function retryLoaderRetryableFailures(
  runtime: GitReviewDocumentLoaderRuntime
): void {
  if (runtime.disposed.value) {
    return;
  }
  let changed = false;
  for (const resource of runtime.resources.values()) {
    if (resource.kind !== "error" || !resource.failure.retryable) {
      continue;
    }
    runtime.silentRetryCount.delete(resource.entry.entryKey);
    runtime.setResource(resource.entry.entryKey, {
      entry: resource.entry,
      kind: "idle",
    });
    changed = true;
  }
  if (!changed) {
    return;
  }
  rebuildLoaderWaiting(runtime);
  runtime.pumpLoads(false);
  emitLoaderChange(runtime);
}

export function emitLoaderChange(
  runtime: GitReviewDocumentLoaderRuntime
): void {
  if (runtime.disposed.value) {
    return;
  }
  const resources = [...runtime.changedEntryKeys].flatMap((entryKey) => {
    const resource = runtime.resources.get(entryKey);
    return resource === undefined ? [] : [resource];
  });
  runtime.changedEntryKeys.clear();
  const change = Object.freeze({
    resources: Object.freeze(resources),
    settled: runtime.isSettled(),
  });
  for (const listener of runtime.listeners) {
    listener(change);
  }
}

export function pumpLoaderLoads(
  runtime: GitReviewDocumentLoaderRuntime,
  emitChange = true
): boolean {
  if (runtime.disposed.value) {
    return false;
  }
  let changed = false;
  while (
    runtime.activeCount.value < runtime.maxConcurrent &&
    runtime.waiting.length > 0
  ) {
    const entryKey = runtime.waiting.shift();
    if (entryKey === undefined) {
      break;
    }
    const resource = runtime.resources.get(entryKey);
    if (resource?.kind !== "idle") {
      continue;
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
    changed = true;
    let pending: Promise<GitReviewFileDocumentResult>;
    try {
      pending = runtime.load(resource.entry, operationId);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (result) => settleLoaderLoad(runtime, entryKey, operationId, result),
      (error: unknown) =>
        settleLoaderLoad(runtime, entryKey, operationId, {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
          reason: "internal",
          retryable: true,
        })
    );
  }
  if (changed && emitChange) {
    emitLoaderChange(runtime);
  }
  return changed;
}

export function rebuildLoaderWaiting(
  runtime: GitReviewDocumentLoaderRuntime
): void {
  runtime.waiting.length = 0;
  const seen = new Set<string>();
  for (const entryKey of [
    ...(runtime.selectedDemandedEntryKey.value === null
      ? []
      : [runtime.selectedDemandedEntryKey.value]),
    ...runtime.visibleEntryKeys.value,
    ...runtime.bufferedEntryKeys.value,
  ]) {
    if (seen.has(entryKey)) {
      continue;
    }
    seen.add(entryKey);
    const resource = runtime.resources.get(entryKey);
    if (resource?.kind === "loaded") {
      runtime.retention.touch(entryKey);
    } else if (
      resource?.kind === "idle" &&
      !runtime.budgetDeferredEntryKeys.has(entryKey) &&
      // 金标准：meta/notice 永不进 materialize 队列
      isReviewEntryBodyHydratable(resource.entry)
    ) {
      runtime.waiting.push(entryKey);
    }
  }
}

export function releaseLoaderRetainedEntries(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKeys: readonly string[]
): void {
  for (const entryKey of entryKeys) {
    const evicted = runtime.resources.get(entryKey);
    if (evicted?.kind === "loaded") {
      runtime.setResource(entryKey, {
        entry: evicted.entry,
        kind: "idle",
      });
      if (
        runtime.bufferedEntryKeys.value.includes(entryKey) &&
        !runtime.visibleEntryKeys.value.includes(entryKey) &&
        entryKey !== runtime.selectedDemandedEntryKey.value
      ) {
        runtime.budgetDeferredEntryKeys.add(entryKey);
      }
    }
  }
}

export function retainLoaderDocument(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string,
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): void {
  runtime.setResource(entryKey, { document, entry, kind: "loaded" });
  releaseLoaderRetainedEntries(
    runtime,
    runtime.retention.retain(entryKey, document)
  );
}

function finishLoaderOperation(
  runtime: GitReviewDocumentLoaderRuntime,
  operationId: string
): void {
  runtime.operationActiveCount.delete(operationId);
  runtime.batchOperationIds.delete(operationId);
}

function consumeLoaderActiveSlot(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string,
  operationId: string
): void {
  runtime.activeEntryKeys.delete(entryKey);
  const remaining = (runtime.operationActiveCount.get(operationId) ?? 1) - 1;
  if (remaining <= 0) {
    finishLoaderOperation(runtime, operationId);
    runtime.activeCount.value -= 1;
    return;
  }
  runtime.operationActiveCount.set(operationId, remaining);
}

/** content 槽 demand 水合超时：单文件扣槽；同批 sibling 仍在飞则不取消整批 IPC。 */
export function failLoaderHydrateTimeout(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKeys: readonly string[]
): boolean {
  if (runtime.disposed.value || entryKeys.length === 0) {
    return false;
  }
  let changed = false;
  for (const entryKey of entryKeys) {
    const resource = runtime.resources.get(entryKey);
    if (!(resource && isReviewEntryBodyHydratable(resource.entry))) {
      continue;
    }
    if (
      resource.kind === "loaded" ||
      resource.kind === "error" ||
      resource.kind === "unchanged"
    ) {
      continue;
    }
    detachLoaderInFlightEntry(runtime, entryKey);
    runtime.setResource(entryKey, {
      entry: resource.entry,
      failure: {
        kind: "error",
        message: "Timed out while loading this change",
        reason: "timeout",
        retryable: true,
      },
      kind: "error",
    });
    changed = true;
  }
  if (changed) {
    rebuildLoaderWaiting(runtime);
    runtime.pumpLoads(false);
    emitLoaderChange(runtime);
  }
  return changed;
}

export function settleLoaderLoad(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string,
  operationId: string,
  result: GitReviewFileDocumentResult
): void {
  if (runtime.disposed.value) {
    return;
  }
  const resource = runtime.resources.get(entryKey);
  if (
    (resource?.kind !== "loading" && resource?.kind !== "cancelling") ||
    resource.operationId !== operationId
  ) {
    // 迟到/失配结果也要清 preFreed 标记，避免 Set 泄漏
    runtime.preFreedOperationIds.delete(operationId);
    return;
  }
  if (runtime.preFreedOperationIds.has(operationId)) {
    runtime.preFreedOperationIds.delete(operationId);
    finishLoaderOperation(runtime, operationId);
  } else {
    consumeLoaderActiveSlot(runtime, entryKey, operationId);
  }
  if (resource.kind === "cancelling") {
    runtime.setResource(entryKey, { entry: resource.entry, kind: "idle" });
    rebuildLoaderWaiting(runtime);
    runtime.pumpLoads(false);
    emitLoaderChange(runtime);
    return;
  }
  const next = resourceFromDocumentResult(resource.entry, result);
  if (next.kind === "retain") {
    runtime.silentRetryCount.delete(entryKey);
    retainLoaderDocument(runtime, entryKey, resource.entry, next.document);
  } else if (shouldSilentRetryDocumentFailure(runtime, entryKey, next)) {
    const used = (runtime.silentRetryCount.get(entryKey) ?? 0) + 1;
    runtime.silentRetryCount.set(entryKey, used);
    runtime.setResource(entryKey, { entry: resource.entry, kind: "idle" });
    rebuildLoaderWaiting(runtime);
  } else {
    if (next.kind !== "error") {
      runtime.silentRetryCount.delete(entryKey);
    }
    runtime.setResource(entryKey, next);
  }
  runtime.pumpLoads(false);
  emitLoaderChange(runtime);
}

function shouldSilentRetryDocumentFailure(
  runtime: GitReviewDocumentLoaderRuntime,
  entryKey: string,
  next: ReturnType<typeof resourceFromDocumentResult>
): boolean {
  if (next.kind !== "error" || !next.failure.retryable) {
    return false;
  }
  if (runtime.selectedDemandedEntryKey.value === entryKey) {
    return false;
  }
  const used = runtime.silentRetryCount.get(entryKey) ?? 0;
  return used < GIT_REVIEW_SILENT_RETRY_MAX;
}
