import { describe, expect, it } from "vitest";
import {
  resolveComposerAttachmentSurface,
  textSnippetForAttachment,
} from "@/panel-kits/terminal/composer-attachment/tile.tsx";
import type { ComposerAttachment } from "@/panel-kits/terminal/composer-attachments-model.ts";

function attachment(
  overrides: Partial<ComposerAttachment> & Pick<ComposerAttachment, "path">
): ComposerAttachment {
  const name = overrides.name ?? overrides.path.split("/").pop() ?? "file";
  return {
    id: overrides.id ?? overrides.path,
    kind: overrides.kind ?? "file",
    name,
    path: overrides.path,
    ...overrides,
  };
}

describe("resolveComposerAttachmentSurface", () => {
  it("keeps image kind as image even without a thumbnail", () => {
    expect(
      resolveComposerAttachmentSurface(
        attachment({ kind: "image", path: "/tmp/broken.svg" })
      )
    ).toBe("image");
  });

  it("keeps paste kind as text when the snippet clips empty", () => {
    const att = attachment({
      kind: "paste",
      pasteContent: " \n\t",
      path: "/tmp/paste.txt",
    });
    expect(textSnippetForAttachment(att)).toBe("");
    expect(resolveComposerAttachmentSurface(att)).toBe("text");
  });

  it("uses the text surface for files with a clipped preview", () => {
    expect(
      resolveComposerAttachmentSurface(
        attachment({
          kind: "file",
          path: "/tmp/main.ts",
          textPreview: "export const x = 1;",
        })
      )
    ).toBe("text");
  });

  it("uses persisted textPreview without scanning pasteContent", () => {
    expect(
      textSnippetForAttachment(
        attachment({
          kind: "paste",
          pasteContent: "ignored body\n".repeat(2000),
          path: "/tmp/paste.txt",
          textPreview: "cached snippet",
        })
      )
    ).toBe("cached snippet");
  });
});
