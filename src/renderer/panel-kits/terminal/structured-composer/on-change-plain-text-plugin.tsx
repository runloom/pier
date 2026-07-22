import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { useEffect } from "react";

/** Push plain-text changes to the parent controlled draft. */
export function OnChangePlainTextPlugin({
  onChange,
}: {
  onChange: (text: string) => void;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags }) => {
        if (tags.has("history-merge")) {
          return;
        }
        editorState.read(() => {
          onChange($getRoot().getTextContent());
        });
      }),
    [editor, onChange]
  );

  return null;
}
