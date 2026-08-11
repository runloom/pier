import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FILES_IN_FILE_SEARCH_BAR_CLASSNAME,
  FilesSearchBar,
} from "../search/bar.tsx";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import {
  captureMarkdownPreviewAnchor,
  type MarkdownCrossModeAnchor,
} from "./cross-mode-anchor.ts";
import {
  type MarkdownDiskSource,
  type MarkdownFileResources,
  type MarkdownInternalTarget,
  MarkdownIrRenderer,
  type MarkdownRendererLabels,
} from "./ir-renderer.tsx";
import {
  MarkdownPreviewArticleLayout,
  MarkdownPreviewOverlayRail,
  useMarkdownOutlineLayout,
} from "./preview-article-layout.tsx";
import {
  FALLBACK_DARK_CODE_THEME,
  resolvePreviewCodeTheme,
} from "./preview-code-theme.ts";
import {
  DEFAULT_MARKDOWN_COMMENT_LABELS,
  type MarkdownPreviewCommentLabels,
  useMarkdownPreviewCommentsLayer,
} from "./preview-comments-layer.tsx";
import {
  DEFAULT_RENDERER_LABELS,
  DEFAULT_TOC_LABELS,
  DEFAULT_ZOOM_LABELS,
  EMPTY_HEADING_IDS,
  type MarkdownPreviewTocLabels,
  type MarkdownPreviewZoomLabels,
} from "./preview-defaults.ts";
import { MarkdownPreviewFontScaleControl } from "./preview-font-scale.tsx";
import { useMarkdownPreviewPrefsStore } from "./preview-preferences.ts";
import {
  MarkdownPreviewToc,
  selectMarkdownProseContents,
  useMarkdownHeadingScrollSpy,
} from "./preview-toc.tsx";
import {
  MARKDOWN_PREVIEW_SCROLL_PAD_LEFT_PX,
  MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
  MARKDOWN_TOC_CONTENT_INSET_PX,
  MARKDOWN_TOC_INSET_PX,
} from "./preview-toc-layout.ts";
import { computeMarkdownReadingFontFamily } from "./reading-font.ts";
import {
  type MarkdownPagination,
  type MarkdownRuntime,
  markdownRuntime,
} from "./runtime.ts";
import {
  DEFAULT_MARKDOWN_PREVIEW_SEARCH_LABELS,
  type MarkdownPreviewSearchLabels,
  useMarkdownPreviewSearch,
} from "./use-preview-search.ts";
import { useMarkdownPreviewZoom } from "./use-preview-zoom.ts";
import "../markdown/prose.css";

export type { MarkdownPreviewCommentLabels } from "./preview-comments-layer.tsx";

interface MarkdownPreviewProps {
  appearance?: RendererPluginContext["appearance"] | undefined;
  /** Capture callback for preview → source switch; cleared when not ready. */
  captureAnchorRef?:
    | RefObject<(() => MarkdownCrossModeAnchor | null) | null>
    | undefined;
  charts?: RendererPluginContext["charts"] | undefined;
  codeHighlighter?: MarkdownCodeHighlighter | undefined;
  codeTheme?: string | undefined;
  commentLabels?: MarkdownPreviewCommentLabels | undefined;
  commentsContext?: RendererPluginContext | undefined;
  /** One-shot content restore after source → preview mode switch. */
  contentAnchor?: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId?: string | number | undefined;
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
  relativeCommentPath?: string | undefined;
  runtime?: MarkdownRuntime | undefined;
  searchLabels?: MarkdownPreviewSearchLabels | undefined;
  searchRequest?: number | undefined;
  sessionId: string;
  source?: MarkdownDiskSource | undefined;
  tocLabels?: MarkdownPreviewTocLabels | undefined;
  value: string;
  worktreeKey?: string | undefined;
  zoomLabels?: MarkdownPreviewZoomLabels | undefined;
}

type PreviewState =
  | { status: "loading" }
  | {
      document: import("./ir.ts").MarkdownIrDocument;
      pagination: MarkdownPagination;
      status: "ready";
    }
  | { status: "error" };

export { safeMarkdownUrl } from "./ir-renderer.tsx";
export { FILES_MARKDOWN_PREVIEW_SURFACE } from "./preview-preferences.ts";

