# 项目记忆设置页 Implementation Plan

> **状态（2026-08-27，已收尾）**：本计划按修订后的 spec 落地时发生偏航修正——最终表面走宿主
> `projectSettings` 贡献点（设置 → 项目 → 项目记忆 tab，见同日 spec），**不再**使用 Task 5 的内置
> `settingsPages.register` 与 Task 7 的「插件自列项目 + 钻取」结构；内置 settingsPages 通道已删除
> （外部插件的 settingsPages 不受影响）。`deleteObservation` 契约在收尾时增加了 `observation`
> 原文校验参数。本文仅作历史记录，现状以两份 spec 与源码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `pier.memory` 的产品表面从 dockview 面板改成插件设置页：先项目列表、再钻取详情（横向开关 + 可删 observation）。

**Architecture:** 引擎与 MCP 托管不变。新增 JSONL 读写（list / deleteObservation / clearStore）经现有 `memory.*` 命令与 `context.projectMemory` 暴露。内置插件补 `settingsPages.register`（与 Codex 同注册表）。页面只 import `@plugins/api` + `@shared` + `@pier/ui`。

**Tech Stack:** TypeScript 6 strict · Vitest · `@pier/ui` Card/Field/Switch/Item/Empty/StatusStack · 现有 `FilePathTransactionLock` · `write-file-atomic`

## Global Constraints

- Spec：`docs/superpowers/specs/2026-08-27-project-memory-settings-ui-design.md`；引擎仍以 `2026-08-26-project-memory-plugin-design.md` 为准。
- 引擎包精确固定 `@modelcontextprotocol/server-memory@2026.7.4`。
- 内置插件只可 import `src/plugins/api`、`src/shared`、`packages/ui`。禁止 import 宿主 `pages/settings` / stores。
- 设置壳：单列 `flex w-full max-w-[62rem] flex-col gap-4 px-4 pb-8`；`h1` 在卡片外；钻取对齐「设置 → 项目」；禁止内容区左右分栏。
- 开关：`Field orientation="horizontal"`（与宿主 `SwitchRow` 同构）。健康信息：卡内 `StatusStack`。删除：`Trash2` + `icon-sm` ghost。
- 列表项目经 `context.environments.snapshot()`，故 manifest 增加 `environment:read`。
- 文案走插件 locale；中文产品词：智能体、记忆文件位置、工作树。
- 开关/删除无成功 toast。失败 `dialogs.alert`。破坏性 `dialogs.confirm` + `intent: "destructive"`。
- 单文件 ≤500 行；目录密度硬上限见 `.pier/dir-density.json`。
- **不要 `git commit`，除非用户当场要求。** 下列「Commit」步骤一律 Skip。
- 测试：`pnpm vitest run <file>`。

---

## File map

| 文件 | 职责 |
|---|---|
| `src/shared/contracts/agent/memory.ts` | list/delete/clear 契约 |
| `src/main/services/agent-managed-assets/jsonl.ts` | JSONL 列出/删除/清空 |
| `src/main/services/agent-managed-assets/reconcile.ts` | Reconciler 三个新方法 |
| `src/main/app-core/commands/memory.ts` + `asset-metadata.ts` + `commands.ts` | 命令接线 |
| `src/preload/memory/api.ts` | preload |
| `src/plugins/api/renderer-facades.ts` + host `project-memory-context.ts` | facade |
| `src/renderer/lib/plugins/host/settings-pages-context.ts` | 内置 settingsPages.register |
| `src/plugins/builtin/memory/manifest.ts` + locales + `renderer/index.tsx` | 声明设置页、卸面板 |
| `src/plugins/builtin/memory/renderer/settings-page.tsx` 等 | UI |
| 删除 `renderer/panel.tsx` | 切走面板 |

---

### Task 1: list / delete / clear 契约

**Files:**
- Modify: `src/shared/contracts/agent/memory.ts`
- Modify: `src/shared/contracts/commands.ts`（memory 三段落后追加三个 schema）
- Test: `tests/unit/shared/permissions-memory.test.ts`（已有 capability 测；本任务加 schema parse 测到 `tests/unit/main/agent-managed-assets/memory-contract.test.ts`）

