import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from "lexical";
import { describe, expect, it, vi } from "vitest";
import {
  $createAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import {
  $moveCaretAcrossComposerChip,
  $moveCaretByWordAcrossChips,
  $moveCaretToBlockEndAroundChips,
  $moveCaretToBlockStartAroundChips,
  $moveOrExtendAcrossComposerChip,
  $placeCaretAfterComposerChip,
  $placeCaretBeforeComposerChip,
  COMPOSER_CHIP_HOST_SELECTOR,
  isComposerLineEdgeKey,
  isComposerWordMoveArrow,
} from "@/panel-kits/terminal/structured-composer/composer-chip-caret.ts";
import { COMPOSER_CHIP_HOST_CLASS } from "@/panel-kits/terminal/structured-composer/composer-chip-styles.ts";
import {
  $createReviewCommentsChipNode,
  ReviewCommentsChipNode,
} from "@/panel-kits/terminal/structured-composer/review-comments-chip-node.tsx";
import {
  $createSkillMentionNode,
  SkillMentionNode,
} from "@/panel-kits/terminal/structured-composer/skill-mention-node.tsx";
import { WorkspacePathMentionNode } from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";

function withEditor(run: () => void): void {
  const editor = createEditor({
    namespace: "ChipCaretTest",
    nodes: [
      AttachmentTokenNode,
      WorkspacePathMentionNode,
      SkillMentionNode,
      ReviewCommentsChipNode,
    ],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(run, { discrete: true });
}

function fakeKeyEvent(overrides: { shiftKey?: boolean } = {}): KeyboardEvent {
  return {
    preventDefault: vi.fn(),
    shiftKey: overrides.shiftKey ?? false,
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
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

  it("Cmd+Left (MOVE_TO_START) jumps before a leading attachment chip", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("如图这里再");
      paragraph.append(chip, after);
      root.append(paragraph);
      after.select(2, 2);

      const event = fakeKeyEvent();
      expect($moveCaretToBlockStartAroundChips(event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopPropagation).not.toHaveBeenCalled();

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(paragraph);
        expect(selection.anchor.offset).toBe(0);
        expect(selection.isCollapsed()).toBe(true);
      }
    });
  });

  it("Cmd+Left is a no-op when the block does not start with a chip", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const text = $createTextNode("hello");
      paragraph.append(text);
      root.append(paragraph);
      text.select(3, 3);

      expect($moveCaretToBlockStartAroundChips(fakeKeyEvent())).toBe(false);
    });
  });

  it("Cmd+Left does not jump to paragraph start from a later LineBreak line", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const line1 = $createTextNode("first");
      const br = $createLineBreakNode();
      const line2 = $createTextNode("second");
      paragraph.append(chip, line1, br, line2);
      root.append(paragraph);
      line2.select(2, 2);

      expect($moveCaretToBlockStartAroundChips(fakeKeyEvent())).toBe(false);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(line2);
        expect(selection.anchor.offset).toBe(2);
      }
    });
  });

  it("Cmd+Right (MOVE_TO_END) jumps past a trailing attachment chip", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      paragraph.append(before, chip);
      root.append(paragraph);
      before.select(1, 1);

      const event = fakeKeyEvent();
      expect($moveCaretToBlockEndAroundChips(event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(paragraph);
        expect(selection.anchor.offset).toBe(2);
        expect(selection.isCollapsed()).toBe(true);
      }
    });
  });

  it("Cmd+Right does not jump to paragraph end when a LineBreak lies after focus", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      // last child is trailing chip, but caret is on an earlier line.
      const line1 = $createTextNode("aa");
      const br = $createLineBreakNode();
      const line2 = $createTextNode("bb");
      const trailing = $createAttachmentTokenNode("/tmp/b.png", 2);
      paragraph.append(line1, br, line2, trailing);
      root.append(paragraph);
      line1.select(1, 1);

      expect($moveCaretToBlockEndAroundChips(fakeKeyEvent())).toBe(false);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(line1);
        expect(selection.anchor.offset).toBe(1);
      }
    });
  });

  it("Shift+Cmd+Left extends selection to before the leading chip", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("abc");
      paragraph.append(chip, after);
      root.append(paragraph);
      after.select(2, 2);

      expect(
        $moveCaretToBlockStartAroundChips(fakeKeyEvent({ shiftKey: true }))
      ).toBe(true);

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.isCollapsed()).toBe(false);
        expect(selection.focus.getNode()).toBe(paragraph);
        expect(selection.focus.offset).toBe(0);
        expect(selection.anchor.getNode()).toBe(after);
        expect(selection.anchor.offset).toBe(2);
      }
    });
  });

  it("Option+Left at text after a chip jumps before the chip as one word", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("world");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      after.select(0, 0);

      const event = fakeKeyEvent();
      expect($moveCaretByWordAcrossChips("left", event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(before);
        expect(selection.anchor.offset).toBe(2);
        expect(selection.isCollapsed()).toBe(true);
      }
    });
  });

  it("Option+Right at text before a chip jumps after the chip as one word", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("world");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      before.select(2, 2);

      const event = fakeKeyEvent();
      expect($moveCaretByWordAcrossChips("right", event)).toBe(true);

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.getNode()).toBe(after);
        expect(selection.anchor.offset).toBe(0);
      }
    });
  });

  it("Shift+Option+Left at chip edge extends without collapsing", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("hi");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("world");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      after.select(0, 0);

      const event = fakeKeyEvent({ shiftKey: true });
      expect($moveCaretByWordAcrossChips("left", event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.isCollapsed()).toBe(false);
        expect(selection.anchor.getNode()).toBe(after);
        expect(selection.anchor.offset).toBe(0);
        expect(selection.focus.getNode()).toBe(before);
        expect(selection.focus.offset).toBe(2);
      }
    });
  });

  it("Shift+Option extend across chip via $moveOrExtendAcrossComposerChip", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("ab");
      const chip = $createAttachmentTokenNode("/tmp/a.png", 1);
      const after = $createTextNode("cd");
      paragraph.append(before, chip, after);
      root.append(paragraph);
      after.select(0, 0);

      expect($moveOrExtendAcrossComposerChip("left", true)).toBe(true);
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.isCollapsed()).toBe(false);
        expect(selection.anchor.getNode()).toBe(after);
        expect(selection.focus.getNode()).toBe(before);
        expect(selection.focus.offset).toBe(2);
      }
    });
  });

  it("Option+arrow returns false when the block has no chips (native word)", () => {
    withEditor(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const text = $createTextNode("hello world");
      paragraph.append(text);
      root.append(paragraph);
      text.select(5, 5);

      const event = fakeKeyEvent();
      expect($moveCaretByWordAcrossChips("left", event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  it("isComposerWordMoveArrow matches Option/Alt + arrows only", () => {
    expect(
      isComposerWordMoveArrow({
        altKey: true,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: false,
      } as KeyboardEvent)
    ).toBe("left");
    expect(
      isComposerWordMoveArrow({
        altKey: true,
        ctrlKey: false,
        key: "ArrowRight",
        metaKey: false,
      } as KeyboardEvent)
    ).toBe("right");
    expect(
      isComposerWordMoveArrow({
        altKey: true,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: true,
      } as KeyboardEvent)
    ).toBeNull();
    expect(
      isComposerWordMoveArrow({
        altKey: false,
        ctrlKey: false,
        key: "ArrowLeft",
        metaKey: false,
      } as KeyboardEvent)
    ).toBeNull();
  });

  it("isComposerLineEdgeKey matches bare Home/End", () => {
    expect(
      isComposerLineEdgeKey({
        altKey: false,
        ctrlKey: false,
        key: "Home",
        metaKey: false,
      } as KeyboardEvent)
    ).toBe("start");
    expect(
      isComposerLineEdgeKey({
        altKey: false,
        ctrlKey: false,
        key: "End",
        metaKey: false,
      } as KeyboardEvent)
    ).toBe("end");
    expect(
      isComposerLineEdgeKey({
        altKey: false,
        ctrlKey: false,
        key: "Home",
        metaKey: true,
      } as KeyboardEvent)
    ).toBeNull();
  });

  it("COMPOSER_CHIP_HOST_SELECTOR matches shared host class used by all chip types", () => {
    expect(COMPOSER_CHIP_HOST_SELECTOR).toBe(`.${COMPOSER_CHIP_HOST_CLASS}`);
    expect(COMPOSER_CHIP_HOST_CLASS).toBe("composer-ref-chip-host");
    // All four chip kinds register createDOM with COMPOSER_CHIP_HOST_CLASS —
    // constructing each type stays green if a node is deleted from the union.
    withEditor(() => {
      expect($createAttachmentTokenNode("/tmp/a.png", 1).getType()).toBe(
        "attachment-token"
      );
      expect($createSkillMentionNode("demo", "/demo").getType()).toBe(
        "skill-mention"
      );
      expect(
        $createReviewCommentsChipNode(2, "2 comments", "payload").getType()
      ).toBe("review-comments-chip");
    });
  });
});
