import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentRulesServiceError,
  createAgentRulesService,
  RULES_MAX_BYTES,
} from "@main/services/agent-rules/service.ts";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createAgentRulesService", () => {
  let tempDir: string;
  let projectRoot: string;
  let userDataPath: string;
  let registeredRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-rules-"));
    userDataPath = join(tempDir, "userData");
    projectRoot = join(tempDir, "project");
    await mkdir(userDataPath, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    registeredRoot = await realpath(projectRoot);
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  function makeService(
    kindFor?: (path: string) => "project" | "pier-home" | null
  ) {
    const pierHome = createPierHomeService({ userDataPath });
    return {
      pierHome,
      rules: createAgentRulesService({
        pierHome,
        localEnvironments: {
          getProjectKind: async (path: string) => {
            if (kindFor) return kindFor(path);
            return path === registeredRoot ? "project" : null;
          },
        } as Parameters<typeof createAgentRulesService>[0]["localEnvironments"],
      }),
    };
  }

  it("snapshots missing files and ensures AGENTS.md", async () => {
    const { rules } = makeService();
    const root = {
      scope: "project" as const,
      projectRootPath: registeredRoot,
    };
    const snap = await rules.snapshot(root);
    expect(snap.files.map((f) => f.state)).toEqual([
      "missing",
      "missing",
      "missing",
      "missing",
    ]);

    const after = await rules.ensure(root, "agents-md");
    const agents = after.files.find((f) => f.id === "agents-md");
    expect(agents?.state).toBe("file");
    const content = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("AGENTS.md");
  });

  it("writes and reads under size limit", async () => {
    const { rules } = makeService();
    const root = {
      scope: "project" as const,
      projectRootPath: registeredRoot,
    };
    await rules.ensure(root, "claude-md");
    await rules.write(root, "claude-md", "# hello\n");
    const read = await rules.read(root, "claude-md");
    expect(read.content).toBe("# hello\n");
    expect(read.truncated).toBe(false);
  });

  it("rejects ensure and write-create for .cursor/rules", async () => {
    const { rules } = makeService();
    const root = {
      scope: "project" as const,
      projectRootPath: registeredRoot,
    };
    await expect(rules.ensure(root, "cursor-rules")).rejects.toMatchObject({
      reason: "ensure_unsupported",
    } satisfies Partial<AgentRulesServiceError>);
    await expect(rules.write(root, "cursor-rules", "x")).rejects.toMatchObject({
      reason: "not_found",
    });

    await mkdir(join(projectRoot, ".cursor", "rules"), { recursive: true });
    const snap = await rules.snapshot(root);
    expect(snap.files.find((f) => f.id === "cursor-rules")?.state).toBe(
      "directory"
    );
    await expect(rules.write(root, "cursor-rules", "x")).rejects.toMatchObject({
      reason: "not_a_file",
    });
  });

  it("rejects pier-home impersonation and unregistered roots", async () => {
    const { pierHome, rules } = makeService();
    const home = await pierHome.ensure();
    await expect(
      rules.snapshot({
        scope: "project",
        projectRootPath: home.rootPath,
      })
    ).rejects.toMatchObject({ reason: "forbidden" });

    const stranger = join(tempDir, "stranger");
    await mkdir(stranger, { recursive: true });
    await expect(
      rules.snapshot({
        scope: "project",
        projectRootPath: await realpath(stranger),
      })
    ).rejects.toMatchObject({ reason: "forbidden" });

    const homeSnap = await rules.snapshot({ scope: "home" });
    expect(homeSnap.scope).toBe("home");
    expect(homeSnap.rootPath).toBe(home.rootPath);
  });

  it("rejects oversized writes and writing truncated on-disk files", async () => {
    const { rules } = makeService();
    const root = {
      scope: "project" as const,
      projectRootPath: registeredRoot,
    };
    await writeFile(join(projectRoot, "GEMINI.md"), "seed", "utf8");
    const huge = "x".repeat(RULES_MAX_BYTES + 1);
    await expect(rules.write(root, "gemini-md", huge)).rejects.toMatchObject({
      reason: "too_large",
    });

    await writeFile(join(projectRoot, "GEMINI.md"), huge, "utf8");
    const truncated = await rules.read(root, "gemini-md");
    expect(truncated.truncated).toBe(true);
    await expect(
      rules.write(root, "gemini-md", truncated.content)
    ).rejects.toMatchObject({ reason: "too_large" });
  });

  it("rejects path escape when mapped file is a symlink outside root", async () => {
    const { rules } = makeService();
    const outside = join(tempDir, "outside-agents.md");
    await writeFile(outside, "leaked", "utf8");
    const agentsPath = join(projectRoot, "AGENTS.md");
    await writeFile(agentsPath, "seed", "utf8");
    await rm(agentsPath);
    await symlink(outside, agentsPath);
    const root = {
      scope: "project" as const,
      projectRootPath: registeredRoot,
    };
    // Snapshot treats bare symlink as non-file; write/read via identity must refuse escape.
    await expect(rules.read(root, "agents-md")).rejects.toMatchObject({
      reason: "not_a_file",
    });
    await expect(rules.write(root, "agents-md", "nope")).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("treats intermediate directory symlink escape as other", async () => {
    const { rules } = makeService();
    const outsideDir = join(tempDir, "outside-cursor");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "rules"), "escaped", "utf8");
    await symlink(outsideDir, join(projectRoot, ".cursor"));
    const snap = await rules.snapshot({
      scope: "project",
      projectRootPath: registeredRoot,
    });
    expect(snap.files.find((f) => f.id === "cursor-rules")?.state).toBe(
      "other"
    );
  });
});
