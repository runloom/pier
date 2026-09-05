import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { type CSSProperties, useMemo } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { markdownCodeHighlighter } from "../../markdown/code-highlighter.ts";
import type { MarkdownBlock } from "../../markdown/ir.ts";
import type { MarkdownRenderContext } from "../../markdown/ir-inlines.tsx";
import { renderMarkdownBlock } from "../../markdown/ir-renderer.tsx";
import {
  resolvePreviewCodeTheme,
  resolvePreviewCodeThemeRegistration,
} from "../../markdown/preview-code-theme.ts";
import { useMarkdownPreviewPrefsStore } from "../../markdown/preview-preferences.ts";
import type {
  MarkdownDiskSource,
  MarkdownInternalTarget,
} from "../../markdown/resource-elements.tsx";
import { openMarkdownInternal } from "../../panel/markdown/navigation.ts";
import { createMarkdownRendererLabels } from "../../panel/markdown-labels.ts";
import type { MarkdownDiffDocuments } from "./documents.ts";
import type { MarkdownDiffModel } from "./model.ts";
import "../../markdown/prose.css";
import "./styles.css";

export function MarkdownDiffView({
  documents,
  model,
  appearance,
  context,
  panelContext,
  source,
  t,
}: {
  documents: MarkdownDiffDocuments;
  model: MarkdownDiffModel;
  appearance: RendererPluginAppearance;
  context: RendererPluginContext;
  panelContext: PanelContext | undefined;
  source: MarkdownDiskSource | undefined;
  t: FilesTranslate;
}) {
  const fontScale = useMarkdownPreviewPrefsStore((state) => state.fontScale);
  const measureMode = useMarkdownPreviewPrefsStore(
    (state) => state.measureMode
  );
  const readingAppearance = useMarkdownPreviewPrefsStore(
    (state) => state.readingAppearance
  );
  const codeWrap = useMarkdownPreviewPrefsStore((state) => state.codeWrap);
  const imageAttributes = model.attributes.filter(
    (attribute) => attribute.kind === "image"
  );
  const markers = {
    added: { symbol: "+", label: t("filePanel.changes.added", "Added") },
    deleted: { symbol: "−", label: t("filePanel.changes.removed", "Deleted") },
    modified: {
      symbol: "±",
      label: t("filePanel.changes.modified", "Modified"),
    },
  };
  const contexts = useMemo(() => {
    const themeOptions = {
      appearanceCodeTheme: appearance.codeTheme,
      appearanceCodeThemeRegistration: appearance.codeThemeRegistration,
      appearanceTheme: appearance.theme,
      codeTheme: undefined,
      readingAppearance,
    };
    const linkFailed = () =>
      context.notifications.error(
        t(
          "filePanel.changes.linkUnavailable",
          "Couldn't open this link. Open the file from the file tree."
        )
      );
    const openTarget = (target: MarkdownInternalTarget) => {
      if (
        !(
          source &&
          openMarkdownInternal({
            context,
            root: source.root,
            target,
            panelContext,
          }).kind === "opened"
        )
      )
        linkFailed();
    };
    const create = (side: "before" | "after"): MarkdownRenderContext => {
      const document = documents[side];
      const footnoteDefinitions = new Map<string, MarkdownBlock[]>();
      for (const block of document.blocks)
        if (block.kind === "footnoteDefinition")
          footnoteDefinitions.set(block.identifier, block.blocks);
      return {
        activeSearchMatchId: undefined,
        activeSearchPageIndex: undefined,
        appletsEnabled: false,
        charts: context.charts,
        codeHighlighter: markdownCodeHighlighter,
        codeTheme: resolvePreviewCodeTheme(themeOptions),
        codeThemeRegistration:
          resolvePreviewCodeThemeRegistration(themeOptions),
        colorMode:
          readingAppearance === "auto" ? appearance.theme : readingAppearance,
        copyAnchor: undefined,
        copyCode: async (code) => {
          try {
            await navigator.clipboard.writeText(code);
          } catch (error) {
            await context.dialogs.alert({
              title: t(
                "filePanel.editor.clipboardFailed",
                "Clipboard unavailable"
              ),
              body: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
        // The baseline API contains text, not versioned image bytes. Never read
        // current disk resources while rendering the HEAD side.
        fileResources:
          side === "after"
            ? {
                files: context.files,
                filePreviews: context.filePreviews,
                contentPreview: context.contentPreview,
              }
            : undefined,
        footnoteDefinitions,
        headings: document.headings,
        labels: createMarkdownRendererLabels(t),
        linkChangeLabels: {
          url: t("filePanel.changes.linkAddress", "Link address changed"),
          title: t("filePanel.changes.linkTitle", "Link title changed"),
          before: t("filePanel.changes.before", "Before"),
          after: t("filePanel.changes.after", "After"),
        },
        liveModules: undefined,
        onOpenAnchor: (anchor) => {
          if (source) openTarget({ path: source.path, fragment: anchor });
          else linkFailed();
        },
        onOpenExternal: async (url) => {
          try {
            const result = await context.externalNavigation.open(url);
            if (!result.opened) linkFailed();
          } catch (error) {
            await context.dialogs.alert({
              title: t(
                "filePanel.markdown.externalOpenFailed.title",
                "Unable to open link"
              ),
              body: error instanceof Error ? error.message : String(error),
            });
          }
        },
        onOpenInternal: side === "after" ? openTarget : undefined,
        readOnly: true,
        searchMatchesByNode: new Map(),
        source: side === "after" ? source : undefined,
        wordWrap: codeWrap,
      };
    };
    return { before: create("before"), after: create("after") };
  }, [
    appearance,
    context,
    documents,
    readingAppearance,
    codeWrap,
    source,
    t,
    panelContext,
  ]);
  return (
    <div
      className="bg-background text-foreground"
      data-reading-appearance={
        readingAppearance === "auto" ? undefined : readingAppearance
      }
      data-slot="markdown-change-preview"
    >
      <div
        className="markdown-prose mx-auto w-full min-w-0"
        data-measure={measureMode}
        data-reading-surface=""
        data-slot="markdown-prose"
        style={{ "--md-scale": String(fontScale) } as CSSProperties}
      >
        {model.blocks.map((entry) => (
          <div
            className="md-diff-block"
            data-diff-kind={entry.kind}
            key={`${entry.side}:${entry.block.range.startOffset}`}
          >
            <span
              aria-label={markers[entry.kind].label}
              className="md-diff-marker"
              role="img"
            >
              {markers[entry.kind].symbol}
            </span>
            <div className="min-w-0">
              {renderMarkdownBlock(entry.block, contexts[entry.side])}
            </div>
          </div>
        ))}
      </div>
      {imageAttributes.length ? (
        <dl className="md-diff-attributes">
          {imageAttributes.map((attribute) => (
            <div key={JSON.stringify(attribute)}>
              <dt>{t("filePanel.changes.imageDetails", "Image changes")}</dt>
              <dd>
                {attribute.before ? (
                  <del data-md-diff="deleted">{attribute.before}</del>
                ) : null}
                {attribute.after ? (
                  <ins data-md-diff="added">{attribute.after}</ins>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {model.hasHistoricalImages ? (
        <p className="md-diff-note">
          {t(
            "filePanel.changes.historicalImages",
            "Historical images aren't loaded. Check their addresses and descriptions in Source."
          )}
        </p>
      ) : null}
      {model.hasHtml ? (
        <p className="md-diff-note">
          {t(
            "filePanel.changes.htmlDetails",
            "Some HTML changes may not be visible here. Check Source for all changes."
          )}
        </p>
      ) : null}
    </div>
  );
}
