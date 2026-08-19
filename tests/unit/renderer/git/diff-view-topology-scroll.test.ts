import {
  captureTopologyScrollRestore,
  restoreTopologyScroll,
  type TopologyScrollRestore,
} from "@pier/ui/diff-view/topology-scroll.ts";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

describe("diff view topology scroll", () => {
  it("captures the item offset in the same padded coordinate space used by scrollTo", () => {
    const container = Object.assign(document.createElement("div"), {
      scrollTop: 480,
    });
    const instance = {} as never;
    const viewer = {
      getContainerElement: () => container,
      getLocalTopForInstance: () => 0,
      getRenderedItems: () => [{ id: "file.ts", instance }],
      getTopForItem: () => 23,
    };
    const restoreRef: RefObject<TopologyScrollRestore | null> = {
      current: null,
    };

    captureTopologyScrollRestore({
      codeViewRef: {
        current: { getInstance: () => viewer } as never,
      },
      inputs: [
        {
          cacheKey: "file.ts:1",
          fileDisplay: { path: "file.ts", status: "modified" },
          id: "file.ts",
          patch: null,
        },
      ],
      previousTopologyKey: "split",
      topologyKey: "unified",
      topologyScrollRestoreRef: restoreRef,
    });

    expect(restoreRef.current).toMatchObject({
      anchor: { id: "file.ts", offset: -457 },
      scrollTop: 480,
    });
  });

  it("restores the captured padded item offset through the official scroll target", () => {
    const scrollTo = vi.fn();
    const restoreRef: RefObject<TopologyScrollRestore | null> = {
      current: {
        anchor: { id: "file.ts", offset: -457 },
        path: "file.ts",
        scrollTop: 480,
      },
    };
    const viewer = {
      getInstance: () => ({
        getContainerElement: () => document.createElement("div"),
      }),
      getItem: () => ({}),
      scrollTo,
    };

    restoreTopologyScroll({
      codeViewItemsLength: 1,
      codeViewKey: "unified",
      codeViewRef: {
        current: viewer as never,
      },
      inputs: [],
      scheduleRenderWindowReport: vi.fn(),
      topologyScrollRestoreRef: restoreRef,
    });

    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      offset: -457,
      type: "item",
    });
  });
});
