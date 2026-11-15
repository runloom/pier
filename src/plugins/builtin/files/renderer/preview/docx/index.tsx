import { cn } from "@pier/ui/utils.ts";
import { useEffect, useRef, useState } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { DocumentPreviewFrame } from "../document/shell.tsx";
import {
  DocumentErrorState,
  DocumentLoadingState,
} from "../document/states.tsx";
import type {
  DocumentPreviewContext,
  DocumentRenderError,
} from "../document/types.ts";
import { useDocumentExternalLink } from "../document/use-external-link.ts";
import { inspectDocxPackage } from "./inspect.ts";
import { bindDocxLinks } from "./links.ts";
import { renderDocxDocument } from "./render.ts";
import { sanitizeDocxShadow } from "./sanitize.ts";

type DocxState =
  | { error: null; status: "loading" | "ready" }
  | { error: DocumentRenderError; status: "error" };

export default function FileDocxPreview(props: {
  bytes: Uint8Array;
  context: Pick<
    DocumentPreviewContext,
    "dialogs" | "externalNavigation" | "notifications"
  >;
  fileName: string;
  onOpenInDefaultApp?: (() => void) | undefined;
  onRetry: () => void;
  t: FilesTranslate;
}) {
  const { bytes, context, onOpenInDefaultApp, onRetry, t } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<DocxState>({
    error: null,
    status: "loading",
  });
  const handleExternalLink = useDocumentExternalLink({ context, t });

  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | null = null;
    setState({ error: null, status: "loading" });

    const render = async () => {
      const inspection = await inspectDocxPackage(bytes);
      if (cancelled) {
        return;
      }
      if (!inspection.ok) {
        setState({
          error:
            inspection.reason === "zip-limit" ? "zip-limit" : "parse-failed",
          status: "error",
        });
        return;
      }
      const host = hostRef.current;
      if (!host) {
        return;
      }
      const { content, styles } = await renderDocxDocument({ bytes });
      if (cancelled || !hostRef.current) {
        return;
      }
      sanitizeDocxShadow(styles);
      sanitizeDocxShadow(content);
      const shadow =
        hostRef.current.shadowRoot ??
        hostRef.current.attachShadow({ mode: "open" });
      shadow.replaceChildren(styles, content);
      unbind = bindDocxLinks(shadow, {
        openExternal: handleExternalLink,
        scrollToAnchor: (id) => {
          shadow.getElementById(id)?.scrollIntoView({ block: "start" });
        },
      });
      setState({ error: null, status: "ready" });
    };

    render().catch(() => {
      if (!cancelled) {
        setState({ error: "render-failed", status: "error" });
      }
    });

    return () => {
      cancelled = true;
      unbind?.();
      hostRef.current?.shadowRoot?.replaceChildren();
    };
  }, [bytes, handleExternalLink]);

  return (
    <DocumentPreviewFrame
      className="overflow-auto bg-muted/40 p-4"
      {...(state.status === "ready"
        ? {
            fidelityNote: t(
              "filePanel.documentPreview.fidelity.docx",
              "Read-only preview. Complex layout may differ from the original."
            ),
          }
        : {})}
      {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
      t={t}
    >
      {state.status === "loading" ? <DocumentLoadingState t={t} /> : null}
      {state.status === "error" ? (
        <DocumentErrorState
          error={state.error}
          {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
          onRetry={onRetry}
          t={t}
        />
      ) : null}
      <div
        className={cn(
          "mx-auto min-h-full w-fit max-w-full",
          state.status === "ready" ? "" : "hidden"
        )}
        data-slot="document-preview-docx"
        ref={hostRef}
      />
    </DocumentPreviewFrame>
  );
}
