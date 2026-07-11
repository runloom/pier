import { Button } from "@pier/ui/button.tsx";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { Folder } from "lucide-react";
import { FILES_PROJECT_STATUS_ITEM_ID } from "../manifest.ts";
import { openProjectFiles } from "./files-open-project.ts";
import { formatProjectPath, projectAnchor } from "./files-project-anchor.ts";

export function isFilesProjectStatusVisible(
  statusContext: RendererTerminalStatusItemContext
): boolean {
  return projectAnchor(statusContext.context) != null;
}

function FilesProjectStatusItem({
  pluginContext,
  ...statusContext
}: RendererTerminalStatusItemContext & {
  pluginContext: RendererPluginContext;
}) {
  const anchor = projectAnchor(statusContext.context);
  if (!(anchor && statusContext.context)) {
    return null;
  }
  const panelContext = statusContext.context;
  const label = formatProjectPath(anchor, null);
  const t = (key: string, fallback: string) =>
    pluginContext.i18n.t(key, undefined, fallback);
  const openLabel = t("files.projectStatus.openLabel", "Open project files");
  const openTooltip = t(
    "files.projectStatus.openTooltip",
    "Open project files"
  );

  return (
    <Button
      aria-label={openLabel}
      className="h-5 min-w-0 max-w-56 gap-1 px-2 font-normal text-xs"
      data-testid="files-project-status-trigger"
      onClick={() => {
        const result = openProjectFiles(pluginContext, panelContext);
        if (!result.ok) {
          pluginContext.notifications.error(
            t("files.projectStatus.openFailed", "Unable to open project files")
          );
        }
      }}
      size="xs"
      title={`${openTooltip}\n${anchor}`}
      type="button"
      variant="outline"
    >
      <Folder
        aria-hidden="true"
        className="opacity-70"
        data-icon="inline-start"
      />
      <span className="min-w-0 truncate" dir="rtl">
        <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
          {label}
        </span>
      </span>
    </Button>
  );
}

export function registerFilesProjectStatusItem(
  context: RendererPluginContext
): () => void {
  return context.terminalStatusItems.register({
    id: FILES_PROJECT_STATUS_ITEM_ID,
    isVisible: isFilesProjectStatusVisible,
    render: (statusContext) => (
      <FilesProjectStatusItem {...statusContext} pluginContext={context} />
    ),
  });
}
