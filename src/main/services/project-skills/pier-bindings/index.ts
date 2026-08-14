import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  PierBoundSkillView,
  PierHomeSkillDelivery,
} from "@shared/contracts/pier-home-skills.ts";
import { skillIdSchema } from "@shared/contracts/project-skills.ts";
import { peekSkillMetadata } from "../frontmatter.ts";
import { createProjectSkillsFileSystemAdapter } from "../fs-adapter.ts";
import type { StableProjectIdentity } from "../identity.ts";
import { expectedLinkTargetFor } from "../library-state.ts";
import { ensureProjectRelativeDir } from "../path-containment.ts";
import { createProjectSkillsPaths } from "../paths.ts";
import {
  createProjectSkillsStore,
  type ProjectSkillsStore,
} from "../store/index.ts";
import {
  publishSystemSkillContent,
  sweepSystemSkillSwapLeftovers,
} from "../system-skills/content.ts";
import { retireUndesiredPierBoundLibraryCopies } from "./retire.ts";
import {
  DEFAULT_MANUAL_BIND_DELIVERY,
  deliveryRoots,
  emptyDesired,
  normalizeDesiredState,
  normalizeManualDelivery,
  type PierBindingsDesiredState,
} from "./state.ts";

export type {
  PierBindingEntry,
  PierBindingsDesiredState,
} from "./state.ts";
export {
  DEFAULT_MANUAL_BIND_DELIVERY,
  deliveryRoots,
  normalizeDesiredState,
  normalizeManualDelivery,
} from "./state.ts";

/**
 * Pier Home → project bind ledger (Domain B end-state).
 * Desired projections reuse the system-skills publish + ownership channel.
 */

export interface PierBindingsChannel {
  bind(args: {
    delivery?: PierHomeSkillDelivery;
    rootKey: string;
    skillId: string;
  }): Promise<PierBindingsDesiredState>;
  listAlwaysIncludeSkills(): Promise<
    Array<{ id: string; delivery: PierHomeSkillDelivery }>
  >;
  listBoundIds(rootKey: string): Promise<string[]>;
  /** Root keys under `{userData}/project-skills/` that have a ledger dir. */
  listLedgerRootKeys(): Promise<string[]>;
  readDesired(rootKey: string): Promise<PierBindingsDesiredState>;
  reconcile(args: {
    manifestSkillIds?: ReadonlySet<string>;
    projectIdentity: StableProjectIdentity;
    rootKey: string;
    systemSkillIds?: ReadonlySet<string>;
  }): Promise<{
    published: string[];
    retiredLibraryIds: string[];
    desiredProjections: Array<{
      skillId: string;
      relativeTarget: string;
      expectedRelativeLinkTarget: string;
    }>;
  }>;
  unbind(args: {
    rootKey: string;
    skillId: string;
  }): Promise<PierBindingsDesiredState>;
  unbindEverywhere(skillId: string): Promise<number>;
  views(rootKey: string): Promise<PierBoundSkillView[]>;
}

export interface CreatePierBindingsChannelOptions {
  contentDirFor(skillId: string): string;
  listAlwaysIncludeSkills(): Promise<
    Array<{ id: string; delivery: PierHomeSkillDelivery }>
  >;
  listLibrarySkillIds(): Promise<string[]>;
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

export function createPierBindingsChannel(
  options: CreatePierBindingsChannelOptions
): PierBindingsChannel {
  const paths = createProjectSkillsPaths(options.userData);
  const store =
    options.store ?? createProjectSkillsStore({ userData: options.userData });
  const now = options.now ?? Date.now;

  function desiredStatePath(rootKey: string): string {
    return join(paths.projectDir(rootKey), "pier-bindings.json");
  }

  async function readDesired(
    rootKey: string
  ): Promise<PierBindingsDesiredState> {
    try {
      const raw = JSON.parse(await readFile(desiredStatePath(rootKey), "utf8"));
      return normalizeDesiredState(raw);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return emptyDesired();
      }
      if (error instanceof SyntaxError) {
        throw new Error(`pier-bindings.json is corrupt for rootKey=${rootKey}`);
      }
      throw error;
    }
  }

  async function writeDesired(
    rootKey: string,
    desired: PierBindingsDesiredState
  ): Promise<void> {
    const target = desiredStatePath(rootKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const payload: PierBindingsDesiredState = {
      schemaVersion: 2,
      generation: desired.generation,
      bindings: [...desired.bindings].sort((a, b) =>
        a.skillId.localeCompare(b.skillId)
      ),
      publishedContentDigestsBySkillId:
        desired.publishedContentDigestsBySkillId,
    };
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, target);
  }

