import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ProjectRootRef as ContractProjectRootRef,
  skillIdSchema,
} from "../../../shared/contracts/project-skills.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import { assertRealDirectory, isErrno, lstatOrThrow } from "./import-fs.ts";
import {
  type ImportCallerBinding,
  type ImportCandidateView,
  type ImportRiskDelta,
  PROJECT_SKILLS_IMPORT_LIMITS,
  type PrepareFromSource,
  ProjectSkillsImportError,
  type ProjectSkillsImportPaths,
  type ResolveProject,
} from "./import-limits.ts";
import { analyzeLibrarySkill } from "./risk.ts";
import type { ProjectSkillsStore } from "./store.ts";
import { computeTreeSha256V1 } from "./tree-digest.ts";

/** Explicit context for the compose-based prepare functions. */
export interface ImportComposeContext {
  defaultCaller: ImportCallerBinding;
  now: () => number;
  paths: ProjectSkillsImportPaths;
  prepareFromSource: PrepareFromSource;
  resolveProject: ResolveProject;
  store: ProjectSkillsStore;
}

/** Temp compose area for template / content-update sources (outside staging
 * quota accounting; destroyed after candidate creation). */
function composeDir(paths: ProjectSkillsImportPaths, rootKey: string): string {
  return join(
    paths.projectDir(rootKey),
    "compose",
    randomBytes(12).toString("hex")
  );
}

async function libraryDirFor(
  identity: StableProjectIdentity,
  skillId: string
): Promise<string> {
  skillIdSchema.parse(skillId);
  return join(identity.realPath, ".pier", "skills", "library", skillId);
}

async function copyLibraryTree(
  sourceDir: string,
  destDir: string,
  options2?: { skipTopLevel?: ReadonlySet<string> }
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const children = await readdir(sourceDir);
  for (const child of children) {
    if (options2?.skipTopLevel?.has(child)) continue;
    const src = join(sourceDir, child);
    const dst = join(destDir, child);
    const info = await lstat(src);
    if (info.isSymbolicLink()) {
      throw new ProjectSkillsImportError(
        "symlink",
        `library tree must not contain symlinks: ${src}`
      );
    }
    if (info.isDirectory()) {
      await copyLibraryTree(src, dst);
      continue;
    }
    if (!info.isFile()) {
      throw new ProjectSkillsImportError(
        "special-file",
        `library tree has special file: ${src}`
      );
    }
    const bytes = await readFile(src);
    await writeFile(dst, bytes, {
      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
      mode: info.mode & 0o111 ? 0o755 : 0o644,
      flag: "wx",
    });
  }
}

