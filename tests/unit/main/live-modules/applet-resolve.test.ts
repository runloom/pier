import { setRegisteredCanvasApplets } from "@main/services/live-modules/applet-registry.ts";
import {
  appletFenceRootForEntry,
  parsePierAppletSpecifier,
  resolvePierAppletCompileEntry,
} from "@main/services/live-modules/compile-resolve-applet.ts";
import {
  liveModuleIdSchema,
  liveModulesCompileRequestSchema,
  liveModulesGetUrlRequestSchema,
} from "@shared/contracts/live-modules.ts";
import { describe, expect, it } from "vitest";

describe("pier applet specifier", () => {
  it("accepts applet specifiers as live module ids", () => {
    const moduleId = "@pier-applet/pier.tasks/tracker-board";
    expect(liveModuleIdSchema.safeParse(moduleId).success).toBe(true);
    expect(
      liveModulesCompileRequestSchema.safeParse({
        relPath: moduleId,
        rootId: "pier.canvas.project",
      }).success
    ).toBe(true);
    expect(
      liveModulesGetUrlRequestSchema.safeParse({
        moduleId,
        rootId: "pier.canvas.project",
      }).success
    ).toBe(true);
  });

  it("parses @pier-applet/<pluginId>/<appletId>", () => {
    expect(
      parsePierAppletSpecifier("@pier-applet/pier.tasks/tracker-board")
    ).toEqual({
      appletId: "tracker-board",
      pluginId: "pier.tasks",
    });
    expect(parsePierAppletSpecifier("pier/canvas")).toBeNull();
  });

  it("resolves registered applet entries", () => {
    setRegisteredCanvasApplets([
      {
        appletId: "tracker-board",
        entryAbsolutePath:
          "/plugins/pier.tasks/applets/tracker-board/index.applet.tsx",
        fenceRoot: "/plugins/pier.tasks/applets/tracker-board",
        pluginId: "pier.tasks",
      },
    ]);
    expect(
      resolvePierAppletCompileEntry("@pier-applet/pier.tasks/tracker-board")
        ?.entryAbsolutePath
    ).toContain("index.applet.tsx");
    expect(
      resolvePierAppletCompileEntry("@pier-applet/pier.tasks/missing")
    ).toBeNull();
  });

  it("shares the applets/ fence for nested entries so copy catalogs compile", () => {
    expect(
      appletFenceRootForEntry(
        "/plugins/pier.tasks/applets/tracker-board/index.applet.tsx"
      )
    ).toBe("/plugins/pier.tasks/applets");
    expect(
      appletFenceRootForEntry(
        "/plugins/pier.tasks/applets/task-list.applet.tsx"
      )
    ).toBe("/plugins/pier.tasks/applets");
  });
});
