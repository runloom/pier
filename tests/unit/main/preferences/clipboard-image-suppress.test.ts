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

  it("keeps text copied during the suppress window instead of restoring the snapshot", () => {
    clipboardState.text = "prior";
    clipboardState.imageEmpty = false;

    beginClipboardImageSuppress();
    // 模拟窗口期内其他写入者（用户 ⌘C / 终端 OSC 52）。
    clipboardState.text = "user-copy";
    vi.mocked(clipboard.write).mockClear();
    vi.mocked(clipboard.writeText).mockClear();

    endClipboardImageSuppress();
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboardState.text).toBe("user-copy");
  });

  it("keeps a raster written during the suppress window", () => {
    clipboardState.text = "prior";
    clipboardState.imageEmpty = false;

    beginClipboardImageSuppress();
    // begin 已剥离旧光栅；窗口期内出现的新光栅属于其他写入者。
    clipboardState.imageEmpty = false;
    vi.mocked(clipboard.write).mockClear();

    endClipboardImageSuppress();
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it("does not rewrite an unchanged text-only board on end", () => {
    clipboardState.text = "prior";
    clipboardState.imageEmpty = true;

    beginClipboardImageSuppress();
    vi.mocked(clipboard.write).mockClear();
    vi.mocked(clipboard.writeText).mockClear();
    vi.mocked(clipboard.clear).mockClear();

    endClipboardImageSuppress();
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(clipboardState.text).toBe("prior");
  });

  it("leaves an emptied board empty on end without a redundant clear", () => {
    clipboardState.text = "";
    clipboardState.imageEmpty = false;

    beginClipboardImageSuppress();
    expect(clipboard.clear).toHaveBeenCalledTimes(1);
    vi.mocked(clipboard.write).mockClear();
    vi.mocked(clipboard.clear).mockClear();

    endClipboardImageSuppress();
    // 快照有图：板未被他人写过 → 恢复光栅。
    expect(clipboard.write).toHaveBeenCalledTimes(1);
    expect(clipboard.clear).not.toHaveBeenCalled();
  });
});
