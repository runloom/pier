import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  findMarkdownSearchMatches,
  type MarkdownSearchMatch,
} from "./markdown-search.ts";

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
  openExternal: (url: string) => void;
  openInternal?: ((target: MarkdownInternalTarget) => void) | undefined;
  runtime?: MarkdownRuntime | undefined;
  searchLabels?: MarkdownPreviewSearchLabels | undefined;
  searchRequest?: number | undefined;
  sessionId: string;
  source?: MarkdownDiskSource | undefined;
  value: string;
}

interface MarkdownPreviewSearchLabels {
  close: string;
  next: string;
  noMatches: string;
  placeholder: string;
  previous: string;
}

type PreviewState =
  | { status: "loading" }
  | { pagination: MarkdownPagination; status: "ready" }
  | { status: "error" };

export { safeMarkdownUrl } from "./markdown-ir-renderer.tsx";

const DEFAULT_RENDERER_LABELS: MarkdownRendererLabels = {
  copiedCode: "Copied",
  copyCode: "Copy code",
  completedTask: "Completed task",
  diagramFailed: "Unable to render diagram",
  diagramLabel: "Mermaid diagram",
  incompleteTask: "Incomplete task",
};

const DEFAULT_SEARCH_LABELS: MarkdownPreviewSearchLabels = {
  close: "Close",
  next: "Next match",
  noMatches: "No matches",
  placeholder: "Find",
  previous: "Previous match",
};

const EMPTY_SEARCH_MATCHES: readonly MarkdownSearchMatch[] = [];

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
  openExternal,
  openInternal,
  runtime = markdownRuntime,
  searchLabels = DEFAULT_SEARCH_LABELS,
  searchRequest,
  sessionId,
  source,
  value,
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
  const activeSearchMatch = searchMatches[activeSearchIndex];
  const searchMatchText = (() => {
    if (!searchValue) return "";
    if (deferredSearchValue !== searchValue) return "";
    if (searchMatches.length === 0) return searchLabels.noMatches;
    return `${activeSearchIndex + 1}/${searchMatches.length}`;
  })();
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

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background text-foreground text-sm">
      {searchOpen ? (
        <FilesSearchBar
          className="absolute top-2 right-3 z-20 max-w-[calc(100%-1.5rem)]"
          focusSignal={searchFocusSignal}
          labels={searchLabels}
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
        className="h-full overflow-auto p-4"
        data-scrollbar="stable"
        data-slot="markdown-preview"
        ref={rootRef}
      >
        {state.status === "loading" ? (
          <div className="flex flex-col gap-3" data-slot="markdown-loading">
            <Skeleton className="h-8 w-1/3 rounded-md" />
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-28 w-full rounded-md" />
          </div>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive">
            <AlertDescription>{errorLabel}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "ready" ? (
          <MarkdownIrRenderer
            activeSearchMatchId={activeSearchMatch?.id}
            activeSearchPageIndex={activeSearchMatch?.pageIndex}
            charts={charts}
            codeHighlighter={codeHighlighter}
            codeTheme={codeTheme ?? appearanceCodeTheme}
            copyCode={copyCode}
            fileResources={fileResources}
            initialAnchor={initialAnchor}
            initialAnchorRequestId={initialAnchorRequestId}
            labels={labels}
            onOpenExternal={openExternal}
            onOpenInternal={openInternal}
            pagination={state.pagination}
            searchMatches={searchMatches}
            source={source}
          />
        ) : null}
      </div>
    </div>
  );
}