export function MarkdownPreview({
  appearance,
  captureAnchorRef,
  charts,
  codeHighlighter,
  codeTheme,
  commentsContext,
  commentLabels = DEFAULT_MARKDOWN_COMMENT_LABELS,
  contentAnchor,
  contentAnchorRequestId,
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
  relativeCommentPath,
  registerSelectionSelectAllProvider,
  runtime = markdownRuntime,
  searchLabels = DEFAULT_MARKDOWN_PREVIEW_SEARCH_LABELS,
  searchRequest,
  sessionId,
  source,
  tocLabels = DEFAULT_TOC_LABELS,
  value,
  worktreeKey,
  zoomLabels = DEFAULT_ZOOM_LABELS,
}: MarkdownPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [appearanceCodeTheme, setAppearanceCodeTheme] = useState(
    () => appearance?.current().codeTheme ?? FALLBACK_DARK_CODE_THEME
  );
  const [appearanceTheme, setAppearanceTheme] = useState<
    "light" | "dark" | undefined
  >(() => appearance?.current().theme);
  const fontScale = useMarkdownPreviewPrefsStore((state) => state.fontScale);
  const measureMode = useMarkdownPreviewPrefsStore(
    (state) => state.measureMode
  );
  const readingAppearance = useMarkdownPreviewPrefsStore(
    (state) => state.readingAppearance
  );
  const readingFont = useMarkdownPreviewPrefsStore(
    (state) => state.readingFont
  );
  const readingFontFamily = useMarkdownPreviewPrefsStore(
    (state) => state.readingFontFamily
  );
  const resolvedCodeTheme = resolvePreviewCodeTheme({
    appearanceCodeTheme,
    appearanceTheme,
    codeTheme,
    readingAppearance,
  });
  // Mermaid / paper-coupled surfaces: fixed reading paper overrides app chrome.
  const previewColorMode: "dark" | "light" =
    readingAppearance === "auto"
      ? (appearanceTheme ?? "dark")
      : readingAppearance;
  const [tocAnchor, setTocAnchor] = useState<string | undefined>(undefined);
  const [tocAnchorRequestId, setTocAnchorRequestId] = useState(0);
  // 外部锚点导航（initialAnchorRequestId 变化）会清除 TOC 点击留下的 tocAnchor，
  // 否则 effectiveAnchor 被 tocAnchor 永久钉住，后续外部导航被静默丢弃。
  const previousInitialAnchorRequestIdRef = useRef(initialAnchorRequestId);
  useEffect(() => {
    if (initialAnchorRequestId !== previousInitialAnchorRequestIdRef.current) {
      previousInitialAnchorRequestIdRef.current = initialAnchorRequestId;
      setTocAnchor(undefined);
    }
  }, [initialAnchorRequestId]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const revisionRef = useRef(0);
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
  const search = useMarkdownPreviewSearch({
    labels: searchLabels,
    pagination: state.status === "ready" ? state.pagination : null,
    scrollRoot,
    searchRequest,
    surfaceRef: rootRef,
  });
  const effectiveAnchor = tocAnchor ?? initialAnchor;
  const effectiveAnchorRequestId = tocAnchor
    ? String(tocAnchorRequestId)
    : initialAnchorRequestId;
  const {
    applyFontScale,
    handlePreviewKeyDown: handleZoomKeyDown,
    handlePreviewWheel,
  } = useMarkdownPreviewZoom(fontScale);

  const { commentsChrome, driftStrip } = useMarkdownPreviewCommentsLayer({
    commentLabels,
    commentsContext,
    document: state.status === "ready" ? state.document : undefined,
    relativeCommentPath,
    worktreeKey,
  });

  useEffect(() => {
    let active = true;
    revisionRef.current += 1;
    const revision = `${sessionId}:${revisionRef.current}`;
    // Same-document live updates (disk reload / buffer change): keep the
    // previous ready render while the newer revision parses. First paint and
    // document identity remounts (see adapter key={documentId}) use skeleton.
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" }
    );
    runtime
      .parse({ revision, sessionId, source: value })
      .then((outcome) => {
        if (!(active && outcome.revision === revision)) return;
        if (outcome.status === "parsed") {
          setState({
            document: outcome.document,
            pagination: outcome.pagination,
            status: "ready",
          });
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
    const current = appearance.current();
    setAppearanceCodeTheme(current.codeTheme);
    setAppearanceTheme(current.theme);
    return appearance.onDidChange((next) => {
      setAppearanceCodeTheme(next.codeTheme);
      setAppearanceTheme(next.theme);
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
    if (!captureAnchorRef) return;
    if (state.status === "ready" && scrollRoot) {
      captureAnchorRef.current = () => captureMarkdownPreviewAnchor(scrollRoot);
    } else {
      captureAnchorRef.current = null;
    }
    return () => {
      if (captureAnchorRef.current) {
        captureAnchorRef.current = null;
      }
    };
  }, [captureAnchorRef, scrollRoot, state.status]);

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
      data-reading-appearance={
        readingAppearance === "auto" ? undefined : readingAppearance
      }
      data-slot="markdown-preview-root"
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        handleZoomKeyDown(event, search.handlePreviewKeyDown);
      }}
      onPointerDown={search.handlePreviewPointerDown}
      onWheel={handlePreviewWheel}
      ref={rootRef}
    >
      {search.searchOpen ? (
        <FilesSearchBar
          className={FILES_IN_FILE_SEARCH_BAR_CLASSNAME}
          focusSignal={search.searchFocusSignal}
          labels={searchLabels}
          matchAnnouncement={
            search.searchMatches.length === 0
              ? searchLabels.noMatches
              : searchLabels.matchAnnouncement.replace(
                  "{{count}}",
                  search.searchMatchText
                )
          }
          matchText={search.searchMatchText}
          navigationDisabled={search.searchMatches.length === 0}
          onChange={search.handleSearchChange}
          onClose={search.closeSearch}
          onNavigate={search.navigateSearch}
          // Clear the right tick rail when the outline is present so find and
          // outline chrome do not share the same top-right strip.
          {...(hasOutline
            ? { style: { right: MARKDOWN_TOC_CONTENT_INSET_PX } }
            : {})}
          testId="files-markdown-search-bar"
          value={search.searchValue}
        />
      ) : null}
      <div
        className="group/preview relative flex min-h-0 min-w-0 flex-1 flex-col"
        ref={previewFrameRef}
      >
        <div
          className="min-h-0 flex-1 overflow-auto pb-6 outline-none"
          data-scrollbar="stable"
          data-slot="markdown-preview"
          ref={scrollRootRef}
          style={{
            paddingLeft: MARKDOWN_PREVIEW_SCROLL_PAD_LEFT_PX,
            // Keep wide (and narrow comfortable) prose clear of the right tick rail.
            paddingRight: hasOutline
              ? MARKDOWN_TOC_CONTENT_INSET_PX
              : MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
            paddingTop: MARKDOWN_TOC_INSET_PX,
          }}
          tabIndex={-1}
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
                data-reading-font={readingFont}
                data-slot="markdown-prose"
                style={
                  {
                    "--md-scale": String(fontScale),
                    ...(readingFont === "custom"
                      ? {
                          fontFamily:
                            computeMarkdownReadingFontFamily(readingFontFamily),
                        }
                      : {}),
                  } as CSSProperties
                }
              >
                {driftStrip}
                <MarkdownIrRenderer
                  activeSearchMatchId={search.activeSearchMatch?.id}
                  activeSearchPageIndex={search.activeSearchMatch?.pageIndex}
                  charts={charts}
                  codeHighlighter={codeHighlighter}
                  codeTheme={resolvedCodeTheme}
                  colorMode={previewColorMode}
                  {...(commentsChrome ? { comments: commentsChrome } : {})}
                  contentAnchor={contentAnchor}
                  contentAnchorRequestId={contentAnchorRequestId}
                  copyCode={copyCode}
                  fileResources={fileResources}
                  initialAnchor={effectiveAnchor}
                  initialAnchorRequestId={effectiveAnchorRequestId}
                  labels={labels}
                  onJumpToSource={onJumpToSource}
                  onOpenExternal={openExternal}
                  onOpenInternal={openInternal}
                  pagination={state.pagination}
                  scrollRoot={scrollRoot}
                  searchMatches={search.searchMatches}
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
          onChange={applyFontScale}
        />
      </div>
    </div>
  );
}
