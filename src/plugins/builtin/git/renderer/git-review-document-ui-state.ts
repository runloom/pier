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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReviewDocumentProjection } from "./git-review-document-projection.ts";
import type { GitReviewDocumentLoaderSnapshot } from "./git-review-document-resource.ts";
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
  scope: Pick<GitReviewScope, "contextId" | "gitRootPath">,
  treeModel: ReturnType<typeof gitReviewTreeModel>
): {
  readonly selectedEntryKey: string | null;
  readonly selectedTreeEntry: {
    readonly entry: GitReviewIndexEntry;
    readonly path: string;
  } | null;
  readonly setSelectedEntryKey: Dispatch<SetStateAction<string | null>>;
} {
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  const scopeKey = JSON.stringify([scope.contextId, scope.gitRootPath]);
  const scopeKeyRef = useRef(scopeKey);
  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey;
      setSelectedEntryKey(null);
    }
  }, [scopeKey]);
  const selectedTreeEntry = useMemo(() => {
    if (!selectedEntryKey) {
      return null;
    }
    for (const [path, entry] of treeModel.entryByPath) {
      if (entry.entryKey === selectedEntryKey) {
        return { entry, path };
      }
    }
    return null;
  }, [selectedEntryKey, treeModel]);
  useEffect(() => {
    if (selectedEntryKey && !selectedTreeEntry) {
      setSelectedEntryKey(null);
    }
  }, [selectedEntryKey, selectedTreeEntry]);
  return { selectedEntryKey, selectedTreeEntry, setSelectedEntryKey };
}
