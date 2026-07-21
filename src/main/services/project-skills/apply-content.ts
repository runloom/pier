import {
  lstat,
  readdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  ProjectSkillManifestEntry,
  ProjectSkillsDraft,
  ProjectSkillsManifest,
} from "../../../shared/contracts/project-skills.ts";
import { projectSkillsManifestSchema } from "../../../shared/contracts/project-skills.ts";
import {
  type CleanupEntryExpectation,
  ensureDir,
  isErrno,
  sameIdentity,
} from "./apply-log.ts";
import {
  createProjectSkillsFileSystemAdapter,
  type ProjectSkillsFileSystemAdapter,
} from "./fs-adapter.ts";
import { expectedLinkTargetFor } from "./library-state.ts";
import type { StagingCandidateSourceKind } from "./store.ts";

export type CleanupLibraryResult =
  | {
      status: "removed";
      removedRelativePaths: string[];
    }
  | {
      status: "cleanup-pending";
      removedRelativePaths: string[];
      retainedRelativePaths: string[];
      reason:
        | "new-or-mismatched-entries"
        | "rmdir-not-empty"
        | "identity-mismatch";
    };

/**
 * Per-file / per-directory identity cleanup. Never recursive rm.
 * Deletes only entries whose current identity matches the log; finishes with rmdir.
 */
export async function cleanupLibrarySkillByIdentity(args: {
  libraryDir: string;
  expectedEntries: readonly CleanupEntryExpectation[];
  fs?: ProjectSkillsFileSystemAdapter;
}): Promise<CleanupLibraryResult> {
  const fs = args.fs ?? createProjectSkillsFileSystemAdapter();
  const removedRelativePaths: string[] = [];
  const retainedRelativePaths: string[] = [];

  // Files first (deepest path first), then directories (deepest first), skip "." until end.
  const files = args.expectedEntries
    .filter((e) => e.kind === "file")
    .slice()
    .sort(
      (a, b) =>
        b.relativePath.split("/").length - a.relativePath.split("/").length ||
        b.relativePath.localeCompare(a.relativePath)
    );
  const dirs = args.expectedEntries
    .filter((e) => e.kind === "directory" && e.relativePath !== ".")
    .slice()
    .sort(
      (a, b) =>
        b.relativePath.split("/").length - a.relativePath.split("/").length ||
        b.relativePath.localeCompare(a.relativePath)
    );
  const rootEntry = args.expectedEntries.find(
    (e) => e.kind === "directory" && e.relativePath === "."
  );

  let mismatch = false;

  for (const entry of files) {
    const absolute = join(args.libraryDir, ...entry.relativePath.split("/"));
    try {
      const current = await fs.lstatIdentity(absolute);
      if (!sameIdentity(current, entry.identity) || current.isDirectory) {
        retainedRelativePaths.push(entry.relativePath);
        mismatch = true;
        continue;
      }
      await unlink(absolute);
      removedRelativePaths.push(entry.relativePath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        // Already gone — treat as removed.
        removedRelativePaths.push(entry.relativePath);
        continue;
      }
      throw error;
    }
  }

  for (const entry of dirs) {
    const absolute = join(args.libraryDir, ...entry.relativePath.split("/"));
    try {
      const current = await fs.lstatIdentity(absolute);
      if (!(sameIdentity(current, entry.identity) && current.isDirectory)) {
        retainedRelativePaths.push(entry.relativePath);
        mismatch = true;
        continue;
      }
      try {
        await rmdir(absolute);
        removedRelativePaths.push(entry.relativePath);
      } catch (error) {
        if (isErrno(error, "ENOTEMPTY") || isErrno(error, "EEXIST")) {
          retainedRelativePaths.push(entry.relativePath);
          mismatch = true;
          continue;
        }
        throw error;
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        removedRelativePaths.push(entry.relativePath);
        continue;
      }
      throw error;
    }
  }

  // Detect unplanned entries still present under libraryDir.
  let unplanned: string[] = [];
  try {
    unplanned = await listRelativeEntries(args.libraryDir);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { status: "removed", removedRelativePaths };
    }
    throw error;
  }

  const plannedSet = new Set(
    args.expectedEntries
      .filter((e) => e.relativePath !== ".")
      .map((e) => e.relativePath)
  );
  for (const rel of unplanned) {
    if (!(plannedSet.has(rel) || removedRelativePaths.includes(rel))) {
      if (!retainedRelativePaths.includes(rel)) {
        retainedRelativePaths.push(rel);
      }
      mismatch = true;
    }
  }

  if (rootEntry) {
    try {
      const current = await fs.lstatIdentity(args.libraryDir);
      if (sameIdentity(current, rootEntry.identity) && current.isDirectory) {
        try {
          await rmdir(args.libraryDir);
          removedRelativePaths.push(".");
        } catch (error) {
          if (isErrno(error, "ENOTEMPTY") || isErrno(error, "EEXIST")) {
            mismatch = true;
          } else if (!isErrno(error, "ENOENT")) {
            throw error;
          }
        }
      } else {
        mismatch = true;
      }
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
  } else {
    // No root expectation: try rmdir if empty.
    try {
      await rmdir(args.libraryDir);
    } catch (error) {
      if (isErrno(error, "ENOTEMPTY") || isErrno(error, "EEXIST")) {
        mismatch = true;
      } else if (!isErrno(error, "ENOENT")) {
        throw error;
      }
    }
  }

  // Final existence check.
  try {
    await lstat(args.libraryDir);
    return {
      status: "cleanup-pending",
      removedRelativePaths,
      retainedRelativePaths: [...new Set(retainedRelativePaths)].sort(),
      reason: mismatch ? "new-or-mismatched-entries" : "rmdir-not-empty",
    };
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      if (mismatch && retainedRelativePaths.length > 0) {
        // Directory gone but we thought we retained — treat as removed.
      }
      return { status: "removed", removedRelativePaths };
    }
    throw error;
  }
}

