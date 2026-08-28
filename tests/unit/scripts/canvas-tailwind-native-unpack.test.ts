import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectUnpackErrors,
  findPierApps,
  inferMacAppArch,
  loadUnpackedNatives,
  unpackedResourcesDir,
  verifyDistBuilder,
  verifyUnpackedRoot,
} from "../../../scripts/verify-canvas-tailwind-native-unpack.mjs";

const tempDirs: string[] = [];
const repoRequire = createRequire(`${process.cwd()}/package.json`);

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function packageDirFromResolve(specifier: string, from = repoRequire): string {
  let dir = dirname(from.resolve(specifier));
  for (let step = 0; step < 4; step += 1) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { name?: string };
      if (pkg.name === specifier) {
        return dir;
      }
    } catch {
      // keep walking toward the package root
    }
    dir = dirname(dir);
  }
  throw new Error(`package dir not found for ${specifier}`);
}

describe("canvas Tailwind native unpack verifier", () => {
  it("build-dist runs the unpack loader after electron-builder", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/build-dist.sh"),
      "utf8"
    );
    expect(source).toContain("verify-mac-release-artifacts.mjs");
    expect(source).toContain("verify-canvas-tailwind-native-unpack.mjs");
    expect(
      source.indexOf("verify-canvas-tailwind-native-unpack.mjs")
    ).toBeGreaterThan(
      source.indexOf("electron-builder --mac --arm64 --x64 --publish never")
    );
  });

  it("rejects a packed app whose asar.unpacked tree is missing", () => {
    const dist = makeTempDir("pier-unpack-missing-");
    const app = join(dist, "mac-arm64", "Pier.app");
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    const result = verifyDistBuilder(dist);
    expect(result.apps).toEqual([app]);
    expect(
      result.errors.some((error) => error.includes("missing unpacked"))
    ).toBe(true);
  });

  it.skipIf(process.platform !== "darwin")(
    "loads oxide and lightningcss from a flattened unpacked layout",
    () => {
      const dist = makeTempDir("pier-unpack-flat-");
      const app = join(dist, "mac-arm64", "Pier.app");
      const unpacked = unpackedResourcesDir(app);
      const modules = join(unpacked, "node_modules");
      mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
      mkdirSync(modules, { recursive: true });

      const oxideJs = repoRequire.resolve("@tailwindcss/oxide");
      const oxideRequire = createRequire(oxideJs);
      const oxideNative = oxideRequire.resolve(
        `@tailwindcss/oxide-${process.platform}-${process.arch}`
      );
      const twNode = repoRequire.resolve("@tailwindcss/node");
      const twNodeRequire = createRequire(twNode);
      const lightning = twNodeRequire.resolve("lightningcss");
      const lightningRequire = createRequire(lightning);
      const lightningNative = lightningRequire.resolve(
        `lightningcss-${process.platform}-${process.arch}`
      );
      const esbuildBin = repoRequire.resolve(
        `@esbuild/${process.platform}-${process.arch}/bin/esbuild`
      );

      cpSync(
        packageDirFromResolve("@tailwindcss/oxide"),
        join(modules, "@tailwindcss/oxide"),
        {
          recursive: true,
        }
      );
      mkdirSync(join(modules, "@tailwindcss"), { recursive: true });
      cpSync(
        dirname(oxideNative),
        join(modules, `@tailwindcss/oxide-${process.platform}-${process.arch}`),
        {
          recursive: true,
        }
      );
      cpSync(
        packageDirFromResolve("@tailwindcss/node"),
        join(modules, "@tailwindcss/node"),
        {
          recursive: true,
        }
      );
      cpSync(dirname(dirname(lightning)), join(modules, "lightningcss"), {
        recursive: true,
      });
      cpSync(
        dirname(lightningNative),
        join(modules, `lightningcss-${process.platform}-${process.arch}`),
        { recursive: true }
      );
      mkdirSync(join(modules, "@esbuild"), { recursive: true });
      cpSync(
        dirname(dirname(esbuildBin)),
        join(modules, "@esbuild", `${process.platform}-${process.arch}`),
        { recursive: true }
      );

      expect(findPierApps(dist)).toEqual([app]);
      expect(collectUnpackErrors(unpacked)).toEqual([]);
      expect(loadUnpackedNatives(unpacked)).toEqual([]);
      expect(verifyUnpackedRoot(unpacked).errors).toEqual([]);
      expect(verifyDistBuilder(dist).errors).toEqual([]);
    }
  );

  it("infers Intel vs Apple Silicon from electron-builder output paths", () => {
    expect(inferMacAppArch("/tmp/dist-builder/mac-arm64/Pier.app")).toBe(
      "arm64"
    );
    expect(inferMacAppArch("/tmp/dist-builder/mac/Pier.app")).toBe("x64");
  });

  it("rejects an Intel app that only unpacked Apple Silicon natives", () => {
    const dist = makeTempDir("pier-unpack-x64-host-natives-");
    const app = join(dist, "mac", "Pier.app");
    const unpacked = unpackedResourcesDir(app);
    mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(unpacked, "node_modules"), { recursive: true });
    mkdirSync(join(unpacked, "node_modules", "@tailwindcss"), {
      recursive: true,
    });
    mkdirSync(
      join(unpacked, "node_modules", "@tailwindcss", "oxide-darwin-arm64"),
      { recursive: true }
    );
    mkdirSync(join(unpacked, "node_modules", "lightningcss-darwin-arm64"), {
      recursive: true,
    });
    const result = verifyDistBuilder(dist);
    expect(result.apps).toEqual([app]);
    expect(
      result.errors.some((error) => error.includes("oxide-darwin-x64"))
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("lightningcss-darwin-x64"))
    ).toBe(true);
  });
});
