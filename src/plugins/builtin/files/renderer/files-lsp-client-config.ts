import {
  findReferencesKeymap,
  formatKeymap,
  type LSPClientConfig,
  renameKeymap,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
} from "@codemirror/lsp-client";
import { keymap } from "@codemirror/view";
import { filesLspHighlightLanguage } from "./files-lsp-highlight-language.ts";
import { sanitizeFilesLspHtml } from "./files-lsp-html-sanitizer.ts";

interface FilesLspClientConfigInput {
  readonly rootUri: string;
  readonly workspace: NonNullable<LSPClientConfig["workspace"]>;
}

/**
 * Upstream extensions without hoverTooltips / jumpToDefinitionKeymap.
 * Go to Definition (F12) lives on `filesLspHoverExtension` so LocationLink
 * and multi-target handling share the Pier navigate path.
 */
export function createFilesLspClientExtensions(): NonNullable<
  LSPClientConfig["extensions"]
> {
  return [
    serverCompletion(),
    keymap.of([...formatKeymap, ...renameKeymap, ...findReferencesKeymap]),
    signatureHelp(),
    serverDiagnostics(),
  ];
}

export function createFilesLspClientConfig({
  rootUri,
  workspace,
}: FilesLspClientConfigInput): LSPClientConfig {
  return {
    extensions: createFilesLspClientExtensions(),
    // Enables syntax color in hover markdown fences + MarkedString signatures
    // via LSPPlugin.docToHTML / marked walkTokens.
    highlightLanguage: filesLspHighlightLanguage,
    rootUri,
    sanitizeHTML: (html) => sanitizeFilesLspHtml(html),
    timeout: 12_000,
    workspace,
  };
}
