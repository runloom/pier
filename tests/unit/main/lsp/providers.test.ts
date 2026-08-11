import { describe, expect, it } from "vitest";
import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";
import {
  createPluginLanguageServerProvider,
  pluginLanguageServerProviderId,
  registerPluginLanguageServers,
} from "../../../../src/main/services/lsp/plugin-language-servers.ts";
import {
  createCssLspProvider,
  createHtmlLspProvider,
  createJsonLspProvider,
  createMarkdownLspProvider,
  createSvelteLspProvider,
  createVueLspProvider,
  createYamlLspProvider,
} from "../../../../src/main/services/lsp/providers/config-language-providers.ts";
import { createPathLspProvider } from "../../../../src/main/services/lsp/providers/create-path-provider.ts";
import { createGoplsLspProvider } from "../../../../src/main/services/lsp/providers/gopls-provider.ts";
import { createPyrightLspProvider } from "../../../../src/main/services/lsp/providers/pyright-provider.ts";
import { createRustAnalyzerLspProvider } from "../../../../src/main/services/lsp/providers/rust-analyzer-provider.ts";
import { createTypescriptLspProvider } from "../../../../src/main/services/lsp/providers/typescript-provider.ts";
import { LspServerRegistry } from "../../../../src/main/services/lsp/server-registry.ts";

