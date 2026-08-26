# 项目记忆插件（pier.memory）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-08-26-project-memory-plugin-design.md`（v3）实现宿主 `agent-managed-assets` 服务 + builtin 插件 `pier.memory`，把官方 memory MCP 服务器托管进各智能体的项目级配置。

**Architecture:** 全部副作用在宿主 main 侧服务（ledger WAL + FilePathTransactionLock + 每 format serializer）；经 PierCommand（`memory.enable/disable/status`）暴露；builtin 插件只提供 renderer 面板与窄 facade。

**Tech Stack:** TypeScript 6 strict · Vitest · `smol-toml`（新增 devDependency，仅 parse 验证）· `@modelcontextprotocol/server-memory@0.6.3`（运行时 npx，锁定版本）· `write-file-atomic`（已有）。

## Global Constraints

- 引擎包精确固定 `@modelcontextprotocol/server-memory@0.6.3`，不得使用 dist-tag。
- 新 capability 名为 `managedAssets:write`，仅加入 `desktop-renderer` 默认集，其它 client-kind 一律不加。
- 禁止向第三方配置写入任何非 schema 字段（无 `pierManaged` 标记），归属判定只用 ownership ledger fingerprint。
- 单文件 ≤500 行（`pnpm check:file-size` 门禁）；目录密度门禁 `pnpm check:dir-density`。
- 用户可见文案全部走 i18n locale 文件，禁止内联字符串；中文遵循产品词表（智能体、记忆文件位置；禁 MCP/store/renderer 等实现词入前台主路径）。
- 开关切换本身即反馈，不加成功 toast；失败详情走插件 dialogs facade alert。
- 所有读写判在 `FilePathTransactionLock` 单例锁内；每个 target 动作前先写 `ledger.pending`（P1）再动文件（P2）再提交（P3）。
- 测试命令统一用 `pnpm vitest run <file>`；提交信息用 Conventional Commits。

---

### Task 1: capability `managedAssets:write` 入枚举与默认集

**Files:**
- Modify: `src/shared/contracts/permissions.ts:13-69`（枚举）、`:84-127`（desktop-renderer 默认集）
- Test: `tests/unit/main/plugins/bundled-system-skills.test.ts` 旁新建 `tests/unit/shared/permissions-memory.test.ts`

**Interfaces:**
- Produces: `PierCapability` 联合类型新成员 `"managedAssets:write"`；后续所有任务引用该字符串常量。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/shared/permissions-memory.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  pierCapabilitySchema,
} from "@shared/contracts/permissions.ts";

