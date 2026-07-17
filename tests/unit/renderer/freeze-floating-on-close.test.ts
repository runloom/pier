import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeFloatingOnClose } from "../../../packages/ui/src/freeze-floating-on-close.ts";

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

function mountPopperContent(state: "closed" | "open"): {
  content: HTMLDivElement;
  wrapper: HTMLDivElement;
} {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-radix-popper-content-wrapper", "");
  wrapper.style.position = "fixed";
  wrapper.style.left = "180px";
  wrapper.style.top = "420px";
  wrapper.style.transform = "translate(0px, 0px)";
  wrapper.style.setProperty("--radix-popper-transform-origin", "160px 12px");

  const content = document.createElement("div");
  content.setAttribute("data-slot", "dropdown-menu-content");
  content.setAttribute("data-state", state);
  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  return { content, wrapper };
}

describe("freezeFloatingOnClose", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reapplies the last open geometry when layout mutates during close", async () => {
    const { content, wrapper } = mountPopperContent("open");
    const dispose = freezeFloatingOnClose(content);

    content.setAttribute("data-state", "closed");
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

    dispose();
  });

  it("keeps the previous open frame when layout jumps in the same turn as close", async () => {
    const { content, wrapper } = mountPopperContent("open");
    const dispose = freezeFloatingOnClose(content);

    // Commit the initial open geometry one frame behind pending writes.
    await flushAnimationFrame();

    // Same-turn layout mutation while still open (dockview reflow before
    // React paints data-state=closed), then close.
    wrapper.style.left = "0px";
    wrapper.style.top = "0px";
    wrapper.style.transform = "translate(0px, -200%)";
    wrapper.style.setProperty("--radix-popper-transform-origin", "0px 0px");
    await flushObservers();
    content.setAttribute("data-state", "closed");
    await flushObservers();

    expect(wrapper.style.left).toBe("180px");
    expect(wrapper.style.top).toBe("420px");
    expect(wrapper.style.transform).toBe("translate(0px, 0px)");
    expect(
      wrapper.style.getPropertyValue("--radix-popper-transform-origin")
    ).toBe("160px 12px");

    dispose();
  });

  it("keeps last open geometry across dispose and re-attach while closed", async () => {
    const { content, wrapper } = mountPopperContent("open");
    const disposeOpen = freezeFloatingOnClose(content);
    await flushAnimationFrame();

    content.setAttribute("data-state", "closed");
    await flushObservers();
    disposeOpen();

    // Parent re-render re-attaches freeze after Floating UI already jumped.
    wrapper.style.left = "0px";
    wrapper.style.top = "0px";
    wrapper.style.transform = "translate(0px, -200%)";
    wrapper.style.setProperty("--radix-popper-transform-origin", "0px 0px");
    const disposeClosed = freezeFloatingOnClose(content);
    await flushObservers();

    expect(wrapper.style.left).toBe("180px");
    expect(wrapper.style.top).toBe("420px");
    expect(wrapper.style.transform).toBe("translate(0px, 0px)");
    expect(
      wrapper.style.getPropertyValue("--radix-popper-transform-origin")
    ).toBe("160px 12px");

    disposeClosed();
  });

  it("does not freeze geometry while content is open", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        callback(0);
        return 1;
      }
    );
    const { content, wrapper } = mountPopperContent("open");
    const dispose = freezeFloatingOnClose(content);

    wrapper.style.left = "64px";
    wrapper.style.top = "96px";
    await flushObservers();

    expect(wrapper.style.left).toBe("64px");
    expect(wrapper.style.top).toBe("96px");

    dispose();
    vi.unstubAllGlobals();
  });

  it("no-ops when the popper wrapper is missing", () => {
    const content = document.createElement("div");
    content.setAttribute("data-state", "open");
    document.body.appendChild(content);
    expect(() => {
      const dispose = freezeFloatingOnClose(content);
      content.setAttribute("data-state", "closed");
      dispose();
    }).not.toThrow();
  });
});
