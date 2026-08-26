import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryReconciler } from "@main/services/agent-managed-assets/reconcile.ts";
import { createAgentRulesService } from "@main/services/agent-rules/service.ts";
import { FilePathTransactionLock } from "@main/services/files/path-transaction-lock.ts";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-mem-rec-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return realpathSync(dir);
}

function makeReconciler(root: string, opts?: { tracked?: boolean }) {
  const userDataPath = join(root, ".pier-test-userdata");
  mkdirSync(userDataPath, { recursive: true });
  const pierHome = createPierHomeService({ userDataPath });
  return new MemoryReconciler({
    agentRules: createAgentRulesService({
      localEnvironments: {
        getProjectKind: async (path: string) =>
          path === root ? "project" : null,
      } as Parameters<typeof createAgentRulesService>[0]["localEnvironments"],
      pierHome,
    }),
    baseDir: join(root, ".pier-test-base"),
    isTracked: async () => opts?.tracked ?? false,
    listInstalledAgents: async () => ["claude", "omp"],
    lock: new FilePathTransactionLock(),
  });
}

describe("MemoryReconciler", () => {
  it("enable writes one merged target plus guidance section", async () => {
    const root = project();
    const rec = makeReconciler(root);
    const report = await rec.enable({
      projectRootPath: root,
      scope: "project",
    });
    expect(report.kind).toBe("report");
    if (report.kind !== "report") {
      return;
    }
    expect(report.state).toBe("enabled");
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: { "pier-memory": { env: { MEMORY_FILE_PATH: string } } };
    };
    expect(mcp.mcpServers["pier-memory"].env.MEMORY_FILE_PATH).toContain(
      "memory.jsonl"
    );
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- pier-managed:memory begin -->");
    expect(agents).toContain("search_nodes");
  });

  it("second enable is idempotent", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ projectRootPath: root, scope: "project" });
    const again = await rec.enable({
      projectRootPath: root,
      scope: "project",
    });
    if (again.kind !== "report") {
      throw new Error("expected report");
    }
    expect(again.state).toBe("enabled");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents.match(/pier-managed:memory begin/g)).toHaveLength(1);
  });

  it("disable removes entries, self-created skeleton and self-created AGENTS.md", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ projectRootPath: root, scope: "project" });
    await rec.disable({ projectRootPath: root, scope: "project" });
    expect(readdirSync(root)).not.toContain(".mcp.json");
    expect(readdirSync(root)).not.toContain("AGENTS.md");
  });

  it("tracked targets gate first enable behind confirmation", async () => {
    const root = project();
    const rec = makeReconciler(root, { tracked: true });
    const gated = await rec.enable({
      projectRootPath: root,
      scope: "project",
    });
    expect(gated.kind).toBe("needsConfirmation");
    if (gated.kind !== "needsConfirmation") {
      return;
    }
    expect(gated.trackedTargets).toEqual([join(root, ".mcp.json")]);
    expect(() => readFileSync(join(root, ".mcp.json"))).toThrow();
    await rec.acknowledgeTracked({
      projectRootPath: root,
      scope: "project",
    });
    const done = await rec.enable({
      projectRootPath: root,
      scope: "project",
    });
    expect(done.kind).toBe("report");
  });
});
