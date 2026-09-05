import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { Component, type ReactNode, useEffect, useMemo, useState } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import type { MarkdownDiskSource } from "../../markdown/resource-elements.tsx";
import type { FileChangeRange, FileChangesSnapshot } from "../types.ts";
import {
  loadMarkdownDiffDocuments,
  type MarkdownDiffDocuments,
} from "./documents.ts";
import { buildMarkdownDiff, type MarkdownDiffModel } from "./model.ts";
import { MarkdownDiffView } from "./view.tsx";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "source" }
  | {
      status: "ready";
      documents: MarkdownDiffDocuments;
      model: MarkdownDiffModel;
    };

// biome-ignore lint/style/useReactFunctionComponents: React error boundaries require a class lifecycle.
class RenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function MarkdownChangeContent({
  owner,
  snapshot,
  range,
  context,
  panelContext,
  appearance,
  height,
  fallback,
  t,
}: {
  owner: object;
  snapshot: FileChangesSnapshot;
  range: FileChangeRange;
  context: RendererPluginContext;
  panelContext: PanelContext | undefined;
  appearance: RendererPluginAppearance;
  height: number;
  fallback: ReactNode;
  t: FilesTranslate;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries failed parsing.
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadMarkdownDiffDocuments(owner, snapshot.baseline, snapshot.contents)
      .then((documents) => {
        if (!active) return;
        const model = buildMarkdownDiff({ ...documents, range });
        setState(
          model.blocks.length && !model.requiresSource
            ? { status: "ready", documents, model }
            : { status: "source" }
        );
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status:
              error instanceof Error &&
              error.message === "markdown-diff-too-large"
                ? "source"
                : "error",
          });
      });
    return () => {
      active = false;
    };
  }, [owner, snapshot.baseline, snapshot.contents, range, attempt]);
  const source = useMemo<MarkdownDiskSource | undefined>(
    () =>
      snapshot.gitRoot && snapshot.path
        ? { kind: "disk", root: snapshot.gitRoot, path: snapshot.path }
        : undefined,
    [snapshot.gitRoot, snapshot.path]
  );
  const sourceFallback = (
    <div
      className="overflow-auto overscroll-contain"
      data-scrollbar="overlay"
      style={{ maxHeight: height }}
    >
      <Alert layout="infobar">
        <AlertDescription>
          {state.status === "source"
            ? t(
                "filePanel.changes.sourceRequired",
                "This change needs the Source view to show all details."
              )
            : t(
                "filePanel.changes.previewUnavailable",
                "Preview unavailable. Showing source changes."
              )}{" "}
          {state.status === "source" ? null : (
            <Button
              onClick={() => setAttempt((value) => value + 1)}
              variant="link"
            >
              {t("filePanel.changes.retryPreview", "Retry preview")}
            </Button>
          )}
        </AlertDescription>
      </Alert>
      {fallback}
    </div>
  );
  if (state.status === "error" || state.status === "source")
    return sourceFallback;
  if (state.status === "loading")
    return (
      <div
        aria-label={t("filePanel.changes.loading", "Comparing changes…")}
        className="flex flex-col gap-3 p-4"
        role="status"
      >
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  return (
    <RenderBoundary fallback={sourceFallback} key={attempt}>
      <div
        className="overflow-auto overscroll-contain"
        data-scrollbar="overlay"
        data-slot="markdown-change-scroll"
        style={{ maxHeight: height }}
      >
        <MarkdownDiffView
          appearance={appearance}
          context={context}
          documents={state.documents}
          model={state.model}
          panelContext={panelContext}
          source={source}
          t={t}
        />
      </div>
    </RenderBoundary>
  );
}
