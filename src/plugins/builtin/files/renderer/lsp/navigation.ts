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
import { createFileFilePanelInstanceId } from "../panel/id.ts";
import { sourceTitle } from "../panel/source.ts";

const viewsByUri = new Map<string, Set<EditorView>>();

export function registerFilesLspEditorView(
  absolutePath: string,
  view: EditorView
): () => void {
  const uri = fileUriFromAbsolutePath(absolutePath);
  let views = viewsByUri.get(uri);
  if (!views) {
    views = new Set();
    viewsByUri.set(uri, views);
  }
  views.add(view);
  return () => {
    views.delete(view);
    if (views.size === 0 && viewsByUri.get(uri) === views) {
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
  return viewsByUri.get(uri)?.values().next().value ?? null;
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
  const existing = getFilesLspEditorView(absolutePath);
  if (existing) {
    existing.focus();
    return existing;
  }
  if (!deps) {
    return null;
  }
  const sourceParts = splitAbsoluteToSource(
    absolutePath,
    preferredRoot ?? null
  );
  if (!sourceParts || sourceParts.path.length === 0) {
    return null;
  }
  const source = {
    kind: "disk" as const,
    path: sourceParts.path,
    root: sourceParts.root,
  };
  const existingInstance = deps.context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .find((instance) =>
      sameFilesDocumentPanelSource(
        parseFilesDocumentPanelSource(instance.params),
        source
      )
    );
  const instanceId =
    existingInstance?.id ?? createFileFilePanelInstanceId(source);
  const params = existingInstance?.params
    ? { ...existingInstance.params }
    : { pinned: true, source };
  deps.controller.showSourceMode(instanceId);
  deps.context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    dropUnpinnedInstances: false,
    instanceId,
    params,
    title: sourceTitle(
      parseFilesDocumentPanelSource(existingInstance?.params) ?? source
    ),
  });

  // Wait for the editor view to register after panel mount.
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
