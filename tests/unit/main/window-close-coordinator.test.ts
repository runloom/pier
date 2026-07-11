import type { AppWindow } from "@main/windows/app-window.ts";
import { WindowCloseCoordinator } from "@main/windows/window-close-coordinator.ts";
import { describe, expect, it, vi } from "vitest";

function fakeWindow(close: () => void): AppWindow {
  return { close, isDestroyed: () => false } as unknown as AppWindow;
}

describe("WindowCloseCoordinator", () => {
  it("settles every programmatic close waiter", async () => {
    const coordinator = new WindowCloseCoordinator();
    const window = fakeWindow(vi.fn());
    const first = coordinator.wait("main", window);
    const second = coordinator.wait("main", window);

    coordinator.resolve("main", "closed");

    await expect(first).resolves.toBe("closed");
    await expect(second).resolves.toBe("closed");
  });

  it("allows a retry after veto and bypasses the guard only after allow", async () => {
    const coordinator = new WindowCloseCoordinator();
    const close = vi.fn();
    const window = fakeWindow(close);
    let allow = false;
    coordinator.onBeforeClose(() => (allow ? "allow" : "veto"));

    expect(
      coordinator.intercept(window, "main", {
        recordId: "main",
        windowId: "main",
      })
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).not.toHaveBeenCalled();

    allow = true;
    expect(
      coordinator.intercept(window, "main", {
        recordId: "main",
        windowId: "main",
      })
    ).toBe(true);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
    expect(
      coordinator.intercept(window, "main", {
        recordId: "main",
        windowId: "main",
      })
    ).toBe(false);
  });

  it("returns veto instead of leaving waiters hanging when close throws", async () => {
    const coordinator = new WindowCloseCoordinator();
    const window = fakeWindow(() => {
      throw new Error("native close failed");
    });

    await expect(coordinator.wait("main", window)).resolves.toBe("veto");
  });
});
