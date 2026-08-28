import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PIER_SYSTEM_SKILL_PREFIX,
  skillIdSchema,
} from "../../../../shared/contracts/project-skills.ts";
import { peekSkillMetadata } from "../frontmatter.ts";
import type { StableProjectIdentity } from "../identity.ts";
import { createProjectSkillsPaths } from "../paths.ts";
import {
  createProjectSkillsStore,
  type ProjectSkillsStore,
} from "../store/index.ts";
import { installSystemSkillCache } from "./cache.ts";
import {
  retireProjectSystemSkillLibrary,
  sweepSystemSkillSwapLeftovers,
} from "./content.ts";
import { publishSystemSkillDiscoveryLink } from "./discovery-link.ts";
import { ensureSystemSkillGitExclude } from "./git-exclude.ts";

/**
 * Pier system skills channel (design v8 §8): capability skills shipped by the
 * app or official managed plugins. Canonical content lives under app
 * `resources/system-skills/<id>`; the live copy is `{systemSkillsCacheRoot}/<id>`
 * (宿主注入 `~/.pier/system-skills`;Codex `$CODEX_HOME/skills/.system`
 * analogue). Discovery roots get a
 * directory symlink to that cache — never a vendored tree in the git repo.
 *
 * Two hard red lines (v8 §8):
 * 1. Published content only comes from immutable managed sources (app
 *    resources / managed-plugin version dirs). Dev-override content must be
 *    registered with `devOrigin: true` and is rejected in production.
 * 2. System skills never touch user-level directories and never bypass
 *    deletion safety — ownership rules are identical to user skills.
 *
 * Desired state lives machine-locally in `system-skills.json` (never in the
 * Git manifest). Default: every registered contribution is **enabled** for a
 * project (`enabledBySkillId[id] !== false`).
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
  /** Present after reconcile installed the home-cache copy. */
  contentDigest: string | null;
  /**
   * From the immutable contribution SKILL.md (app resources / plugin package).
   * Independent of whether the home-cache snapshot exists yet.
   */
  description: string;
  enabled: boolean;
  id: string;
  /** From the immutable contribution SKILL.md. */
  name: string;
  provider: { id: string; version: string };
  targetAgents: readonly string[];
}

export interface SystemSkillsChannel {
  list(): readonly SystemSkillContribution[];
  /**
   * Reconcile system skills for a project: install/refresh the home cache,
   * retire leftover project-library snapshots, and project discovery
   * symlinks. MUST be called while holding the project skills lock.
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

/**
 * Pier projection roots for system skills: always both shared `.agents` and
 * Claude-compat `.claude` so agents that only scan one root still receive
 * product skills. Links point at the home cache, not the project library.
 */
export const SYSTEM_SKILL_PROJECTION_ROOTS = [
  ".agents/skills",
  ".claude/skills",
] as const;

export type SystemSkillProjectionRoot =
  (typeof SYSTEM_SKILL_PROJECTION_ROOTS)[number];

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
        // Corrupt desired state degrades to defaults.
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
      const meta = await peekSkillMetadata(contribution.contentDir);
      out.push({
        id: contribution.id,
        provider: contribution.provider,
        enabled: isEnabled(desired, contribution.id),
        contentDigest:
          desired.publishedContentDigestsBySkillId[contribution.id]?.at(-1) ??
          null,
        targetAgents: contribution.targetAgents ?? [],
        name: meta.name,
        description: meta.description,
      });
    }
    return out;
  }

  async function recordOwnership(args: {
    identity: {
      dev: number;
      ino: number;
      isDirectory: boolean;
      isSymbolicLink: boolean;
      mode: number;
      nlink: number;
    };
    projectIdentity: StableProjectIdentity;
    relativeTarget: string;
    rootKey: string;
    skillId: string;
    expectedRelativeLinkTarget: string;
    provider: { id: string; version: string };
  }): Promise<void> {
    try {
      const ownership = await store.readOwnership(args.rootKey);
      const generation = ownership?.generation ?? 0;
      const targets = (ownership?.targets ?? []).filter(
        (t) => t.relativePath !== args.relativeTarget
      );
      targets.push({
        relativePath: args.relativeTarget,
        skillId: args.skillId,
        expectedRelativeLinkTarget: args.expectedRelativeLinkTarget,
        objectIdentity: {
          dev: args.identity.dev,
          ino: args.identity.ino,
          mode: args.identity.mode,
          nlink: args.identity.nlink,
          isDirectory: args.identity.isDirectory,
          isSymbolicLink: args.identity.isSymbolicLink,
        },
        createdByOperationId: `system-skills:${args.provider.id}@${args.provider.version}`,
        createdAt: now(),
      });
      await store.commitOwnership(args.rootKey, generation, {
        schemaVersion: 1,
        generation: generation + 1,
        projectIdentity: args.projectIdentity,
        targets,
      });
    } catch {
      // Next reconcile re-records; never delete without ledger entry.
    }
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
    const projectRoot = args.projectIdentity.realPath;

    for (const contribution of contributions) {
      if (!isEnabled(desired, contribution.id)) continue;
      const installed = await installSystemSkillCache({
        userData: options.userData,
        projectRoot,
        contribution,
        preferProjectVendorSource: !options.isProduction,
      });
      const knownDigests =
        publishedDigestsBySkill.get(contribution.id) ?? new Set<string>();
      if (!knownDigests.has(installed.digest)) {
        knownDigests.add(installed.digest);
        publishedDigestsBySkill.set(contribution.id, knownDigests);
        desired.publishedContentDigestsBySkillId[contribution.id] = [
          ...knownDigests,
        ];
        desiredChanged = true;
      }
      await retireProjectSystemSkillLibrary({
        projectRoot,
        skillId: contribution.id,
        officialDigest: installed.digest,
        publishedDigests:
          desired.publishedContentDigestsBySkillId[contribution.id] ?? [],
      });
      published.push(contribution.id);

      const expected = installed.cacheDir;
      const ownership = await store
        .readOwnership(args.rootKey)
        .catch(() => null);
      for (const root of SYSTEM_SKILL_PROJECTION_ROOTS) {
        const relativeTarget = `${root}/${contribution.id}`;
        desiredProjections.push({
          skillId: contribution.id,
          relativeTarget,
          expectedRelativeLinkTarget: expected,
        });
        const owned = ownership?.targets.find(
          (t) => t.relativePath === relativeTarget
        );
        const publishedLink = await publishSystemSkillDiscoveryLink({
          projectRoot,
          relativeTarget,
          cacheDir: expected,
          skillId: contribution.id,
          userData: options.userData,
          owned: owned
            ? {
                identity: owned.objectIdentity,
                expectedRelativeLinkTarget: owned.expectedRelativeLinkTarget,
              }
            : null,
        });
        if (
          publishedLink.status !== "created" &&
          publishedLink.status !== "replaced"
        ) {
          continue;
        }
        await recordOwnership({
          identity: publishedLink.identity,
          projectIdentity: args.projectIdentity,
          relativeTarget,
          rootKey: args.rootKey,
          skillId: contribution.id,
          expectedRelativeLinkTarget: expected,
          provider: contribution.provider,
        });
      }
    }

    if (desiredChanged) {
      desired.generation += 1;
      await writeDesired(args.rootKey, desired);
    }

    await ensureSystemSkillGitExclude(projectRoot);

    return { published, desiredProjections };
  }

  return {
    list: () => contributions,
    register,
    views,
    reconcile,
  };
}
