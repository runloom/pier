import {
  TerminalOverlayContext,
  useTerminalOverlay,
  useTerminalOverlayRegistration,
} from "@pier/ui/use-terminal-overlay.tsx";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import {
  registerTerminalElementWebOverlay,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";
import { readOverlayRadiusPx } from "@/stores/terminal-scrim/appearance.ts";
import {
  parseCssColor,
  readScrimColor,
} from "@/stores/terminal-scrim/color.ts";
import { readOverlayShadows } from "@/stores/terminal-scrim/shadow.ts";

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

/**
 * jsdom 的 getBoundingClientRect 全返回 0，而 store 会跳过 width/height <= 0 的
 * 矩形（cssDomRectToTerminalFrame 返回 null）。给元素一个非零尺寸才会真正注册几何。
 */
function makeSizedElement(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      bottom: 70,
      height: 50,
      left: 10,
      right: 110,
      toJSON: () => ({}),
      top: 20,
      width: 100,
      x: 10,
      y: 20,
    }) as DOMRect;
  return el;
}

function snapshot() {
  return getLastTerminalHostSnapshot();
}

const registry = {
  registerElement: registerTerminalElementWebOverlay,
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    TerminalOverlayContext.Provider,
    { value: registry },
    children
  );
}

describe("parseCssColor", () => {
  it("converts the Chromium oklab scrim serialization to sRGB", () => {
    // Electron getComputedStyle 对 --overlay-scrim 给出 oklab()。
    // 不透明采样：oklab(0.985 0 0) → 250,250,250；oklab(0.145 0 0) → 10,10,10。
    // 带 alpha 的 canvas 像素会被预乘取整，不能拿来对照。
    const dark = parseCssColor("oklab(0.985 0 0 / 0.1)");
    expect(dark?.a).toBeCloseTo(0.1);
    expect(dark?.r).toBeCloseTo(250 / 255, 3);
    expect(dark?.g).toBeCloseTo(250 / 255, 3);
    expect(dark?.b).toBeCloseTo(250 / 255, 3);

    const light = parseCssColor("oklab(0.145 0 0 / 0.22)");
    expect(light?.a).toBeCloseTo(0.22);
    expect(light?.r).toBeCloseTo(10 / 255, 3);
    expect(light?.g).toBeCloseTo(10 / 255, 3);
    expect(light?.b).toBeCloseTo(10 / 255, 3);
  });

  it("scales the scrim alpha by the element's current opacity", () => {
    // 蒙层淡入改的是 opacity，不是 background。native 若只读 background，
    // 终端洞一上来就是终值，底部状态栏（洞外，跟着网页 opacity）还在淡。
    const el = document.createElement("div");
    el.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    el.style.opacity = "0.5";
    document.body.append(el);

    expect(readScrimColor(el)?.a).toBeCloseTo(0.05);
    expect(readScrimColor(el)?.r).toBeCloseTo(1);

    el.remove();
  });

  it("accepts the computed-style grammar Chromium actually emits", () => {
    // fail-quiet 契约：认不出的写法返回 undefined，native 不画（不猜颜色）。
    // Chromium computed serialization 归一到这里列出的几种。
    expect(parseCssColor("rgb(10, 10, 10)")?.a).toBe(1);
    expect(parseCssColor("rgba(10, 10, 10, 0.5)")?.a).toBeCloseTo(0.5);
    expect(parseCssColor("rgb(10 10 10 / 40%)")?.a).toBeCloseTo(0.4);
    expect(parseCssColor("color(srgb 0.04 0.04 0.04 / 0.2)")?.a).toBeCloseTo(
      0.2
    );
    expect(parseCssColor("oklab(0.2 0 0 / 0.3)")).toBeDefined();
    // 认不出 → undefined，不是猜一个。
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeUndefined();
    expect(parseCssColor("rgb(50%, 0%, 0%, 0.5)")).toBeUndefined();
    expect(parseCssColor("transparent")).toBeUndefined();
  });
});

