// @vitest-environment node
import { readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import { detectLiveModuleFrameworkFromFileName } from "@shared/live-module-framework.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLiveModulesService,
  type LiveModulesService,
} from "../../../../src/main/services/live-modules/service.ts";

/**
 * Compiles every in-repo React canvas through the REAL live-modules pipeline.
 *
 * typecheck/vitest lanes resolve full node_modules, so they happily pass on
 * bare imports (e.g. zod) that the compile fence denies for canvas source
 * (fence allows react/react-dom/pier/canvas/pier/host plus the per-root
 * `allowedBarePackages` list — project roots seed `framer-motion`). This test
 * is the lane that matches what the host actually does when opening a canvas.
 */

const CANVAS_ROOT = join(process.cwd(), ".pier", "canvases");

function isReactCanvasEntry(name: string): boolean {
  return detectLiveModuleFrameworkFromFileName(name) === "react";
}

function listReactCanvasModules(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...listReactCanvasModules(join(dir, entry.name), relative));
    } else if (isReactCanvasEntry(entry.name)) {
      found.push(relative);
    }
  }
  return found;
}

const services: LiveModulesService[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

describe("project canvases compile through the live-modules fence", () => {
  const modules = listReactCanvasModules(CANVAS_ROOT);

  it("finds the in-repo React canvases", () => {
    expect(
      modules.some((module) => module.endsWith("canvas-kit.canvas.tsx"))
    ).toBe(true);
    expect(modules.length).toBeGreaterThanOrEqual(3);
  });

  for (const module of modules) {
    it(`compiles ${module}`, async () => {
      const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
      const service = createLiveModulesService({
        resolveHomeRoot: () => homeRoot,
      });
      services.push(service);
      const spec = projectLiveRootSpec({ projectRootPath: process.cwd() });
      service.registerRoot(spec);

      const result = await service.compile(spec.id, module);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });
  }
});
