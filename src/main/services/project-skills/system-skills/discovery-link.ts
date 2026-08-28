import { randomUUID } from "node:crypto";
import { lstat, readlink, rename, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createProjectSkillsFileSystemAdapter } from "../fs-adapter.ts";
import type { FsObjectIdentity } from "../fs-adapter-types.ts";
import { defaultRenameExclusive } from "../fs-rename-exclusive.ts";
import { isPathInside } from "../import/fs.ts";
import { expectedLinkTargetFor } from "../library-state.ts";
import { ensureProjectRelativeDir } from "../path-containment.ts";
import { systemSkillCacheDir } from "./cache.ts";

export type SystemSkillDiscoveryLinkResult =
  | {
      identity: FsObjectIdentity;
      status: "created" | "replaced" | "unchanged";
    }
  | {
      reason: "foreign" | "parent-invalid" | "target-invalid";
      status: "conflict";
    };

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function sameIdentity(
  left: FsObjectIdentity,
  right: FsObjectIdentity
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.isSymbolicLink === right.isSymbolicLink &&
    left.isDirectory === right.isDirectory
  );
}

export function legacySystemSkillLibraryLinkTarget(skillId: string): string {
  return expectedLinkTargetFor(skillId, ".agents/skills");
}

function assertCacheTarget(args: {
  cacheDir: string;
  skillId: string;
  userData: string;
}): string {
  const expected = resolve(systemSkillCacheDir(args.userData, args.skillId));
  const actual = resolve(args.cacheDir);
  if (actual !== expected) {
    throw new Error(
      `system skill cache dir mismatch: ${actual} !== ${expected}`
    );
  }
  if (!(isAbsolute(actual) && isPathInside(expected, actual))) {
    throw new Error(`system skill cache dir escapes home cache: ${actual}`);
  }
  return actual;
}

async function readLinkIdentity(linkPath: string): Promise<FsObjectIdentity> {
  return await createProjectSkillsFileSystemAdapter().lstatIdentity(linkPath);
}

/**
 * Publish `.agents/skills/<id>` (or `.claude/...`) as a directory symlink to
 * `{systemSkillsCacheRoot}/<id>`(宿主注入 `~/.pier/system-skills`,跨 build
 * 稳定). Replaces only owned links or owned legacy library-relative links.
 * Never overwrites unowned objects.
 */
export async function publishSystemSkillDiscoveryLink(args: {
  cacheDir: string;
  owned?: {
    expectedRelativeLinkTarget: string;
    identity: FsObjectIdentity;
  } | null;
  projectRoot: string;
  relativeTarget: string;
  skillId: string;
  userData: string;
}): Promise<SystemSkillDiscoveryLinkResult> {
  let cacheDir: string;
  try {
    cacheDir = assertCacheTarget({
      cacheDir: args.cacheDir,
      skillId: args.skillId,
      userData: args.userData,
    });
  } catch {
    return { reason: "target-invalid", status: "conflict" };
  }

  const projectRoot = resolve(args.projectRoot);
  const linkPath = resolve(projectRoot, ...args.relativeTarget.split("/"));
  const relFromRoot = relative(projectRoot, linkPath);
  if (
    relFromRoot.length === 0 ||
    relFromRoot.startsWith(`..${sep}`) ||
    relFromRoot === ".." ||
    isAbsolute(relFromRoot)
  ) {
    return { reason: "parent-invalid", status: "conflict" };
  }

  const parentRel = dirname(args.relativeTarget);
  try {
    await ensureProjectRelativeDir(projectRoot, parentRel);
  } catch {
    return { reason: "parent-invalid", status: "conflict" };
  }

  const legacy = legacySystemSkillLibraryLinkTarget(args.skillId);
  try {
    const info = await lstat(linkPath);
    if (!info.isSymbolicLink()) {
      return { reason: "foreign", status: "conflict" };
    }
    const current = await readlink(linkPath);
    if (current === cacheDir) {
      return {
        identity: await readLinkIdentity(linkPath),
        status: "unchanged",
      };
    }
    const owned = args.owned ?? null;
    if (!owned) {
      return { reason: "foreign", status: "conflict" };
    }
    const live = await readLinkIdentity(linkPath);
    const ownedLive = sameIdentity(owned.identity, live);
    const legacyOwned =
      ownedLive &&
      (current === legacy || owned.expectedRelativeLinkTarget === legacy);
    const liveOwnedMatchingLedger =
      ownedLive && owned.expectedRelativeLinkTarget === current;
    if (!(legacyOwned || liveOwnedMatchingLedger)) {
      return { reason: "foreign", status: "conflict" };
    }
    return await replaceLink(linkPath, cacheDir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }
  return await createLink(linkPath, cacheDir);
}

async function createLink(
  linkPath: string,
  cacheDir: string
): Promise<SystemSkillDiscoveryLinkResult> {
  const temporaryPath = join(
    dirname(linkPath),
    `.pier-system-skill-link-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    await symlink(cacheDir, temporaryPath);
    try {
      await defaultRenameExclusive(temporaryPath, linkPath);
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        return { reason: "foreign", status: "conflict" };
      }
      throw error;
    }
    return { identity: await readLinkIdentity(linkPath), status: "created" };
  } finally {
    await rm(temporaryPath, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

async function replaceLink(
  linkPath: string,
  cacheDir: string
): Promise<SystemSkillDiscoveryLinkResult> {
  const temporaryPath = join(
    dirname(linkPath),
    `.pier-system-skill-link-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    await symlink(cacheDir, temporaryPath);
    await rename(temporaryPath, linkPath);
    return { identity: await readLinkIdentity(linkPath), status: "replaced" };
  } finally {
    await rm(temporaryPath, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}
