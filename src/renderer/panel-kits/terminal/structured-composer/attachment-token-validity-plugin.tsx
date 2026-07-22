import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import type { ComposerAttachment } from "../terminal-composer-attachments-model.ts";
import { syncAttachmentTokenValidityInLexical } from "./structured-composer-mutations.ts";

/**
 * Keep attachment chip ordinal / valid state in sync with the rail.
 * Does not promote any literal text tokens — refs are chip-only.
 */
export function AttachmentTokenValidityPlugin({
  attachments,
}: {
  attachments: readonly ComposerAttachment[];
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    syncAttachmentTokenValidityInLexical(editor, attachments);
  }, [attachments, editor]);

  return null;
}
