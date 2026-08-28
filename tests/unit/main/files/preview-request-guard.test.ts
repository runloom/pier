import { registerPreviewRequestGuards } from "@main/files/preview-request-guard.ts";
import { HTML_PREVIEW_SCHEME } from "@shared/contracts/file/html-preview-url.ts";
import { FILE_PREVIEW_SCHEME } from "@shared/file-preview-url.ts";
import { describe, expect, it, vi } from "vitest";

describe("registerPreviewRequestGuards", () => {
  it("registers one onBeforeRequest listener for both preview schemes", () => {
    const onBeforeRequest = vi.fn();
    registerPreviewRequestGuards({
      storagePath: "in-memory",
      webRequest: { onBeforeRequest },
    } as never);

    expect(onBeforeRequest).toHaveBeenCalledOnce();
    expect(onBeforeRequest.mock.calls[0]?.[0]).toEqual({
      urls: [
        `${FILE_PREVIEW_SCHEME}://file/*`,
        `${HTML_PREVIEW_SCHEME}://preview/*`,
      ],
    });
  });

  it("cancels unauthorized file and html preview requests", () => {
    const onBeforeRequest = vi.fn();
    registerPreviewRequestGuards({
      storagePath: "in-memory",
      webRequest: { onBeforeRequest },
    } as never);
    const listener = onBeforeRequest.mock.calls[0]?.[1] as (
      details: { url: string; webContentsId: number },
      callback: (response: { cancel: boolean }) => void
    ) => void;
    const callback = vi.fn();

    listener(
      {
        url: `${FILE_PREVIEW_SCHEME}://file/aaaaaaaaaaaaaaaaaaaaaa`,
        webContentsId: 1,
      },
      callback
    );
    listener(
      {
        url: `${HTML_PREVIEW_SCHEME}://preview/aaaaaaaaaaaaaaaaaaaaaa/index.html`,
        webContentsId: 1,
      },
      callback
    );

    expect(callback).toHaveBeenNthCalledWith(1, { cancel: true });
    expect(callback).toHaveBeenNthCalledWith(2, { cancel: true });
  });
});
