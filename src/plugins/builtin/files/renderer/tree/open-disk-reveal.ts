import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { onFilesDiskPathOpened } from "@/lib/files/open-disk-file-panel.ts";
import { ensureProjectFileTreeExpanded } from "./preferences.ts";
import { revealFilesTreePathAfterAncestors } from "./reveal.ts";
import { filesTreeVisibilityForContext } from "./visibility.ts";

/**
 * After host `openInEditor` / `openFilesDiskPath` (Git review Open File,
 * LSP Cmd+Click, shell open, etc.), expand the project tree and center the path.
 *
 * This is intentional host/user navigation (not tab auto-tracking). It always
 * runs with `intent: "explicit"` even when autoReveal is off/select — settings
 * only control continuous active-file tracking. Use “Reveal Active File in
 * File Tree” when the tree was not opened via host open.
 */
export function registerFilesDiskOpenTreeReveal(
  context: RendererPluginContext
): () => void {
  return onFilesDiskPathOpened((event) => {
    ensureProjectFileTreeExpanded(event.root);
    const list = filesTreeVisibilityForContext(context).list;
    // Match by root: shared group tree is registered under groupId, not panel id.
    revealFilesTreePathAfterAncestors({
      list,
      options: {
        expandTarget: false,
        intent: "explicit",
      },
      path: event.path,
      root: event.root,
    });
  });
}
