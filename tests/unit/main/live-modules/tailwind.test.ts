// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeLiveRootSpec } from "@shared/contracts/live-modules.ts";
import { liveModuleTicketFromUrl } from "@shared/live-module-url.ts";
import type { Metafile } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLiveModulesService,
  type LiveModulesService,
} from "../../../../src/main/services/live-modules/service.ts";
import {
  buildCanvasTailwindCss,
  type CanvasTailwindCacheSlot,
  createCanvasTailwindCacheSlot,
  entryDirectImportsFromMetafile,
  splitTailwindPropertyRules,
} from "../../../../src/main/services/live-modules/tailwind.ts";

const services: LiveModulesService[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

async function makeHomeService(): Promise<{
  canvasesDir: string;
  service: LiveModulesService;
  spec: ReturnType<typeof homeLiveRootSpec>;
}> {
  const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-tw-"));
  const canvasesDir = join(homeRoot, "canvases");
  await mkdir(canvasesDir, { recursive: true });
  const service = createLiveModulesService({
    resolveHomeRoot: () => homeRoot,
  });
  services.push(service);
  const spec = homeLiveRootSpec();
  service.registerRoot(spec);
  return { canvasesDir, service, spec };
}

function artifactText(service: LiveModulesService, url: string): string {
  const ticket = liveModuleTicketFromUrl(url);
  expect(ticket).toBeTruthy();
  const artifact = service.getArtifactByTicket(ticket ?? "");
  expect(artifact).toBeTruthy();
  return Buffer.from(artifact?.bytes ?? Buffer.alloc(0)).toString("utf8");
}

describe("canvas Tailwind JIT through the real compile pipeline", () => {
  it("compiles arbitrary-value classes into the scoped CSS injector", async () => {
    const { canvasesDir, service, spec } = await makeHomeService();
    await writeFile(
      join(canvasesDir, "hello.canvas.tsx"),
      `export default function Hello() {
  return <div className="bg-[#ff6b35] bg-background p-3">hi</div>;
}
`,
      "utf8"
    );

    const result = await service.compile(spec.id, "hello.canvas.tsx");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    const source = artifactText(service, result.url);
    // Arbitrary value + semantic token both compiled…
    expect(source).toContain("ff6b35");
    expect(source).toContain("var(--background)");
    // …and delivered through the scoped injector, tagged for teardown.
    expect(source).toContain("@scope ([data-pier-canvas-shell])");
    expect(source).toContain("data-pier-live-css");
  });

  it("recompile after a class edit changes the injector hash", async () => {
    const { canvasesDir, service, spec } = await makeHomeService();
    const file = join(canvasesDir, "swap.canvas.tsx");
    await writeFile(
      file,
      `export default function Swap() {
  return <div className="bg-[#ff6b35]">hi</div>;
}
`,
      "utf8"
    );
    const first = await service.compile(spec.id, "swap.canvas.tsx");
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) {
      return;
    }
    const firstSource = artifactText(service, first.url);
    const firstKey = firstSource.match(/::([a-f0-9]{8})/u)?.[1];
    expect(firstKey).toBeTruthy();
    expect(firstSource).toContain("ff6b35");

    await writeFile(
      file,
      `export default function Swap() {
  return <div className="bg-[#00aa88]">hi</div>;
}
`,
      "utf8"
    );
    const second = await service.compile(spec.id, "swap.canvas.tsx");
    expect(second.ok, JSON.stringify(second)).toBe(true);
    if (!second.ok) {
      return;
    }
    const secondSource = artifactText(service, second.url);
    const secondKey = secondSource.match(/::([a-f0-9]{8})/u)?.[1];
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
    expect(secondSource).toContain("00aa88");
  });
});

