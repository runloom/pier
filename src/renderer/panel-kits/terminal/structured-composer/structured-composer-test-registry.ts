import type { LexicalEditor } from "lexical";
import {
  readLexicalPlainText,
  writeLexicalPlainText,
} from "./structured-composer-serialize.ts";

/** Active Lexical editors — test helpers write through this registry. */
const editorsForTests = new Set<LexicalEditor>();
/** Parent draft setters — keep React controlled state in sync during tests. */
const draftSinksForTests = new Set<(text: string) => void>();

export function registerComposerEditorForTests(
  editor: LexicalEditor
): () => void {
  editorsForTests.add(editor);
  return () => {
    editorsForTests.delete(editor);
  };
}

export function registerComposerDraftSinkForTests(
  sink: (text: string) => void
): () => void {
  draftSinksForTests.add(sink);
  return () => {
    draftSinksForTests.delete(sink);
  };
}

export function setAllComposerEditorsTextForTests(text: string): void {
  if (editorsForTests.size === 0) {
    throw new Error(
      "setAllComposerEditorsTextForTests: no Lexical editors registered"
    );
  }
  for (const editor of editorsForTests) {
    writeLexicalPlainText(editor, text);
  }
  for (const sink of draftSinksForTests) {
    sink(text);
  }
}

export function readFirstComposerEditorTextForTests(): string {
  for (const editor of editorsForTests) {
    return readLexicalPlainText(editor);
  }
  return "";
}

export function resetComposerEditorsForTests(): void {
  editorsForTests.clear();
  draftSinksForTests.clear();
}
