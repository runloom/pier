import type { TerminalFocusRoutingDebugSnapshot } from "@shared/contracts/terminal/debug.ts";
import type {
  TerminalFrame,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import {
  computeEffectiveKeyboardTarget,
  sameKeyboardFocusTarget as sameBasePanel,
  TRANSIENT_WEB_CLICK_FOCUS_ID,
} from "@shared/terminal-keyboard-target.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import {
  getTerminalFocusTraceEvents,
  recordTerminalFocusTrace,
  resetTerminalFocusTraceForTests,
} from "@/lib/workspace/terminal-focus-trace.ts";
import {
  resetTerminalHostStateForTests,
  updateTerminalHostInputFacts,
} from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/viewport.ts";
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
/** composer 等 web 输入组件接管的面板：native 不得成 FR；pin focus + 藏绘制光标。 */
const focusDisabledPanelIds = new Set<string>();

let basePanel: TerminalKeyboardFocusTarget = { kind: "web" };
let lastEffectiveKeyboardKind: TerminalKeyboardFocusTarget["kind"] = "web";
let webFocusHandOffArmedUntil = 0;

function isTransientWebFocusId(id: string): boolean {
  return id === TRANSIENT_WEB_CLICK_FOCUS_ID;
}

/** 除 pier.click 外仍有 web 焦点声明（设置/命令面板/composer/搜索等）。 */
function hasDurableWebFocusRequest(): boolean {
  for (const id of webRequestIds) {
    if (!isTransientWebFocusId(id)) {
      return true;
    }
  }
  return false;
}

/**
 * 全局策略（所有非 pier.click 的 durable owner，不限设置）：
 * durable 全部释放后不得只剩 pier.click 把键盘钉在 web。
 * 只清瞬态 pier.click；不调 requestTerminalFocusIntent——
 * - 避免与 restoreTerminalFocusAfterWebOverlayDismiss / 点 tab 的 intent reassert 双发 host snapshot
 * - base 已是 terminal 时 count→0 即 enough 让 main 把 keyboard 还给终端
 *
 * Esc/X 关模态只靠本路径；fullscreen outside 仍可由 restore helper 做 yield + intent。
 *
 * 调用方应在 durable release 的 microtask 中调用，以排在同一次
 * outside-click 的 pointerdown→pier.click 之后（I5）。
 */
function reconcileAfterDurableWebFocusRelease(): void {
  if (hasDurableWebFocusRequest()) {
    return;
  }
  if (!webRequestIds.has(TRANSIENT_WEB_CLICK_FOCUS_ID)) {
    return;
  }
  const baseDetail =
    basePanel.kind === "terminal" ? `terminal:${basePanel.panelId}` : "web";
  recordTerminalFocusTrace(
    "reconcile",
    `durable-empty clear pier.click base=${baseDetail}`
  );
  clearTransientWebClickFocus();
}

// effective terminal→web 翻转后, main 会调 webContents.focus() 做 first responder
// 交接 (terminal NSView → Chromium view)。该交接会给 renderer 派发一对瞬时
// window blur→focus (实测间隔 1-5ms, 落在 pointerdown 后 ~30-60ms)。250ms 覆盖
// IPC 往返 + native 交接的最慢路径, 又远短于任何两次用户操作的间隔。
const WEB_FOCUS_HAND_OFF_BLUR_SUPPRESS_MS = 250;

function frameKey(frame: TerminalFrame): string {
  return `${frame.x},${frame.y},${frame.width},${frame.height}`;
}

function sortedIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort();
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
  if (lastEffectiveKeyboardKind !== nextEffectiveKind) {
    const ids = sortedIds(webRequestIds).join(",") || "-";
    const base =
      basePanel.kind === "terminal" ? `terminal:${basePanel.panelId}` : "web";
    recordTerminalFocusTrace(
      "flip",
      `${lastEffectiveKeyboardKind}->${nextEffectiveKind} base=${base} ids=${ids}`
    );
    // Residual sticky only（仅 pier.click，无 durable）：经典关菜单后键回不去。
    if (
      nextEffectiveKind === "web" &&
      basePanel.kind === "terminal" &&
      !hasDurableWebFocusRequest() &&
      webRequestIds.has(TRANSIENT_WEB_CLICK_FOCUS_ID)
    ) {
      recordTerminalFocusTrace(
        "sticky",
        `panel=${basePanel.panelId} ids=${ids}`
      );
    }
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

/** Debug / dump: current renderer keyboard ownership (ids, not just count). */
export function getTerminalFocusRoutingDebugSnapshot(): TerminalFocusRoutingDebugSnapshot {
  return {
    basePanel,
    effectiveKind: computeEffectiveKeyboardTarget(basePanel, webRequestIds.size)
      .kind,
    events: [...getTerminalFocusTraceEvents()],
    focusDisabledPanelIds: sortedIds(focusDisabledPanelIds),
    webOverlayIds: sortedIds(webOverlayRects.keys()),
    webRequestIds: sortedIds(webRequestIds),
  };
}

/**
 * 声明某终端面板的原生聚焦开关（Agent Composer 挂载即关闭原生 FR）。
 * 关闭期间：main 不会把键盘交给该终端；native pin surface focus（防 ESC[O]）
 * 并 suppress 绘制光标（避免双闪）。探针仍读 DECTCEM 模式位。
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
  const clearedClick = webRequestIds.delete(TRANSIENT_WEB_CLICK_FOCUS_ID);
  recordTerminalFocusTrace(
    "intent",
    clearedClick ? `panel=${panelId} cleared=pier.click` : `panel=${panelId}`
  );
  // 同 panel 再点 tab 等路径：即使无 pier.click 也要 bump sequence 让 native reassert FR。
  applyTerminalInputRouting();
}

/**
 * 清掉 capture 阶段 pointerdown 留下的瞬时 `pier.click` web 请求。
 * 全屏 overlay 把「点终端」改道到 web 时 native 不会发 focus-request，
 * 若不清理则 sticky 浮层关掉后键盘仍钉在 web。
 */
export function clearTransientWebClickFocus(): void {
  if (!webRequestIds.delete(TRANSIENT_WEB_CLICK_FOCUS_ID)) {
    return;
  }
  recordTerminalFocusTrace("remove", TRANSIENT_WEB_CLICK_FOCUS_ID);
  applyTerminalInputRouting();
}

/**
 * 浮在终端上的 web 元素声明一次键盘焦点意图。任意活跃请求即把 effective 拉成
 * web。返回的释放函数 idempotent —— 多次调用只在首次真正移除请求时重算。
 *
 * durable（非 pier.click）释放后：若已无其它 durable，则 microtask 调和掉残留
 * pier.click，避免「关设置/菜单后 base 仍是 terminal、键却钉在 web」。
 */
export function requestTerminalWebFocus(id: string): () => void {
  if (!webRequestIds.has(id)) {
    webRequestIds.add(id);
    recordTerminalFocusTrace("add", id);
    applyTerminalInputRouting();
  }
  return () => {
    if (!webRequestIds.delete(id)) {
      return;
    }
    recordTerminalFocusTrace("remove", id);
    if (isTransientWebFocusId(id)) {
      applyTerminalInputRouting();
      return;
    }
    // 先落下 durable 计数，再 microtask 清 pier.click（排在同指针 down 之后）。
    applyTerminalInputRouting();
    queueMicrotask(() => {
      reconcileAfterDurableWebFocusRelease();
    });
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

export function resetTerminalInputRoutingForTests(): void {
  webOverlayRects.clear();
  webRequestIds.clear();
  focusDisabledPanelIds.clear();
  basePanel = { kind: "web" };
  resetTerminalHostStateForTests();
  resetTerminalFocusTraceForTests();
  lastEffectiveKeyboardKind = "web";
  webFocusHandOffArmedUntil = 0;
}
