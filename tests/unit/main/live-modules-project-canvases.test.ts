// @vitest-environment node
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { isLiveModuleCanvasFileName } from "@shared/live-module-framework.ts";
import { liveModuleTicketFromUrl } from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveModulesService } from "../../../src/main/services/live-modules/service.ts";

const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CANVAS_ROOT = join(PROJECT_ROOT, LIVE_MODULE_DEFAULT_PROJECT_DIRECTORY);

const services: ReturnType<typeof createLiveModulesService>[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

/** Every `*.canvas.*` entry under `.pier/canvases`, relative to that root. */
async function listCanvasEntries(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await listCanvasEntries(join(dir, entry.name), rel)));
      continue;
    }
    if (isLiveModuleCanvasFileName(entry.name)) {
      found.push(rel);
    }
  }
  return found.sort();
}

describe("in-repo project canvases", () => {
  it("compiles every canvas under .pier/canvases", async () => {
    const entries = await listCanvasEntries(CANVAS_ROOT);
    expect(entries.length).toBeGreaterThan(0);

    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
    service.registerRoot(spec);

    for (const relPath of entries) {
      const result = await service.compile(spec.id, relPath);
      expect(result.ok, `${relPath}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) {
        continue;
      }
      // `canvas` metadata export must survive compilation for every framework —
      // the preview reads `mod.canvas` for the title/kind. Regression here would
      // silently fall back to the filename as the title.
      const bytes = Buffer.from(
        service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
      ).toString("utf8");
      expect(
        /\bcanvas\b/m.test(bytes),
        `${relPath}: compiled output has no \`canvas\` export`
      ).toBe(true);
    }
  }, 120_000);
});
