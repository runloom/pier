import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "@main/services/file-path-transaction-lock.ts";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import {
  createProjectSkillsImportService,
  type OpenDirectoryDialog,
  PROJECT_SKILLS_IMPORT_LIMITS,
  ProjectSkillsImportError,
  parseSafeSkillFrontmatter,
} from "@main/services/project-skills/import-service.ts";
import { createProjectSkillsLock } from "@main/services/project-skills/lock.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const CALLER = { webContentsId: 7, clientInstanceId: "test-client" };

let userData: string;
let projectRoot: string;
let externalRoot: string;

async function writeSkillTree(
  base: string,
  files: Record<string, string | { content: string; mode?: number }>
): Promise<void> {
  for (const [relativePath, value] of Object.entries(files)) {
    const absolute = join(base, relativePath);
    await mkdir(join(absolute, ".."), { recursive: true });
    if (typeof value === "string") {
      await writeFile(absolute, value, "utf8");
    } else {
      await writeFile(absolute, value.content, "utf8");
      if (value.mode !== undefined) {
        await chmod(absolute, value.mode);
      }
    }
  }
}

function skillMarkdown(args?: {
  name?: string;
  description?: string;
  extraFrontmatter?: string;
  body?: string;
}): string {
  const name = args?.name ?? "review-guide";
  const description =
    args?.description ?? "Review changes against project rules";
  const extra = args?.extraFrontmatter ? `\n${args.extraFrontmatter}` : "";
  const body = args?.body ?? "# Review guide\n\nDo the review.\n";
  return `---\nname: ${name}\ndescription: ${description}${extra}\n---\n${body}`;
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-ps-import-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-ps-import-proj-"));
  externalRoot = await mkdtemp(join(tmpdir(), "pier-ps-import-ext-"));
});

afterEach(async () => {
  await rm(userData, { force: true, recursive: true });
  await rm(projectRoot, { force: true, recursive: true });
  await rm(externalRoot, { force: true, recursive: true });
});

async function projectRef() {
  const identity = await resolveStableProjectIdentity(projectRoot);
  return toContractProjectRootRef(identity);
}

