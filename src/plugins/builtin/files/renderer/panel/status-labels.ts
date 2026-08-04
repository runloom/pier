import type { FilesDraftProtectionState } from "../document/drafts.ts";
import type { FilesDocument } from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";

export function statusTextForDocument(
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
  if (document.diskConflict) {
    return t(
      "filePanel.status.diskConflict",
      "File changed on disk — unsaved edits kept"
    );
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

export function statusToneForDocument(
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
  if (document.diskConflict) {
    return {
      label: t(
        "filePanel.status.diskConflict",
        "File changed on disk — unsaved edits kept"
      ),
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
