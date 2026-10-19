import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type ReactNode, useEffect, useState } from "react";
import type { FilesTranslate } from "../i18n.ts";
import { MarkdownDiagram } from "../markdown/diagram.tsx";

/**
 * File-level Mermaid preview. Reuses the Markdown fenced-diagram surface so
 * `.mermaid` files share the same renderer, paper tokens, fullscreen host, and
 * failure state as inline diagrams.
 */
export function FileMermaidPreview({
  context,
  loading = false,
  name,
  source,
  t,
}: {
  context: Pick<
    RendererPluginContext,
    "appearance" | "charts" | "contentPreview"
  >;
  /** Document is still loading; an empty buffer is not an empty file yet. */
  loading?: boolean | undefined;
  name: string;
  source: string;
  t: FilesTranslate;
}) {
  const [appearance, setAppearance] = useState(() =>
    context.appearance.current()
  );
  useEffect(
    () => context.appearance.onDidChange(setAppearance),
    [context.appearance]
  );

  const label = t("filePanel.markdown.diagramLabel", "Mermaid diagram");
  const empty = source.trim().length === 0;

  let content: ReactNode;
  if (loading) {
    content = <Skeleton className="h-48 w-full rounded-md" />;
  } else if (empty) {
    content = (
      <div className="grid min-h-48 place-items-center px-6 text-center text-muted-foreground text-sm">
        {t(
          "filePanel.mermaid.empty",
          "This Mermaid file is empty. Write diagram syntax in the source view, then switch back to preview."
        )}
      </div>
    );
  } else {
    content = (
      <MarkdownDiagram
        capHeight={false}
        charts={context.charts}
        colorMode={appearance.theme}
        contentPreview={context.contentPreview}
        errorLabel={t(
          "filePanel.mermaid.renderFailed",
          "Unable to render this diagram. Check the Mermaid syntax and try again."
        )}
        label={label}
        openFullscreenLabel={t(
          "filePanel.markdown.openFullscreen",
          "View fullscreen"
        )}
        previewTitle={name}
        source={source}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background p-6">
      <div className="mx-auto w-full min-w-0">{content}</div>
    </div>
  );
}