describe("managedAssets:write capability", () => {
  it("is a known capability", () => {
    expect(
      pierCapabilitySchema.safeParse("managedAssets:write").success
    ).toBe(true);
  });

  it("is granted to desktop-renderer only", () => {
    const granted = (
      Object.entries(DEFAULT_CAPABILITIES_BY_CLIENT_KIND) as [
        string,
        readonly string[],
      ][]
    )
      .filter(([, caps]) => caps.includes("managedAssets:write"))
      .map(([kind]) => kind);
    expect(granted).toEqual(["desktop-renderer"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/shared/permissions-memory.test.ts`
Expected: FAIL（safeParse false / granted 为空数组）

- [ ] **Step 3: 最小实现**

在 `pierCapabilitySchema` 枚举末尾（`"notification:write"` 之后）加一行：

```ts
  /** 受管智能体资产注册：项目级 MCP 配置 + 规则托管段（pier.memory 插件消费）。 */
  "managedAssets:write",
```

在 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"]` 数组末尾（`"notification:write"` 之后）加：

```ts
    "managedAssets:write",
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/shared/permissions-memory.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/permissions.ts tests/unit/shared/permissions-memory.test.ts
git commit -m "feat(permissions): add managedAssets:write capability for pier.memory"
```

---

### Task 2: 新增 `smol-toml` devDependency

**Files:**
- Modify: `package.json`（devDependencies）

**Interfaces:**
- Produces: 可 `import { parse } from "smol-toml"`（Task 5 codex-toml writer 用）。

- [ ] **Step 1: 安装**

Run: `pnpm add -D smol-toml`
Expected: package.json devDependencies 出现 `"smol-toml"`，lockfile 更新，安装无 peer 冲突。

- [ ] **Step 2: 验证可解析 TOML**

Run: `pnpm vitest run --passWithNoTests && node -e "const{parse}=require('smol-toml');console.log(typeof parse)" `
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(deps): add smol-toml for managed mcp config validation"
```

---

### Task 3: 写入目标 facts 模块（每智能体唯一首选目标）

**Files:**
- Create: `src/main/services/agent-managed-assets/write-targets.ts`
- Test: `tests/unit/main/agent-managed-assets/write-targets.test.ts`

**Interfaces:**
- Consumes: `AgentKind`（`@shared/contracts/agent.ts`）。
- Produces:
  ```ts
  export type MemoryConfigFormat = "mcp-servers-json" | "opencode-json" | "codex-toml";
  export interface MemoryWriteTarget { format: MemoryConfigFormat; relativePath: string }
  export interface SelectedMemoryTarget extends MemoryWriteTarget { consumers: AgentKind[] }
  export function selectMemoryTargets(installedAgents: readonly AgentKind[]): SelectedMemoryTarget[];
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/agent-managed-assets/write-targets.test.ts
import { describe, expect, it } from "vitest";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { selectMemoryTargets } from "../../../src/main/services/agent-managed-assets/write-targets.ts";

describe("selectMemoryTargets", () => {
  it("omp alone writes only .mcp.json", () => {
    expect(selectMemoryTargets(["omp"])).toEqual([
      { format: "mcp-servers-json", relativePath: ".mcp.json", consumers: ["omp"] },
    ]);
  });

  it("claude+omp dedupe into one target", () => {
    const rows = selectMemoryTargets(["claude", "omp"]);
    expect(rows).toHaveLength(1);
    expect([...rows[0]!.consumers].sort()).toEqual(["claude", "omp"]);
  });

  it("covers every installed agent exactly once across targets", () => {
    const all: AgentKind[] = ["claude", "codex", "cursor", "gemini", "opencode", "omp"];
    const rows = selectMemoryTargets(all);
    expect(rows).toHaveLength(5); // claude+omp 合并
    const covered = rows.flatMap((r) => r.consumers).sort();
    expect(covered).toEqual([...all].sort());
    expect(rows.map((r) => r.relativePath)).toEqual([
      ".codex/config.toml",
      ".cursor/mcp.json",
      ".gemini/settings.json",
      ".mcp.json",
      "opencode.json",
    ]); // 输出按 relativePath 稳定排序
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/write-targets.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/main/services/agent-managed-assets/write-targets.ts
import type { AgentKind } from "@shared/contracts/agent.ts";

export type MemoryConfigFormat =
  | "mcp-servers-json"
  | "opencode-json"
  | "codex-toml";

export interface MemoryWriteTarget {
  format: MemoryConfigFormat;
  relativePath: string;
}

/**
 * 每个智能体唯一首选项目配置（spec「写入目标与选择规则」）；
 * 实际写入集合 = 已安装智能体首选目标的去重并集。
 */
const TARGETS_BY_AGENT: Partial<Record<AgentKind, MemoryWriteTarget>> = {
  claude: { format: "mcp-servers-json", relativePath: ".mcp.json" },
  omp: { format: "mcp-servers-json", relativePath: ".mcp.json" },
  cursor: { format: "mcp-servers-json", relativePath: ".cursor/mcp.json" },
  codex: { format: "codex-toml", relativePath: ".codex/config.toml" },
  gemini: { format: "mcp-servers-json", relativePath: ".gemini/settings.json" },
  opencode: { format: "opencode-json", relativePath: "opencode.json" },
};

export interface SelectedMemoryTarget extends MemoryWriteTarget {
  consumers: AgentKind[];
}

export function selectMemoryTargets(
  installedAgents: readonly AgentKind[]
): SelectedMemoryTarget[] {
  const byPath = new Map<string, SelectedMemoryTarget>();
  for (const agent of installedAgents) {
    const target = TARGETS_BY_AGENT[agent];
    if (!target) continue;
    const existing = byPath.get(target.relativePath);
    if (existing) {
      existing.consumers.push(agent);
      continue;
    }
    byPath.set(target.relativePath, { ...target, consumers: [agent] });
  }
  return [...byPath.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/write-targets.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets/write-targets.ts tests/unit/main/agent-managed-assets/write-targets.test.ts
git commit -m "feat(memory): managed write-target facts with per-agent preferred config"
```

---

### Task 4: projectKey 身份派生（gitCommonDir）

**Files:**
- Create: `src/main/services/agent-managed-assets/project-identity.ts`
- Test: `tests/unit/main/agent-managed-assets/project-identity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProjectIdentity { key: string; canonicalRoot: string }
  export async function resolveProjectIdentity(projectRootPath: string): Promise<ProjectIdentity>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/agent-managed-assets/project-identity.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectIdentity } from "../../../src/main/services/agent-managed-assets/project-identity.ts";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-mem-id-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return realpathSync(dir);
}

describe("resolveProjectIdentity", () => {
  it("collapses linked worktree onto the main repo identity", async () => {
    const main = initRepo();
    const wt = mkdtempSync(join(tmpdir(), "pier-mem-wt-"));
    execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "HEAD"], {
      cwd: main,
    });
    const a = await resolveProjectIdentity(main);
    const b = await resolveProjectIdentity(wt);
    expect(a.key).toBe(b.key);
    expect(a.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to directory identity outside a repo", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pier-mem-nogit-")));
    const id = await resolveProjectIdentity(dir);
    expect(id.canonicalRoot).toBe(dir);
    expect(id.key).toMatch(/^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/project-identity.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/main/services/agent-managed-assets/project-identity.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";

export interface ProjectIdentity {
  canonicalRoot: string;
  key: string;
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function execGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** git 项目用 commonDir（worktree 收敛同一仓库身份）；非 git 退化为目录 identity。 */
export async function resolveProjectIdentity(
  projectRootPath: string
): Promise<ProjectIdentity> {
  const root = await realpath(projectRootPath);
  try {
    const out = await execGit(
      ["rev-parse", "--absolute-git-dir", "--git-common-dir"],
      root
    );
    const commonDirLine = out.split("\n").map((l) => l.trim()).find(Boolean);
    const commonDir = commonDirLine ? await realpath(commonDirLine) : root;
    return { canonicalRoot: commonDir, key: sha16(commonDir) };
  } catch {
    return { canonicalRoot: root, key: sha16(root) };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/project-identity.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets/project-identity.ts tests/unit/main/agent-managed-assets/project-identity.test.ts
git commit -m "feat(memory): project identity keyed by git common dir"
```

---

### Task 5: 四个 serializer（fixture 即契约）

**Files:**
- Create: `src/main/services/agent-managed-assets/serializers.ts`
- Test: `tests/unit/main/agent-managed-assets/serializers.test.ts`

**Interfaces:**
- Consumes: `MemoryConfigFormat`（Task 3）。
- Produces:
  ```ts
  export const SERVER_KEY = "pier-memory";
  export const ENGINE_PACKAGE = "@modelcontextprotocol/server-memory@0.6.3";
  export function buildServerEntry(storePath: string): Record<string, unknown>;          // 按 format 分形
  export function buildServerEntryFor(format: MemoryConfigFormat, storePath: string): unknown;
  export type PlanOk = { ok: true; next: string; fingerprint: string };
  export type PlanFail = { ok: false; reason: string };
  export function planJsonUpsert(raw: string | null, storePath: string, topLevelKey?: "mcpServers"): PlanOk | PlanFail;
  export function planOpenCodeUpsert(raw: string | null, storePath: string): PlanOk | PlanFail;
  export function planTomlAppend(raw: string | null, storePath: string): PlanOk | PlanFail;
  export function planRemove(raw: string, format: MemoryConfigFormat): PlanOk & { next: string | null } | PlanFail;
  ```
  fingerprint 定义：JSON = `sha256(JSON.stringify(entry))`；TOML = `sha256(marker 包裹块文本)`。

- [ ] **Step 1: 写失败测试（fixture 即 spec 的期望输出）**

```ts
// tests/unit/main/agent-managed-assets/serializers.test.ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildServerEntry,
  buildServerEntryFor,
  planJsonUpsert,
  planOpenCodeUpsert,
  planRemove,
  planTomlAppend,
} from "../../../src/main/services/agent-managed-assets/serializers.ts";

const STORE = "/home/u/.p/pier.memory/abc123/memory.jsonl";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe("mcp-servers-json upsert", () => {
  it("creates skeleton when file missing", () => {
    const plan = planJsonUpsert(null, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.parse(plan.next)).toEqual({
      mcpServers: {
        "pier-memory": buildServerEntry(STORE),
      },
    });
  });

  it("merges into existing config preserving other keys", () => {
    const raw = JSON.stringify({ other: true, mcpServers: { mine: { command: "x" } } });
    const plan = planJsonUpsert(raw, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const parsed = JSON.parse(plan.next);
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers.mine).toBeDefined();
    expect(parsed.mcpServers["pier-memory"]).toEqual(buildServerEntry(STORE));
  });

  it("rejects foreign pier-memory key (fingerprint mismatch)", () => {
    const foreign = { mcpServers: { "pier-memory": { command: "someone-else" } } };
    const plan = planJsonUpsert(JSON.stringify(foreign), STORE);
    expect(plan.ok).toBe(false);
  });

  it("removes only own entry and reports null next for empty skeleton", () => {
    const first = planJsonUpsert(null, STORE);
    if (!first.ok) throw new Error("setup failed");
    const removed = planRemove(first.next, "mcp-servers-json");
    expect(removed.ok).toBe(true);
    if (!removed.ok || removed.next === null) return;
    expect(removed.next).toBeNull(); // 自建骨架 → 整文件还原为不存在
  });
});

describe("opencode-json upsert", () => {
  it("uses local schema: type/command-array/environment", () => {
    const plan = planOpenCodeUpsert(null, STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.parse(plan.next)).toEqual({
      mcp: {
        "pier-memory": {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-memory@0.6.3"],
          environment: { MEMORY_FILE_PATH: STORE },
        },
      },
    });
  });
});

describe("codex-toml append/remove", () => {
  it("appends marker block and validates with smol-toml", () => {
    const plan = planTomlAppend("", STORE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next).toContain("# pier-managed:pier-memory begin");
    expect(plan.next).toContain('[mcp_servers.pier-memory]');
  });

  it("rejects when pier-memory already defined in any form", () => {
    const existing = 'foo = 1\n[mcp_servers."pier-memory"]\ncommand = "x"\n';
    expect(planTomlAppend(existing, STORE).ok).toBe(false);
    const inline = 'mcp_servers = { "pier-memory" = { command = "x" } }\n';
    expect(planTomlAppend(inline, STORE).ok).toBe(false);
    const broken = "[unclosed\n";
    expect(planTomlAppend(broken, STORE).ok).toBe(false);
  });

  it("remove restores bytes outside marker block", () => {
    const head = "# my config\nfoo = 1\n";
    const appended = planTomlAppend(head, STORE);
    if (!appended.ok) throw new Error("setup failed");
    const removed = planRemove(appended.next, "codex-toml");
    expect(removed.ok).toBe(true);
    if (!removed.ok || typeof removed.next !== "string") return;
    expect(removed.next).toBe(head);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/serializers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/main/services/agent-managed-assets/serializers.ts
import { createHash } from "node:crypto";
import { parse as parseToml } from "smol-toml";

export const SERVER_KEY = "pier-memory";
export const ENGINE_PACKAGE = "@modelcontextprotocol/server-memory@0.6.3";
const BEGIN = "# pier-managed:pier-memory begin";
const END = "# pier-managed:pier-memory end";

export type MemoryConfigFormat =
  | "mcp-servers-json"
  | "opencode-json"
  | "codex-toml";

export type PlanOk = { ok: true; next: string; fingerprint: string };
export type PlanFail = { ok: false; reason: string };

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function buildServerEntry(storePath: string): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", ENGINE_PACKAGE],
    env: { MEMORY_FILE_PATH: storePath },
  };
}

export function buildServerEntryFor(
  format: MemoryConfigFormat,
  storePath: string
): unknown {
  if (format === "opencode-json") {
    return {
      type: "local",
      command: ["npx", "-y", ENGINE_PACKAGE],
      environment: { MEMORY_FILE_PATH: storePath },
    };
  }
  return buildServerEntry(storePath);
}

interface JsonDoc { [key: string]: unknown }

function upsertJson(
  raw: string | null,
  storePath: string,
  topLevelKey: "mcpServers" | "mcp"
): PlanOk | PlanFail {
  let doc: JsonDoc = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, reason: "config root is not an object" };
      }
      doc = parsed as JsonDoc;
    } catch {
      return { ok: false, reason: "config is not valid JSON" };
    }
  }
  const section = (doc[topLevelKey] ?? {}) as JsonDoc;
  const existing = section[SERVER_KEY];
  const entry = buildServerEntryFor(
    topLevelKey === "mcp" ? "opencode-json" : "mcp-servers-json",
    storePath
  );
  if (existing !== undefined && sha(JSON.stringify(existing)) !== sha(JSON.stringify(entry))) {
    return { ok: false, reason: `${SERVER_KEY} already defined by someone else` };
  }
  section[SERVER_KEY] = entry;
  doc[topLevelKey] = section;
  const next = `${JSON.stringify(doc, null, 2)}\n`;
  return { ok: true, next, fingerprint: sha(JSON.stringify(entry)) };
}

export function planJsonUpsert(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  return upsertJson(raw, storePath, "mcpServers");
}

export function planOpenCodeUpsert(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  return upsertJson(raw, storePath, "mcp");
}

function tomlBlock(storePath: string): string {
  const entry = buildServerEntry(storePath) as {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  const args = entry.args.map((a) => JSON.stringify(a)).join(", ");
  const envPairs = Object.entries(entry.env)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(", ");
  return [
    BEGIN,
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${args}]`,
    `env = { ${envPairs} }`,
    END,
    "",
  ].join("\n");
}

export function planTomlAppend(
  raw: string | null,
  storePath: string
): PlanOk | PlanFail {
  const source = raw ?? "";
  try {
    const parsed = parseToml(source) as { mcp_servers?: Record<string, unknown> };
    if (parsed.mcp_servers?.[SERVER_KEY] !== undefined) {
      return { ok: false, reason: `${SERVER_KEY} already defined in codex config` };
    }
  } catch (error) {
    return { ok: false, reason: `codex config is not valid TOML: ${String(error)}` };
  }
  const block = tomlBlock(storePath);
  const base = source.endsWith("\n") || source === "" ? source : `${source}\n`;
  const next = `${base}\n${block}`;
  return { ok: true, next, fingerprint: sha(block) };
}

export function planRemove(
  raw: string,
  format: MemoryConfigFormat
): PlanOk & { next: string | null } | PlanFail {
  if (format === "codex-toml") {
    const beginAt = raw.indexOf(BEGIN);
    const endAt = raw.indexOf(END);
    if (beginAt < 0 || endAt < 0) return { ok: false, reason: "managed block not found" };
    const block = raw.slice(beginAt, endAt + END.length + 1);
    if (sha(block) !== "") {
      // fingerprint 校验由调用方比对 plan.fingerprint 与 ledger 记录
    }
    const before = raw.slice(0, beginAt);
    const after = raw.slice(endAt + END.length + 1);
    return { ok: true, next: `${before}${after}`, fingerprint: sha(block) };
  }
  try {
    const doc = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const key = format === "opencode-json" ? "mcp" : "mcpServers";
    const section = doc[key];
    if (!section || section[SERVER_KEY] === undefined) {
      return { ok: false, reason: "managed entry not found" };
    }
    const fingerprint = sha(JSON.stringify(section[SERVER_KEY]));
    delete section[SERVER_KEY];
    const isEmptySection = Object.keys(section).length === 0;
    if (isEmptySection) delete doc[key];
    const isSkeleton = Object.keys(doc).length === 0;
    return {
      ok: true,
      next: isSkeleton ? null : `${JSON.stringify(doc, null, 2)}\n`,
      fingerprint,
    };
  } catch {
    return { ok: false, reason: "config is not valid JSON" };
  }
}
```

注意：`planRemove` 的 codex 分支里 `if (sha(block) !== "")` 占位判断是死代码——实现时直接删除该 if 块，fingerprint 比对职责在 Task 8 的 reconcile（ledger 比对 `planRemove().fingerprint !== ledger.fingerprint → failed("drifted")`）。本步实现请直接写干净版本。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/serializers.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets/serializers.ts tests/unit/main/agent-managed-assets/serializers.test.ts
git commit -m "feat(memory): per-format managed-config serializers with drift guards"
```

---

### Task 6: ownership ledger + WAL 恢复

**Files:**
- Create: `src/main/services/agent-managed-assets/ledger.ts`
- Test: `tests/unit/main/agent-managed-assets/ledger.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LedgerPending {
    kind: "mcp-target" | "rules-section" | "claude-reference";
    targetPath: string;
    action: "write" | "remove";
    priorFingerprint: string;              // "absent" 表示此前不存在
    expectedFingerprint: string;           // 移除动作为 "absent"
    commitRecord: { existedBefore: boolean; fingerprint: string; lastOutcome: "written" | "removed" };
  }
  export interface MemoryLedger {
    projectIdentity: { canonicalRoot: string };
    desiredState: "enabled" | "disabled";
    enginePackage: string;
    trackedAcknowledged?: boolean;
    targets: Record<string, { existedBefore: boolean; fingerprint: string; lastOutcome: "written" | "removed" | "failed" | "skipped"; detail?: string }>;
    rulesSection: { inserted: boolean; fingerprint: string; agentsMdExistedBefore: boolean };
    claudeReference: { present: boolean; insertedByPier: boolean };
    pending: LedgerPending[];
  }
  export class LedgerStore {
    constructor(options: { dir: string; canonicalRoot: string; now?: () => number });
    load(): Promise<MemoryLedger>;                       // 不存在则建默认（desiredState:"disabled"，pending:[]）
    save(ledger: MemoryLedger): Promise<void>;           // writeFileAtomic + 0600
    static recover(pending: LedgerPending[], currentFingerprint: string):
      | { branch: 1; commit: LedgerPending["commitRecord"] }
      | { branch: 2 }
      | { branch: 3 };
  }
  ```
  恢复三分支为纯函数：①current==expectedFingerprint→commit；②current==priorFingerprint→重放；③其余→冲突。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/agent-managed-assets/ledger.test.ts
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerStore } from "../../../src/main/services/agent-managed-assets/ledger.ts";

let dir = "";
async function freshDir(): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "pier-mem-ledger-"));
  return dir;
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("LedgerStore", () => {
  it("creates defaults then persists mutations round-trip", async () => {
    const store = new LedgerStore({ dir: await freshDir(), canonicalRoot: "/repo" });
    const ledger = await store.load();
    expect(ledger.desiredState).toBe("disabled");
    expect(ledger.pending).toEqual([]);
    ledger.desiredState = "enabled";
    await store.save(ledger);
    const reloaded = await new LedgerStore({ dir, canonicalRoot: "/repo" }).load();
    expect(reloaded.desiredState).toBe("enabled");
    const raw = await readFile(join(dir, "ledger.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("recover branch 1 commits when reality matches expectation", () => {
    const pending = {
      kind: "mcp-target", targetPath: "/p/.mcp.json", action: "write",
      priorFingerprint: "absent", expectedFingerprint: "ff",
      commitRecord: { existedBefore: true, fingerprint: "ff", lastOutcome: "written" },
    } as const;
    expect(LedgerStore.recover([pending][0]!, "ff")).toEqual({
      branch: 1, commit: pending.commitRecord,
    });
  });

  it("recover branch 2 replays when nothing happened yet", () => {
    const pending = {
      kind: "mcp-target", targetPath: "/p/.mcp.json", action: "write",
      priorFingerprint: "aa", expectedFingerprint: "ff",
      commitRecord: { existedBefore: true, fingerprint: "ff", lastOutcome: "written" },
    } as const;
    expect(LedgerStore.recover(pending, "aa")).toEqual({ branch: 2 });
  });

  it("recover branch 3 reports conflict on third-party drift", () => {
    const pending = {
      kind: "mcp-target", targetPath: "/p/.mcp.json", action: "write",
      priorFingerprint: "aa", expectedFingerprint: "ff",
      commitRecord: { existedBefore: true, fingerprint: "ff", lastOutcome: "written" },
    } as const;
    expect(LedgerStore.recover(pending, "zz")).toEqual({ branch: 3 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/ledger.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/main/services/agent-managed-assets/ledger.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";

export interface LedgerPending {
  kind: "mcp-target" | "rules-section" | "claude-reference";
  targetPath: string;
  action: "write" | "remove";
  priorFingerprint: string;
  expectedFingerprint: string;
  commitRecord: {
    existedBefore: boolean;
    fingerprint: string;
    lastOutcome: "written" | "removed";
  };
}

export interface MemoryLedger {
  projectIdentity: { canonicalRoot: string };
  desiredState: "enabled" | "disabled";
  enginePackage: string;
  trackedAcknowledged?: boolean;
  targets: Record<
    string,
    {
      existedBefore: boolean;
      fingerprint: string;
      lastOutcome: "written" | "removed" | "failed" | "skipped";
      detail?: string;
    }
  >;
  rulesSection: { inserted: boolean; fingerprint: string; agentsMdExistedBefore: boolean };
  claudeReference: { present: boolean; insertedByPier: boolean };
  pending: LedgerPending[];
}

export class LedgerStore {
  readonly #path: string;
  readonly #canonicalRoot: string;

  constructor(options: { dir: string; canonicalRoot: string }) {
    this.#canonicalRoot = options.canonicalRoot;
    this.#path = join(options.dir, "ledger.json");
  }

  static recover(
    pending: LedgerPending,
    currentFingerprint: string
  ):
    | { branch: 1; commit: LedgerPending["commitRecord"] }
    | { branch: 2 }
    | { branch: 3 } {
    if (currentFingerprint === pending.expectedFingerprint) {
      return { branch: 1, commit: pending.commitRecord };
    }
    if (currentFingerprint === pending.priorFingerprint) return { branch: 2 };
    return { branch: 3 };
  }

  async load(): Promise<MemoryLedger> {
    try {
      const raw = await readFile(this.#path, "utf8");
      return JSON.parse(raw) as MemoryLedger;
    } catch {
      return {
        projectIdentity: { canonicalRoot: this.#canonicalRoot },
        desiredState: "disabled",
        enginePackage: "@modelcontextprotocol/server-memory@0.6.3",
        targets: {},
        rulesSection: { inserted: false, fingerprint: "", agentsMdExistedBefore: true },
        claudeReference: { present: false, insertedByPier: false },
        pending: [],
      };
    }
  }

  async save(ledger: MemoryLedger): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.#path, `${JSON.stringify(ledger, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}
```

注：若 `writeFileAtomic` 类型不接受 `mode`，改为先 `writeFileAtomic(path, data)` 再 `await writeFile(path,{mode:0o600})` 二次收敛权限（保持原子主语义）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/ledger.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets/ledger.ts tests/unit/main/agent-managed-assets/ledger.test.ts
git commit -m "feat(memory): ownership ledger with WAL recovery branches"
```

---

### Task 7: store 管理 + 流式统计

**Files:**
- Create: `src/main/services/agent-managed-assets/store.ts`
- Test: `tests/unit/main/agent-managed-assets/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class MemoryStoreManager {
    constructor(options: { baseDir: string });            // baseDir = {userData}/plugin-data/pier.memory
    ensure(key: string): Promise<{ storePath: string }>;  // mkdir 0700；touch 文件 0600
    stats(storePath: string): Promise<{ entities: number | null; observations: number | null }>; // null=超限
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/agent-managed-assets/store.test.ts
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStoreManager } from "../../../src/main/services/agent-managed-assets/store.ts";

let dirs: string[] = [];
afterEach(() => { dirs = []; });

describe("MemoryStoreManager", () => {
  it("ensures dir and file with tight permissions", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    chmodSync(base, 0o755); // umask 允许下验证显式收紧
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("abc");
    expect(storePath).toBe(join(base, "abc", "memory.jsonl"));
    const { stats } = await import("node:fs/promises");
    expect((await stats(storePath)).mode & 0o777).toBe(0o600);
  });

  it("counts entities and observations", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("k");
    writeFileSync(storePath, [
      JSON.stringify({ type: "entity", name: "P", entityType: "convention", observations: ["a", "b"] }),
      "not json",
      JSON.stringify({ type: "relation", from: "P", to: "Q", relationType: "uses" }),
      "",
    ].join("\n"));
    expect(await mgr.stats(storePath)).toEqual({ entities: 1, observations: 2 });
  });

  it("returns null counts over the size budget", async () => {
    const base = mkdtempSync(join(tmpdir(), "pier-mem-store-"));
    dirs.push(base);
    const mgr = new MemoryStoreManager({ baseDir: base });
    const { storePath } = await mgr.ensure("big");
    writeFileSync(storePath, "x".repeat(9 * 1024 * 1024));
    expect(await mgr.stats(storePath)).toEqual({ entities: null, observations: null });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/store.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
// src/main/services/agent-managed-assets/store.ts
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export class MemoryStoreManager {
  readonly #baseDir: string;

  constructor(options: { baseDir: string }) {
    this.#baseDir = options.baseDir;
  }

  async ensure(key: string): Promise<{ storePath: string }> {
    const dir = join(this.#baseDir, key);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storePath = join(dir, "memory.jsonl");
    const handle = await open(storePath, "a", 0o600);
    await handle.close();
    return { storePath };
  }

  async stats(storePath: string): Promise<{
    entities: number | null;
    observations: number | null;
  }> {
    const info = await stat(storePath).catch(() => null);
    if (!info || info.size > MAX_SCAN_BYTES) {
      return { entities: null, observations: null };
    }
    let entities = 0;
    let observations = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(storePath, { encoding: "utf8" });
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk;
        let idx = buffer.indexOf("\n");
        while (idx >= 0) {
          this.#countLine(buffer.slice(0, idx), (_e, o) => {
            entities += _e;
            observations += o;
          });
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf("\n");
        }
      });
      stream.on("end", () => {
        this.#countLine(buffer, (_e, o) => {
          entities += _e;
          observations += o;
        });
        resolve();
      });
      stream.on("error", reject);
    });
    return { entities, observations };
  }

  #countLine(line: string, sink: (entities: number, observations: number) => void): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const row = JSON.parse(trimmed) as {
        type?: string;
        observations?: unknown[];
      };
      if (row.type === "entity") {
        sink(1, Array.isArray(row.observations) ? row.observations.length : 0);
      }
    } catch {
      // 破损行容忍
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/store.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets/store.ts tests/unit/main/agent-managed-assets/store.test.ts
git commit -m "feat(memory): store manager with permissioned files and streamed stats"
```

---

### Task 8: reconcile 引擎（恢复阶段 + 确认门 + 收敛 + 引导段）

**Files:**
- Create: `src/main/services/agent-managed-assets/reconcile.ts`
- Modify: `src/main/services/agent-rules/service.ts`（导出 `AGENTS_MD_TEMPLATE` 常量：把 `RULE_FILES` 中 agents-md 条目的 `template` 提为具名导出并复用）
- Test: `tests/unit/main/agent-managed-assets/reconcile.test.ts`

**Interfaces:**
- Consumes: Task 3–7 全部产物 + `FilePathTransactionLock`（`../files/path-transaction-lock.ts`）+ `agent-rules` service（ensure/read/write）+ `AssetRootRef`。
- Produces:
  ```ts
  export interface ReconcileDeps {
    lock: import("../files/path-transaction-lock.ts").FilePathTransactionLock;
    agentRules: import("../agent-rules/service.ts").AgentRulesService;
    listInstalledAgents: () => Promise<readonly AgentKind[]>;
    baseDir: string;                       // {userData}/plugin-data/pier.memory
    isTracked: (absolutePath: string) => Promise<boolean>;   // git check-ignore/check-tracked 注入
    now?: () => number;
  }
  export class MemoryReconciler {
    enable(root: Extract<AssetRootRef, { scope: "project" }>): Promise<ReconcileReport | NeedsConfirmation>;
    disable(root: Extract<AssetRootRef, { scope: "project" }>): Promise<ReconcileReport>;
    status(root: Extract<AssetRootRef, { scope: "project" }>): Promise<StatusSnapshot>;
  }
  type TargetRow = { configPath: string; consumers: string[]; outcome: "written"|"removed"|"failed"|"skipped"; detail?: string };
  export type ReconcileReport = { kind: "report"; state: "disabled"|"enabled"|"degraded"; targets: TargetRow[] };
  export type NeedsConfirmation = { kind: "needsConfirmation"; trackedTargets: string[] };
  ```
- 关键行为（spec §reconcile/WAL/引导段）：恢复阶段先清 pending（三分支）；enable 先过 tracked 确认门；引导段 marker 替换幂等；CLAUDE.md 引用只在缺失时插入并记 `insertedByPier`；AGENTS.md 自建且剩余内容等于模板时整文件删除。

- [ ] **Step 1: 写失败测试（核心四场景）**

```ts
// tests/unit/main/agent-managed-assets/reconcile.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePathTransactionLock } from "../../../../src/main/services/files/path-transaction-lock.ts";
import { createAgentRulesService } from "../../../../src/main/services/agent-rules/service.ts";
import { MemoryReconciler } from "../../../../src/main/services/agent-managed-assets/reconcile.ts";
// LocalEnvironment/PierHome 测试替身按 agent-rules 既有单测的 fake 形态复用（见其现有测试文件），
// 此处省略与被测行为无关的构造细节；engineer 参照
// tests/unit/main/ 下 agent-rules 既有测试的 stub 写法搭建 services。

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "pier-mem-rec-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return realpathSync(dir);
}

function makeReconciler(root: string, opts?: { tracked?: boolean }) {
  const lock = new FilePathTransactionLock();
  const agentRules = createAgentRulesService({
    /* 与既有 agent-rules 单测相同的内存/localEnvironment stub */
  } as never);
  return new MemoryReconciler({
    lock,
    agentRules,
    listInstalledAgents: async () => ["claude", "omp"],
    baseDir: join(root, ".pier-test-base"),
    isTracked: async () => opts?.tracked ?? false,
  });
}

describe("MemoryReconciler", () => {
  it("enable writes one merged target plus guidance section", async () => {
    const root = project();
    const rec = makeReconciler(root);
    const report = await rec.enable({ scope: "project", projectRootPath: root });
    expect(report.kind).toBe("report");
    if (report.kind !== "report") return;
    expect(report.state).toBe("enabled");
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers["pier-memory"].env.MEMORY_FILE_PATH).toContain("memory.jsonl");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- pier-managed:memory begin -->");
    expect(agents).toContain("search_nodes");
  });

  it("second enable is idempotent", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ scope: "project", projectRootPath: root });
    const again = await rec.enable({ scope: "project", projectRootPath: root });
    if (again.kind !== "report") throw new Error("expected report");
    expect(again.state).toBe("enabled");
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents.match(/pier-managed:memory begin/g)).toHaveLength(1);
  });

  it("disable removes entries, self-created skeleton and self-created AGENTS.md", async () => {
    const root = project();
    const rec = makeReconciler(root);
    await rec.enable({ scope: "project", projectRootPath: root });
    await rec.disable({ scope: "project", projectRootPath: root });
    expect(readdirSync(root)).not.toContain(".mcp.json");     // 自建骨架已删
    expect(readdirSync(root)).not.toContain("AGENTS.md");     // 自建模板已删
  });

  it("tracked targets gate first enable behind confirmation", async () => {
    const root = project();
    const rec = makeReconciler(root, { tracked: true });
    const gated = await rec.enable({ scope: "project", projectRootPath: root });
    expect(gated.kind).toBe("needsConfirmation");
    if (gated.kind !== "needsConfirmation") return;
    expect(gated.trackedTargets).toEqual([join(root, ".mcp.json")]);
    expect(() => readFileSync(join(root, ".mcp.json"))).toThrow();
    // ack 后放行：通过 status/enable 内部 ledger.trackedAcknowledged=true 重试
    await rec.acknowledgeTracked({ scope: "project", projectRootPath: root });
    const done = await rec.enable({ scope: "project", projectRootPath: root });
    expect(done.kind).toBe("report");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/reconcile.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（结构骨架，行为按 spec §reconcile）**

```ts
// src/main/services/agent-managed-assets/reconcile.ts
import { readFile, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AssetRootRef } from "@shared/contracts/agent/assets.ts";
import type { FilePathTransactionLock } from "../files/path-transaction-lock.ts";
import type { AgentRulesService } from "../agent-rules/service.ts";
import { AGENTS_MD_TEMPLATE } from "../agent-rules/service.ts";
import { LedgerStore, type LedgerPending, type MemoryLedger } from "./ledger.ts";
import {
  buildServerEntryFor,
  planJsonUpsert,
  planOpenCodeUpsert,
  planRemove,
  planTomlAppend,
  SERVER_KEY,
} from "./serializers.js";
import { selectMemoryTargets } from "./write-targets.js";
import { resolveProjectIdentity } from "./project-identity.js";
import { MemoryStoreManager } from "./store.js";

type ProjectRoot = Extract<AssetRootRef, { scope: "project" }>;

export interface ReconcileDeps {
  lock: FilePathTransactionLock;
  agentRules: AgentRulesService;
  listInstalledAgents: () => Promise<readonly AgentKind[]>;
  baseDir: string;
  isTracked: (absolutePath: string) => Promise<boolean>;
}

type TargetRow = {
  configPath: string;
  consumers: string[];
  outcome: "written" | "removed" | "failed" | "skipped";
  detail?: string;
};
export type ReconcileReport = {
  kind: "report";
  state: "disabled" | "enabled" | "degraded";
  targets: TargetRow[];
};
export type NeedsConfirmation = { kind: "needsConfirmation"; trackedTargets: string[] };

const SECTION_BEGIN = "<!-- pier-managed:memory begin -->";
const SECTION_END = "<!-- pier-managed:memory end -->";
const GUIDANCE_BODY = [
  "# Project memory (managed by Pier)",
  "",
  'You have persistent project memory tools from the "pier-memory" MCP server.',
  "Use them to make future sessions in this repository more effective:",
  "",
  "- Before starting a non-trivial task, call search_nodes with keywords of the task domain.",
  "- When you learn a durable fact, record it as an observation on the matching entity",
  "  (create the entity when absent). entityType MUST be one of:",
  "  convention | pitfall | decision | environment.",
  "- Do NOT record anything derivable from the codebase (file layout, dependency lists,",
  "  command --help output), transient task state, or secrets/tokens.",
  "- When you notice an observation is outdated, delete it (delete_observations).",
  "  This store has no automatic decay; pruning is your responsibility.",
  "- Keep observations atomic: one fact per observation, self-contained wording.",
].join("\n");
const SECTION_TEXT = `${SECTION_BEGIN}\n${GUIDANCE_BODY}\n${SECTION_END}`;

export class MemoryReconciler {
  readonly #deps: ReconcileDeps;

  constructor(deps: ReconcileDeps) {
    this.#deps = deps;
  }

  async #withLock<T>(fn: () => Promise<T>): Promise<T> {
    // FilePathTransactionLock 的具体 acquire API 以其现有导出为准（app-core 使用同款）。
    return this.#deps.lock.run([join(this.#deps.baseDir)], fn);
  }

  async acknowledgeTracked(root: ProjectRoot): Promise<void> {
    await this.#mutateLedger(root, (ledger) => {
      ledger.trackedAcknowledged = true;
    });
  }

  async #mutateLedger(
    root: ProjectRoot,
    mutate: (ledger: MemoryLedger) => Promise<void> | void
  ): Promise<MemoryLedger> {
    return this.#withLock(async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const store = new LedgerStore({
        dir: join(this.#deps.baseDir, identity.key),
        canonicalRoot: identity.canonicalRoot,
      });
      const ledger = await store.load();
      await mutate(ledger);
      await store.save(ledger);
      return ledger;
    });
  }

  async enable(root: ProjectRoot): Promise<ReconcileReport | NeedsConfirmation> {
    return this.#run(root, "enabled");
  }

  async disable(root: ProjectRoot): Promise<ReconcileReport> {
    const report = await this.#run(root, "disabled");
    if (report.kind !== "report") throw new Error("unreachable");
    return report;
  }

  async status(root: ProjectRoot): Promise<MemoryLedger & { storePath: string }> {
    return this.#mutateLedger(root, async (ledger) => {
      await this.#recoverPending(ledger);
    }).then(async (ledger) => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      return {
        ...ledger,
        storePath: join(
          this.#deps.baseDir,
          identity.key,
          "memory.jsonl"
        ),
      };
    });
  }

  async #run(
    root: ProjectRoot,
    desired: "enabled" | "disabled"
  ): Promise<ReconcileReport | NeedsConfirmation> {
    return this.#withLock(async () => {
      const identity = await resolveProjectIdentity(root.projectRootPath);
      const storeDir = join(this.#deps.baseDir, identity.key);
      const ledgerStore = new LedgerStore({ dir: storeDir, canonicalRoot: identity.canonicalRoot });
      const ledger = await ledgerStore.load();
      await this.#recoverPendingOn(ledger);

      const installed = await this.#deps.listInstalledAgents();
      const selected = selectMemoryTargets(installed);

      if (desired === "enabled" && !ledger.trackedAcknowledged) {
        const tracked: string[] = [];
        for (const target of selected) {
          const abs = join(root.projectRootPath, target.relativePath);
          if (await this.#deps.isTracked(abs)) tracked.push(abs);
        }
        if (tracked.length > 0) {
          await ledgerStore.save(ledger);
          return { kind: "needsConfirmation", trackedTargets: tracked };
        }
      }
      ledger.desiredState = desired;

      const rows: TargetRow[] = [];
      for (const target of selected) {
        const abs = join(root.projectRootPath, target.relativePath);
        const row = await this.#applyTarget({ ledger, abs, format: target.format, consumers: target.consumers, desired });
        rows.push(row);
        ledger.targets[abs] = {
          existedBefore: ledger.targets[abs]?.existedBefore ?? false,
          fingerprint: row.outcome === "written" ? ledger.targets[abs]?.fingerprint ?? "" : row.outcome === "removed" ? "" : ledger.targets[abs]?.fingerprint ?? "",
          lastOutcome: row.outcome,
          ...(row.detail ? { detail: row.detail } : {}),
        };
      }
      // 规则段
      const rulesRow = await this.#applyGuidance({ root, ledger, desired });
      rows.push(rulesRow);
      ledger.desiredState = desired;
      await ledgerStore.save(ledger);
      const unmet = rows.filter((r) => r.outcome === "failed").length;
      const state = desired === "enabled" ? (unmet > 0 ? "degraded" : "enabled") : unmet > 0 ? "degraded" : "disabled";
      return { kind: "report", state, targets: rows };
    });
  }

  async #recoverPendingOn(ledger: MemoryLedger): Promise<void> {
    const remaining: LedgerPending[] = [];
    for (const item of ledger.pending) {
      const current = await fingerprintOf(item.targetPath);
      const verdict = LedgerStore.recover(item, current);
      if (verdict.branch === 1) {
        this.#commitPending(ledger, item, verdict.commit);
      } else if (verdict.branch === 2) {
        remaining.push(item); // 留给本轮 reconcile 幂等重放
      } else {
        ledger.targets[item.targetPath] = {
          ...(ledger.targets[item.targetPath] ?? { existedBefore: true }),
          lastOutcome: "failed",
          detail: "conflict: third-party change during crash window",
        };
      }
    }
    ledger.pending = remaining;
  }

  #commitPending(ledger: MemoryLedger, item: LedgerPending, commit: LedgerPending["commitRecord"]): void {
    if (item.kind === "mcp-target") {
      ledger.targets[item.targetPath] = { ...commit };
    } else if (item.kind === "rules-section") {
      ledger.rulesSection = {
        inserted: commit.lastOutcome === "written",
        fingerprint: commit.fingerprint,
        agentsMdExistedBefore: ledger.rulesSection.agentsMdExistedBefore,
      };
    } else {
      ledger.claudeReference.present = commit.lastOutcome === "written";
    }
  }

  async #applyTarget(args: {
    ledger: MemoryLedger;
    abs: string;
    format: "mcp-servers-json" | "opencode-json" | "codex-toml";
    consumers: string[];
    desired: "enabled" | "disabled";
  }): Promise<TargetRow> {
    const { ledger, abs, format, desired } = args;
    const consumers = args.consumers.join(",");
    const record = ledger.targets[abs];
    if (record?.lastOutcome === "skipped") {
      return { configPath: abs, consumers, outcome: "skipped", detail: record.detail };
    }
    const raw = await readFile(abs, "utf8").catch((err: NodeJS.ErrnoException) =>
      err.code === "ENOENT" ? null : Promise.reject(err)
    );
    if (desired === "enabled") {
      const plan =
        format === "codex-toml"
          ? planTomlAppend(raw, await this.#storePathOf(ledger))
          : format === "opencode-json"
            ? planOpenCodeUpsert(raw, await this.#storePathOf(ledger))
            : planJsonUpsert(raw, await this.#storePathOf(ledger));
      if (!plan.ok) {
        return { configPath: abs, consumers, outcome: "failed", detail: plan.reason };
      }
      const existedBefore = raw !== null;
      const prior = raw === null ? "absent" : this.#entryFingerprintOrAbsent(raw, format);
      ledger.pending = [
        ...ledger.pending.filter((p) => p.targetPath !== abs),
        {
          kind: "mcp-target",
          targetPath: abs,
          action: "write",
          priorFingerprint: prior,
          expectedFingerprint: plan.fingerprint,
          commitRecord: { existedBefore, fingerprint: plan.fingerprint, lastOutcome: "written" },
        },
      ];
      await writeFileViaLock(abs, plan.next);
      const committed = ledger.pending.find((p) => p.targetPath === abs)!;
      this.#commitPending(ledger, committed, committed.commitRecord);
      ledger.pending = ledger.pending.filter((p) => p.targetPath !== abs);
      return { configPath: abs, consumers, outcome: "written" };
    }
    // disable
    if (!record || !record.fingerprint || raw === null) {
      return { configPath: abs, consumers, outcome: "skipped", detail: "nothing to remove" };
    }
    const plan = planRemove(raw, format);
    if (!plan.ok) return { configPath: abs, consumers, outcome: "failed", detail: plan.reason };
    if (plan.fingerprint !== record.fingerprint) {
      return { configPath: abs, consumers, outcome: "failed", detail: "drifted: not removing foreign changes" };
    }
    ledger.pending = [
      ...ledger.pending.filter((p) => p.targetPath !== abs),
      {
        kind: "mcp-target",
        targetPath: abs,
        action: "remove",
        priorFingerprint: record.fingerprint,
        expectedFingerprint: "absent",
        commitRecord: { existedBefore: record.existedBefore, fingerprint: "", lastOutcome: "removed" },
      },
    ];
    if (plan.next === null && !record.existedBefore) {
      await unlink(abs);
    } else if (plan.next !== null) {
      await writeFileViaLock(abs, plan.next);
    } else {
      await unlink(abs); // 内容为空的自建骨架也还原为不存在
    }
    const committed = ledger.pending.find((p) => p.targetPath === abs)!;
    this.#commitPending(ledger, committed, committed.commitRecord);
    ledger.pending = ledger.pending.filter((p) => p.targetPath !== abs);
    return { configPath: abs, consumers, outcome: "removed" };
  }

  async #applyGuidance(args: {
    root: ProjectRoot;
    ledger: MemoryLedger;
    desired: "enabled" | "disabled";
  }): Promise<TargetRow> {
    const { root, ledger, desired } = args;
    const ref = { scope: "project", projectRootPath: root.projectRootPath } as const;
    if (desired === "enabled") {
      const before = await this.#deps.agentRules
        .read(ref, "agents-md")
        .then((r) => true)
        .catch(() => false);
      await this.#deps.agentRules.ensure(ref, "agents-md");
      const read = await this.#deps.agentRules.read(ref, "agents-md");
      const updated = upsertSection(read.content, SECTION_TEXT);
      if (updated.changed) {
        await this.#deps.agentRules.write(ref, "agents-md", updated.content);
      }
      ledger.rulesSection = {
        inserted: true,
        fingerprint: sha(updated.sectionText),
        agentsMdExistedBefore: ledger.rulesSection.inserted
          ? ledger.rulesSection.agentsMdExistedBefore
          : before,
      };
      // CLAUDE.md 引用
      const claude = await this.#deps.agentRules
        .read(ref, "claude-md")
        .then((r) => r.content)
        .catch(() => null);
      if (claude !== null && !/^@AGENTS\.md\s*$/m.test(claude)) {
        const lines = claude.split("\n");
        lines.splice(1, 0, "@AGENTS.md");
        await this.#deps.agentRules.write(ref, "claude-md", lines.join("\n"));
        ledger.claudeReference = { present: true, insertedByPier: true };
      } else if (claude !== null) {
        ledger.claudeReference = { present: true, insertedByPier: ledger.claudeReference.insertedByPier };
      }
      return { configPath: join(root.projectRootPath, "AGENTS.md"), consumers: [], outcome: "written" };
    }
    // disable：去段；自建模板还原
    const read = await this.#deps.agentRules.read(ref, "agents-md").catch(() => null);
    if (read !== null) {
      const stripped = removeSection(read.content);
      const isSelfCreated =
        ledger.rulesSection.agentsMdExistedBefore === false &&
        stripped.trim() === AGENTS_MD_TEMPLATE.trim();
      await this.#deps.agentRules.write(ref, "agents-md", stripped);
      if (isSelfCreated) {
        await unlink(join(root.projectRootPath, "AGENTS.md"));
      }
      ledger.rulesSection = { inserted: false, fingerprint: "", agentsMdExistedBefore: ledger.rulesSection.agentsMdExistedBefore };
    }
    if (ledger.claudeReference.present && ledger.claudeReference.insertedByPier) {
      const claude = await this.#deps.agentRules
        .read(ref, "claude-md")
        .then((r) => r.content)
        .catch(() => null);
      if (claude !== null) {
        const removed = claude.replace(/^@AGENTS\.md\n/m, "");
        await this.#deps.agentRules.write(ref, "claude-md", removed);
      }
      ledger.claudeReference = { present: false, insertedByPier: false };
    }
    return { configPath: join(root.projectRootPath, "AGENTS.md"), consumers: [], outcome: "removed" };
  }

  async #storePathOf(ledger: MemoryLedger): Promise<string> {
    const key = await (async () => ledger.projectIdentity.canonicalRoot)();
    throw new Error("replace: store path comes from ensure() in caller scope");
  }
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprintOf(path: string): Promise<string> {
  return readFile(path, "utf8").then(
    (content) => {
      // 目标实况指纹 = 托管切片指纹；此处简化为内容整体指纹并在实现中
      // 按 format 取切片（JSON: entry 序列化；TOML: marker 块）。
      return sha(content);
    },
    () => "absent"
  );
}

