import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import type { GitReviewDocumentGeneration } from "../review/document/generation.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  projectReviewLedger,
  type ReviewDocumentProjection,
} from "../review/document/projection.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";

export function useGitReviewLocaleProjection({
  context,
  controllerRef,
  diffBase,
  entries,
  indexGeneration,
  loaderRef,
  locale,
  recordLatestItemUpdates,
  projectedLocaleRef,
  setProjection,
}: {
  readonly context: RendererPluginContext;
  readonly controllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly diffBase: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly indexGeneration: number;
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
    const snapshot = controller.snapshot(loader.getRetainedEntryKeys());
    projectedLocaleRef.current = locale;
    const resourceByEntryKey = new Map(
      snapshot.resources.map(
        (resource) => [resource.entry.entryKey, resource] as const
      )
    );
    // 仅重投影已在正文的 entry（loaded/error/loading），禁止 locale 切换灌全量 estimate 海
    const pendingEntryKeys = new Set(
      snapshot.resources
        .filter(
          (resource) =>
            resource.kind === "loaded" ||
            resource.kind === "error" ||
            resource.kind === "loading" ||
            resource.kind === "cancelling" ||
            resource.kind === "unchanged"
        )
        .map((resource) => resource.entry.entryKey)
    );
    const localized = projectReviewLedger({
      authoritativeEntryKeys: controller.authoritativeEntryKeys(),
      context,
      diffBase,
      entries,
      locale,
      pendingEntryKeys,
      resourceByEntryKey,
      sourceIndexGeneration: indexGeneration,
    });
    recordLatestItemUpdates(localized.items);
    setProjection(localized);
  }, [
    context,
    controllerRef,
    diffBase,
    entries,
    indexGeneration,
    loaderRef,
    locale,
    recordLatestItemUpdates,
    projectedLocaleRef,
    setProjection,
  ]);
}