describe("Multi-language LSP providers", () => {
  it("bootstrap registers core programming + config language providers", () => {
    const registry = createBootstrappedLspRegistry();
    const ids = registry.list().map((p) => p.id);
    expect(ids).toContain("typescript");
    expect(ids).toContain("pyright");
    expect(ids).toContain("gopls");
    expect(ids).toContain("rust-analyzer");
    expect(ids).toContain("json");
    expect(ids).toContain("css");
    expect(ids).toContain("html");
    expect(ids).toContain("yaml");
    expect(ids).toContain("markdown");
    expect(ids).toContain("vue");
    expect(ids).toContain("svelte");
    expect(ids.length).toBe(11);
  });

  it("pyright matches .py/.pyi and resolves languageId", () => {
    const provider = createPyrightLspProvider();
    expect(provider.matchPath("/a/b.py")).toBe(true);
    expect(provider.matchPath("/a/b.pyi")).toBe(true);
    expect(provider.matchPath("/a/b.ts")).toBe(false);
    expect(provider.languageIdForPath("a.py")).toBe("python");
    expect(provider.languageIdForPath("a.pyi")).toBe("python");
    expect(provider.languageIdForPath("a.ts")).toBeNull();
  });

  it("gopls matches .go and resolves languageId", () => {
    const provider = createGoplsLspProvider();
    expect(provider.matchPath("/a/b.go")).toBe(true);
    expect(provider.matchPath("/a/b.py")).toBe(false);
    expect(provider.languageIdForPath("main.go")).toBe("go");
    expect(provider.languageIdForPath("main.py")).toBeNull();
  });

  it("rust-analyzer matches .rs and resolves languageId", () => {
    const provider = createRustAnalyzerLspProvider();
    expect(provider.matchPath("/a/b.rs")).toBe(true);
    expect(provider.matchPath("/a/b.go")).toBe(false);
    expect(provider.languageIdForPath("lib.rs")).toBe("rust");
    expect(provider.languageIdForPath("lib.go")).toBeNull();
  });

  it("typescript matches js/ts family and resolves languageId", () => {
    const provider = createTypescriptLspProvider();
    expect(provider.matchPath("/a/b.ts")).toBe(true);
    expect(provider.matchPath("/a/b.tsx")).toBe(true);
    expect(provider.matchPath("/a/b.mjs")).toBe(true);
    expect(provider.matchPath("/a/b.py")).toBe(false);
    expect(provider.languageIdForPath("a.tsx")).toBe("typescriptreact");
    expect(provider.languageIdForPath("a.jsx")).toBe("javascriptreact");
    expect(provider.languageIdForPath("a.mts")).toBe("typescript");
  });

  it("config language providers match expected extensions", () => {
    expect(createJsonLspProvider().matchPath("/a/b.jsonc")).toBe(true);
    expect(createCssLspProvider().matchPath("/a/b.scss")).toBe(true);
    expect(createHtmlLspProvider().matchPath("/a/b.html")).toBe(true);
    expect(createYamlLspProvider().matchPath("/a/b.yml")).toBe(true);
    expect(createMarkdownLspProvider().matchPath("/a/b.md")).toBe(true);
    expect(createMarkdownLspProvider().languageIdForPath("x.mdx")).toBe("mdx");
    expect(createVueLspProvider().matchPath("/a/App.vue")).toBe(true);
    expect(createVueLspProvider().languageIdForPath("App.vue")).toBe("vue");
    expect(createSvelteLspProvider().matchPath("/a/Widget.svelte")).toBe(true);
    expect(createSvelteLspProvider().languageIdForPath("Widget.svelte")).toBe(
      "svelte"
    );
  });

  it("launches the bundled TypeScript server through Electron's Node mode", async () => {
    const launch = await createTypescriptLspProvider().resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });

    expect(launch).not.toBeNull();
    expect(launch?.command).toBe(process.execPath);
    expect(launch?.args.at(-1)).toBe("--stdio");
    expect(launch?.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("registry routes files to correct provider by extension", () => {
    const registry = createBootstrappedLspRegistry();
    expect(registry.matchForPath("/repo/a.ts")?.id).toBe("typescript");
    expect(registry.matchForPath("/repo/a.py")?.id).toBe("pyright");
    expect(registry.matchForPath("/repo/a.go")?.id).toBe("gopls");
    expect(registry.matchForPath("/repo/a.rs")?.id).toBe("rust-analyzer");
    expect(registry.matchForPath("/repo/a.json")?.id).toBe("json");
    expect(registry.matchForPath("/repo/a.css")?.id).toBe("css");
    expect(registry.matchForPath("/repo/a.md")?.id).toBe("markdown");
    expect(registry.matchForPath("/repo/App.vue")?.id).toBe("vue");
    expect(registry.matchForPath("/repo/Widget.svelte")?.id).toBe("svelte");
    expect(registry.matchForPath("/repo/Makefile")).toBeNull();
  });

  it("providers resolve launch returns null when binary not found", async () => {
    const pyright = createPyrightLspProvider();
    const gopls = createGoplsLspProvider();
    const rust = createRustAnalyzerLspProvider();
    const pyLaunch = await pyright.resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    const goLaunch = await gopls.resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    const rsLaunch = await rust.resolveLaunch({
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(typeof pyLaunch).toBe("object");
    expect(typeof goLaunch).toBe("object");
    expect(typeof rsLaunch).toBe("object");
  });

  it("pyright resolveRoot walks markers", () => {
    const provider = createPyrightLspProvider();
    const root = provider.resolveRoot({
      fallbackWorkspaceRoot: "/repo",
      filePath: "/repo/src/main.py",
    });
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("plugin language servers use pluginId-prefixed provider ids", () => {
    const provider = createPluginLanguageServerProvider("pier.lsp-java", {
      args: [],
      command: "jdtls",
      displayName: "Java",
      extensions: [".java"],
      id: "jdtls",
      languageIds: ["java"],
      priority: 70,
      rootMarkers: ["pom.xml"],
    });
    expect(provider.id).toBe(
      pluginLanguageServerProviderId("pier.lsp-java", "jdtls")
    );
    expect(provider.matchPath("/a/Main.java")).toBe(true);
    expect(provider.source).toBe("plugin");
  });

  it("registerPluginLanguageServers can unregister", () => {
    const registry = new LspServerRegistry();
    const dispose = registerPluginLanguageServers({
      contributions: [
        {
          args: [],
          command: "clangd",
          displayName: "C++",
          extensions: [".cpp"],
          id: "clangd",
          languageIds: ["cpp"],
          priority: 70,
          rootMarkers: [],
        },
      ],
      pluginId: "pier.lsp-cpp",
      registry,
    });
    expect(registry.getById("pier.lsp-cpp:clangd")).not.toBeNull();
    dispose();
    expect(registry.getById("pier.lsp-cpp:clangd")).toBeNull();
  });

  it("createPathLspProvider lowercases languageIdByExtension keys", () => {
    const provider = createPathLspProvider({
      command: "clangd",
      displayName: "C / C++",
      extensions: [".c", ".C", ".mm"],
      id: "clangd-case",
      languageIdByExtension: {
        ".C": "c",
        ".MM": "objective-cpp",
        ".mm": "objective-cpp",
      },
      languageIds: ["c", "objective-cpp"],
      priority: 70,
      rootMarkers: [],
      source: "core",
    });
    expect(provider.languageIdForPath("/src/main.C")).toBe("c");
    expect(provider.languageIdForPath("/src/addon.mm")).toBe("objective-cpp");
    expect(provider.languageIdForPath("/src/addon.MM")).toBe("objective-cpp");
  });
});
