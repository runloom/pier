import { existsSync } from "node:fs";
import { realpath as fsRealpath, lstat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type {
  AssetRootRef,
  McpCatalogEntry,
  McpCatalogSnapshot,
  McpServerListing,
  McpServerView,
} from "@shared/contracts/agent-assets.ts";
import { shell } from "electron";
import { isMissingPathError } from "../file-path-identity.ts";
import type { LocalEnvironmentService } from "../local-environments-service.ts";
import type { PierHomeService } from "../pier-home/service.ts";
import {
  consumersForPath,
  displayPathForCandidate,
  labelForAgent,
  MCP_PATH_CANDIDATES,
  type McpPathCandidate,
  pathCandidateById,
} from "./adapters.ts";
import {
  MCP_PARSE_MAX_BYTES,
  parseMcpServerNames,
} from "./parse-server-names.ts";

export class AgentMcpCatalogServiceError extends Error {
  readonly reason: "forbidden" | "not_found" | "unsupported";
  constructor(
    message: string,
    reason: AgentMcpCatalogServiceError["reason"] = "forbidden"
  ) {
    super(message);
    this.name = "AgentMcpCatalogServiceError";
    this.reason = reason;
  }
}

export interface AgentMcpCatalogService {
  catalog(root: AssetRootRef): Promise<McpCatalogSnapshot>;
  open(root: AssetRootRef, entryId: string): Promise<{ absolutePath: string }>;
  reveal(
    root: AssetRootRef,
    entryId: string
  ): Promise<{ absolutePath: string }>;
}

function assertInsideRoot(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new AgentMcpCatalogServiceError(
      "MCP path escaped whitelist root",
      "forbidden"
    );
  }
}