**Interfaces:**
- Produces:
  ```ts
  export const MEMORY_ENTITY_TYPES = [
    "convention",
    "pitfall",
    "decision",
    "environment",
  ] as const;
  export type MemoryEntityType = (typeof MEMORY_ENTITY_TYPES)[number];
  export interface MemoryObservationItem {
    entityName: string;
    entityType: MemoryEntityType;
    index: number;
    observation: string;
  }
  export interface MemoryListResult {
    items: MemoryObservationItem[];
    tooLarge: boolean;
  }
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/main/agent-managed-assets/memory-contract.test.ts
import { describe, expect, it } from "vitest";
import {
  memoryDeleteObservationRequestSchema,
  memoryListResultSchema,
} from "@shared/contracts/agent/memory.ts";

describe("memory list/delete contracts", () => {
  it("parses a list result", () => {
    expect(
      memoryListResultSchema.parse({
        items: [
          {
            entityName: "pnpm",
            entityType: "convention",
            index: 0,
            observation: "use pnpm",
          },
        ],
        tooLarge: false,
      }).items
    ).toHaveLength(1);
  });

  it("rejects unknown entityType", () => {
    expect(
      memoryListResultSchema.safeParse({
        items: [
          {
            entityName: "x",
            entityType: "note",
            index: 0,
            observation: "x",
          },
        ],
        tooLarge: false,
      }).success
    ).toBe(false);
  });

  it("requires entityName and index to delete", () => {
    expect(
      memoryDeleteObservationRequestSchema.safeParse({
        entityName: "pnpm",
        index: 0,
        root: { projectRootPath: "/r", scope: "project" },
      }).success
    ).toBe(true);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run tests/unit/main/agent-managed-assets/memory-contract.test.ts` → FAIL（schema 不存在）

- [ ] **Step 3: 实现**

在 `src/shared/contracts/agent/memory.ts` 现有 schema 之后追加（保留 `assetRootRefSchema` import）：

```ts
export const MEMORY_ENTITY_TYPES = [
  "convention",
  "pitfall",
  "decision",
  "environment",
] as const;

export const memoryEntityTypeSchema = z.enum(MEMORY_ENTITY_TYPES);

export const memoryObservationItemSchema = z
  .object({
    entityName: z.string().min(1),
    entityType: memoryEntityTypeSchema,
    index: z.number().int().nonnegative(),
    observation: z.string().min(1),
  })
  .strict();

export const memoryListResultSchema = z
  .object({
    items: z.array(memoryObservationItemSchema),
    tooLarge: z.boolean(),
  })
  .strict();

export const memoryDeleteObservationRequestSchema = z
  .object({
    entityName: z.string().min(1),
    index: z.number().int().nonnegative(),
    root: assetRootRefSchema,
  })
  .strict();

export type MemoryEntityType = z.infer<typeof memoryEntityTypeSchema>;
export type MemoryObservationItem = z.infer<typeof memoryObservationItemSchema>;
export type MemoryListResult = z.infer<typeof memoryListResultSchema>;
```

`src/shared/contracts/commands.ts` 在 `memory.status` 成员后插入：

```ts
  memoryRootRequestSchema.extend({
    type: z.literal("memory.list"),
  }),
  memoryDeleteObservationRequestSchema.extend({
    type: z.literal("memory.deleteObservation"),
  }),
  memoryRootRequestSchema.extend({
    type: z.literal("memory.clearStore"),
  }),
```

并在该文件顶部从 `@shared/contracts/agent/memory.ts` 增加 `memoryDeleteObservationRequestSchema` 的 import（`memoryRootRequestSchema` 应已存在）。

- [ ] **Step 4:** 同上 vitest → PASS；`pnpm typecheck:host` 会因 metadata 未覆盖新 type 失败——下一任务修。若本步 typecheck 因 exhaustive metadata 红，先进入 Task 2 补 metadata，不要用 `as any`。

- [ ] **Step 5: Commit** Skip.

---

### Task 2: 命令 metadata + executor 分派（先让 typecheck 过）