  async function desiredSkills(rootKey: string): Promise<{
    alwaysIncludeById: Map<string, PierHomeSkillDelivery>;
    deliveryById: Map<string, PierHomeSkillDelivery>;
    desired: PierBindingsDesiredState;
    skillIds: string[];
  }> {
    const desired = await readDesired(rootKey);
    const alwaysIncludeSkills = await options.listAlwaysIncludeSkills();
    const alwaysIncludeById = new Map(
      alwaysIncludeSkills.map((skill) => [skill.id, skill.delivery] as const)
    );
    const libraryIds = new Set(await options.listLibrarySkillIds());
    const deliveryById = new Map<string, PierHomeSkillDelivery>();
    const skillIds = new Set<string>();

    for (const [id, delivery] of alwaysIncludeById) {
      if (!libraryIds.has(id)) continue;
      skillIds.add(id);
      deliveryById.set(id, delivery);
    }
    for (const entry of desired.bindings) {
      if (!libraryIds.has(entry.skillId)) continue;
      if (alwaysIncludeById.has(entry.skillId)) continue;
      skillIds.add(entry.skillId);
      deliveryById.set(entry.skillId, entry.delivery);
    }
    return {
      desired,
      skillIds: [...skillIds],
      alwaysIncludeById,
      deliveryById,
    };
  }

  return {
    readDesired,
    listAlwaysIncludeSkills: () => options.listAlwaysIncludeSkills(),

    async listLedgerRootKeys() {
      const base = join(options.userData, "project-skills");
      let names: string[] = [];
      try {
        names = await readdir(base);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
        return [];
      }
      const out: string[] = [];
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const dir = join(base, name);
        try {
          const info = await lstat(dir);
          if (!info.isDirectory()) continue;
        } catch {
          continue;
        }
        let hasLedger = false;
        for (const marker of [
          "pier-bindings.json",
          "ownership.json",
        ] as const) {
          try {
            await lstat(join(dir, marker));
            hasLedger = true;
            break;
          } catch {
            // try next marker
          }
        }
        if (hasLedger) out.push(name);
      }
      return out;
    },

    async listBoundIds(rootKey) {
      const { skillIds } = await desiredSkills(rootKey);
      return skillIds;
    },

    async views(rootKey) {
      const { skillIds, alwaysIncludeById, deliveryById, desired } =
        await desiredSkills(rootKey);
      const out: PierBoundSkillView[] = [];
      for (const id of skillIds) {
        const meta = await peekSkillMetadata(options.contentDirFor(id));
        out.push({
          id,
          name: meta.name || id,
          description: meta.description,
          alwaysInclude: alwaysIncludeById.has(id),
          delivery: deliveryById.get(id) ?? { ...DEFAULT_MANUAL_BIND_DELIVERY },
          contentDigest:
            desired.publishedContentDigestsBySkillId[id]?.at(-1) ?? null,
        });
      }
      return out.sort((a, b) => a.id.localeCompare(b.id));
    },

    async bind({ rootKey, skillId, delivery }) {
      const id = skillIdSchema.parse(skillId);
      const alwaysIncludeSkills = await options.listAlwaysIncludeSkills();
      if (alwaysIncludeSkills.some((skill) => skill.id === id)) {
        throw new Error(`skill is always-included and cannot be bound: ${id}`);
      }
      const libraryIds = new Set(await options.listLibrarySkillIds());
      if (!libraryIds.has(id)) {
        throw new Error(`skill not in Pier Home library: ${id}`);
      }
      const nextDelivery = normalizeManualDelivery(delivery);
      const desired = await readDesired(rootKey);
      const existing = desired.bindings.find((b) => b.skillId === id);
      if (
        existing &&
        existing.delivery.agents === nextDelivery.agents &&
        existing.delivery.claude === nextDelivery.claude
      ) {
        return desired;
      }
      desired.bindings = [
        ...desired.bindings.filter((b) => b.skillId !== id),
        { skillId: id, delivery: nextDelivery },
      ].sort((a, b) => a.skillId.localeCompare(b.skillId));
      desired.generation += 1;
      await writeDesired(rootKey, desired);
      return desired;
    },

    async unbind({ rootKey, skillId }) {
      const id = skillIdSchema.parse(skillId);
      const alwaysIncludeSkills = await options.listAlwaysIncludeSkills();
      if (alwaysIncludeSkills.some((skill) => skill.id === id)) {
        throw new Error(
          `skill is always-included and cannot be unbound: ${id}`
        );
      }
      const desired = await readDesired(rootKey);
      const next = desired.bindings.filter((item) => item.skillId !== id);
      if (next.length !== desired.bindings.length) {
        desired.bindings = next;
        desired.generation += 1;
        await writeDesired(rootKey, desired);
      }
      return desired;
    },

