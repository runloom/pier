import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  RendererPluginContext,
  RendererTerminalStatusItemContext,
} from "@plugins/api/renderer.ts";
import { Folder } from "lucide-react";
import { FILES_PROJECT_STATUS_ITEM_ID } from "../../manifest.ts";
import { formatProjectStatusLabel, projectAnchor } from "./anchor.ts";

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
  const label = formatProjectStatusLabel(anchor);
  const t = (key: string, fallback: string) =>
    pluginContext.i18n.t(key, undefined, fallback);
  const openLabel = t("files.projectStatus.openLabel", "Open project files");

  return (
    <Tooltip>
      {/* Button 未 forwardRef，asChild 需落在 span 上才能锚定。 */}
      <TooltipTrigger asChild openOnFocus={false}>
        {/*
          不设固定 max-w-*：状态栏溢出由 host 整项 hide（priority）处理。
          硬上限会在条带仍有空位时提前 ellipsis（如 feature-git-plugin-capabilities）。
          min-w-0 + 文案 truncate 仅作 pinned 仍放不下时的最后兜底。
          openOnFocus=false：完整路径只给 hover；focus/快捷键不得瞬时弹出。
        */}
        <span className="inline-flex min-w-0">
          <Button
            aria-label={`${openLabel}: ${anchor}`}
            className={cn(STATUS_BAR_ITEM_TRIGGER_CLASS, "max-w-full")}
            data-testid="files-project-status-trigger"
            onClick={() => {
              pluginContext.files
                .openProjectDirectory({
                  context: panelContext,
                  root: anchor,
                })
                .then(
                  (result) => {
                    if (!result.ok) {
                      pluginContext.notifications.error(
                        t(
                          "files.projectStatus.openFailed",
                          "Unable to open project files"
                        )
                      );
                    }
                  },
                  () => {
                    pluginContext.notifications.error(
                      t(
                        "files.projectStatus.openFailed",
                        "Unable to open project files"
                      )
                    );
                  }
                );
            }}
            size="status-bar"
            type="button"
            variant="ghost"
          >
            <Folder
              aria-hidden="true"
              className="opacity-70"
              data-icon="inline-start"
            />
            <span className="min-w-0 truncate">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent
        align="end"
        className="max-w-sm font-mono"
        side="top"
        sideOffset={6}
      >
        {anchor}
      </TooltipContent>
    </Tooltip>
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
