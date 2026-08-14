import {
  clearCanvasBusy,
  getCanvasChromeState,
  markCanvasActive,
  requestCanvasReload,
  unmarkCanvasActive,
  useCanvasChrome,
} from "@plugins/builtin/files/renderer/preview/canvas-chrome-store.ts";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const MODULE = "a.canvas.tsx";

describe("canvas-chrome-store", () => {
  afterEach(() => {
    // Drop per-module state created by this test.
    act(() => {
      unmarkCanvasActive(MODULE);
      unmarkCanvasActive("b.canvas.tsx");
    });
  });

  it("tracks active panels per module (refcounted)", () => {
    const { result } = renderHook(() => useCanvasChrome(MODULE));
    expect(result.current.isActive).toBe(false);

    act(() => {
      markCanvasActive(MODULE);
    });
    expect(result.current.isActive).toBe(true);
    // Second panel on the same module keeps it active.
    act(() => {
      markCanvasActive(MODULE);
    });
    act(() => {
      unmarkCanvasActive(MODULE);
    });
    expect(result.current.isActive).toBe(true);
    // Last panel drops per-module state.
    act(() => {
      unmarkCanvasActive(MODULE);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("user reload marks busy until the preview clears it", () => {
    const { result } = renderHook(() => useCanvasChrome(MODULE));
    act(() => {
      markCanvasActive(MODULE);
    });
    expect(result.current.isBusy).toBe(false);

    act(() => {
      requestCanvasReload(MODULE);
    });
    expect(result.current.isBusy).toBe(true);

    act(() => {
      clearCanvasBusy(MODULE);
    });
    expect(result.current.isBusy).toBe(false);
  });

  it("clearCanvasBusy is idempotent and leaves other modules alone", () => {
    act(() => {
      markCanvasActive(MODULE);
      requestCanvasReload(MODULE);
      requestCanvasReload("b.canvas.tsx");
    });
    act(() => {
      clearCanvasBusy(MODULE);
      clearCanvasBusy(MODULE);
    });
    expect(getCanvasChromeState().busyByModule[MODULE]).toBe(false);
    expect(getCanvasChromeState().busyByModule["b.canvas.tsx"]).toBe(true);
  });

  it("bumps reloadRequest only for the requested module", () => {
    const { result } = renderHook(() => useCanvasChrome(MODULE));
    const before = result.current.reloadRequest;
    act(() => {
      markCanvasActive(MODULE);
      requestCanvasReload(MODULE);
    });
    expect(result.current.reloadRequest).toBe(before + 1);

    // Another module's reload doesn't touch this one.
    const other = renderHook(() => useCanvasChrome("other.canvas.tsx"));
    act(() => {
      requestCanvasReload("other.canvas.tsx");
    });
    expect(result.current.reloadRequest).toBe(before + 1);
    expect(other.result.current.reloadRequest).toBe(1);
  });

  it("drops per-module state when last panel unmounts", () => {
    act(() => {
      markCanvasActive(MODULE);
      requestCanvasReload(MODULE);
    });
    expect(getCanvasChromeState().busyByModule[MODULE]).toBe(true);
    expect(getCanvasChromeState().reloadByModule[MODULE]).toBe(1);

    act(() => {
      unmarkCanvasActive(MODULE);
    });
    expect(getCanvasChromeState().busyByModule[MODULE]).toBeUndefined();
    expect(getCanvasChromeState().reloadByModule[MODULE]).toBeUndefined();
    expect(getCanvasChromeState().activeByModule[MODULE]).toBeUndefined();
  });
});
