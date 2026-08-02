import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { computeTreeSha256V1 } from "./tree-digest.ts";

/**
 * On-disk facts about managed library content and projection targets,
 * shared by the settings plan, the repair planner and the snapshot builder
 * (design v8 §3.5 drift, §5.1 conflict semantics).
 */

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Single owner of the expected projection link shape: from a delivery root
 * like `.agents/skills` the link climbs one `..` per path segment back to
 * the project root, then into the library. Shared by plan, apply and repair
 * (previously three drifting copies).
 */
export function expectedLinkTargetFor(
  skillId: string,
  deliveryRoot: string
): string {
  const depth = deliveryRoot.split("/").filter(Boolean).length;
  const up = Array.from({ length: depth }, () => "..").join("/");
  return `${up}/.pier/skills/library/${skillId}`;
}

/**
 * Shape of a projection target path: Pier only ever creates relative
 * symlinks into `.pier/skills/library/<id>`, so anything else is a foreign
 * (unmanaged) object that Pier must neither overwrite nor delete.
 */
export type ProjectionTargetShape = "absent" | "pier-symlink" | "foreign";

export async function classifyTargetShape(
  absolutePath: string,
  expectedRelativeLinkTarget: string
): Promise<ProjectionTargetShape> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return "absent";
    throw error;
  }
  if (!stats.isSymbolicLink()) return "foreign";
  try {
    const target = await readlink(absolutePath);
    return target === expectedRelativeLinkTarget ? "pier-symlink" : "foreign";
  } catch {
    return "foreign";
  }
}

/**
 * Library content presence for a manifest entry. Disk content is
 * authoritative — there is no separate "expected" digest baseline, so
 * content drift is no longer a concept. `missing` when the library
 * directory is gone; `present` otherwise. The actual digest is returned
 * for edit-base (content-update TOCTOU) and observed-revision CAS use.
 */
export type LibraryContentState = "present" | "missing";

export interface LibraryContentInspection {
  /** Actual on-disk tree digest, when computable. */
  actualDigest: string | null;
  state: LibraryContentState;
}

export async function inspectLibraryContent(
  projectRoot: string,
  skillId: string
): Promise<LibraryContentInspection> {
  const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
  try {
    await lstat(libraryDir);
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return { state: "missing", actualDigest: null };
    throw error;
  }
  try {
    return {
      state: "present",
      actualDigest: await computeTreeSha256V1(libraryDir),
    };
  } catch {
    // Tree cannot be digested (conflicting or special entries). Disk is
    // still authoritative; return present with no digest so callers that
    // only need presence (missing-source) proceed, and callers that need
    // a digest degrade gracefully.
    return { state: "present", actualDigest: null };
  }
}

export async function inspectLibraryContentState(
  projectRoot: string,
  skillId: string
): Promise<LibraryContentState> {
  const inspection = await inspectLibraryContent(projectRoot, skillId);
  return inspection.state;
}
