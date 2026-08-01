/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  panelEventValuesEqual,
  usePanelEventState,
} from "@/hooks/use-panel-event-state.ts";

describe("panelEventValuesEqual", () => {
  it("treats PanelContext-like objects equal when only updatedAt differs", () => {
    expect(
      panelEventValuesEqual(
        {
          contextId: "c1",
          cwd: "/Users/xyz/ABC/loomdesk",
          projectRootPath: "/Users/xyz/ABC/loomdesk",
          updatedAt: 1,
        },
        {
          contextId: "c1",
          cwd: "/Users/xyz/ABC/loomdesk",
          projectRootPath: "/Users/xyz/ABC/loomdesk",
          updatedAt: 2,
        }
      )
    ).toBe(true);
  });

  it("detects a real cwd change", () => {
    expect(
      panelEventValuesEqual(
        { cwd: "/a", updatedAt: 1 },
        { cwd: "/b", updatedAt: 1 }
      )
    ).toBe(false);
  });
});

describe("usePanelEventState", () => {
  it("keeps the same state reference when subscribe repeats the same value", () => {
    let push: ((event: { panelId: string; value: string }) => void) | undefined;
    const subscribe = vi.fn(
      (cb: (event: { panelId: string; value: string }) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      }
    );

    const { result } = renderHook(() =>
      usePanelEventState(subscribe, "term-1", (event) => event.value, "seq-1")
    );

    expect(result.current).toBeNull();

    act(() => {
      push?.({ panelId: "term-1", value: "/Users/xyz/ABC/loomdesk" });
    });
    const first = result.current;
    expect(first).toBe("/Users/xyz/ABC/loomdesk");

    act(() => {
      push?.({ panelId: "term-1", value: "/Users/xyz/ABC/loomdesk" });
    });
    expect(result.current).toBe(first);
  });

  it("keeps the same context when only updatedAt changes", () => {
    let push:
      | ((event: {
          panelId: string;
          context: {
            cwd: string;
            projectRootPath: string;
            updatedAt: number;
          };
        }) => void)
      | undefined;
    const subscribe = vi.fn(
      (
        cb: (event: {
          panelId: string;
          context: {
            cwd: string;
            projectRootPath: string;
            updatedAt: number;
          };
        }) => void
      ) => {
        push = cb;
        return () => {
          push = undefined;
        };
      }
    );

    const { result } = renderHook(() =>
      usePanelEventState(subscribe, "term-1", (event) => event.context, "seq-1")
    );

    act(() => {
      push?.({
        panelId: "term-1",
        context: {
          cwd: "/Users/xyz/ABC/loomdesk",
          projectRootPath: "/Users/xyz/ABC/loomdesk",
          updatedAt: 1,
        },
      });
    });
    const first = result.current;

    act(() => {
      push?.({
        panelId: "term-1",
        context: {
          cwd: "/Users/xyz/ABC/loomdesk",
          projectRootPath: "/Users/xyz/ABC/loomdesk",
          updatedAt: 99,
        },
      });
    });
    expect(result.current).toBe(first);
  });
});
