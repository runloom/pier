import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("terminal drag overlay", () => {
  function installPierHarness() {
    const setOverlayActive = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          setOverlayActive,
        },
      },
    });
    return { setOverlayActive };
  }

  function createDockviewTab() {
    const tab = document.createElement("div");
    tab.className = "dv-tab";
    document.body.appendChild(tab);
    return tab;
  }

  function createDockviewSash() {
    const sash = document.createElement("div");
    sash.className = "dv-sash";
    document.body.appendChild(sash);
    return sash;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("releases the tab-drag overlay on drop even when dragend does not arrive", async () => {
    const { setOverlayActive } = installPierHarness();

    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    const tab = createDockviewTab();

    tab.dispatchEvent(new Event("dragstart", { bubbles: true }));
    expect(setOverlayActive).toHaveBeenCalledWith(true);

    document.dispatchEvent(new Event("drop", { bubbles: true }));
    await vi.runAllTimersAsync();

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("releases the tab-drag overlay on window blur when dragend and drop are lost", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewTab().dispatchEvent(
      new Event("dragstart", { bubbles: true })
    );

    window.dispatchEvent(new Event("blur"));

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("releases the tab-drag overlay when the document becomes hidden", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewTab().dispatchEvent(
      new Event("dragstart", { bubbles: true })
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("releases the tab-drag overlay on Escape", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewTab().dispatchEvent(
      new Event("dragstart", { bubbles: true })
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("releases the tab-drag overlay after the fallback timeout", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewTab().dispatchEvent(
      new Event("dragstart", { bubbles: true })
    );

    await vi.advanceTimersByTimeAsync(5000);

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("keeps an existing overlay active when a tab drag ends", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher, popOverlay, pushOverlay } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    pushOverlay();
    createDockviewTab().dispatchEvent(
      new Event("dragstart", { bubbles: true })
    );
    document.dispatchEvent(new Event("dragend", { bubbles: true }));

    expect(setOverlayActive).toHaveBeenCalledTimes(1);
    expect(setOverlayActive).toHaveBeenLastCalledWith(true);

    popOverlay();

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("releases the sash overlay on window blur when pointerup is lost", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewSash().dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true })
    );
    expect(setOverlayActive).toHaveBeenCalledWith(true);

    window.dispatchEvent(new Event("blur"));

    expect(setOverlayActive).toHaveBeenLastCalledWith(false);
  });

  it("only releases a sash overlay once if blur is followed by pointerup", async () => {
    const { setOverlayActive } = installPierHarness();
    const { installDragWatcher } = await import(
      "@/stores/terminal-overlay.store.ts"
    );
    installDragWatcher();

    createDockviewSash().dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true })
    );

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(setOverlayActive).toHaveBeenCalledTimes(2);
    expect(setOverlayActive).toHaveBeenNthCalledWith(1, true);
    expect(setOverlayActive).toHaveBeenNthCalledWith(2, false);
  });
});