function upsertSection(content: string, sectionText: string): { changed: boolean; content: string; sectionText: string } {
  const begin = content.indexOf(SECTION_BEGIN);
  const end = content.indexOf(SECTION_END);
  if (begin >= 0 && end >= 0) {
    const next = `${content.slice(0, begin)}${sectionText}${content.slice(end + SECTION_END.length)}`;
    return { changed: next !== content, content: next, sectionText };
  }
  const base = content.endsWith("\n") || content === "" ? content : `${content}\n`;
  return { changed: true, content: `${base}\n${sectionText}\n`, sectionText };
}

function removeSection(content: string): string {
  const begin = content.indexOf(SECTION_BEGIN);
  const end = content.indexOf(SECTION_END);
  if (begin < 0 || end < 0) return content;
  return `${content.slice(0, begin)}${content.slice(end + SECTION_END.length)}`.replace(/\n{3,}/g, "\n\n");
}

async function writeFileViaLock(path: string, content: string): Promise<void> {
  const { default: writeFileAtomic } = await import("write-file-atomic");
  await writeFileAtomic(path, content);
}

async function ensureStorePath(baseDir: string, key: string): Promise<string> {
  const manager = new MemoryStoreManager({ baseDir });
  return (await manager.ensure(key)).storePath;
}

