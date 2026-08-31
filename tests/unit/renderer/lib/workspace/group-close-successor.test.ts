import { describe, expect, it, vi } from "vitest";
import {
  activateGroupCloseSuccessor,
  pickGroupCloseSuccessor,
} from "@/lib/workspace/group-close-successor.ts";
import { resetGroupMru, touchGroup } from "@/lib/workspace/group-mru.ts";

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => "",
  } as DOMRect;
}

describe("pickGroupCloseSuccessor", () => {
  const tl = {
    id: "tl",
    rect: rect(0, 0, 100, 100),
  };
  const tr = {
    id: "tr",
    rect: rect(110, 0, 100, 100),
  };
  const bl = {
    id: "bl",
    rect: rect(0, 110, 100, 100),
  };
  const br = {
    id: "br",
    rect: rect(110, 110, 100, 100),
  };

  it("prefers the MRU remaining group over the first remaining group", () => {
    const picked = pickGroupCloseSuccessor({
      closingGroupId: "br",
      closingRect: br.rect,
      mruIds: ["br", "tr", "tl"],
      remaining: [tl, tr, bl],
    });
    expect(picked?.id).toBe("tr");
  });

  it("falls back to the left neighbor when MRU has only the closing group", () => {
    const picked = pickGroupCloseSuccessor({
      closingGroupId: "br",
      closingRect: br.rect,
      mruIds: ["br"],
      remaining: [tl, tr, bl],
    });
    expect(picked?.id).toBe("bl");
  });

  it("does not pick the top-left group when a spatial neighbor exists", () => {
    const picked = pickGroupCloseSuccessor({
      closingGroupId: "br",
      closingRect: br.rect,
      mruIds: ["br"],
      remaining: [tl, bl],
    });
    expect(picked?.id).toBe("bl");
  });

  it("returns null when no groups remain", () => {
    expect(
      pickGroupCloseSuccessor({
        closingGroupId: "only",
        closingRect: tl.rect,
        mruIds: ["only"],
        remaining: [],
      })
    ).toBeNull();
  });
});

describe("activateGroupCloseSuccessor", () => {
  it("activates the remaining group's panel", () => {
    resetGroupMru();
    const keep = {
      api: { setActive: vi.fn() },
      id: "keep",
      view: { contentComponent: "welcome" },
    };
    const closing = {
      api: { setActive: vi.fn() },
      id: "closing",
      view: { contentComponent: "welcome" },
    };
    const keepGroup = {
      id: "g-keep",
      activePanel: keep,
      panels: [keep],
    };
    const closingGroup = {
      id: "g-closing",
      activePanel: closing,
      panels: [closing],
    };
    touchGroup("g-keep");
    touchGroup("g-closing");

    const activated = activateGroupCloseSuccessor(
      {
        groups: [keepGroup, closingGroup],
        panels: [keep, closing],
      },
      "closing"
    );

    expect(activated).toBe("keep");
    expect(keep.api.setActive).toHaveBeenCalledOnce();
    expect(closing.api.setActive).not.toHaveBeenCalled();
  });
});
