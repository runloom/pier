import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  homeRelativeDisplayPath,
  MemoryReconciler,
} from "@main/services/agent-managed-assets/reconcile.ts";
import type { TargetRow } from "@main/services/agent-managed-assets/types.ts";
import { createAgentRulesService } from "@main/services/agent-rules/service.ts";
import { FilePathTransactionLock } from "@main/services/files/path-transaction-lock.ts";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function makeReconciler(
  root: string,
  opts?: { onEnabled?: () => void; registryRows?: TargetRow[] }
) {
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
    getProjectKind: async (path: string) => (path === root ? "project" : null),
    lock: new FilePathTransactionLock(),
    ...(opts?.onEnabled ? { onEnabled: opts.onEnabled } : {}),
    registryStatus: async () => opts?.registryRows ?? [],
  });
}

describe("MemoryReconciler (v3)", () => {
  it("enable writes the guidance section and declares desiredState only", async () => {
    const root = project();
    const rec = makeReconciler(root);
    const report = await rec.enable({
      projectRootPath: root,
      scope: "project",
    });
    expect(report.state).toBe("enabled");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- pier-managed:memory begin -->");
    expect(agents).toContain("search_nodes");
    // v3 红线:项目仓库内除 AGENTS.md 引导段外零写入。
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".codex"))).toBe(false);
  });

  it("second enable keeps a single guidance section", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ projectRootPath: root, scope: "project" });
    await rec.enable({ projectRootPath: root, scope: "project" });
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents.match(/pier-managed:memory begin/g)).toHaveLength(1);
  });

  it("disable removes the guidance and restores a self-created AGENTS.md", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ projectRootPath: root, scope: "project" });
    await rec.disable({ projectRootPath: root, scope: "project" });
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    const snapshot = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    expect(snapshot.desiredState).toBe("disabled");
    expect(snapshot.derivedState).toBe("disabled");
  });

  it("treats a corrupt ledger as never-decided and does not overwrite it from status", async () => {
    const root = project();
    const rec = makeReconciler(root);
    const ledgerPath = join(
      root,
      ".pier-test-base",
      (await import("@main/services/agent-managed-assets/project-identity.ts")
        .then((m) => m.resolveProjectIdentity(root))
        .then((i) => i.key)) ?? "",
      "ledger.json"
    );
    mkdirSync(join(ledgerPath, ".."), { recursive: true });
    writeFileSync(ledgerPath, "{ not json");
    const snapshot = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    // 与启动器 fail-open 对齐:损坏账本 = 从未决策 = 默认启用;
    // 且 status 绝不把 load() 的 disabled 默认值落盘固化。
    expect(snapshot.desiredState).toBe("enabled");
    expect(readFileSync(ledgerPath, "utf8")).toBe("{ not json");
  });

  it("marks explicit toggles with a user decision source", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.disable({ projectRootPath: root, scope: "project" });
    const identity = await import(
      "@main/services/agent-managed-assets/project-identity.ts"
    ).then((m) => m.resolveProjectIdentity(root));
    const ledger = JSON.parse(
      readFileSync(
        join(root, ".pier-test-base", identity.key, "ledger.json"),
        "utf8"
      )
    ) as { decidedBy?: string; desiredState: string };
    expect(ledger.decidedBy).toBe("user");
    expect(ledger.desiredState).toBe("disabled");
  });

  it("defaults to enabled for a never-decided project without writing anything", async () => {
    const root = project();
    const rec = makeReconciler(root);
    const snapshot = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    expect(snapshot.desiredState).toBe("enabled");
    expect(snapshot.derivedState).toBe("enabled");
    // 声明式默认启用:status 不落账本、不写仓库。
    expect(existsSync(join(root, ".pier-test-base"))).toBe(false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });

  it("derives degraded from failed registry rows while enabled", async () => {
    const root = project();
    const failedRow: TargetRow = {
      configPath: "/home/u/.claude.json",
      consumers: ["claude"],
      detail: "managed entry missing or changed on disk",
      outcome: "failed",
    };
    const rec = makeReconciler(root, { registryRows: [failedRow] });
    const snapshot = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    expect(snapshot.derivedState).toBe("degraded");
    expect(snapshot.targets).toEqual([failedRow]);
    // 显式关闭后 registry 故障不再抬升为 degraded。
    await rec.disable({ projectRootPath: root, scope: "project" });
    const off = await rec.status({ projectRootPath: root, scope: "project" });
    expect(off.derivedState).toBe("disabled");
  });

  it("fires onEnabled after enable but not after disable", async () => {
    const root = project();
    const onEnabled = vi.fn();
    const rec = makeReconciler(root, { onEnabled });
    await rec.enable({ projectRootPath: root, scope: "project" });
    expect(onEnabled).toHaveBeenCalledTimes(1);
    await rec.disable({ projectRootPath: root, scope: "project" });
    expect(onEnabled).toHaveBeenCalledTimes(1);
  });

  it("rejects unregistered roots without touching the project", async () => {
    const registered = project();
    const rec = makeReconciler(registered);
    const foreign = project();
    await expect(
      rec.enable({ projectRootPath: foreign, scope: "project" })
    ).rejects.toThrow(/registered Pier project/);
    expect(existsSync(join(foreign, "AGENTS.md"))).toBe(false);
  });

  it("collapses the home prefix for display paths only", () => {
    expect(homeRelativeDisplayPath("/Users/a/x/memory.jsonl", "/Users/a")).toBe(
      "~/x/memory.jsonl"
    );
    expect(homeRelativeDisplayPath("/Users/ab/x", "/Users/a")).toBe(
      "/Users/ab/x"
    );
    expect(homeRelativeDisplayPath("/var/tmp/x", "/Users/a")).toBe(
      "/var/tmp/x"
    );
  });

  it("clearStore empties JSONL without touching desiredState", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ projectRootPath: root, scope: "project" });
    const snapshot = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    writeFileSync(
      snapshot.storePath,
      '{"type":"entity","name":"pnpm","entityType":"convention","observations":["use pnpm"]}\n'
    );
    await rec.clearStore({ projectRootPath: root, scope: "project" });
    expect(readFileSync(snapshot.storePath, "utf8")).toBe("");
    const after = await rec.status({
      projectRootPath: root,
      scope: "project",
    });
    expect(after.desiredState).toBe("enabled");
  });
});
