import {
  type ProjectRootRef as ContractProjectRootRef,
  skillIdSchema,
} from "../../../shared/contracts/project-skills.ts";
import {
  createSkillDiscoveryAdapterRegistry,
  listProjectDiscoveryRoots,
} from "./adapters.ts";
import type {
  ProjectRootRef as MainProjectRootRef,
  StableProjectIdentity,
} from "./identity.ts";
import type { ProjectSkillsLock } from "./lock.ts";
import type { createProjectSkillsPaths } from "./paths.ts";
import type { ProjectSkillsStore } from "./store.ts";

/** Design §6.1 default import limits. */
export const PROJECT_SKILLS_IMPORT_LIMITS = {
  maxFiles: 2000,
  maxDepth: 32,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxPathBytes: 1024,
  stagingQuotaBytes: 512 * 1024 * 1024,
  tokenTtlMs: 30 * 60 * 1000,
  frontmatterMaxBytes: 64 * 1024,
  frontmatterMaxDepth: 16,
} as const;

/**
 * Known project discovery roots (relative to project root).
 * Registry-derived — the adapter registry is the single fact source.
 */
export const PROJECT_SKILLS_DISCOVERY_ROOTS: readonly string[] =
  listProjectDiscoveryRoots(createSkillDiscoveryAdapterRegistry());

export type ImportSourceKind =
  | "local-import"
  | "project-discovery-import"
  | "content-update"
  | "drift-accepted";

export interface ImportCallerBinding {
  clientInstanceId: string;
  webContentsId: number;
}

export interface ImportDirectorySummary {
  assets: number;
  otherFiles: number;
  references: number;
  scripts: number;
  skillMd: boolean;
}

export interface ImportRiskSummary {
  dynamicCommandTraces: string[];
  executables: string[];
  riskFrontmatter: Record<string, unknown>;
}

/**
 * Incremental risk vs the currently recorded content: only present on
 * content-update candidates. Drift adoption and fresh imports have no
 * previous version suitable for comparison.
 */
export interface ImportRiskDelta {
  newDynamicCommandTraces: string[];
  newExecutables: string[];
  newRiskFrontmatterKeys: string[];
}

/**
 * Renderer-safe import candidate (design §3.6 ImportCandidateView).
 * Absolute staging paths and raw unfiltered frontmatter are intentionally omitted.
 */
export interface ImportCandidateView {
  /** Content-update candidates only: precondition base (design v8 §6.1). */
  baseContentDigest?: string;
  contentDigest: string;
  description: string;
  directorySummary: ImportDirectorySummary;
  expiresAt: number;
  fileCount: number;
  name: string;
  /** Content-update only: risks added relative to the edit base (§3.4.9). */
  riskDelta?: ImportRiskDelta;
  riskFingerprint: string;
  riskSummary: ImportRiskSummary;
  skillId: string;
  /** Read-only SKILL.md preview shown before the user adds the skill. */
  skillMdPreview?: string;
  skillMdTruncated?: boolean;
  /** Display-only source path chosen by the user / relative discovery path. */
  sourceDisplayPath: string;
  sourceKind: ImportSourceKind;
  token: string;
  totalBytes: number;
}

export type ProjectSkillsImportErrorCode =
  | "source-changed"
  | "symlink"
  | "hardlink"
  | "special-file"
  | "quota-exceeded"
  | "path-escape"
  | "invalid-skill"
  | "source-not-allowed"
  | "not-directory"
  | "managed-projection"
  | "depth-exceeded"
  | "file-too-large"
  | "too-many-files"
  | "total-too-large"
  | "path-too-long"
  | "frontmatter-invalid"
  | "identity-mismatch"
  | "invalid-relative-source"
  | "base-mismatch"
  | "skill-exists"
  | "token-expired";

export class ProjectSkillsImportError extends Error {
  readonly code: ProjectSkillsImportErrorCode;

