import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ReviewFailedResource,
  ReviewFailureChange,
} from "./git-review-document-generation.ts";

const MAX_VISIBLE_REVIEW_FAILURES = 5;

interface RenderFailure {
  readonly error: Error;
  readonly resource: ReviewFailedResource;
}

interface FailureSources {
  document: ReviewFailedResource | null;
  refresh: ReviewFailedResource | null;
  readonly renderBySectionId: Map<string, RenderFailure>;
}

export interface ReviewFailureSummary {
  readonly hasHiddenFailures: boolean;
  readonly visibleFailures: readonly ReviewFailedResource[];
}

const EMPTY_FAILURE_SUMMARY: ReviewFailureSummary = {
  hasHiddenFailures: false,
  visibleFailures: [],
};

/**
 * 失败按 entry 聚合，document/refresh/render 三个来源只保留一个可见结果。
 * 热路径只修改对应 entry；反馈区固定显示前五项，并始终提升当前选择项。
 */
export class GitReviewFailureAccumulator {
  readonly #activeByEntryKey = new Map<string, ReviewFailedResource>();
  readonly #entryKeyBySectionId = new Map<string, string>();
  readonly #sourcesByEntryKey = new Map<string, FailureSources>();

  applyGenerationChanges(changes: readonly ReviewFailureChange[]): boolean {
    let changed = false;
    for (const change of changes) {
      const sources = this.#sourcesForChange(change);
      if (!sources) {
        continue;
      }
      if (change.source === "document") {
        if (sources.document === change.resource) {
          continue;
        }
        sources.document = change.resource;
      } else {
        if (sources.refresh === change.resource) {
          continue;
        }
        sources.refresh = change.resource;
      }
      this.#removeEmptySources(change.entryKey, sources);
      this.#reconcileActive(change.entryKey);
      changed = true;
    }
    return changed;
  }

  reset(changes: readonly ReviewFailureChange[]): void {
    this.#activeByEntryKey.clear();
    this.#entryKeyBySectionId.clear();
    this.#sourcesByEntryKey.clear();
    this.applyGenerationChanges(changes);
  }

  summary(selectedEntryKey: string | null): ReviewFailureSummary {
    if (this.#activeByEntryKey.size === 0) {
      return EMPTY_FAILURE_SUMMARY;
    }
    const visibleFailures: ReviewFailedResource[] = [];
    for (const resource of this.#activeByEntryKey.values()) {
      visibleFailures.push(resource);
      if (visibleFailures.length === MAX_VISIBLE_REVIEW_FAILURES) {
        break;
      }
    }
    const selected =
      selectedEntryKey === null
        ? undefined
        : this.#activeByEntryKey.get(selectedEntryKey);
    if (
      selected &&
      !visibleFailures.some(
        (resource) => resource.entry.entryKey === selectedEntryKey
      )
    ) {
      if (visibleFailures.length < MAX_VISIBLE_REVIEW_FAILURES) {
        visibleFailures.push(selected);
      } else {
        visibleFailures[MAX_VISIBLE_REVIEW_FAILURES - 1] = selected;
      }
    }
    return {
      hasHiddenFailures: this.#activeByEntryKey.size > visibleFailures.length,
      visibleFailures,
    };
  }

  updateRenderError(
    sectionId: string,
    error: Error | null,
    entry: GitReviewIndexEntry | undefined
  ): boolean {
    const entryKey =
      this.#entryKeyBySectionId.get(sectionId) ?? entry?.entryKey;
    if (!entryKey) {
      return false;
    }
    const existingSources = this.#sourcesByEntryKey.get(entryKey);
    if (error === null) {
      const existing = existingSources?.renderBySectionId.get(sectionId);
      if (!(existingSources && existing)) {
        return false;
      }
      existingSources.renderBySectionId.delete(sectionId);
      this.#entryKeyBySectionId.delete(sectionId);
      this.#removeEmptySources(entryKey, existingSources);
      this.#reconcileActive(entryKey);
      return true;
    }
    if (!entry) {
      return false;
    }
    const sources = existingSources ?? this.#createSources(entryKey);
    const existing = sources.renderBySectionId.get(sectionId);
    if (existing?.error === error) {
      return false;
    }
    sources.renderBySectionId.set(sectionId, {
      error,
      resource: {
        entry,
        failure: {
          kind: "error",
          message: error.message,
          reason: "internal",
          retryable: false,
        },
        kind: "error",
      },
    });
    this.#entryKeyBySectionId.set(sectionId, entryKey);
    this.#reconcileActive(entryKey);
    return true;
  }