**Files:**
- Modify: `src/main/app-core/commands/asset-metadata.ts`
- Modify: `src/main/app-core/commands/memory.ts`
- Test: `tests/unit/main/agent-managed-assets/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 的 command type 字面量。
- Produces: `executeMemoryCommand` 识别 `memory.list` / `memory.deleteObservation` / `memory.clearStore`（实现可先 throw「not implemented」，但必须分派到 `services.projectMemory` 新方法——Task 3 再实现方法。为避免半拉子，本任务 metadata + 授权测试；executor 在 Task 3 一起接上。）

本任务只补 **metadata**，让 `CommandMetadata` exhaustive Record 过 typecheck。

- [ ] **Step 1:** 在 `commands.test.ts` 追加：

```ts
it("authorizes list/delete/clear for desktop-renderer only", () => {
  const listCmd = {
    root: { projectRootPath: "/p", scope: "project" as const },
    type: "memory.list" as const,
  };
  expect(authorizeCommand(listCmd, desktop)).toEqual({ ok: true });
  expect(authorizeCommand(listCmd, cli).ok).toBe(false);
});
```

（`desktop` / `cli` 沿用该文件已有 `PierClient` 夹具。）

- [ ] **Step 2:** 跑该文件 → FAIL（metadata 缺 type）

- [ ] **Step 3:** `asset-metadata.ts` 的 key union 与对象增加：

```ts
  "memory.list": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.deleteObservation": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
  "memory.clearStore": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["managedAssets:write"],
  },
```

- [ ] **Step 4:** `pnpm vitest run tests/unit/main/agent-managed-assets/commands.test.ts` → PASS；`pnpm typecheck:host` → PASS（executor 尚未处理新 type 时，`executeMemoryCommand` 会 return null，路由视为 unknown。下一任务必须接上，禁止把新命令留在 null 分支。）

- [ ] **Step 5: Commit** Skip.

---

### Task 3: JSONL list / delete / clear + Reconciler + executor

**Files:**
- Create: `src/main/services/agent-managed-assets/jsonl.ts`
- Modify: `src/main/services/agent-managed-assets/store.ts`（可选：re-export MAX_SCAN_BYTES）
- Modify: `src/main/services/agent-managed-assets/reconcile.ts`
- Modify: `src/main/app-core/commands/memory.ts`
- Test: `tests/unit/main/agent-managed-assets/jsonl.test.ts`

**Interfaces:**
- Consumes: `MEMORY_ENTITY_TYPES`、`MemoryListResult`
- Produces:
  ```ts
  export const MEMORY_JSONL_MAX_BYTES = 8 * 1024 * 1024;
  export function parseMemoryItems(raw: string): MemoryObservationItem[];
  export function deleteMemoryObservation(
    raw: string,
    entityName: string,
    index: number
  ): { next: string } | { error: "not-found" };
  export async function readMemoryList(storePath: string): Promise<MemoryListResult>;
  export async function writeMemoryJsonl(storePath: string, raw: string): Promise<void>;
  ```
  `MemoryReconciler` 增加：
  ```ts
  list(root: ProjectRoot): Promise<MemoryListResult>;
  deleteObservation(root: ProjectRoot, entityName: string, index: number): Promise<void>;
  clearStore(root: ProjectRoot): Promise<void>;
  ```

- [ ] **Step 1: 写 jsonl 单测**（tmp 文件）

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteMemoryObservation,
  parseMemoryItems,
  readMemoryList,
} from "../../../src/main/services/agent-managed-assets/jsonl.ts";

const lines = [
  JSON.stringify({
    entityType: "convention",
    name: "pnpm",
    observations: ["use pnpm", "lockfile committed"],
    type: "entity",
  }),
  JSON.stringify({
    from: "pnpm",
    to: "node",
    type: "relation",
  }),
  JSON.stringify({
    entityType: "note",
    name: "skip",
    observations: ["hidden"],
    type: "entity",
  }),
].join("\n");

describe("memory jsonl", () => {
  it("lists only four entityTypes and skips relations", () => {
    const items = parseMemoryItems(lines);
    expect(items.map((row) => row.observation)).toEqual([
      "use pnpm",
      "lockfile committed",
    ]);
    expect(items[0]).toMatchObject({
      entityName: "pnpm",
      entityType: "convention",
      index: 0,
    });
    expect(items[1]?.index).toBe(1);
  });

  it("deletes by entityName and index", () => {
    const result = deleteMemoryObservation(lines, "pnpm", 0);
    if ("error" in result) throw new Error("expected next");
    const items = parseMemoryItems(result.next);
    expect(items.map((row) => row.observation)).toEqual(["lockfile committed"]);
    expect(items[0]?.index).toBe(0);
  });

  it("returns not-found for bad index", () => {
    expect(deleteMemoryObservation(lines, "pnpm", 9)).toEqual({
      error: "not-found",
    });
  });

  it("marks tooLarge when file exceeds cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-mem-jsonl-"));
    const path = join(dir, "memory.jsonl");
    writeFileSync(path, "x".repeat(8 * 1024 * 1024 + 1));
    await expect(readMemoryList(path)).resolves.toEqual({
      items: [],
      tooLarge: true,
    });
  });
});
```

