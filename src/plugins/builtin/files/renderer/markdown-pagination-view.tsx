import { type ReactNode, useEffect, useRef, useState } from "react";
import type {
  MarkdownPagination,
  MarkdownSemanticPage,
} from "./markdown/markdown-runtime.ts";

export function MarkdownPaginationView({
  activeSearchMatchId,
  activeSearchPageIndex,
  initialAnchor,
  initialAnchorRequestId,
  pagination,
  renderPage,
}: {
  activeSearchMatchId: string | undefined;
  activeSearchPageIndex: number | undefined;
  initialAnchor: string | undefined;
  initialAnchorRequestId: string | undefined;
  pagination: MarkdownPagination;
  renderPage: (
    page: MarkdownSemanticPage,
    onOpenAnchor: (anchor: string) => void
  ) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [forcedPages, setForcedPages] = useState<ReadonlySet<number>>(
    () => new Set([0])
  );
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const openAnchor = (encodedAnchor: string) => {
    const anchor = decodeMarkdownAnchor(encodedAnchor);
    if (anchor === null) return;
    const pageIndex = findAnchorPage(pagination, anchor);
    if (pageIndex !== null) {
      setForcedPages((current) => new Set(current).add(pageIndex));
    }
    setPendingAnchor(anchor);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: request id intentionally retriggers an unchanged anchor.
  useEffect(() => {
    const next = new Set<number>([0]);
    if (initialAnchor) {
      const anchor = decodeMarkdownAnchor(initialAnchor);
      if (anchor !== null) {
        const pageIndex = findAnchorPage(pagination, anchor);
        if (pageIndex !== null) next.add(pageIndex);
        setPendingAnchor(anchor);
      }
    }
    setForcedPages(next);
  }, [initialAnchor, initialAnchorRequestId, pagination]);

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

  return (
    <div
      className="flex flex-col gap-6"
      data-slot="markdown-document"
      ref={rootRef}
    >
      {pagination.pages.map((page) => (
        <LazyMarkdownPage
          force={
            forcedPages.has(page.index) || activeSearchPageIndex === page.index
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