export { ensureStorePath };
```

实现说明（engineer 必读，均为设计意图而非可删项）：
1. `#storePathOf` 的占位抛错必须在最终实现里消除：`#run` 在进入 target 循环前先 `const identity2 = await resolveProjectIdentity(...); const storePath = await ensureStorePath(this.#deps.baseDir, identity2.key);` 并把它传进 `#applyTarget`。上面骨架保留占位是为了让接口形状先被测试驱动出来。
2. `#withLock` 的锁 API：以 `FilePathTransactionLock` 现有公开方法签名为准（阅读 `src/main/services/files/path-transaction-lock.ts` 与 app-core 内调用点后适配）；语义要求是「同一实例互斥、目录粒度覆盖后代」。
3. `fingerprintOf` 必须按 format 取**托管切片**指纹（复用 serializers 的指纹定义），不能用全文 hash——否则任何无关编辑都会被判成漂移。
4. `createAgentRulesService` 的测试 stub：参照仓库中既有 agent-rules 单测的 fake（搜索 `tests/unit` 下引用 `createAgentRulesService` 的文件），不要另起炉灶。
5. 本文件预计 >300 行；若逼近 500 行硬帽，把 `#applyGuidance` 拆到 `guidance.ts`（同目录），拆分属任务内自由度。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/reconcile.test.ts`
Expected: PASS（4 tests）；随后 `pnpm vitest run tests/unit/main/agent-managed-assets` 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agent-managed-assets docs/superpowers/specs docs/superpowers/plans
git commit -m "feat(memory): reconcile engine with WAL recovery, confirmation gate and guidance section"
```

