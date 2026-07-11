import {
  AUTO_HIDE_SCROLLBAR_IDLE_MS,
  installAutoHideScrollbar,
  installDocumentAutoHideScrollbars,
} from "@pier/ui/auto-hide-scrollbar.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("auto-hide scrollbar behavior", () => {
  it("shows a directly observed scroller during activity and hides it after idle", () => {
    vi.useFakeTimers();
    const scroller = document.createElement("div");
    const uninstall = installAutoHideScrollbar(scroller);

    scroller.dispatchEvent(new Event("scroll"));
    expect(scroller).toHaveAttribute("data-scrollbar-scrolling", "true");

    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS - 1);
    expect(scroller).toHaveAttribute("data-scrollbar-scrolling", "true");
    vi.advanceTimersByTime(1);
    expect(scroller).not.toHaveAttribute("data-scrollbar-scrolling");

    uninstall();
  });

  it("extends visibility when scrolling continues", () => {
    vi.useFakeTimers();
    const scroller = document.createElement("div");
    const uninstall = installAutoHideScrollbar(scroller);

    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS - 100);
    scroller.dispatchEvent(new WheelEvent("wheel"));
    vi.advanceTimersByTime(100);
    expect(scroller).toHaveAttribute("data-scrollbar-scrolling", "true");
    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS - 100);
    expect(scroller).not.toHaveAttribute("data-scrollbar-scrolling");

    uninstall();
  });

  it("delegates activity to dynamic policy containers and ignores hidden scrollbars", () => {
    vi.useFakeTimers();
    const uninstall = installDocumentAutoHideScrollbars(document);
    const scroller = document.createElement("div");
    scroller.dataset.scrollbar = "stable";
    const child = document.createElement("div");
    scroller.append(child);
    document.body.append(scroller);

    child.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(scroller).toHaveAttribute("data-scrollbar-scrolling", "true");

    const hidden = document.createElement("div");
    hidden.dataset.scrollbar = "none";
    document.body.append(hidden);
    hidden.dispatchEvent(new Event("scroll"));
    expect(hidden).not.toHaveAttribute("data-scrollbar-scrolling");

    scroller.remove();
    uninstall();
    vi.advanceTimersByTime(AUTO_HIDE_SCROLLBAR_IDLE_MS);
    expect(scroller).not.toHaveAttribute("data-scrollbar-scrolling");

    const afterUninstall = document.createElement("div");
    afterUninstall.dataset.scrollbar = "stable";
    document.body.append(afterUninstall);
    afterUninstall.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    expect(afterUninstall).not.toHaveAttribute("data-scrollbar-scrolling");
  });

  it("reveals only when the pointer enters the scrollbar gutter", () => {
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      clientWidth: { configurable: true, value: 189 },
      offsetHeight: { configurable: true, value: 100 },
      offsetWidth: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollWidth: { configurable: true, value: 189 },
    });
    scroller.getBoundingClientRect = () =>
      ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 200,
        top: 0,
        width: 200,
        x: 0,
        y: 0,
      }) as DOMRect;
    const uninstall = installAutoHideScrollbar(scroller);

    scroller.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 100, clientY: 40 })
    );
    expect(scroller).not.toHaveAttribute("data-scrollbar-hovering");

    scroller.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 195, clientY: 40 })
    );
    expect(scroller).toHaveAttribute("data-scrollbar-hovering", "true");

    scroller.dispatchEvent(new MouseEvent("pointerleave"));
    expect(scroller).not.toHaveAttribute("data-scrollbar-hovering");
    uninstall();
  });
});
