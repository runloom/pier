// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pierHostRuntime } from "../../../../src/renderer/lib/live-modules/host.ts";
import { installLiveModuleRuntime } from "../../../../src/renderer/lib/live-modules/install-runtime.ts";
import { mountLiveModule } from "../../../../src/renderer/lib/live-modules/mount.ts";
import { pierCanvasExports } from "../../../../src/renderer/lib/live-modules/pier-canvas-exports.ts";
import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "../../../../src/shared/pier-canvas-export-names.ts";

describe("live-modules runtime", () => {
  it("keeps pierCanvasExports keys aligned with PIER_CANVAS_EXPORT_NAMES", () => {
    expect(Object.keys(pierCanvasExports).sort()).toEqual(
      [...PIER_CANVAS_EXPORT_NAMES].sort()
    );
    expect(pierCanvasExports.Input).toBeTypeOf("function");
    expect(pierCanvasExports.Select).toBeTypeOf("function");
    expect(pierCanvasExports.Empty).toBeTypeOf("function");
  });

  it("splits component exports from value exports without overlap", () => {
    const components = new Set<string>(PIER_CANVAS_COMPONENT_EXPORT_NAMES);
    for (const name of PIER_CANVAS_VALUE_EXPORT_NAMES) {
      expect(components.has(name)).toBe(false);
      expect(name.startsWith("use")).toBe(true);
      expect(pierCanvasExports[name]).toBeTypeOf("function");
    }
  });

  it("installs pier/canvas exports on globalThis and refreshes on reinstall", () => {
    globalThis.__PIER_LIVE_CANVAS__ = {
      ...pierCanvasExports,
      Frame: undefined as unknown as typeof pierCanvasExports.Frame,
    };
    installLiveModuleRuntime();
    expect(
      Object.getOwnPropertyDescriptor(globalThis, "__PIER_LIVE_CANVAS__")?.get
    ).toBeTypeOf("function");
    expect(globalThis.__PIER_LIVE_CANVAS__).toBe(pierCanvasExports);
    expect(globalThis.__PIER_LIVE_HOST__).toBe(pierHostRuntime);
    expect(globalThis.__PIER_LIVE_CANVAS__?.Frame).toBeTypeOf("function");
    expect(pierCanvasExports.Button).toBeTypeOf("function");
    expect(pierCanvasExports.Stack).toBeTypeOf("function");
    expect(pierCanvasExports.Row).toBeTypeOf("function");
    expect(pierCanvasExports.Frame).toBeTypeOf("function");
    expect(pierCanvasExports.CardTitle).toBeTypeOf("function");
    expect(
      document.head.querySelector("style[data-pier-canvas-shell-style]")
    ).toBeTruthy();
  });

  it("mounts and unmounts a component", () => {
    const el = document.createElement("div");
    document.body.append(el);
    function Hello() {
      return pierCanvasExports.Text({ children: "hi" });
    }
    const unmount = mountLiveModule(el, Hello);
    expect(() => unmount()).not.toThrow();
    expect(() => unmount()).not.toThrow();
    el.remove();
  });
});
