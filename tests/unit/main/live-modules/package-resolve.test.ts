import { describe, expect, it } from "vitest";
import {
  matchPackageExports,
  resolveProjectPackage,
} from "../../../../src/main/services/live-modules/package-resolve.ts";

const PROJECT_ROOT = process.cwd();

describe("live-modules package-resolve (browser conditions)", () => {
  it("matchPackageExports prefers browser/import over node/require", () => {
    const exportsField = {
      browser: {
        import: "./web/dist/web.js",
        require: "./web/dist/web.cjs",
      },
      node: {
        import: "./web/dist/server.js",
        require: "./web/dist/server.cjs",
      },
      import: "./web/dist/web.js",
      require: "./web/dist/web.cjs",
    };
    expect(matchPackageExports(exportsField, ".")).toBe("./web/dist/web.js");
  });

  it("resolves solid-js client builds, not server.cjs", () => {
    const solid = resolveProjectPackage(PROJECT_ROOT, "solid-js");
    const web = resolveProjectPackage(PROJECT_ROOT, "solid-js/web");
    const h = resolveProjectPackage(PROJECT_ROOT, "solid-js/h");
    expect(solid).toMatch(/solid\.js$/u);
    expect(solid).not.toMatch(/server\./u);
    expect(web).toMatch(/web\.js$/u);
    expect(web).not.toMatch(/server\./u);
    expect(h).toBeTruthy();
  });

  it("resolves svelte client entry, not index-server", () => {
    const svelte = resolveProjectPackage(PROJECT_ROOT, "svelte");
    expect(svelte).toMatch(/index-client\.js$/u);
    expect(svelte).not.toMatch(/index-server/u);
  });

  it("resolves solid transitive deps (seroval) from importer context", () => {
    const web = resolveProjectPackage(PROJECT_ROOT, "solid-js/web");
    expect(web).toBeTruthy();
    // Importer-relative resolve is what the bundler uses for nested pnpm deps.
    const seroval = resolveProjectPackage(web!, "seroval");
    const plugins = resolveProjectPackage(web!, "seroval-plugins/web");
    expect(seroval).toMatch(/seroval/u);
    expect(seroval).not.toMatch(/server\./u);
    expect(plugins).toMatch(/seroval-plugins|web/u);
  });

  it("resolves vue runtime bundler build", () => {
    const vue = resolveProjectPackage(PROJECT_ROOT, "vue");
    expect(vue).toBeTruthy();
    expect(vue).toMatch(/vue/u);
  });
});
