import { Button } from "@pier/ui/button.tsx";
import { formatBytes } from "@pier/ui/format.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FolderSearch } from "lucide-react";
import type { ReactNode } from "react";
import type { FilesDocument } from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";
import { UnsupportedFileState } from "./parts.tsx";

/** Read-only / unsupported file Empty with reason-specific actions. */
export function UnsupportedFilePanel({
  context,
  controller,
  document,
  onReveal,
  t,
}: {
  context: RendererPluginContext | undefined;
  controller: FileEditorController;
  document: FilesDocument;
  onReveal: () => void;
  t: FilesTranslate;
}) {
  const reason = document.readOnlyReason;
  if (!reason) {
    return null;
  }

  let actions: ReactNode;
  if (reason === "binary" && context && document.source.kind === "disk") {
    actions = (
      <Button onClick={onReveal} size="sm" type="button" variant="default">
        <FolderSearch data-icon="inline-start" />
        {t("filePanel.unsupported.reveal", "Show in file manager")}
      </Button>
    );
  } else if (reason === "mixed-eol") {
    actions = (
      <>
        <Button
          onClick={() => controller.normalizeDocumentEol(document.id, "lf")}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("filePanel.unsupported.normalizeLf", "Normalize to LF")}
        </Button>
        <Button
          onClick={() => controller.normalizeDocumentEol(document.id, "crlf")}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("filePanel.unsupported.normalizeCrlf", "Normalize to CRLF")}
        </Button>
      </>
    );
  }

  let details: ReactNode;
  if (reason === "binary") {
    const type =
      document.mime ?? t("filePanel.unsupported.binaryType", "Binary");
    const size =
      document.size === null
        ? null
        : formatBytes(document.size, context?.i18n.language() ?? "en");
    details = (
      <p className="font-mono text-muted-foreground text-xs tabular-nums">
        {size ? `${type} · ${size}` : type}
      </p>
    );
  }

  const messageByReason = {
    binary: t(
      "filePanel.unsupported.binary",
      "Binary files are not opened in the text editor."
    ),
    "mixed-eol": t(
      "filePanel.unsupported.mixedEol",
      "Files with mixed line endings are read-only to avoid changing their bytes unexpectedly."
    ),
    "not-writable": t(
      "filePanel.unsupported.notWritable",
      "Pier does not have permission to write this file."
    ),
    "too-large": t(
      "filePanel.unsupported.tooLarge",
      "This file is too large to open in the editor."
    ),
    "unknown-encoding": t(
      "filePanel.unsupported.unknownEncoding",
      "This text encoding is not supported."
    ),
    "unsupported-file": t(
      "filePanel.unsupported.fileType",
      "This file type is not supported by the editor."
    ),
  } satisfies Record<NonNullable<typeof reason>, string>;

  return (
    <UnsupportedFileState
      actions={actions}
      details={details}
      message={messageByReason[reason]}
      title={document.name}
    />
  );
}
