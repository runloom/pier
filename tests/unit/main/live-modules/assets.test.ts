// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeLiveRootSpec } from "@shared/contracts/live-modules.ts";
import {
  LIVE_MODULE_SCHEME,
  liveModuleAssetTicketFromUrl,
  liveModuleTicketFromUrl,
} from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveModuleProtocolHandler } from "../../../../src/main/live-modules/protocol-handler.ts";
import {
  CANVAS_ASSET_DATAURL_MAX_BYTES,
  canvasAssetMimeType,
  shouldInlineCanvasAsset,
} from "../../../../src/main/services/live-modules/assets.ts";
import { createLiveModulesService } from "../../../../src/main/services/live-modules/service.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const services: ReturnType<typeof createLiveModulesService>[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

function createService(homeRoot: string) {
  const service = createLiveModulesService({
    resolveHomeRoot: () => homeRoot,
  });
  services.push(service);
  return service;
}

describe("canvas asset helpers", () => {
  it("maps extensions and inlines fonts even above the image threshold", () => {
    expect(canvasAssetMimeType("a.png")).toBe("image/png");
    expect(canvasAssetMimeType("a.SVG")).toBe("image/svg+xml");
    expect(canvasAssetMimeType("a.woff2")).toBe("font/woff2");
    expect(shouldInlineCanvasAsset("dot.png", 16)).toBe(true);
    expect(
      shouldInlineCanvasAsset("hero.png", CANVAS_ASSET_DATAURL_MAX_BYTES + 1)
    ).toBe(false);
    expect(
      shouldInlineCanvasAsset("ui.woff2", CANVAS_ASSET_DATAURL_MAX_BYTES + 1)
    ).toBe(true);
  });
});

describe("canvas asset compile", () => {
  it("inlines a small png as a data URL", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-asset-"));
    const canvases = join(homeRoot, "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(join(canvases, "dot.png"), PNG_1X1);
    await writeFile(
      join(canvases, "pic.canvas.tsx"),
      [
        'import src from "./dot.png";',
        "export default function Pic() {",
        '  return <img alt="" src={src} />;',
        "}",
        "",
      ].join("\n")
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const result = await service.compile("pier.canvas.home", "pic.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("data:image/png;base64,");
    // The only ticketed asset is the external sourcemap — the image itself
    // must be inlined, not served over pier-live://asset.
    const moduleBody = source.replace(/\/\/# sourceMappingURL=\S+\s*$/u, "");
    expect(moduleBody).not.toContain(`${LIVE_MODULE_SCHEME}://asset/`);
  });

  it("tickets a large png and serves it over pier-live://asset", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-asset-lg-"));
    const canvases = join(homeRoot, "canvases");
    await mkdir(canvases, { recursive: true });
    const payload = Buffer.alloc(CANVAS_ASSET_DATAURL_MAX_BYTES + 1, 0x41);
    await writeFile(join(canvases, "hero.png"), payload);
    await writeFile(
      join(canvases, "hero.canvas.tsx"),
      [
        'import src from "./hero.png";',
        "export default function Hero() {",
        '  return <img alt="" src={src} />;',
        "}",
        "",
      ].join("\n")
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const result = await service.compile("pier.canvas.home", "hero.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    const match = source.match(/pier-live:\/\/asset\/[A-Za-z0-9_-]{22,}/u);
    expect(
      match,
      "compiled module must reference an asset ticket"
    ).toBeTruthy();
    const assetUrl = match?.[0] ?? "";
    const assetTicket = liveModuleAssetTicketFromUrl(assetUrl);
    expect(assetTicket).toBeTruthy();
    expect(service.getAssetByTicket(assetTicket!)?.mimeType).toBe("image/png");
    expect(service.getAssetByTicket(assetTicket!)?.bytes.byteLength).toBe(
      payload.byteLength
    );

    const handler = createLiveModuleProtocolHandler(() => service);
    const response = await handler(new Request(assetUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBe(payload.byteLength);
  });

  it("rejects an asset outside the content directory", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-asset-out-"));
    const canvases = join(homeRoot, "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(join(homeRoot, "secret.png"), PNG_1X1);
    await writeFile(
      join(canvases, "leak.canvas.tsx"),
      [
        'import src from "../secret.png";',
        "export default function Leak() {",
        '  return <img alt="" src={src} />;',
        "}",
        "",
      ].join("\n")
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const result = await service.compile("pier.canvas.home", "leak.canvas.tsx");
    expect(result.ok).toBe(false);
  });
});
