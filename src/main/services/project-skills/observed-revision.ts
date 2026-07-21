import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectSkillsManifestSchema } from "../../../shared/contracts/project-skills.ts";
import { resolveStableProjectIdentity } from "./identity.ts";
import {
  classifyTargetShape,
  expectedLinkTargetFor,
  inspectLibraryContent,
} from "./library-state.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import type { ProjectSkillsStore } from "./store.ts";

/**
 * Real observedRevision derivation (design v8 §3.2): a deterministic digest
 * of manifest bytes, ownership generation, every manifest entry's actual
 * library tree digest and the system-skills desired-state generation. No
 * timestamps — the same on-disk state always yields the same revision, so
 * the snapshot-time revision equals the under-lock recomputation whenever
 * nothing changed in between (revision-conflict precondition).
 */

/** Ledger generation stand-in when the ledger read reports corruption. */
const GENERATION_CORRUPT = -1;

export interface ObservedRevisionFacts {
  /** Digest of the raw manifest bytes (also for invalid JSON); null when absent. */
  manifestDigest: string | null;
  ownershipGeneration: number;
  /** Actual tree digest per manifest skill; null when missing/unreadable. */
  perSkillActualTreeDigests: ReadonlyArray<{
    actualDigest: string | null;
    skillId: string;
  }>;
  /** Projection identity+shape per owned relative target (§3.2). */
  projectionFacts: ReadonlyArray<{
    identityKey: string | null;
    relativePath: string;
    shape: string;
  }>;
  systemSkillsGeneration: number;
}

export function computeObservedRevision(facts: ObservedRevisionFacts): string {
  const canonical = JSON.stringify({
    manifestDigest: facts.manifestDigest,
    ownershipGeneration: facts.ownershipGeneration,
    perSkillActualTreeDigests: [...facts.perSkillActualTreeDigests]
      .sort((a, b) => a.skillId.localeCompare(b.skillId))
      .map((entry) => ({
        skillId: entry.skillId,
        actualDigest: entry.actualDigest,
      })),
    projectionFacts: [...facts.projectionFacts]
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((entry) => ({
        relativePath: entry.relativePath,
        shape: entry.shape,
        identityKey: entry.identityKey,
      })),
    systemSkillsGeneration: facts.systemSkillsGeneration,
  });
  return `sha256:${createHash("sha256")
    .update("project-skills-observed-revision-v3", "utf8")
    .update("\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex")}`;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function digestBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readSystemSkillsGeneration(projectDir: string): Promise<number> {
  try {
    const raw = await readFile(join(projectDir, "system-skills.json"), "utf8");
    const parsed = JSON.parse(raw) as { generation?: unknown };
    return typeof parsed.generation === "number" ? parsed.generation : 0;
  } catch {
    return 0;
  }
}

export interface CreateObservedRevisionProviderOptions {
  store: ProjectSkillsStore;
  userData: string;
}

/**
 * Production provider for `getObservedRevision(projectRoot)`. Shared by the
 * snapshot builder, plan/apply/repair preconditions and the post-transaction
 * recomputation that feeds `revisions.observedRevision` and the invalidated
 * broadcast payload.
 */
export function createObservedRevisionProvider(
  options: CreateObservedRevisionProviderOptions
): (projectRoot: string) => Promise<string> {
  const paths = createProjectSkillsPaths(options.userData);

  return async (projectRoot: string): Promise<string> => {
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = paths.rootKeyFor(identity);

    let manifestDigest: string | null = null;
    let skills: ReadonlyArray<{ contentDigest: string; id: string }> = [];
    try {
      const bytes = await readFile(
        join(identity.realPath, ".pier", "skills", "manifest.json")
      );
      manifestDigest = digestBytes(bytes);
      try {
        const parsed = projectSkillsManifestSchema.safeParse(
          JSON.parse(bytes.toString("utf8"))
        );
        if (parsed.success) skills = parsed.data.skills;
      } catch {
        // Invalid JSON still contributes its byte digest.
      }
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }

    let ownershipGeneration = 0;
    let ownershipTargets: ReadonlyArray<{ relativePath: string }> = [];
    try {
      const ownership = await options.store.readOwnership(rootKey);
      ownershipGeneration = ownership?.generation ?? 0;
      ownershipTargets = ownership?.targets ?? [];
    } catch {
      ownershipGeneration = GENERATION_CORRUPT;
    }

    const perSkillActualTreeDigests: Array<{
      actualDigest: string | null;
      skillId: string;
    }> = [];
    for (const entry of skills) {
      const inspection = await inspectLibraryContent(
        identity.realPath,
        entry.id,
        entry.contentDigest
      );
      perSkillActualTreeDigests.push({
        skillId: entry.id,
        actualDigest: inspection.actualDigest,
      });
    }

    const projectionFacts: Array<{
      identityKey: string | null;
      relativePath: string;
      shape: string;
    }> = [];
    for (const target of ownershipTargets) {
      const parts = target.relativePath.split("/");
      const skillId = parts.at(-1) ?? "";
      const root = parts.slice(0, -1).join("/");
      const absolute = join(identity.realPath, ...parts);
      const shape = await classifyTargetShape(
        absolute,
        expectedLinkTargetFor(skillId, root)
      );
      let identityKey: string | null = null;
      try {
        const st = await lstat(absolute);
        identityKey = `${st.dev}:${st.ino}:${st.mode}`;
      } catch {
        identityKey = null;
      }
      projectionFacts.push({
        relativePath: target.relativePath,
        shape,
        identityKey,
      });
    }

    return computeObservedRevision({
      manifestDigest,
      ownershipGeneration,
      perSkillActualTreeDigests,
      projectionFacts,
      systemSkillsGeneration: await readSystemSkillsGeneration(
        paths.projectDir(rootKey)
      ),
    });
  };
}
