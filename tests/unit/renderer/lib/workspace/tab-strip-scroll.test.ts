import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureVisibleTabStripScrolls,
  createTabStripScrollMemory,
  prepareTabStripScrollsForMaximizeLayoutMutation,
  pruneTabStripScrollMemory,
  restoreTabStripScrolls,
  scheduleRestoreTabStripScrolls,
  setActiveTabStripScrollMemory,
  setTabStripRevealAbortHook,
} from "@/lib/workspace/tab-strip-scroll.ts";

function mountGroup(
  id: string,
  scrollLeft: number,
  clientWidth: number
): {
  element: HTMLElement;
  id: string;
  tabs: HTMLElement;
  setWidth: (w: number) => void;
} {
  const element = document.createElement("div");
  element.className = "dv-groupview";
  const tabs = document.createElement("div");
  tabs.className = "dv-tabs-container";
  let width = clientWidth;
  Object.defineProperty(tabs, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  tabs.scrollLeft = scrollLeft;
  element.append(tabs);
  document.body.append(element);
  return {
    element,
    id,
    tabs,
    setWidth: (next: number) => {
      width = next;
    },
  };
}

describe("tab strip scroll memory", () => {
  afterEach(() => {
    setActiveTabStripScrollMemory(null);
    setTabStripRevealAbortHook(null);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("captures scrollLeft only for laid-out (clientWidth > 0) strips", () => {
    const visible = mountGroup("g1", 120, 200);
    const hidden = mountGroup("g2", 80, 0);

    const saved = captureVisibleTabStripScrolls([visible, hidden]);

    expect(saved.get("g1")).toBe(120);
    expect(saved.has("g2")).toBe(false);
  });

  it("prunes memory keys for groups that no longer exist", () => {
    const map = new Map([
      ["g1", 10],
      ["gone", 99],
    ]);
    pruneTabStripScrollMemory(map, [mountGroup("g1", 0, 100)]);
    expect([...map.keys()]).toEqual(["g1"]);
  });

  it("restores remembered scrollLeft onto visible strips", () => {
    const group = mountGroup("g1", 0, 200);
    restoreTabStripScrolls([group], new Map([["g1", 96]]));
    expect(group.tabs.scrollLeft).toBe(96);
  });

  it("skips restore while the strip is still maximize-hidden", () => {
    const group = mountGroup("g1", 0, 0);
    restoreTabStripScrolls([group], new Map([["g1", 96]]));
    expect(group.tabs.scrollLeft).toBe(0);
  });

  it("schedules restore when strips re-acquire width (not nested multi-rAF)", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    let width = 0;
    const element = document.createElement("div");
    element.className = "dv-groupview";
    const tabs = document.createElement("div");
    tabs.className = "dv-tabs-container";
    Object.defineProperty(tabs, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    tabs.scrollLeft = 0;
    element.append(tabs);
    document.body.append(element);
    const group = { element, id: "g1", tabs };

    let settled = false;
    scheduleRestoreTabStripScrolls(
      () => [group],
      new Map([["g1", 64]]),
      () => {
        settled = true;
      }
    );

    expect(tabs.scrollLeft).toBe(0);
    expect(settled).toBe(false);

    width = 200;
    frames[0]?.(0);
    expect(tabs.scrollLeft).toBe(64);
    expect(settled).toBe(true);

    expect(frames.length).toBe(1);
    vi.advanceTimersByTime(300);
    expect(tabs.scrollLeft).toBe(64);
  });

  it("soft timeout does not force-complete while strips stay hidden", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);

    let width = 0;
    const element = document.createElement("div");
    element.className = "dv-groupview";
    const tabs = document.createElement("div");
    tabs.className = "dv-tabs-container";
    Object.defineProperty(tabs, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    element.append(tabs);
    document.body.append(element);
    const group = { element, id: "g1", tabs };

    let settled = false;
    scheduleRestoreTabStripScrolls(
      () => [group],
      new Map([["g1", 40]]),
      () => {
        settled = true;
      }
    );

    vi.advanceTimersByTime(250);
    expect(settled).toBe(false);

    width = 200;
    vi.advanceTimersByTime(2000);
    expect(tabs.scrollLeft).toBe(40);
    expect(settled).toBe(true);
  });

  it("freezes memory writes during maximize so zeroing cannot clobber offsets", () => {
    const group = mountGroup("g1", 140, 200);
    const memory = createTabStripScrollMemory({
      getGroups: () => [group],
      root: document.body,
    });

    group.tabs.scrollLeft = 140;
    group.tabs.dispatchEvent(new Event("scroll"));

    memory.freeze();
    group.tabs.scrollLeft = 0;
    // Dockview/browser zeroing fires scroll — must not dissolve freeze (issues 1–2).
    group.tabs.dispatchEvent(new Event("scroll"));
    memory.scheduleRestoreAndUnfreeze();
    expect(group.tabs.scrollLeft).toBe(140);
    memory.dispose();
  });

  it("P1 prepare survives freeze-hold scroll events with zero offset", () => {
    const group = mountGroup("g1", 200, 200);
    const memory = createTabStripScrollMemory({
      getGroups: () => [group],
      root: document.body,
    });
    setActiveTabStripScrollMemory(memory);

    group.tabs.scrollLeft = 200;
    group.tabs.dispatchEvent(new Event("scroll"));
    prepareTabStripScrollsForMaximizeLayoutMutation();

    group.tabs.scrollLeft = 0;
    group.tabs.dispatchEvent(new Event("scroll"));
    expect(memory.isLayoutRestoreInFlight()).toBe(false);

    memory.scheduleRestoreAndUnfreeze();
    expect(group.tabs.scrollLeft).toBe(200);
    memory.dispose();
  });

  it("updates memory from scroll events while unfrozen", () => {
    const group = mountGroup("g1", 0, 200);
    const memory = createTabStripScrollMemory({
      getGroups: () => [group],
      root: document.body,
    });

    group.tabs.scrollLeft = 55;
    group.tabs.dispatchEvent(new Event("scroll"));

    memory.freeze();
    group.tabs.scrollLeft = 0;
    memory.scheduleRestoreAndUnfreeze();
    expect(group.tabs.scrollLeft).toBe(55);
    memory.dispose();
  });

  it("P1 prepare snapshots all visible strips before hide", () => {
    const a = mountGroup("g1", 88, 200);
    const b = mountGroup("g2", 12, 200);
    const memory = createTabStripScrollMemory({
      getGroups: () => [a, b],
      root: document.body,
    });
    setActiveTabStripScrollMemory(memory);

    a.tabs.scrollLeft = 200;
    b.tabs.scrollLeft = 40;
    prepareTabStripScrollsForMaximizeLayoutMutation();

    a.tabs.scrollLeft = 0;
    b.tabs.scrollLeft = 0;
    memory.scheduleRestoreAndUnfreeze();

    expect(a.tabs.scrollLeft).toBe(200);
    expect(b.tabs.scrollLeft).toBe(40);
    memory.dispose();
  });

  it("P2 user scroll aborts in-flight restore (later settle does not win)", () => {
    vi.useFakeTimers();
    const group = mountGroup("g1", 99, 0);
    const memory = createTabStripScrollMemory({
      getGroups: () => [group],
      root: document.body,
    });
    group.setWidth(200);
    group.tabs.scrollLeft = 99;
    group.tabs.dispatchEvent(new Event("scroll"));
    group.setWidth(0);
    group.tabs.scrollLeft = 0;

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    memory.scheduleRestoreAndUnfreeze();
    expect(memory.isLayoutRestoreInFlight()).toBe(true);
    expect(group.tabs.scrollLeft).toBe(0);

    group.setWidth(200);
    group.tabs.scrollLeft = 30;
    group.tabs.dispatchEvent(new Event("scroll"));
    expect(memory.isLayoutRestoreInFlight()).toBe(false);

    frames[0]?.(0);
    vi.advanceTimersByTime(2000);
    expect(group.tabs.scrollLeft).toBe(30);
    memory.dispose();
  });

  it("P2 user scroll aborts scheduled reveal via hook when not frozen", () => {
    const abortReveal = vi.fn();
    setTabStripRevealAbortHook(abortReveal);
    const group = mountGroup("g1", 0, 200);
    const memory = createTabStripScrollMemory({
      getGroups: () => [group],
      root: document.body,
    });

    group.tabs.scrollLeft = 10;
    group.tabs.dispatchEvent(new Event("scroll"));

    expect(abortReveal).toHaveBeenCalled();
    memory.dispose();
  });

  it("prunes orphan memory keys on rememberVisible", () => {
    const g1 = mountGroup("g1", 12, 200);
    let groups = [g1];
    const memory = createTabStripScrollMemory({
      getGroups: () => groups,
      root: document.body,
    });
    g1.tabs.scrollLeft = 12;
    g1.tabs.dispatchEvent(new Event("scroll"));

    // Simulate group remove: only empty group list remains.
    groups = [];
    memory.rememberVisible();
    // Re-add g1 with no memory seed: seed should start at current scroll (0).
    const g1b = mountGroup("g1", 0, 200);
    groups = [g1b];
    memory.freeze();
    memory.scheduleRestoreAndUnfreeze();
    // No snapshot for g1 after prune → scroll stays 0.
    expect(g1b.tabs.scrollLeft).toBe(0);
    memory.dispose();
  });
});
