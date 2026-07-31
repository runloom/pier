import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
  $createAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import {
  $moveCaretAcrossComposerChip,
  $placeCaretAfterComposerChip,
  $placeCaretBeforeComposerChip,
} from "@/panel-kits/terminal/structured-composer/composer-chip-caret.ts";
import { WorkspacePathMentionNode } from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";

function withEditor(run: () => void): void {
  const editor = createEditor({
    namespace: "ChipCaretTest",
    nodes: [AttachmentTokenNode, WorkspacePathMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(run, { discrete: true });
}

describe("composer chip caret navigation", () => {
  it("moves right across a chip from preceding text", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("!");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      before.select(2, 2);

      expect($moveCaretAcrossComposerChip("right")).toBe(true);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(after);
        expect(selection.anchor.offset).toBe(0);
      }
    });
  });

  it("moves left across a chip from following text", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("!");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      after.select(0, 0);

      expect($moveCaretAcrossComposerChip("left")).toBe(true);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(before);
        expect(selection.anchor.offset).toBe(2);
      }
    });
  });

  it("places caret between adjacent chips via element offset", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const chipA = $createAttachmentTokenNode("/tmp/a.png", 1);
      const chipB = $createAttachmentTokenNode("/tmp/b.png", 2);
      paragraph.append(chipA, chipB);
      root.append(paragraph);
      $placeCaretAfterComposerChip(chipA);

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(paragraph);
        expect(selection.anchor.offset).toBe(1);
      }

      expect($moveCaretAcrossComposerChip("right")).toBe(true);
      const after = $getSelection();
      expect($isRangeSelection(after)).toBe(true);
      if ($isRangeSelection(after)) {
        expect(after.anchor.getNode()).toBe(paragraph);
        expect(after.anchor.offset).toBe(2);
      }

      $placeCaretBeforeComposerChip(chipB);
      const beforeB = $getSelection();
      expect($isRangeSelection(beforeB)).toBe(true);
      if ($isRangeSelection(beforeB)) {
        expect(beforeB.anchor.offset).toBe(1);
      }
    });
  });
});
