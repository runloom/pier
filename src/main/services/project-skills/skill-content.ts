import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  ProjectRootRef as ContractProjectRootRef,
  SkillContentRef,
  SkillContentResult,
} from "../../../shared/contracts/project-skills.ts";
import { skillIdSchema } from "../../../shared/contracts/project-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listProjectDiscoveryRoots,
  listUserSkillRoots,
  type SkillDiscoveryAdapterRegistry,
} from "./adapters.ts";
import { expandUserRoot } from "./enumeration.ts";
import {
  type ProjectRootRef as MainProjectRootRef,
  resolveStableProjectIdentity,
} from "./identity.ts";

/**
 * Read-only SKILL.md content access for the unified list detail views and
 * the managed editor prefill (industry reference: Cursor opens the skill
 * file read-only; Claude Code shows skill info from the file).
 *
 * Trust boundary: refs never carry paths — roots are re-validated against
 * the registry whitelists, directory names must be plain child names, and
 * the read is size-capped. Display only; content is not re-hashed here.
 */

export const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;

export class SkillContentReadError extends Error {
  readonly code: "invalid-ref" | "not-found";

  constructor(code: "invalid-ref" | "not-found", message: string) {
    super(message);
    this.name = "SkillContentReadError";
    this.code = code;
  }
}

function assertPlainChildName(name: string): void {
  if (
    !name ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    throw new SkillContentReadError(
      "invalid-ref",
      `invalid skill directory name: ${name}`
    );
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || !(rel.startsWith("..") || isAbsolute(rel));
}

/** Size-capped UTF-8 read; follows the final symlinked SKILL.md if any. */
async function readSkillMdCapped(dir: string): Promise<SkillContentResult> {
  const filePath = join(dir, "SKILL.md");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch {
    throw new SkillContentReadError(
      "not-found",
      "SKILL.md not found for the requested skill"
    );
  }
  try {
    const info = await handle.stat();
    const size = Number(info.size);
    const truncated = size > SKILL_CONTENT_MAX_BYTES;
    const length = Math.min(size, SKILL_CONTENT_MAX_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { skillMd: buffer.toString("utf8"), truncated };
  } finally {
    await handle.close();
  }
}

export async function readSkillContent(args: {
  projectRef: ContractProjectRootRef | MainProjectRootRef;
  ref: SkillContentRef;
  registry?: SkillDiscoveryAdapterRegistry;
  homeDir?: string;
}): Promise<SkillContentResult> {
  const registry = args.registry ?? createSkillDiscoveryAdapterRegistry();
  const claimedPath =
    "identity" in args.projectRef
      ? args.projectRef.identity.realPath
      : args.projectRef.realPath;
  const live = await resolveStableProjectIdentity(claimedPath);

  if (args.ref.kind === "managed") {
    skillIdSchema.parse(args.ref.skillId);
    const dir = join(
      live.realPath,
      ".pier",
      "skills",
      "library",
      args.ref.skillId
    );
    return await readSkillMdCapped(dir);
  }

  if (args.ref.kind === "project") {
    if (!listProjectDiscoveryRoots(registry).includes(args.ref.root)) {
      throw new SkillContentReadError(
        "invalid-ref",
        `project root is not a known discovery root: ${args.ref.root}`
      );
    }
    assertPlainChildName(args.ref.directoryName);
    const dir = join(
      live.realPath,
      ...args.ref.root.split("/"),
      args.ref.directoryName
    );
    if (!isPathInside(live.realPath, dir)) {
      throw new SkillContentReadError("invalid-ref", "path escapes project");
    }
    return await readSkillMdCapped(dir);
  }

  // user-global
  const ref = args.ref;
  const whitelist = listUserSkillRoots(registry);
  if (!whitelist.some((entry) => entry.root === ref.root)) {
    throw new SkillContentReadError(
      "invalid-ref",
      `user root is not whitelisted: ${ref.root}`
    );
  }
  assertPlainChildName(ref.directoryName);
  const home = args.homeDir ?? homedir();
  const dir = join(expandUserRoot(ref.root, home), ref.directoryName);
  return await readSkillMdCapped(dir);
}
