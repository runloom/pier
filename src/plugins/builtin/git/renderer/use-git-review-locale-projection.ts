import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import type { GitReviewDocumentGeneration } from "./git-review-document-generation.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  projectReviewDocuments,
  type ReviewDocumentProjection,
} from "./git-review-document-projection.ts";

export function useGitReviewLocaleProjection({
  context,
  controllerRef,
  loaderRef,
  locale,
  recordLatestItemUpdates,
  projectedLocaleRef,
  setProjection,
}: {
  readonly context: RendererPluginContext;
  readonly controllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly locale: string;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly projectedLocaleRef: RefObject<string>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
}): void {
  useEffect(() => {
    if (projectedLocaleRef.current === locale) {
      return;
    }
    const controller = controllerRef.current;
    const loader = loaderRef.current;
    if (!(controller && loader)) {
      return;
    }
    // 禁止读 UI viewState：完整 resources 只在 controller。
    const snapshot = controller.snapshot(loader.getRetainedEntryKeys());
    if (snapshot.resources.length === 0) {
      return;
    }
    projectedLocaleRef.current = locale;
    const localized = projectReviewDocuments(snapshot, context, locale);
    recordLatestItemUpdates(localized.items);
    setProjection(localized);
  }, [
    context,
    controllerRef,
    loaderRef,
    locale,
    recordLatestItemUpdates,
    projectedLocaleRef,
    setProjection,
  ]);
}
