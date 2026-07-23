import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilesSearchBar } from "./files-search-bar.tsx";
import type { MarkdownCodeHighlighter } from "./markdown/markdown-code-highlighter.ts";
import {
  type MarkdownPagination,
  type MarkdownRuntime,
  markdownRuntime,
} from "./markdown/markdown-runtime.ts";
import {
  type MarkdownDiskSource,
  type MarkdownFileResources,
  type MarkdownInternalTarget,
  MarkdownIrRenderer,
  type MarkdownRendererLabels,
} from "./markdown-ir-renderer.tsx";
import {
  MarkdownPreviewArticleLayout,
  MarkdownPreviewOverlayRail,
  useMarkdownOutlineLayout,
} from "./markdown-preview-article-layout.tsx";
import { MarkdownPreviewFontScaleControl } from "./markdown-preview-font-scale.tsx";
import {
  useMarkdownPreviewPrefsStore,
  writeMarkdownFontScale,
} from "./markdown-preview-preferences.ts";
import {
  MarkdownPreviewToc,
  selectMarkdownProseContents,
  useMarkdownHeadingScrollSpy,
} from "./markdown-preview-toc.tsx";
import {
  MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
  MARKDOWN_TOC_CONTENT_INSET_PX,
  MARKDOWN_TOC_INSET_PX,
} from "./markdown-preview-toc-layout.ts";
import {
  findMarkdownSearchMatches,
  type MarkdownSearchMatch,
} from "./markdown-search.ts";
import "./markdown-prose.css";

interface MarkdownPreviewProps {
  appearance?: RendererPluginContext["appearance"] | undefined;
  charts?: RendererPluginContext["charts"] | undefined;
  codeHighlighter?: MarkdownCodeHighlighter | undefined;
  codeTheme?: string | undefined;
  copyCode?: ((code: string) => Promise<void>) | undefined;
  errorLabel?: string | undefined;
  fileResources?: MarkdownFileResources | undefined;
  initialAnchor?: string | undefined;
  initialAnchorRequestId?: string | undefined;
  labels?: MarkdownRendererLabels | undefined;
  onContextMenu?:
    | ((event: ReactMouseEvent<HTMLDivElement>) => void)
    | undefined;
  onJumpToSource?: ((offset: number) => void) | undefined;
  openExternal: (url: string) => void;
  openInternal?: ((target: MarkdownInternalTarget) => void) | undefined;
  /** Dockview panel instance id — used for select-all provider scope. */
  panelId?: string | undefined;
  registerSelectionSelectAllProvider?:
    | RendererPluginContext["contextMenu"]["registerSelectionSelectAllProvider"]
    | undefined;
  runtime?: MarkdownRuntime | undefined;
  searchLabels?: MarkdownPreviewSearchLabels | undefined;
  searchRequest?: number | undefined;
  sessionId: string;
  source?: MarkdownDiskSource | undefined;
  tocLabels?: MarkdownPreviewTocLabels | undefined;
  value: string;
  zoomLabels?: MarkdownPreviewZoomLabels | undefined;
}

interface MarkdownPreviewSearchLabels {
  close: string;
  matchAnnouncement: string;
  next: string;
  noMatches: string;
  placeholder: string;
  previous: string;
}

interface MarkdownPreviewTocLabels {
  title: string;
}

interface MarkdownPreviewZoomLabels {
  reset: string;
  zoomIn: string;
  zoomOut: string;
}

type PreviewState =
  | { status: "loading" }
  | { pagination: MarkdownPagination; status: "ready" }
  | { status: "error" };

export { safeMarkdownUrl } from "./markdown-ir-renderer.tsx";
export { FILES_MARKDOWN_PREVIEW_SURFACE } from "./markdown-preview-preferences.ts";

const DEFAULT_RENDERER_LABELS: MarkdownRendererLabels = {
  copiedCode: "Copied",
  copyCode: "Copy code",
  completedTask: "Completed task",
  diagramFailed: "Unable to render diagram",
  diagramLabel: "Mermaid diagram",
  diagramPreviewTitle: "Diagram preview",
  imagePreviewFailed: "Unable to open image preview",
  imagePreviewTitle: "Image",
  incompleteTask: "Incomplete task",
  openFullscreen: "View fullscreen",
};

const DEFAULT_SEARCH_LABELS: MarkdownPreviewSearchLabels = {
  close: "Close",
  matchAnnouncement: "Matches: {{count}}",
  next: "Next match",
  noMatches: "No matches",
  placeholder: "Find",
  previous: "Previous match",
};

const DEFAULT_TOC_LABELS: MarkdownPreviewTocLabels = {
  title: "Outline",
};

const DEFAULT_ZOOM_LABELS: MarkdownPreviewZoomLabels = {
  reset: "Reset text size",
  zoomIn: "Increase text size",
  zoomOut: "Decrease text size",
};

