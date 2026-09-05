import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileDiff, LoaderCircle } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";
import { requestFileChange } from "./requests.ts";
import { useFileChanges } from "./use-resource.ts";

export function FileChangesToolbarButton({
  context,
  documentId,
  editorSessionId,
  t,
}: {
  context: RendererPluginContext | undefined;
  documentId: string;
  editorSessionId: string;
  t: FilesTranslate;
}) {
  const { snapshot } = useFileChanges(context, documentId);
  if (snapshot.status === "unavailable") return null;
  const busy = snapshot.status === "loading" || snapshot.status === "updating";
  let label = t("filePanel.changes.show", "View changes");
  if (busy) label = t("filePanel.changes.loading", "Comparing changes…");
  else if (snapshot.status === "error")
    label = t(
      "filePanel.changes.failed",
      "Couldn't compare changes. Try again."
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          data-file-changes-trigger={editorSessionId}
          disabled={snapshot.status === "ready" && snapshot.ranges.length === 0}
          onClick={(event) =>
            requestFileChange(editorSessionId, {
              kind: "current",
              keyboard: event.detail === 0,
            })
          }
          variant="ghost"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <FileDiff data-icon="inline-start" />
          )}
          <span className="tabular-nums">
            {snapshot.status === "ready" ? snapshot.ranges.length : "…"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
