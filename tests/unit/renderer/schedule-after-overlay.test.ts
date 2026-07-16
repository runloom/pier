import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleAfterOverlay } from "../../../packages/ui/src/schedule-after-overlay.ts";

describe("scheduleAfterOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    document.body.style.pointerEvents = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    document.body.style.pointerEvents = "";
  });

  it("does not run the task in the same turn", () => {
    const task = vi.fn();
    scheduleAfterOverlay(task);
    expect(task).not.toHaveBeenCalled();
  });

  it("runs after the next clear frame when nothing blocks", () => {
    const task = vi.fn();
    scheduleAfterOverlay(task);
    vi.runAllTimers();
    expect(task).toHaveBeenCalledOnce();
  });

  it("waits for body unlock and overlay removal", () => {
    const task = vi.fn();
    document.body.style.pointerEvents = "none";
    const menu = document.createElement("div");
    menu.setAttribute("data-slot", "dropdown-menu-content");
    document.body.append(menu);

    scheduleAfterOverlay(task);
    vi.runOnlyPendingTimers();
    expect(task).not.toHaveBeenCalled();

    menu.remove();
    document.body.style.pointerEvents = "";
    vi.runAllTimers();
    expect(task).toHaveBeenCalledOnce();
  });

  it("does not treat parent dialog body lock as blocking", () => {
    const task = vi.fn();
    document.body.style.pointerEvents = "none";
    const parent = document.createElement("div");
    parent.setAttribute("data-slot", "dialog-content");
    document.body.append(parent);

    scheduleAfterOverlay(task);
    vi.runAllTimers();
    expect(task).toHaveBeenCalledOnce();
  });

  it("abandons instead of force-running when still blocked after timeout", () => {
    const task = vi.fn();
    const onAbandon = vi.fn();
    document.body.style.pointerEvents = "none";

    scheduleAfterOverlay(task, { onAbandon });
    vi.advanceTimersByTime(1200);

    expect(task).not.toHaveBeenCalled();
    expect(onAbandon).toHaveBeenCalledOnce();
  });

  it("cancel prevents a pending task from running", () => {
    const task = vi.fn();
    const cancel = scheduleAfterOverlay(task);
    cancel();
    vi.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });
});
