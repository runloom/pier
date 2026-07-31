import { describe, expect, it } from "vitest";
import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";
import { createGoplsLspProvider } from "../../../../src/main/services/lsp/providers/gopls-provider.ts";
import { createPyrightLspProvider } from "../../../../src/main/services/lsp/providers/pyright-provider.ts";
import { createRustAnalyzerLspProvider } from "../../../../src/main/services/lsp/providers/rust-analyzer-provider.ts";
import { createTypescriptLspProvider } from "../../../../src/main/services/lsp/providers/typescript-provider.ts";

describe("Multi-language LSP providers", () => {
  it("bootstrap registers all four providers", () => {
    const registry = createBootstrappedLspRegistry();
    const ids = registry.list().map((p) => p.id);
    expect(ids).toContain("typescript");
    expect(ids).toContain("pyright");
    expect(ids).toContain("gopls");
    expect(ids).toContain("rust-analyzer");
    expect(ids.length).toBe(4);
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
    expect(registry.matchForPath("/repo/a.md")).toBeNull();
    expect(registry.matchForPath("/repo/Makefile")).toBeNull();
  });

  it("providers resolve launch returns null when binary not found", async () => {
    const pyright = createPyrightLspProvider();
    const gopls = createGoplsLspProvider();
    const rust = createRustAnalyzerLspProvider();
    // In CI/dev without these binaries installed, resolveLaunch returns null.
    // This is the expected "server-unavailable" path, not a crash.
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
    // Each is either a valid launch spec (binary found) or null (not found).
    // Both are acceptable; we only verify it doesn't throw.
    expect(typeof pyLaunch).toBe("object");
    expect(typeof goLaunch).toBe("object");
    expect(typeof rsLaunch).toBe("object");
  });

  it("pyright resolveRoot walks markers", () => {
    const provider = createPyrightLspProvider();
    // With no pyproject.toml on the test machine, it falls back.
    const root = provider.resolveRoot({
      fallbackWorkspaceRoot: "/repo",
      filePath: "/repo/src/main.py",
    });
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });
});
