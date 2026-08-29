import { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ensureProjectFileTreeExpanded } from "./preferences.ts";
import { revealFilesTreePathAfterAncestors } from "./reveal.ts";
import { filesTreeVisibilityForContext } from "./visibility.ts";
import { reloadFilesTreeVisibility } from "./visibility-reload.ts";

/**
 * After host `openInEditor` / `openFilesDiskPath` (Git review Open File,
 * LSP Cmd+Click, shell open, etc.), expand the project tree and center the path.
 *
 * This is intentional host/user navigation (not tab auto-tracking). It always
 * runs with `intent: "explicit"` even when autoReveal is off/select — settings
 * only control continuous active-file tracking. Use “Reveal Active File in
 * File Tree” when the tree was not opened via host open.
 *
 * Explicit navigation also wins over Git-ignore hiding: opening a hidden file
 * pins it (with its ancestor chain) visible before revealing.
 */
export function registerFilesDiskOpenTreeReveal(
  context: RendererPluginContext
): () => void {
  return onFilesDiskPathOpened((event) => {
    if (event.revealTree === false) {
      return;
    }
    ensureProjectFileTreeExpanded(event.root);
    const controller = filesTreeVisibilityForContext(context);
    const reveal = () =>
      revealFilesTreePathAfterAncestors({
        list: controller.list,
        options: {
          expandTarget: false,
          intent: "explicit",
        },
        path: event.path,
        root: event.root,
      });
    const prepare = async () => {
      if (
        controller.pinPath(event.root, event.path) &&
        // Only a newly pinned Git-ignored path changes visible content.
        (await controller.isPathHiddenByGitIgnore(event.root, event.path))
      ) {
        await reloadFilesTreeVisibility(
          event.root,
          controller.list,
          context.i18n.t(
            "panel.loadError.fallback",
            undefined,
            "Failed to load files"
          )
        );
      }
    };
    prepare().then(reveal, reveal);
  });
}
