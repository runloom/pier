import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $canShowPlaceholder } from "@lexical/text";
import { mergeRegister } from "@lexical/utils";
import { useEffect } from "react";

/**
 * Cursor / Codex-style empty placeholder: decorate the empty first paragraph
 * with `data-placeholder` + `is-editor-empty`, painted via CSS `::before`.
 *
 * Do NOT use Lexical ContentEditable's sibling `placeholder` overlay — a
 * covering layer (even transparent) hides Chromium's native caret when empty.
 */
export function EmptyPlaceholderPlugin({
  placeholder,
}: {
  placeholder: string;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const sync = (): void => {
      const root = editor.getRootElement();
      if (!root) {
        return;
      }
      const show = editor
        .getEditorState()
        .read(() => $canShowPlaceholder(editor.isComposing()));
      const paragraphs = root.querySelectorAll(":scope > p");
      for (const node of paragraphs) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        const isFirst = node === root.firstElementChild;
        if (show && isFirst) {
          node.classList.add("is-editor-empty");
          node.setAttribute("data-placeholder", placeholder);
        } else {
          node.classList.remove("is-editor-empty");
          node.removeAttribute("data-placeholder");
        }
      }
    };

    sync();
    return mergeRegister(
      editor.registerUpdateListener(() => {
        sync();
      }),
      editor.registerEditableListener(() => {
        sync();
      }),
      editor.registerRootListener(() => {
        sync();
      })
    );
  }, [editor, placeholder]);

  return null;
}
