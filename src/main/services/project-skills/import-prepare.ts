import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { StableProjectIdentity } from "./identity.ts";
import { assertRealDirectory, lstatOrThrow } from "./import-fs.ts";
import {
  buildDirectorySummary,
  type CreateProjectSkillsImportServiceOptions,
  extractRiskSummary,
  type ImportCandidateView,
  type ImportSourceKind,
  PROJECT_SKILLS_IMPORT_LIMITS,
  type PrepareFromSourceArgs,
  ProjectSkillsImportError,
  type ProjectSkillsImportPaths,
  treeDigestErrorCode,
  validateSkillMetadata,
} from "./import-limits.ts";
import {
  collectSourceSnapshot,
  collectSourceSnapshotMeta,
  type EntrySnapshot,
  materializeStagingTree,
  snapshotsEqual,
} from "./import-tree.ts";
import type { ProjectSkillsStore } from "./store.ts";
import {
  computeRiskFingerprint,
  computeTreeSha256V1,
  TreeDigestError,
} from "./tree-digest.ts";

export interface BoundCandidate {
  clientInstanceId: string;
  contentDigest: string;
  expiresAt: number;
  projectIdentity: StableProjectIdentity;
  rootKey: string;
  sourceKind: ImportSourceKind;
  stagingTreePath: string;
  token: string;
  webContentsId: number;
}

export interface ImportPrepareContext {
  assertStagingQuota: (
    identity: StableProjectIdentity,
    rootKey: string,
    incomingBytes: number
  ) => Promise<void>;
  bindings: Map<string, BoundCandidate>;
  now: () => number;
  options: Pick<
    CreateProjectSkillsImportServiceOptions,
    "afterCandidateCreated" | "afterFirstTraversal"
  >;
  parseSafeSkillFrontmatter: (markdown: string) => {
    frontmatter: Record<string, unknown>;
    body: string;
  };
  paths: ProjectSkillsImportPaths;
  stagingTreePathFor: (rootKey: string, token: string) => string;
  store: ProjectSkillsStore;
}

