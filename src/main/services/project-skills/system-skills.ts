import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PIER_SYSTEM_SKILL_PREFIX,
  skillIdSchema,
} from "../../../shared/contracts/project-skills.ts";
import { createProjectSkillsFileSystemAdapter } from "./fs-adapter.ts";
import type { StableProjectIdentity } from "./identity.ts";
import { ensureProjectRelativeDir } from "./path-containment.ts";
import { createProjectSkillsPaths } from "./paths.ts";
import { createProjectSkillsStore, type ProjectSkillsStore } from "./store.ts";
import {
  publishSystemSkillContent,
  sweepSystemSkillSwapLeftovers,
} from "./system-skills-content.ts";

/**
 * Pier system skills channel (design v8 §8): capability skills shipped by the
 * app or official managed plugins, injected per project through the SAME
 * projection channel as user skills (library snapshot + relative symlink +
 * ownership ledger).
 *
 * Two hard red lines (v8 §8):
 * 1. Published content only comes from immutable managed sources (app
 *    resources / managed-plugin version dirs). Dev-override content must be
 *    registered with `devOrigin: true` and is rejected in production.
 * 2. System skills never touch user-level directories and never bypass
 *    deletion safety — ownership rules are identical to user skills.
 *
 * Desired state lives machine-locally in `system-skills.json` (never in the
 * Git manifest). v1 default: a registered contribution is enabled for a
 * project when the project is under Pier skills management; a per-project
 * toggle command ships together with the first real contribution consumer
 * (the canvas capability plugin) — building the toggle before any
 * contribution exists would be dead surface.
 */

export interface SystemSkillContribution {
  /** Absolute path to the immutable content directory (SKILL.md root). */
  contentDir: string;
  /** Dev-only origin (plugin workspace/dev override); rejected in production. */
  devOrigin?: boolean;
  /** Skill id; must carry the reserved `pier-` prefix. */
  id: string;
  /** Provider identity: app itself or an official managed plugin. */
  provider: { id: string; version: string };
  /** Agents this skill targets; empty/omitted = all applicable adapters. */
  targetAgents?: readonly string[];
}

export interface SystemSkillDesiredState {
  /** skillId → enabled (absent = default enabled). */
  enabledBySkillId: Record<string, boolean>;
  generation: number;
  /** Digests published by Pier, used only for safe retirement on refresh. */
  publishedContentDigestsBySkillId: Record<string, string[]>;
  schemaVersion: 1;
}

export interface SystemSkillView {
  /** Present after reconcile published it into the project library. */
  contentDigest: string | null;
  enabled: boolean;
  id: string;
  provider: { id: string; version: string };
  targetAgents: readonly string[];
}

export interface SystemSkillsChannel {
  list(): readonly SystemSkillContribution[];
  /**
   * Reconcile system skills for a project: publish/refresh library snapshots,
   * record published digests, and report the desired projection targets.
   * MUST be called while holding the project skills lock (ensureReady path).
   */
  reconcile(args: {
    projectIdentity: StableProjectIdentity;
    rootKey: string;
  }): Promise<{
    published: string[];
    desiredProjections: Array<{
      skillId: string;
      relativeTarget: string;
      expectedRelativeLinkTarget: string;
    }>;
  }>;
  register(contribution: SystemSkillContribution): void;
  views(rootKey: string): Promise<SystemSkillView[]>;
}

export interface CreateSystemSkillsChannelOptions {
  contributions?: readonly SystemSkillContribution[];
  /** production = packaged app; dev-origin contributions rejected when true. */
  isProduction: boolean;
  now?: () => number;
  store?: ProjectSkillsStore;
  userData: string;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function assertSystemSkillContribution(
  contribution: SystemSkillContribution
): void {
  skillIdSchema.parse(contribution.id);
  if (!contribution.id.startsWith(PIER_SYSTEM_SKILL_PREFIX)) {
    throw new Error(
      `system skill id must carry the ${PIER_SYSTEM_SKILL_PREFIX} prefix: ${contribution.id}`
    );
  }
  if (!(contribution.provider.id && contribution.provider.version)) {
    throw new Error("system skill contribution requires provider id+version");
  }
}

export function createSystemSkillsChannel(
  options: CreateSystemSkillsChannelOptions
): SystemSkillsChannel {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const now = options.now ?? Date.now;
  const contributions: SystemSkillContribution[] = [];

  function register(contribution: SystemSkillContribution): void {
    assertSystemSkillContribution(contribution);
    if (options.isProduction && contribution.devOrigin) {
      // Red line 1: production must not publish from a dev channel.
      throw new Error(
        `dev-origin system skill rejected in production: ${contribution.id}`
      );
    }
    const existing = contributions.findIndex((c) => c.id === contribution.id);
    if (existing >= 0) {
      contributions[existing] = contribution;
    } else {
      contributions.push(contribution);
    }
  }

  for (const contribution of options.contributions ?? []) {
    register(contribution);
  }

  function desiredStatePath(rootKey: string): string {
    return join(paths.projectDir(rootKey), "system-skills.json");
  }

  async function readDesired(
    rootKey: string
  ): Promise<SystemSkillDesiredState> {
    try {
      const raw = await readFile(desiredStatePath(rootKey), "utf8");
      const parsed = JSON.parse(raw) as SystemSkillDesiredState;
      if (parsed.schemaVersion === 1 && typeof parsed.generation === "number") {
        return {
          ...parsed,
          enabledBySkillId: parsed.enabledBySkillId ?? {},
          publishedContentDigestsBySkillId:
            parsed.publishedContentDigestsBySkillId ?? {},
        };
      }
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        // Corrupt desired state degrades to defaults (never blocks launches —
        // system skills are additive capability, not user data).
      }
    }
    return {
      schemaVersion: 1,
      generation: 0,
      enabledBySkillId: {},
      publishedContentDigestsBySkillId: {},
    };
  }

