import {
  incompletePanelListFailure,
  panelListLookupError,
  panelLookupError,
  pickUniquePanel,
} from "@main/app-core/commands/terminal-locate.ts";
import { describe, expect, it } from "vitest";

describe("pickUniquePanel", () => {
  const panels = [
    { id: "term-1", windowId: "w1" },
    { id: "term-1", windowId: "w2" },
    { id: "term-2", windowId: "w1" },
  ];

  it("returns the only panel when windowId is omitted and id is unique", () => {
    expect(pickUniquePanel(panels, "term-2", undefined, (p) => p.id)).toEqual({
      item: { id: "term-2", windowId: "w1" },
      ok: true,
    });
  });

  it("fails closed when windowId is omitted and id collides across windows", () => {
    expect(pickUniquePanel(panels, "term-1", undefined, (p) => p.id)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("selects the scoped window when windowId is provided", () => {
    expect(pickUniquePanel(panels, "term-1", "w2", (p) => p.id)).toEqual({
      item: { id: "term-1", windowId: "w2" },
      ok: true,
    });
  });

  it("returns missing when the scoped window has no such panel", () => {
    expect(pickUniquePanel(panels, "term-2", "w2", (p) => p.id)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

describe("panel lookup error classification", () => {
  it("treats ambiguity as invalid_command, not not_found", () => {
    expect(panelLookupError("ambiguous", "term-1")).toMatchObject({
      code: "invalid_command",
    });
    expect(panelListLookupError([], "ambiguous", "term-1")).toMatchObject({
      code: "invalid_command",
    });
  });

  it("reports a renderer failure as platform_unavailable", () => {
    expect(
      panelListLookupError(
        [{ code: "platform_unavailable", message: "renderer hung" }],
        "missing",
        "term-2"
      )
    ).toMatchObject({ code: "platform_unavailable" });
  });

  it("keeps genuine absence as not_found", () => {
    expect(panelListLookupError([], "missing", "term-2")).toMatchObject({
      code: "not_found",
    });
  });

  it("fails closed when an unscoped listing is incomplete", () => {
    expect(
      incompletePanelListFailure("req", undefined, [
        { code: "platform_unavailable", message: "renderer hung" },
      ])
    ).toMatchObject({
      error: { code: "platform_unavailable" },
      ok: false,
      requestId: "req",
    });
    expect(incompletePanelListFailure("req", undefined, [])).toBeNull();
    expect(
      incompletePanelListFailure("req", "main", [
        { code: "platform_unavailable", message: "renderer hung" },
      ])
    ).toBeNull();
  });
});