export async function prepareFromSource(
  ctx: ImportPrepareContext,
  args: PrepareFromSourceArgs
): Promise<ImportCandidateView> {
  const sourcePath = resolve(args.sourcePath);
  const sourceInfo = await lstatOrThrow(sourcePath);
  assertRealDirectory(sourceInfo, sourcePath);

  // First traversal + copy material
  const first = await collectSourceSnapshot(sourcePath, {
    includeBytes: true,
  });

  await ctx.assertStagingQuota(args.identity, args.rootKey, first.totalBytes);

  // Pre-allocate token so staging path is exact and destroyable on failure.
  const provisionalToken = randomBytes(24).toString("hex");
  const stagingTreePath = ctx.stagingTreePathFor(
    args.rootKey,
    provisionalToken
  );
  let issuedToken: string | null = null;

  try {
    await materializeStagingTree(stagingTreePath, first);

    if (ctx.options.afterFirstTraversal) {
      await ctx.options.afterFirstTraversal(sourcePath);
    }

    // Second full read-only traversal of source — must match first snapshot.
    const secondEntries = await collectSourceSnapshotMeta(sourcePath);
    const firstMeta: EntrySnapshot[] = first.entries.map((entry) =>
      entry.kind === "file" ? { ...entry, bytes: Buffer.alloc(0) } : entry
    );
    if (!snapshotsEqual(firstMeta, secondEntries)) {
      throw new ProjectSkillsImportError(
        "source-changed",
        "source tree changed between import traversals"
      );
    }

    // Validate SKILL.md + frontmatter from staged copy (authoritative snapshot).
    const skillMdPath = join(stagingTreePath, "SKILL.md");
    let skillMd: string;
    try {
      skillMd = await readFile(skillMdPath, "utf8");
    } catch (error) {
      throw new ProjectSkillsImportError(
        "invalid-skill",
        "SKILL.md is required at skill root",
        { cause: error }
      );
    }
    const { frontmatter } = ctx.parseSafeSkillFrontmatter(skillMd);
    const meta = validateSkillMetadata({
      directoryName: basename(sourcePath),
      frontmatter,
    });

    let contentDigest: string;
    try {
      contentDigest = await computeTreeSha256V1(stagingTreePath);
    } catch (error) {
      if (error instanceof TreeDigestError) {
        throw new ProjectSkillsImportError(
          treeDigestErrorCode(error.code),
          error.message,
          { cause: error }
        );
      }
      throw error;
    }

    const riskFingerprint = computeRiskFingerprint({
      treeFiles: first.treeFiles,
      frontmatter,
    });
    const riskSummary = extractRiskSummary(first.treeFiles, frontmatter);
    const directorySummary = buildDirectorySummary(first.treeFiles);
    const expiresAt = ctx.now() + PROJECT_SKILLS_IMPORT_LIMITS.tokenTtlMs;

    // Persist durable candidate with store-issued token, then rename staging dir.
    const record = await ctx.store.createCandidate(args.rootKey, {
      skillId: meta.skillId,
      sourceKind: args.sourceKind,
      contentDigest,
      treeDigest: contentDigest,
      expiresAt,
      ...(args.base === undefined
        ? {}
        : {
            baseSkillId: args.base.skillId,
            baseContentDigest: args.base.contentDigest,
          }),
    });
    issuedToken = record.token;
    await ctx.options.afterCandidateCreated?.(record.token);

    const finalTreePath = ctx.stagingTreePathFor(args.rootKey, record.token);
    await mkdir(dirname(finalTreePath), { recursive: true });
    // Move provisional tree into token directory (same parent staging root).
    const provisionalParent = join(
      ctx.paths.stagingDir(args.rootKey),
      provisionalToken
    );
    const finalParent = join(ctx.paths.stagingDir(args.rootKey), record.token);
    try {
      await rename(provisionalParent, finalParent);
    } catch {
      // Fallback: already at provisional; if rename fails copy-destroy.
      await rm(finalParent, { force: true, recursive: true });
      await materializeStagingTree(finalTreePath, first);
      await rm(provisionalParent, { force: true, recursive: true });
    }

    ctx.bindings.set(record.token, {
      token: record.token,
      rootKey: args.rootKey,
      projectIdentity: args.identity,
      contentDigest,
      webContentsId: args.caller.webContentsId,
      clientInstanceId: args.caller.clientInstanceId,
      stagingTreePath: finalTreePath,
      expiresAt,
      sourceKind: args.sourceKind,
    });
    const previewBytes = Buffer.from(skillMd, "utf8");
    let previewEnd = Math.min(previewBytes.length, 1024 * 1024);
    let nextByte = previewBytes[previewEnd] ?? 0;
    while (
      previewEnd < previewBytes.length &&
      previewEnd > 0 &&
      nextByte >= 128 &&
      nextByte <= 191
    ) {
      previewEnd -= 1;
      nextByte = previewBytes[previewEnd] ?? 0;
    }

    return {
      token: record.token,
      skillId: meta.skillId,
      name: meta.name,
      description: meta.description,
      sourceKind: args.sourceKind,
      sourceDisplayPath: args.sourceDisplayPath,
      skillMdPreview: previewBytes.subarray(0, previewEnd).toString("utf8"),
      skillMdTruncated: previewBytes.length > previewEnd,
      contentDigest,
      riskFingerprint,
      fileCount: first.fileCount,
      totalBytes: first.totalBytes,
      directorySummary,
      riskSummary,
      expiresAt,
      ...(args.base === undefined
        ? {}
        : { baseContentDigest: args.base.contentDigest }),
    };
  } catch (error) {
    if (issuedToken) {
      let discardSecured = false;
      try {
        await ctx.store.discardAvailable(args.rootKey, issuedToken);
        discardSecured = true;
      } catch {
        // Never delete a tree whose candidate may have been claimed.
      }
      if (discardSecured) {
        await rm(join(ctx.paths.stagingDir(args.rootKey), issuedToken), {
          force: true,
          recursive: true,
        }).catch(() => undefined);
      }
      ctx.bindings.delete(issuedToken);
    }
    await rm(join(ctx.paths.stagingDir(args.rootKey), provisionalToken), {
      force: true,
      recursive: true,
    }).catch(() => undefined);
    throw error;
  }
}
