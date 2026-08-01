import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function flushObservers(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(() => {
    queueMicrotask(resolve);
  });
  return promise;
}

function flushAnimationFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => {
    resolve();
  });
  return promise;
}

describe("DropdownMenu freeze-on-close", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      disconnect(): void {
        // Test polyfill no-op.
      }
      observe(): void {
        // Test polyfill no-op.
      }
      unobserve(): void {
        // Test polyfill no-op.
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires freeze so closed content keeps its last open geometry", async () => {
    render(
      <div style={{ position: "relative", height: 480, width: 640 }}>
        <div style={{ position: "absolute", bottom: 12, left: 220 }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button">Git status</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem>View Changes</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Git status" }), {
      button: 0,
      pointerType: "mouse",
    });
    const menu = await screen.findByRole("menu");
    const wrapper = menu.closest(
      "[data-radix-popper-content-wrapper]"
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    if (!wrapper) {
      throw new Error("expected popper wrapper");
    }

    // Content ref may attach freeze one frame after the popper wrapper exists.
    await flushAnimationFrame();

    wrapper.style.left = "180px";
    wrapper.style.top = "420px";
    wrapper.style.transform = "translate(0px, 0px)";
    wrapper.style.setProperty("--radix-popper-transform-origin", "160px 12px");
    await flushObservers();
    await flushAnimationFrame();

    // Drive the closed state the freeze observer watches. In production this
    // happens while Presence keeps the node mounted for exit animation.
    menu.setAttribute("data-state", "closed");
    await flushObservers();

    wrapper.style.left = "0px";
    wrapper.style.top = "0px";
    wrapper.style.transform = "translate(0px, -200%)";
    wrapper.style.setProperty("--radix-popper-transform-origin", "0px 0px");
    await flushObservers();

    expect(wrapper.style.left).toBe("180px");
    expect(wrapper.style.top).toBe("420px");
    expect(wrapper.style.transform).toBe("translate(0px, 0px)");
    expect(
      wrapper.style.getPropertyValue("--radix-popper-transform-origin")
    ).toBe("160px 12px");
  });
});
