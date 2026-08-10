import type { ComposerEditorMutations } from "./composer-editor-mutations.ts";
import type { StructuredComposerEditorHandle } from "./structured-composer/editor.tsx";

/** Build Lexical-preserving attachment mutations from the editor ref. */
export function createComposerEditorMutations(input: {
  editorRef: { current: StructuredComposerEditorHandle | null };
  valueRef: { current: string };
}): ComposerEditorMutations {
  const { editorRef, valueRef } = input;
  return {
    getSelection: () =>
      editorRef.current?.getSelection() ?? {
        cursor: valueRef.current.length,
        selectionEnd: valueRef.current.length,
      },
    getValue: () => editorRef.current?.getValue() ?? valueRef.current,
    insertAttachmentToken: (absolutePath, ordinal1Based) => {
      editorRef.current?.insertAttachmentToken(absolutePath, ordinal1Based);
    },
    insertTextAtSelection: (text) => {
      editorRef.current?.insertTextAtSelection(text);
    },
    listInvalidAttachmentRefs: (atts) =>
      editorRef.current?.listInvalidAttachmentRefs(atts) ?? [],
    rewriteAttachmentTokensAfterRemove: (removedPath, nextAttachments) =>
      editorRef.current?.rewriteAttachmentTokensAfterRemove(
        removedPath,
        nextAttachments
      ) ?? valueRef.current,
  };
}
