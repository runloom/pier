/**
 * CSS @import / @source Go to Definition via Pier package resolution.
 * Works even when vscode-css-language-server is missing or cannot resolve
 * bare package specifiers (exports.style / monorepo).
 *
 * - @import → open resolved CSS file in the editor
 * - @source → reveal content-root directory (or file) in the project tree
 */

import type { EditorView } from "@codemirror/view";
import {
  cssImportAtOffset,
  isCssLikePath,
} from "@shared/css-import-at-position.ts";
import {
  absolutePathFromFileUri,
  fileUriFromAbsolutePath,
} from "@shared/lsp-uri.ts";
import { ensureProjectFileTreeExpanded } from "../tree/preferences.ts";
import { revealFilesTreePathAfterAncestors } from "../tree/reveal.ts";
import { filesTreeVisibilityForContext } from "../tree/visibility.ts";
import type { FilesLspDefinitionTarget } from "./definitions.ts";
import {
  absolutePathForFilesLspEditorView,
  getFilesLspNavigationContext,
  openFilesLspAbsolutePath,
  rootPathForFilesLspEditorView,
} from "./navigation.ts";

function zeroRangeTarget(uri: string): FilesLspDefinitionTarget {
  return {
    range: {
      end: { character: 0, line: 0 },
      start: { character: 0, line: 0 },
    },
    uri,
  };
}

function preferredRootForView(view: EditorView): string | undefined {
  return rootPathForFilesLspEditorView(view) ?? undefined;
}

/**
 * Split absolute path under a preferred project root for tree reveal / open.
 */
export function splitUnderPreferredRoot(
  absolutePath: string,
  preferredRoot: string | undefined
): { path: string; root: string } | null {
  const normalized =
    absolutePath.replace(/\\/g, "/").replace(/\/+$/u, "") || "/";
  if (preferredRoot) {
    const root = preferredRoot.replace(/\\/g, "/").replace(/\/+$/u, "") || "/";
    if (normalized === root) {
      return { path: "", root };
    }
    const prefix = root === "/" ? "/" : `${root}/`;
    if (normalized.startsWith(prefix)) {
      return {
        path:
          root === "/" ? normalized.slice(1) : normalized.slice(prefix.length),
        root,
      };
    }
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return null;
  }
  return {
    path: normalized.slice(slash + 1),
    root: normalized.slice(0, slash),
  };
}

async function resolveCssImport(input: {
  allowDirectory: boolean;
  fromFilePath: string;
  specifier: string;
}): Promise<{ isDirectory: boolean; path: string } | null> {
  const resolve = window.pier?.lsp?.resolveCssImport;
  if (!resolve) {
    return null;
  }
  return await resolve({
    allowDirectory: input.allowDirectory,
    fromFilePath: input.fromFilePath,
    specifier: input.specifier,
  });
}

function revealDirectoryInTree(input: {
  absolutePath: string;
  preferredRoot?: string;
}): boolean {
  const parts = splitUnderPreferredRoot(
    input.absolutePath,
    input.preferredRoot
  );
  if (!parts || parts.path.length === 0) {
    return false;
  }
  const context = getFilesLspNavigationContext();
  if (!context) {
    return false;
  }
  ensureProjectFileTreeExpanded(parts.root);
  revealFilesTreePathAfterAncestors({
    list: filesTreeVisibilityForContext(context).list,
    options: {
      expandTarget: true,
      intent: "explicit",
    },
    path: parts.path,
    root: parts.root,
  });
  // After-ancestors schedules async reveal; treat as success once expanded.
  return true;
}

export function cssImportHitAtView(
  view: EditorView,
  offset: number
): { kind: "import" | "source"; specifier: string } | null {
  const fromPath = absolutePathForFilesLspEditorView(view);
  if (!(fromPath && isCssLikePath(fromPath))) {
    return null;
  }
  const hit = cssImportAtOffset(view.state.doc.toString(), offset);
  if (!hit) {
    return null;
  }
  return { kind: hit.kind, specifier: hit.specifier };
}

export async function resolveCssImportDefinitionTarget(input: {
  allowDirectory?: boolean;
  fromFilePath: string;
  preferredRoot?: string;
  specifier: string;
}): Promise<FilesLspDefinitionTarget | null> {
  const resolved = await resolveCssImport({
    allowDirectory: input.allowDirectory === true,
    fromFilePath: input.fromFilePath,
    specifier: input.specifier,
  });
  if (!resolved) {
    return null;
  }
  return zeroRangeTarget(fileUriFromAbsolutePath(resolved.path));
}

/**
 * Try to open the CSS import / source under `offset`. Returns true when navigation ran.
 */
export async function tryNavigateCssImportAtOffset(input: {
  offset: number;
  preferredRoot?: string;
  view: EditorView;
}): Promise<boolean> {
  const fromPath = absolutePathForFilesLspEditorView(input.view);
  if (!(fromPath && isCssLikePath(fromPath))) {
    return false;
  }
  const hit = cssImportAtOffset(input.view.state.doc.toString(), input.offset);
  if (!hit) {
    return false;
  }
  const preferredRoot =
    input.preferredRoot ?? preferredRootForView(input.view) ?? undefined;
  const resolved = await resolveCssImport({
    allowDirectory: hit.kind === "source",
    fromFilePath: fromPath,
    specifier: hit.specifier,
  });
  if (!resolved) {
    return false;
  }

  if (resolved.isDirectory || hit.kind === "source") {
    return revealDirectoryInTree({
      absolutePath: resolved.path,
      ...(preferredRoot ? { preferredRoot } : {}),
    });
  }

  const opened = await openFilesLspAbsolutePath(
    resolved.path,
    preferredRoot ?? undefined
  );
  if (!opened) {
    return false;
  }
  opened.focus();
  opened.dispatch({
    scrollIntoView: true,
    selection: { anchor: 0, head: 0 },
    userEvent: "select.definition",
  });
  return true;
}

export async function cssImportDefinitionsForOffset(input: {
  offset: number;
  view: EditorView;
}): Promise<FilesLspDefinitionTarget[]> {
  const fromPath = absolutePathForFilesLspEditorView(input.view);
  if (!(fromPath && isCssLikePath(fromPath))) {
    return [];
  }
  const hit = cssImportAtOffset(input.view.state.doc.toString(), input.offset);
  if (!hit) {
    return [];
  }
  const target = await resolveCssImportDefinitionTarget({
    allowDirectory: hit.kind === "source",
    fromFilePath: fromPath,
    specifier: hit.specifier,
  });
  return target ? [target] : [];
}

export function isCssDocumentUri(uri: string): boolean {
  const path = absolutePathFromFileUri(uri);
  return path ? isCssLikePath(path) : false;
}
