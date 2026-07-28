import {
  homeLiveRootSpec,
  LIVE_MODULE_DEFAULT_HOME_DIRECTORY,
  LIVE_MODULE_DEFAULT_PREVIEW_BARREL,
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  LIVE_MODULES_CHANGED_CHANNEL,
  liveModuleCompileResultSchema,
  liveModuleDiagnosticSchema,
  liveModuleEventSchema,
  liveRootSpecSchema,
  projectLiveRootId,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  LIVE_MODULE_SCHEME,
  liveModuleRuntimeIdFromUrl,
  liveModuleRuntimeUrl,
  liveModuleTicketFromUrl,
  liveModuleUrlForTicket,
} from "@shared/live-module-url.ts";
import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";
import { describe, expect, it } from "vitest";
import { pierCanvasStubSource } from "../../../src/main/services/live-modules/compile.ts";
import { pierVisualizationsStubSource } from "../../../src/main/services/live-modules/visualizations-stub.ts";

const SAMPLE_TICKET = "abcdefghijklmnopqrstuv";

describe("live-modules contract", () => {
  it("accepts a project root with tsconfig paths", () => {
    const spec = projectLiveRootSpec({
      projectRootPath: "/Users/dev/app",
    });
    expect(spec.anchor).toEqual({
      projectRootPath: "/Users/dev/app",
      scope: "project",
    });
    expect(spec.directory).toBe(LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY);
    expect(spec.id).toBe(projectLiveRootId("/Users/dev/app"));
    expect(spec.id).toMatch(/^pier\.canvas\.project\.[a-z0-9]+\.[a-z0-9]+$/u);
    expect(spec.resolve.tsconfigPaths).toBe(true);
    expect(spec.resolve.forcePreviewBarrel).toBe(false);
    expect(spec.resolve.allowNodeModules).toBe(false);
  });

  it("derives distinct project live root ids per path", () => {
    expect(projectLiveRootId("/a")).not.toBe(projectLiveRootId("/b"));
    expect(projectLiveRootId("/a/")).toBe(projectLiveRootId("/a"));
    expect(projectLiveRootId("/A")).toBe(projectLiveRootId("/a"));
  });

  it("accepts a home root and forces tsconfigPaths false", () => {
    const spec = homeLiveRootSpec();
    expect(spec.anchor).toEqual({ scope: "home" });
    expect(spec.directory).toBe(LIVE_MODULE_DEFAULT_HOME_DIRECTORY);
    expect(spec.resolve.tsconfigPaths).toBe(false);
  });

  it("rejects home roots that enable tsconfigPaths", () => {
    expect(
      liveRootSpecSchema.safeParse({
        anchor: { scope: "home" },
        directory: "canvases",
        id: "pier.canvas.home",
        pattern: "**/*.canvas.tsx",
        resolve: { tsconfigPaths: true },
      }).success
    ).toBe(false);
  });

  it("rejects project anchors without projectRootPath", () => {
    expect(
      liveRootSpecSchema.safeParse({
        anchor: { scope: "project" },
        directory: ".pier/canvases",
        id: "pier.canvas.project",
        pattern: "**/*.canvas.tsx",
        resolve: { tsconfigPaths: true },
      }).success
    ).toBe(false);
  });

  it("rejects home anchors that smuggle a path field", () => {
    expect(
      liveRootSpecSchema.safeParse({
        anchor: { scope: "home", projectRootPath: "/tmp/evil" },
        directory: "canvases",
        id: "pier.canvas.home",
        pattern: "**/*.canvas.tsx",
        resolve: { tsconfigPaths: false },
      }).success
    ).toBe(false);
  });

  it("rejects directory escape and absolute paths", () => {
    for (const directory of ["/abs", "../up", "a/../../b", "canvases\0x"]) {
      expect(
        liveRootSpecSchema.safeParse({
          anchor: { scope: "home" },
          directory,
          id: "pier.canvas.home",
          pattern: "**/*.canvas.tsx",
          resolve: { tsconfigPaths: false },
        }).success
      ).toBe(false);
    }
  });

  it("rejects invalid root ids", () => {
    expect(
      liveRootSpecSchema.safeParse({
        anchor: { scope: "home" },
        directory: "canvases",
        id: "Bad Id",
        pattern: "**/*.canvas.tsx",
        resolve: { tsconfigPaths: false },
      }).success
    ).toBe(false);
  });

  it("documents the recommended preview barrel constant", () => {
    expect(LIVE_MODULE_DEFAULT_PREVIEW_BARREL).toBe(".pier/preview-exports.ts");
  });

  it("accepts compile success and failure unions", () => {
    expect(
      liveModuleCompileResultSchema.safeParse({
        graph: ["src/ui/button.tsx"],
        moduleId: "checkout-redesign.canvas.tsx",
        ok: true,
        url: liveModuleUrlForTicket(SAMPLE_TICKET),
      }).success
    ).toBe(true);

    expect(
      liveModuleCompileResultSchema.safeParse({
        diagnostics: [
          liveModuleDiagnosticSchema.parse({
            message: "import escapes project root",
            severity: "error",
          }),
        ],
        ok: false,
      }).success
    ).toBe(true);

    expect(
      liveModuleCompileResultSchema.safeParse({
        diagnostics: [],
        ok: false,
      }).success
    ).toBe(false);
  });

  it("accepts live module events", () => {
    expect(
      liveModuleEventSchema.safeParse({
        moduleId: "a.canvas.tsx",
        rootId: "pier.canvas.project",
        type: "changed",
      }).success
    ).toBe(true);
    expect(
      liveModuleEventSchema.safeParse({
        diagnostics: [{ message: "boom", severity: "error" }],
        rootId: "pier.canvas.project",
        type: "diagnostics",
      }).success
    ).toBe(true);
  });

  it("wires the broadcast channel to PIER_BROADCAST", () => {
    expect(LIVE_MODULES_CHANGED_CHANNEL).toBe(
      PIER_BROADCAST.LIVE_MODULES_CHANGED
    );
    expect(LIVE_MODULES_CHANGED_CHANNEL).toBe("pier://live-modules:changed");
  });
});

