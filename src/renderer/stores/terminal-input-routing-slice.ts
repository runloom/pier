import type {
  TerminalFrame,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import {
  computeEffectiveKeyboardTarget,
  sameKeyboardFocusTarget as sameBasePanel,
} from "@shared/terminal-keyboard-target.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import {
  resetTerminalHostStateForTests,
  updateTerminalHostInputFacts,
} from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/terminal-viewport.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

// ===========================================================================
// slice.inputRouting — 模块级变量 + rAF coalesce（高频路径保留原设计）
// ===========================================================================

export interface WebOverlayRegistration {
  dispose(): void;
  flush(): void;
}

export function beginTerminalPanelWebDragCapture(
  panelId: string,
  panelElement: HTMLElement
): { dispose(): void } {
  const id = `terminal-floating-drag:${panelId}`;
  const route = registerTerminalElementWebOverlay(id, panelElement);
  const releaseFocus = requestTerminalWebFocus(id);
  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseFocus();
      route.dispose();
    },
  };
}

const webOverlayRects = new Map<string, TerminalFrame>();
const webRequestIds = new Set<string>();
/** composer 等 web 输入组件接管的面板：native 不得聚焦、硬件光标隐藏。 */
const focusDisabledPanelIds = new Set<string>();
const TRANSIENT_WEB_CLICK_FOCUS_ID = "pier.click";

let basePanel: TerminalKeyboardFocusTarget = { kind: "web" };
let lastEffectiveKeyboardKind: TerminalKeyboardFocusTarget["kind"] = "web";
let webFocusHandOffArmedUntil = 0;

// effective terminal→web 翻转后, main 会调 webContents.focus() 做 first responder
// 交接 (terminal NSView → Chromium view)。该交接会给 renderer 派发一对瞬时
// window blur→focus (实测间隔 1-5ms, 落在 pointerdown 后 ~30-60ms)。250ms 覆盖
// IPC 往返 + native 交接的最慢路径, 又远短于任何两次用户操作的间隔。
const WEB_FOCUS_HAND_OFF_BLUR_SUPPRESS_MS = 250;

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function applyTerminalInputRouting(): void {
  const nextEffectiveKind = computeEffectiveKeyboardTarget(
    basePanel,
    webRequestIds.size
  ).kind;
  if (lastEffectiveKeyboardKind === "terminal" && nextEffectiveKind === "web") {
    webFocusHandOffArmedUntil =
      performance.now() + WEB_FOCUS_HAND_OFF_BLUR_SUPPRESS_MS;
  }
  lastEffectiveKeyboardKind = nextEffectiveKind;
  updateTerminalHostInputFacts(
    {
      basePanel,
      focusDisabledPanelIds: Array.from(focusDisabledPanelIds),
      webOverlayRects: Array.from(webOverlayRects, ([id, frame]) => ({
        frame,
        id,
      })),
      webRequestCount: webRequestIds.size,
    },
    "input-routing"
  );
}

/**
 * 声明某终端面板的原生聚焦开关（Agent Composer 挂载即关闭原生聚焦）。
 * 关闭期间：main 不会把键盘交给该终端，native 隐藏其硬件光标；
 * 开关恢复后回到常规路由。
 */
export function setTerminalNativeFocusDisabled(
  panelId: string,
  disabled: boolean
): void {
  const had = focusDisabledPanelIds.has(panelId);
  if (disabled === had) {
    return;
  }
  if (disabled) {
    focusDisabledPanelIds.add(panelId);
  } else {
    focusDisabledPanelIds.delete(panelId);
  }
  applyTerminalInputRouting();
}

function setWebOverlayRect(id: string, frame: TerminalFrame | null): void {
  const previous = webOverlayRects.get(id);
  if (!frame) {
    if (!previous) {
      return;
    }
    webOverlayRects.delete(id);
    applyTerminalInputRouting();
    return;
  }
  if (previous && frameKey(previous) === frameKey(frame)) {
    return;
  }
  webOverlayRects.set(id, frame);
  applyTerminalInputRouting();
}

function cssDomRectToTerminalFrame(rect: DOMRect): TerminalFrame | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return cssRectToContentViewRect(
    {
      height: rect.height,
      width: rect.width,
      x: rect.x,
      y: rect.y,
    },
    useZoomStore.getState().windowZoomLevel
  );
}

export function setTerminalBasePanel(
  target: TerminalKeyboardFocusTarget
): void {
  if (sameBasePanel(basePanel, target)) {
    return;
  }
  basePanel = target;
  applyTerminalInputRouting();
}
export function requestTerminalFocusIntent(panelId: string): void {
  const target = { kind: "terminal", panelId } as const;
  if (!sameBasePanel(basePanel, target)) {
    basePanel = target;
  }
  webRequestIds.delete(TRANSIENT_WEB_CLICK_FOCUS_ID);
  applyTerminalInputRouting();
}

