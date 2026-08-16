import {
  type LspCatalogEntry,
  type LspServerLaunchSpec,
  type LspServerProvider,
  parseLspCatalogStatusRows,
} from "@shared/contracts/lsp-provider.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogRowsFromRegistry,
  enrichCatalogVersions,
  pathProbeCandidates,
  probeCoreLspCatalog,
} from "../../../../src/main/services/lsp/probe-catalog.ts";
import { probeResolvedBinaryVersion } from "../../../../src/main/services/lsp/probe-version.ts";
import { LspServerRegistry } from "../../../../src/main/services/lsp/server-registry.ts";

vi.mock(
  "../../../../src/main/services/lsp/resolve-command.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/main/services/lsp/resolve-command.ts")
      >();
    return {
      ...actual,
      resolveFirstCommandOnPath: (candidates: readonly string[]) => {
        if (candidates.includes("gopls")) {
          return "/opt/homebrew/bin/gopls";
        }
        if (candidates.includes("xcrun")) {
          return "/usr/bin/xcrun";
        }
        return null;
      },
    };
  }
);

vi.mock(
  "../../../../src/main/services/lsp/probe-version.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/main/services/lsp/probe-version.ts")
      >();
    return {
      ...actual,
      probeResolvedBinaryVersion: vi.fn(async (resolvedPath: string) =>
        resolvedPath.endsWith("gopls")
          ? "golang.org/x/tools/gopls v0.16.1"
          : "SHOULD_NOT_PROBE"
      ),
    };
  }
);

const BUNDLED: LspCatalogEntry = {
  binaryHint: "bundled",
  displayName: "TypeScript / JavaScript",
  extensions: [".ts"],
  id: "typescript",
  source: "core",
};

const GOPLS: LspCatalogEntry = {
  binaryHint: "gopls",
  displayName: "Go",
  extensions: [".go"],
  id: "gopls",
  source: "core",
};

const PYRIGHT: LspCatalogEntry = {
  binaryHint: "pyright-langserver",
  displayName: "Python",
  extensions: [".py"],
  id: "python",
  installCommand: "npm i -g pyright",
  source: "core",
};

const SWIFT: LspCatalogEntry = {
  binaryHint: "sourcekit-lsp|xcrun",
  displayName: "Swift",
  extensions: [".swift"],
  id: "sourcekit-lsp",
  source: "core",
};

function pluginProvider(
  overrides: Partial<LspServerProvider> &
    Pick<LspServerProvider, "id" | "resolveLaunch">
): LspServerProvider {
  return {
    displayName: overrides.displayName ?? overrides.id,
    languageIdForPath: () => "go",
    matchPath: () => true,
    priority: 10,
    resolveRoot: () => "/",
    rootMarkers: [],
    selector: { extensions: [".go"], languageIds: ["go"] },
    source: "plugin",
    ...overrides,
  };
}

describe("pathProbeCandidates", () => {
  it("drops aliases that are not the language server", () => {
    expect(pathProbeCandidates("sourcekit-lsp|xcrun")).toEqual([
      "sourcekit-lsp",
    ]);
    expect(pathProbeCandidates("elixir-ls|language_server.sh")).toEqual([
      "elixir-ls",
    ]);
    expect(
      pathProbeCandidates("@vue/typescript-plugin|vue-language-server")
    ).toEqual(["vue-language-server"]);
  });
});

describe("probeCoreLspCatalog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps bundled rows off PATH and records resolved PATH hits", () => {
    const rows = probeCoreLspCatalog([BUNDLED, GOPLS, PYRIGHT]);
    expect(rows).toEqual([
      { ...BUNDLED, status: "bundled" },
      {
        ...GOPLS,
        resolvedPath: "/opt/homebrew/bin/gopls",
        status: "available",
      },
      { ...PYRIGHT, status: "missing" },
    ]);
  });

  it("does not treat xcrun as Swift being on PATH", () => {
    const [row] = probeCoreLspCatalog([SWIFT]);
    expect(row?.status).toBe("missing");
    expect(row?.resolvedPath).toBeUndefined();
  });
});

describe("catalogRowsFromRegistry", () => {
  it("awaits async resolveLaunch and stores the binary path, not cmd.exe", async () => {
    const registry = new LspServerRegistry();
    registry.register(
      pluginProvider({
        id: "plugin-gopls",
        resolveLaunch: async (): Promise<LspServerLaunchSpec> => ({
          args: ["/d", "/s", "/c", `"C:\\tools\\gopls.cmd" --stdio`],
          command: "C:\\Windows\\System32\\cmd.exe",
          cwd: "/",
        }),
      })
    );
    const rows = await catalogRowsFromRegistry(registry);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "plugin-gopls",
        resolvedPath: "C:\\tools\\gopls.cmd",
        status: "available",
      }),
    ]);
  });

  it("skips core providers already in the static catalog", async () => {
    const registry = new LspServerRegistry();
    registry.register(
      pluginProvider({
        id: "typescript",
        resolveLaunch: () => ({
          args: [],
          command: "/opt/tsserver",
          cwd: "/",
        }),
        source: "core",
      })
    );
    await expect(catalogRowsFromRegistry(registry)).resolves.toEqual([]);
  });
});

describe("enrichCatalogVersions", () => {
  it("adds version only for allowlisted PATH hits", async () => {
    const probed = probeCoreLspCatalog([BUNDLED, GOPLS, PYRIGHT]);
    const rows = await enrichCatalogVersions([
      ...probed,
      {
        binaryHint: "jdtls",
        displayName: "Java",
        extensions: [".java"],
        id: "jdtls",
        resolvedPath: "/opt/homebrew/bin/jdtls",
        source: "core",
        status: "available",
      },
    ]);
    expect(rows.find((row) => row.id === "gopls")?.version).toBe(
      "golang.org/x/tools/gopls v0.16.1"
    );
    expect(
      rows.find((row) => row.id === "typescript")?.version
    ).toBeUndefined();
    expect(rows.find((row) => row.id === "python")?.version).toBeUndefined();
    expect(rows.find((row) => row.id === "jdtls")?.version).toBeUndefined();
    expect(vi.mocked(probeResolvedBinaryVersion).mock.calls).toEqual([
      ["/opt/homebrew/bin/gopls"],
    ]);
  });
});

describe("parseLspCatalogStatusRows", () => {
  it("accepts valid rows and rejects overlong versions", () => {
    expect(parseLspCatalogStatusRows(null)).toBeNull();
    expect(parseLspCatalogStatusRows([])).toEqual([]);
    expect(
      parseLspCatalogStatusRows([
        {
          ...GOPLS,
          resolvedPath: "/opt/homebrew/bin/gopls",
          status: "available",
          version: "x".repeat(65),
        },
      ])
    ).toBeNull();
    expect(
      parseLspCatalogStatusRows([
        {
          ...GOPLS,
          resolvedPath: "/opt/homebrew/bin/gopls",
          status: "available",
          version: "gopls v0.16.1",
        },
      ])
    ).toEqual([
      {
        ...GOPLS,
        resolvedPath: "/opt/homebrew/bin/gopls",
        status: "available",
        version: "gopls v0.16.1",
      },
    ]);
  });
});
