import { Alert, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { FilesTranslate } from "../../i18n.ts";
export interface DocumentPreviewFrameProps {
  children: ReactNode;
  className?: string | undefined;
  fidelityNote?: string | undefined;
  footer?: ReactNode;
  notice?: ReactNode;
  onOpenInDefaultApp?: (() => void) | undefined;
  t: FilesTranslate;
  toolbar?: ReactNode;
}

export function DocumentPreviewFrame(props: DocumentPreviewFrameProps) {
  const hasToolbar = props.toolbar !== undefined || props.onOpenInDefaultApp;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-slot="document-preview"
    >
      {hasToolbar ? (
        <div
          className="flex h-7 shrink-0 items-center gap-1 border-b bg-background px-1.5"
          data-slot="document-preview-toolbar"
        >
          <div className="flex min-w-0 flex-1 items-center">
            {props.toolbar}
          </div>
          {props.onOpenInDefaultApp ? (
            <Button
              aria-label={props.t(
                "filePanel.documentPreview.openInDefaultApp",
                "Open in default app"
              )}
              onClick={props.onOpenInDefaultApp}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ExternalLink aria-hidden data-icon />
            </Button>
          ) : null}
        </div>
      ) : null}
      {props.fidelityNote ? (
        <Alert
          data-slot="document-preview-fidelity"
          layout="infobar"
          variant="info"
        >
          <AlertTitle>{props.fidelityNote}</AlertTitle>
        </Alert>
      ) : null}
      {props.notice}
      <div
        className={cn("min-h-0 flex-1", props.className ?? "overflow-auto")}
        data-slot="document-preview-body"
      >
        {props.children}
      </div>
      {props.footer}
    </div>
  );
}
