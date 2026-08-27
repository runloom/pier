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
  convergeMemoryRegistry,
  memoryGlobalTargets,
  memoryRegistryStatusRows,
} from "@main/services/agent-managed-assets/registry.ts";
import {
  buildServerEntry,
  planJsonUpsert,
} from "@main/services/agent-managed-assets/serializers.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-mem-reg-"));
  dirs.push(dir);
  return realpathSync(dir);
}

const LAUNCHER = "/abs/.pier/memory/launcher/current/memory-mcp.mjs";

describe("memory global registry", () => {
  it("registers launcher entries only for installed agents", async () => {
    const h = home();
    const rows = await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["claude", "codex"],
      launcherPath: LAUNCHER,
    });
    expect(rows.every((row) => row.outcome === "written")).toBe(true);
    const claude = JSON.parse(
      readFileSync(join(h, ".claude.json"), "utf8")
    ) as {
      mcpServers: Record<string, { args: string[]; command: string }>;
    };
    expect(claude.mcpServers["pier-memory"]).toEqual({
      args: [LAUNCHER],
      command: "node",
    });
    const codex = readFileSync(join(h, ".codex", "config.toml"), "utf8");
    expect(codex).toContain('command = "node"');
    expect(codex).toContain(LAUNCHER);
    expect(codex).not.toContain("env =");
    // 未安装的智能体不落文件。
    expect(existsSync(join(h, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(join(h, ".gemini", "settings.json"))).toBe(false);
  });

  it("is idempotent and preserves foreign user entries", async () => {
    const h = home();
    mkdirSync(join(h, ".cursor"), { recursive: true });
    writeFileSync(
      join(h, ".cursor", "mcp.json"),
      `${JSON.stringify({ mcpServers: { mine: { command: "x" } } }, null, 2)}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["cursor"],
      launcherPath: LAUNCHER,
    });
    const first = readFileSync(join(h, ".cursor", "mcp.json"), "utf8");
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["cursor"],
      launcherPath: LAUNCHER,
    });
    const second = readFileSync(join(h, ".cursor", "mcp.json"), "utf8");
    expect(second).toBe(first);
    const parsed = JSON.parse(second) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.mine).toEqual({ command: "x" });
    expect(parsed.mcpServers["pier-memory"]).toBeTruthy();
  });

  it("migrates v2 project entries away and never re-adds them", async () => {
    const h = home();
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "pier-proj-")));
    dirs.push(projectDir);
    // 造一个 v2 现场:项目 .mcp.json 仅含 Pier 条目(自建骨架),账本记 fingerprint。
    const storePath = join(h, ".pier", "memory", "k1", "memory.jsonl");
    const plan = planJsonUpsert(null, buildServerEntry(storePath));
    if (!(plan.ok && typeof plan.next === "string")) {
      throw new Error("fixture plan failed");
    }
    const mcpPath = join(projectDir, ".mcp.json");
    writeFileSync(mcpPath, plan.next);
    const ledgerDir = join(h, ".pier", "memory", "k1");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      join(ledgerDir, "ledger.json"),
      `${JSON.stringify({
        claudeReference: { insertedByPier: false, present: false },
        desiredState: "enabled",
        enginePackage: "@modelcontextprotocol/server-memory@2026.7.4",
        pending: [],
        projectIdentity: { canonicalRoot: projectDir },
        rulesSection: {
          agentsMdExistedBefore: true,
          fingerprint: "",
          inserted: false,
        },
        targets: {
          [mcpPath]: {
            existedBefore: false,
            fingerprint: plan.fingerprint,
            lastOutcome: "written",
          },
        },
      })}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["claude"],
      launcherPath: LAUNCHER,
    });
    // 自建骨架被删除;项目账本 targets 清空;桌面全局配置就位。
    expect(existsSync(mcpPath)).toBe(false);
    const ledger = JSON.parse(
      readFileSync(join(ledgerDir, "ledger.json"), "utf8")
    ) as { desiredState: string; targets: Record<string, unknown> };
    expect(ledger.targets).toEqual({});
    expect(ledger.desiredState).toBe("enabled");
    // 迁移是一次性的:第二次 converge 不再扫项目账本。
    writeFileSync(mcpPath, plan.next);
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["claude"],
      launcherPath: LAUNCHER,
    });
    expect(existsSync(mcpPath)).toBe(true);
  });

  it("clears v2 gate artifacts once but preserves genuine user disables", async () => {
    const h = home();
    const base = join(h, ".pier", "memory");
    // 确认门残留:disabled + 空 targets + 无 ack + 无引导段痕迹 → 非用户决策。
    const artifactDir = join(base, "gate-artifact");
    mkdirSync(artifactDir, { recursive: true });
    const artifact = {
      claudeReference: { insertedByPier: false, present: false },
      desiredState: "disabled",
      enginePackage: "@modelcontextprotocol/server-memory@2026.7.4",
      pending: [],
      projectIdentity: { canonicalRoot: "/repo/a" },
      rulesSection: {
        agentsMdExistedBefore: true,
        fingerprint: "",
        inserted: false,
      },
      targets: {},
    };
    writeFileSync(
      join(artifactDir, "ledger.json"),
      `${JSON.stringify(artifact)}\n`
    );
    // 真实用户关闭:targets 留有 removed 记录。
    const genuineDir = join(base, "genuine-disable");
    mkdirSync(genuineDir, { recursive: true });
    writeFileSync(
      join(genuineDir, "ledger.json"),
      `${JSON.stringify({
        ...artifact,
        projectIdentity: { canonicalRoot: "/repo/b" },
        targets: {
          "/repo/b/.mcp.json": {
            existedBefore: true,
            fingerprint: "",
            lastOutcome: "removed",
          },
        },
      })}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: [],
      launcherPath: LAUNCHER,
    });
    expect(existsSync(join(artifactDir, "ledger.json"))).toBe(false);
    expect(existsSync(join(genuineDir, "ledger.json"))).toBe(true);
    // 一次性:清理后再出现同形态账本(= v3 显式关闭)不再被动。
    writeFileSync(
      join(artifactDir, "ledger.json"),
      `${JSON.stringify(artifact)}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: [],
      launcherPath: LAUNCHER,
    });
    expect(existsSync(join(artifactDir, "ledger.json"))).toBe(true);
  });

  it("never clears ledgers carrying an explicit user decision", async () => {
    const h = home();
    const base = join(h, ".pier", "memory");
    const userDir = join(base, "user-decided");
    mkdirSync(userDir, { recursive: true });
    // v3 显式关闭形态与门残留同构,唯一区别是 decidedBy 标记——必须一票否决。
    writeFileSync(
      join(userDir, "ledger.json"),
      `${JSON.stringify({
        claudeReference: { insertedByPier: false, present: false },
        decidedBy: "user",
        desiredState: "disabled",
        enginePackage: "engine",
        pending: [],
        projectIdentity: { canonicalRoot: "/repo/u" },
        rulesSection: {
          agentsMdExistedBefore: true,
          fingerprint: "",
          inserted: false,
        },
        targets: {},
      })}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: [],
      launcherPath: LAUNCHER,
    });
    expect(existsSync(join(userDir, "ledger.json"))).toBe(true);
  });

  it("recovers v2 WAL pendings before migrating so crash-window entries still get cleaned", async () => {
    const h = home();
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "pier-wal-")));
    dirs.push(projectDir);
    const storePath = join(h, ".pier", "memory", "kw", "memory.jsonl");
    const plan = planJsonUpsert(null, buildServerEntry(storePath));
    if (!(plan.ok && typeof plan.next === "string")) {
      throw new Error("fixture plan failed");
    }
    const mcpPath = join(projectDir, ".mcp.json");
    // v2 崩溃现场:文件已写入,commit 未落——targets 里没有 written 记录,
    // 只有 pending(expectedFingerprint = 磁盘实况)。
    writeFileSync(mcpPath, plan.next);
    const ledgerDir = join(h, ".pier", "memory", "kw");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      join(ledgerDir, "ledger.json"),
      `${JSON.stringify({
        claudeReference: { insertedByPier: false, present: false },
        desiredState: "enabled",
        enginePackage: "engine",
        pending: [
          {
            action: "write",
            commitRecord: {
              existedBefore: false,
              fingerprint: plan.fingerprint,
              lastOutcome: "written",
            },
            expectedFingerprint: plan.fingerprint,
            kind: "mcp-target",
            priorFingerprint: "absent",
            targetPath: mcpPath,
          },
        ],
        projectIdentity: { canonicalRoot: projectDir },
        rulesSection: {
          agentsMdExistedBefore: true,
          fingerprint: "",
          inserted: false,
        },
        targets: {},
      })}\n`
    );
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: [],
      launcherPath: LAUNCHER,
    });
    // WAL 分支① 先提交为 written,再按 v2 反向清理:自建骨架文件被删除。
    expect(existsSync(mcpPath)).toBe(false);
  });

  it("reports opencode as failed instead of fake-writing when opencode.jsonc exists", async () => {
    const h = home();
    const opencodeDir = join(h, ".config", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.jsonc"),
      "{\n  // user config\n}\n"
    );
    const rows = await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["opencode"],
      launcherPath: LAUNCHER,
    });
    expect(rows[0]?.outcome).toBe("failed");
    expect(rows[0]?.detail).toContain("opencode.jsonc");
    expect(existsSync(join(opencodeDir, "opencode.json"))).toBe(false);
    const status = await memoryRegistryStatusRows({
      env: {},
      home: h,
      installedAgents: ["opencode"],
    });
    expect(status[0]?.outcome).toBe("failed");
  });

  it("isolates per-target failures so one broken config does not abort the rest", async () => {
    const h = home();
    // 把 ~/.cursor 造成普通文件:cursor 目标 mkdir 必然失败。
    writeFileSync(join(h, ".cursor"), "not a dir\n");
    const rows = await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["cursor", "claude"],
      launcherPath: LAUNCHER,
    });
    const cursorRow = rows.find((row) => row.consumers.includes("cursor"));
    const claudeRow = rows.find((row) => row.consumers.includes("claude"));
    expect(cursorRow?.outcome).toBe("failed");
    expect(claudeRow?.outcome).toBe("written");
    expect(existsSync(join(h, ".claude.json"))).toBe(true);
  });

  it("status rows flag tampering and unregistered installed agents", async () => {
    const h = home();
    await convergeMemoryRegistry({
      env: {},
      home: h,
      installedAgents: ["claude"],
      launcherPath: LAUNCHER,
    });
    let rows = await memoryRegistryStatusRows({
      env: {},
      home: h,
      installedAgents: ["claude"],
    });
    expect(rows).toEqual([
      {
        configPath: join(h, ".claude.json"),
        consumers: ["claude"],
        outcome: "written",
      },
    ]);
    // 用户手改条目 → 漂移可见。
    const path = join(h, ".claude.json");
    writeFileSync(
      path,
      `${JSON.stringify({ mcpServers: { "pier-memory": { command: "hacked" } } }, null, 2)}\n`
    );
    rows = await memoryRegistryStatusRows({
      env: {},
      home: h,
      installedAgents: ["claude"],
    });
    expect(rows[0]?.outcome).toBe("failed");
    expect(rows[0]?.detail).toContain("changed on disk");
    // 新装未注册的智能体如实报缺。
    rows = await memoryRegistryStatusRows({
      env: {},
      home: h,
      installedAgents: ["claude", "codex"],
    });
    expect(
      rows.find((row) => row.consumers.includes("codex"))?.detail
    ).toContain("not configured");
  });

  it("honors CODEX_HOME and XDG_CONFIG_HOME in target paths", () => {
    const targets = memoryGlobalTargets({
      env: { CODEX_HOME: "~/alt-codex", XDG_CONFIG_HOME: "/xdg" },
      home: "/home/u",
    });
    expect(targets.find((target) => target.agent === "codex")?.abs).toBe(
      "/home/u/alt-codex/config.toml"
    );
    expect(targets.find((target) => target.agent === "opencode")?.abs).toBe(
      "/xdg/opencode/opencode.json"
    );
  });
});
