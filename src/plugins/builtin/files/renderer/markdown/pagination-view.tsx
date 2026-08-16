import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  applyMarkdownPreviewAnchor,
  type MarkdownCrossModeAnchor,
  markdownPagesToForceForOffset,
} from "./cross-mode-anchor.ts";
import { scheduleMarkdownPreviewAnchorReflow } from "./cross-mode-anchor-reflow.ts";
import type { MarkdownPagination, MarkdownSemanticPage } from "./runtime.ts";

export function MarkdownPaginationView({
  activeSearchMatchId,
  activeSearchPageIndex,
  forceCommentPageIndex,
  contentAnchor,
  contentAnchorRequestId,
  initialAnchor,
  initialAnchorRequestId,
  pagination,
  renderPage,
  scrollRoot,
}: {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  /** Force-render pages 0..index so comment n/N can mount a lazy block. */
  forceCommentPageIndex: number | undefined;
  contentAnchor: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId: string | number | undefined;
  initialAnchor: string | undefined;
  initialAnchorRequestId: string | undefined;
  pagination: MarkdownPagination;
  renderPage: (
    page: MarkdownSemanticPage,
    onOpenAnchor: (anchor: string) => void
  ) => ReactNode;
  /** Preview scrollport used for content-anchor restore (mode switch). */
  scrollRoot: HTMLElement | null;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [forcedPages, setForcedPages] = useState<ReadonlySet<number>>(
    () => new Set([0])
  );
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [pendingContentAnchor, setPendingContentAnchor] =
    useState<MarkdownCrossModeAnchor | null>(null);
  const appliedContentRequestIdRef = useRef<string | number | null>(null);
  const contentReflowDisposeRef = useRef<(() => void) | null>(null);

  const openAnchor = (encodedAnchor: string) => {
    const anchor = decodeMarkdownAnchor(encodedAnchor);
    if (anchor === null) return;
    const pageIndex = findAnchorPage(pagination, anchor);
    if (pageIndex !== null) {
      setForcedPages((current) => {
        const next = new Set(current);
        for (let index = 0; index <= pageIndex; index += 1) {
          next.add(index);
        }
        return next;
      });
    }
    contentReflowDisposeRef.current?.();
    contentReflowDisposeRef.current = null;
    setPendingContentAnchor(null);
    setPendingAnchor(anchor);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: request id intentionally retriggers an unchanged anchor.
  useEffect(() => {
    const next = new Set<number>([0]);
    if (initialAnchor) {
      const anchor = decodeMarkdownAnchor(initialAnchor);
      if (anchor !== null) {
        const pageIndex = findAnchorPage(pagination, anchor);
        if (pageIndex !== null) {
          for (let index = 0; index <= pageIndex; index += 1) {
            next.add(index);
          }
        }
        contentReflowDisposeRef.current?.();
        contentReflowDisposeRef.current = null;
        setPendingContentAnchor(null);
        setPendingAnchor(anchor);
      }
    }
    setForcedPages(next);
  }, [initialAnchor, initialAnchorRequestId, pagination]);

  // One-shot mode-switch restore: only when request id changes (not every re-parse).
  useEffect(() => {
    if (
      !contentAnchor ||
      contentAnchorRequestId === undefined ||
      contentAnchorRequestId === null
    ) {
      return;
    }
    if (appliedContentRequestIdRef.current === contentAnchorRequestId) {
      return;
    }
    const pagesToForce = markdownPagesToForceForOffset(
      pagination.pages,
      contentAnchor.offset
    );
    setForcedPages((current) => {
      const next = new Set(current);
      for (const index of pagesToForce) {
        next.add(index);
      }
      return next;
    });
    setPendingAnchor(null);
    contentReflowDisposeRef.current?.();
    contentReflowDisposeRef.current = null;
    setPendingContentAnchor(contentAnchor);
  }, [contentAnchor, contentAnchorRequestId, pagination.pages]);

  useEffect(() => {
    if (!pendingAnchor) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const target = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("[id]") ?? []
      ).find((element) => element.id === pendingAnchor);
      if (target) {
        target.scrollIntoView?.({ block: "start" });
        setPendingAnchor(null);
      }
    });
    return () => {
      active = false;
    };
  }, [pendingAnchor]);

  useEffect(() => {
    if (!pendingContentAnchor) return;
    let active = true;
    let attempts = 0;
    const resolveRoot = () =>
      scrollRoot ??
      rootRef.current?.closest<HTMLElement>('[data-slot="markdown-preview"]');

    const tryApply = () => {
      if (!active) return;
      const root = resolveRoot();
      const documentRoot = rootRef.current;
      if (
        root &&
        documentRoot &&
        applyMarkdownPreviewAnchor(root, pendingContentAnchor)
      ) {
        if (contentAnchorRequestId !== undefined) {
          appliedContentRequestIdRef.current = contentAnchorRequestId;
        }
        setPendingContentAnchor(null);
        contentReflowDisposeRef.current?.();
        contentReflowDisposeRef.current = scheduleMarkdownPreviewAnchorReflow({
          anchor: pendingContentAnchor,
          isActive: () => active,
          observeRoot: documentRoot,
          scrollRoot: root,
        });
        return;
      }
      attempts += 1;
      if (attempts < 12) {
        requestAnimationFrame(tryApply);
      } else {
        setPendingContentAnchor(null);
      }
    };
    queueMicrotask(tryApply);
    return () => {
      active = false;
      contentReflowDisposeRef.current?.();
      contentReflowDisposeRef.current = null;
    };
  }, [contentAnchorRequestId, pendingContentAnchor, scrollRoot]);

  useEffect(() => {
    if (!activeSearchMatchId) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const target = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(
          "[data-search-match-id]"
        ) ?? []
      ).find(
        (element) => element.dataset.searchMatchId === activeSearchMatchId
      );
      target?.scrollIntoView?.({ block: "center" });
    });
    return () => {
      active = false;
    };
  }, [activeSearchMatchId]);

  useEffect(
    () => () => {
      contentReflowDisposeRef.current?.();
      contentReflowDisposeRef.current = null;
    },
    []
  );

  return (
    <div
      className="flex flex-col gap-6"
      data-slot="markdown-document"
      ref={rootRef}
    >
      {pagination.pages.map((page) => (
        <LazyMarkdownPage
          force={
            forcedPages.has(page.index) ||
            activeSearchPageIndex === page.index ||
            (forceCommentPageIndex !== undefined &&
              page.index <= forceCommentPageIndex)
          }
          key={page.id}
          page={page}
          render={() => renderPage(page, openAnchor)}
        />
      ))}
    </div>
  );
}