- [ ] **Step 2:** `pnpm vitest run tests/unit/main/agent-managed-assets/jsonl.test.ts` → FAIL

- [ ] **Step 3: 实现 `jsonl.ts`**

```ts
import { readFile, stat } from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import {
  MEMORY_ENTITY_TYPES,
  type MemoryListResult,
  type MemoryObservationItem,
} from "@shared/contracts/agent/memory.ts";

export const MEMORY_JSONL_MAX_BYTES = 8 * 1024 * 1024;
const ENTITY_TYPE_SET = new Set<string>(MEMORY_ENTITY_TYPES);

type EntityLine = {
  entityType?: unknown;
  name?: unknown;
  observations?: unknown;
  type?: unknown;
};

function isEntityLine(row: EntityLine): row is EntityLine & {
  entityType: MemoryObservationItem["entityType"];
  name: string;
  observations: string[];
} {
  return (
    row.type === "entity" &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.entityType === "string" &&
    ENTITY_TYPE_SET.has(row.entityType) &&
    Array.isArray(row.observations) &&
    row.observations.every((item) => typeof item === "string")
  );
}

export function parseMemoryItems(raw: string): MemoryObservationItem[] {
  const items: MemoryObservationItem[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: EntityLine;
    try {
      row = JSON.parse(trimmed) as EntityLine;
    } catch {
      continue;
    }
    if (!isEntityLine(row)) continue;
    row.observations.forEach((observation, index) => {
      if (observation.length === 0) return;
      items.push({
        entityName: row.name,
        entityType: row.entityType,
        index,
        observation,
      });
    });
  }
  return items;
}

export function deleteMemoryObservation(
  raw: string,
  entityName: string,
  index: number
): { next: string } | { error: "not-found" } {
  const lines = raw.split("\n");
  let found = false;
  const nextLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      nextLines.push(line);
      continue;
    }
    let row: EntityLine;
    try {
      row = JSON.parse(trimmed) as EntityLine;
    } catch {
      nextLines.push(line);
      continue;
    }
    if (!(isEntityLine(row) && row.name === entityName)) {
      nextLines.push(line);
      continue;
    }
    if (index >= row.observations.length) {
      nextLines.push(line);
      continue;
    }
    found = true;
    const observations = row.observations.filter((_, i) => i !== index);
    if (observations.length === 0) continue;
    nextLines.push(
      JSON.stringify({
        entityType: row.entityType,
        name: row.name,
        observations,
        type: "entity",
      })
    );
  }
  if (!found) return { error: "not-found" };
  return { next: nextLines.join("\n").replace(/\n+$/u, "") + (raw.endsWith("\n") || nextLines.length === 0 ? "\n" : "") };
}

export async function readMemoryList(
  storePath: string
): Promise<MemoryListResult> {
  const info = await stat(storePath).catch(() => null);
  if (!info) return { items: [], tooLarge: false };
  if (info.size > MEMORY_JSONL_MAX_BYTES) {
    return { items: [], tooLarge: true };
  }
  const raw = await readFile(storePath, "utf8");
  return { items: parseMemoryItems(raw), tooLarge: false };
}

export async function writeMemoryJsonl(
  storePath: string,
  raw: string
): Promise<void> {
  await writeFileAtomic(storePath, raw, { mode: 0o600 });
}
```

（删完后的换行保持：实现时以「输出合法 JSONL、parse 再 roundtrip」为准；单测锁定行为后允许微调 join 逻辑，禁止 `as any`。）

`MemoryReconciler` 在 `#lockFor` 内：

