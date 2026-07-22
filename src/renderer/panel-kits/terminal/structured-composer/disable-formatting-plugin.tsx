import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_HIGH,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { useEffect } from "react";

/** Block rich-text formatting shortcuts so the composer stays plain-text. */
export function DisableFormattingPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          FORMAT_TEXT_COMMAND,
          () => true,
          COMMAND_PRIORITY_HIGH
        ),
        editor.registerCommand(
          FORMAT_ELEMENT_COMMAND,
          () => true,
          COMMAND_PRIORITY_HIGH
        ),
        editor.registerCommand(
          INDENT_CONTENT_COMMAND,
          () => true,
          COMMAND_PRIORITY_HIGH
        ),
        editor.registerCommand(
          OUTDENT_CONTENT_COMMAND,
          () => true,
          COMMAND_PRIORITY_HIGH
        )
      ),
    [editor]
  );

  return null;
}
