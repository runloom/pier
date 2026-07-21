import type { Stats } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "../../../shared/contracts/agent.ts";
import type { SkillDiscoveryAdapterRegistry } from "./adapters.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listProjectDiscoveryRoots,
  listUserSkillRoots,
} from "./adapters.ts";
import { peekSkillMetadata } from "./frontmatter.ts";
import type { OwnershipRecord } from "./store.ts";

/**
 * Filesystem enumeration for the effective matrix and the unified list's
 * unmanaged / user-global rows (design v8 §5.1 / §6.1 / §7.6). Strictly
 * read-only; bounded.
 */

/**
 * Project discovery roots scanned for unmanaged entries (layer 5).
 * Registry-derived — the adapter registry is the single fact source.
 */
export const UNMANAGED_DISCOVERY_ROOTS: readonly string[] =
  listProjectDiscoveryRoots(createSkillDiscoveryAdapterRegistry());

/** Per-root child cap for read-only enumerations (design v8 §6.1). */
export const ENUMERATION_MAX_ENTRIES_PER_ROOT = 500;

export interface UnmanagedEnumerationEntry {
  description: string;
  directoryName: string;
  kind: "real-directory" | "foreign-symlink";
  name: string;
  root: string;
}

export interface ProjectionPresence {
  /** skillId → project roots where an owned, intact projection link exists. */
  ownedProjectedRoots: Map<string, string[]>;
  unmanaged: UnmanagedEnumerationEntry[];
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Ownership-joined projection classification (design v8 §3.5): a symlink only
 * counts as a managed projection when the ownership ledger has a record for
 * that exact relative path AND the link target AND object identity still
 * match. Everything else in a discovery root is unmanaged (read-only).
 */
export async function enumerateProjectDiscoveryRoots(args: {
  projectRoot: string;
  ownership: OwnershipRecord | null;
  /** Read SKILL.md metadata for unmanaged entries (default true). */
  withMetadata?: boolean;
}): Promise<ProjectionPresence> {
  const ownedByPath = new Map(
    (args.ownership?.targets ?? []).map((t) => [t.relativePath, t] as const)
  );
  const ownedProjectedRoots = new Map<string, string[]>();
  const unmanaged: UnmanagedEnumerationEntry[] = [];
  const withMetadata = args.withMetadata !== false;

  for (const root of UNMANAGED_DISCOVERY_ROOTS) {
    const absoluteRoot = join(args.projectRoot, ...root.split("/"));
    let rootInfo: Stats;
    try {
      rootInfo = await lstat(absoluteRoot);
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      continue;
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) continue;

    let children: string[];
    try {
      children = await readdir(absoluteRoot);
    } catch {
      continue;
    }
    children.sort();
    let count = 0;
    for (const child of children) {
      if (child.startsWith(".")) continue;
      if (count >= ENUMERATION_MAX_ENTRIES_PER_ROOT) break;
      count += 1;
      const absoluteChild = join(absoluteRoot, child);
      const relativePath = `${root}/${child}`;
      let info: Stats;
      try {
        info = await lstat(absoluteChild);
      } catch {
        continue;
      }

      if (info.isSymbolicLink()) {
        const record = ownedByPath.get(relativePath);
        if (record) {
          let linkTarget: string | null = null;
          try {
            linkTarget = await readlink(absoluteChild);
          } catch {
            linkTarget = null;
          }
          const identityOk =
            record.objectIdentity.dev === info.dev &&
            record.objectIdentity.ino === info.ino;
          if (identityOk && linkTarget === record.expectedRelativeLinkTarget) {
            const roots = ownedProjectedRoots.get(record.skillId) ?? [];
            roots.push(root);
            ownedProjectedRoots.set(record.skillId, roots);
            continue;
          }
        }
        // Foreign or tampered symlink — read-only unmanaged entry; metadata
        // via the link target is intentionally not read (untrusted pointer).
        unmanaged.push({
          root,
          directoryName: child,
          kind: "foreign-symlink",
          name: "",
          description: "",
        });
        continue;
      }

      if (info.isDirectory()) {
        const meta = withMetadata
          ? await peekSkillMetadata(absoluteChild)
          : { name: "", description: "" };
        unmanaged.push({
          root,
          directoryName: child,
          kind: "real-directory",
          name: meta.name,
          description: meta.description,
        });
      }
    }
  }

  return { ownedProjectedRoots, unmanaged };
}

export interface UserGlobalSkillEntry {
  description: string;
  directoryName: string;
  name: string;
  /** Agents that scan this root (registry-derived). */
  readByAgents: AgentKind[];
  /** `~`-relative user root, e.g. `~/.claude/skills`. */
  root: string;
}

/** Per-root presence facts (internal to main; not a renderer contract). */
export interface UserGlobalRootGroup {
  /** Expanded absolute path (user directory; never written by Pier). */
  absolutePath: string;
  entries: UserGlobalSkillEntry[];
  /** Absolute path exists and is a real directory. */
  present: boolean;
  readByAgents: AgentKind[];
  /** Whitelisted user-level root, `~`-relative display form. */
  root: string;
}

export interface UserGlobalEnumeration {
  /** Flat entries: matrix input + unified-list user-global rows. */
  entries: UserGlobalSkillEntry[];
  groups: UserGlobalRootGroup[];
}

export function expandUserRoot(root: string, home: string): string {
  if (root === "~") return home;
  if (root.startsWith("~/")) return join(home, root.slice(2));
  return root;
}

/**
 * Whitelist-only user-root enumeration (design v8 §6.1): roots come solely
 * from the adapter registry, one directory level, frontmatter-only metadata,
 * bounded entry count. Never a write path; never accepts caller paths.
 */
export async function enumerateUserGlobalSkills(args: {
  registry: SkillDiscoveryAdapterRegistry;
  homeDir?: string;
  withMetadata?: boolean;
}): Promise<UserGlobalEnumeration> {
  const home = args.homeDir ?? homedir();
  const withMetadata = args.withMetadata !== false;
  const groups: UserGlobalRootGroup[] = [];
  const flat: UserGlobalSkillEntry[] = [];

  for (const { root, readByAgents } of listUserSkillRoots(args.registry)) {
    const absoluteRoot = expandUserRoot(root, home);
    let present = false;
    const entries: UserGlobalSkillEntry[] = [];
    try {
      const info = await lstat(absoluteRoot);
      present = info.isDirectory() && !info.isSymbolicLink();
    } catch {
      present = false;
    }
    if (present) {
      let children: string[] = [];
      try {
        children = await readdir(absoluteRoot);
      } catch {
        children = [];
      }
      children.sort();
      let count = 0;
      for (const child of children) {
        if (child.startsWith(".")) continue;
        if (count >= ENUMERATION_MAX_ENTRIES_PER_ROOT) break;
        const absoluteChild = join(absoluteRoot, child);
        let childInfo: Stats;
        try {
          childInfo = await lstat(absoluteChild);
        } catch {
          continue;
        }
        // Agents follow directory symlinks in user roots (verified: Codex,
        // Claude); include both, metadata read is bounded either way.
        if (!(childInfo.isDirectory() || childInfo.isSymbolicLink())) {
          continue;
        }
        count += 1;
        const meta = withMetadata
          ? await peekSkillMetadata(absoluteChild)
          : { name: "", description: "" };
        const entry: UserGlobalSkillEntry = {
          root,
          directoryName: child,
          name: meta.name,
          description: meta.description,
          readByAgents: [...readByAgents],
        };
        entries.push(entry);
        flat.push(entry);
      }
    }
    groups.push({
      root,
      absolutePath: absoluteRoot,
      present,
      readByAgents: [...readByAgents],
      entries,
    });
  }

  return { groups, entries: flat };
}
