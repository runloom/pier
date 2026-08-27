// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  homeLiveRootSpec,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import {
  LIVE_MODULE_SCHEME,
  liveModuleRuntimeIdFromUrl,
  liveModuleTicketFromUrl,
} from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLiveModuleProtocolHandler,
  runtimeShimSource,
} from "../../../../src/main/live-modules/protocol-handler.ts";
import { recoverEsbuildService } from "../../../../src/main/services/live-modules/compile-context-cache.ts";
import { isDeniedBareSpecifier } from "../../../../src/main/services/live-modules/fence.ts";
import { createLiveModulesService } from "../../../../src/main/services/live-modules/service.ts";

const FIXTURES = fileURLToPath(
  new URL("../../../../fixtures/live-modules", import.meta.url)
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

describe("live-modules fence", () => {
  it("denies electron and node builtins when node_modules disallowed", () => {
    expect(isDeniedBareSpecifier("electron", false)).toBe(true);
    expect(isDeniedBareSpecifier("node:fs", false)).toBe(true);
    expect(isDeniedBareSpecifier("fs", false)).toBe(true);
    expect(isDeniedBareSpecifier("lodash", false)).toBe(true);
    expect(isDeniedBareSpecifier("react", false)).toBe(false);
    expect(isDeniedBareSpecifier("react-dom", false)).toBe(false);
    expect(isDeniedBareSpecifier("react-dom/client", false)).toBe(false);
    expect(isDeniedBareSpecifier("react-dom/server", false)).toBe(true);
    expect(isDeniedBareSpecifier("pier/canvas", false)).toBe(false);
    expect(isDeniedBareSpecifier("pier/host", false)).toBe(false);
    expect(isDeniedBareSpecifier("pier/visualizations", false)).toBe(true);
    expect(isDeniedBareSpecifier("framer-motion", false)).toBe(true);
    expect(
      isDeniedBareSpecifier("framer-motion", false, "react", ["framer-motion"])
    ).toBe(false);
    expect(
      isDeniedBareSpecifier("framer-motion/client", false, "react", [
        "framer-motion",
      ])
    ).toBe(false);
    expect(
      isDeniedBareSpecifier("framer-motion-evil", false, "react", [
        "framer-motion",
      ])
    ).toBe(true);
    expect(
      isDeniedBareSpecifier("electron", false, "react", ["electron"])
    ).toBe(true);
  });

  it("allowlists framework bare packages only for non-React", () => {
    expect(isDeniedBareSpecifier("vue", false, "vue")).toBe(false);
    expect(isDeniedBareSpecifier("@vue/runtime-core", false, "vue")).toBe(
      false
    );
    expect(isDeniedBareSpecifier("lodash", false, "vue")).toBe(true);
    expect(isDeniedBareSpecifier("solid-js", false, "solid")).toBe(false);
    expect(isDeniedBareSpecifier("svelte", false, "svelte")).toBe(false);
    expect(isDeniedBareSpecifier("vue", false, "react")).toBe(true);
  });
});

describe("live-modules fence node_modules path", () => {
  it("rejects relative imports that resolve under node_modules", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-nm-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(join(projectRoot, "node_modules", "evil"), { recursive: true });
    await mkdir(canvases, { recursive: true });
    await writeFile(
      join(projectRoot, "node_modules", "evil", "index.js"),
      "export const x = 1;\n"
    );
    await writeFile(
      join(canvases, "nm.canvas.tsx"),
      [
        'import { x } from "../../../node_modules/evil/index.js";',
        "export default function N() {",
        "  return <span>{String(x)}</span>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "nm.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });

  it("compiles a project canvas that imports the default allowed package", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-motion-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    const pkg = join(projectRoot, "node_modules", "framer-motion");
    await mkdir(pkg, { recursive: true });
    await mkdir(canvases, { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      `${JSON.stringify({
        exports: { ".": "./index.js" },
        name: "framer-motion",
        type: "module",
      })}\n`
    );
    await writeFile(join(pkg, "index.js"), "export const motion = {};\n");
    await writeFile(
      join(canvases, "motion.canvas.tsx"),
      [
        'import { motion } from "framer-motion";',
        "export default function Motion() {",
        "  return <span>{String(Boolean(motion))}</span>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "motion.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("still denies lodash on a default project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-lodash-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(
      join(canvases, "lodash.canvas.tsx"),
      [
        'import _ from "lodash";',
        "export default function L() {",
        "  return <span>{String(_)}</span>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "lodash.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });
});

describe("live-modules react runtime shim surface", () => {
  it("exposes React 19 hooks used by plugin-api and canvases", () => {
    const source = runtimeShimSource("react");
    for (const name of [
      "use",
      "useOptimistic",
      "useActionState",
      "useEffectEvent",
      "cache",
      "useTransition",
    ]) {
      expect(source).toContain(name);
    }
    const dom = runtimeShimSource("react-dom");
    expect(dom).toContain("useFormStatus");
  });
});

describe("live-modules pier-canvas inlined stub", () => {
  it("compiles React canvas with globalThis stub (not protocol runtime)", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    await writeFile(
      join(homeRoot, "canvases", "kit.canvas.tsx"),
      `import { Frame, Input } from "pier/canvas";
export default function Kit() {
  return <Frame><Input /></Frame>;
}
`
    );
    const result = await service.compile("pier.canvas.home", "kit.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("__PIER_LIVE_CANVAS__");
    expect(source).toMatch(/Frame|getCanvas/u);
    expect(source).not.toContain(`${LIVE_MODULE_SCHEME}://runtime/pier-canvas`);
  });
});

describe("live-modules service", () => {
  it("serves opaque tickets via protocol handler", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());

    await writeFile(
      join(homeRoot, "canvases", "hello.canvas.tsx"),
      "export default function Hello() { return null; }\n"
    );

    const result = await service.compile(
      "pier.canvas.home",
      "hello.canvas.tsx"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.url.startsWith(`${LIVE_MODULE_SCHEME}://module/`)).toBe(true);
    const ticket = liveModuleTicketFromUrl(result.url);
    expect(ticket).toBeTruthy();
    expect(
      service.getArtifactByTicket(ticket!)?.bytes.byteLength
    ).toBeGreaterThan(0);

    const handler = createLiveModuleProtocolHandler(() => service);
    expect((await handler(new Request(result.url))).status).toBe(200);
    expect(
      (
        await handler(
          new Request(`${LIVE_MODULE_SCHEME}://module/${"a".repeat(22)}`)
        )
      ).status
    ).toBe(404);
  });

  it("externalizes react-dom/client to host runtime", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-rdc-"));
    await mkdir(join(projectRoot, ".pier", "canvases"), { recursive: true });
    await writeFile(
      join(projectRoot, ".pier", "canvases", "client.canvas.tsx"),
      [
        'import { createRoot } from "react-dom/client";',
        "export default function ClientCanvas() {",
        "  void createRoot;",
        "  return null;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "client.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("pier-live://runtime/react-dom-client");
    expect(source).not.toMatch(/function createRoot/u);
  });

  it("uses distinct root ids per project path", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const a = await mkdtemp(join(tmpdir(), "pier-worktree-a-"));
    const b = await mkdtemp(join(tmpdir(), "pier-worktree-b-"));
    const service = createService(homeRoot);
    const { projectLiveRootId } = await import(
      "@shared/contracts/live-modules.ts"
    );
    expect(projectLiveRootId(a)).not.toBe(projectLiveRootId(b));
    const specA = projectLiveRootSpec({ projectRootPath: a });
    const specB = projectLiveRootSpec({ projectRootPath: b });
    service.registerRoot(specA);
    service.registerRoot(specB);
    expect(specA.id).toBe(projectLiveRootId(a));
    expect(specB.id).toBe(projectLiveRootId(b));
    // Both roots remain registered (fixed id would have clobbered).
    const diagA = await service.compile(specA.id, "missing.canvas.tsx");
    const diagB = await service.compile(specB.id, "missing.canvas.tsx");
    expect(diagA.ok).toBe(false);
    expect(diagB.ok).toBe(false);
    if (!(diagA.ok || diagB.ok)) {
      expect(diagA.diagnostics[0]?.message).not.toMatch(/unknown live root/u);
      expect(diagB.diagnostics[0]?.message).not.toMatch(/unknown live root/u);
    }
  });

  it("rejects non-React canvas on home roots", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "x.canvas.vue"),
      "<template><div>hi</div></template>\n"
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const result = await service.compile("pier.canvas.home", "x.canvas.vue");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics[0]?.message).toMatch(/project|vue/iu);
  });

  it("releaseRoot drops watchers after last retain", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "a.canvas.tsx"),
      "export default function A() { return null; }\n"
    );
    const service = createService(homeRoot);
    const id = service.retainRoot(homeLiveRootSpec());
    service.retainRoot(homeLiveRootSpec());
    await service.compile(id, "a.canvas.tsx");
    service.releaseRoot(id);
    // Still retained once — compile still works
    const mid = await service.compile(id, "a.canvas.tsx");
    expect(mid.ok).toBe(true);
    service.releaseRoot(id);
    const after = await service.compile(id, "a.canvas.tsx");
    expect(after.ok).toBe(false);
  });

  it("clears watchers when root disposer runs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-disp-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    const depPath = join(canvases, "dep.ts");
    await writeFile(depPath, "export const label = 'v1';\n");
    await writeFile(
      join(canvases, "watch.canvas.tsx"),
      [
        'import { Text } from "pier/canvas";',
        'import { label } from "./dep";',
        "export default function WatchCanvas() {",
        "  return <Text>{label}</Text>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const events: string[] = [];
    const service = createLiveModulesService({
      broadcast: (event) => {
        events.push(event.type);
      },
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    const dispose = service.registerRoot(spec);
    const compiled = await service.compile(spec.id, "watch.canvas.tsx");
    expect(compiled.ok).toBe(true);
    dispose();
    events.length = 0;
    await writeFile(depPath, "export const label = 'v2';\n");
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    expect(events).not.toContain("stale");
  });

  it("emits stale when a watched graph file changes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-watch-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    const depPath = join(canvases, "dep.ts");
    await writeFile(depPath, "export const label = 'v1';\n");
    await writeFile(
      join(canvases, "watch.canvas.tsx"),
      [
        'import { Text } from "pier/canvas";',
        'import { label } from "./dep";',
        "export default function WatchCanvas() {",
        "  return <Text>{label}</Text>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const events: string[] = [];
    const service = createLiveModulesService({
      broadcast: (event) => {
        events.push(event.type);
      },
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const compiled = await service.compile(spec.id, "watch.canvas.tsx");
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    events.length = 0;

    await writeFile(depPath, "export const label = 'v2';\n");
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (events.includes("stale") || Date.now() - started > 8000) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
    expect(events).toContain("stale");
  });

  it("compiles pure pier/canvas canvas and externalizes react", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      directory: ".",
      projectRootPath: FIXTURES,
    });
    service.registerRoot(spec);

    const result = await service.compile(spec.id, "pure-ui.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain(`${LIVE_MODULE_SCHEME}://runtime/`);
    expect(source).not.toMatch(/function createElement/u);
    expect(
      liveModuleRuntimeIdFromUrl(`${LIVE_MODULE_SCHEME}://runtime/react`)
    ).toBe("react");
    // pier/canvas is inlined as a globalThis stub (not pier-live://runtime/pier-canvas)
    // so whitelist growth does not require a main-process protocol restart.
    expect(source).toContain("__PIER_LIVE_CANVAS__");
    expect(source).not.toContain(`${LIVE_MODULE_SCHEME}://runtime/pier-canvas`);
    // esbuild tree-shakes unused stub exports and drops the `export` keyword on
    // inlined helpers — assert used primitives resolve via getCanvas().
    expect(source).toContain("getCanvas().Button");
    expect(source).toContain("getCanvas().Stack");
  });

  it("compiles in-repo hello.canvas.tsx with Frame via pier/canvas stub", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const projectRoot = process.cwd();
    const spec = projectLiveRootSpec({
      directory: ".pier/canvases",
      projectRootPath: projectRoot,
    });
    service.registerRoot(spec);

    const result = await service.compile(spec.id, "smoke/hello.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("__PIER_LIVE_CANVAS__");
    expect(source).toContain("getCanvas().Frame");
    expect(source).toContain("getCanvas().Badge");
    expect(source).not.toContain(`${LIVE_MODULE_SCHEME}://runtime/pier-canvas`);
  });

  it("compiles mobile-companion through Artboard and Mermaid runtime stubs", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      directory: ".pier/canvases",
      projectRootPath: process.cwd(),
    });
    service.registerRoot(spec);
    const result = await service.compile(
      spec.id,
      "mobile-companion/mobile-companion.canvas.tsx"
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("getCanvas().ArtboardStage");
    expect(source).toContain("getCanvas().Artboard");
    expect(source).toContain("getCanvas().Mermaid");
  });

  it("compiles workbench-into-canvas gold through the Mermaid runtime stub", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const projectRoot = process.cwd();
    const spec = projectLiveRootSpec({
      directory: ".pier/canvases",
      projectRootPath: projectRoot,
    });
    service.registerRoot(spec);

    const result = await service.compile(
      spec.id,
      "workbench-into-canvas/workbench-into-canvas.canvas.tsx"
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("getCanvas().Mermaid");
  });

  it("compiles multi-agent gold through Mermaid without a repaint layer", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      directory: ".pier/canvases",
      projectRootPath: process.cwd(),
    });
    service.registerRoot(spec);
    const result = await service.compile(
      spec.id,
      "multi-agent-orchestration-gold/multi-agent-orchestration-gold.canvas.tsx"
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("getCanvas().Mermaid");
    // Node chrome (kind/tone) is authored in data.json and loaded at runtime;
    // the bundle must not carry a second chrome map.
    expect(source).not.toContain("paintMermaidNodes");
  });

  it("compiles project Button via @/ path", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      directory: ".",
      projectRootPath: FIXTURES,
    });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "import-button.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.graph.some((p) => p.includes("button"))).toBe(true);
  });

  it("rejects electron imports and path escape", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-proj-"));
    await mkdir(join(projectRoot, ".pier", "canvases"), { recursive: true });
    await writeFile(
      join(projectRoot, ".pier", "canvases", "bad.canvas.tsx"),
      'import "electron";\nexport default function Bad() { return null; }\n'
    );
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    expect((await service.compile(spec.id, "bad.canvas.tsx")).ok).toBe(false);
    expect((await service.compile(spec.id, "../secret.canvas.tsx")).ok).toBe(
      false
    );
  });

  it("home root cannot resolve @/ project paths or escape canvases", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "sneak.canvas.tsx"),
      'import { Button } from "@/ui/button";\nexport default function S() { return <Button />; }\n'
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const alias = await service.compile("pier.canvas.home", "sneak.canvas.tsx");
    expect(alias.ok, JSON.stringify(alias)).toBe(false);

    await writeFile(
      join(homeRoot, "canvases", "escape.canvas.tsx"),
      'import x from "../../../../package.json";\nexport default function E() { return <span>{String(x)}</span>; }\n'
    );
    const escapeResult = await service.compile(
      "pier.canvas.home",
      "escape.canvas.tsx"
    );
    expect(escapeResult.ok, JSON.stringify(escapeResult)).toBe(false);
  });

  it("forcePreviewBarrel rejects deep imports and allows barrel", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      directory: ".",
      projectRootPath: FIXTURES,
      resolve: {
        forcePreviewBarrel: true,
        previewBarrel: "preview-exports.ts",
        tsconfigPaths: true,
      },
    });
    service.registerRoot(spec);
    expect(
      (await service.compile(spec.id, "import-button.canvas.tsx")).ok
    ).toBe(false);

    const ok = await service.compile(spec.id, "barrel-only.canvas.tsx");
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
  });

  it("rejects registering pier-home as project", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    expect(() =>
      service.registerRoot(
        projectLiveRootSpec({
          projectRootPath: join(homeRoot, "pier-home"),
        })
      )
    ).toThrow(/pier-home/);
  });

  it("re-register replaces an existing root id", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    expect(() => service.registerRoot(homeLiveRootSpec())).not.toThrow();
  });

  it("fence allows a file named ..foo under root", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "..foo.canvas.tsx"),
      "export default function Odd() { return null; }\n"
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const result = await service.compile(
      "pier.canvas.home",
      "..foo.canvas.tsx"
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("subscribe receives changed after compile", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "hello.canvas.tsx"),
      "export default function Hello() { return null; }\n"
    );
    const service = createService(homeRoot);
    service.registerRoot(homeLiveRootSpec());
    const events: string[] = [];
    service.subscribe("pier.canvas.home", (e) => {
      events.push(e.type);
    });
    await service.compile("pier.canvas.home", "hello.canvas.tsx");
    expect(events).toContain("changed");
  });

  it("compiles in-repo smoke + blank templates", async () => {
    const projectRoot = process.cwd();
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({
      projectRootPath: projectRoot,
    });
    service.registerRoot(spec);

    for (const relPath of [
      "smoke/hello.canvas.tsx",
      "templates/blank.canvas.tsx",
    ] as const) {
      const result = await service.compile(spec.id, relPath);
      expect(result.ok, `${relPath}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) {
        continue;
      }
      const source = Buffer.from(
        service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
      ).toString("utf8");
      // Named export `canvas` meta must survive the ESM bundle for Viewer chrome.
      expect(source).toMatch(/kind:\s*["']?composition/u);
    }
  });

  it("returns line diagnostics and watches entry after first compile failure", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-fail-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    const rel = "bad.canvas.tsx";
    await writeFile(join(canvases, rel), "export default function Broken( {\n");
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);

    const stale: string[] = [];
    service.subscribe(spec.id, (event) => {
      if (event.type === "stale") {
        stale.push(event.moduleId);
      }
    });

    const failed = await service.compile(spec.id, rel);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.graph?.some((p) => p.endsWith(rel))).toBe(true);
      const hasLine = failed.diagnostics.some(
        (d) => typeof d.line === "number" && d.line > 0
      );
      // Prefer structured line; fall back to message still being non-empty.
      expect(hasLine || failed.diagnostics[0]?.message.length).toBeTruthy();
    }

    await writeFile(
      join(canvases, rel),
      [
        "export default function Fixed() {",
        "  return <span>ok</span>;",
        "}",
        "",
      ].join("\n")
    );
    // Recompile after fix — graph registration on first failure is the contract;
    // auto-stale is covered separately by watch tests.
    const second = await service.compile(spec.id, rel);
    expect(second.ok, JSON.stringify(second)).toBe(true);
  });

  it("re-reads canvas sources after a removed pier/canvas export failure", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-mermaid-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    const rel = "flow.canvas.tsx";
    await writeFile(
      join(canvases, rel),
      [
        'import { RetiredDiagram } from "pier/canvas";',
        "export default function Flow() {",
        '  return <RetiredDiagram aria-label="g" chart="graph TD;A-->B" />;',
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);

    const failed = await service.compile(spec.id, rel);
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).toMatch(/RetiredDiagram/);

    await writeFile(
      join(canvases, rel),
      [
        'import { Mermaid } from "pier/canvas";',
        "export default function Flow() {",
        "  return (",
        "    <Mermaid",
        '      aria-label="g"',
        '      edges={[{ source: "a", target: "b" }]}',
        '      nodes={[{ id: "a", title: "A" }, { id: "b", title: "B" }]}',
        "    />",
        "  );",
        "}",
        "",
      ].join("\n")
    );
    const second = await service.compile(spec.id, rel);
    expect(second.ok, JSON.stringify(second)).toBe(true);
  });

  it("injects scoped CSS from explicit css imports", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-css-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(join(canvases, "theme.css"), "h2 { color: red; }\n");
    await writeFile(
      join(canvases, "styled.canvas.tsx"),
      [
        'import "./theme.css";',
        "export default function Styled() {",
        "  return <h2>Title</h2>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "styled.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    expect(source).toContain("data-pier-live-css");
    expect(source).toContain("@scope");
    expect(source).toContain("color: red");
  });

  it("keeps dependency graph across cached-context rebuilds", async () => {
    // Regression: the cached esbuild context's plugin closures capture the
    // FIRST compile's graphRef; a per-call reset object would leave later
    // compiles with an empty graph (dependency hot-reload would die).
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-live-graph-"));
    const canvases = join(projectRoot, ".pier", "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(join(canvases, "dep.ts"), "export const dep = 1;\n");
    await writeFile(
      join(canvases, "graph.canvas.tsx"),
      [
        'import { dep } from "./dep";',
        "export default function Graph() {",
        "  return <span>{String(dep)}</span>;",
        "}",
        "",
      ].join("\n")
    );
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createService(homeRoot);
    const spec = projectLiveRootSpec({ projectRootPath: projectRoot });
    service.registerRoot(spec);

    const first = await service.compile(spec.id, "graph.canvas.tsx");
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.graph).toContain(".pier/canvases/dep.ts");

    // Second compile hits the cached context — graph must still include dep.
    const second = await service.compile(spec.id, "graph.canvas.tsx");
    expect(second.ok, JSON.stringify(second)).toBe(true);
    if (second.ok) {
      expect(second.graph).toContain(".pier/canvases/dep.ts");
      expect(second.graph).toContain(".pier/canvases/graph.canvas.tsx");
    }
  });

  it("compiles again after the esbuild helper is recovered", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const canvases = join(homeRoot, "canvases");
    await mkdir(canvases, { recursive: true });
    await writeFile(
      join(canvases, "hello.canvas.tsx"),
      "export default function Hello() { return <span>hi</span>; }\n"
    );
    const service = createService(homeRoot);
    const spec = homeLiveRootSpec();
    service.registerRoot(spec);

    const first = await service.compile(spec.id, "hello.canvas.tsx");
    expect(first.ok, JSON.stringify(first)).toBe(true);

    await recoverEsbuildService();

    const second = await service.compile(spec.id, "hello.canvas.tsx");
    expect(second.ok, JSON.stringify(second)).toBe(true);
  });
});