---

### Task 9: 命令面（contracts + metadata + executor + 装配）

**Files:**
- Modify: `src/shared/contracts/memory.ts`（新建）+ `src/shared/contracts/commands.ts`（union 追加三个 request/result）
- Modify: `src/main/app-core/command-metadata.ts`（三条目）
- Create: `src/main/app-core/commands/memory.ts`
- Modify: `src/main/app-core/pier-home.ts`（services 增加 `projectMemory` 构造，`listInstalledAgents` 复用 `createAgentMcpCatalogService` 同款注入值）
- Modify: `src/main/app-core/command-router.ts`（executors 数组追加 memory executor）
- Test: `tests/unit/main/agent-managed-assets/commands.test.ts`

**Interfaces:**
- Produces（shared 契约，strict zod）:
  ```ts
  // src/shared/contracts/memory.ts
  export const memoryRootRequestSchema = z.object({ root: assetRootRefSchema }).strict();
  export const memoryTargetRowSchema = z.object({
    configPath: z.string(), consumers: z.array(z.string()),
    outcome: z.enum(["written", "removed", "failed", "skipped"]), detail: z.string().optional(),
  }).strict();
  export const memoryReportSchema = z.object({
    kind: z.literal("report"),
    state: z.enum(["disabled", "enabled", "degraded"]),
    targets: z.array(memoryTargetRowSchema),
  }).strict();
  export const memoryEnableResultSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("needsConfirmation"), trackedTargets: z.array(z.string()) }).strict(),
    memoryReportSchema.extend({}),   // kind:"report"
  ]).strict();
  export const memoryStatusSnapshotSchema = z.object({
    desiredState: z.enum(["enabled", "disabled"]),
    derivedState: z.enum(["disabled", "enabled", "degraded"]),
    enginePackage: z.string(),
    storePath: z.string(),
    targets: z.array(memoryTargetRowSchema),
    entityCount: z.number().int().nonnegative().nullable(),
    observationCount: z.number().int().nonnegative().nullable(),
  }).strict();
  ```
