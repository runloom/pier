// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import {
  liveModuleAssetTicketFromUrl,
  liveModuleTicketFromUrl,
} from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachExternalSourceMap,
  LIVE_MODULE_SOURCE_MAP_MIME_TYPE,
} from "../../../../src/main/services/live-modules/compile.ts";
import { pickJsAndCssOutputs } from "../../../../src/main/services/live-modules/css-inject.ts";
import { createLiveModulesService } from "../../../../src/main/services/live-modules/service.ts";

const PROJECT_ROOT = process.cwd();
const services: ReturnType<typeof createLiveModulesService>[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

function output(path: string, text: string) {
  return { contents: new TextEncoder().encode(text), path, text };
}

describe("live-module external sourcemap", () => {
  it("never picks the .map output as the module even when esbuild lists it first", () => {
    const picked = pickJsAndCssOutputs([
      output("/x/out.js.map", '{"version":3}'),
      output("/x/out.css", ".a{}"),
      output("/x/out.js", "export {};"),
    ]);
    expect(picked.jsFile?.path).toBe("/x/out.js");
    expect(picked.cssText).toBe(".a{}");
    expect(picked.sourceMapText).toBe('{"version":3}');
  });

  it("registers the map as an asset ticket and points sourceMappingURL at it", () => {
    const assets: { bytes: Buffer; mimeType: string; ticket: string }[] = [];
    const source = attachExternalSourceMap(
      "export {};",
      '{"version":3}',
      assets
    );
    expect(assets).toHaveLength(1);
    const [asset] = assets;
    expect(asset?.mimeType).toBe(LIVE_MODULE_SOURCE_MAP_MIME_TYPE);
    expect(asset?.bytes.toString("utf8")).toBe('{"version":3}');
    const url = source.match(/\/\/# sourceMappingURL=(\S+)\s*$/u)?.[1];
    expect(url && liveModuleAssetTicketFromUrl(url)).toBe(asset?.ticket);
    expect(source).not.toContain("data:application/json");
  });

  it("leaves the module untouched when esbuild emitted no map", () => {
    const assets: { bytes: Buffer; mimeType: string; ticket: string }[] = [];
    expect(attachExternalSourceMap("export {};", undefined, assets)).toBe(
      "export {};"
    );
    expect(assets).toHaveLength(0);
  });

  it("compiled canvases carry no inline map; the ticketed map resolves original sources", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "smoke/hello.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).not.toContain("sourceMappingURL=data:");
    const mapUrl = source.match(/\/\/# sourceMappingURL=(\S+)\s*$/u)?.[1];
    expect(mapUrl).toBeDefined();
    const mapTicket = liveModuleAssetTicketFromUrl(mapUrl ?? "");
    expect(mapTicket).not.toBeNull();
    const asset = service.getAssetByTicket(mapTicket ?? "");
    expect(asset?.mimeType).toBe(LIVE_MODULE_SOURCE_MAP_MIME_TYPE);
    const map = JSON.parse(Buffer.from(asset!.bytes).toString("utf8")) as {
      sources: string[];
      sourcesContent?: string[];
      version: number;
    };
    expect(map.version).toBe(3);
    expect(map.sources.some((s) => s.endsWith("hello.canvas.tsx"))).toBe(true);
    expect(map.sourcesContent?.length).toBeGreaterThan(0);
  });
});