async function makeGraphFixture(): Promise<{
  aAbs: string;
  dir: string;
  entryAbs: string;
  graph: string[];
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-tw-unit-"));
  const entryAbs = join(dir, "entry.canvas.tsx");
  const aAbs = join(dir, "a.ts");
  const bAbs = join(dir, "b.ts");
  await writeFile(
    entryAbs,
    `import "./a.ts";\nexport default () => <div className="bg-[#111aaa]" />;\n`,
    "utf8"
  );
  await writeFile(
    aAbs,
    `import "./b.ts";\nexport const a = "bg-[#22bb33]";\n`,
    "utf8"
  );
  await writeFile(bAbs, `export const b = "bg-[#cc44dd]";\n`, "utf8");
  return {
    aAbs,
    dir,
    entryAbs,
    graph: ["entry.canvas.tsx", "a.ts", "b.ts"],
  };
}

describe("buildCanvasTailwindCss", () => {
  it("caches by source file-set content hash and invalidates on edit", async () => {
    const fixture = await makeGraphFixture();
    const slot = createCanvasTailwindCacheSlot();
    const input = {
      cacheSlot: slot,
      entryAbsolutePath: fixture.entryAbs,
      entryDirectImports: [fixture.aAbs],
      fenceRoot: fixture.dir,
      graphRelativePaths: fixture.graph,
    };

    const first = await buildCanvasTailwindCss(input);
    expect(first.fromCache).toBe(false);
    expect(first.css).toContain("111aaa");
    expect(first.css).toContain("22bb33");
    expect(first.css).toContain("cc44dd");

    const second = await buildCanvasTailwindCss(input);
    expect(second.fromCache).toBe(true);
    expect(second.css).toBe(first.css);

    await writeFile(
      join(fixture.dir, "b.ts"),
      `export const b = "bg-[#ee55ff]";\n`,
      "utf8"
    );
    const third = await buildCanvasTailwindCss(input);
    expect(third.fromCache).toBe(false);
    expect(third.css).toContain("ee55ff");
  });

  it("reports hot-path duration well under the 100ms budget", async () => {
    const fixture = await makeGraphFixture();
    const slot = createCanvasTailwindCacheSlot();
    const input = {
      cacheSlot: slot,
      entryAbsolutePath: fixture.entryAbs,
      entryDirectImports: [fixture.aAbs],
      fenceRoot: fixture.dir,
      graphRelativePaths: fixture.graph,
    };

    const cold = await buildCanvasTailwindCss(input);
    await writeFile(
      join(fixture.dir, "b.ts"),
      `export const b = "bg-[#ee55ff] p-2";\n`,
      "utf8"
    );
    const hotRebuild = await buildCanvasTailwindCss(input);
    const hotCached = await buildCanvasTailwindCss(input);

    // Timing evidence for the plan's <100ms hot-path target.
    console.info(
      `[canvas-tailwind] cold=${cold.durationMs.toFixed(1)}ms hotRebuild=${hotRebuild.durationMs.toFixed(1)}ms hotCached=${hotCached.durationMs.toFixed(1)}ms`
    );
    expect(hotRebuild.fromCache).toBe(false);
    expect(hotCached.fromCache).toBe(true);
    // Generous CI bound — the practical numbers are single-digit ms.
    expect(hotRebuild.durationMs).toBeLessThan(1000);
  });

  it("flags degradation once the budget is exceeded", async () => {
    const fixture = await makeGraphFixture();
    const slot = createCanvasTailwindCacheSlot();
    const result = await buildCanvasTailwindCss({
      cacheSlot: slot,
      entryAbsolutePath: fixture.entryAbs,
      entryDirectImports: [fixture.aAbs],
      fenceRoot: fixture.dir,
      graphRelativePaths: fixture.graph,
      hotBudgetMs: -1,
    });

    // The triggering build itself is still a full scan…
    expect(result.usedDegradedScan).toBe(false);
    expect(result.css).toContain("cc44dd");
    // …but the overrun is recorded for the next rebuilds + diagnostics.
    expect(slot.degradeScan).toBe(true);
    expect(
      result.diagnostics.some(
        (diag) => diag.severity === "warning" && diag.message.includes("budget")
      )
    ).toBe(true);
  });

  it("degraded scan covers only the entry and its direct imports", async () => {
    const fixture = await makeGraphFixture();
    // Fresh compiler with a persisted degrade decision (previous overrun).
    const slot: CanvasTailwindCacheSlot = { degradeScan: true };
    const result = await buildCanvasTailwindCss({
      cacheSlot: slot,
      entryAbsolutePath: fixture.entryAbs,
      entryDirectImports: [fixture.aAbs],
      fenceRoot: fixture.dir,
      graphRelativePaths: fixture.graph,
      hotBudgetMs: -1,
    });

    expect(result.usedDegradedScan).toBe(true);
    expect(result.css).toContain("111aaa");
    expect(result.css).toContain("22bb33");
    // b.ts is two levels deep — outside the degraded scan set.
    expect(result.css).not.toContain("cc44dd");
    expect(
      result.diagnostics.some(
        (diag) =>
          diag.severity === "warning" && diag.message.includes("direct imports")
      )
    ).toBe(true);
  });

  it("splits @property registrations out of the scoped output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tw-prop-"));
    const entryAbs = join(dir, "entry.canvas.tsx");
    await writeFile(
      entryAbs,
      `export default () => <div className="shadow-lg bg-linear-to-r from-pink-500 to-cyan-400" />;\n`,
      "utf8"
    );
    const result = await buildCanvasTailwindCss({
      cacheSlot: createCanvasTailwindCacheSlot(),
      entryAbsolutePath: entryAbs,
      entryDirectImports: [],
      fenceRoot: dir,
      graphRelativePaths: ["entry.canvas.tsx"],
    });

    expect(result.propertyCss).toContain("@property --tw-shadow");
    expect(result.css).not.toContain("@property");
    // The unscoped tail must contain nothing but @property registrations.
    const withoutProperties = result.propertyCss.replace(
      /@property\s+[^{}]*\{[^{}]*\}/gu,
      ""
    );
    expect(withoutProperties.trim()).toBe("");
  });
});