  async function writeDesired(
    rootKey: string,
    desired: SystemSkillDesiredState
  ): Promise<void> {
    const target = desiredStatePath(rootKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(desired, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  function isEnabled(
    desired: SystemSkillDesiredState,
    skillId: string
  ): boolean {
    return desired.enabledBySkillId[skillId] !== false;
  }

  async function views(rootKey: string): Promise<SystemSkillView[]> {
    const desired = await readDesired(rootKey);
    const out: SystemSkillView[] = [];
    for (const contribution of contributions) {
      out.push({
        id: contribution.id,
        provider: contribution.provider,
        enabled: isEnabled(desired, contribution.id),
        contentDigest:
          desired.publishedContentDigestsBySkillId[contribution.id]?.at(-1) ??
          null,
        targetAgents: contribution.targetAgents ?? [],
      });
    }
    return out;
  }

  async function reconcile(args: {
    projectIdentity: StableProjectIdentity;
    rootKey: string;
  }): Promise<{
    published: string[];
    desiredProjections: Array<{
      skillId: string;
      relativeTarget: string;
      expectedRelativeLinkTarget: string;
    }>;
  }> {
    const desired = await readDesired(args.rootKey);
    const published: string[] = [];
    const desiredProjections: Array<{
      skillId: string;
      relativeTarget: string;
      expectedRelativeLinkTarget: string;
    }> = [];

    await sweepSystemSkillSwapLeftovers(args.projectIdentity.realPath);

    const publishedDigestsBySkill = new Map(
      Object.entries(desired.publishedContentDigestsBySkillId).map(
        ([skillId, digests]) => [skillId, new Set(digests)] as const
      )
    );
    let desiredChanged = false;
    const fs = createProjectSkillsFileSystemAdapter();
    const projectRoot = args.projectIdentity.realPath;

    for (const contribution of contributions) {
      if (!isEnabled(desired, contribution.id)) continue;
      const digest = await publishSystemSkillContent({
        projectRoot,
        contribution,
        publishedDigests:
          publishedDigestsBySkill.get(contribution.id) ?? new Set(),
      });
      const knownDigests =
        publishedDigestsBySkill.get(contribution.id) ?? new Set<string>();
      if (!knownDigests.has(digest)) {
        knownDigests.add(digest);
        publishedDigestsBySkill.set(contribution.id, knownDigests);
        desired.publishedContentDigestsBySkillId[contribution.id] = [
          ...knownDigests,
        ];
        desiredChanged = true;
      }
      published.push(contribution.id);

      const relativeTarget = `.agents/skills/${contribution.id}`;
      const expected = `../../.pier/skills/library/${contribution.id}`;
      desiredProjections.push({
        skillId: contribution.id,
        relativeTarget,
        expectedRelativeLinkTarget: expected,
      });
      // Projection publish (no-replace; existing correct link is a no-op;
      // foreign objects are left untouched — deletion safety identical to
      // user skills). Ancestors must be real directories (§6.1).
      const absolute = join(projectRoot, ".agents", "skills", contribution.id);
      try {
        const info = await lstat(absolute);
        if (info.isSymbolicLink()) {
          continue; // Existing link (owned or foreign) — never replace here.
        }
        continue; // Unmanaged real entry — never overwrite.
      } catch (error) {
        if (!isErrno(error, "ENOENT")) continue;
      }
      try {
        await ensureProjectRelativeDir(projectRoot, ".agents/skills");
      } catch {
        continue;
      }
      const publishedLink = await fs.publishSymlinkNoReplace({
        linkPath: absolute,
        relativeTarget: expected,
        projectRoot,
      });
      if (publishedLink.status !== "created") {
        continue;
      }
      // Ownership recording — deletion safety identical to user skills (red
      // line 2): only ledger-recorded identities may ever be deleted.
      try {
        const ownership = await store.readOwnership(args.rootKey);
        const generation = ownership?.generation ?? 0;
        const targets = (ownership?.targets ?? []).filter(
          (t) => t.relativePath !== relativeTarget
        );
        targets.push({
          relativePath: relativeTarget,
          skillId: contribution.id,
          expectedRelativeLinkTarget: expected,
          objectIdentity: {
            dev: publishedLink.identity.dev,
            ino: publishedLink.identity.ino,
            mode: publishedLink.identity.mode,
            nlink: publishedLink.identity.nlink,
            isDirectory: publishedLink.identity.isDirectory,
            isSymbolicLink: publishedLink.identity.isSymbolicLink,
          },
          createdByOperationId: `system-skills:${contribution.provider.id}@${contribution.provider.version}`,
          createdAt: now(),
        });
        await store.commitOwnership(args.rootKey, generation, {
          schemaVersion: 1,
          generation: generation + 1,
          projectIdentity: args.projectIdentity,
          targets,
        });
      } catch {
        // Ownership write failure leaves an unowned link that the next
        // reconcile will re-record; never delete without a ledger entry.
      }
    }

    if (desiredChanged) {
      desired.generation += 1;
      await writeDesired(args.rootKey, desired);
    }

    return { published, desiredProjections };
  }

  return {
    list: () => contributions,
    register,
    views,
    reconcile,
  };
}
