import type { FilesDocumentLanguage } from "../../document/types.ts";
import { LANGUAGE_LABELS } from "../cm-language.ts";
import { editorLanguageModeRegistry } from "./mode-registry.ts";

export interface SelectableEditorLanguage {
  id: FilesDocumentLanguage;
  label: string;
}

/** Languages the status-bar picker can apply to the current document. */
export function listSelectableEditorLanguages(): SelectableEditorLanguage[] {
  const seen = new Set<string>();
  const items: SelectableEditorLanguage[] = [];
  for (const [id, label] of Object.entries(LANGUAGE_LABELS)) {
    if (id === "canvas") {
      continue;
    }
    seen.add(id);
    items.push({ id, label });
  }
  for (const mode of editorLanguageModeRegistry.list()) {
    if (seen.has(mode.languageId)) {
      continue;
    }
    seen.add(mode.languageId);
    items.push({ id: mode.languageId, label: mode.displayName });
  }
  return items.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  );
}
