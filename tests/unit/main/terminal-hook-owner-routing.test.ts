import { afterEach, describe, expect, it } from "vitest";
import {
  activateAlias,
  clearAlias,
  clearAllTerminalHookOwnerAliases,
  resolveOwner,
  transferPanelOwnership,
} from "../../../src/main/services/panel-transfer/terminal-hook-owner-routing.ts";

describe("terminal-hook-owner-routing", () => {
  afterEach(() => {
    clearAllTerminalHookOwnerAliases();
  });

  it("resolves to source before any alias is activated", () => {
    expect(resolveOwner("1", "panel-a")).toEqual({
      panelId: "panel-a",
      windowId: "1",
    });
  });

  it("routes only to target after commit alias activation", () => {
    activateAlias(
      { panelId: "panel-a", windowId: "1" },
      { panelId: "panel-a", windowId: "2" }
    );

    expect(resolveOwner("1", "panel-a")).toEqual({
      panelId: "panel-a",
      windowId: "2",
    });
    expect(resolveOwner("2", "panel-a")).toEqual({
      panelId: "panel-a",
      windowId: "2",
    });
    expect(resolveOwner("1", "other")).toEqual({
      panelId: "other",
      windowId: "1",
    });
  });

  it("routes only to source after rollback clears the alias", () => {
    activateAlias(
      { panelId: "panel-a", windowId: "1" },
      { panelId: "panel-a", windowId: "2" }
    );
    clearAlias({ panelId: "panel-a", windowId: "1" });

    expect(resolveOwner("1", "panel-a")).toEqual({
      panelId: "panel-a",
      windowId: "1",
    });
  });

  it("transferPanelOwnership is an alias activation helper", () => {
    transferPanelOwnership(
      { panelId: "panel-a", windowId: "10" },
      { panelId: "panel-a", windowId: "20" }
    );
    expect(resolveOwner("10", "panel-a")).toEqual({
      panelId: "panel-a",
      windowId: "20",
    });
  });

  it("does not invent aliases for blank identities", () => {
    activateAlias(
      { panelId: "", windowId: "1" },
      { panelId: "panel-a", windowId: "2" }
    );
    expect(resolveOwner("1", "")).toEqual({ panelId: "", windowId: "1" });
  });
});
