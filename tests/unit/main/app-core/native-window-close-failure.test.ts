import {
  isRendererUnreachableCloseError,
  showNativeWindowCloseFailure,
} from "@main/windows/native-close-failure.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getLocale: vi.fn(() => "zh-CN"),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

describe("native-window-close-failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects unreachable renderer close errors", () => {
    expect(
      isRendererUnreachableCloseError(new Error("renderer command timed out"))
    ).toBe(true);
    expect(
      isRendererUnreachableCloseError(new Error("no renderer window available"))
    ).toBe(true);
    expect(
      isRendererUnreachableCloseError(new Error("draft flush failed"))
    ).toBe(false);
  });

  it("offers force-close and returns the user decision", async () => {
    const showMessageBox = vi.fn(async () => ({
      checkboxChecked: false,
      response: 0,
    }));
    const decision = await showNativeWindowCloseFailure(
      {
        closeError: new Error("renderer command timed out"),
        feedbackError: new Error("renderer command timed out"),
        windowId: "main",
      },
      showMessageBox
    );
    expect(decision).toBe("force-close");
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["强制关闭窗口", "取消"],
        title: "无法关闭窗口",
      })
    );
  });

  it("returns dismiss when the user cancels", async () => {
    const showMessageBox = vi.fn(async () => ({
      checkboxChecked: false,
      response: 1,
    }));
    await expect(
      showNativeWindowCloseFailure(
        {
          closeError: new Error("renderer command timed out"),
          feedbackError: new Error("renderer command timed out"),
          windowId: "w-2",
        },
        showMessageBox
      )
    ).resolves.toBe("dismiss");
  });
});