export function createAgentMcpCatalogService(options: {
  localEnvironments: LocalEnvironmentService;
  pierHome: PierHomeService;
  /** Parallel to skills: only installed agents count as “可用”. */
  listInstalledAgents?: () => Promise<readonly string[]>;
  openPath?: (path: string) => Promise<string>;
  realpath?: (path: string) => Promise<string>;
  revealItem?: (path: string) => void;
}): AgentMcpCatalogService {
  const realpathFn = options.realpath ?? fsRealpath;
  const revealItem =
    options.revealItem ?? ((path: string) => shell.showItemInFolder(path));
  const openPath = options.openPath ?? ((path: string) => shell.openPath(path));
  const listInstalledAgents =
    options.listInstalledAgents ?? (async () => [] as const);

  async function requireRealpath(p: string): Promise<string> {
    try {
      return await realpathFn(p);
    } catch (err) {
      if (isMissingPathError(err)) {
        throw new AgentMcpCatalogServiceError(
          `path not found: ${p}`,
          "not_found"
        );
      }
      throw err;
    }
  }

  async function resolveProjectRoot(
    root: AssetRootRef
  ): Promise<{ projectRootPath: string | null; scope: "project" | "home" }> {
    if (root.scope === "home") {
      return { projectRootPath: null, scope: "home" };
    }
    let normalized: string;
    try {
      normalized = await requireRealpath(root.projectRootPath);
    } catch (err) {
      if (err instanceof AgentMcpCatalogServiceError) throw err;
      throw err;
    }
    if (await options.pierHome.isHomeRoot(normalized)) {
      throw new AgentMcpCatalogServiceError(
        "Pier Home must use scope home, not project",
        "forbidden"
      );
    }
    const kind = await options.localEnvironments.getProjectKind(normalized);
    if (kind === "pier-home") {
      throw new AgentMcpCatalogServiceError(
        "Pier Home must use scope home, not project",
        "forbidden"
      );
    }
    if (kind !== "project") {
      throw new AgentMcpCatalogServiceError(
        "project scope requires a registered Pier project",
        "forbidden"
      );
    }
    return { projectRootPath: normalized, scope: "project" };
  }

  async function probePresence(
    absolutePath: string,
    opts: {
      projectRootPath: string | null;
      candidate: McpPathCandidate;
    }
  ): Promise<McpCatalogEntry["presence"]> {
    try {
      const stat = await lstat(absolutePath);
      if (!(stat.isFile() || stat.isDirectory() || stat.isSymbolicLink())) {
        return "missing";
      }
      let resolved: string;
      try {
        resolved = await requireRealpath(absolutePath);
      } catch {
        return "missing";
      }
      try {
        if (opts.candidate.scopeLabel === "project") {
          if (!(opts.projectRootPath && opts.candidate.projectRelativePath)) {
            return "missing";
          }
          const rootReal = await requireRealpath(opts.projectRootPath);
          assertInsideRoot(rootReal, resolved);
          if (
            basename(resolved) !== basename(opts.candidate.projectRelativePath)
          ) {
            return "missing";
          }
        } else if (opts.candidate.userAbsolutePath) {
          const expectedLexical = opts.candidate.userAbsolutePath();
          const parentReal = await requireRealpath(dirname(expectedLexical));
          assertInsideRoot(parentReal, resolved);
          if (basename(resolved) !== basename(expectedLexical)) {
            return "missing";
          }
        } else {
          return "unsupported";
        }
      } catch {
        return "missing";
      }
      return "present";
    } catch {
      return "missing";
    }
  }

  async function buildEntries(
    projectRootPath: string | null,
    scope: "project" | "home"
  ): Promise<McpCatalogEntry[]> {
    const entries: McpCatalogEntry[] = [];
    for (const candidate of MCP_PATH_CANDIDATES) {
      if (scope === "home" && candidate.scopeLabel === "project") {
        continue;
      }
      let absolutePath: string | null = null;
      let presence: McpCatalogEntry["presence"] = "missing";
      const primaryAgentId = candidate.consumerAgentIds[0] ?? "unknown";

      if (candidate.scopeLabel === "project") {
        if (!(projectRootPath && candidate.projectRelativePath)) {
          continue;
        }
        absolutePath = join(
          projectRootPath,
          ...candidate.projectRelativePath.split("/")
        );
      } else if (candidate.userAbsolutePath) {
        absolutePath = candidate.userAbsolutePath();
      } else {
        presence = "unsupported";
      }

      if (absolutePath && presence !== "unsupported") {
        presence = await probePresence(absolutePath, {
          candidate,
          projectRootPath,
        });
      }

      entries.push({
        absolutePath,
        agentId: primaryAgentId,
        agentLabel: labelForAgent(primaryAgentId),
        displayPath: displayPathForCandidate(candidate, projectRootPath),
        id: candidate.id,
        ...(candidate.officialDocsUrl
          ? { officialDocsUrl: candidate.officialDocsUrl }
          : {}),
        presence,
        scopeLabel: candidate.scopeLabel,
      });
    }
    return entries;
  }

  async function readServerNames(
    entry: McpCatalogEntry,
    projectRootPath: string | null
  ): Promise<string[]> {
    if (entry.presence !== "present" || !entry.absolutePath) {
      return [];
    }
    let raw: string;
    try {
      const buf = await readFile(entry.absolutePath);
      if (buf.byteLength > MCP_PARSE_MAX_BYTES) {
        return [];
      }
      raw = buf.toString("utf8");
    } catch {
      return [];
    }
    const path = pathCandidateById(entry.id);
    if (!path) {
      return [];
    }
    return parseMcpServerNames(raw, path.format, projectRootPath);
  }

  async function buildServers(
    entries: McpCatalogEntry[],
    projectRootPath: string | null
  ): Promise<McpServerView[]> {
    const installed = new Set(await listInstalledAgents());
    const byName = new Map<string, McpServerListing[]>();
    for (const entry of entries) {
      const names = await readServerNames(entry, projectRootPath);
      if (names.length === 0) continue;
      if (!entry.absolutePath) continue;
      const consumers = consumersForPath(entry.id);
      const agentIds =
        consumers.length > 0 ? consumers : ([entry.agentId] as const);
      for (const agentId of agentIds) {
        const listing: McpServerListing = {
          absolutePath: entry.absolutePath,
          agentId,
          agentLabel: labelForAgent(agentId),
          displayPath: entry.displayPath,
          entryId: entry.id,
          scopeLabel: entry.scopeLabel,
        };
        for (const name of names) {
          const list = byName.get(name) ?? [];
          list.push(listing);
          byName.set(name, list);
        }
      }
    }
    return [...byName.entries()]
      .map(([name, listings]) => {
        const deduped = dedupeListings(listings);
        return {
          effects: deriveEffects(deduped, installed),
          listings: deduped,
          name,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function deriveEffects(
    listings: McpServerListing[],
    installed: ReadonlySet<string>
  ): McpServerView["effects"] {
    const byAgent = new Map<string, McpServerListing>();
    for (const listing of listings) {
      const prev = byAgent.get(listing.agentId);
      if (!prev) {
        byAgent.set(listing.agentId, listing);
        continue;
      }
      // Prefer project-scoped viaRoot when the same agent declares twice.
      if (prev.scopeLabel === "user" && listing.scopeLabel === "project") {
        byAgent.set(listing.agentId, listing);
      }
    }
    return [...byAgent.values()]
      .map((listing) =>
        installed.has(listing.agentId)
          ? {
              agentKind: listing.agentId,
              effect: {
                state: "discoverable" as const,
                viaRoot: listing.displayPath,
              },
            }
          : {
              agentKind: listing.agentId,
              effect: { state: "agent-not-installed" as const },
            }
      )
      .sort((a, b) => a.agentKind.localeCompare(b.agentKind));
  }

  function dedupeListings(listings: McpServerListing[]): McpServerListing[] {
    const seen = new Set<string>();
    const out: McpServerListing[] = [];
    for (const listing of listings) {
      const key = `${listing.entryId}\0${listing.agentId}\0${listing.scopeLabel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(listing);
    }
    return out.sort((a, b) => {
      const agent = a.agentLabel.localeCompare(b.agentLabel);
      if (agent !== 0) return agent;
      return a.displayPath.localeCompare(b.displayPath);
    });
  }

  function candidateFor(entryId: string): McpPathCandidate | undefined {
    return pathCandidateById(entryId);
  }

  async function assertWhitelisted(
    entry: McpCatalogEntry,
    candidate: McpPathCandidate,
    projectRootPath: string | null,
    resolved: string
  ): Promise<void> {
    if (entry.scopeLabel === "project") {
      if (!(projectRootPath && candidate.projectRelativePath)) {
        throw new AgentMcpCatalogServiceError(
          "MCP project path missing root",
          "forbidden"
        );
      }
      const rootReal = await requireRealpath(projectRootPath);
      assertInsideRoot(rootReal, resolved);
      if (basename(resolved) !== basename(candidate.projectRelativePath)) {
        throw new AgentMcpCatalogServiceError(
          "MCP path basename mismatch",
          "forbidden"
        );
      }
      return;
    }

    if (!(candidate.userAbsolutePath && entry.absolutePath)) {
      throw new AgentMcpCatalogServiceError(
        "MCP user path unsupported",
        "unsupported"
      );
    }
    const expectedLexical = candidate.userAbsolutePath();
    const parentReal = await requireRealpath(dirname(expectedLexical));
    assertInsideRoot(parentReal, resolved);
    if (basename(resolved) !== basename(expectedLexical)) {
      throw new AgentMcpCatalogServiceError(
        "MCP path basename mismatch",
        "forbidden"
      );
    }
  }

  async function resolveEntryPath(
    root: AssetRootRef,
    entryId: string
  ): Promise<string> {
    const { projectRootPath, scope } = await resolveProjectRoot(root);
    const entries = await buildEntries(projectRootPath, scope);
    const entry = entries.find((e) => e.id === entryId);
    const candidate = candidateFor(entryId);
    if (!(entry && candidate)) {
      throw new AgentMcpCatalogServiceError(
        `unknown MCP catalog entry: ${entryId}`,
        "not_found"
      );
    }
    if (entry.presence !== "present" || !entry.absolutePath) {
      throw new AgentMcpCatalogServiceError(
        entry.presence === "unsupported"
          ? "MCP path is unsupported or missing"
          : "MCP path does not exist",
        entry.presence === "unsupported" ? "unsupported" : "not_found"
      );
    }
    if (!existsSync(entry.absolutePath)) {
      throw new AgentMcpCatalogServiceError(
        "MCP path does not exist",
        "not_found"
      );
    }
    const resolved = await requireRealpath(entry.absolutePath);
    await assertWhitelisted(entry, candidate, projectRootPath, resolved);
    return resolved;
  }

  return {
    async catalog(root) {
      const { projectRootPath, scope } = await resolveProjectRoot(root);
      const entries = await buildEntries(projectRootPath, scope);
      return {
        entries,
        scope,
        servers: await buildServers(entries, projectRootPath),
      };
    },

    async reveal(root, entryId) {
      const absolutePath = await resolveEntryPath(root, entryId);
      revealItem(absolutePath);
      return { absolutePath };
    },

    async open(root, entryId) {
      const absolutePath = await resolveEntryPath(root, entryId);
      const err = await openPath(absolutePath);
      if (err) {
        throw new AgentMcpCatalogServiceError(err, "forbidden");
      }
      return { absolutePath };
    },
  };
}