```ts
async list(root: ProjectRoot): Promise<MemoryListResult> {
  return this.#lockFor(root, async () => {
    const identity = await resolveProjectIdentity(root.projectRootPath);
    const storePath = join(this.#deps.baseDir, identity.key, "memory.jsonl");
    return readMemoryList(storePath);
  });
}

async deleteObservation(
  root: ProjectRoot,
  entityName: string,
  index: number
): Promise<void> {
  await this.#lockFor(root, async () => {
    const identity = await resolveProjectIdentity(root.projectRootPath);
    const storePath = join(this.#deps.baseDir, identity.key, "memory.jsonl");
    const raw = await readFile(storePath, "utf8").catch(() => "");
    const result = deleteMemoryObservation(raw, entityName, index);
    if ("error" in result) {
      throw new Error("memory observation not found");
    }
    await writeMemoryJsonl(storePath, result.next);
  });
}

async clearStore(root: ProjectRoot): Promise<void> {
  await this.#lockFor(root, async () => {
    const identity = await resolveProjectIdentity(root.projectRootPath);
    const storePath = join(this.#deps.baseDir, identity.key, "memory.jsonl");
    await writeMemoryJsonl(storePath, "");
  });
}
```

`executeMemoryCommand` 的 type 守卫扩成六个 type；switch 增加：

```ts
case "memory.list":
  return success(requestId, await services.projectMemory.list(root));
case "memory.deleteObservation":
  await services.projectMemory.deleteObservation(
    root,
    command.entityName,
    command.index
  );
  return success(requestId, { ok: true });
case "memory.clearStore":
  await services.projectMemory.clearStore(root);
  return success(requestId, { ok: true });
```

`root.scope !== "project"` 的拒绝保持。

- [ ] **Step 4:** `pnpm vitest run tests/unit/main/agent-managed-assets/jsonl.test.ts tests/unit/main/agent-managed-assets/commands.test.ts` → PASS

- [ ] **Step 5: Commit** Skip.

---

### Task 4: preload + facade

**Files:**
- Modify: `src/preload/memory/api.ts`
- Modify: `src/plugins/api/renderer-facades.ts`
- Modify: `src/renderer/lib/plugins/host/project-memory-context.ts`
- Test: `tests/unit/preload/memory-api.test.ts`（已有 enable/status；追加 list/delete/clear payload）

**Interfaces:**
- `PierMemoryAPI` 与 `RendererPluginProjectMemoryFacade` 同步增加：
  ```ts
  list(root: AssetRootRef): Promise<MemoryListResult>;
  deleteObservation(
    root: AssetRootRef,
    entityName: string,
    index: number
  ): Promise<void>;
  clearStore(root: AssetRootRef): Promise<void>;
  ```

- [ ] **Step 1:** preload 测试断言 `invokePierCommand` 收到 `{ type: "memory.list", root }` 等。

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** `memoryApi` 增加三方法；facade 与 `createPluginProjectMemoryContext` 原样转发并 `assertPluginCapability(..., "managedAssets:write")`。`deleteObservation` preload：

```ts
deleteObservation: (root, entityName, index) =>
  invokePierCommand({
    entityName,
    index,
    root,
    type: "memory.deleteObservation",
  }).then(() => undefined),
```

- [ ] **Step 4:** `pnpm vitest run tests/unit/preload/memory-api.test.ts tests/unit/renderer/plugin-runtime-facade.test.ts` → PASS（若 facade 测试构造了 projectMemory，补上三方法，不要 `as any`）

- [ ] **Step 5: Commit** Skip.

---

### Task 5: 内置 `settingsPages.register`

**Files:**
- Create: `src/renderer/lib/plugins/host/settings-pages-context.ts`
- Modify: `src/plugins/api/renderer.ts`（`RendererPluginContext` 增加 `settingsPages`）
- Modify: `src/renderer/lib/plugins/host/context.ts`（`context.ts` 已 500 行硬顶：先把 `assertDeclaredContribution` 挪到 `src/renderer/lib/plugins/host/assert-contribution.ts`，再接入一行 `settingsPages`）
- Test: 扩展 `tests/unit/renderer/plugin-runtime-facade.test.ts` 或新建 `tests/unit/renderer/plugin-settings-page-facade.test.ts`

**Interfaces:**
- 与外部插件同构：
  ```ts
  settingsPages: {
    register(registration: { id: string; component: ComponentType<Record<string, never>> }): () => void;
  }
  ```
