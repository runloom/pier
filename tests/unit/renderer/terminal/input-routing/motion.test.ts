import { describe, expect, it, vi } from "vitest";
import { bindScrimFade } from "@/stores/terminal-scrim/motion.ts";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function setAnimations(element: HTMLElement, read: () => Animation[]): void {
  Object.defineProperty(element, "getAnimations", {
    configurable: true,
    value: read,
  });
}

function transition(property: string): Animation {
  return {
    playState: "running",
    transitionProperty: property,
  } as unknown as Animation;
}

describe("bindScrimFade", () => {
  it("follows transform/height transitions while they run", async () => {
    const element = document.createElement("div");
    const flush = vi.fn();
    let animations = [transition("transform")];
    setAnimations(element, () => animations);

    const stop = bindScrimFade(element, flush);
    await nextFrame();
    expect(flush).toHaveBeenCalled();

    animations = [transition("height")];
    await nextFrame();
    expect(flush.mock.calls.length).toBeGreaterThan(1);

    animations = [];
    await nextFrame();
    await nextFrame();
    const calls = flush.mock.calls.length;
    await nextFrame();
    expect(flush).toHaveBeenCalledTimes(calls);
    stop();
  });

  it("does not keep following infinite transform animations", async () => {
    const element = document.createElement("div");
    const flush = vi.fn();
    setAnimations(element, () => [
      {
        playState: "running",
        getComputedTiming: () => ({ iterations: Number.POSITIVE_INFINITY }),
        getKeyframes: () => [{ transform: "translateY(0px)" }],
      } as unknown as Animation,
    ]);

    const stop = bindScrimFade(element, flush);
    await nextFrame();
    await nextFrame();
    expect(flush).not.toHaveBeenCalled();
    stop();
  });
});
