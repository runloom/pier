import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git-review.ts";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReviewDocumentProjection } from "./git-review-document-projection.ts";
import type { GitReviewDocumentLoaderSnapshot } from "./git-review-document-resource.ts";
import {
  patchReviewSession,
  readReviewSession,
} from "./git-review-session-cache.ts";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

export const EMPTY_REVIEW_PROJECTION: ReviewDocumentProjection = {
  entryKeyBySectionId: new Map(),
  items: [],
};

export const EMPTY_LOADER_SNAPSHOT: GitReviewDocumentLoaderSnapshot = {
  resources: [],
  retainedEntryKeys: [],
  settled: false,
};

export interface ReviewViewOptions {
  readonly diffStyle: "split" | "unified";
  readonly wrapLines: boolean;
}

const REVIEW_VIEW_OPTIONS_KEY = "pier.git.review.viewOptions";
const DEFAULT_REVIEW_VIEW_OPTIONS: ReviewViewOptions = {
  diffStyle: "split",
  wrapLines: false,
};

function viewOptionsStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readReviewViewOptions(): ReviewViewOptions {
  try {
    const raw = viewOptionsStorage()?.getItem(REVIEW_VIEW_OPTIONS_KEY);
    if (!raw) {
      return DEFAULT_REVIEW_VIEW_OPTIONS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_REVIEW_VIEW_OPTIONS;
    }
    const candidate = parsed as Partial<ReviewViewOptions>;
    return {
      diffStyle: candidate.diffStyle === "unified" ? "unified" : "split",
      wrapLines: candidate.wrapLines === true,
    };
  } catch {
    return DEFAULT_REVIEW_VIEW_OPTIONS;
  }
}

/** diff 展示偏好(split/unified、wrap);全局持久化,跨面板共享。 */
export function useReviewViewOptions(): {
  readonly options: ReviewViewOptions;
  readonly setOptions: (patch: Partial<ReviewViewOptions>) => void;
} {
  const [options, setOptionsState] = useState(readReviewViewOptions);
  const setOptions = useMemo(
    () => (patch: Partial<ReviewViewOptions>) => {
      setOptionsState((previous) => {
        const next = { ...previous, ...patch };
        try {
          viewOptionsStorage()?.setItem(
            REVIEW_VIEW_OPTIONS_KEY,
            JSON.stringify(next)
          );
        } catch {
          // 存储不可用时仅保留会话内偏好
        }
        return next;
      });
    },
    []
  );
  return { options, setOptions };
}

export function useReviewAppearance(
  context: RendererPluginContext,
  enabled: boolean
): RendererPluginAppearance {
  const [appearance, setAppearance] = useState(() =>
    context.appearance.current()
  );
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setAppearance(context.appearance.current());
    return context.appearance.onDidChange(setAppearance);
  }, [context, enabled]);
  return appearance;
}

export function useReviewSelection(
  scope: GitReviewScope,
  treeModel: ReturnType<typeof gitReviewTreeModel>
): {
  readonly selectedEntryKey: string | null;
  readonly selectedSectionKey: string | null;
  readonly selectedTreeEntry: {
    readonly entry: GitReviewIndexEntry;
    readonly path: string;
    readonly sectionKey: string;
  } | null;
  readonly setSelectedEntryKey: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedSectionKey: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedTreeTarget: (
    target: {
      readonly entryKey: string;
      readonly sectionKey: string;
    } | null
  ) => void;
} {
  const sourceKey = JSON.stringify(scope);
  const session = readReviewSession(sourceKey);
  const [selectedEntryKey, setSelectedEntryKeyState] = useState<string | null>(
    () => session?.selectedEntryKey ?? null
  );
  const [selectedSectionKey, setSelectedSectionKeyState] = useState<
    string | null
  >(() => session?.selectedSectionKey ?? null);
  const scopeKeyRef = useRef(sourceKey);
  useEffect(() => {
    if (scopeKeyRef.current !== sourceKey) {
      scopeKeyRef.current = sourceKey;
      setSelectedEntryKeyState(null);
      setSelectedSectionKeyState(null);
    }
  }, [sourceKey]);
  const setSelectedEntryKey = useMemo(() => {
    const setWithSession: Dispatch<SetStateAction<string | null>> = (value) => {
      setSelectedEntryKeyState((previous) => {
        const next =
          typeof value === "function"
            ? (value as (prev: string | null) => string | null)(previous)
            : value;
        if (next !== previous) {
          patchReviewSession(sourceKey, { selectedEntryKey: next });
        }
        return next;
      });
    };
    return setWithSession;
  }, [sourceKey]);
  const setSelectedSectionKey = useMemo(() => {
    const setWithSession: Dispatch<SetStateAction<string | null>> = (value) => {
      setSelectedSectionKeyState((previous) => {
        const next =
          typeof value === "function"
            ? (value as (prev: string | null) => string | null)(previous)
            : value;
        if (next !== previous) {
          patchReviewSession(sourceKey, { selectedSectionKey: next });
        }
        return next;
      });
    };
    return setWithSession;
  }, [sourceKey]);
  const setSelectedTreeTarget = useCallback(
    (
      target: {
        readonly entryKey: string;
        readonly sectionKey: string;
      } | null
    ) => {
      if (target === null) {
        setSelectedEntryKey(null);
        setSelectedSectionKey(null);
        return;
      }
      setSelectedEntryKey(target.entryKey);
      setSelectedSectionKey(target.sectionKey);
    },
    [setSelectedEntryKey, setSelectedSectionKey]
  );
  const selectedTreeEntry = useMemo(() => {
    if (!(selectedEntryKey && selectedSectionKey)) {
      return null;
    }
    const entry = treeModel.entryByKey.get(selectedEntryKey);
    if (!entry) {
      return null;
    }
    for (const item of treeModel.items) {
      if (item.kind !== "file") {
        continue;
      }
      const fileRef = treeModel.getFileRefForTreePath(item.path);
      if (
        fileRef?.entryKey === selectedEntryKey &&
        fileRef.sectionKey === selectedSectionKey
      ) {
        return {
          entry,
          path: item.path,
          sectionKey: selectedSectionKey,
        };
      }
    }
    return null;
  }, [selectedEntryKey, selectedSectionKey, treeModel]);
  useEffect(() => {
    if ((selectedEntryKey || selectedSectionKey) && !selectedTreeEntry) {
      setSelectedTreeTarget(null);
    }
  }, [
    selectedEntryKey,
    selectedSectionKey,
    selectedTreeEntry,
    setSelectedTreeTarget,
  ]);
  return {
    selectedEntryKey,
    selectedSectionKey,
    selectedTreeEntry,
    setSelectedEntryKey,
    setSelectedSectionKey,
    setSelectedTreeTarget,
  };
}