- commands.ts 追加：
  ```ts
  z.object({ root: assetRootRefSchema, type: z.literal("memory.enable") }).strict(),
  z.object({ root: assetRootRefSchema, type: z.literal("memory.disable") }).strict(),
  z.object({ root: assetRootRefSchema, type: z.literal("memory.status") }).strict(),
  ```
- metadata：
  ```ts
  "memory.enable": { allowedClientKinds: ["desktop-renderer"], capabilities: ["managedAssets:write"] },
  "memory.disable": { allowedClientKinds: ["desktop-renderer"], capabilities: ["managedAssets:write"] },
  "memory.status": { allowedClientKinds: ["desktop-renderer"], capabilities: ["workspace:read"] },
  ```

- [ ] **Step 1: 写失败测试（授权 + executor 分派）**

```ts
// tests/unit/main/agent-managed-assets/commands.test.ts
import { describe, expect, it } from "vitest";
import { authorizeCommand } from "../../../../src/main/app-core/permissions.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { createPluginPrincipalClient } from "../../../../src/main/app-core/permissions.ts";

const enableCmd = {
  root: { scope: "project", projectRootPath: "/p" },
  type: "memory.enable",
} as unknown as PierCommand;

const desktop = {
  id: "w1", kind: "desktop-renderer", createdAt: 0, lastSeenAt: 0,
  capabilities: ["workspace:read", "panel:open", "managedAssets:write"],
} as const;

describe("memory command authorization", () => {
  it("desktop-renderer with managedAssets:write passes", () => {
    expect(authorizeCommand(enableCmd, { ...desktop })).toEqual({ ok: true });
  });
  it("plugin principal denied (allowPluginPrincipals absent)", () => {
    const client = createPluginPrincipalClient("pier.memory", ["managedAssets:write"]);
    expect(authorizeCommand(enableCmd, client).ok).toBe(false);
  });
  it("cli-local denied by client-kind allowlist", () => {
    const cli = { id: "c", kind: "cli-local", createdAt: 0, lastSeenAt: 0, capabilities: ["managedAssets:write"] } as const;
    expect(authorizeCommand(enableCmd, cli).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/commands.test.ts`