/**
 * 浮在终端上的 web 元素声明一次键盘焦点意图。任意活跃请求即把 effective 拉成
 * web。返回的释放函数 idempotent —— 多次调用只在首次真正移除请求时重算。
 */
export function requestTerminalWebFocus(id: string): () => void {
  if (!webRequestIds.has(id)) {
    webRequestIds.add(id);
    applyTerminalInputRouting();
  }
  return () => {
    if (webRequestIds.delete(id)) {
      applyTerminalInputRouting();
    }
  };
}

export function registerTerminalElementWebOverlay(
  id: string,
  element: HTMLElement
): WebOverlayRegistration {
  let frameRequest: number | null = null;

  const flush = () => {
    setWebOverlayRect(
      id,
      cssDomRectToTerminalFrame(element.getBoundingClientRect())
    );
  };

  const flushTrailing = () => {
    flush();
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
    }
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      flush();
    });
  };

  const resizeObserver = new ResizeObserver(flushTrailing);
  resizeObserver.observe(element);
  window.addEventListener("resize", flushTrailing);
  const disposePulse =
    window.pier?.window?.onLayoutPulse?.((_pulse: WindowLayoutPulse) => {
      flushTrailing();
    }) ?? null;
  flushTrailing();

  return {
    dispose() {
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", flushTrailing);
      disposePulse?.();
      setWebOverlayRect(id, null);
    },
    flush,
  };
}

export function registerTerminalFullscreenWebOverlay(
  id: string
): WebOverlayRegistration {
  let frameRequest: number | null = null;

  const flush = () => {
    setWebOverlayRect(id, readTerminalViewportFrame());
  };

  const flushTrailing = () => {
    flush();
    if (frameRequest !== null) {
      cancelAnimationFrame(frameRequest);
    }
    frameRequest = requestAnimationFrame(() => {
      frameRequest = null;
      flush();
    });
  };

  const onWindowLayoutPulse = (pulse: WindowLayoutPulse) => {
    if (
      pulse.reason === "view-zoom" &&
      typeof pulse.windowZoomLevel === "number"
    ) {
      useZoomStore.setState({ windowZoomLevel: pulse.windowZoomLevel });
    }
    flushTrailing();
  };

  window.addEventListener("resize", flushTrailing);
  const disposePulse =
    window.pier?.window?.onLayoutPulse?.(onWindowLayoutPulse) ?? null;
  flushTrailing();

  return {
    dispose() {
      if (frameRequest !== null) {
        cancelAnimationFrame(frameRequest);
        frameRequest = null;
      }
      window.removeEventListener("resize", flushTrailing);
      disposePulse?.();
      setWebOverlayRect(id, null);
    },
    flush,
  };
}

// ---------------------------------------------------------------------------
// 全局点击 → 焦点路由（事件路由层）
//
// Pier 架构下终端 NSView 常持有 first responder，用户点击任何 web 元素时
// Chromium view 不会自动接管键盘焦点（AppKit FR 不动，renderer 只拿到
// widget 焦点），必须由 main 调 win.webContents.focus() 完成交接。
//
// 焦点意图在事件路由层由 capture 阶段 pointerdown 统一触发：任何落在 web
// 上的点击都走同一入口，各 Radix 组件只负责几何注册 (useTerminalOverlay
// focus: false，勿再传 true——挂载期请求焦点重复且时序更晚)。终端共存浮层
// 由其 owner 显式释放；独立 Web owner 不会因 terminal intent 被清空。
//
// 注意"第一次点击闪关"的真实根因不在此入口的早晚：webContents.focus() 做
// FR 交接时 renderer 必然收到一对瞬时 window blur→focus（实测点击后
// ~30-60ms，晚于 Radix 同步打开），而 Radix Select/Menu 打开时监听 window
// blur 自关。靠 installTerminalInputRoutingBlurSuppressor 消费该 blur 解决，
// 见其 doc comment。
// ---------------------------------------------------------------------------

let blurSuppressorInstalled = false;

/**
 * 键盘交接瞬时 blur 抑制器。terminal→web 交接期间 (见
 * WEB_FOCUS_HAND_OFF_BLUR_SUPPRESS_MS 注释) 到达的第一个 window blur 是
 * webContents.focus() 的内部产物, 不代表用户离开窗口; 但 Radix Select / Menu
 * (dropdown/context/menubar) 打开时都监听 window blur 自关, 造成"第一次点击
 * 菜单闪现即消失"。这里消费掉这一个 blur (stopImmediatePropagation), 让它
 * 不到达 Radix。必须在 React root render 之前安装, 保证监听器排在所有 Radix
 * 组件之前 (window 目标的 blur 按注册顺序派发)。
 *
 * 用户真点终端关菜单的路径不受影响: 那条链路 effective 翻向 terminal, 不武装
 * 抑制窗口, blur 正常放行。
 */