function LazyMarkdownPage({
  force,
  page,
  render,
}: {
  force: boolean;
  page: MarkdownSemanticPage;
  render: () => ReactNode;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [rendered, setRendered] = useState(
    force || typeof IntersectionObserver === "undefined"
  );
  const shouldRender = rendered || force;

  useEffect(() => {
    if (force) {
      setRendered(true);
    }
  }, [force]);

  useEffect(() => {
    const root = rootRef.current;
    if (shouldRender || !root || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRendered(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [shouldRender]);
  const estimatedHeight = Math.min(
    1600,
    Math.max(96, (page.range.endLine - page.range.startLine + 1) * 22)
  );
  return (
    <section
      data-slot="markdown-page"
      id={page.id}
      ref={rootRef}
      style={shouldRender ? undefined : { minHeight: estimatedHeight }}
    >
      {shouldRender ? render() : null}
    </section>
  );
}

function decodeMarkdownAnchor(encodedAnchor: string): string | null {
  try {
    return decodeURIComponent(encodedAnchor);
  } catch {
    return null;
  }
}

function findAnchorPage(
  pagination: MarkdownPagination,
  anchor: string
): number | null {
  const headingPage = Reflect.get(pagination.pageByHeadingId, anchor);
  if (typeof headingPage === "number") return headingPage;
  for (const page of pagination.pages) {
    if (
      page.blocks.some(
        (block) =>
          block.kind === "footnoteDefinition" &&
          `footnote-${block.identifier}` === anchor
      )
    ) {
      return page.index;
    }
  }
  return null;
}