Expected: FAIL（metadata 缺条目 → missing capability / unknown）

- [ ] **Step 3: 实现**

按 Interfaces 区代码落盘 `src/shared/contracts/memory.ts`；`commands.ts` 的 discriminated union 追加三个成员（位置紧跟 `rules.*` 成员之后，保持资产类聚拢）；metadata 表追加三行；executor：

```ts
// src/main/app-core/commands/memory.ts
import type { RequestMessage, ResponseMessage } from "../../ipc-types.ts"; // 以 agent-assets.ts 实际 import 为准
import { failure, success } from "../../ipc-envelope-main.ts";             // 同上，对齐 agent-assets.ts

export function executeMemoryCommand(services: {
  projectMemory?: {
    enable(root: never): Promise<unknown>;
    disable(root: never): Promise<unknown>;
    status(root: never): Promise<unknown>;
  };
}) {
  return async (
    requestId: string,
    command: { type: string; root?: unknown },
  ): Promise<ResponseMessage | null> => {
    if (!services.projectMemory) return null;
    switch (command.type) {
      case "memory.enable":
        return success(requestId, await services.projectMemory.enable(command.root as never));
      case "memory.disable":
        return success(requestId, await services.projectMemory.disable(command.root as never));
      case "memory.status":
        return success(requestId, await services.projectMemory.status(command.root as never));
      default:
        return null;
    }
  };
}
```

类型细节（`success/failure`、消息类型名）以 `src/main/app-core/commands/agent-assets.ts` 头部实际 import 为准逐字对齐——该文件的函数签名模式是本任务的模板。`pier-home.ts`：在 services 接口加 `projectMemory` 字段，构造处：

```ts
const projectMemory = new MemoryReconciler({
  lock: filePathTransactionLock,        // 与 app-core 文件操作同一单例
  agentRules,
  listInstalledAgents,                  // 与 createAgentMcpCatalogService 同一注入值
  baseDir: join(userData, "plugin-data", "pier.memory"),
  isTracked: async (abs) => {
    const rel = relative(projectRootOf(abs), abs); // 由 executor 层换算；实现按 pier-home 现有 git 工具选择 check-tracked 方式
    return false; // TODO 由 Step 3b 补齐真实实现
  },
});
```

**Step 3b（tracked 判定真实实现）**：`isTracked` 用 `execFile("git", ["-C", root, "ls-files", "--error-unmatch", rel])`——退出码 0 即 tracked；非 git 目录直接 false。禁止留 TODO。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/main/agent-managed-assets/commands.test.ts && pnpm vitest run tests/unit/main`
Expected: PASS；全量 main 单测无回归。

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/memory.ts src/shared/contracts/commands.ts src/main/app-core/command-metadata.ts src/main/app-core/commands/memory.ts src/main/app-core/pier-home.ts src/main/app-core/command-router.ts tests/unit/main/agent-managed-assets/commands.test.ts
git commit -m "feat(memory): pier.memory commands wired through router authorization"
```

---

### Task 10: preload bridge

