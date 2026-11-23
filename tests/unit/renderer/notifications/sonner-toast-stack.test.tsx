import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/primitives/sonner.tsx";
import { registerTerminalElementWebOverlay } from "@/stores/terminal-input-routing-slice.ts";

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  registerTerminalElementWebOverlay: vi.fn(() => ({
    dispose: vi.fn(),
    flush: vi.fn(),
  })),
}));

function mountedToasts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]")];
}

async function waitForToasts(count: number): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(mountedToasts()).toHaveLength(count);
  });
  return mountedToasts();
}

afterEach(() => {
  toast.dismiss();
});

describe("Sonner toast stack", () => {
  it("keeps the collapsed deck: only the front toast is interactive", async () => {
    render(<Toaster />);

    let frontId: string | number = 0;
    act(() => {
      toast("第一条");
      toast("第二条");
      toast("第三条");
      frontId = toast("第四条");
    });

    const toasts = await waitForToasts(4);
    const [front, second, third, hidden] = toasts as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    await waitFor(() => {
      expect(front.dataset.front).toBe("true");
      expect(front.dataset.expanded).toBe("false");
      expect(front.getAttribute("inert")).toBeNull();
      expect(front.getAttribute("tabindex")).toBe("0");
      expect(second.getAttribute("inert")).not.toBeNull();
      expect(third.getAttribute("inert")).not.toBeNull();
      expect(hidden.dataset.visible).toBe("false");
      expect(hidden.getAttribute("inert")).not.toBeNull();
      expect(hidden.getAttribute("tabindex")).toBe("-1");
    });
    // 隐藏的最旧一条不登记终端洞，只有每列可见的 3 条有命中区。
    expect(vi.mocked(registerTerminalElementWebOverlay)).toHaveBeenCalledTimes(
      3
    );

    // 悬停展开是 Sonner 原生行为：所有可见条恢复交互。
    fireEvent.mouseEnter(front.parentElement as HTMLElement);
    await waitFor(() => {
      expect(front.dataset.expanded).toBe("true");
      expect(second.getAttribute("inert")).toBeNull();
      expect(third.getAttribute("inert")).toBeNull();
    });

    // 前条消失后，最旧一条从隐藏集合进入可见集合并登记终端洞。
    act(() => {
      toast.dismiss(frontId);
    });
    await waitFor(() => {
      const next = mountedToasts();
      expect(next).toHaveLength(3);
      expect(next[0]?.dataset.visible).not.toBe("false");
      expect(next[2]?.dataset.visible).not.toBe("false");
    });
    await waitFor(() => {
      expect(
        vi.mocked(registerTerminalElementWebOverlay)
      ).toHaveBeenCalledTimes(4);
    });
  });
});
