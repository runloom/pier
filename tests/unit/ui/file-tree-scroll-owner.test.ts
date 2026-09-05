import {
  createFileTreeScrollOwner,
  FILE_TREE_USER_SCROLL_CLAIM_MS,
} from "@pier/ui/file/tree-scroll-owner.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createFileTreeScrollOwner", () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "queueMicrotask"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountScroller(): {
    host: HTMLElement;
    scroller: HTMLElement;
  } {
    const host = document.createElement("file-tree-container");
    host.setAttribute("data-slot", "pier-file-tree");
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.setAttribute("data-file-tree-virtualized-scroll", "true");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    shadow.append(scroller);
    document.body.append(host);
    return { host, scroller };
  }

  function createOwner(frameCallbacks: FrameRequestCallback[] = []) {
    return createFileTreeScrollOwner({
      now: () => nowMs,
      schedule: (callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
    });
  }

  it("recognizes a native scroll event after the write callback has returned", () => {
    const { host, scroller } = mountScroller();
    const owner = createOwner();
    owner.withProgrammaticScroll(() => {
      scroller.scrollTop = 100;
    }, scroller);

    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(true);
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(false);
    host.remove();
  });

  it("matches the final position when the browser coalesces host writes", () => {
    const { host, scroller } = mountScroller();
    const owner = createOwner();
    for (const top of [100, 200]) {
      owner.withProgrammaticScroll(() => {
        scroller.scrollTop = top;
      }, scroller);
    }
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(true);
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(false);
    host.remove();
  });

  it("does not attribute a different scrollbar position to a prior host write", () => {
    const { host, scroller } = mountScroller();
    const owner = createOwner();
    owner.withProgrammaticScroll(() => {
      scroller.scrollTop = 100;
    }, scroller);
    scroller.scrollTop = 140;
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(false);
    host.remove();
  });

  it("lets a user gesture invalidate a queued programmatic scroll event", () => {
    const { host, scroller } = mountScroller();
    const owner = createOwner();
    owner.withProgrammaticScroll(() => {
      scroller.scrollTop = 100;
    }, scroller);
    owner.claimUserScroll();
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(false);
    host.remove();
  });

  it("does not reserve a scroll event for an unchanged position", () => {
    const { host, scroller } = mountScroller();
    const owner = createOwner();
    owner.withProgrammaticScroll(() => {
      scroller.scrollTop = 0;
    }, scroller);
    expect(owner.isProgrammaticScrollEvent(scroller)).toBe(false);
    host.remove();
  });

  it("claimUserScroll aborts in-flight compensate writes", () => {
    const { host, scroller } = mountScroller();
    scroller.scrollTop = 0;
    const frameCallbacks: FrameRequestCallback[] = [];
    const owner = createOwner(frameCallbacks);

    owner.requestLayoutCompensate(host, {
      fallbackScrollTop: 100,
      kind: "position",
    });
    frameCallbacks.shift()?.(performance.now());
    expect(scroller.scrollTop).toBe(100);

    scroller.scrollTop = 40;
    owner.claimUserScroll();
    frameCallbacks.shift()?.(performance.now());
    expect(scroller.scrollTop).toBe(40);

    host.remove();
  });

  it("claimUserScroll ends reveal hold so compensate can run again", () => {
    const { host, scroller } = mountScroller();
    scroller.scrollTop = 10;
    const frameCallbacks: FrameRequestCallback[] = [];
    const owner = createOwner(frameCallbacks);

    owner.beginReveal();
    expect(owner.isRevealActive()).toBe(true);
    owner.requestLayoutCompensate(host, {
      fallbackScrollTop: 200,
      kind: "position",
    });
    expect(frameCallbacks).toHaveLength(0);

    owner.claimUserScroll();
    expect(owner.isRevealActive()).toBe(false);
    expect(owner.isUserScrolling()).toBe(true);

    nowMs += FILE_TREE_USER_SCROLL_CLAIM_MS + 1;
    expect(owner.isUserScrolling()).toBe(false);

    owner.requestLayoutCompensate(host, {
      fallbackScrollTop: 200,
      kind: "position",
    });
    frameCallbacks.shift()?.(performance.now());
    expect(scroller.scrollTop).toBe(200);

    host.remove();
  });

  it("claimUserScroll notifies subscribers (sticky reveal abort)", () => {
    const owner = createOwner();
    const listener = vi.fn();
    const unsubscribe = owner.subscribeUserClaim(listener);
    owner.claimUserScroll();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    owner.claimUserScroll();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips compensate while reveal is active", () => {
    const { host, scroller } = mountScroller();
    scroller.scrollTop = 10;
    const frameCallbacks: FrameRequestCallback[] = [];
    const owner = createOwner(frameCallbacks);

    owner.beginReveal();
    owner.requestLayoutCompensate(host, {
      fallbackScrollTop: 200,
      kind: "position",
    });
    expect(frameCallbacks).toHaveLength(0);
    expect(scroller.scrollTop).toBe(10);

    owner.endReveal();
    owner.requestLayoutCompensate(host, {
      fallbackScrollTop: 200,
      kind: "position",
    });
    frameCallbacks.shift()?.(performance.now());
    expect(scroller.scrollTop).toBe(200);

    host.remove();
  });

  it("user claim window expires after FILE_TREE_USER_SCROLL_CLAIM_MS", () => {
    const owner = createOwner();
    owner.claimUserScroll();
    expect(owner.isUserScrolling()).toBe(true);
    nowMs += FILE_TREE_USER_SCROLL_CLAIM_MS - 1;
    expect(owner.isUserScrolling()).toBe(true);
    nowMs += 2;
    expect(owner.isUserScrolling()).toBe(false);
  });

  it("newer restoreSnapshotSoon aborts the previous settle frame", () => {
    const { host, scroller } = mountScroller();
    const frameCallbacks: FrameRequestCallback[] = [];
    const owner = createOwner(frameCallbacks);

    owner.restoreSnapshotSoon(
      host,
      { fallbackScrollTop: 100, kind: "position" },
      { settleFrames: 1 }
    );
    owner.restoreSnapshotSoon(
      host,
      { fallbackScrollTop: 300, kind: "position" },
      { settleFrames: 1 }
    );

    frameCallbacks[0]?.(performance.now());
    expect(scroller.scrollTop).toBe(0);

    frameCallbacks[1]?.(performance.now());
    expect(scroller.scrollTop).toBe(300);

    host.remove();
  });

  it("menu pin restores jostle but user claim aborts further pin frames", () => {
    const { host, scroller } = mountScroller();
    scroller.scrollTop = 240;
    const frameCallbacks: FrameRequestCallback[] = [];
    const owner = createOwner(frameCallbacks);

    const endPin = owner.beginMenuPin(scroller);
    expect(owner.isMenuPinActive()).toBe(true);

    scroller.scrollTop = 100;
    vi.runAllTicks();
    expect(scroller.scrollTop).toBe(240);

    scroller.scrollTop = 50;
    owner.claimUserScroll();
    frameCallbacks.shift()?.(performance.now());
    frameCallbacks.shift()?.(performance.now());
    expect(scroller.scrollTop).toBe(50);
    expect(owner.isMenuPinActive()).toBe(false);

    endPin();
    expect(scroller.scrollTop).toBe(50);
    host.remove();
  });

  it("restores the menu anchor on close after the initial settle frames", () => {
    const { host, scroller } = mountScroller();
    scroller.scrollTop = 240;
    const frames: FrameRequestCallback[] = [];
    const owner = createOwner(frames);
    const close = owner.beginMenuPin(scroller);
    vi.runAllTicks();
    while (frames.length > 0) {
      frames.shift()?.(performance.now());
    }

    scroller.scrollTop = 120;
    close();

    expect(scroller.scrollTop).toBe(240);
    expect(owner.isMenuPinActive()).toBe(false);
    scroller.scrollTop = 80;
    close();
    expect(scroller.scrollTop).toBe(80);
    host.remove();
  });
});
