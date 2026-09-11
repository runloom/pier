import { shouldSkipDuplicateTreeOpen } from "@plugins/builtin/git/renderer/review/surface-types.ts";
import { useSharedTreeOpen } from "@plugins/builtin/git/renderer/review/use-shared-tree-open.ts";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("shouldSkipDuplicateTreeOpen", () => {
  const pin = { entryKey: "entry:a", sectionKey: "section:a" };

  it("skips the same section while the reading pin is live", () => {
    expect(
      shouldSkipDuplicateTreeOpen({
        currentPin: pin,
        entryKey: "entry:a",
        sectionKey: "section:a",
      })
    ).toBe(true);
  });

  it("does not skip after the user released the reading pin", () => {
    expect(
      shouldSkipDuplicateTreeOpen({
        currentPin: null,
        entryKey: "entry:a",
        sectionKey: "section:a",
      })
    ).toBe(false);
  });

  it("does not skip a line-level reveal on the same section", () => {
    expect(
      shouldSkipDuplicateTreeOpen({
        currentPin: pin,
        entryKey: "entry:a",
        reveal: { line: 12, side: "new" },
        sectionKey: "section:a",
      })
    ).toBe(false);
  });

  it("does not skip a different section", () => {
    expect(
      shouldSkipDuplicateTreeOpen({
        currentPin: pin,
        entryKey: "entry:b",
        sectionKey: "section:b",
      })
    ).toBe(false);
  });
});

describe("useSharedTreeOpen", () => {
  function setup() {
    const navigationNonceRef = { current: 0 };
    const setNavigationRequest = vi.fn();
    const userPickedSurfaceRef = { current: false };
    const hook = renderHook(() =>
      useSharedTreeOpen({
        activeSurfaceRef: { current: "index" },
        entries: [],
        lastNavigationPathRef: { current: null },
        navigationNonceRef,
        navigationRequestRef: { current: null },
        setActiveSurface: vi.fn(),
        setMountedSurfaces: vi.fn(),
        setNavigationRequest,
        setNavigationSeq: vi.fn(),
        setSelectedTreeSectionKey: vi.fn(),
        userPickedSurfaceRef,
      })
    );
    return {
      hook,
      navigationNonceRef,
      setNavigationRequest,
      userPickedSurfaceRef,
    };
  }

  it("does not bump nonce while the reading pin is live", () => {
    const { hook, navigationNonceRef, setNavigationRequest } = setup();
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    expect(navigationNonceRef.current).toBe(1);
    expect(setNavigationRequest).toHaveBeenCalledOnce();
    setNavigationRequest.mockClear();
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    expect(navigationNonceRef.current).toBe(1);
    expect(setNavigationRequest).not.toHaveBeenCalled();
  });

  it("re-arms navigation after the user releases the reading pin", () => {
    const {
      hook,
      navigationNonceRef,
      setNavigationRequest,
      userPickedSurfaceRef,
    } = setup();
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    act(() => {
      hook.result.current.releaseReadingPin();
    });
    setNavigationRequest.mockClear();
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    expect(navigationNonceRef.current).toBe(2);
    expect(setNavigationRequest).toHaveBeenCalledOnce();
    expect(userPickedSurfaceRef.current).toBe(true);
  });

  it("still marks the surface as user-picked when a duplicate open is skipped", () => {
    const { hook, userPickedSurfaceRef } = setup();
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    userPickedSurfaceRef.current = false;
    act(() => {
      hook.result.current.requestTreeOpen("entry:a", "section:a", "unstaged");
    });
    expect(userPickedSurfaceRef.current).toBe(true);
  });
});
