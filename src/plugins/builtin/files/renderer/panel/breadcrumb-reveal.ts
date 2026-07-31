import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesDocumentPanelSource } from "../document/types.ts";
import { revealFilesTreePathAfterAncestors } from "../tree/reveal.ts";
import { filesTreeVisibilityForContext } from "../tree/visibility.ts";
import { breadcrumbRevealPathForDiskSource } from "./source.ts";

/**
 * Map a disk breadcrumb segment click to a files-tree reveal, expanding the
 * sidebar first when it is collapsed.
 *
 * Readiness is handled inside revealFilesTreePathAfterAncestors (load ancestors
 * → wait for tree API + model path). No fixed 80ms sleep after expand.
 */
export function revealDiskBreadcrumbInTree(options: {
  context: RendererPluginContext;
  index: number;
  instanceId: string;
  path: string;
  projectName: string | null;
  root: string;
  setTreeCollapsed: (collapsed: boolean) => void;
  source: FilesDocumentPanelSource;
  treeCollapsed: boolean;
}): void {
  const {
    context,
    index,
    instanceId,
    path,
    projectName,
    root,
    setTreeCollapsed,
    source,
    treeCollapsed,
  } = options;
  if (source.kind !== "disk") {
    return;
  }
  const revealTarget = breadcrumbRevealPathForDiskSource({
    path,
    projectName,
    segmentIndex: index,
  });
  const list = filesTreeVisibilityForContext(context).list;
  if (treeCollapsed) {
    setTreeCollapsed(false);
  }
  revealFilesTreePathAfterAncestors({
    instanceId,
    list,
    // Policy defaults: explicit → center (smart-center at execute) + expandTarget.
    options: { intent: "explicit" },
    path: revealTarget,
    root,
  });
}
