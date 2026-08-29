import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createBootstrappedLspRegistry } from "@main/services/lsp/bootstrap-providers.ts";
import { CORE_LSP_CATALOG } from "@main/services/lsp/core-catalog.ts";
import { languageForPath } from "@plugins/builtin/files/renderer/editor/language-detection.ts";
import {
  editorExtensionMapFromMatrix,
  FVM_PROJECT_MARKERS,
  PATH_LANGUAGE_MATRIX,
  pathCatalogFromMatrix,
  pathLspDescriptorsFromMatrix,
  SPECIAL_LSP_CATALOG_ENTRIES,
} from "@shared/language-matrix/index.ts";
import { describe, expect, it } from "vitest";

describe("language matrix governance (scheme A)", () => {
  it("does not ship packages/plugin-lsp-* language packs", () => {
    const packagesDir = join(process.cwd(), "packages");
    if (!existsSync(packagesDir)) return;
    const packs = readdirSync(packagesDir).filter((name) =>
      name.startsWith("plugin-lsp-")
    );
    expect(packs).toEqual([]);
  });

  it("CORE_LSP_CATALOG = special rows + PATH matrix catalog", () => {
    const fromMatrix = pathCatalogFromMatrix();
    expect(CORE_LSP_CATALOG.map((e) => e.id).sort()).toEqual(
      [
        ...SPECIAL_LSP_CATALOG_ENTRIES.map((e) => e.id),
        ...fromMatrix.map((e) => e.id),
      ].sort()
    );
  });

  it("every PATH matrix LSP id is registered in bootstrap", () => {
    const registry = createBootstrappedLspRegistry();
    for (const d of pathLspDescriptorsFromMatrix()) {
      expect(registry.getById(d.id)).not.toBeNull();
    }
  });

  it("catalog installCommand matches matrix descriptors", () => {
    const byId = new Map(
      pathLspDescriptorsFromMatrix().map((d) => [d.id, d] as const)
    );
    for (const row of pathCatalogFromMatrix()) {
      const d = byId.get(row.id);
      expect(d).toBeDefined();
      expect(row.installCommand).toBe(d?.installCommand);
      expect(row.binaryHint).toBe(d?.binaryHint);
    }
  });

  it("editor extension map drives languageForPath for matrix extensions", () => {
    const map = editorExtensionMapFromMatrix();
    for (const [ext, languageId] of Object.entries(map)) {
      // Skip conflicts owned by box JS/TS if any (matrix should not own them)
      if (["js", "ts", "tsx", "jsx", "vue"].includes(ext)) continue;
      expect(languageForPath(`/tmp/sample.${ext}`)).toBe(languageId);
    }
  });

  it("PATH matrix editor ids cover zig and dockerfile basenames", () => {
    expect(languageForPath("/repo/src/main.zig")).toBe("zig");
    expect(languageForPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(PATH_LANGUAGE_MATRIX.some((r) => r.id === "zig" && r.lsp)).toBe(
      true
    );
  });

  it("Dart prefers FVM when project markers exist", () => {
    const dart = PATH_LANGUAGE_MATRIX.find((row) => row.id === "dart");
    expect(dart?.lsp?.preferLaunchCommandsWhenMarkers).toEqual({
      commands: ["fvm"],
      markers: [...FVM_PROJECT_MARKERS],
    });
    expect(dart?.lsp?.workspaceRelativeCommands?.[0]?.command).toBe(
      ".fvm/flutter_sdk/bin/dart"
    );
  });

  it("Astro PATH row requests typescript.tsdk at launch", () => {
    const astro = pathLspDescriptorsFromMatrix().find((d) => d.id === "astro");
    expect(astro?.injectTypescriptSdk).toBe(true);
  });

  it("GraphQL rootMarkers include graphql-config json/js variants before package.json", () => {
    const graphql = PATH_LANGUAGE_MATRIX.find((row) => row.id === "graphql");
    const markers = graphql?.lsp?.rootMarkers ?? [];
    expect(markers).toContain(".graphqlrc.json");
    expect(markers).toContain(".graphqlrc.js");
    expect(markers).toContain(".graphqlrc.ts");
    expect(markers).toContain("graphql.config.json");
    expect(markers).toContain("graphql.config.js");
    expect(markers.indexOf("graphql.config.json")).toBeLessThan(
      markers.indexOf("package.json")
    );
  });
});