const EMPTY_SEARCH_MATCHES: readonly MarkdownSearchMatch[] = [];
const EMPTY_HEADING_IDS: readonly string[] = [];

export function MarkdownPreview({
  appearance,
  charts,
  codeHighlighter,
  codeTheme,
  copyCode,
  errorLabel = "Unable to render Markdown preview.",
  fileResources,
  labels = DEFAULT_RENDERER_LABELS,
  initialAnchor,
  initialAnchorRequestId,
  onContextMenu,
  onJumpToSource,
  openExternal,
  openInternal,
  panelId,
  registerSelectionSelectAllProvider,
  runtime = markdownRuntime,
  searchLabels = DEFAULT_SEARCH_LABELS,
  searchRequest,
  sessionId,
  source,
  tocLabels = DEFAULT_TOC_LABELS,
  value,
  zoomLabels = DEFAULT_ZOOM_LABELS,
}: MarkdownPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [appearanceCodeTheme, setAppearanceCodeTheme] = useState(
    () => appearance?.current().codeTheme ?? "github-dark"
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const fontScale = useMarkdownPreviewPrefsStore((state) => state.fontScale);
  const measureMode = useMarkdownPreviewPrefsStore(
    (state) => state.measureMode
  );
  const [tocAnchor, setTocAnchor] = useState<string | undefined>(undefined);
  const [tocAnchorRequestId, setTocAnchorRequestId] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handledSearchRequestRef = useRef(searchRequest);
  const revisionRef = useRef(0);
  const searchMatches = useMemo(
    () =>
      searchOpen &&
      deferredSearchValue &&
      deferredSearchValue === searchValue &&
      state.status === "ready"
        ? findMarkdownSearchMatches(state.pagination, deferredSearchValue)
        : EMPTY_SEARCH_MATCHES,
    [deferredSearchValue, searchOpen, searchValue, state]
  );
  const headings =
    state.status === "ready" ? state.pagination.headings : undefined;
  const headingIds = useMemo(
    () => headings?.map((heading) => heading.id) ?? EMPTY_HEADING_IDS,
    [headings]
  );
  const hasOutline = headings !== undefined && headings.length > 0;
  const {
    maxHeightPx: tocMaxHeightPx,
    panelWidthPx: tocPanelWidthPx,
    previewFrameRef,
    scrollRoot,
    scrollRootRef,
  } = useMarkdownOutlineLayout({
    fontScale,
    hasHeadings: hasOutline,
    ready: state.status === "ready",
  });
  const activeHeadingId = useMarkdownHeadingScrollSpy(scrollRoot, headingIds);
  const activeSearchMatch = searchMatches[activeSearchIndex];
  const searchMatchText = (() => {
    if (!searchValue) return "";
    if (deferredSearchValue !== searchValue) return "";
    if (searchMatches.length === 0) return searchLabels.noMatches;
    return `${activeSearchIndex + 1}/${searchMatches.length}`;
  })();
  const effectiveAnchor = tocAnchor ?? initialAnchor;
  const effectiveAnchorRequestId = tocAnchor
    ? String(tocAnchorRequestId)
    : initialAnchorRequestId;

  useEffect(() => {
    let active = true;
    revisionRef.current += 1;
    const revision = `${sessionId}:${revisionRef.current}`;
    setState({ status: "loading" });
    runtime
      .parse({ revision, sessionId, source: value })
      .then((outcome) => {
        if (!(active && outcome.revision === revision)) return;
        if (outcome.status === "parsed") {
          setState({ pagination: outcome.pagination, status: "ready" });
        } else if (outcome.status === "error") {
          setState({ status: "error" });
        }
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [runtime, sessionId, value]);

  useEffect(
    () => () => {
      runtime.closeSession(sessionId);
    },
    [runtime, sessionId]
  );

  useEffect(() => {
    if (!appearance) return;
    setAppearanceCodeTheme(appearance.current().codeTheme);
    return appearance.onDidChange((next) => {
      setAppearanceCodeTheme(next.codeTheme);
    });
  }, [appearance]);

  useEffect(() => {
    const root = rootRef.current;
    let intersecting = true;
    const updateVisibility = () => {
      runtime.setSessionVisible(
        sessionId,
        intersecting && document.visibilityState !== "hidden"
      );
    };
    const observer =
      root && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            intersecting = entries[0]?.isIntersecting ?? false;
            updateVisibility();
          })
        : null;
    if (root) observer?.observe(root);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      runtime.setSessionVisible(sessionId, false);
    };
  }, [runtime, sessionId]);

  useEffect(() => {
    if (!(panelId && registerSelectionSelectAllProvider)) return;
    return registerSelectionSelectAllProvider(panelId, () =>
      selectMarkdownProseContents(rootRef.current)
    );
  }, [panelId, registerSelectionSelectAllProvider]);

  useEffect(() => {
    if (handledSearchRequestRef.current === searchRequest) return;
    handledSearchRequestRef.current = searchRequest;
    if (searchRequest) {
      setSearchOpen(true);
      setSearchFocusSignal((current) => current + 1);
    }
  }, [searchRequest]);

  useEffect(() => {
    if (activeSearchIndex >= searchMatches.length) setActiveSearchIndex(0);
  }, [activeSearchIndex, searchMatches.length]);

  const navigateSearch = (direction: "next" | "previous") => {
    if (searchMatches.length === 0) return;
    setActiveSearchIndex((current) =>
      direction === "next"
        ? (current + 1) % searchMatches.length
        : (current - 1 + searchMatches.length) % searchMatches.length
    );
  };

  const outlineToc = hasOutline ? (
    <MarkdownPreviewToc
      activeHeadingId={activeHeadingId}
      headings={headings}
      labels={tocLabels}
      maxHeightPx={tocMaxHeightPx}
      onSelect={(headingId) => {
        setTocAnchor(headingId);
        setTocAnchorRequestId((current) => current + 1);
      }}
    />
  ) : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: markdown preview is a native context-menu surface with no accurate interactive ARIA role
    <div
      className="relative flex h-full min-h-0 overflow-hidden bg-background text-foreground text-sm"
      onContextMenu={onContextMenu}
      ref={rootRef}
    >
      {searchOpen ? (
        <FilesSearchBar
          className="absolute top-2 left-3 z-30 max-w-[calc(100%-1.5rem)]"
          focusSignal={searchFocusSignal}
          labels={searchLabels}
          matchAnnouncement={
            searchMatches.length === 0
              ? searchLabels.noMatches
              : searchLabels.matchAnnouncement.replace(
                  "{{count}}",
                  searchMatchText
                )
          }
          matchText={searchMatchText}
          navigationDisabled={searchMatches.length === 0}
          onChange={(next) => {
            setSearchValue(next);
            setActiveSearchIndex(0);
          }}
          onClose={() => setSearchOpen(false)}
          onNavigate={navigateSearch}
          testId="files-markdown-search-bar"
          value={searchValue}
        />
      ) : null}
      <div
        className="group/preview relative flex min-h-0 min-w-0 flex-1 flex-col"
        ref={previewFrameRef}
      >
        <div
          className="min-h-0 flex-1 overflow-auto pb-6"
          data-scrollbar="stable"
          data-slot="markdown-preview"
          ref={scrollRootRef}
          style={{
            paddingLeft: MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
            // Keep wide (and narrow comfortable) prose clear of the right tick rail.
            paddingRight: hasOutline
              ? MARKDOWN_TOC_CONTENT_INSET_PX
              : MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
            paddingTop: MARKDOWN_TOC_INSET_PX,
          }}
        >
          {state.status === "loading" ? (
            <div className="flex flex-col gap-3" data-slot="markdown-loading">
              <Skeleton className="h-8 w-1/3 rounded-md" />
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-4 w-4/5 rounded-md" />
              <Skeleton className="h-28 w-full rounded-md" />
            </div>
          ) : null}
          {state.status === "error" ? <ErrorEmpty title={errorLabel} /> : null}
          {state.status === "ready" ? (
            <MarkdownPreviewArticleLayout>
              <div
                className="markdown-prose mx-auto w-full min-w-0"
                data-measure={measureMode}
                data-slot="markdown-prose"
                style={
                  {
                    "--md-scale": String(fontScale),
                  } as CSSProperties
                }
              >
                <MarkdownIrRenderer
                  activeSearchMatchId={activeSearchMatch?.id}
                  activeSearchPageIndex={activeSearchMatch?.pageIndex}
                  charts={charts}
                  codeHighlighter={codeHighlighter}
                  codeTheme={codeTheme ?? appearanceCodeTheme}
                  copyCode={copyCode}
                  fileResources={fileResources}
                  initialAnchor={effectiveAnchor}
                  initialAnchorRequestId={effectiveAnchorRequestId}
                  labels={labels}
                  onJumpToSource={onJumpToSource}
                  onOpenExternal={openExternal}
                  onOpenInternal={openInternal}
                  pagination={state.pagination}
                  searchMatches={searchMatches}
                  source={source}
                />
              </div>
            </MarkdownPreviewArticleLayout>
          ) : null}
        </div>
        {outlineToc ? (
          <MarkdownPreviewOverlayRail
            maxHeightPx={tocMaxHeightPx}
            panelWidthPx={tocPanelWidthPx}
          >
            {outlineToc}
          </MarkdownPreviewOverlayRail>
        ) : null}
        <MarkdownPreviewFontScaleControl
          fontScale={fontScale}
          labels={zoomLabels}
          onChange={(next) => {
            writeMarkdownFontScale(next);
          }}
        />
      </div>
    </div>
  );
}

/** Expose heading presence for context-menu metadata without re-parsing. */
export function markdownPreviewHasHeadings(
  headings: readonly { id: string }[] | undefined
): boolean {
  return (headings?.length ?? 0) > 0;
}
