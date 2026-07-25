import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_OPEN_SELECTION_PATH_COMMAND_ID } from "../manifest.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { handleFilesTerminalOpenUrl } from "./files-terminal-open-url-handler.ts";
import { normalizeTerminalPathText } from "./files-terminal-open-url-resolve.ts";

/**
 * Terminal context-menu action: open the selected path text in Files.
 * Reuses the same resolve + multi-root open path as link clicks.
 */
export function createOpenSelectionPathAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = createFilesTranslate(context);

  return {
    category: "file",
    handler: async (invocation) => {
      const sourcePanelId =
        invocation?.sourcePanelId ?? context.terminal.activePanelId();
      if (!sourcePanelId) {
        context.notifications.info(
          t(
            "files.notifications.noTerminalSelection",
            "Select some text in the terminal first."
          )
        );
        return;
      }

      const result = await context.terminal.readSelectionText(sourcePanelId);
      if (result.kind !== "ok" || result.text.trim().length === 0) {
        context.notifications.info(
          t(
            "files.notifications.noTerminalSelection",
            "Select some text in the terminal first."
          )
        );
        return;
      }

      const pathText = normalizeTerminalPathText(result.text);
      if (!pathText) {
        context.notifications.info(
          t(
            "files.notifications.terminalOpenSelectionPath.notAPath",
            "Select a file path in the terminal first."
          )
        );
        return;
      }

      await handleFilesTerminalOpenUrl(context, {
        kind: "text",
        panelId: sourcePanelId,
        url: pathText,
      });
    },
    id: FILES_OPEN_SELECTION_PATH_COMMAND_ID,
    // Before "Preview Selected Text" so the primary path-open action is first.
    metadata: { group: "0_edit", sortOrder: 5 },
    surfaces: ["terminal/content"],
    title: () => t("files.actions.openSelectionPath.title", "Open Path"),
  };
}