**Files:**
- Create: `src/preload/memory-api.ts`
- Modify: `src/preload/index.ts`（挂载到全局，形态照抄 `agentAssetsApi` 的注册方式）
- Test: `tests/unit/preload/memory-api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PierMemoryAPI {
    enable(root: AssetRootRef): Promise<MemoryEnableResult>;
    disable(root: AssetRootRef): Promise<MemoryReport>;
    status(root: AssetRootRef): Promise<MemoryStatusSnapshot>;
  }
  ```
- [ ] **Step 1: 失败测试**（仿 `tests/unit/preload/git-api.test.ts` 的 mock `invokePierCommand` 手法，断言 payload `{ type: "memory.enable", root }` 透传）
- [ ] **Step 2:** Run `pnpm vitest run tests/unit/preload/memory-api.test.ts` → FAIL
- [ ] **Step 3: 实现**

```ts
// src/preload/memory-api.ts
import type { AssetRootRef } from "@shared/contracts/agent/assets.ts";
import type {
  MemoryEnableResult,
  MemoryReport,
  MemoryStatusSnapshot,
} from "@shared/contracts/memory.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierMemoryAPI {
  enable(root: AssetRootRef): Promise<MemoryEnableResult>;
  disable(root: AssetRootRef): Promise<MemoryReport>;
  status(root: AssetRootRef): Promise<MemoryStatusSnapshot>;
}

export const memoryApi: PierMemoryAPI = {
  disable: (root) => invokePierCommand({ root, type: "memory.disable" }),
  enable: (root) => invokePierCommand({ root, type: "memory.enable" }),
  status: (root) => invokePierCommand({ root, type: "memory.status" }),
};
```

`index.ts`：在与 `agentAssetsApi` 相同的聚合对象上加 `memory: memoryApi`（键名与全局类型同步处参考 `api-types.ts` 对 `agentAssetsApi` 的声明方式，逐字对齐）。
- [ ] **Step 4:** Run `pnpm vitest run tests/unit/preload` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/preload/memory-api.ts src/preload/index.ts src/preload/api-types.ts tests/unit/preload/memory-api.test.ts
git commit -m "feat(preload): expose pier.memory commands to renderer"
```

---

### Task 11: 插件 facade（context.projectMemory）

**Files:**
- Modify: `src/plugins/api/renderer.ts`（`RendererPluginContext` 增加 `projectMemory` 字段类型）
- Modify: `src/renderer/lib/plugins/host/context.ts`（宿主实现；构建 context 时对本插件 `assertPluginCapability(<pluginEntry>, "managedAssets:write")` 后挂载三方法，内部调 `window.pier.memory.*`）
- Test: `tests/unit/renderer/plugin-memory-facade.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  projectMemory: {
    enable(root: AssetRootRef): Promise<MemoryEnableResult>;
    disable(root: AssetRootRef): Promise<MemoryReport>;
    status(root: AssetRootRef): Promise<MemoryStatusSnapshot>;
  };
  ```
- [ ] **Step 1: 失败测试**：渲染一个带 manifest permissions `["managedAssets:write"]` 的最小插件 context，断言 `context.projectMemory.enable` 被调用时转发到 mock 的 `window.pier.memory.enable`；再断言无权限插件访问 `context.projectMemory` 时抛能力断言错误（沿用 `assertPluginCapability` 既有错误形态，参考 `comments` 能力在 context.ts 的挂载分支写法）。
- [ ] **Step 2:** Run `pnpm vitest run tests/unit/renderer/plugin-memory-facade.test.tsx` → FAIL
- [ ] **Step 3: 实现**：完全平行于 `context.comments` 的现有挂载模式（capability 有则挂、无则不挂）。
- [ ] **Step 4:** Run → PASS；`pnpm vitest run tests/unit/renderer` 无回归。
- [ ] **Step 5: Commit**

```bash
git add src/plugins/api/renderer.ts src/renderer/lib/plugins/host/context.ts tests/unit/renderer/plugin-memory-facade.test.tsx
git commit -m "feat(plugins): projectMemory facade behind managedAssets:write assertion"
```

---

### Task 12: builtin 插件 pier.memory（manifest/面板/locales/治理测试）

**Files:**
- Create: `src/plugins/builtin/memory/manifest.ts`、`main/index.ts`（空激活壳，照抄 git 版）、`renderer/index.tsx`、`locales/{en,zh-CN,ja,ko}.json`
- Test: `tests/unit/plugins/pier-memory-governance.test.ts` + 面板组件测试 `tests/unit/plugins/pier-memory-panel.test.tsx`

**Interfaces:**
- Consumes: `context.projectMemory`（Task 11）、面板注册 API（照 files 插件 `panels` 声明 + renderer 注册调用）。

manifest 片段：

```ts
export const MEMORY_PLUGIN_ID = "pier.memory";
export const MEMORY_PANEL_ID = "pier.memory.panel";

export const MEMORY_PLUGIN_MANIFEST: PluginManifest = {
  apiVersion: 1,
  name: "Memory",
  panels: [{
    component: "memory",
    id: MEMORY_PANEL_ID,
    permissions: ["workspace:read", "panel:open"],
    title: "Project Memory",
  }],
  permissions: ["workspace:read", "panel:register", "panel:open", "managedAssets:write"],
  source: { kind: "builtin" },
};
```

locales（en 示例；zh-CN/ja/ko 同键位翻译，中文用「项目记忆」「启用」「停用」「已连接 N 个智能体」「记忆文件位置」「部分接入失败」「查看详情」「引擎版本」词组）：

```json
{
  "panel.title": "Project Memory",
  "switch.enable": "Enable project memory",
  "state.enabled": "Enabled",
  "state.disabled": "Off",
  "state.degraded": "Partially connected",
  "summary.connected": "Connected for {count} agents",
  "summary.store": "Memory file location",
  "summary.engine": "Engine version",
  "degraded.details": "View details",
  "confirm.tracked.title": "Share memory configuration through git?",
  "confirm.tracked.body": "Memory lives on this machine. These project configs are usually committed, so they won't work on other machines.",
  "first.claudeTrust": "Claude Code asks one-time approval for project MCP servers on first use."
}
```

面板组件行为（TDD 两测）：
1. 挂载调 `status` 渲染派生状态与摘要；Switch 切换调 `enable`/`disable`；返回 `needsConfirmation` 时弹 `dialogs.confirm`（intent=default，文案 `confirm.tracked.*`），确认后重发 enable。
2. degraded 时渲染内联告警行 + 「View details」打开 `dialogs.alert` 列出 targets outcome；全程无 toast。

治理测试 `pier-memory-governance.test.ts` 锁定：本设计标题字符串存在于 spec 文件；四类 entityType 枚举集合；`SECTION_BEGIN/END` marker 常量单一来源（从 reconcile.ts 导入而非复制）；`managedAssets:write` 仅出现在 desktop-renderer 默认集（复用 Task 1 断言逻辑防回归）；locale 四语言键集合一致。

步骤节奏同前：失败测试 → FAIL → 实现 → PASS → Commit：

```bash
git add src/plugins/builtin/memory tests/unit/plugins/pier-memory-governance.test.ts tests/unit/plugins/pier-memory-panel.test.tsx
git commit -m "feat(plugins): pier.memory builtin panel with governed copy and locales"
```

---

### Task 13: 终验（全量门禁 + e2e 外递）

- [ ] `pnpm check:file-size && pnpm check:dir-density`
- [ ] `pnpm vitest run tests/unit/main/agent-managed-assets tests/unit/plugins tests/unit/preload tests/unit/shared`
- [ ] `pnpm preflight:push`（static + unit + component + plugin-index）
- [ ] 行为冒烟（手动脚本，记录输出到 PR 描述）：临时目录建 git 仓 → 通过面板 enable → 检查 `.mcp.json`/AGENTS.md → `claude -p` 会话写入一条记忆 → search 召回 → disable → 配置与 AGENTS.md 还原。
- [ ] Commit（如有门禁修正）：

```bash
git add -u
git commit -m "fix(memory): gate fixes from full preflight"
```

## Self-Review 记录

- Spec 覆盖核对：capability(T1)、facts(T3)、projectKey(T4)、serializer fixtures(T5)、ledger+WAL(T6)、store/stats(T7)、reconcile/确认门/引导段(T8)、命令授权接线(T9)、preload(T10)、facade(T11)、插件表面/i18n/治理检查点(T12)、门禁(T13)。L2 项不在计划内。
- 占位符扫描：T8 骨架中的两处「实现说明」是显式设计意图（消除占位的指令已写明），非 TBD；T9 Step3b 给出 isTracked 真实实现，禁留 TODO。
- 类型一致性：`MemoryConfigFormat` 三值贯穿 T3/T5/T8；`LedgerPending` 字段与 spec §ledger 逐字段一致；命令名 `memory.enable/disable/status` 贯穿 T9/T10/T11/T12。