    async unbindEverywhere(skillId) {
      const id = skillIdSchema.parse(skillId);
      const base = join(options.userData, "project-skills");
      let rootKeys: string[] = [];
      try {
        rootKeys = await readdir(base);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
        return 0;
      }
      let changed = 0;
      for (const rootKey of rootKeys) {
        const desired = await readDesired(rootKey);
        if (!desired.bindings.some((b) => b.skillId === id)) continue;
        desired.bindings = desired.bindings.filter(
          (item) => item.skillId !== id
        );
        desired.generation += 1;
        await writeDesired(rootKey, desired);
        changed += 1;
      }
      return changed;
    },

    async reconcile(args) {
      const { desired, skillIds, deliveryById } = await desiredSkills(
        args.rootKey
      );
      const desiredSkillIds = new Set(skillIds);
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

      const ownershipSnapshot = await store.readOwnership(args.rootKey);
      const ownershipGeneration = ownershipSnapshot?.generation ?? 0;
      let ownershipTargets = [...(ownershipSnapshot?.targets ?? [])];
      let ownershipDirty = false;

      for (const skillId of skillIds) {
        const contentDir = options.contentDirFor(skillId);
        try {
          await lstat(contentDir);
        } catch {
          continue;
        }
        const digest = await publishSystemSkillContent({
          projectRoot,
          contribution: {
            id: skillId,
            contentDir,
            provider: { id: "pier.home", version: "1" },
          },
          publishedDigests:
            desired.publishedContentDigestsBySkillId[skillId] ?? [],
        });
        const knownDigests =
          publishedDigestsBySkill.get(skillId) ?? new Set<string>();
        if (!knownDigests.has(digest)) {
          knownDigests.add(digest);
          publishedDigestsBySkill.set(skillId, knownDigests);
          desired.publishedContentDigestsBySkillId[skillId] = [...knownDigests];
          desiredChanged = true;
        }
        published.push(skillId);

        const delivery = deliveryById.get(skillId) ?? {
          ...DEFAULT_MANUAL_BIND_DELIVERY,
        };
        for (const root of deliveryRoots(delivery)) {
          const relativeTarget = `${root}/${skillId}`;
          const expected = expectedLinkTargetFor(skillId, root);
          desiredProjections.push({
            skillId,
            relativeTarget,
            expectedRelativeLinkTarget: expected,
          });

          const absolute = join(projectRoot, ...root.split("/"), skillId);
          try {
            const info = await lstat(absolute);
            if (info.isSymbolicLink()) {
              try {
                if ((await readlink(absolute)) === expected) continue;
              } catch {
                // leave for repair
              }
              continue;
            }
            if (info.isDirectory() || info.isFile()) continue;
          } catch (error) {
            if (!isErrno(error, "ENOENT")) continue;
          }
          try {
            await ensureProjectRelativeDir(projectRoot, root);
          } catch {
            continue;
          }
          const publishedLink = await fs.publishSymlinkNoReplace({
            linkPath: absolute,
            relativeTarget: expected,
            projectRoot,
          });
          if (publishedLink.status !== "created") continue;
          ownershipTargets = ownershipTargets.filter(
            (t) => t.relativePath !== relativeTarget
          );
          ownershipTargets.push({
            relativePath: relativeTarget,
            skillId,
            expectedRelativeLinkTarget: expected,
            objectIdentity: {
              dev: publishedLink.identity.dev,
              ino: publishedLink.identity.ino,
              mode: publishedLink.identity.mode,
              nlink: publishedLink.identity.nlink,
              isDirectory: publishedLink.identity.isDirectory,
              isSymbolicLink: publishedLink.identity.isSymbolicLink,
            },
            createdByOperationId: `pier-bindings:${skillId}`,
            createdAt: now(),
          });
          ownershipDirty = true;
        }
      }

      if (ownershipDirty) {
        try {
          await store.commitOwnership(args.rootKey, ownershipGeneration, {
            schemaVersion: 1,
            generation: ownershipGeneration + 1,
            projectIdentity: args.projectIdentity,
            targets: ownershipTargets,
          });
        } catch {
          // Ownership write failure leaves unowned links; next reconcile re-records.
        }
      }

      const retiredLibraryIds = await retireUndesiredPierBoundLibraryCopies({
        projectRoot,
        desiredSkillIds,
        publishedDigestsBySkill,
        manifestSkillIds: args.manifestSkillIds ?? new Set(),
        systemSkillIds: args.systemSkillIds ?? new Set(),
      });
      if (retiredLibraryIds.length > 0) {
        for (const id of retiredLibraryIds) {
          delete desired.publishedContentDigestsBySkillId[id];
        }
        desiredChanged = true;
      }

      if (desiredChanged) {
        desired.generation += 1;
        await writeDesired(args.rootKey, desired);
      }

      return { published, desiredProjections, retiredLibraryIds };
    },
  };
}