export function installTerminalInputRoutingBlurSuppressor(): void {
  if (blurSuppressorInstalled) {
    return;
  }
  blurSuppressorInstalled = true;
  window.addEventListener("blur", (event) => {
    if (performance.now() >= webFocusHandOffArmedUntil) {
      return;
    }
    webFocusHandOffArmedUntil = 0;
    event.stopImmediatePropagation();
  });
}

let pointerDownFocusListenerInstalled = false;

export function installTerminalInputRoutingPointerDownListener(): void {
  if (pointerDownFocusListenerInstalled) {
    return;
  }
  pointerDownFocusListenerInstalled = true;
  document.addEventListener(
    "pointerdown",
    () => {
      // 幂等：同 id 再次调用不重复 add，也不重复触发 IPC。
      // 只在真正首次 add 时下发 snapshot，主进程再按 previousTargetKey 去重。
      requestTerminalWebFocus(TRANSIENT_WEB_CLICK_FOCUS_ID);
    },
    { capture: true }
  );
}

const TAB_DRAG_FALLBACK_MS = 5000;
const DRAG_WATCHER_CLEANUP_KEY = "__pierTerminalInputRoutingDragCleanup__";

interface DragWatcherDocument extends Document {
  [DRAG_WATCHER_CLEANUP_KEY]?: () => void;
}

function beginFullscreenWebInputCapture(id: string): () => void {
  const route = registerTerminalFullscreenWebOverlay(id);
  const releaseWebFocus = requestTerminalWebFocus(id);
  return () => {
    releaseWebFocus();
    route.dispose();
  };
}

let dragWatcherInstalled = false;

export function installTerminalInputRoutingDragWatcher(): void {
  if (dragWatcherInstalled) {
    return;
  }
  const watcherDocument = document as DragWatcherDocument;
  watcherDocument[DRAG_WATCHER_CLEANUP_KEY]?.();
  dragWatcherInstalled = true;

  let dragActive = false;
  let endDragCapture: (() => void) | null = null;
  let dragFallbackTimer: number | null = null;

  const clearDragFallback = () => {
    if (dragFallbackTimer === null) {
      return;
    }
    window.clearTimeout(dragFallbackTimer);
    dragFallbackTimer = null;
  };

  const endTabDrag = () => {
    if (!dragActive) {
      return;
    }
    dragActive = false;
    clearDragFallback();
    endDragCapture?.();
    endDragCapture = null;
  };

  const armDragFallback = () => {
    clearDragFallback();
    dragFallbackTimer = window.setTimeout(endTabDrag, TAB_DRAG_FALLBACK_MS);
  };

  const beginTabDrag = () => {
    if (dragActive) {
      return;
    }
    dragActive = true;
    endDragCapture = beginFullscreenWebInputCapture("dockview-tab-drag");
    armDragFallback();
  };

  const onDragStart = (e: DragEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.(".dv-tab")) {
      return;
    }
    beginTabDrag();
  };

  const onDrop = () => {
    if (!dragActive) {
      return;
    }
    window.setTimeout(endTabDrag, 0);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      endTabDrag();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      endTabDrag();
    }
  };

  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragend", endTabDrag, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("visibilitychange", onVisibilityChange, true);
  window.addEventListener("blur", endTabDrag);
  window.addEventListener("keydown", onKeyDown, true);

  let sashDragActive = false;
  let endSashDrag: (() => void) | null = null;
  const beginSashDrag = () => {
    if (sashDragActive) {
      return;
    }
    sashDragActive = true;
    const endSashCapture = beginFullscreenWebInputCapture("dockview-sash-drag");
    const cleanup = () => {
      if (!sashDragActive) {
        return;
      }
      sashDragActive = false;
      endSashCapture();
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      endSashDrag = null;
    };
    endSashDrag = cleanup;
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!(t.closest(".dv-sash") || t.closest(".dv-resize-container"))) {
      return;
    }
    beginSashDrag();
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  watcherDocument[DRAG_WATCHER_CLEANUP_KEY] = () => {
    endTabDrag();
    endSashDrag?.();
    clearDragFallback();
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragend", endTabDrag, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", endTabDrag);
    window.removeEventListener("keydown", onKeyDown, true);
    dragWatcherInstalled = false;
    delete watcherDocument[DRAG_WATCHER_CLEANUP_KEY];
  };
}

export function resetTerminalInputRoutingForTests(): void {
  webOverlayRects.clear();
  webRequestIds.clear();
  focusDisabledPanelIds.clear();
  basePanel = { kind: "web" };
  resetTerminalHostStateForTests();
  lastEffectiveKeyboardKind = "web";
  webFocusHandOffArmedUntil = 0;
  dragWatcherInstalled = false;
}
