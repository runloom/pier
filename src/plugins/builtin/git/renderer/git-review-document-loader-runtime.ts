import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import { resourceFromDocumentResult } from "./git-review-document-loader-utils.ts";
import type {
  GitReviewDocumentLoaderChange,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import type { GitReviewDocumentRetention } from "./git-review-document-retention.ts";

export interface GitReviewDocumentLoaderRuntime {
  readonly activeCount: { value: number };
  readonly activeEntryKeys: Set<string>;
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
  readonly maxConcurrent: number;
  readonly preFreedOperationIds: Set<string>;
  readonly resources: Map<string, GitReviewDocumentResource>;
  readonly retention: GitReviewDocumentRetention;
  readonly selectedDemandedEntryKey: { value: string | null };
  setResource(entryKey: string, resource: GitReviewDocumentResource): void;
  readonly visibleEntryKeys: { value: readonly string[] };
  readonly waiting: string[];
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
      !runtime.budgetDeferredEntryKeys.has(entryKey)
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
  } else {
    runtime.activeEntryKeys.delete(entryKey);
    runtime.activeCount.value -= 1;
  }
  if (resource.kind === "cancelling") {
    runtime.setResource(entryKey, { entry: resource.entry, kind: "idle" });
    rebuildLoaderWaiting(runtime);
    pumpLoaderLoads(runtime, false);
    emitLoaderChange(runtime);
    return;
  }
  const next = resourceFromDocumentResult(resource.entry, result);
  if (next.kind === "retain") {
    retainLoaderDocument(runtime, entryKey, resource.entry, next.document);
  } else {
    runtime.setResource(entryKey, next);
  }
  pumpLoaderLoads(runtime, false);
  emitLoaderChange(runtime);
}
