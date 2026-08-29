import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBootstrappedLspRegistry } from "../../../../src/main/services/lsp/bootstrap-providers.ts";
import {
  createPluginLanguageServerProvider,
  pluginLanguageServerProviderId,
  registerPluginLanguageServers,
} from "../../../../src/main/services/lsp/plugin-language-servers.ts";
import { createVueLspProvider } from "../../../../src/main/services/lsp/providers/config-language-providers.ts";
import { createPathLspProvider } from "../../../../src/main/services/lsp/providers/create-path-provider.ts";
import { createTypescriptLspProvider } from "../../../../src/main/services/lsp/providers/typescript-provider.ts";
import { resolveWorkspaceRelativeBinary } from "../../../../src/main/services/lsp/resolve-command.ts";
import { LspServerRegistry } from "../../../../src/main/services/lsp/server-registry.ts";
import {
  asLspProviderDescriptor,
  PATH_LANGUAGE_MATRIX,
  pathLspDescriptorsFromMatrix,
} from "../../../../src/shared/language-matrix/index.ts";

function requireProvider(id: string) {
  const provider = createBootstrappedLspRegistry().getById(id);
  if (!provider) {
    throw new Error(`missing provider ${id}`);
  }
  return provider;
}

describe("Multi-language LSP providers", () => {
  it("bootstrap registers TypeScript, Vue, and every PATH matrix provider", () => {
    const registry = createBootstrappedLspRegistry();
    const ids = registry.list().map((p) => p.id);
    expect(ids).toContain("typescript");
    expect(ids).toContain("vue");
    for (const d of pathLspDescriptorsFromMatrix()) {
      expect(ids).toContain(d.id);
    }
    expect(ids.length).toBe(2 + pathLspDescriptorsFromMatrix().length);
  });

  it("matrix PATH rows each declare installCommand when not bundled", () => {
    for (const row of PATH_LANGUAGE_MATRIX) {
      if (!row.lsp) continue;
      expect(row.lsp.installCommand?.length ?? 0).toBeGreaterThan(0);
      expect(row.lsp.binaryHint.length).toBeGreaterThan(0);
    }
  });

  it("pyright matches .py/.pyi and resolves languageId", () => {
    const provider = requireProvider("pyright");
    expect(provider.matchPath("/a/b.py")).toBe(true);
    expect(provider.matchPath("/a/b.pyi")).toBe(true);
    expect(provider.matchPath("/a/b.ts")).toBe(false);
    expect(provider.languageIdForPath("a.py")).toBe("python");
    expect(provider.languageIdForPath("a.pyi")).toBe("python");
    expect(provider.languageIdForPath("a.ts")).toBeNull();
  });

  it("gopls matches .go and resolves languageId", () => {
    const provider = requireProvider("gopls");
    expect(provider.matchPath("/a/b.go")).toBe(true);
    expect(provider.matchPath("/a/b.py")).toBe(false);
    expect(provider.languageIdForPath("main.go")).toBe("go");
    expect(provider.languageIdForPath("main.py")).toBeNull();
  });

  it("rust-analyzer matches .rs and resolves languageId", () => {
    const provider = requireProvider("rust-analyzer");
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

  it("PATH matrix providers match representative extensions", () => {
    const registry = createBootstrappedLspRegistry();
    expect(registry.getById("clangd")?.matchPath("/a/b.mm")).toBe(true);
    expect(registry.getById("clangd")?.languageIdForPath("a.mm")).toBe(
      "objective-cpp"
    );
    expect(registry.getById("zls")?.matchPath("/a/b.zig")).toBe(true);
    expect(
      registry.getById("docker-langserver")?.matchPath("/repo/Dockerfile")
    ).toBe(true);
    expect(registry.getById("sourcekit-lsp")?.matchPath("/a/App.swift")).toBe(
      true
    );
    expect(registry.getById("json")?.matchPath("/a/b.jsonc")).toBe(true);
    expect(registry.getById("css")?.matchPath("/a/b.scss")).toBe(true);
    expect(registry.getById("css")?.matchPath("/a/b.less")).toBe(true);
    expect(registry.getById("css")?.languageIdForPath("a.less")).toBe("less");
    expect(registry.getById("css")?.matchPath("/a/b.sass")).toBe(false);
    expect(registry.getById("markdown")?.languageIdForPath("x.mdx")).toBe(
      "mdx"
    );
    expect(registry.getById("svelte")?.matchPath("/a/Widget.svelte")).toBe(
      true
    );
    expect(registry.getById("astro")?.matchPath("/a/pages/404.astro")).toBe(
      true
    );
    expect(registry.getById("graphql")?.matchPath("/a/schema.graphql")).toBe(
      true
    );
    expect(registry.getById("terraform-ls")?.matchPath("/a/main.tf")).toBe(
      true
    );
    expect(
      registry.getById("terraform-ls")?.languageIdForPath("a.tfvars")
    ).toBe("terraform-vars");
    expect(registry.getById("terraform-ls")?.matchPath("/a/nomad.hcl")).toBe(
      false
    );
  });

  it("vue special provider matches .vue", () => {
    expect(createVueLspProvider().matchPath("/a/App.vue")).toBe(true);
    expect(createVueLspProvider().languageIdForPath("App.vue")).toBe("vue");
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
    expect(registry.matchForPath("/repo/pages/404.astro")?.id).toBe("astro");
    expect(registry.matchForPath("/repo/schema.graphql")?.id).toBe("graphql");
    expect(registry.matchForPath("/repo/main.tf")?.id).toBe("terraform-ls");
    expect(registry.matchForPath("/repo/Makefile")).toBeNull();
  });

  it("providers resolve launch returns object or null without throwing", async () => {
    const pyright = requireProvider("pyright");
    const gopls = requireProvider("gopls");
    const rust = requireProvider("rust-analyzer");
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
    const provider = requireProvider("pyright");
    const root = provider.resolveRoot({
      fallbackWorkspaceRoot: "/repo",
      filePath: "/repo/src/main.py",
    });
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("plugin language servers use pluginId-prefixed provider ids", () => {
    const provider = createPluginLanguageServerProvider("sample.lang", {
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
      pluginLanguageServerProviderId("sample.lang", "jdtls")
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
      pluginId: "sample.lang",
      registry,
    });
    expect(registry.getById("sample.lang:clangd")).not.toBeNull();
    dispose();
    expect(registry.getById("sample.lang:clangd")).toBeNull();
  });

  it("createPathLspProvider lowercases languageIdByExtension keys", () => {
    const provider = createPathLspProvider({
      args: [],
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

  it("createPathLspProvider matches Dockerfile basenames", () => {
    const provider = createPathLspProvider({
      args: ["--stdio"],
      basenameMatchers: ["dockerfile", "dockerfile.*"],
      command: "docker-langserver",
      displayName: "Dockerfile",
      extensions: [".dockerfile"],
      id: "dockerfile",
      languageIds: ["dockerfile"],
      priority: 70,
      rootMarkers: [],
      source: "core",
    });
    expect(provider.matchPath("/app/Dockerfile")).toBe(true);
    expect(provider.matchPath("/app/Dockerfile.dev")).toBe(true);
    expect(provider.matchPath("/app/app.dockerfile")).toBe(true);
    expect(provider.languageIdForPath("/app/Dockerfile")).toBe("dockerfile");
    expect(provider.matchPath("/app/readme.md")).toBe(false);
  });

  it("createPathLspProvider injects typescript.tsdk when flagged", async () => {
    const provider = createPathLspProvider({
      args: ["--stdio"],
      command: process.execPath,
      displayName: "Astro",
      extensions: [".astro"],
      id: "astro-tsdk",
      injectTypescriptSdk: true,
      languageIds: ["astro"],
      priority: 90,
      rootMarkers: [],
      source: "core",
    });
    const launch = await provider.resolveLaunch({
      rootPath: process.cwd(),
      workspaceKey: "test",
    });
    expect(launch).not.toBeNull();
    expect(
      (launch?.initializationOptions as { typescript?: { tsdk?: string } })
        ?.typescript?.tsdk
    ).toMatch(/typescript[/\\]lib$/i);
  });

  it("createPathLspProvider tries launchCandidates with distinct args", () => {
    const provider = createPathLspProvider({
      args: [],
      command: "sourcekit-lsp",
      displayName: "Swift",
      extensions: [".swift"],
      id: "swift",
      languageIds: ["swift"],
      launchCandidates: [
        { args: [], command: "sourcekit-lsp-missing-xyz" },
        { args: ["sourcekit-lsp"], command: "xcrun" },
      ],
      priority: 70,
      rootMarkers: [],
      source: "core",
    });
    const launch = provider.resolveLaunch({
      rootPath: "/tmp",
      workspaceKey: "test",
    });
    if (launch && !(launch instanceof Promise)) {
      expect(launch.command.length).toBeGreaterThan(0);
      expect(Array.isArray(launch.args)).toBe(true);
    } else {
      expect(launch).toBeNull();
    }
  });

  it("shell-like languageIdByExtension maps extensions for LSP didOpen", () => {
    const provider = createPathLspProvider({
      args: ["start"],
      command: "bash-language-server",
      displayName: "Shell",
      extensions: [".sh", ".bash", ".zsh"],
      id: "shell",
      languageIdByExtension: {
        ".bash": "shellscript",
        ".sh": "shellscript",
        ".zsh": "shellscript",
      },
      languageIds: ["shellscript", "shell"],
      priority: 70,
      rootMarkers: [],
      source: "core",
    });
    expect(provider.languageIdForPath("/bin/setup.sh")).toBe("shellscript");
    expect(provider.languageIdForPath("/bin/rc.zsh")).toBe("shellscript");
  });

  it("rejects workspace-relative binaries that escape the root", () => {
    expect(
      resolveWorkspaceRelativeBinary("/tmp/project", "../outside/dart")
    ).toBeNull();
    expect(
      resolveWorkspaceRelativeBinary("/tmp/project", "/usr/bin/dart")
    ).toBeNull();
  });

  it("prefers project FVM dart over PATH for the dart matrix row", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-dart-fvm-"));
    try {
      const dartBin = join(rootPath, ".fvm", "flutter_sdk", "bin");
      await mkdir(dartBin, { recursive: true });
      const dartPath = join(dartBin, "dart");
      await writeFile(dartPath, "#!/bin/sh\n");
      const dart = pathLspDescriptorsFromMatrix().find(
        (entry) => entry.id === "dart"
      );
      expect(dart).toBeDefined();
      expect(dart?.workspaceRelativeCommands?.[0]?.command).toBe(
        ".fvm/flutter_sdk/bin/dart"
      );
      if (!dart) {
        return;
      }
      const provider = createPathLspProvider(asLspProviderDescriptor(dart));
      const launch = provider.resolveLaunch({
        rootPath,
        workspaceKey: "test",
      });
      const resolved = launch && !(launch instanceof Promise) ? launch : null;
      expect(resolved?.command).toBe(dartPath);
      expect(resolved?.args).toEqual(["language-server", "--protocol=lsp"]);
    } finally {
      await rm(rootPath, { force: true, recursive: true });
    }
  });

  it("prefers marker-listed PATH commands over earlier candidates", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "pier-fvm-marker-"));
    try {
      await writeFile(join(rootPath, ".fvmrc"), "{}\n");
      const provider = createPathLspProvider({
        args: [],
        command: "false",
        displayName: "Dart",
        extensions: [".dart"],
        id: "dart-fvm-order",
        languageIds: ["dart"],
        launchCandidates: [
          { args: ["--as-dart"], command: "false" },
          { args: ["--as-fvm"], command: "true" },
        ],
        preferLaunchCommandsWhenMarkers: {
          commands: ["true"],
          markers: [".fvmrc", ".fvm"],
        },
        priority: 70,
        rootMarkers: [],
        source: "core",
      });
      const withMarker = provider.resolveLaunch({
        rootPath,
        workspaceKey: "test",
      });
      const marked =
        withMarker && !(withMarker instanceof Promise) ? withMarker : null;
      expect(marked?.args).toEqual(["--as-fvm"]);

      const withoutMarker = provider.resolveLaunch({
        rootPath: join(rootPath, "empty"),
        workspaceKey: "test",
      });
      const unmarked =
        withoutMarker && !(withoutMarker instanceof Promise)
          ? withoutMarker
          : null;
      expect(unmarked?.args).toEqual(["--as-dart"]);
    } finally {
      await rm(rootPath, { force: true, recursive: true });
    }
  });
});
