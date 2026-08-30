import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentMcpCatalogServiceError,
  createAgentMcpCatalogService,
} from "@main/services/agent-mcp-catalog/service.ts";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createAgentMcpCatalogService", () => {
  let tempDir: string;
  let projectRoot: string;
  let userDataPath: string;
  let registeredRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-mcp-"));
    userDataPath = join(tempDir, "userData");
    projectRoot = join(tempDir, "project");
    await mkdir(userDataPath, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    registeredRoot = await realpath(projectRoot);
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  function makeService(hooks?: {
    listInstalledAgents?: () => Promise<readonly string[]>;
    openPath?: (path: string) => Promise<string>;
    revealItem?: (path: string) => void;
  }) {
    const pierHome = createPierHomeService({ userDataPath });
    return {
      pierHome,
      mcp: createAgentMcpCatalogService({
        pierHome,
        localEnvironments: {
          getProjectKind: async (path: string) =>
            path === registeredRoot ? ("project" as const) : null,
        } as Parameters<
          typeof createAgentMcpCatalogService
        >[0]["localEnvironments"],
        listInstalledAgents:
          hooks?.listInstalledAgents ??
          (async () =>
            ["cursor", "claude", "codex", "omp", "opencode"] as const),
        openPath: hooks?.openPath ?? (async () => ""),
        revealItem: hooks?.revealItem ?? (() => undefined),
      }),
    };
  }

  function entryIdForDisplayPath(
    entries: { id: string; displayPath: string }[],
    displayPath: string
  ): string {
    const entry = entries.find((e) => e.displayPath === displayPath);
    if (!entry) {
      throw new Error(`missing entry for ${displayPath}`);
    }
    return entry.id;
  }

  it("lists project + user rows for project scope", async () => {
    await mkdir(join(projectRoot, ".cursor"), { recursive: true });
    await writeFile(
      join(projectRoot, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: { filesystem: { command: "npx" } },
      }),
      "utf8"
    );
    const { mcp } = makeService();
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    expect(snap.scope).toBe("project");
    expect(snap.entries.some((e) => e.scopeLabel === "user")).toBe(true);
    expect(
      snap.entries.find((e) => e.displayPath === ".cursor/mcp.json")?.presence
    ).toBe("present");
    expect(snap.servers.some((s) => s.name === "filesystem")).toBe(true);
    expect(
      snap.servers
        .find((s) => s.name === "filesystem")
        ?.listings.map((l) => l.agentId)
        .sort()
    ).toEqual(["cursor", "omp"]);
    expect(snap.servers.find((s) => s.name === "filesystem")?.effects).toEqual([
      {
        agentKind: "cursor",
        effect: { state: "discoverable", viaRoot: ".cursor/mcp.json" },
      },
      {
        agentKind: "omp",
        effect: { state: "discoverable", viaRoot: ".cursor/mcp.json" },
      },
    ]);
  });

  it("attributes .mcp.json from Claude + OMP adapter configs", async () => {
    await writeFile(
      join(projectRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: { shadcn: { command: "npx" } },
      }),
      "utf8"
    );
    const { mcp } = makeService();
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    const server = snap.servers.find((s) => s.name === "shadcn");
    expect(server?.listings.map((l) => l.agentId).sort()).toEqual([
      "claude",
      "codebuddy",
      "copilot",
      "omp",
      "openclaude",
      "qodercli",
    ]);
    expect(
      server?.effects
        .filter((e) => e.effect.state === "discoverable")
        .map((e) => e.agentKind)
        .sort()
    ).toEqual(["claude", "omp"]);
    expect(server?.effects.some((e) => e.agentKind === "opencode")).toBe(false);
  });

  it("marks declaring agents as not installed when detection misses them", async () => {
    await mkdir(join(projectRoot, ".cursor"), { recursive: true });
    await writeFile(
      join(projectRoot, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: { filesystem: { command: "npx" } },
      }),
      "utf8"
    );
    const { mcp } = makeService({
      listInstalledAgents: async () => [],
    });
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    expect(
      snap.servers
        .find((s) => s.name === "filesystem")
        ?.effects.map((e) => e.agentKind)
        .sort()
    ).toEqual(["cursor", "omp"]);
    expect(
      snap.servers
        .find((s) => s.name === "filesystem")
        ?.effects.every((e) => e.effect.state === "agent-not-installed")
    ).toBe(true);
  });

  it("lists only user rows for home scope", async () => {
    const { mcp } = makeService();
    const snap = await mcp.catalog({ scope: "home" });
    expect(snap.scope).toBe("home");
    expect(snap.entries.every((e) => e.scopeLabel === "user")).toBe(true);
    expect(snap.entries.some((e) => e.scopeLabel === "project")).toBe(false);
    expect(Array.isArray(snap.servers)).toBe(true);
  });

  it("rejects pier-home and unregistered as project scope", async () => {
    const { pierHome, mcp } = makeService();
    const home = await pierHome.ensure();
    await expect(
      mcp.catalog({ scope: "project", projectRootPath: home.rootPath })
    ).rejects.toMatchObject({
      reason: "forbidden",
    } satisfies Partial<AgentMcpCatalogServiceError>);

    const stranger = join(tempDir, "stranger");
    await mkdir(stranger, { recursive: true });
    await expect(
      mcp.catalog({
        scope: "project",
        projectRootPath: await realpath(stranger),
      })
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("reveals and opens present project paths", async () => {
    await mkdir(join(projectRoot, ".cursor"), { recursive: true });
    const path = join(projectRoot, ".cursor", "mcp.json");
    await writeFile(path, "{}", "utf8");
    const revealed: string[] = [];
    const opened: string[] = [];
    const { mcp } = makeService({
      revealItem: (p) => {
        revealed.push(p);
      },
      openPath: async (p) => {
        opened.push(p);
        return "";
      },
    });
    const root = { scope: "project" as const, projectRootPath: registeredRoot };
    const snap = await mcp.catalog(root);
    const entryId = entryIdForDisplayPath(snap.entries, ".cursor/mcp.json");
    await mcp.reveal(root, entryId);
    await mcp.open(root, entryId);
    expect(revealed[0]).toContain("mcp.json");
    expect(opened[0]).toContain("mcp.json");
  });

  it("rejects open on missing entries", async () => {
    const { mcp } = makeService();
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    const entryId = entryIdForDisplayPath(snap.entries, ".cursor/mcp.json");
    await expect(
      mcp.open({ scope: "project", projectRootPath: registeredRoot }, entryId)
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("rejects project MCP symlink that escapes project root", async () => {
    const outside = join(tempDir, "evil.json");
    await writeFile(outside, "{}", "utf8");
    await mkdir(join(projectRoot, ".cursor"), { recursive: true });
    await symlink(outside, join(projectRoot, ".cursor", "mcp.json"));
    const { mcp } = makeService();
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    expect(
      snap.entries.find((e) => e.displayPath === ".cursor/mcp.json")?.presence
    ).toBe("missing");
    const entryId = entryIdForDisplayPath(snap.entries, ".cursor/mcp.json");
    await expect(
      mcp.open({ scope: "project", projectRootPath: registeredRoot }, entryId)
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("treats intermediate directory symlink as missing for catalog", async () => {
    const outsideDir = join(tempDir, "outside-cursor");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "mcp.json"), "{}", "utf8");
    await symlink(outsideDir, join(projectRoot, ".cursor"));
    const { mcp } = makeService();
    const snap = await mcp.catalog({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    expect(
      snap.entries.find((e) => e.displayPath === ".cursor/mcp.json")?.presence
    ).toBe("missing");
    const entryId = entryIdForDisplayPath(snap.entries, ".cursor/mcp.json");
    await expect(
      mcp.open({ scope: "project", projectRootPath: registeredRoot }, entryId)
    ).rejects.toMatchObject({ reason: "not_found" });
  });
});
