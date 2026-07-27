import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { Folder } from "lucide-react";
import { FILES_OPEN_DIRECTORY_COMMAND_ID } from "../manifest.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { openProjectFiles } from "./files-open-project.ts";
import { projectAnchor } from "./files-project-anchor.ts";

/**
 * 命令面板「打开目录」：打开当前面板上下文的项目文件树。
 * 与状态栏项目项同路径（openProjectFiles）；无项目锚点时提示下一步。
 */
export function createFilesOpenDirectoryAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = createFilesTranslate(context);
  return {
    category: "file",
    handler: async () => {
      const panelContext = context.panels.getActiveContext();
      if (!(panelContext && projectAnchor(panelContext))) {
        context.notifications.info(
          t(
            "filePanel.openDirectory.noProject",
            "Open a project folder first to browse files."
          )
        );
        return;
      }
      const result = await openProjectFiles(context, panelContext);
      if (!result.ok) {
        context.notifications.error(
          t(
            "filePanel.openDirectory.failed",
            "Unable to open project directory"
          )
        );
      }
    },
    id: FILES_OPEN_DIRECTORY_COMMAND_ID,
    metadata: {
      categoryKey: "file",
      group: "2_view",
      iconComponent: Folder,
      sortOrder: 1,
    },
    surfaces: ["command-palette"],
    title: () => t("filePanel.openDirectory.title", "Open Directory"),
  };
}
