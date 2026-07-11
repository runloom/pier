import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useCallback, useEffect, useMemo } from "react";
import {
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "../settings.ts";
import { filesTreeVisibilityForContext } from "./files-tree-visibility.ts";
import { reloadFilesTreeVisibility } from "./files-tree-visibility-reload.ts";

export function useFilesTreeVisibility(
  context: RendererPluginContext,
  root: string,
  fallbackError: string
) {
  const controller = useMemo(
    () => filesTreeVisibilityForContext(context),
    [context]
  );
  const reload = useCallback(
    () => reloadFilesTreeVisibility(root, controller.list, fallbackError),
    [controller, fallbackError, root]
  );

  useEffect(
    () =>
      context.configuration.onDidChange((event) => {
        if (
          !(
            event.affectsConfiguration(FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) ||
            event.affectsConfiguration(
              FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY
            ) ||
            event.affectsConfiguration(FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY)
          )
        ) {
          return;
        }
        controller.invalidateGitIgnored(root);
        reload().catch(() => undefined);
      }),
    [context, controller, reload, root]
  );

  return { controller, reload };
}