describe("useTerminalOverlay", () => {
  beforeEach(() => {
    resetTerminalInputRoutingForTests();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1)
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn(() => undefined)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers geometry only — never a web focus request", () => {
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();

    result.current(el);

    expect(snapshot()?.webOverlayRects).toHaveLength(1);
    expect(snapshot()?.webRequestCount).toBe(0);

    result.current(null);

    expect(snapshot()?.webOverlayRects).toHaveLength(0);
    expect(snapshot()?.webRequestCount).toBe(0);
  });

  it("re-measures geometry when the enter animation ends", () => {
    // Dialog 用 -translate 居中，zoom-in 的 keyframe 会整段换掉 transform。
    // 挂载时量到的是动画中途的矩形，偏到右下；不在 animationend 重读的话，
    // 洞就填错位置，终端从设置框左上角穿出来。
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    let rect = { height: 40, width: 80, x: 200, y: 150 };
    el.getBoundingClientRect = () =>
      ({
        bottom: rect.y + rect.height,
        height: rect.height,
        left: rect.x,
        right: rect.x + rect.width,
        toJSON: () => ({}),
        top: rect.y,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      }) as DOMRect;

    result.current(el);
    expect(snapshot()?.webOverlayRects[0]?.frame).toMatchObject({
      height: 40,
      width: 80,
      x: 200,
      y: 150,
    });

    rect = { height: 400, width: 800, x: 40, y: 30 };
    el.dispatchEvent(new Event("animationend"));

    expect(snapshot()?.webOverlayRects[0]?.frame).toMatchObject({
      height: 400,
      width: 800,
      x: 40,
      y: 30,
    });
  });

  it("re-attaching to a new element disposes the previous registration", () => {
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });

    result.current(makeSizedElement());
    result.current(makeSizedElement());

    // 旧注册被释放，只保留一个几何矩形。
    expect(snapshot()?.webOverlayRects).toHaveLength(1);
  });

  it("flushes registered geometry synchronously after transform movement", () => {
    const registerElement = vi.fn(() => ({
      dispose: vi.fn(),
      flush: vi.fn(),
    }));
    const customWrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        TerminalOverlayContext.Provider,
        { value: { registerElement } },
        children
      );
    const { result } = renderHook(
      () => useTerminalOverlayRegistration("runtime-control"),
      { wrapper: customWrapper }
    );

    result.current.ref(makeSizedElement());
    result.current.flush();

    expect(registerElement).toHaveBeenCalledWith(
      "runtime-control",
      expect.any(HTMLElement)
    );
    expect(registerElement.mock.results[0]?.value.flush).toHaveBeenCalledTimes(
      1
    );
  });

  it("publishes a scrim color without filling the terminal hole", () => {
    // 弹窗蒙层是半透明的。paints:true 会把洞填成不透明 backing；
    // 只登记 paints:false 又会把蒙层从终端上裁掉。scrim 把 computed
    // background 交给 native，在洞里画同色，终端内容仍透出来。
    const { result } = renderHook(
      () => useTerminalOverlay({ paints: false, scrim: true }),
      { wrapper }
    );
    const el = makeSizedElement();
    el.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    document.body.append(el);

    result.current(el);

    expect(snapshot()?.webOverlayRects).toEqual([
      expect.objectContaining({
        paints: false,
        scrim: { a: 0.1, b: 1, g: 1, r: 1 },
      }),
    ]);

    el.remove();
  });

  it("keeps sampling scrim opacity while the fade animation is running", () => {
    // 只在挂载和 animationend 各读一次的话，100ms 淡入中间终端洞停在
    // 起点亮度，底部状态栏却在逐帧变暗。动画没结束就要跟着 opacity 走。
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const { result } = renderHook(
      () => useTerminalOverlay({ paints: false, scrim: true }),
      { wrapper }
    );
    const el = makeSizedElement();
    el.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    el.style.opacity = "0";
    let running = true;
    el.getAnimations = () =>
      (running
        ? [
            {
              animationName: "pier-overlay-fade-in",
              playState: "running",
            },
          ]
        : []) as unknown as Animation[];
    document.body.append(el);

    result.current(el);
    const drain = () => {
      const batch = frames.splice(0);
      for (const callback of batch) {
        callback(0);
      }
    };
    drain();

    expect(frames.length).toBeGreaterThan(0);

    el.style.opacity = "0.5";
    drain();

    expect(snapshot()?.webOverlayRects[0]?.scrim?.a).toBeCloseTo(0.05);

    running = false;
    drain();
    el.remove();
  });

  it("publishes outset box-shadows and drops inset ones", () => {
    // 洞只回填 border box。shadow-lg 画在盒外，终端洞会把阴影硬裁掉；
    // 非终端区域没有洞，同一条 CSS 阴影仍然可见。inset 在盒内，web 自己画。
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    el.style.boxShadow = [
      "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px",
      "rgba(0, 0, 0, 0.1) 0px 4px 6px -4px",
      "rgba(0, 0, 0, 0.2) 0px 1px 0px 0px inset",
    ].join(", ");
    el.style.opacity = "0.5";
    document.body.append(el);

    result.current(el);

    const shadows = snapshot()?.webOverlayRects[0]?.shadows;
    expect(shadows).toHaveLength(2);
    expect(shadows?.[0]).toMatchObject({ blur: 15, spread: -3, x: 0, y: 10 });
    expect(shadows?.[0]?.color.a).toBeCloseTo(0.05);
    expect(shadows?.[0]?.color.r).toBe(0);
    expect(shadows?.[1]).toMatchObject({ blur: 6, spread: -4, x: 0, y: 4 });
    expect(readOverlayShadows(el, 0)).toHaveLength(2);

    el.remove();
  });

  it("does not publish shadows for input-capture overlays", () => {
    // 全屏输入捕获不画像素。把它的阴影送去 native 会在每个终端洞里铺一块大投影。
    const { result } = renderHook(() => useTerminalOverlay({ paints: false }), {
      wrapper,
    });
    const el = makeSizedElement();
    el.style.boxShadow = "rgba(0, 0, 0, 0.4) 0px 8px 16px 0px";
    document.body.append(el);

    result.current(el);

    expect(snapshot()?.webOverlayRects[0]?.paints).toBe(false);
    expect(snapshot()?.webOverlayRects[0]?.shadows).toBeUndefined();

    el.remove();
  });

  it("publishes a rounded card's corner radius in content-view px", () => {
    // 洞按外接矩形回填时，圆角外是不透明 backing，终端上会看到脏色边角。
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    el.style.borderTopLeftRadius = "24px";
    el.style.borderTopRightRadius = "24px";
    el.style.borderBottomRightRadius = "24px";
    el.style.borderBottomLeftRadius = "24px";
    document.body.append(el);

    result.current(el);

    expect(snapshot()?.webOverlayRects[0]?.radius).toBe(24);
    expect(readOverlayRadiusPx(el, 0)).toBe(24);

    el.remove();
  });

  it("passes paints:false through for input-capture-only surfaces", () => {
    // Dialog / AlertDialog 的整窗 scrim 只做事件路由与点击捕获，本身不画
    // 可覆盖终端的内容；若参与洞遮罩回填会把所有终端洞抹空。
    const { result } = renderHook(() => useTerminalOverlay({ paints: false }), {
      wrapper,
    });

    result.current(makeSizedElement());

    expect(snapshot()?.webOverlayRects).toHaveLength(1);
    expect(snapshot()?.webOverlayRects[0]?.paints).toBe(false);
  });

  it("defaults drawn overlays to paints:true", () => {
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });

    result.current(makeSizedElement());

    expect(snapshot()?.webOverlayRects[0]?.paints).toBe(true);
  });

  it("degrades to noop without a Provider — no throw, store state unchanged", () => {
    // 不包 Provider，使用默认 noopRegistry。
    const { result } = renderHook(() => useTerminalOverlay());

    // 不应抛错，也不应写入 terminal-input-routing store（snapshot 保持 null）。
    expect(() => result.current(makeSizedElement())).not.toThrow();
    expect(snapshot()).toBeNull();

    expect(() => result.current(null)).not.toThrow();
    expect(snapshot()).toBeNull();
  });
});