- `assertDeclaredContribution` 增加 kind `"settingsPage"`：`entry.manifest.settingsPages.some((page) => page.id === id)`。
- 实现：`registerPluginSettingsPage(entry.manifest.id, registration)`。一插件一页，重复注册抛错（对齐外部 context）。

- [ ] **Step 1:** 测试：有 `settingsPages: [{ id: "pier.memory.settings" }]` 的 entry 调用 `register` 后 `getPluginSettingsPage("pier.memory")` 有值；未声明 id 则 throw `plugin contribution not declared`。

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** 按上实现。类型 `RendererSettingsPageRegistration` 不要从 `@pier/plugin-api` 引进内置 `src/plugins/api`（depcruise）；在 `src/plugins/api/renderer.ts` 自建同形 interface。

- [ ] **Step 4:** 对应 vitest PASS；`pnpm check:file-size` 确认 `context.ts` ≤500。

- [ ] **Step 5: Commit** Skip.

---

### Task 6: manifest + locales + 卸面板

**Files:**
- Modify: `src/plugins/builtin/memory/manifest.ts`
- Modify: `src/plugins/builtin/memory/locales/{en,zh-CN,ja,ko}.json`
- Modify: `src/plugins/builtin/memory/renderer/index.tsx`
- Delete: `src/plugins/builtin/memory/renderer/panel.tsx`
- Delete: `tests/unit/plugins/pier-memory-panel.test.tsx`
- Modify: `tests/unit/plugins/pier-memory-governance.test.ts`

**Interfaces:**
- `MEMORY_SETTINGS_PAGE_ID = "pier.memory.settings"`
- 删除 `MEMORY_PANEL_ID` 与 `panels` 数组
- permissions: `["workspace:read", "environment:read", "managedAssets:write"]`
- `settingsPages: [{ id: MEMORY_SETTINGS_PAGE_ID }]`
- activate 改为 `context.settingsPages.register({ id, component: () => <MemorySettingsPage context={context} /> })`

Locale `messages` 键（四语言必须同键）：

```
confirm.tracked.title / body
confirm.delete.title / body / action
confirm.clear.title / body / action
degraded.details
degraded.status
empty.noProject / empty.noProjectHint
empty.noEntries / empty.noEntriesHint
empty.tooLarge
first.claudeTrust
page.title / page.description
list.currentBadge
detail.back
state.degraded / disabled / enabled
summary.connected / store / engine / disabledHint
switch.enable
entries.title
entity.convention / pitfall / decision / environment
delete.aria
clear.action
error.loadFailed / error.deleteFailed / error.clearFailed
```

中文（写入 zh-CN）：

- page.title: 项目记忆
- page.description: 为这个项目的智能体记住约定、坑和决策。
- empty.noProject: 未打开项目
- empty.noProjectHint: 请先在设置的项目里添加文件夹。
- empty.noEntries: 还没有记忆
- empty.noEntriesHint: 智能体在会话里记下的内容会出现在这里。
- empty.tooLarge: 记忆文件较大，无法在设置里列出或删除。
- list.currentBadge: 当前
- detail.back: 返回
- switch.enable: 启用项目记忆
- summary.disabledHint: 关闭后智能体不会读写这个项目的记忆。
- summary.connected: 已接入 {{count}} 个智能体
- entries.title: 记忆条目
- entity.convention: 约定
- entity.pitfall: 踩过的坑
- entity.decision: 拍板决策
- entity.environment: 环境事实
- confirm.delete.title: 删除这条记忆？
- confirm.delete.body: 智能体以后不会再读到这条。
- confirm.delete.action: 删除
- confirm.clear.title: 清空这个项目的记忆？
- confirm.clear.body: 只清空本机记忆内容，不会关掉项目记忆，也不会改智能体配置。
- confirm.clear.action: 清空
- delete.aria: 删除这条记忆
- clear.action: 清空本项目记忆
- degraded.status: 部分智能体没有接上。

英文与 ja/ko 同步可读，禁止缺键。删 `panel.title` 与 `panels` 块。

治理测试追加：

