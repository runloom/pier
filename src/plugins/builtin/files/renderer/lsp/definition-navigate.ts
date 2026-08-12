/**
 * Single exit for Go to Definition: card activation, Cmd/Ctrl+Click, and F12.
 */

import { LSPPlugin, type WorkspaceMapping } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import {
  cssImportDefinitionsForOffset,
  tryNavigateCssImportAtOffset,
} from "./css-import-definition.ts";
import {
  type FilesLspDefinitionRange,
  type FilesLspDefinitionTarget,
  parseFilesLspDefinitions,
} from "./definitions.ts";

export type FilesLspNavigateDefinitionResult =
  | { ok: true }
  | { ok: false; reason: "map-failed" | "open-failed" | "unavailable" };

export type FilesLspJumpToDefinitionResult =
  | { ok: true; multi: false }
  | {
      ok: true;
      multi: true;
      targets: FilesLspDefinitionTarget[];
      total: number;
      truncated: boolean;
      mapping: WorkspaceMapping;
      plugin: LSPPlugin;
    }
  | {
      ok: false;
      reason:
        | "empty"
        | "map-failed"
        | "open-failed"
        | "request-failed"
        | "unavailable";
    };

function mapOffset(
  plugin: LSPPlugin,
  mapping: WorkspaceMapping,
  uri: string,
  position: { character: number; line: number },
  targetView: EditorView
): number | null {
  try {
    if (mapping.getMapping(uri)) {
      return mapping.mapPosition(uri, position);
    }
    return plugin.fromPosition(position, targetView.state.doc);
  } catch {
    return null;
  }
}

export async function navigateFilesLspDefinition(input: {
  mapping: WorkspaceMapping;
  plugin: LSPPlugin;
  sourceView: EditorView;
  target: { range: FilesLspDefinitionRange; uri: string };
}): Promise<FilesLspNavigateDefinitionResult> {
  const { mapping, plugin, sourceView, target } = input;
  let targetView: EditorView | null;
  try {
    targetView =
      target.uri === plugin.uri
        ? sourceView
        : await plugin.client.workspace.displayFile(target.uri);
  } catch {
    return { ok: false, reason: "open-failed" };
  }
  if (!targetView) {
    return { ok: false, reason: "open-failed" };
  }

  const start = mapOffset(
    plugin,
    mapping,
    target.uri,
    target.range.start,
    targetView
  );
  const end = mapOffset(
    plugin,
    mapping,
    target.uri,
    target.range.end,
    targetView
  );
  if (start === null || end === null) {
    return { ok: false, reason: "map-failed" };
  }

  const docLength = targetView.state.doc.length;
  const anchor = Math.max(0, Math.min(start, docLength));
  const head = Math.max(0, Math.min(end, docLength));
  targetView.focus();
  targetView.dispatch({
    scrollIntoView: true,
    selection: { anchor, head },
    userEvent: "select.definition",
  });
  return { ok: true };
}

export async function jumpToFilesLspDefinition(
  view: EditorView
): Promise<FilesLspJumpToDefinitionResult> {
  const position = view.state.selection.main.head;
  const plugin = LSPPlugin.get(view);

  // CSS package @import: resolve even when CSS LS is missing or returns empty.
  if (!plugin) {
    const navigated = await tryNavigateCssImportAtOffset({
      offset: position,
      view,
    });
    return navigated
      ? { ok: true, multi: false }
      : { ok: false, reason: "unavailable" };
  }

  const hasCapability = (
    plugin.client as { hasCapability?: (name: string) => boolean }
  ).hasCapability;
  const definitionEnabled =
    typeof hasCapability !== "function" ||
    hasCapability.call(plugin.client, "definitionProvider") !== false;

  let definitions = {
    targets: [] as FilesLspDefinitionTarget[],
    total: 0,
    truncated: false,
  };
  let mapping: WorkspaceMapping | null = null;

  if (definitionEnabled) {
    plugin.client.sync();
    const params = {
      position: plugin.toPosition(position),
      textDocument: { uri: plugin.uri },
    };
    mapping = plugin.client.workspaceMapping();
    try {
      const response = await plugin.client.request(
        "textDocument/definition",
        params
      );
      definitions = parseFilesLspDefinitions(response);
    } catch {
      mapping.destroy();
      mapping = null;
      // Fall through to CSS import resolution.
    }
  }

  if (definitions.targets.length === 0) {
    mapping?.destroy();
    const cssTargets = await cssImportDefinitionsForOffset({
      offset: position,
      view,
    });
    if (cssTargets.length === 1 && cssTargets[0]) {
      // Navigate without LSP mapping — openFiles path via uri file://
      const navigated = await tryNavigateCssImportAtOffset({
        offset: position,
        view,
      });
      return navigated
        ? { ok: true, multi: false }
        : { ok: false, reason: "open-failed" };
    }
    if (cssTargets.length === 0) {
      return {
        ok: false,
        reason: definitionEnabled ? "empty" : "unavailable",
      };
    }
  }

  if (!mapping) {
    mapping = plugin.client.workspaceMapping();
  }

  if (definitions.targets.length === 1) {
    const target = definitions.targets[0];
    if (!target) {
      mapping.destroy();
      return { ok: false, reason: "empty" };
    }
    try {
      const result = await navigateFilesLspDefinition({
        mapping,
        plugin,
        sourceView: view,
        target,
      });
      return result.ok
        ? { ok: true, multi: false }
        : { ok: false, reason: result.reason };
    } finally {
      mapping.destroy();
    }
  }

  return {
    ok: true,
    multi: true,
    mapping,
    plugin,
    targets: definitions.targets,
    total: definitions.total,
    truncated: definitions.truncated,
  };
}
