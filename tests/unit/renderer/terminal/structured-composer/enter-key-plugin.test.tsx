import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LexicalEditor } from "lexical";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterKeyPlugin } from "@/panel-kits/terminal/structured-composer/enter-key-plugin.tsx";
import {
  readLexicalPlainText,
  writeLexicalPlainText,
} from "@/panel-kits/terminal/structured-composer/serialize.ts";

function SeedDraft({ text }: { text: string }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    writeLexicalPlainText(editor, text);
  }, [editor, text]);
  return null;
}

function CaptureEditor({
  editorRef,
}: {
  editorRef: { current: LexicalEditor | null };
}): null {
  const [editor] = useLexicalComposerContext();
  editorRef.current = editor;
  return null;
}

describe("EnterKeyPlugin IME Enter", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not preventDefault or insert a linebreak on keyCode 229", () => {
    const onSend = vi.fn();
    const editorRef: { current: LexicalEditor | null } = { current: null };
    render(
      <LexicalComposer
        initialConfig={{
          namespace: "ime-enter-plugin",
          onError: (error) => {
            throw error;
          },
        }}
      >
        <PlainTextPlugin
          contentEditable={<ContentEditable data-testid="ime-enter-root" />}
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={null}
        />
        <CaptureEditor editorRef={editorRef} />
        <SeedDraft text="实" />
        <EnterKeyPlugin menuOpenRef={{ current: false }} onSend={onSend} />
      </LexicalComposer>
    );
    const root = screen.getByTestId("ime-enter-root");
    const allowed = fireEvent.keyDown(root, {
      isComposing: false,
      key: "Enter",
      keyCode: 229,
      which: 229,
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(allowed).toBe(true);
    expect(editorRef.current).not.toBeNull();
    expect(readLexicalPlainText(editorRef.current as LexicalEditor)).toBe("实");
  });
});