describe("splitTailwindPropertyRules", () => {
  it("keeps selector rules (including :root) in the scoped part", () => {
    const { css, propertyCss } = splitTailwindPropertyRules(
      `:root { --x: 1; }\n.a { color: red; }\n@property --tw-x { syntax: "*"; inherits: false; }\n@media (hover: hover) { .b:hover { opacity: 0.5; } }`
    );
    expect(css).toContain(":root");
    expect(css).toContain(".a");
    expect(css).toContain("@media");
    expect(propertyCss).toBe(
      `@property --tw-x { syntax: "*"; inherits: false; }`
    );
  });

  it("drops rule-less residue instead of injecting a bare header comment", () => {
    const { css, propertyCss } = splitTailwindPropertyRules(
      "/*! tailwindcss v4 */\n"
    );
    expect(css).toBe("");
    expect(propertyCss).toBe("");
  });
});

describe("entryDirectImportsFromMetafile", () => {
  it("extracts entry direct imports, skipping virtual and external paths", () => {
    const metafile: Metafile = {
      inputs: {
        "canvases/a.ts": {
          bytes: 10,
          imports: [{ kind: "import-statement", path: "canvases/b.ts" }],
        },
        "canvases/hello.canvas.tsx": {
          bytes: 10,
          imports: [
            { kind: "import-statement", path: "canvases/a.ts" },
            {
              kind: "import-statement",
              path: "pier-canvas-stub:pier/canvas",
            },
            {
              external: true,
              kind: "import-statement",
              path: "pier-live://runtime/react",
            },
          ],
        },
      },
      outputs: {},
    };
    const out = entryDirectImportsFromMetafile(
      metafile,
      "/root",
      "/root/canvases/hello.canvas.tsx"
    );
    expect(out).toEqual(["/root/canvases/a.ts"]);
  });

  it("returns empty for a missing metafile", () => {
    expect(
      entryDirectImportsFromMetafile(undefined, "/root", "/root/x.tsx")
    ).toEqual([]);
  });
});
