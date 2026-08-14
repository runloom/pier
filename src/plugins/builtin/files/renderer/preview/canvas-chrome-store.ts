import { useSyncExternalStore } from "react";

/**
 * Canvas preview chrome state, published from the content area to the panel
 * toolbar (header trailing slot). The toolbar renders the Reload action;
 * busy covers only user-triggered reloads (auto file-watch recompiles are
 * silent) and is cleared by the preview once the reload settles.
 *
 * All state is keyed by the canvas module id (rel path) so multiple canvas
 * panels don't clobber each other. Module-level store with a revision counter
 * — same pattern as `document/store.ts` (no zustand dependency in this plugin).
 */
export interface CanvasChromeState {
  /** Panels currently previewing each module id (refcounted). */
  activeByModule: Record<string, number>;
  /**
   * True while a user-triggered Reload is in flight per module. Drives the
   * toolbar spin + disabled state; auto (file-watch) recompiles stay silent.
   */
  busyByModule: Record<string, boolean>;
  /** Reload request counter per module; preview subscribes and recompiles. */
  reloadByModule: Record<string, number>;
}

const INITIAL: CanvasChromeState = {
  activeByModule: {},
  busyByModule: {},
  reloadByModule: {},
};

let state: CanvasChromeState = INITIAL;
let revision = 0;
const listeners = new Set<() => void>();

function setState(patch: Partial<CanvasChromeState>): void {
  state = { ...state, ...patch };
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

/** Panel started previewing `moduleId` (refcounted so multi-panel works). */
export function markCanvasActive(moduleId: string): void {
  setState({
    activeByModule: {
      ...state.activeByModule,
      [moduleId]: (state.activeByModule[moduleId] ?? 0) + 1,
    },
  });
}

/** Panel stopped previewing `moduleId`; drops per-module state at zero. */
export function unmarkCanvasActive(moduleId: string): void {
  const next = (state.activeByModule[moduleId] ?? 1) - 1;
  if (next > 0) {
    setState({
      activeByModule: { ...state.activeByModule, [moduleId]: next },
    });
    return;
  }
  const activeByModule = { ...state.activeByModule };
  delete activeByModule[moduleId];
  const busyByModule = { ...state.busyByModule };
  delete busyByModule[moduleId];
  const reloadByModule = { ...state.reloadByModule };
  delete reloadByModule[moduleId];
  setState({
    activeByModule,
    busyByModule,
    reloadByModule,
  });
}

/**
 * Preview marks the user-triggered Reload as settled (ready/error terminal
 * state reached) — the toolbar spin stops. Auto recompiles never set busy,
 * so they have nothing to clear.
 */
export function clearCanvasBusy(moduleId: string): void {
  if (state.busyByModule[moduleId] !== true) {
    return;
  }
  setState({ busyByModule: { ...state.busyByModule, [moduleId]: false } });
}

export function requestCanvasReload(moduleId: string): void {
  setState({
    busyByModule: { ...state.busyByModule, [moduleId]: true },
    reloadByModule: {
      ...state.reloadByModule,
      [moduleId]: (state.reloadByModule[moduleId] ?? 0) + 1,
    },
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getRevision(): number {
  return revision;
}

function getState(): CanvasChromeState {
  return state;
}

export interface CanvasModuleChrome {
  /** Whether any panel is previewing this module (toolbar visibility). */
  isActive: boolean;
  isBusy: boolean;
  reloadRequest: number;
}

/** Subscribe to chrome state for one module (preview + toolbar). */
export function useCanvasChrome(moduleId: string): CanvasModuleChrome {
  useSyncExternalStore(subscribe, getRevision, getRevision);
  const s = getState();
  return {
    isActive: (s.activeByModule[moduleId] ?? 0) > 0,
    isBusy: s.busyByModule[moduleId] === true,
    reloadRequest: s.reloadByModule[moduleId] ?? 0,
  };
}

/** Read the current raw state (tests). */
export function getCanvasChromeState(): CanvasChromeState {
  return getState();
}
