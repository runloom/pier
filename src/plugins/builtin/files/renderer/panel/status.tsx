import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { useSyncExternalStore } from "react";
import { filesDraftProtectionForDocument } from "../document/draft-protection.ts";
import {
  type FilesDraftProtectionState,
  subscribeFilesDraftProtection,
} from "../document/drafts.ts";
import type { FilesDocument } from "../document/types.ts";
import { LANGUAGE_LABELS } from "../editor/cm-language.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  type FilesLanguageServiceStatus,
  useFilesLanguageServiceStatus,
} from "./language-service-status.ts";

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
  document,
}: {
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const label = LANGUAGE_LABELS[document.language] ?? LANGUAGE_LABELS.text;
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

type LanguageServiceTone =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

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
  // Ready is the quiet success path: the language badge already identifies
  // the language, and a green "Ready" chip next to the save status dot only
  // reads as redundant noise. Surface badges only for non-ready states.
  if (!status || status.state === "ready") {
    return null;
  }

  const { label, tone } = languageServiceStatePresentation(status, t);
  const description = languageServiceDescription(status, t);
  // 状态徽标不进 Tab 序：短标签可见 + aria-label 带说明；hover tooltip 给鼠标用户。
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            aria-label={`${label}. ${description}`}
            aria-live="polite"
            data-language-service-status={status.state}
            data-tone={tone}
            role="status"
            size="xs"
            variant={tone}
          >
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function languageServiceStatePresentation(
  status: FilesLanguageServiceStatus,
  t: FilesTranslate
): { label: string; tone: LanguageServiceTone } {
  switch (status.state) {
    case "disabled":
      return {
        label: t("filePanel.languageService.state.disabled", "Disabled"),
        tone: "neutral",
      };
    case "unsupported":
      return {
        label: t("filePanel.languageService.state.unsupported", "Unsupported"),
        tone: "neutral",
      };
    case "starting":
      return {
        label: t("filePanel.languageService.state.starting", "Starting"),
        tone: "info",
      };
    case "ready":
      return {
        label: t("filePanel.languageService.state.ready", "Ready"),
        tone: "success",
      };
    case "retrying":
      return {
        label: t("filePanel.languageService.state.retrying", "Retrying"),
        tone: "warning",
      };
    case "paused":
      return {
        label: t("filePanel.languageService.state.paused", "Paused"),
        tone: "neutral",
      };
    case "error":
      return {
        label: t("filePanel.languageService.state.error", "Error"),
        tone: "danger",
      };
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

function languageServiceDescription(
  status: FilesLanguageServiceStatus,
  t: FilesTranslate
): string {
  switch (status.state) {
    case "disabled": {
      const { reason } = status;
      switch (reason) {
        case "editor-disabled":
          return t(
            "filePanel.languageService.description.disabled.editorDisabled",
            "Enable editor language features in Settings."
          );
        case "globally-disabled":
          return t(
            "filePanel.languageService.description.disabled.globallyDisabled",
            "Enable Language Services in Settings."
          );
        case "worktrees-disabled":
          return t(
            "filePanel.languageService.description.disabled.worktreesDisabled",
            "Enable language services for worktrees in Settings."
          );
        default: {
          const exhaustiveReason: never = reason;
          return exhaustiveReason;
        }
      }
    }
    case "unsupported": {
      const { reason } = status;
      switch (reason) {
        case "non-disk":
          return t(
            "filePanel.languageService.description.unsupported.nonDisk",
            "Save this file to the workspace to use language features."
          );
        case "no-provider":
          return t(
            "filePanel.languageService.description.unsupported.noProvider",
            "Install or configure the language server for this file type."
          );
        case "unsupported-root":
          return t(
            "filePanel.languageService.description.unsupported.unsupportedRoot",
            "Open a supported local workspace to use language features."
          );
        default: {
          const exhaustiveReason: never = reason;
          return exhaustiveReason;
        }
      }
    }
    case "starting":
      return t(
        "filePanel.languageService.description.starting",
        "Language features are starting."
      );
    case "ready":
      return t(
        "filePanel.languageService.description.ready",
        "Language features are ready."
      );
    case "retrying": {
      const { reason } = status;
      switch (reason) {
        case "exited":
          return t(
            "filePanel.languageService.description.retrying.exited",
            "The language server exited. Pier will retry automatically."
          );
        case "failed":
          return t(
            "filePanel.languageService.description.retrying.failed",
            "The language server failed. Pier will retry automatically."
          );
        case "send-failed":
          return t(
            "filePanel.languageService.description.retrying.sendFailed",
            "Pier could not contact the language server. Pier will retry automatically."
          );
        case "initialize-failed":
          return t(
            "filePanel.languageService.description.retrying.initializeFailed",
            "The language server could not initialize. Pier will retry automatically."
          );
        default: {
          const exhaustiveReason: never = reason;
          return exhaustiveReason;
        }
      }
    }
    case "paused": {
      const { reason } = status;
      switch (reason) {
        case "idle-release":
          return t(
            "filePanel.languageService.description.paused.idleRelease",
            "Focus the editor to resume language features."
          );
        case "workspace-evicted":
          return t(
            "filePanel.languageService.description.paused.workspaceEvicted",
            "This workspace was paused to free resources. Focus the editor to resume language features."
          );
        default: {
          const exhaustiveReason: never = reason;
          return exhaustiveReason;
        }
      }
    }
    case "error": {
      const { reason } = status;
      switch (reason) {
        case "limit-reached":
          return t(
            "filePanel.languageService.description.error.limitReached",
            "Close another workspace or adjust the language service limit in Settings."
          );
        case "server-unavailable":
          return t(
            "filePanel.languageService.description.error.serverUnavailable",
            "Check that the language server for this file type is installed."
          );
        case "launch-failed":
          return t(
            "filePanel.languageService.description.error.launchFailed",
            "Check that the language server for this file type is installed, then try again."
          );
        case "initialize-failed":
          return t(
            "filePanel.languageService.description.error.initializeFailed",
            "Check the language server installation and try again."
          );
        case "cleanup-failed":
          return t(
            "filePanel.languageService.description.error.cleanupFailed",
            "The language service process could not be closed. Restart Pier and try again."
          );
        case "bridge-unavailable":
          return t(
            "filePanel.languageService.description.error.bridgeUnavailable",
            "Pier could not reach the language service. Restart Pier and try again."
          );
        case "retry-exhausted":
          return t(
            "filePanel.languageService.description.error.retryExhausted",
            "The language server stopped repeatedly. Restart Pier, then check the language server installation if the problem continues."
          );
        default: {
          const exhaustiveReason: never = reason;
          return exhaustiveReason;
        }
      }
    }
    default: {
      const exhaustiveStatus: never = status;
      return exhaustiveStatus;
    }
  }
}

export function DocumentFormatBadge({ document }: { document: FilesDocument }) {
  if (!(document.format && document.eol)) {
    return null;
  }
  const encoding = formatEncodingLabel(document.format);
  const eol = document.eol === "none" ? "—" : document.eol.toUpperCase();
  return (
    <Badge className="font-mono tabular-nums" size="xs" variant="ghost">
      {encoding} · {eol}
    </Badge>
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

function statusTextForDocument(
  document: FilesDocument,
  protection: FilesDraftProtectionState,
  t: FilesTranslate
): string {
  if (protection.status === "protecting") {
    return t("filePanel.status.protecting", "Saving draft…");
  }
  if (protection.status === "failed") {
    return t("filePanel.status.protectionFailed", "Draft not saved");
  }
  if (protection.status === "protected" && document.dirty) {
    return t("filePanel.status.protected", "Draft saved");
  }
  if (document.durabilityUnknown) {
    return t(
      "filePanel.status.durabilityUnknown",
      "Written; save not confirmed yet"
    );
  }
  if (document.deletedOnDisk) {
    return t("filePanel.status.deletedOnDisk", "Deleted on disk");
  }
  if (document.source.kind === "untitled") {
    return document.dirty
      ? t("filePanel.status.unsaved", "Unsaved changes")
      : t("filePanel.status.temporary", "Temporary file");
  }
  if (document.loadState === "loading") {
    return t("filePanel.status.loading", "Loading…");
  }
  if (document.saveState === "saving") {
    return t("filePanel.status.saving", "Saving…");
  }
  if (document.error) {
    return t("filePanel.status.error", "Error");
  }
  return document.dirty
    ? t("filePanel.status.unsaved", "Unsaved changes")
    : t("filePanel.status.saved", "Saved");
}

function statusToneForDocument(
  document: FilesDocument,
  protection: FilesDraftProtectionState,
  t: FilesTranslate
): { label: string; tone: string } {
  if (protection.status === "failed") {
    return {
      label: t("filePanel.status.protectionFailed", "Draft not saved"),
      tone: "bg-destructive",
    };
  }
  if (protection.status === "protecting") {
    return {
      label: t("filePanel.status.protecting", "Saving draft…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (protection.status === "protected" && document.dirty) {
    return {
      label: t("filePanel.status.protected", "Draft saved"),
      tone: "bg-success",
    };
  }
  if (document.durabilityUnknown) {
    return {
      label: t(
        "filePanel.status.durabilityUnknown",
        "Written; save not confirmed yet"
      ),
      tone: "bg-warning",
    };
  }
  if (document.deletedOnDisk) {
    return {
      label: t("filePanel.status.deletedOnDisk", "Deleted on disk"),
      tone: "bg-warning",
    };
  }
  if (document.error) {
    return {
      label: t("filePanel.status.error", "Error"),
      tone: "bg-destructive",
    };
  }
  if (document.loadState === "loading") {
    return {
      label: t("filePanel.status.loading", "Loading…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (document.saveState === "saving") {
    return {
      label: t("filePanel.status.saving", "Saving…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (document.dirty) {
    return {
      label: t("filePanel.status.unsaved", "Unsaved changes"),
      tone: "bg-warning",
    };
  }
  if (document.source.kind === "untitled") {
    return {
      label: t("filePanel.status.temporary", "Temporary file"),
      tone: "bg-muted-foreground",
    };
  }
  return {
    label: t("filePanel.status.saved", "Saved"),
    tone: "bg-success",
  };
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