async function listRelativeEntries(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    for (const name of names) {
      const abs = join(dir, name);
      const rel = relative(rootDir, abs).split(sep).join("/");
      out.push(rel);
      try {
        const st = await lstat(abs);
        if (st.isDirectory() && !st.isSymbolicLink()) {
          await walk(abs);
        }
      } catch {
        // ignore races
      }
    }
  }
  await walk(rootDir);
  return out.sort();
}

export async function collectCleanupEntries(
  libraryDir: string,
  fs: ProjectSkillsFileSystemAdapter
): Promise<CleanupEntryExpectation[]> {
  const entries: CleanupEntryExpectation[] = [];
  const rels = await listRelativeEntries(libraryDir);
  for (const rel of rels) {
    const abs = join(libraryDir, ...rel.split("/"));
    const id = await fs.lstatIdentity(abs);
    entries.push({
      relativePath: rel,
      kind: id.isDirectory && !id.isSymbolicLink ? "directory" : "file",
      identity: id,
    });
  }
  const rootId = await fs.lstatIdentity(libraryDir);
  entries.push({
    relativePath: ".",
    kind: "directory",
    identity: rootId,
  });
  return entries;
}

export async function copyTreeNoFollow(
  sourceDir: string,
  destDir: string
): Promise<void> {
  await ensureDir(destDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(sourceDir, entry.name);
    const dst = join(destDir, entry.name);
    const st = await lstat(src);
    if (st.isSymbolicLink() || (st.isFile() === false && !st.isDirectory())) {
      if (st.isDirectory() && !st.isSymbolicLink()) {
        await copyTreeNoFollow(src, dst);
        continue;
      }
      if (!st.isFile() || st.isSymbolicLink()) {
        throw new Error(`refusing to copy special/symlink entry: ${src}`);
      }
    }
    if (st.isDirectory()) {
      await copyTreeNoFollow(src, dst);
    } else {
      const bytes = await readFile(src);
      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
      const mode = st.mode & 0o111 ? 0o755 : 0o644;
      await writeFile(dst, bytes, { mode, flag: "wx" });
    }
  }
}

export function buildNextManifest(
  current: ProjectSkillsManifest | null,
  draft: ProjectSkillsDraft,
  importEntries: Map<
    string,
    { contentDigest: string; source: ProjectSkillManifestEntry["source"] }
  >
): ProjectSkillsManifest {
  const byId = new Map<string, ProjectSkillManifestEntry>();
  for (const entry of current?.skills ?? []) {
    byId.set(entry.id, { ...entry });
  }
  for (const [skillId, meta] of importEntries) {
    const existing = byId.get(skillId);
    byId.set(skillId, {
      id: skillId,
      enabled: existing?.enabled ?? false,
      contentDigest: meta.contentDigest,
      source: meta.source,
    });
  }
  for (const [skillId, enabled] of Object.entries(
    draft.enabledBySkillId ?? {}
  )) {
    const existing = byId.get(skillId);
    if (!existing) continue;
    byId.set(skillId, { ...existing, enabled: enabled === true });
  }
  for (const skillId of draft.deleteSkillIds ?? []) {
    byId.delete(skillId);
  }
  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return projectSkillsManifestSchema.parse({
    version: 1,
    delivery: {
      agents: draft.deliveryAgents === true,
      claude: draft.deliveryClaude === true,
    },
    skills,
  });
}

export function expectedLinkTarget(skillId: string): string {
  // Both delivery roots are two levels deep; shared derivation owns the form.
  return expectedLinkTargetFor(skillId, ".agents/skills");
}

export function candidateSourceToManifestType(
  sourceKind: StagingCandidateSourceKind
): ProjectSkillManifestEntry["source"]["type"] {
  if (sourceKind === "project-discovery-import") {
    return "project-discovery-import";
  }
  if (sourceKind === "git-declared") return "git-declared";
  return "local-import";
}

export function minimalSnapshot(args: {
  projectRef: ContractProjectRootRef;
  manifest: ProjectSkillsManifest | null;
  manifestRevision: string | null;
  observedRevision: string;
  pendingIssueIds: string[];
}): unknown {
  return {
    projectRef: args.projectRef,
    manifest: args.manifest,
    manifestRevision: args.manifestRevision,
    observedRevision: args.observedRevision,
    pendingIssueIds: args.pendingIssueIds,
  };
}
