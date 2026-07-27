// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectLiveRootSpec } from "@shared/contracts/live-modules.ts";
import { liveModuleTicketFromUrl } from "@shared/live-module-url.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveModulesService } from "../../../src/main/services/live-modules/service.ts";

const PROJECT_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

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
    expect(source).toContain("data-pier-live-vue");
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

  it("stubs node: builtins for non-React frameworks instead of denying", async () => {
    const { mkdir, writeFile, unlink } = await import("node:fs/promises");
    const rel = "smoke/__node-stub.canvas.svelte";
    const abs = join(PROJECT_ROOT, ".pier/canvases", rel);
    await mkdir(join(PROJECT_ROOT, ".pier/canvases/smoke"), {
      recursive: true,
    });
    // Exercise BOTH import patterns esbuild emits for CJS-interop shims:
    //   named  — import { createRequire } from "node:module"
    //   default — import nm from "node:module"; nm.createRequire()
    // The stub must expose createRequire on both the named and default exports,
    // and createRequire() must return a callable so chained access doesn't throw.
    await writeFile(
      abs,
      `<script module>
export const canvas = { kind: "composition", title: "stub" };
</script>
<script>
  import { createRequire as namedRequire } from "node:module";
  import nm from "node:module";
  const require1 = namedRequire();
  const require2 = nm.createRequire();
  // Chained access on the returned require must not throw (dead browser path).
  void require1("fs").readFileSync;
  void require2("path").resolve;
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
      expect(result.ok, JSON.stringify(result)).toBe(true);
    } finally {
      await unlink(abs).catch(() => undefined);
    }
  });
});
