import {
  CANVAS_HOST_ALLOWED_CHANNELS,
  CANVAS_HOST_ALLOWED_COMMANDS,
  CANVAS_HOST_SNAPSHOT_IDS,
  canvasHostExemplarCommandType,
  canvasHostInspect,
  canvasHostLiveChannel,
  isCanvasHostChannelAllowed,
  isCanvasHostCommandAllowed,
  isCanvasHostSnapshotAllowed,
  normalizeCanvasHostSnapshotId,
  parsePluginDataWatchTarget,
} from "@shared/contracts/canvas-host.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { describe, expect, it } from "vitest";

describe("canvas host policy", () => {
  it("allows read commands and denies writes and side-effect reads", () => {
    expect(isCanvasHostCommandAllowed("file.list")).toBe(true);
    expect(isCanvasHostCommandAllowed("git.getStatus")).toBe(true);
    expect(isCanvasHostCommandAllowed("file.writeText")).toBe(false);
    expect(isCanvasHostCommandAllowed("git.commit")).toBe(false);
    expect(isCanvasHostCommandAllowed("window.close")).toBe(false);
    expect(isCanvasHostCommandAllowed("file.openPath")).toBe(false);
    expect(isCanvasHostCommandAllowed("file.reveal")).toBe(false);
    expect(new Set(CANVAS_HOST_ALLOWED_COMMANDS).size).toBe(
      CANVAS_HOST_ALLOWED_COMMANDS.length
    );
  });

  it("allows data broadcasts and denies chrome channels", () => {
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED)
    ).toBe(true);
    expect(isCanvasHostChannelAllowed(PIER_BROADCAST.GIT_CHANGED)).toBe(true);
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.SETTINGS_OPEN_REQUEST)
    ).toBe(false);
    expect(isCanvasHostChannelAllowed(PIER_BROADCAST.APP_QUIT_REQUESTED)).toBe(
      false
    );
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST)
    ).toBe(false);
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.NEW_TERMINAL_REQUEST)
    ).toBe(false);
    expect(CANVAS_HOST_ALLOWED_CHANNELS).toContain(
      PIER_BROADCAST.USAGE_DATA_CHANGED
    );
    expect(isCanvasHostChannelAllowed(PIER_BROADCAST.COMMENTS_CHANGED)).toBe(
      false
    );
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.HOST_CATALOG_CHANGED)
    ).toBe(false);
    expect(
      isCanvasHostChannelAllowed(PIER_BROADCAST.LIVE_MODULES_CHANGED)
    ).toBe(false);
  });

  it("pluginData.snapshot joins the canvas allowlist", () => {
    expect(isCanvasHostCommandAllowed("pluginData.snapshot")).toBe(true);
    expect(isCanvasHostChannelAllowed(PIER_BROADCAST.PLUGIN_DATA_CHANGED)).toBe(
      true
    );
    expect(CANVAS_HOST_ALLOWED_CHANNELS).toContain(
      PIER_BROADCAST.PLUGIN_DATA_CHANGED
    );
  });

  it("plugin watch target parses and rejects malformed ids", () => {
    expect(
      parsePluginDataWatchTarget("plugin:pier.codex/accounts.usage")
    ).toEqual({
      key: "accounts.usage",
      pluginId: "pier.codex",
    });
    expect(parsePluginDataWatchTarget("plugin:pier.codex/")).toBeNull();
    expect(parsePluginDataWatchTarget("resources")).toBeNull();
  });

  it("watches snapshot ids on their live broadcast", () => {
    expect(canvasHostLiveChannel("foreground-activity")).toBe(
      PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED
    );
    expect(canvasHostLiveChannel("usage-data")).toBe(
      PIER_BROADCAST.USAGE_DATA_CHANGED
    );
    expect(canvasHostLiveChannel("resources")).toBeNull();
    expect(
      canvasHostLiveChannel(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED)
    ).toBe(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED);
  });

  it("inspects the same allowlist the runtime uses", () => {
    const inspected = canvasHostInspect();
    expect(inspected.commands).toEqual(CANVAS_HOST_ALLOWED_COMMANDS);
    expect(inspected.channels).toEqual(CANVAS_HOST_ALLOWED_CHANNELS);
    expect(inspected.snapshots).toEqual(CANVAS_HOST_SNAPSHOT_IDS);
    const file = inspected.domains.find((domain) => domain.id === "file");
    expect(file?.commands.some((command) => command.type === "file.list")).toBe(
      true
    );
    expect(
      file?.commands.find((command) => command.type === "file.list")?.fields
    ).toEqual([]);
    expect(file?.exemplar).toBe("file.list");
    expect(
      canvasHostExemplarCommandType("file", ["file.drafts.get", "file.list"])
    ).toBe("file.list");
    expect(
      canvasHostExemplarCommandType("git", [
        "git.getDiffPatch",
        "git.getStatus",
      ])
    ).toBe("git.getStatus");
    expect(file?.channels).toContain("pier://file:changed");
    expect(inspected.domains.map((domain) => domain.id)).not.toContain(
      "environments"
    );
    expect(inspected.domains.map((domain) => domain.id)).toContain(
      "environment"
    );
    const environment = inspected.domains.find(
      (domain) => domain.id === "environment"
    );
    expect(environment?.channels).toContain("pier://environments:changed");
  });

  it("aliases snapshot channels onto domain ids", () => {
    expect(normalizeCanvasHostSnapshotId("resources")).toBe("resources");
    expect(normalizeCanvasHostSnapshotId(PIER.PIER_RESOURCE_SNAPSHOT)).toBe(
      "resources"
    );
    expect(
      normalizeCanvasHostSnapshotId(PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED)
    ).toBe("foreground-activity");
    expect(isCanvasHostSnapshotAllowed("usage-data")).toBe(true);
    expect(isCanvasHostSnapshotAllowed(PIER_BROADCAST.GIT_CHANGED)).toBe(false);
  });
});