  constructor(
    code: ProjectSkillsImportErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ProjectSkillsImportError";
    this.code = code;
  }
}

export interface OpenDirectoryDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export type OpenDirectoryDialog = () => Promise<OpenDirectoryDialogResult>;

export interface ProjectSkillsImportService {
  discardImport(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    token: string,
    caller?: ImportCallerBinding
  ): Promise<void>;
  /**
   * Content-update candidate from renderer-submitted SKILL.md bytes
   * (design v8 §6.1): main verifies the on-disk library digest equals
   * `baseContentDigest`, composes new tree = current library with SKILL.md
   * replaced, re-runs all import limits, recomputes digests/risk.
   */
  prepareContentUpdate(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string; baseContentDigest: string; skillMd: string },
    caller?: ImportCallerBinding
  ): Promise<ImportCandidateView>;
  /**
   * Drift acceptance candidate (design v9 §6.2): snapshots CURRENT drifted
   * library content for integrity adoption. Base digest is the observed
   * drifted digest so apply refuses further concurrent change.
   */
  prepareDriftAcceptance(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string },
    caller?: ImportCallerBinding
  ): Promise<ImportCandidateView>;
  prepareFromDiscovery(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    relativeSource: string,
    caller?: ImportCallerBinding
  ): Promise<ImportCandidateView>;
  prepareLocalImport(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    caller?: ImportCallerBinding,
    globalSource?: { root: string; directoryName: string }
  ): Promise<ImportCandidateView | null>;
  /** New blank managed skill from a template (design v8 §7.5). */
  prepareTemplate(
    projectRef: ContractProjectRootRef | MainProjectRootRef,
    args: { skillId: string; description: string },
    caller?: ImportCallerBinding
  ): Promise<ImportCandidateView>;
  /** Test / apply helper: absolute path of staged tree for a live token. */
  resolveStagingTreePath(token: string): string | null;
}

export interface CreateProjectSkillsImportServiceOptions {
  /** Test seam: invoked after the durable candidate record is created. */
  afterCandidateCreated?: (token: string) => Promise<void>;
  /**
   * Test seam: invoked after the first source traversal and staging materialize,
   * before the second consistency traversal.
   */
  afterFirstTraversal?: (sourcePath: string) => Promise<void>;
  /** Default caller binding when prepare/discard omit one (tests). */
  defaultCaller?: ImportCallerBinding;
  /** Shared project lock; required by production wiring. */
  lock?: ProjectSkillsLock;
  now?: () => number;
  showOpenDialog?: OpenDirectoryDialog;
  store?: ProjectSkillsStore;
  userData: string;
}

/** Path helpers shape shared by the import service internals. */
export type ProjectSkillsImportPaths = ReturnType<
  typeof createProjectSkillsPaths
>;

/** Args of the service-internal source-to-candidate pipeline. */
export interface PrepareFromSourceArgs {
  /** Content-update / drift-acceptance base precondition. */
  base?: { skillId: string; contentDigest: string };
  caller: ImportCallerBinding;
  identity: StableProjectIdentity;
  rootKey: string;
  sourceDisplayPath: string;
  sourceKind: ImportSourceKind;
  sourcePath: string;
}

export type PrepareFromSource = (
  args: PrepareFromSourceArgs
) => Promise<ImportCandidateView>;

export type ResolveProject = (
  projectRef: ContractProjectRootRef | MainProjectRootRef
) => Promise<{ identity: StableProjectIdentity; rootKey: string }>;

export function treeDigestErrorCode(
  code: string
): ProjectSkillsImportErrorCode {
  if (code === "symlink" || code === "hardlink" || code === "special-file") {
    return code;
  }
  return "invalid-skill";
}