```ts
it("declares a settings page and no panels", () => {
  expect(MEMORY_PLUGIN_MANIFEST.panels).toEqual([]);
  expect(MEMORY_PLUGIN_MANIFEST.settingsPages).toEqual([
    { id: "pier.memory.settings" },
  ]);
  expect(MEMORY_PLUGIN_MANIFEST.permissions).toEqual([
    "workspace:read",
    "environment:read",
    "managedAssets:write",
  ]);
});
```

并读取 `2026-08-27-project-memory-settings-ui-design.md` 标题存在。

- [ ] **Step 1–4:** 治理测先红后绿。`index.tsx` 本步可先 register 一个返回 `null` 的 component，Task 7 换成真页面。
- [ ] **Step 5: Commit** Skip.

---

### Task 7: 设置页 UI（列表钻取 + 详情）

**Files:**
- Create: `src/plugins/builtin/memory/renderer/settings-page.tsx`（状态：selectedRoot）
- Create: `src/plugins/builtin/memory/renderer/settings-list.tsx`
- Create: `src/plugins/builtin/memory/renderer/settings-detail.tsx`
- Test: `tests/unit/plugins/pier-memory-settings.test.tsx`

**Interfaces:**
- Consumes: `context.environments.snapshot`、`context.projectMemory.*`、`context.dialogs`、`context.i18n.t`、`context.panels.getActiveContext`
- `MemorySettingsPage({ context }: { context: RendererPluginContext })`

布局 class：`flex w-full max-w-[62rem] flex-col gap-4 px-4 pb-8`。

**列表：** `h1` + 说明。`snapshot()` 后 `projects.filter((p) => p.kind !== "pier-home")`。`Item outline` + Folder + basename + 等宽路径 + 当前 Badge（`getActiveContext()?.projectRootPath`）+ ChevronRight。空：`Empty`。点击 setSelected。

**详情：** 顶栏 ghost `icon` 返回 + `h1` + 路径。开关卡 `Card size="sm"`：`StatusStack`（degraded）→ 横向 Field 开关 → `FieldSeparator` → 位置/引擎只读说明 → Claude 提示（enabled 时）。条目卡按 spec。

启用确认 / 删除 / 清空：`dialogs.confirm`。失败 `dialogs.alert`。无 toast。

- [ ] **Step 1: 组件测**

1. snapshot 两个项目 → 看到 basename；点 pier → 出现开关「启用项目记忆」。
2. status desired enabled + list 一条 → 看到观察正文；点删除图标 → confirm；确认后 `deleteObservation` 被调用。
3. degraded → StatusStack 标题可见；点查看详情 → `dialogs.alert`。全程无 `toast`。

mock `context` 用 `as unknown as RendererPluginContext`，必须包含 environments/projectMemory/dialogs/i18n/panels。

- [ ] **Step 2:** FAIL（页面未实现）
- [ ] **Step 3:** 实现三文件。图标：`Folder` / `ChevronRight` / `ArrowLeft` / `Trash2` / `Brain`（EmptyMedia）。`Button` 图标设 `data-icon`。不要 `h-8`、不要 `space-x-*`、不要 className 模板字符串（用 `cn()`）。
- [ ] **Step 4:** `pnpm vitest run tests/unit/plugins/pier-memory-settings.test.tsx tests/unit/plugins/pier-memory-governance.test.ts` → PASS
- [ ] **Step 5: Commit** Skip.

---

### Task 8: 终验

- [ ] `pnpm check:file-size && pnpm check:dir-density`
- [ ] `pnpm vitest run tests/unit/main/agent-managed-assets tests/unit/plugins/pier-memory-governance.test.ts tests/unit/plugins/pier-memory-settings.test.tsx tests/unit/preload/memory-api.test.ts tests/unit/renderer/plugin-runtime-facade.test.ts`
- [ ] `pnpm typecheck:host`
- [ ] 确认无 `pier.memory.panel`、无 `createMemoryPanel` 引用（`rg` 禁止用 shell grep：用内置 Grep）。
- [ ] **Commit** Skip.

## Self-Review

- Spec 覆盖：卸面板、settingsPages、钻取、Switch 同构、StatusStack、Item+Trash2、list/delete/clear、8MB、environment:read、内置 settingsPages.register、不提交。
- 无 TBD。`deleteMemoryObservation` 换行允许按单测微调。
- 类型名贯穿：`MemoryListResult` / `MemoryObservationItem` / `MEMORY_SETTINGS_PAGE_ID`。
