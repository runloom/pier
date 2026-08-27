import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Canvas Tailwind JIT loads native oxide / lightningcss binaries. asar is a
 * single file — those `.node` addons must be unpacked like esbuild.
 */

const YML = readFileSync(join(process.cwd(), "electron-builder.yml"), "utf8");

describe("canvas Tailwind native packaging", () => {
  it("asarUnpack lists oxide and lightningcss native packages", () => {
    expect(YML).toContain("**/node_modules/@tailwindcss/oxide/**");
    expect(YML).toContain("**/node_modules/@tailwindcss/oxide-*/**");
    expect(YML).toContain("**/node_modules/@tailwindcss/node/**");
    expect(YML).toContain("**/node_modules/lightningcss/**");
    expect(YML).toContain("**/node_modules/lightningcss-*/**");
  });

  it("pins both darwin native optionalDependencies for dual-arch pack", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as {
      optionalDependencies?: Record<string, string>;
    };
    expect(pkg.optionalDependencies).toMatchObject({
      "@esbuild/darwin-arm64": "0.28.1",
      "@esbuild/darwin-x64": "0.28.1",
      "@tailwindcss/oxide-darwin-arm64": "4.3.3",
      "@tailwindcss/oxide-darwin-x64": "4.3.3",
      "lightningcss-darwin-arm64": "1.32.0",
      "lightningcss-darwin-x64": "1.32.0",
    });
    const workspace = readFileSync(
      join(process.cwd(), "pnpm-workspace.yaml"),
      "utf8"
    );
    expect(workspace).toContain("supportedArchitectures:");
    expect(workspace).toContain("arm64");
    expect(workspace).toContain("x64");
  });
});