  #activeFailure(sources: FailureSources): ReviewFailedResource | null {
    return (
      sources.document ??
      sources.refresh ??
      sources.renderBySectionId.values().next().value?.resource ??
      null
    );
  }

  #createSources(entryKey: string): FailureSources {
    const sources: FailureSources = {
      document: null,
      refresh: null,
      renderBySectionId: new Map(),
    };
    this.#sourcesByEntryKey.set(entryKey, sources);
    return sources;
  }

  #reconcileActive(entryKey: string): void {
    const previous = this.#activeByEntryKey.get(entryKey);
    const sources = this.#sourcesByEntryKey.get(entryKey);
    const next = sources ? this.#activeFailure(sources) : null;
    if (previous === next) {
      return;
    }
    if (next) {
      this.#activeByEntryKey.set(entryKey, next);
    } else {
      this.#activeByEntryKey.delete(entryKey);
    }
  }

  #removeEmptySources(entryKey: string, sources: FailureSources): void {
    if (
      sources.document === null &&
      sources.refresh === null &&
      sources.renderBySectionId.size === 0
    ) {
      this.#sourcesByEntryKey.delete(entryKey);
    }
  }

  #sourcesForChange(change: ReviewFailureChange): FailureSources | null {
    const sources = this.#sourcesByEntryKey.get(change.entryKey);
    if (sources) {
      return sources;
    }
    return change.resource === null
      ? null
      : this.#createSources(change.entryKey);
  }
}

function sameFailureSummary(
  left: ReviewFailureSummary,
  right: ReviewFailureSummary
): boolean {
  if (
    left.hasHiddenFailures !== right.hasHiddenFailures ||
    left.visibleFailures.length !== right.visibleFailures.length
  ) {
    return false;
  }
  return left.visibleFailures.every(
    (resource, index) => resource === right.visibleFailures[index]
  );
}

export function useReviewFailureSummary(options: {
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly selectedEntryKey: string | null;
}): {
  readonly applyGenerationChanges: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  readonly resetGenerationFailures: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  readonly summary: ReviewFailureSummary;
  readonly updateRenderItemError: (
    generation: number,
    id: string,
    error: Error | null
  ) => void;
} {
  const accumulatorRef = useRef(new GitReviewFailureAccumulator());
  const currentGenerationRef = useRef(0);
  const entryByKey = useMemo(
    () => new Map(options.entries.map((entry) => [entry.entryKey, entry])),
    [options.entries]
  );
  const entryByKeyRef = useRef(entryByKey);
  const lastSummaryRef = useRef(EMPTY_FAILURE_SUMMARY);
  const mountedRef = useRef(true);
  const publishScheduledRef = useRef(false);
  const selectedEntryKeyRef = useRef(options.selectedEntryKey);
  const [, setDisplayRevision] = useState(0);
  useLayoutEffect(() => {
    entryByKeyRef.current = entryByKey;
    selectedEntryKeyRef.current = options.selectedEntryKey;
  }, [entryByKey, options.selectedEntryKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const schedulePublish = useCallback(() => {
    if (publishScheduledRef.current) {
      return;
    }
    publishScheduledRef.current = true;
    queueMicrotask(() => {
      publishScheduledRef.current = false;
      if (!mountedRef.current) {
        return;
      }
      const next = accumulatorRef.current.summary(selectedEntryKeyRef.current);
      if (sameFailureSummary(lastSummaryRef.current, next)) {
        return;
      }
      lastSummaryRef.current = next;
      setDisplayRevision((revision) => revision + 1);
    });
  }, []);

  const applyGenerationChanges = useCallback(
    (generation: number, changes: readonly ReviewFailureChange[]) => {
      if (
        generation === currentGenerationRef.current &&
        accumulatorRef.current.applyGenerationChanges(changes)
      ) {
        schedulePublish();
      }
    },
    [schedulePublish]
  );
  const resetGenerationFailures = useCallback(
    (generation: number, changes: readonly ReviewFailureChange[]) => {
      currentGenerationRef.current = generation;
      accumulatorRef.current.reset(changes);
      schedulePublish();
    },
    [schedulePublish]
  );
  const updateRenderItemError = useCallback(
    (generation: number, id: string, error: Error | null) => {
      if (generation !== currentGenerationRef.current) {
        return;
      }
      const entryKey =
        options.entryKeyBySectionIdRef.current.get(id) ?? undefined;
      const entry = entryKey ? entryByKeyRef.current.get(entryKey) : undefined;
      if (accumulatorRef.current.updateRenderError(id, error, entry)) {
        schedulePublish();
      }
    },
    [options.entryKeyBySectionIdRef, schedulePublish]
  );
  const summary = accumulatorRef.current.summary(options.selectedEntryKey);
  useLayoutEffect(() => {
    lastSummaryRef.current = summary;
  }, [summary]);
  return {
    applyGenerationChanges,
    resetGenerationFailures,
    summary,
    updateRenderItemError,
  };
}
