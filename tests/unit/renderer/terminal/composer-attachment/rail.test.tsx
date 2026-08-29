import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { TerminalComposerAttachmentRail } from "@/panel-kits/terminal/composer-attachment/rail.tsx";
import type { ComposerAttachment } from "@/panel-kits/terminal/composer-attachments-model.ts";

const openContentPreview = vi.fn();
vi.mock("@/components/common/content-preview.ts", () => ({
  openContentPreview: (...args: unknown[]) => openContentPreview(...args),
}));

function attachment(
  overrides: Partial<ComposerAttachment> & Pick<ComposerAttachment, "path">
): ComposerAttachment {
  const name = overrides.name ?? overrides.path.split("/").pop() ?? "file";
  return {
    id: overrides.id ?? overrides.path,
    kind: overrides.kind ?? "file",
    name,
    path: overrides.path,
    ...(overrides.isDirectory ? { isDirectory: true } : {}),
    ...(overrides.pasteContent ? { pasteContent: overrides.pasteContent } : {}),
    ...(overrides.pasteTier ? { pasteTier: overrides.pasteTier } : {}),
    ...(overrides.previewDataUrl
      ? { previewDataUrl: overrides.previewDataUrl }
      : {}),
    ...(overrides.previewHeight
      ? { previewHeight: overrides.previewHeight }
      : {}),
    ...(overrides.previewWidth ? { previewWidth: overrides.previewWidth } : {}),
    ...(overrides.textPreview ? { textPreview: overrides.textPreview } : {}),
  };
}

describe("TerminalComposerAttachmentRail", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("zh-CN");
    openContentPreview.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the full image with object-contain instead of cropping", () => {
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({
            kind: "image",
            name: "shot.png",
            path: "/tmp/shot.png",
            previewDataUrl: "data:image/png;base64,xx",
            previewHeight: 1080,
            previewWidth: 1920,
          }),
        ]}
        disabled={false}
        onEditPaste={vi.fn()}
        onRemove={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const tile = screen.getByTestId("terminal-composer-attachment-1");
    expect(tile.getAttribute("data-surface")).toBe("image");
    const img = tile.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("object-contain");
    expect(img?.className).not.toContain("object-cover");
    expect(tile.style.height).toBe("48px");
    expect(tile.style.width).toBe("48px");
  });

  it("shows a text snippet thumbnail for paste without a title", () => {
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({
            kind: "paste",
            name: "paste.txt",
            pasteContent: "function fix() {\n  return 1;\n}\n",
            pasteTier: "medium",
            path: "/tmp/paste-1.txt",
          }),
        ]}
        disabled={false}
        onEditPaste={vi.fn()}
        onRemove={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const tile = screen.getByTestId("terminal-composer-attachment-1");
    expect(tile.getAttribute("data-surface")).toBe("text");
    expect(tile.style.width).toBe("48px");
    expect(tile.style.height).toBe("48px");
    expect(tile.textContent).toContain("function fix()");
    expect(tile.textContent).toContain("return 1;");
    expect(tile.textContent).not.toContain("粘贴内容");
    expect(
      screen.getByRole("button", { name: "粘贴内容，第 1 个附件" })
    ).toBeTruthy();
  });

  it("does not paint filenames or ordinals on file tiles", () => {
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({
            kind: "file",
            name: "main.ts",
            path: "/tmp/main.ts",
            textPreview: "export function boot() {\n  return true;\n}",
          }),
          attachment({
            kind: "file",
            name: "notes.pdf",
            path: "/tmp/notes.pdf",
          }),
        ]}
        disabled={false}
        onEditPaste={vi.fn()}
        onRemove={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const textTile = screen.getByTestId("terminal-composer-attachment-1");
    const fileTile = screen.getByTestId("terminal-composer-attachment-2");
    expect(textTile.style.width).toBe("48px");
    expect(fileTile.style.width).toBe("48px");
    expect(textTile.getAttribute("data-surface")).toBe("text");
    expect(textTile.textContent).toContain("export function boot()");
    expect(textTile.textContent).not.toContain("main.ts");
    expect(fileTile.getAttribute("data-surface")).toBe("file");
    expect(fileTile.querySelector("[data-pier-file-icon]")).toBeTruthy();
    expect(fileTile.querySelector("span.truncate")).toBeNull();
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
    expect(screen.getByRole("button", { name: "main.ts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "notes.pdf" })).toBeTruthy();
  });

  it("scrolls the rail horizontally instead of wrapping", () => {
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({ kind: "file", name: "a.pdf", path: "/tmp/a.pdf" }),
          attachment({ kind: "file", name: "b.pdf", path: "/tmp/b.pdf" }),
        ]}
        disabled={false}
        onEditPaste={vi.fn()}
        onRemove={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const rail = screen.getByTestId("terminal-composer-attachment-rail");
    expect(rail.className).toContain("overflow-x-auto");
    expect(rail.className).toContain("flex-nowrap");
    expect(rail.className).toContain("p-1");
    expect(rail.className).not.toContain("flex-wrap");

    const remove = screen.getByTestId("terminal-composer-attachment-remove-1");
    expect(remove.className).toContain("pointer-events-none");
    expect(remove.className).toContain("group-hover/att:pointer-events-auto");
  });

  it("opens image preview, paste edit, and reveal on click", () => {
    const onEditPaste = vi.fn();
    const onReveal = vi.fn();
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({
            kind: "image",
            name: "shot.png",
            path: "/tmp/shot.png",
            previewDataUrl: "data:image/png;base64,xx",
            previewHeight: 10,
            previewWidth: 10,
          }),
          attachment({
            kind: "paste",
            name: "paste.txt",
            pasteContent: "hello paste",
            pasteTier: "medium",
            path: "/tmp/paste.txt",
          }),
          attachment({
            kind: "file",
            name: "notes.pdf",
            path: "/tmp/notes.pdf",
          }),
        ]}
        disabled={false}
        onEditPaste={onEditPaste}
        onRemove={vi.fn()}
        onReveal={onReveal}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "shot.png" }));
    expect(openContentPreview).toHaveBeenCalledTimes(1);
    expect(openContentPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          alt: "shot.png",
          placeholderSrc: "data:image/png;base64,xx",
          source: { kind: "absolutePath", path: "/tmp/shot.png" },
          type: "image",
        }),
      })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "粘贴内容，第 2 个附件" })
    );
    expect(onEditPaste).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "notes.pdf" }));
    expect(onReveal).toHaveBeenCalledWith("/tmp/notes.pdf");
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });

  it("keeps a failed image preview as an empty image frame", () => {
    const onReveal = vi.fn();
    render(
      <TerminalComposerAttachmentRail
        attachments={[
          attachment({
            kind: "image",
            name: "broken.svg",
            path: "/tmp/broken.svg",
          }),
        ]}
        disabled={false}
        onEditPaste={vi.fn()}
        onRemove={vi.fn()}
        onReveal={onReveal}
      />
    );

    const tile = screen.getByTestId("terminal-composer-attachment-1");
    expect(tile.getAttribute("data-surface")).toBe("image");
    expect(tile.style.width).toBe("48px");
    expect(tile.style.height).toBe("48px");
    expect(tile.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "broken.svg" }));
    expect(openContentPreview).toHaveBeenCalledTimes(1);
    expect(onReveal).not.toHaveBeenCalled();
  });
});
