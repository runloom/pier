import {
  beginClipboardImageSuppress,
  endClipboardImageSuppress,
  resetClipboardImageSuppressForTests,
} from "@main/ipc/clipboard-image-suppress.ts";
import { clipboard } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboardState = {
  imageEmpty: true,
  text: "",
};

vi.mock("electron", () => ({
  clipboard: {
    clear: vi.fn(() => {
      clipboardState.imageEmpty = true;
      clipboardState.text = "";
    }),
    readImage: vi.fn(() => ({
      isEmpty: () => clipboardState.imageEmpty,
    })),
    readText: vi.fn(() => clipboardState.text),
    write: vi.fn(
      (payload: { image?: { isEmpty: () => boolean }; text?: string }) => {
        if (typeof payload.text === "string") {
          clipboardState.text = payload.text;
        }
        if (payload.image) {
          clipboardState.imageEmpty = payload.image.isEmpty();
        }
      }
    ),
    writeText: vi.fn((value: string) => {
      clipboardState.text = value;
      clipboardState.imageEmpty = true;
    }),
  },
}));

describe("clipboard-image-suppress", () => {
  beforeEach(() => {
    clipboardState.imageEmpty = true;
    clipboardState.text = "";
    resetClipboardImageSuppressForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetClipboardImageSuppressForTests();
  });

  it("forces text-only pasteboard then restores image on end", () => {
    clipboardState.text = "prior";
    clipboardState.imageEmpty = false;

    beginClipboardImageSuppress();
    expect(clipboard.writeText).toHaveBeenCalledWith("prior");
    expect(clipboardState.imageEmpty).toBe(true);

    endClipboardImageSuppress();
    expect(clipboard.write).toHaveBeenCalledWith({
      image: expect.anything(),
      text: "prior",
    });
  });

  it("restores only after the outermost end", () => {
    clipboardState.text = "shot";
    clipboardState.imageEmpty = false;

    beginClipboardImageSuppress();
    beginClipboardImageSuppress();
    vi.mocked(clipboard.write).mockClear();
    endClipboardImageSuppress();
    expect(clipboard.write).not.toHaveBeenCalled();
    endClipboardImageSuppress();
    expect(clipboard.write).toHaveBeenCalledTimes(1);
  });
});
