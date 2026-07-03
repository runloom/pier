import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import {
  computeEffectiveKeyboardTarget,
  sameKeyboardFocusTarget as sameBasePanel,
} from "@shared/terminal-keyboard-target.ts";
import { create } from "zustand";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/terminal-viewport.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

// ===========================================================================
// slice.inputRouting — 模块级变量 + rAF coalesce（高频路径保留原设计）
// ===========================================================================

interface WebOverlayRegistration {
  dispose(): void;
  flush(): void;
}

const webOverlayRects = new Map<string, TerminalFrame>();
const webRequestIds = new Set<string>();

let basePanel: TerminalKeyboardFocusTarget = { kind: "web" };
let rendererSequence = 0;
let lastSnapshot: TerminalInputRoutingSnapshot | null = null;
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
  rendererSequence += 1;
  const snapshot: TerminalInputRoutingSnapshot = {
    basePanel,
    rendererSequence,
    webOverlayRects: Array.from(webOverlayRects, ([id, frame]) => ({
      frame,
      id,
    })),
    webRequestCount: webRequestIds.size,
  };
  lastSnapshot = snapshot;
  window.pier?.terminal?.applyInputRouting?.(snapshot);
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

export function getLastTerminalInputRoutingSnapshot(): TerminalInputRoutingSnapshot | null {
  return lastSnapshot;
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

export function activateTerminalInputRouting(panelId: string): void {
  const nextBasePanel: TerminalKeyboardFocusTarget = {
    kind: "terminal",
    panelId,
  };
  const shouldApply =
    !sameBasePanel(basePanel, nextBasePanel) || webRequestIds.size > 0;
  basePanel = nextBasePanel;
  webRequestIds.clear();
  if (shouldApply) {
    applyTerminalInputRouting();
  }
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
// focus: false，勿再传 true——挂载期请求焦点重复且时序更晚)。终端激活时
// activateTerminalInputRouting 会 clear webRequestIds，自然释放此请求。
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
      requestTerminalWebFocus("pier.click");
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
  basePanel = { kind: "web" };
  rendererSequence = 0;
  lastSnapshot = null;
  lastEffectiveKeyboardKind = "web";
  webFocusHandOffArmedUntil = 0;
  dragWatcherInstalled = false;
}

// ===========================================================================
// slice.overlayFocus — zustand
// ===========================================================================

interface TerminalOverlayFocusSlice {
  activateOverlay(id: string): void;
  activeOverlayId: string | null;
  deactivateOverlay(id: string): void;
  yieldToTerminal(): void;
}

// ===========================================================================
// slice.resize — zustand
// ===========================================================================

interface TerminalResizeSlice {
  /**
   * reconciler 最近一次下发给 native 的 presentation snapshot 的 rendererSequence。
   * coordinator 用它与 native 的「就位」ack 对比，精确判断 resize 撤占位时机。
   */
  lastDownlinkSequence: number;
  /**
   * web 占位是否显示。resize 期间为 true，用终端背景色占位顶替 native 终端区域，
   * resize 结束、native 应用最终几何的 ack 到达后转回 false。terminal-panel 读取。
   */
  placeholderVisible: boolean;
  /**
   * 是否强制隐藏所有 native 终端（presentation visible=false + frame=null）。resize
   * 期间为 true，让 native 终端隐身、由 web 占位顶替。reconciler 读取此字段。
   *
   * 与 placeholderVisible 分开：resize 结束先把它转 false（终端在占位之后恢复最终位置），
   * 再等 native 就位 ack 撤占位，避免接缝闪烁。
   */
  suppressTerminals: boolean;
}

// ===========================================================================
// slice.shortcutHints — zustand
// ===========================================================================

interface PanelLike {
  id: string;
}

interface TabShortcutHintsSlice {
  activeGroupTabHints: Record<string, number>;
  commandKeyDown: boolean;
  resetShortcutHints: () => void;
  setActiveGroupPanels: (panels: readonly PanelLike[]) => void;
  setCommandKeyDown: (commandKeyDown: boolean) => void;
}

function tabHintsForPanels(
  panels: readonly PanelLike[]
): Record<string, number> {
  return Object.fromEntries(
    panels.slice(0, 9).map((panel, index) => [panel.id, index + 1])
  );
}

// ===========================================================================
// 合并 store
// ===========================================================================

type TerminalStoreState = TerminalOverlayFocusSlice &
  TerminalResizeSlice &
  TabShortcutHintsSlice;

/**
 * 单一 web 焦点请求的释放句柄。共存型浮层（如终端搜索）任一时刻只有一个能持有
 * 键盘，激活动作由显式意图驱动（打开、用户点回输入框），终端焦点意图让出键盘但
 * 不关闭浮层。绝不由 DOM focus/blur 事件回写。
 */
let overlayFocusRelease: (() => void) | null = null;

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  // --- overlayFocus ---
  activeOverlayId: null,
  activateOverlay(id) {
    if (get().activeOverlayId === id) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = requestTerminalWebFocus(id);
    set({ activeOverlayId: id });
  },
  deactivateOverlay(id) {
    if (get().activeOverlayId !== id) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = null;
    set({ activeOverlayId: null });
  },
  yieldToTerminal() {
    if (get().activeOverlayId === null) {
      return;
    }
    overlayFocusRelease?.();
    overlayFocusRelease = null;
    set({ activeOverlayId: null });
  },

  // --- resize ---
  lastDownlinkSequence: 0,
  placeholderVisible: false,
  suppressTerminals: false,

  // --- shortcutHints ---
  activeGroupTabHints: {},
  commandKeyDown: false,
  resetShortcutHints: () =>
    set({ activeGroupTabHints: {}, commandKeyDown: false }),
  setActiveGroupPanels: (panels) =>
    set({ activeGroupTabHints: tabHintsForPanels(panels) }),
  setCommandKeyDown: (commandKeyDown) => set({ commandKeyDown }),
}));

// ===========================================================================
// selector hooks（保留旧接口名称，调用方可直接替换 import 路径）
// ===========================================================================

export function useTerminalOverlayFocus<T>(
  selector: (state: TerminalOverlayFocusSlice) => T
): T {
  return useTerminalStore(selector);
}

export function useTerminalResizeStore<T>(
  selector: (state: TerminalResizeSlice) => T
): T {
  return useTerminalStore(selector);
}

export function useTabShortcutHintsStore<T>(
  selector: (state: TabShortcutHintsSlice) => T
): T {
  return useTerminalStore(selector);
}

// ===========================================================================
// test reset
// ===========================================================================

export function resetTerminalOverlayFocusForTests(): void {
  overlayFocusRelease?.();
  overlayFocusRelease = null;
  useTerminalStore.setState({ activeOverlayId: null });
}

export function resetTerminalStoreForTests(): void {
  resetTerminalInputRoutingForTests();
  resetTerminalOverlayFocusForTests();
  useTerminalStore.setState({
    lastDownlinkSequence: 0,
    placeholderVisible: false,
    suppressTerminals: false,
    activeGroupTabHints: {},
    commandKeyDown: false,
  });
}