export async function prepareTemplate(
  ctx: ImportComposeContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  args: { skillId: string; description: string },
  caller?: ImportCallerBinding
): Promise<ImportCandidateView> {
  const { identity, rootKey } = await ctx.resolveProject(projectRef);
  const libraryDir = await libraryDirFor(identity, args.skillId);
  try {
    await lstat(libraryDir);
    throw new ProjectSkillsImportError(
      "skill-exists",
      `a managed skill with id ${args.skillId} already exists`
    );
  } catch (error) {
    if (error instanceof ProjectSkillsImportError) throw error;
    if (!isErrno(error, "ENOENT")) throw error;
  }

  const compose = join(composeDir(ctx.paths, rootKey), args.skillId);
  try {
    await mkdir(compose, { recursive: true });
    const description = args.description.replace(/\r?\n/g, " ").trim();
    const template = `---\nname: ${args.skillId}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${args.skillId}\n\n<!-- Describe when and how agents should use this skill. -->\n`;
    await writeFile(join(compose, "SKILL.md"), template, {
      mode: 0o644,
      flag: "wx",
    });
    return await ctx.prepareFromSource({
      identity,
      rootKey,
      sourcePath: compose,
      sourceDisplayPath: `template:${args.skillId}`,
      sourceKind: "local-import",
      caller: caller ?? ctx.defaultCaller,
    });
  } finally {
    await rm(dirname(compose), { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

export async function prepareContentUpdate(
  ctx: ImportComposeContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  args: { skillId: string; baseContentDigest: string; skillMd: string },
  caller?: ImportCallerBinding
): Promise<ImportCandidateView> {
  const { identity, rootKey } = await ctx.resolveProject(projectRef);
  const libraryDir = await libraryDirFor(identity, args.skillId);
  const info = await lstatOrThrow(libraryDir);
  assertRealDirectory(info, libraryDir);

  // Base precondition: the edit must be rooted at the current on-disk
  // content — refuse concurrent library changes (digest mismatch).
  const currentDigest = await computeTreeSha256V1(libraryDir);
  if (currentDigest !== args.baseContentDigest) {
    throw new ProjectSkillsImportError(
      "base-mismatch",
      `library content changed since the edit base for ${args.skillId}`
    );
  }

  const skillMdBytes = Buffer.byteLength(args.skillMd, "utf8");
  if (skillMdBytes > PROJECT_SKILLS_IMPORT_LIMITS.maxFileBytes) {
    throw new ProjectSkillsImportError(
      "file-too-large",
      "edited SKILL.md exceeds the single-file limit"
    );
  }

  // Baseline analysis for the incremental risk view (§3.4.9): the edit base
  // IS the current library content (digest verified above).
  const baseAnalysis = await analyzeLibrarySkill(
    identity.realPath,
    args.skillId
  );

  const compose = join(composeDir(ctx.paths, rootKey), args.skillId);
  try {
    // Compose: current library tree with SKILL.md replaced by the submitted
    // bytes. All import limits re-run inside prepareFromSource.
    await copyLibraryTree(libraryDir, compose, {
      skipTopLevel: new Set(["SKILL.md"]),
    });
    await writeFile(join(compose, "SKILL.md"), args.skillMd, {
      mode: 0o644,
      flag: "wx",
    });
    const candidate = await ctx.prepareFromSource({
      identity,
      rootKey,
      sourcePath: compose,
      sourceDisplayPath: `content-update:${args.skillId}`,
      sourceKind: "content-update",
      caller: caller ?? ctx.defaultCaller,
      base: { skillId: args.skillId, contentDigest: args.baseContentDigest },
    });
    return {
      ...candidate,
      riskDelta: computeRiskDelta(
        baseAnalysis?.riskSummary,
        candidate.riskSummary
      ),
    };
  } finally {
    await rm(dirname(compose), { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

/** New risks relative to the edit base (design §3.4.9). */
function computeRiskDelta(
  base:
    | {
        executables: string[];
        dynamicCommandTraces: string[];
        riskFrontmatter: Record<string, unknown>;
      }
    | undefined,
  next: {
    executables: string[];
    dynamicCommandTraces: string[];
    riskFrontmatter: Record<string, unknown>;
  }
): ImportRiskDelta {
  const baseExecutables = new Set(base?.executables ?? []);
  const baseTraces = new Set(base?.dynamicCommandTraces ?? []);
  const baseKeys = new Set(Object.keys(base?.riskFrontmatter ?? {}));
  return {
    newExecutables: next.executables.filter(
      (entry) => !baseExecutables.has(entry)
    ),
    newDynamicCommandTraces: next.dynamicCommandTraces.filter(
      (entry) => !baseTraces.has(entry)
    ),
    newRiskFrontmatterKeys: Object.keys(next.riskFrontmatter).filter(
      (key) => !baseKeys.has(key)
    ),
  };
}

export async function prepareDriftAcceptance(
  ctx: ImportComposeContext,
  projectRef: ContractProjectRootRef | MainProjectRootRef,
  args: { skillId: string },
  caller?: ImportCallerBinding
): Promise<ImportCandidateView> {
  const { identity, rootKey } = await ctx.resolveProject(projectRef);
  const libraryDir = await libraryDirFor(identity, args.skillId);
  const info = await lstatOrThrow(libraryDir);
  assertRealDirectory(info, libraryDir);
  // Snapshot the CURRENT (drifted) content for integrity adoption; the
  // observed digest becomes the base precondition so any further concurrent
  // change fails the apply (“Use current files”).
  const currentDigest = await computeTreeSha256V1(libraryDir);
  return ctx.prepareFromSource({
    identity,
    rootKey,
    sourcePath: libraryDir,
    sourceDisplayPath: `.pier/skills/library/${args.skillId}`,
    sourceKind: "drift-accepted",
    caller: caller ?? ctx.defaultCaller,
    base: { skillId: args.skillId, contentDigest: currentDigest },
  });
}
