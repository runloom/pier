/**
 * Cross-file LSP navigation glue: open a disk path in Files and resolve its EditorView.
 */

import type { EditorView } from "@codemirror/view";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { fileUriFromAbsolutePath } from "@shared/lsp-uri.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { absoluteDiskSourcePath } from "../document/paths.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";

interface RegisteredEditorViews {
  absolutePath: string;
  rootPath: string;
  views: Set<EditorView>;
}

const viewsByUri = new Map<string, RegisteredEditorViews>();

export function registerFilesLspEditorView(
  absolutePath: string,
  view: EditorView,
  rootPath = ""
): () => void {
  const uri = fileUriFromAbsolutePath(absolutePath);
  let entry = viewsByUri.get(uri);
  if (!entry) {
    entry = {
      absolutePath,
      rootPath,
      views: new Set(),
    };
    viewsByUri.set(uri, entry);
  } else if (rootPath) {
    entry.rootPath = rootPath;
  }
  entry.views.add(view);
  return () => {
    entry?.views.delete(view);
    if (entry && entry.views.size === 0 && viewsByUri.get(uri) === entry) {
      viewsByUri.delete(uri);
    }
  };
}

export function getFilesLspEditorView(
  absolutePathOrUri: string
): EditorView | null {
  const uri = absolutePathOrUri.startsWith("file:")
    ? absolutePathOrUri
    : fileUriFromAbsolutePath(absolutePathOrUri);
  return viewsByUri.get(uri)?.views.values().next().value ?? null;
}

/** Reverse lookup: which disk path registered this EditorView (if any). */
export function absolutePathForFilesLspEditorView(
  view: EditorView
): string | null {
  for (const entry of viewsByUri.values()) {
    if (entry.views.has(view)) {
      return entry.absolutePath;
    }
  }
  return null;
}

/** Workspace/project root associated with a registered editor view. */
export function rootPathForFilesLspEditorView(view: EditorView): string | null {
  for (const entry of viewsByUri.values()) {
    if (entry.views.has(view)) {
      return entry.rootPath.length > 0 ? entry.rootPath : null;
    }
  }
  return null;
}

function splitAbsoluteToSource(
  absolutePath: string,
  preferredRoot: string | null
): { path: string; root: string } | null {
  const normalized =
    absolutePath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (preferredRoot) {
    const root = preferredRoot.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
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
    return { path: normalized.replace(/^\//, ""), root: "/" };
  }
  return {
    path: normalized.slice(slash + 1),
    root: normalized.slice(0, slash),
  };
}

let deps: {
  context: RendererPluginContext;
  controller: FileEditorController;
} | null = null;

export function resetFilesLspNavigationForTests(): void {
  viewsByUri.clear();
  deps = null;
}

export function getFilesLspNavigationContext(): RendererPluginContext | null {
  return deps?.context ?? null;
}

export function registerFilesLspNavigationDeps(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
}): () => void {
  deps = input;
  return () => {
    if (deps === input) {
      deps = null;
    }
  };
}

export async function openFilesLspAbsolutePath(
  absolutePath: string,
  preferredRoot?: string
): Promise<EditorView | null> {
  const sourceParts = splitAbsoluteToSource(
    absolutePath,
    preferredRoot ?? null
  );
  if (!sourceParts || sourceParts.path.length === 0) {
    // No project-relative source: only focus an already-registered view.
    const existing = getFilesLspEditorView(absolutePath);
    if (existing) {
      existing.focus();
      return existing;
    }
    return null;
  }

  const source = {
    kind: "disk" as const,
    path: sourceParts.path,
    root: sourceParts.root,
  };

  // Always activate the files tab + fire open-disk listeners (project tree
  // reveal). Skipping open when a view already exists left Cmd/Ctrl+Click
  // "no-op" when the tab was backgrounded or the tree never scrolled.
  if (deps) {
    const existingInstance = deps.context.panels
      .listInstances(FILES_FILE_PANEL_ID)
      .find((instance) =>
        sameFilesDocumentPanelSource(
          parseFilesDocumentPanelSource(instance.params),
          source
        )
      );
    if (existingInstance) {
      deps.controller.showSourceMode(existingInstance.id);
    }
    const opened = deps.context.files.openInEditor({
      path: source.path,
      root: source.root,
    });
    if (!(opened || existingInstance)) {
      return null;
    }
    // After open, resolve instance again for showSourceMode on cold open.
    if (!existingInstance) {
      const created = deps.context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find((instance) =>
          sameFilesDocumentPanelSource(
            parseFilesDocumentPanelSource(instance.params),
            source
          )
        );
      if (created) {
        deps.controller.showSourceMode(created.id);
      }
    }
  } else {
    const existing = getFilesLspEditorView(absolutePath);
    if (existing) {
      existing.focus();
      return existing;
    }
    return null;
  }

  // Wait for the editor view to register after panel activate/mount.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const view = getFilesLspEditorView(absolutePath);
    if (view) {
      view.focus();
      return view;
    }
    // Also accept identity via absoluteDiskSourcePath in case of root rewrite.
    const alt = absoluteDiskSourcePath(source.root, source.path);
    const altView = getFilesLspEditorView(alt);
    if (altView) {
      altView.focus();
      return altView;
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 50);
    });
  }
  return null;
}
