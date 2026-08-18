import { Button } from "@pier/ui/button.tsx";
import { scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginCodeThemeRegistration } from "@plugins/api/renderer.ts";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type MarkdownCodeHighlighter,
  type MarkdownCodeHighlightOutcome,
  markdownCodeHighlighter,
} from "./code-highlighter.ts";
import {
  MARKDOWN_CODE_BLOCK_MAX_HEIGHT_CLASS,
  useMarkdownPreviewPrefsStore,
} from "./preview-preferences.ts";
import { forwardWheelToMarkdownPreview } from "./scroll-handoff.ts";
import type { MarkdownSearchMatch } from "./search.ts";
import { MarkdownSearchText } from "./search-mark.tsx";

export interface MarkdownCodeBlockLabels {
  copiedCode: string;
  copyCode: string;
}

export function MarkdownCodeBlock({
  activeSearchMatchId,
  code,
  highlighter = markdownCodeHighlighter,
  labels,
  language,
  meta,
  onCopy,
  searchMatches,
  theme,
  themeRegistration,
}: {
  activeSearchMatchId?: string | undefined;
  code: string;
  highlighter?: MarkdownCodeHighlighter | undefined;
  labels: MarkdownCodeBlockLabels;
  language: string | null;
  meta: string | null;
  onCopy?: ((code: string) => Promise<void>) | undefined;
  searchMatches?: readonly MarkdownSearchMatch[] | undefined;
  theme: string;
  themeRegistration?: RendererPluginCodeThemeRegistration | undefined;
}) {
  const [highlight, setHighlight] = useState<MarkdownCodeHighlightOutcome>({
    status: "plain",
  });
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const blockHeightLimit = useMarkdownPreviewPrefsStore(
    (state) => state.blockHeightLimit
  );
  const heightCapped = blockHeightLimit === "capped";

  useEffect(() => {
    let active = true;
    setHighlight({ status: "plain" });
    highlighter
      .highlight({ code, language, theme, themeRegistration })
      .then((result) => {
        if (active) setHighlight(result);
      });
    return () => {
      active = false;
    };
  }, [code, highlighter, language, theme, themeRegistration]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    []
  );

  const copy = async () => {
    if (!onCopy) return;
    try {
      await onCopy(code);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="md-pre overflow-hidden rounded-md border bg-muted/20"
      data-slot="markdown-code-block"
    >
      <div className="flex h-8 items-center gap-2 border-b bg-muted/40 px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
          {language ?? "text"}
          {meta ? ` · ${meta}` : ""}
        </span>
        {onCopy ? (
          <Button
            aria-label={copied ? labels.copiedCode : labels.copyCode}
            onClick={copy}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <Check data-icon="inline-start" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
          </Button>
        ) : null}
      </div>
      <pre
        className={cn(
          "p-3 font-mono",
          heightCapped
            ? cn(
                MARKDOWN_CODE_BLOCK_MAX_HEIGHT_CLASS,
                "overflow-auto overscroll-y-auto [overscroll-behavior:auto]",
                scrollFadeClassName({ fade: "vertical", profile: "short" })
              )
            : "overflow-x-auto"
        )}
        data-scrollbar={heightCapped ? "overlay" : undefined}
        onWheel={heightCapped ? forwardWheelToMarkdownPreview : undefined}
        style={
          highlight.status === "highlighted"
            ? {
                backgroundColor: highlight.background,
                color: highlight.foreground,
              }
            : undefined
        }
      >
        <code data-language={language ?? undefined}>
          {highlight.status === "highlighted" ? (
            renderHighlightedCode(highlight, searchMatches, activeSearchMatchId)
          ) : (
            <MarkdownSearchText
              activeMatchId={activeSearchMatchId}
              matches={searchMatches}
              value={code}
            />
          )}
        </code>
      </pre>
    </div>
  );
}

function renderHighlightedCode(
  highlight: Extract<MarkdownCodeHighlightOutcome, { status: "highlighted" }>,
  matches: readonly MarkdownSearchMatch[] | undefined,
  activeMatchId: string | undefined
) {
  let codeOffset = 0;
  return highlight.lines.map((line, lineIndex) => {
    const lineOffset = codeOffset;
    const renderedTokens = line.map((token) => {
      const tokenOffset = codeOffset;
      codeOffset += token.content.length;
      return (
        <span
          key={`${tokenOffset}:${token.content}`}
          style={{
            ...(token.color ? { color: token.color } : {}),
            ...(token.fontStyle ? tokenFontStyle(token.fontStyle) : {}),
          }}
        >
          <MarkdownSearchText
            activeMatchId={activeMatchId}
            baseOffset={tokenOffset}
            matches={matches}
            value={token.content}
          />
        </span>
      );
    });
    if (lineIndex < highlight.lines.length - 1) codeOffset += 1;
    return (
      <span data-line={lineIndex + 1} key={`line:${lineOffset}`}>
        {renderedTokens}
        {lineIndex < highlight.lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

function tokenFontStyle(fontStyle: number) {
  return {
    ...(hasFontStyle(fontStyle, 1) ? { fontStyle: "italic" as const } : {}),
    ...(hasFontStyle(fontStyle, 2) ? { fontWeight: 700 } : {}),
    ...(hasFontStyle(fontStyle, 4) ? { textDecoration: "underline" } : {}),
  };
}

function hasFontStyle(value: number, flag: number): boolean {
  return Math.floor(value / flag) % 2 === 1;
}
