// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installLiveModuleRuntime } from "../../../src/renderer/lib/live-modules/install-runtime.ts";
import { mountLiveModule } from "../../../src/renderer/lib/live-modules/mount.ts";
import { pierCanvasExports } from "../../../src/renderer/lib/live-modules/pier-canvas-exports.ts";
import { pierVisualizationsRuntime } from "../../../src/renderer/lib/live-modules/pier-visualizations-runtime.tsx";
import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "../../../src/shared/pier-canvas-export-names.ts";

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
    expect(globalThis.__PIER_LIVE_CANVAS__).toBe(pierCanvasExports);
    expect(globalThis.__PIER_LIVE_VISUALIZATIONS__).toBe(
      pierVisualizationsRuntime
    );
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

  it("mounts, updates and disposes a diagram through one host controller", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const controller = pierVisualizationsRuntime.mountDiagram(element, {
      ariaLabel: "共享图表",
      document: {
        format: "node-graph",
        nodes: [{ id: "A", title: "入口" }],
        edges: [],
        version: 1,
      },
    });
    expect(controller.update).toBeTypeOf("function");
    expect(controller.dispose).toBeTypeOf("function");
    expect(() =>
      controller.update({
        ariaLabel: "共享图表",
        document: {
          format: "node-graph",
          nodes: [
            { id: "A", title: "入口" },
            { id: "B", title: "结果" },
          ],
          edges: [{ source: "A", target: "B" }],
          version: 1,
        },
      })
    ).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
    element.remove();
  });

  it("mounts and unmounts a component", () => {
    const el = document.createElement("div");
    document.body.append(el);
    function Hello() {
      return pierCanvasExports.Text({ children: "hi" });
    }
    const unmount = mountLiveModule(el, Hello);
    expect(() => unmount()).not.toThrow();
    el.remove();
  });
});
