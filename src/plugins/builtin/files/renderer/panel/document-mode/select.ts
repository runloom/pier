import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  FileDocumentFormat,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import type { FilesDocumentLanguage } from "../../document/types.ts";
import type { FileEditorController } from "../../editor/controller.ts";
import { listSelectableEditorLanguages } from "../../editor/language/selectable.ts";
import type { FilesTranslate } from "../../i18n.ts";

export function encodingIdFromFormat(format: FileDocumentFormat): string {
  if (format.encoding === "utf8") {
    return format.bom ? "utf8-bom" : "utf8";
  }
  return format.encoding;
}

export function formatFromEncodingId(id: string): FileDocumentFormat | null {
  if (id === "utf8") {
    return { bom: false, encoding: "utf8" };
  }
  if (id === "utf8-bom") {
    return { bom: true, encoding: "utf8" };
  }
  if (id === "utf16le") {
    return { bom: true, encoding: "utf16le" };
  }
  if (id === "utf16be") {
    return { bom: true, encoding: "utf16be" };
  }
  return null;
}

export function openDocumentLanguagePicker(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  currentLanguage: FilesDocumentLanguage;
  documentId: string;
  onLanguageApplied?: (language: FilesDocumentLanguage) => void;
  t: FilesTranslate;
}): void {
  const { context, controller, currentLanguage, documentId, t } = input;
  context.commandPalette.openQuickPick({
    items: listSelectableEditorLanguages().map((language) => ({
      checked: language.id === currentLanguage,
      id: language.id,
      label: language.label,
    })),
    onAccept: (item) => {
      controller.setDocumentLanguage(documentId, item.id);
      input.onLanguageApplied?.(item.id);
    },
    placeholder: t("filePanel.language.searchPlaceholder", "Search languages"),
    title: t("filePanel.language.selectTitle", "Select Language"),
  });
}

export function openDocumentEolPicker(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  currentEol: string | null;
  documentId: string;
  t: FilesTranslate;
}): void {
  const { context, controller, currentEol, documentId, t } = input;
  const options: { id: FileWritableDocumentEol; label: string }[] = [
    { id: "lf", label: "LF" },
    { id: "crlf", label: "CRLF" },
  ];
  context.commandPalette.openQuickPick({
    items: options.map((option) => ({
      checked: option.id === currentEol,
      id: option.id,
      label: option.label,
    })),
    onAccept: (item) => {
      if (item.id === "lf" || item.id === "crlf") {
        controller.setDocumentSaveEol(documentId, item.id);
      }
    },
    placeholder: t("filePanel.eol.searchPlaceholder", "Select line ending"),
    title: t("filePanel.eol.selectTitle", "Select Line Ending"),
  });
}

export function openDocumentEncodingPicker(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  currentFormat: FileDocumentFormat | null;
  documentId: string;
  t: FilesTranslate;
}): void {
  const { context, controller, currentFormat, documentId, t } = input;
  const currentId = currentFormat ? encodingIdFromFormat(currentFormat) : null;
  const options = [
    { id: "utf8", label: "UTF-8" },
    { id: "utf8-bom", label: "UTF-8 with BOM" },
    { id: "utf16le", label: "UTF-16 LE" },
    { id: "utf16be", label: "UTF-16 BE" },
  ];
  context.commandPalette.openQuickPick({
    items: options.map((option) => ({
      checked: option.id === currentId,
      id: option.id,
      label: option.label,
    })),
    onAccept: (item) => {
      const format = formatFromEncodingId(item.id);
      if (format) {
        controller.setDocumentSaveFormat(documentId, format);
      }
    },
    placeholder: t("filePanel.encoding.searchPlaceholder", "Select encoding"),
    title: t("filePanel.encoding.selectTitle", "Select Encoding"),
  });
}
