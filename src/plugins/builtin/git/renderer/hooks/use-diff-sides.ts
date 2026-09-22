import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import { type RefObject, useCallback, useRef } from "react";
import { pluginText } from "../plugin-text.ts";
import { loadReviewFileDocument } from "../review/document/excerpt-client.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";

export type ReviewDiffSidesOutcome = "accepted" | "failed";

/**
 * Collapsed unmodified lines stay partial until this read attaches both
 * sides for the painted index revision.
 */
export function useReviewDiffSides(options: {
  readonly context: RendererPluginContext;
  readonly documentGenerationRef: RefObject<number>;
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly indexRevision: string | null;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly scope: GitReviewScope;
}): (sectionId: string) => Promise<ReviewDiffSidesOutcome> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const inflightRef = useRef(new Set<string>());

  return useCallback(async (sectionId: string) => {
    const current = optionsRef.current;
    const loader = current.loaderRef.current;
    const { indexRevision } = current;
    if (loader === null || indexRevision === null) {
      return "failed";
    }
    const entryKey = current.entryKeyBySectionIdRef.current.get(sectionId);
    const entry = current.entries.find((item) => item.entryKey === entryKey);
    if (entryKey === undefined || entry === undefined) {
      return "failed";
    }
    if (inflightRef.current.has(entryKey)) {
      return "accepted";
    }
    const loaded = loader.getResource(entryKey);
    if (loaded?.kind === "loaded" && !documentNeedsDiffSides(loaded.document)) {
      return "accepted";
    }
    inflightRef.current.add(entryKey);
    const generation = current.documentGenerationRef.current;
    try {
      const previous =
        loaded?.kind === "loaded" ? new Map([[entryKey, loaded]]) : new Map();
      const result = await loadReviewFileDocument(
        current.context,
        current.scope,
        previous,
        entry,
        crypto.randomUUID(),
        indexRevision,
        true
      );
      if (
        current.loaderRef.current !== loader ||
        current.documentGenerationRef.current !== generation
      ) {
        return "failed";
      }
      if (result.kind === "ok") {
        return loader.replaceLoadedDocument(entryKey, result)
          ? "accepted"
          : "failed";
      }
      if (result.kind === "unchanged") {
        return "accepted";
      }
      if (result.reason !== "staleRevision" && result.reason !== "indexMoved") {
        current.context.notifications.error(
          pluginText(
            current.context,
            "reviewDocumentLoadFailed",
            "Unable to load this change"
          )
        );
      }
      return "failed";
    } catch {
      if (
        current.loaderRef.current === loader &&
        current.documentGenerationRef.current === generation
      ) {
        current.context.notifications.error(
          pluginText(
            current.context,
            "reviewDocumentLoadFailed",
            "Unable to load this change"
          )
        );
      }
      return "failed";
    } finally {
      inflightRef.current.delete(entryKey);
    }
  }, []);
}

function documentNeedsDiffSides(document: GitReviewFileDocumentOk): boolean {
  return document.sections.some(
    (section) =>
      section.kind === "patch" &&
      (section.oldContents === undefined || section.newContents === undefined)
  );
}
