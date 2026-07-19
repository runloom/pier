import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@shared/logger.ts", () => ({
  createLogger: () => ({ error: mocks.error, warn: mocks.warn }),
}));
vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    close: vi.fn(),
    findInternalIdByWindow: vi.fn(),
    fromWebContents: mocks.fromWebContents,
  },
}));
vi.mock("@main/windows/window-identity.ts", () => ({
  findWindowContext: () => ({
    recordId: "record-main",
    windowId: "main",
  }),
}));

import { registerWindowIpc } from "@main/ipc/window.ts";

describe("window renderer runtime failure IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromWebContents.mockReturnValue({ id: 42 });
  });

  it("persists a bounded report only for a known Pier window", () => {
    registerWindowIpc({ handle: mocks.handle, on: mocks.on } as never);
    const listener = mocks.on.mock.calls.find(
      ([channel]) => channel === "pier://window:renderer-runtime-failure"
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { sender: { id: 7 } },
      {
        message: "render failed",
        name: "TypeError",
        stack: "TypeError: render failed",
      }
    );
    expect(mocks.error).toHaveBeenCalledWith("React root failed", {
      message: "render failed",
      name: "TypeError",
      recordId: "record-main",
      stack: "TypeError: render failed",
      windowId: "main",
    });
    expect(mocks.warn).not.toHaveBeenCalled();

    mocks.fromWebContents.mockReturnValueOnce(null);
    listener?.({ sender: { id: 8 } }, { message: "foreign", name: "Error" });
    expect(mocks.warn).toHaveBeenCalledWith(
      "Dropped renderer runtime failure: unknown window",
      { senderId: 8 }
    );

    listener?.({ sender: { id: 7 } }, { message: "", name: "Error" });
    expect(mocks.warn).toHaveBeenCalledWith(
      "Dropped renderer runtime failure: invalid payload",
      { senderId: 7 }
    );
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
