// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveModulesService } from "@main/services/live-modules/service.ts";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import { liveModuleTicketFromUrl } from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";

const skillRoot = join(
  process.cwd(),
  "resources",
  "system-skills",
  "pier-canvas"
);
const templateNames = [
  "composition.canvas.tsx",
  "docs.canvas.tsx",
  "kit.canvas.tsx",
] as const;

const temporaryRoots: string[] = [];
const services: ReturnType<typeof createLiveModulesService>[] = [];

afterEach(async () => {
  for (const service of services) service.dispose();
  services.length = 0;
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("bundled Pier Canvas template runtime", () => {
  it("compiles every template through the production Live Modules service", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-canvas-template-"));
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-canvas-home-"));
    temporaryRoots.push(projectRoot, homeRoot);
    const canvasRoot = join(projectRoot, ".pier", "canvases", "templates");
    await mkdir(canvasRoot, { recursive: true });
    for (const templateName of templateNames) {
      await copyFile(
        join(skillRoot, "templates", templateName),
        join(canvasRoot, templateName)
      );
    }

    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);

    for (const templateName of templateNames) {
      const moduleId = `templates/${templateName}`;
      const result = await service.compile(spec.id, moduleId);
      expect(result.ok, `${moduleId}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) continue;
      const ticket = liveModuleTicketFromUrl(result.url);
      expect(ticket).toBeTruthy();
      const artifact = ticket ? service.getArtifactByTicket(ticket) : undefined;
      expect(artifact).toBeDefined();
      const source = artifact
        ? Buffer.from(artifact.bytes).toString("utf8")
        : "";
      expect(source).toContain("__PIER_LIVE_CANVAS__");
      expect(source).toContain("getCanvas().Frame");
      expect(source).not.toContain("cursor/canvas");

      const original = await readFile(
        join(skillRoot, "templates", templateName),
        "utf8"
      );
      expect(original).toContain("export const canvas");
      expect(original).toContain("export default");
    }
  }, 120_000);
});
