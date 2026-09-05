import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import { requestFileChange } from "./requests.ts";

export function createFileChangesActions(
  context: RendererPluginContext
): RendererPluginAction[] {
  return (
    [
      ["current", "show", "View changes"],
      ["previous", "previous", "Previous change"],
      ["next", "next", "Next change"],
    ] as const
  ).map(([kind, key, fallback]) => ({
    id: `pier.files.changes.${kind}`,
    category: "file",
    title: () =>
      context.i18n.t(`filePanel.changes.${key}`, undefined, fallback),
    surfaces: ["command-palette", "files/editor"],
    enabled: () =>
      Boolean(context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID)),
    handler: () => {
      const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      if (panelId)
        requestFileChange(createFileEditorSessionId(panelId), {
          kind,
          keyboard: true,
        });
    },
  }));
}
