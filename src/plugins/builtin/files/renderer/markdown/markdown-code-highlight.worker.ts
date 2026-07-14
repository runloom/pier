import {
  type BundledLanguage,
  type BundledTheme,
  bundledLanguages,
  bundledThemes,
  codeToTokens,
} from "shiki/bundle/web";
import type {
  MarkdownCodeHighlightRequest,
  MarkdownCodeHighlightResponse,
} from "./markdown-code-highlight-protocol.ts";

const FALLBACK_DARK_THEME: BundledTheme = "github-dark";
const FALLBACK_LIGHT_THEME: BundledTheme = "github-light";

function bundledLanguage(value: string): BundledLanguage | null {
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(bundledLanguages, normalized)
    ? (normalized as BundledLanguage)
    : null;
}

function bundledTheme(value: string): BundledTheme {
  if (Object.hasOwn(bundledThemes, value)) return value as BundledTheme;
  return value.toLowerCase().includes("light")
    ? FALLBACK_LIGHT_THEME
    : FALLBACK_DARK_THEME;
}

async function highlight(
  request: MarkdownCodeHighlightRequest
): Promise<MarkdownCodeHighlightResponse> {
  const language = bundledLanguage(request.language);
  if (!language) return { requestId: request.requestId, type: "error" };
  try {
    const result = await codeToTokens(request.code, {
      lang: language,
      theme: bundledTheme(request.theme),
    });
    return {
      background: result.bg ?? "transparent",
      foreground: result.fg ?? "currentColor",
      lines: result.tokens.map((line) =>
        line.map((token) => ({
          ...(token.color ? { color: token.color } : {}),
          content: token.content,
          ...(token.fontStyle ? { fontStyle: token.fontStyle } : {}),
        }))
      ),
      requestId: request.requestId,
      type: "highlighted",
    };
  } catch {
    return { requestId: request.requestId, type: "error" };
  }
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<MarkdownCodeHighlightRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    self.postMessage(await highlight(request));
  });
};
