import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@pier/ui/hover-card.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useSyncExternalStore } from "react";
import { filesDraftProtectionForDocument } from "../document/draft-protection.ts";
import {
  type FilesDraftProtectionState,
  subscribeFilesDraftProtection,
} from "../document/drafts.ts";
import type { FilesDocument } from "../document/types.ts";
import { languageLabel } from "../editor/cm-language.ts";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";
import { languageServicePresentation } from "./language-service-presentation.ts";
import { useFilesLanguageServiceStatus } from "./language-service-status.ts";
import {
  openDocumentEncodingPicker,
  openDocumentEolPicker,
  openDocumentLanguagePicker,
} from "./select-document-mode.ts";
import {
  statusTextForDocument,
  statusToneForDocument,
} from "./status-labels.ts";

export function DocumentStatusDot({
  document,
  onProtectionError,
  t,
}: {
  document: FilesDocument;
  onProtectionError: (message: string) => void;
  t: FilesTranslate;
}) {
  const protection = useDraftProtection(document);
  const { label, tone } = statusToneForDocument(document, protection, t);
  if (protection.status === "failed") {
    return (
      <Button
        aria-label={label}
        onClick={() => onProtectionError(protection.message)}
        size="icon-xs"
        title={`${label}: ${protection.message}`}
        type="button"
        variant="ghost"
      >
        <span aria-hidden className={cn("size-2 rounded-full", tone)} />
        <span className="sr-only">{label}</span>
      </Button>
    );
  }
  return (
    <span
      className={cn("size-1.5 rounded-full", tone)}
      role="status"
      title={label}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LanguageBadge({
  context,
  controller,
  document,
  onLanguageApplied,
  t,
}: {
  context?: RendererPluginContext;
  controller?: FileEditorController;
  document: FilesDocument;
  onLanguageApplied?: (language: string) => void;
  t: FilesTranslate;
}) {
  const label = languageLabel(document.language);
  if (!(context && controller)) {
    return (
      <Badge
        className="font-mono uppercase tracking-wide"
        data-language={document.language}
        size="xs"
        variant="ghost"
      >
        {label}
      </Badge>
    );
  }
  return (
    <Button
      aria-label={t("filePanel.language.selectTitle", "Select Language Mode")}
      className="font-mono uppercase tracking-wide"
      data-language={document.language}
      data-slot="badge"
      onClick={() => {
        openDocumentLanguagePicker({
          context,
          controller,
          currentLanguage: document.language,
          documentId: document.id,
          ...(onLanguageApplied ? { onLanguageApplied } : {}),
          t,
        });
      }}
      size="xs"
      type="button"
      variant="ghost"
    >
      {label}
    </Button>
  );
}

export function LanguageServiceStatus({
  documentId,
  ownerId,
  t,
}: {
  documentId: string;
  ownerId: string;
  t: FilesTranslate;
}) {
  const status = useFilesLanguageServiceStatus(ownerId, documentId);
  // Ready / unsupported 都是安静态：语言 badge 已标识语言，无语言服务时
  // 不必再叠「不支持」芯片（YAML/纯文本等大量文件类型本无 provider）。
  if (!status || status.state === "ready" || status.state === "unsupported") {
    return null;
  }

  const presentation = languageServicePresentation(status, t);
  const ariaParts = [
    presentation.label,
    presentation.title,
    presentation.description,
    presentation.nextStep,
    presentation.command,
  ].filter((part): part is string => Boolean(part && part.length > 0));
  // 徽标不进 Tab；span 做 trigger。HoverCard 承载「发生了什么 + 下一步」。
  return (
    <HoverCard closeDelay={100} openDelay={200}>
      <HoverCardTrigger asChild>
        <span className="inline-flex">
          <Badge
            aria-label={ariaParts.join(". ")}
            aria-live="polite"
            data-language-service-reason={
              "reason" in status ? status.reason : undefined
            }
            data-language-service-status={status.state}
            data-tone={presentation.tone}
            role="status"
            size="xs"
            variant={presentation.tone}
          >
            {presentation.label}
          </Badge>
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-80" side="bottom">
        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm leading-snug">
            {presentation.title}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {presentation.description}
          </p>
          {presentation.nextStep ? (
            <p className="text-sm leading-relaxed">{presentation.nextStep}</p>
          ) : null}
          {presentation.command ? (
            <p
              className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed"
              data-slot="language-service-install-command"
            >
              {presentation.command}
            </p>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function DocumentFormatBadge({
  context,
  controller,
  document,
  t,
}: {
  context?: RendererPluginContext;
  controller?: FileEditorController;
  document: FilesDocument;
  t: FilesTranslate;
}) {
  if (!(document.format && document.eol)) {
    return null;
  }
  const encoding = formatEncodingLabel(document.format);
  const eol = document.eol === "none" ? "—" : document.eol.toUpperCase();
  if (!(context && controller)) {
    return (
      <Badge className="font-mono tabular-nums" size="xs" variant="ghost">
        {encoding} · {eol}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center">
      <Button
        aria-label={t("filePanel.encoding.selectTitle", "Select Encoding")}
        className="font-mono tabular-nums"
        data-slot="badge"
        onClick={() => {
          openDocumentEncodingPicker({
            context,
            controller,
            currentFormat: document.format,
            documentId: document.id,
            t,
          });
        }}
        size="xs"
        type="button"
        variant="ghost"
      >
        {encoding}
      </Button>
      <span aria-hidden className="text-muted-foreground text-xs">
        ·
      </span>
      <Button
        aria-label={t("filePanel.eol.selectTitle", "Select End of Line")}
        className="font-mono tabular-nums"
        data-slot="badge"
        onClick={() => {
          openDocumentEolPicker({
            context,
            controller,
            currentEol: document.eol,
            documentId: document.id,
            t,
          });
        }}
        size="xs"
        type="button"
        variant="ghost"
      >
        {eol}
      </Button>
    </span>
  );
}

function formatEncodingLabel(
  format: NonNullable<FilesDocument["format"]>
): string {
  if (format.encoding === "utf8") {
    return format.bom ? "UTF-8 BOM" : "UTF-8";
  }
  return format.encoding === "utf16le" ? "UTF-16 LE" : "UTF-16 BE";
}

export function StatusLabel({
  document,
  hidden = false,
  t,
}: {
  document: FilesDocument;
  hidden?: boolean;
  t: FilesTranslate;
}) {
  const protection = useDraftProtection(document);
  const text = statusTextForDocument(document, protection, t);
  if (hidden) return <span className="sr-only">{text}</span>;
  return <Badge variant="secondary">{text}</Badge>;
}

function useDraftProtection(
  document: FilesDocument
): FilesDraftProtectionState {
  return useSyncExternalStore(
    subscribeFilesDraftProtection,
    () => filesDraftProtectionForDocument(document),
    () => filesDraftProtectionForDocument(document)
  );
}
