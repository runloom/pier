import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { ReactNode } from "react";
import type { FileEditorController } from "../editor/controller.ts";
import { FileTreeSidebar } from "../tree/sidebar.tsx";
import type { FilesWatchHub } from "../watch-hub.ts";

export function renderFilePanelSidebar(options: {
  activeFilePath: string | null;
  controller: FileEditorController;
  /** Active doc from another root; rendered pinned above the tree. */
  externalActiveFile?: { path: string; root: string } | null;
  instanceId: string;
  onOpenFile: (entry: FileEntry, options?: { pinned?: boolean }) => void;
  root: string | null | undefined;
  runtimeContext: RendererPluginContext | null | undefined;
  treeCollapsed: boolean;
  watchHub: FilesWatchHub;
}): ReactNode {
  const {
    activeFilePath,
    controller,
    externalActiveFile,
    instanceId,
    onOpenFile,
    root,
    runtimeContext,
    treeCollapsed,
    watchHub,
  } = options;
  if (!(runtimeContext && root && !treeCollapsed)) {
    return null;
  }
  return (
    <FileTreeSidebar
      activeFilePath={activeFilePath}
      context={runtimeContext}
      controller={controller}
      {...(externalActiveFile ? { externalActiveFile } : {})}
      instanceId={instanceId}
      onOpenFile={onOpenFile}
      root={root}
      watchHub={watchHub}
    />
  );
}