describe("project-skills import service", () => {
  it("prepareLocalImport returns null when the native dialog is canceled", async () => {
    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: true,
      filePaths: [],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });
    const result = await service.prepareLocalImport(await projectRef(), CALLER);
    expect(result).toBeNull();
  });

  it("copies a local skill tree into staging and returns ImportCandidateView", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown({
        extraFrontmatter: "allowed-tools: Bash, Read",
      }),
      "scripts/check.sh": {
        content: '#!/bin/sh\neval "$1"\n',
        mode: 0o755,
      },
      "references/a.md": "ref\n",
    });

    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });

    const candidate = await service.prepareLocalImport(
      await projectRef(),
      CALLER
    );
    expect(candidate).not.toBeNull();
    if (!candidate) throw new Error("expected candidate");

    expect(candidate.skillId).toBe("review-guide");
    expect(candidate.name).toBe("review-guide");
    expect(candidate.sourceKind).toBe("local-import");
    expect(candidate.sourceDisplayPath).toBe(source);
    expect(candidate.contentDigest).toMatch(DIGEST_RE);
    expect(candidate.riskFingerprint).toMatch(DIGEST_RE);
    expect(candidate.fileCount).toBe(3);
    expect(candidate.totalBytes).toBeGreaterThan(0);
    expect(candidate.directorySummary.skillMd).toBe(true);
    expect(candidate.directorySummary.scripts).toBe(1);
    expect(candidate.directorySummary.references).toBe(1);
    expect(candidate.riskSummary.executables).toEqual(["scripts/check.sh"]);
    expect(candidate.riskSummary.dynamicCommandTraces.length).toBeGreaterThan(
      0
    );
    expect(candidate.riskSummary.riskFrontmatter["allowed-tools"]).toBe(
      "Bash, Read"
    );
    expect(candidate.skillMdPreview).toContain("# Review guide");
    expect(candidate.skillMdTruncated).toBe(false);
    expect(candidate.token.length).toBeGreaterThanOrEqual(32);
    expect(candidate.expiresAt).toBeGreaterThan(Date.now());

    const staged = service.resolveStagingTreePath(candidate.token);
    expect(staged).toBeTruthy();
    if (!staged) throw new Error("expected staged path");
    const stagedDigest = await computeTreeSha256V1(staged);
    expect(stagedDigest).toBe(candidate.contentDigest);
    expect(await readFile(join(staged, "SKILL.md"), "utf8")).toContain(
      "Review changes"
    );
    const scriptStat = await stat(join(staged, "scripts/check.sh"));
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
    expect((scriptStat.mode & 0o111) !== 0).toBe(true);
  });

  it("rejects local import sources under .pier/skills", async () => {
    const banned = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "review-guide"
    );
    await writeSkillTree(banned, {
      "SKILL.md": skillMarkdown(),
    });
    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [banned],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });
    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toMatchObject({ code: "source-not-allowed" });
  });

  it("rejects skill trees that contain symlinks", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
    });
    await symlink("/tmp", join(source, "out-link"));

    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });

    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toBeInstanceOf(ProjectSkillsImportError);
    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toMatchObject({ code: "symlink" });
  });

  it("prepareFromDiscovery copies a real unmanaged discovery directory", async () => {
    const source = join(projectRoot, ".agents", "skills", "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
      "assets/icon.txt": "x",
    });

    const service = createProjectSkillsImportService({
      userData,
      defaultCaller: CALLER,
    });
    const candidate = await service.prepareFromDiscovery(
      await projectRef(),
      ".agents/skills/review-guide",
      CALLER
    );

    expect(candidate.sourceKind).toBe("project-discovery-import");
    expect(candidate.sourceDisplayPath).toBe(".agents/skills/review-guide");
    expect(candidate.skillId).toBe("review-guide");
    expect(candidate.directorySummary.assets).toBe(1);
    expect(candidate.contentDigest).toMatch(DIGEST_RE);

    // Source remains intact (copy only).
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toContain("name:");
    const staged = service.resolveStagingTreePath(candidate.token);
    expect(staged).toBeTruthy();
    if (!staged) throw new Error("expected staged");
    expect(await readFile(join(staged, "assets/icon.txt"), "utf8")).toBe("x");
  });

  it("prepareFromDiscovery rejects symlink sources and managed projections", async () => {
    const library = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "review-guide"
    );
    await writeSkillTree(library, {
      "SKILL.md": skillMarkdown(),
    });
    const agentsSkills = join(projectRoot, ".agents", "skills");
    await mkdir(agentsSkills, { recursive: true });
    await symlink(
      "../../.pier/skills/library/review-guide",
      join(agentsSkills, "review-guide")
    );

    const service = createProjectSkillsImportService({
      userData,
      defaultCaller: CALLER,
    });

    await expect(
      service.prepareFromDiscovery(
        await projectRef(),
        ".agents/skills/review-guide",
        CALLER
      )
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(symlink|managed-projection)$/),
    });
  });

  it("destroys staging and throws source-changed when source mutates between traversals", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
      "notes.md": "v1\n",
    });

    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
      afterFirstTraversal: async (sourcePath) => {
        await writeFile(join(sourcePath, "notes.md"), "v2-changed\n", "utf8");
      },
    });

    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toMatchObject({ code: "source-changed" });

    // Exact provisional staging must be destroyed; no durable candidate published.
    const store = createProjectSkillsStore({ userData });
    let stagingNames: string[] = [];
    try {
      stagingNames = await readdir(paths.stagingDir(rootKey));
    } catch {
      stagingNames = [];
    }
    for (const name of stagingNames) {
      if (name.endsWith(".json")) {
        const token = name.slice(0, -".json".length);
        await expect(store.readCandidate(rootKey, token)).resolves.toBeNull();
      }
    }
    // No leftover tree directories either.
    expect(stagingNames.filter((n) => !n.endsWith(".json"))).toEqual([]);
  });

  it("enforces per-file size quota", async () => {
    const source = join(externalRoot, "review-guide");
    const big = "x".repeat(PROJECT_SKILLS_IMPORT_LIMITS.maxFileBytes + 1);
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
      "big.bin": big,
    });
    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });
    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toMatchObject({ code: "file-too-large" });
  });

  it("enforces max directory depth", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
    });
    let nested = source;
    for (let i = 0; i < PROJECT_SKILLS_IMPORT_LIMITS.maxDepth + 2; i += 1) {
      nested = join(nested, `d${i}`);
    }
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "leaf.txt"), "x\n");

    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });
    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toMatchObject({ code: "depth-exceeded" });
  });

  it("discardImport is idempotent and removes AVAILABLE staging", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, {
      "SKILL.md": skillMarkdown(),
    });
    const showOpenDialog: OpenDirectoryDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog,
      defaultCaller: CALLER,
    });
    const ref = await projectRef();
    const candidate = await service.prepareLocalImport(ref, CALLER);
    expect(candidate).not.toBeNull();
    if (!candidate) throw new Error("expected candidate");

    const staged = service.resolveStagingTreePath(candidate.token);
    expect(staged).toBeTruthy();

    await service.discardImport(ref, candidate.token, CALLER);
    expect(service.resolveStagingTreePath(candidate.token)).toBeNull();

    const store = createProjectSkillsStore({ userData });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    await expect(
      store.readCandidate(rootKey, candidate.token)
    ).resolves.toBeNull();

    // Idempotent second discard
    await expect(
      service.discardImport(ref, candidate.token, CALLER)
    ).resolves.toBeUndefined();
    await expect(
      service.discardImport(ref, "missing-token-xxxxxxxx", CALLER)
    ).resolves.toBeUndefined();
  });

  it("serializes discard with candidate claim and preserves claimed staging", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, { "SKILL.md": skillMarkdown() });
    const store = createProjectSkillsStore({ userData });
    const lock = createProjectSkillsLock({
      transactionLock: new FilePathTransactionLock(),
      sharedLockRoot: join(userData, "shared-locks"),
    });
    const service = createProjectSkillsImportService({
      userData,
      lock,
      store,
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: [source],
      }),
      defaultCaller: CALLER,
    });
    const ref = await projectRef();
    const candidate = await service.prepareLocalImport(ref, CALLER);
    if (!candidate) throw new Error("expected candidate");
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const release = Promise.withResolvers<void>();
    const claimed = Promise.withResolvers<void>();
    const holder = lock.runExclusive(
      identity,
      [projectRoot, paths.projectDir(rootKey)],
      async () => {
        await store.claimCandidate(rootKey, candidate.token, "claim-op");
        claimed.resolve();
        await release.promise;
      }
    );
    await claimed.promise;

    const discard = service.discardImport(ref, candidate.token, CALLER);
    release.resolve();
    await Promise.all([holder, discard]);

    await expect(
      store.readCandidate(rootKey, candidate.token)
    ).resolves.toEqual(
      expect.objectContaining({ state: "CLAIMED", operationId: "claim-op" })
    );
    const staged = service.resolveStagingTreePath(candidate.token);
    if (!staged) throw new Error("expected staging binding");
    expect((await stat(staged)).isDirectory()).toBe(true);
  });

  it("cleans the record, final tree, and binding after post-create failure", async () => {
    const source = join(externalRoot, "review-guide");
    await writeSkillTree(source, { "SKILL.md": skillMarkdown() });
    let issuedToken = "";
    const service = createProjectSkillsImportService({
      userData,
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: [source],
      }),
      defaultCaller: CALLER,
      afterCandidateCreated: async (token) => {
        issuedToken = token;
        throw new Error("injected post-create failure");
      },
    });

    await expect(
      service.prepareLocalImport(await projectRef(), CALLER)
    ).rejects.toThrow("injected post-create failure");

    expect(issuedToken).not.toBe("");
    expect(service.resolveStagingTreePath(issuedToken)).toBeNull();
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    const store = createProjectSkillsStore({ userData });
    await expect(store.readCandidate(rootKey, issuedToken)).resolves.toBeNull();
    await expect(
      stat(join(paths.stagingDir(rootKey), issuedToken))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("parseSafeSkillFrontmatter", () => {
  it("parses plain mappings and rejects anchors/tags", () => {
    const ok = parseSafeSkillFrontmatter(
      "---\nname: review-guide\ndescription: hi\nallowed-tools: Bash\n---\nBody\n"
    );
    expect(ok.frontmatter.name).toBe("review-guide");
    expect(ok.frontmatter["allowed-tools"]).toBe("Bash");
    expect(ok.body).toBe("Body\n");

    expect(() =>
      parseSafeSkillFrontmatter("---\nname: &x foo\n---\n")
    ).toThrowError(ProjectSkillsImportError);

    expect(() =>
      parseSafeSkillFrontmatter("---\nname: !!js/function 'x'\n---\n")
    ).toThrowError(ProjectSkillsImportError);
  });
});
