import type { PierFileTreeRevealOptions } from "@pier/ui/file/tree.tsx";
import type { FilesProjectDirectoryOpenedEvent } from "@plugins/api/files-project-directory-opened.ts";
import { onFilesProjectDirectoryOpened } from "@plugins/api/files-project-directory-opened.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { ancestorDirectoryPaths } from "../search/path-query-materialize.ts";
import { ensureProjectFileTreeExpanded } from "../tree/preferences.ts";
import {
  ensureFilesTreeAncestorsLoaded,
  waitUntilRevealReady,
} from "../tree/reveal.ts";
import { filesTreeVisibilityForContext } from "../tree/visibility.ts";
import { reloadFilesTreeVisibility } from "../tree/visibility-reload.ts";

function registryKeyForPanel(
  context: RendererPluginContext,
  panelId: string
): string {
  return (
    context.panels
      .listInstances(FILES_FILE_PANEL_ID)
      .find((panel) => panel.id === panelId)?.groupId ?? panelId
  );
}

function revealCandidatePaths(path: string, skipLeaf: boolean): string[] {
  if (path.length === 0) {
    return [""];
  }
  const ancestors = [...ancestorDirectoryPaths(path)].reverse();
  if (skipLeaf) {
    return [...ancestors, ""];
  }
  return [path, ...ancestors, ""];
}

function optionsForPath(path: string): PierFileTreeRevealOptions {
  return path.length === 0 ? { intent: "root" } : { intent: "explicit" };
}

async function leafIsMissing(
  context: RendererPluginContext,
  event: FilesProjectDirectoryOpenedEvent
): Promise<boolean> {
  if (event.path.length === 0) {
    return false;
  }
  try {
    const stat = await context.files.stat({
      path: event.path,
      root: event.root,
    });
    return !stat.exists;
  } catch {
    return false;
  }
}

async function revealOpenedDirectory(
  context: RendererPluginContext,
  event: FilesProjectDirectoryOpenedEvent
): Promise<void> {
  ensureProjectFileTreeExpanded(event.root);
  const controller = filesTreeVisibilityForContext(context);
  if (
    event.path.length > 0 &&
    controller.pinPath(event.root, event.path) &&
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
    ).catch(() => undefined);
  }
  const skipLeaf = await leafIsMissing(context, event);
  const resolveInstanceId = () =>
    registryKeyForPanel(context, event.instanceId);
  for (const path of revealCandidatePaths(event.path, skipLeaf)) {
    await ensureFilesTreeAncestorsLoaded({
      list: controller.list,
      path,
      root: event.root,
    });
    const revealed = await waitUntilRevealReady({
      fallbackToRoot: false,
      options: optionsForPath(path),
      path,
      resolveInstanceId,
      root: event.root,
    });
    if (revealed) {
      return;
    }
  }
}

export function registerFilesProjectDirectoryReveal(
  context: RendererPluginContext
): () => void {
  return onFilesProjectDirectoryOpened((event) => {
    revealOpenedDirectory(context, event).catch(() => undefined);
  });
}

/** @internal tests */
export const projectDirectoryRevealForTests = {
  registryKeyForPanel,
  revealCandidatePaths,
};