export function buildDirectorySummary(
  treeFiles: readonly { relativePath: string }[]
): ImportDirectorySummary {
  let skillMd = false;
  let scripts = 0;
  let references = 0;
  let assets = 0;
  let otherFiles = 0;
  for (const file of treeFiles) {
    const p = file.relativePath;
    if (p === "SKILL.md") {
      skillMd = true;
      continue;
    }
    if (p === "scripts" || p.startsWith("scripts/")) {
      scripts += 1;
      continue;
    }
    if (p === "references" || p.startsWith("references/")) {
      references += 1;
      continue;
    }
    if (p === "assets" || p.startsWith("assets/")) {
      assets += 1;
      continue;
    }
    otherFiles += 1;
  }
  return { skillMd, scripts, references, assets, otherFiles };
}

export function extractRiskSummary(
  treeFiles: { relativePath: string; executable: boolean; bytes: Buffer }[],
  frontmatter: Record<string, unknown>
): ImportRiskSummary {
  // Reuse fingerprint internals via public API side-channel: recompute fields.
  const executables = treeFiles
    .filter((f) => f.executable)
    .map((f) => f.relativePath)
    .sort();
  // dynamic traces are embedded in fingerprint; re-scan for view
  const dynamicCommandTraces: string[] = [];
  const patterns: RegExp[] = [
    /\beval\b/i,
    /\$\(/,
    /`[^`]+`/,
    /\$\{/,
    /\bsource\b/i,
    /\bbash\s+-c\b/i,
    /\bsh\s+-c\b/i,
    /\bzsh\s+-c\b/i,
    /\bcurl\b/i,
    /\bwget\b/i,
    /\/dev\/(tcp|udp)\//i,
    /\bchmod\s+\+x\b/i,
    /\bos\.system\b/i,
    /\bchild_process\b/i,
    /\bexec(?:File|Sync)?\s*\(/i,
  ];
  for (const file of treeFiles) {
    const text = file.bytes.toString("utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        dynamicCommandTraces.push(`${file.relativePath}:${pattern.source}`);
      }
    }
  }
  dynamicCommandTraces.sort();

  const riskKeys: Record<string, true> = {
    "allowed-tools": true,
    allowedTools: true,
    tools: true,
    "disable-model-invocation": true,
    disableModelInvocation: true,
    context: true,
    hooks: true,
    permissions: true,
  };
  const riskFrontmatter: Record<string, unknown> = {};
  for (const key of Object.keys(frontmatter).sort()) {
    if (riskKeys[key]) riskFrontmatter[key] = frontmatter[key];
  }

  return { executables, dynamicCommandTraces, riskFrontmatter };
}

export function validateSkillMetadata(args: {
  directoryName: string;
  frontmatter: Record<string, unknown>;
}): { skillId: string; name: string; description: string } {
  const skillIdParse = skillIdSchema.safeParse(args.directoryName);
  if (!skillIdParse.success) {
    throw new ProjectSkillsImportError(
      "invalid-skill",
      `directory name is not a valid skill id: ${args.directoryName}`
    );
  }
  const skillId = skillIdParse.data;
  const nameRaw = args.frontmatter.name;
  const descriptionRaw = args.frontmatter.description;
  if (typeof nameRaw !== "string" || nameRaw.length === 0) {
    throw new ProjectSkillsImportError(
      "invalid-skill",
      "SKILL.md frontmatter must include string name"
    );
  }
  if (nameRaw !== skillId) {
    throw new ProjectSkillsImportError(
      "invalid-skill",
      `SKILL.md name "${nameRaw}" must match directory id "${skillId}"`
    );
  }
  if (typeof descriptionRaw !== "string" || descriptionRaw.length === 0) {
    throw new ProjectSkillsImportError(
      "invalid-skill",
      "SKILL.md frontmatter must include string description"
    );
  }
  if (descriptionRaw.length > 1024) {
    throw new ProjectSkillsImportError(
      "invalid-skill",
      "description must be at most 1024 characters"
    );
  }
  return { skillId, name: nameRaw, description: descriptionRaw };
}
