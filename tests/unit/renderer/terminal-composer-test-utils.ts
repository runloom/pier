import { act, screen } from "@testing-library/react";
import {
  readFirstComposerEditorTextForTests,
  setAllComposerEditorsTextForTests,
} from "@/panel-kits/terminal/structured-composer/structured-composer-test-registry.ts";

/** Read plain text from the mounted Lexical editor. */
export function readComposerDraftText(): string {
  return readFirstComposerEditorTextForTests();
}

/**
 * Replace composer draft by writing directly into the mounted Lexical editor.
 * Prefer this over fireEvent.change — the input is no longer a textarea.
 */
export function setComposerDraftText(text: string): void {
  act(() => {
    setAllComposerEditorsTextForTests(text);
  });
}

export function composerInput(): HTMLElement {
  return screen.getByTestId("terminal-composer-input");
}
