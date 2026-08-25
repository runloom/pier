import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_REVEAL_ACTIVE_IN_TREE_COMMAND_ID,
} from "../../manifest.ts";
import { parseFilesDocumentPanelSource } from "../document/types.ts";
import {
  ensureProjectFileTreeExpanded,
  filePanelProjectRoot,
  fileRootsEqual,
} from "./preferences.ts";
import { revealFilesTreePathAfterAncestors } from "./reveal.ts";
import { filesTreeVisibilityForContext } from "./visibility.ts";
import { reloadFilesTreeVisibility } from "./visibility-reload.ts";

/**
 * Explicit reveal of the active editor file in the project tree.
 * Ignores autoReveal off/select and autoRevealExclude (user intent).
 */
export function createRevealActiveFileInTreeAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      const activePanelId =
        context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      if (!activePanelId) {
        return;
      }
      const instance = context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find((entry) => entry.id === activePanelId);
      if (!instance) {
        return;
      }
      const source = parseFilesDocumentPanelSource(instance.params);
      if (source?.kind !== "disk") {
        return;
      }
      const { path, root } = source;
      const contextRoot = filePanelProjectRoot(
        context.panels.getActiveContext()
      );
      // Prefer active panel-context root when it still matches the document root.
      const revealRoot =
        contextRoot && fileRootsEqual(contextRoot, root) ? root : source.root;

      ensureProjectFileTreeExpanded(revealRoot);
      const controller = filesTreeVisibilityForContext(context);
      const reveal = () =>
        revealFilesTreePathAfterAncestors({
          instanceId: instance.groupId ?? activePanelId,
          list: controller.list,
          options: { intent: "explicit" },
          path,
          root: revealRoot,
        });
      // Explicit reveal wins over Git-ignore hiding: pin, then re-filter
      // only when the pinned path is actually hidden. Reload failure still
      // reveals best-effort; the tree surfaces its own load error.
      if (
        controller.pinPath(revealRoot, path) &&
        (await controller.isPathHiddenByGitIgnore(revealRoot, path))
      ) {
        await reloadFilesTreeVisibility(
          revealRoot,
          controller.list,
          t("panel.loadError.fallback", "Failed to load files")
        ).catch(() => undefined);
      }
      reveal();
      return await Promise.resolve();
    },
    id: FILES_REVEAL_ACTIVE_IN_TREE_COMMAND_ID,
    metadata: { group: "2_view", sortOrder: 0 },
    surfaces: ["command-palette"],
    title: () =>
      t("filePanel.tree.revealActiveFile", "Reveal Active File in File Tree"),
  };
}
