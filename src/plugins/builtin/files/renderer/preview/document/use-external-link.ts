import { useCallback, useRef } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import type { DocumentPreviewContext } from "./types.ts";

export function useDocumentExternalLink(args: {
  context: Pick<
    DocumentPreviewContext,
    "dialogs" | "externalNavigation" | "notifications"
  >;
  t: FilesTranslate;
}): (url: string) => void {
  const { context, t } = args;
  const inFlightRef = useRef<string | null>(null);

  return useCallback(
    (url: string) => {
      if (inFlightRef.current === url) {
        return;
      }
      if (inFlightRef.current) {
        context.notifications.info(
          t(
            "filePanel.documentPreview.externalLink.busy",
            "Another external link is already opening."
          )
        );
        return;
      }
      inFlightRef.current = url;
      context.externalNavigation
        .open(url)
        .then(async (result) => {
          if (!result.opened && result.reason === "busy") {
            context.notifications.info(
              t(
                "filePanel.documentPreview.externalLink.busy",
                "Another external link is already opening."
              )
            );
          } else if (!result.opened) {
            await context.dialogs.alert({
              body: t(
                "filePanel.documentPreview.externalLink.failed",
                "The link could not be opened."
              ),
              intent: "default",
              title: t(
                "filePanel.markdown.externalOpenFailed.title",
                "Unable to open link"
              ),
            });
          }
        })
        .catch(async (error: unknown) => {
          await context.dialogs
            .alert({
              body: error instanceof Error ? error.message : String(error),
              intent: "default",
              title: t(
                "filePanel.markdown.externalOpenFailed.title",
                "Unable to open link"
              ),
            })
            .catch(() => undefined);
        })
        .finally(() => {
          inFlightRef.current = null;
        });
    },
    [context, t]
  );
}