describe("pier/canvas stub source", () => {
  const source = pierCanvasStubSource();

  it("renders component exports through createElement", () => {
    expect(source).toContain('import { createElement } from "react";');
    for (const name of ["Button", "Card", "Text"] as const) {
      expect(PIER_CANVAS_COMPONENT_EXPORT_NAMES).toContain(name);
      expect(source).toContain(`export function ${name}(props) {`);
      expect(source).toContain("return createElement(Comp, props);");
    }
  });

  it("passes value exports through so hooks keep args and return value", () => {
    for (const name of PIER_CANVAS_VALUE_EXPORT_NAMES) {
      expect(source).toContain(`export function ${name}(...args) {`);
      expect(source).toContain("return fn(...args);");
      expect(source).not.toContain(`createElement(getCanvas().${name}`);
    }
  });

  it("exports every whitelisted name exactly once", () => {
    for (const name of [
      ...PIER_CANVAS_COMPONENT_EXPORT_NAMES,
      ...PIER_CANVAS_VALUE_EXPORT_NAMES,
    ]) {
      const occurrences = source.split(`export function ${name}(`).length - 1;
      expect(occurrences).toBe(1);
    }
  });
});

describe("pier/visualizations stub source", () => {
  it("forwards the framework-neutral mount controller to the host runtime", () => {
    const source = pierVisualizationsStubSource();
    expect(source).toContain("__PIER_LIVE_VISUALIZATIONS__");
    expect(source).toContain("export function mountDiagram(...args)");
    expect(source).toContain("getVisualizations().mountDiagram(...args)");
    expect(source).not.toContain('from "react"');
  });
});

describe("live-module-url", () => {
  it("round-trips opaque module tickets", () => {
    const url = liveModuleUrlForTicket(SAMPLE_TICKET);
    expect(url).toBe(`${LIVE_MODULE_SCHEME}://module/${SAMPLE_TICKET}`);
    expect(liveModuleTicketFromUrl(url)).toBe(SAMPLE_TICKET);
  });

  it("rejects tickets that look like paths", () => {
    expect(() => liveModuleUrlForTicket("../etc/passwd")).toThrow(
      /Invalid live module ticket/
    );
    expect(
      liveModuleTicketFromUrl(`${LIVE_MODULE_SCHEME}://module/a/b`)
    ).toBeNull();
    expect(
      liveModuleTicketFromUrl(
        `${LIVE_MODULE_SCHEME}://module/${SAMPLE_TICKET}?x=1`
      )
    ).toBeNull();
    expect(
      liveModuleTicketFromUrl(
        `${LIVE_MODULE_SCHEME}://module/${encodeURIComponent("/tmp/x.js")}`
      )
    ).toBeNull();
  });

  it("round-trips runtime shim ids", () => {
    for (const id of [
      "react",
      "react-dom",
      "react-dom-client",
      "jsx-runtime",
      "jsx-dev-runtime",
    ] as const) {
      const url = liveModuleRuntimeUrl(id);
      expect(liveModuleRuntimeIdFromUrl(url)).toBe(id);
    }
  });

  it("does not expose pier-canvas as a protocol runtime id (inlined stub)", () => {
    expect(
      liveModuleRuntimeIdFromUrl(`${LIVE_MODULE_SCHEME}://runtime/pier-canvas`)
    ).toBeNull();
  });

  it("rejects unknown runtime ids and path-shaped runtime urls", () => {
    expect(
      liveModuleRuntimeIdFromUrl(`${LIVE_MODULE_SCHEME}://runtime/vue`)
    ).toBeNull();
    expect(
      liveModuleRuntimeIdFromUrl(`${LIVE_MODULE_SCHEME}://runtime/react/jsx`)
    ).toBeNull();
  });
});
