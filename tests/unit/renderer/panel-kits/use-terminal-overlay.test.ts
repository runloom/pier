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

/** jsdom 没有 AnimationEvent / TransitionEvent 构造器，补同名属性即可。 */
function namedEvent(
  type: string,
  property: "animationName" | "propertyName",
  value: string
): Event {
  const event = new Event(type);
  Object.defineProperty(event, property, { value });
  return event;
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
    vi.restoreAllMocks();
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

  it("follows tw-animate enter opacity so shadows are not frozen at zero", () => {
    // Radix popover / dropdown 的淡入是 tw-animate `enter` keyframes：
    // animationName 不含 "fade"，opacity 由 --tw-enter-opacity 驱动。只按
    // 名字匹配会停在挂载时的 opacity=0，阴影 alpha 永远为 0。
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    el.style.boxShadow = "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px";
    el.style.opacity = "0";
    let running = true;
    el.getAnimations = () =>
      (running
        ? [
            {
              animationName: "enter",
              effect: {
                getComputedTiming: () => ({ iterations: 1 }),
                getKeyframes: () => [{ opacity: "var(--tw-enter-opacity, 1)" }],
              },
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

    // 运行中的 enter 动画必须续帧；否则不会再读 opacity。
    expect(frames.length).toBeGreaterThan(0);

    el.style.opacity = "1";
    drain();

    const shadows = snapshot()?.webOverlayRects[0]?.shadows;
    expect(shadows).toHaveLength(1);
    expect(shadows?.[0]?.color.a).toBeCloseTo(0.1);

    running = false;
    drain();
    el.remove();
  });

  it("flushes the enter terminal frame but ignores the exit rebound", () => {
    // 逐帧链在动画结束前的最后一帧就停了；进场终帧必须补读一次，否则
    // native 蒙层/阴影永远差最后一点点。退场结束后 fill-mode none 会
    // 回弹到 opacity 1，此时不能重读，否则终端上闪一帧全强度。
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    el.style.boxShadow = "rgba(0, 0, 0, 0.4) 0px 8px 16px 0px";
    el.style.opacity = "0.5";
    document.body.append(el);
    result.current(el);

    const shadowAlpha = () =>
      snapshot()?.webOverlayRects[0]?.shadows?.[0]?.color.a;
    expect(shadowAlpha()).toBeCloseTo(0.2);

    el.style.opacity = "1";
    el.dispatchEvent(namedEvent("animationend", "animationName", "enter"));
    expect(shadowAlpha()).toBeCloseTo(0.4);

    el.style.opacity = "0.25";
    el.dispatchEvent(namedEvent("transitionend", "propertyName", "opacity"));
    expect(shadowAlpha()).toBeCloseTo(0.1);

    // exit 结束 CSS 回弹到 opacity 1；缓存的退场强度必须保留。
    el.style.opacity = "1";
    el.dispatchEvent(namedEvent("animationend", "animationName", "exit"));
    expect(shadowAlpha()).toBeCloseTo(0.1);

    el.remove();
  });

  it("does not keep flushing for an infinite opacity animation", () => {
    // pulse 等无限动画动画的也是 opacity，但逐帧 flush 链不能无限续命。
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const { result } = renderHook(() => useTerminalOverlay(), { wrapper });
    const el = makeSizedElement();
    el.style.boxShadow = "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px";
    el.getAnimations = () =>
      [
        {
          animationName: "pulse",
          effect: {
            getComputedTiming: () => ({ iterations: Number.POSITIVE_INFINITY }),
            getKeyframes: () => [{ opacity: "0.5" }],
          },
          playState: "running",
        },
      ] as unknown as Animation[];
    document.body.append(el);

    result.current(el);
    const batch = frames.splice(0);
    for (const callback of batch) {
      callback(0);
    }

    expect(frames).toHaveLength(0);
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

  it("reads rounded-full's exponent-serialized radius and clamps it to the box", () => {
    // Tailwind rounded-full 在 Chromium computed style 里是 1.67772e+07px，
    // 不是十进制 px。按字面 px 正则解析会得到 0，洞按直角回填，胶囊四角
    // 露出不透明 backing。CSS 的 used radius 还会被浏览器钳到短边一半。
    const el = makeSizedElement();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      borderBottomLeftRadius: "1.67772e+07px",
      borderBottomRightRadius: "1.67772e+07px",
      borderTopLeftRadius: "1.67772e+07px",
      borderTopRightRadius: "1.67772e+07px",
      boxShadow: "none",
      opacity: "1",
    } as CSSStyleDeclaration);

    expect(readOverlayRadiusPx(el, 0)).toBe(25);
  });

  it("reads a percentage radius against the shorter border-box edge", () => {
    // computed 值也可能是 50%。CSS 横向按宽、纵向按高；契约只要均匀圆角，
    // 取短边作基准，与用于钳位的 used radius 保持同一套几何。
    const el = makeSizedElement();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      borderBottomLeftRadius: "50%",
      borderBottomRightRadius: "50%",
      borderTopLeftRadius: "50%",
      borderTopRightRadius: "50%",
      boxShadow: "none",
      opacity: "1",
    } as CSSStyleDeclaration);

    expect(readOverlayRadiusPx(el, 0)).toBe(25);
  });

  it("reads an elliptical corner radius as the larger component", () => {
    // computed 单角可以是 `水平 垂直` 椭圆两值。按整串匹配会得到 0，洞按
    // 直角回填；取较大者保证挖掉的角至少覆盖绘制形状（宁可多挖露终端，
    // 不可欠挖留 backing 角）。
    const el = makeSizedElement();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      borderBottomLeftRadius: "10px 20px",
      borderBottomRightRadius: "10px 20px",
      borderTopLeftRadius: "10px 20px",
      borderTopRightRadius: "10px 20px",
      boxShadow: "none",
      opacity: "1",
    } as CSSStyleDeclaration);

    expect(readOverlayRadiusPx(el, 0)).toBe(20);
  });

  it("reads colored shadows from Chromium's oklab serialization", () => {
    // Tailwind shadow-background/40 经 color-mix 后 computed box-shadow 的
    // 颜色是 oklab(...)，不是 rgba(...)。只认 rgb/color 的 token 正则会把
    // 整层阴影丢掉，native 便无影可画。
    const el = makeSizedElement();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      boxShadow: [
        "rgba(0, 0, 0, 0) 0px 0px 0px 0px",
        "rgba(0, 0, 0, 0) 0px 0px 0px 0px",
        "oklab(0.2 0 0 / 0.4) 0px 10px 15px -3px",
        "oklab(0.2 0 0 / 0.4) 0px 4px 6px -4px",
      ].join(", "),
      opacity: "1",
    } as CSSStyleDeclaration);

    const shadows = readOverlayShadows(el, 0);
    expect(shadows).toHaveLength(2);
    expect(shadows[0]).toMatchObject({ blur: 15, spread: -3, x: 0, y: 10 });
    expect(shadows[0]?.color.a).toBeCloseTo(0.4);
    expect(shadows[0]?.color.r).toBeLessThan(0.2);
    expect(shadows[1]).toMatchObject({ blur: 6, spread: -4, x: 0, y: 4 });
  });

  it("samples appearance from the painted child when the geometry wrapper is transparent", () => {
    // 静态工具槽的注册元素只是布局外壳（无底色、无圆角、无阴影），
    // 真正画胶囊的是它的子元素。几何取外壳，外观必须取绘制元素。
    const wrapperEl = makeSizedElement();
    const painted = document.createElement("div");
    painted.style.borderTopLeftRadius = "24px";
    painted.style.borderTopRightRadius = "24px";
    painted.style.borderBottomRightRadius = "24px";
    painted.style.borderBottomLeftRadius = "24px";
    painted.style.boxShadow = "rgba(0, 0, 0, 0.2) 0px 8px 16px 0px";
    wrapperEl.append(painted);
    document.body.append(wrapperEl);

    const registration = registerTerminalElementWebOverlay(
      "painted-child",
      wrapperEl,
      { appearanceElement: () => painted }
    );

    const rect = snapshot()?.webOverlayRects.find(
      (entry) => entry.id === "painted-child"
    );
    expect(rect?.radius).toBe(24);
    expect(rect?.shadows).toHaveLength(1);

    registration.dispose();
    wrapperEl.remove();
  });

  it("does not fall back to the geometry wrapper when the painted target is missing", () => {
    // 指定了 appearanceElement 就表示「外观只属于绘制子元素」。子元素尚未
    // 挂载 / 已卸载时不能回头采样外壳——外壳的圆角阴影可能是另一套语义，
    // 会重新画出直角回填或错位阴影。目标缺席即「无外观」。
    const wrapperEl = makeSizedElement();
    wrapperEl.style.borderTopLeftRadius = "24px";
    wrapperEl.style.borderTopRightRadius = "24px";
    wrapperEl.style.borderBottomRightRadius = "24px";
    wrapperEl.style.borderBottomLeftRadius = "24px";
    wrapperEl.style.boxShadow = "rgba(0, 0, 0, 0.2) 0px 8px 16px 0px";
    document.body.append(wrapperEl);

    const registration = registerTerminalElementWebOverlay(
      "painted-child-missing",
      wrapperEl,
      { appearanceElement: () => null }
    );

    const rect = snapshot()?.webOverlayRects.find(
      (entry) => entry.id === "painted-child-missing"
    );
    expect(rect?.frame).toMatchObject({ height: 50, width: 100 });
    expect(rect?.radius).toBeUndefined();
    expect(rect?.shadows).toBeUndefined();

    registration.dispose();
    wrapperEl.remove();
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
