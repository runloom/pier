// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  homeLiveRootSpec,
  projectLiveRootSpec,
} from "@shared/contracts/live-modules.ts";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveModulesService } from "../../../../src/main/services/live-modules/service.ts";

/**
 * Canvas project trust gate at the compile boundary:
 * untrusted project roots refuse compilation with a typed `trust` payload;
 * trusted roots and home-scope roots are never gated.
 */

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

async function createProjectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pier-canvas-gate-"));
  dirs.push(root);
  await mkdir(join(root, ".pier", "canvases"), { recursive: true });
  await writeFile(
    join(root, ".pier", "canvases", "hello.canvas.tsx"),
    "export default function Hello() {\n  return null;\n}\n"
  );
  return root;
}

describe("live-modules canvas trust gate", () => {
  it("refuses compiling an untrusted project root and reports the path", async () => {
    const root = await createProjectRoot();
    const service = createLiveModulesService({
      resolveHomeRoot: () => join(root, "home-unused"),
      resolveProjectTrust: async () => false,
    });

    const spec = projectLiveRootSpec({ projectRootPath: root });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "hello.canvas.tsx");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refusal");
    }
    // macOS /tmp is a symlink — compare against the resolved path.
    expect(result.trust).toEqual({ projectRootPath: await realpath(root) });
  });

  it("compiles a trusted project root without a trust payload", async () => {
    const root = await createProjectRoot();
    const service = createLiveModulesService({
      resolveHomeRoot: () => join(root, "home-unused"),
      resolveProjectTrust: async () => true,
    });

    const spec = projectLiveRootSpec({ projectRootPath: root });
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "hello.canvas.tsx");

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect("trust" in result).toBe(false);
    }
  });

  it("never gates home-scope roots even when the checker refuses everything", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "pier-canvas-home-"));
    dirs.push(homeRoot);
    await mkdir(join(homeRoot, "canvases"), { recursive: true });
    await writeFile(
      join(homeRoot, "canvases", "hello.canvas.tsx"),
      "export default function Hello() {\n  return null;\n}\n"
    );
    const service = createLiveModulesService({
      resolveHomeRoot: () => homeRoot,
      resolveProjectTrust: async () => false,
    });

    const spec = homeLiveRootSpec();
    service.registerRoot(spec);
    const result = await service.compile(spec.id, "canvases/hello.canvas.tsx");

    // Home canvases must not be refused by the project gate; whether the
    // compile itself succeeds depends on the fixture, but the gate is silent.
    expect(result.ok === false && "trust" in result).toBe(false);
  });
});
