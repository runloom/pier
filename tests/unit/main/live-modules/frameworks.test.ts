// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import { liveModuleTicketFromUrl } from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveModulesService } from "../../../../src/main/services/live-modules/service.ts";

const PROJECT_ROOT = process.cwd();

const services: ReturnType<typeof createLiveModulesService>[] = [];

afterEach(() => {
  for (const service of services) {
    service.dispose();
  }
  services.length = 0;
});

describe("live-modules multi-framework samples", () => {
  it("compiles in-repo Vue / Solid / Svelte framework demos", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
    service.registerRoot(spec);

    for (const relPath of [
      "smoke/hello.canvas.vue",
      "smoke/hello.canvas.solid.tsx",
      "smoke/hello.canvas.svelte",
    ] as const) {
      const result = await service.compile(spec.id, relPath);
      expect(result.ok, `${relPath}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) {
        continue;
      }
      const source = Buffer.from(
        service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
      ).toString("utf8");
      // Host-friendly mount injection (vue/svelte) or explicit mount (solid).
      expect(source).toMatch(/function mount|export function mount/u);
    }
  });

  it("attaches Vue SFC __scopeId so scoped styles match DOM", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
    });
    services.push(service);
    const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
    service.registerRoot(spec);
    const result = await service.compile(
      spec.id,
      "smoke/scoped-style.canvas.vue"
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    const source = Buffer.from(
      service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!.bytes
    ).toString("utf8");
    // Scoped CSS is injected with [data-v-<id>] selectors.
    expect(source).toMatch(/\.box\[data-v-[a-f0-9]+\]/u);
    // Runtime applies the attribute only when the component options carry
    // __scopeId (compileScript + genDefaultAs does not set it for us).
    expect(source).toMatch(/__scopeId\s*=\s*["']data-v-[a-f0-9]+["']/u);
    expect(source).toContain("data-pier-live-css");
  });

  it("react demo still compiles without framework packages in graph", async () => {
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
    expect(source).toContain("pier-live://runtime/react");
  });

  it("rejects pier/canvas import on non-React frameworks", async () => {
    const { mkdir, writeFile, unlink } = await import("node:fs/promises");
    const badRel = "smoke/__reject-pier-canvas.canvas.vue";
    const badAbs = join(PROJECT_ROOT, ".pier/canvases", badRel);
    await mkdir(join(PROJECT_ROOT, ".pier/canvases/smoke"), {
      recursive: true,
    });
    await writeFile(
      badAbs,
      `<script setup>
import { Button } from "pier/canvas";
const x = Button;
</script>
<template><div /></template>
`
    );
    try {
      const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
      const service = createLiveModulesService({
        resolveHomeRoot: () => homeRoot,
      });
      services.push(service);
      const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
      service.registerRoot(spec);
      const result = await service.compile(spec.id, badRel);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      const messages = result.diagnostics.map((d) => d.message).join("\n");
      expect(messages).toMatch(/pier\/canvas|React-only/iu);
    } finally {
      await unlink(badAbs).catch(() => undefined);
    }
  });

  it("allows one shared visualization runtime from every canvas framework", async () => {
    const { mkdir, writeFile, unlink } = await import("node:fs/promises");
    await mkdir(join(PROJECT_ROOT, ".pier/canvases/smoke"), {
      recursive: true,
    });
    const samples = [
      {
        content: `import { mountDiagram } from "pier/visualizations";
export default function Demo() {
  void mountDiagram;
  return <div />;
}`,
        rel: "smoke/__pier-visualizations.canvas.tsx",
      },
      {
        content: `<script setup>
import { mountDiagram } from "pier/visualizations";
const sharedMount = mountDiagram;
</script>
<template><div :data-shared="typeof sharedMount" /></template>
`,
        rel: "smoke/__pier-visualizations.canvas.vue",
      },
      {
        content: `import { mountDiagram } from "pier/visualizations";
export function mount(element: HTMLElement) {
  void mountDiagram;
  element.textContent = "solid";
  return () => element.replaceChildren();
}
export default function Demo() {
  return null;
}`,
        rel: "smoke/__pier-visualizations.canvas.solid.tsx",
      },
      {
        content: `<script>
import { mountDiagram } from "pier/visualizations";
const sharedMount = mountDiagram;
</script>
<div data-shared={typeof sharedMount}>svelte</div>
`,
        rel: "smoke/__pier-visualizations.canvas.svelte",
      },
    ] as const;
    const absolutePaths: string[] = [];
    try {
      for (const sample of samples) {
        const absolutePath = join(PROJECT_ROOT, ".pier/canvases", sample.rel);
        absolutePaths.push(absolutePath);
        await writeFile(absolutePath, sample.content);
      }
      const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
      const service = createLiveModulesService({
        resolveHomeRoot: () => homeRoot,
      });
      services.push(service);
      const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
      service.registerRoot(spec);
      for (const sample of samples) {
        const result = await service.compile(spec.id, sample.rel);
        expect(result.ok, `${sample.rel}: ${JSON.stringify(result)}`).toBe(
          true
        );
        if (!result.ok) {
          continue;
        }
        const source = Buffer.from(
          service.getArtifactByTicket(liveModuleTicketFromUrl(result.url)!)!
            .bytes
        ).toString("utf8");
        expect(source).toContain("__PIER_LIVE_VISUALIZATIONS__");
      }
    } finally {
      await Promise.all(
        absolutePaths.map((absolutePath) =>
          unlink(absolutePath).catch(() => undefined)
        )
      );
    }
  });

  it("denies node: builtins imported from non-React canvas source", async () => {
    const { mkdir, writeFile, unlink } = await import("node:fs/promises");
    const rel = "smoke/__node-deny.canvas.svelte";
    const abs = join(PROJECT_ROOT, ".pier/canvases", rel);
    await mkdir(join(PROJECT_ROOT, ".pier/canvases/smoke"), {
      recursive: true,
    });
    // Canvas source must not import node:* — only framework internals under
    // node_modules may resolve to the no-op stub.
    await writeFile(
      abs,
      `<script module>
export const canvas = { kind: "composition", title: "deny" };
</script>
<script>
  import fs from "node:fs";
  void fs;
  let count = $state(0);
</script>
<template>
  <button onclick={() => (count += 1)}>{count}</button>
</template>`
    );
    try {
      const homeRoot = await mkdtemp(join(tmpdir(), "pier-live-home-"));
      const service = createLiveModulesService({
        resolveHomeRoot: () => homeRoot,
      });
      services.push(service);
      const spec = projectLiveRootSpec({ projectRootPath: PROJECT_ROOT });
      service.registerRoot(spec);
      const result = await service.compile(spec.id, rel);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const text = result.diagnostics.map((d) => d.message).join("\n");
        expect(text).toMatch(/node:fs|denied node builtin/iu);
      }
    } finally {
      await unlink(abs).catch(() => undefined);
    }
  });
});
