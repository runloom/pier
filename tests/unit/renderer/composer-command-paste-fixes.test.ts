import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
} from "lexical";
import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  $createAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import { $moveCaretAcrossComposerChip } from "@/panel-kits/terminal/structured-composer/composer-chip-caret.ts";
import { $deleteAdjacentComposerChip } from "@/panel-kits/terminal/structured-composer/mention-delete-plugin.tsx";
import { clipboardHasFilePayload } from "@/panel-kits/terminal/structured-composer/paste-plain-text-plugin.tsx";
import { WorkspacePathMentionNode } from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";
import { handleComposerPaste } from "@/panel-kits/terminal/terminal-composer-paste.ts";

function createTestEditor() {
  const editor = createEditor({
    namespace: "ChipCommandTest",
    nodes: [AttachmentTokenNode, WorkspacePathMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(document.createElement("div"));
  return editor;
}

describe("Lexical chip command handlers (no nested update)", () => {
  it("Backspace command returns true synchronously when deleting a chip", () => {
    const editor = createTestEditor();
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        // Mirrors MentionDeletePlugin: mutate inside the command update, no nest.
        const handled = $deleteAdjacentComposerChip("backward");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("xy");
      paragraph.append(chip, after);
      root.append(paragraph);
      after.select(0, 0);
    });

    const preventDefault = vi.fn();
    // Nested editor.update would leave this false and let DELETE_CHARACTER run.
    expect(
      editor.dispatchCommand(KEY_BACKSPACE_COMMAND, {
        preventDefault,
      } as unknown as KeyboardEvent)
    ).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("ArrowRight command returns true synchronously when crossing a chip", () => {
    const editor = createTestEditor();
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        const handled = $moveCaretAcrossComposerChip("right");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("!");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      before.select(2, 2);
    });

    const preventDefault = vi.fn();
    expect(
      editor.dispatchCommand(KEY_ARROW_RIGHT_COMMAND, {
        preventDefault,
        shiftKey: false,
      } as unknown as KeyboardEvent)
    ).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

describe("clipboardHasFilePayload", () => {
  it("detects FileList and file-kind items", () => {
    const withFiles = {
      files: { length: 1 } as FileList,
      items: [] as unknown as DataTransferItemList,
    } as DataTransfer;
    expect(clipboardHasFilePayload(withFiles)).toBe(true);

    const withImageItem = {
      files: { length: 0 } as FileList,
      items: [
        { kind: "file", type: "image/png" },
      ] as unknown as DataTransferItemList,
    } as DataTransfer;
    expect(clipboardHasFilePayload(withImageItem)).toBe(true);

    const plainOnly = {
      files: { length: 0 } as FileList,
      items: [
        { kind: "string", type: "text/plain" },
      ] as unknown as DataTransferItemList,
    } as DataTransfer;
    expect(clipboardHasFilePayload(plainOnly)).toBe(false);
  });
});

describe("handleComposerPaste file+plain", () => {
  it("inserts companion plain text without a string base rewrite", async () => {
    const insertPlainTextAtCursor = vi.fn();
    const collectFiles = vi.fn(async () => true);
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    const event = {
      clipboardData: {
        files: {
          0: file,
          item: () => file,
          length: 1,
          *[Symbol.iterator]() {
            yield file;
          },
        } as unknown as FileList,
        getData: () => "hello",
        items: [] as unknown as DataTransferItemList,
      },
      preventDefault: vi.fn(),
    } as unknown as ReactClipboardEvent;

    handleComposerPaste({
      collectFiles,
      disabled: false,
      dtoToAttachment: (dto) => ({
        id: dto.id,
        kind: dto.kind,
        name: dto.name,
        path: dto.path,
      }),
      enqueueMerge: async (task) => {
        await task();
      },
      event,
      insertPlainTextAtCursor,
      mergeAttachments: () => true,
      reportError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(collectFiles).toHaveBeenCalledOnce();
      expect(insertPlainTextAtCursor).toHaveBeenCalledWith("hello");
    });
    expect(insertPlainTextAtCursor.mock.calls[0]?.length).toBe(1);
  });
});
