# 命令面板 MRU 排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给命令面板加上分组与组内双层 MRU（frecency）排序，并把使用记录持久化到 `userData/command-palette-mru.json`，多窗口同步。

**Architecture:** main 进程独占持有 entries 状态（lockfile + atomic write），renderer 启动时拉一次、之后订阅广播。renderer 计算 frecency map 注入 `groupActions`，未用过的命令/分组回退原 `sortOrder` / `CATEGORY_META.order`。有 query 时不重排，把排序权完全交给 cmdk。

**Tech Stack:** Electron 42 IPC（invoke + send + webContents.send）+ zod schema + proper-lockfile + write-file-atomic + zustand + cmdk + vitest（jsdom）+ playwright。

**Spec:** [docs/superpowers/specs/2026-06-23-command-palette-mru-design.md](../specs/2026-06-23-command-palette-mru-design.md)

**Reference:**
- 持久化层 pattern: [src/main/state/preferences.ts](../../../src/main/state/preferences.ts)
- IPC 注册 pattern: [src/main/ipc/preferences.ts](../../../src/main/ipc/preferences.ts) + [src/main/index.ts:168-172](../../../src/main/index.ts#L168)
- preload 挂载 pattern: [src/preload/index.ts](../../../src/preload/index.ts)
- Action 注册 pattern: [src/renderer/lib/actions/settings-actions.ts](../../../src/renderer/lib/actions/settings-actions.ts)
- 现有命令面板逻辑: [src/renderer/components/common/command-palette.tsx](../../../src/renderer/components/common/command-palette.tsx)
- 现有单测 pattern: [tests/unit/cmd-palette-keybinding.test.ts](../../../tests/unit/cmd-palette-keybinding.test.ts)

---

### Task 1: 数据契约 — schema + 类型

**Files:**
- Create: `src/shared/contracts/command-palette-mru.ts`
- Test: `tests/unit/command-palette-mru-schema.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/command-palette-mru-schema.test.ts
import { describe, expect, it } from "vitest";
import {
  mruEntrySchema,
  mruStateSchema,
} from "@shared/contracts/command-palette-mru.ts";

describe("command-palette-mru schema", () => {
  it("接受最小合法 entry", () => {
    const parsed = mruEntrySchema.parse({
      actionId: "pier.x",
      useCount: 1,
      lastUsedAt: 1_700_000_000_000,
    });
    expect(parsed.actionId).toBe("pier.x");
  });

  it("拒绝空 actionId", () => {
    expect(() =>
      mruEntrySchema.parse({ actionId: "", useCount: 0, lastUsedAt: 0 })
    ).toThrow();
  });

  it("拒绝负 useCount", () => {
    expect(() =>
      mruEntrySchema.parse({ actionId: "x", useCount: -1, lastUsedAt: 0 })
    ).toThrow();
  });

  it("默认 state 通过校验", () => {
    const parsed = mruStateSchema.parse({ version: 1, entries: [] });
    expect(parsed.entries).toEqual([]);
  });

  it("拒绝超过 200 条 entries", () => {
    const entries = Array.from({ length: 201 }, (_, i) => ({
      actionId: `a${i}`,
      useCount: 1,
      lastUsedAt: 0,
    }));
    expect(() => mruStateSchema.parse({ version: 1, entries })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `pnpm test:unit -- command-palette-mru-schema`
Expected: FAIL — `Cannot find module '@shared/contracts/command-palette-mru.ts'`

- [ ] **Step 3: 实现 schema**

```ts
// src/shared/contracts/command-palette-mru.ts
/**
 * 命令面板 MRU 持久化 schema. 详见 docs/superpowers/specs/2026-06-23-command-palette-mru-design.md
 */
import { z } from "zod";

export const mruEntrySchema = z.object({
  actionId: z.string().min(1),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.number().int(),
});

export const mruStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(mruEntrySchema).max(200),
});

export type MruEntry = z.infer<typeof mruEntrySchema>;
export type MruState = z.infer<typeof mruStateSchema>;

export const EMPTY_MRU_STATE: MruState = { version: 1, entries: [] };
export const MRU_MAX_ENTRIES = 200;
```

- [ ] **Step 4: 跑测试看通过**

Run: `pnpm test:unit -- command-palette-mru-schema`
Expected: PASS (5 passed)

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts/command-palette-mru.ts tests/unit/command-palette-mru-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): command-palette MRU schema (entries cap=200)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ActionMetadata 加 excludeFromMru 字段

**Files:**
- Modify: `src/renderer/lib/actions/types.ts`

- [ ] **Step 1: 修改类型**

把 [src/renderer/lib/actions/types.ts](../../../src/renderer/lib/actions/types.ts) 中的 `ActionMetadata` 改成：

```ts
export interface ActionMetadata {
  iconComponent?: LucideIcon;
  keywords?: readonly string[];
  sortOrder?: number;
  /** true = 执行后不计入命令面板 MRU。仅给 clearRecent 这类元命令用 */
  excludeFromMru?: boolean;
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/actions/types.ts
git commit -m "$(cat <<'EOF'
feat(actions): ActionMetadata 加 excludeFromMru 字段

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: main state 模块（读写、record、clear、cap 逐出）

**Files:**
- Create: `src/main/state/command-palette-mru.ts`
- Test: `tests/unit/command-palette-mru-state.test.ts`

State 模块要求：
- `readState(file)`: 不存在/损坏 → 返回 `EMPTY_MRU_STATE`
- `recordUse(state, actionId, now)`: 纯函数，返回新 state。entries 已含 → useCount++ + lastUsedAt=now；不含 → append；满 200 → 先逐出 `useCount * 0.5^(ageDays/14)` 最低的 entry 再 append
- `clearState()`: 返回 `EMPTY_MRU_STATE`
- `persistState(file, state)`: lockfile + write-file-atomic

main 进程会维护一个内存副本 + 串行化 IO。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/command-palette-mru-state.test.ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_MRU_STATE,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import {
  evictWeakest,
  recordUse,
} from "@main/state/command-palette-mru.ts";

const day = 86_400_000;

describe("recordUse", () => {
  it("新 actionId → append entry, useCount=1", () => {
    const next = recordUse(EMPTY_MRU_STATE, "pier.x", 1000);
    expect(next.entries).toEqual([
      { actionId: "pier.x", useCount: 1, lastUsedAt: 1000 },
    ]);
  });

  it("已存在 actionId → useCount++ + lastUsedAt 刷新", () => {
    const base: MruState = {
      version: 1,
      entries: [{ actionId: "pier.x", useCount: 3, lastUsedAt: 1000 }],
    };
    const next = recordUse(base, "pier.x", 2000);
    expect(next.entries).toEqual([
      { actionId: "pier.x", useCount: 4, lastUsedAt: 2000 },
    ]);
  });

  it("不破坏旧引用 (immutable)", () => {
    const base: MruState = {
      version: 1,
      entries: [{ actionId: "pier.x", useCount: 1, lastUsedAt: 0 }],
    };
    recordUse(base, "pier.x", 2000);
    expect(base.entries[0].useCount).toBe(1);
  });
});

describe("evictWeakest (满 200 时使用)", () => {
  it("frecency 最低的被剔除", () => {
    const now = 100 * day;
    const entries = [
      // useCount=10, age=0 → frecency=10
      { actionId: "hot", useCount: 10, lastUsedAt: now },
      // useCount=1, age=100d → frecency≈0.0073, 最低
      { actionId: "cold", useCount: 1, lastUsedAt: 0 },
      // useCount=2, age=14d → frecency=1
      { actionId: "warm", useCount: 2, lastUsedAt: now - 14 * day },
    ];
    const survivors = evictWeakest(entries, now);
    expect(survivors.map((e) => e.actionId).sort()).toEqual(["hot", "warm"]);
  });
});

describe("recordUse + cap 200", () => {
  it("满 200 时新插入触发逐出 weakest", () => {
    const now = 100 * day;
    const entries = Array.from({ length: 200 }, (_, i) => ({
      actionId: `a${i}`,
      // a0 是最弱的: useCount=1, age=200d
      useCount: i === 0 ? 1 : 5,
      lastUsedAt: i === 0 ? 0 : now - 7 * day,
    }));
    const base: MruState = { version: 1, entries };
    const next = recordUse(base, "fresh", now);
    expect(next.entries).toHaveLength(200);
    expect(next.entries.some((e) => e.actionId === "fresh")).toBe(true);
    expect(next.entries.some((e) => e.actionId === "a0")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `pnpm test:unit -- command-palette-mru-state`
Expected: FAIL — `Cannot find module '@main/state/command-palette-mru.ts'`

- [ ] **Step 3: 实现纯函数 + IO**

```ts
// src/main/state/command-palette-mru.ts
/**
 * 命令面板 MRU 持久化层. 纯函数 (recordUse, evictWeakest) 暴露给单测;
 * IO 函数 (readFile, persistFile) 走 lockfile + atomic write.
 *
 * IO pattern 抄自 src/main/state/preferences.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EMPTY_MRU_STATE,
  MRU_MAX_ENTRIES,
  type MruEntry,
  type MruState,
  mruStateSchema,
} from "@shared/contracts/command-palette-mru.ts";
import { app } from "electron";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function frecency(entry: MruEntry, now: number): number {
  const ageDays = (now - entry.lastUsedAt) / MS_PER_DAY;
  return entry.useCount * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function evictWeakest(
  entries: readonly MruEntry[],
  now: number
): MruEntry[] {
  if (entries.length === 0) return [];
  let weakestIdx = 0;
  let weakestScore = frecency(entries[0], now);
  for (let i = 1; i < entries.length; i++) {
    const s = frecency(entries[i], now);
    if (s < weakestScore) {
      weakestScore = s;
      weakestIdx = i;
    }
  }
  return entries.filter((_, i) => i !== weakestIdx);
}

export function recordUse(
  state: MruState,
  actionId: string,
  now: number
): MruState {
  const idx = state.entries.findIndex((e) => e.actionId === actionId);
  if (idx >= 0) {
    const updated: MruEntry = {
      ...state.entries[idx],
      useCount: state.entries[idx].useCount + 1,
      lastUsedAt: now,
    };
    const entries = state.entries.slice();
    entries[idx] = updated;
    return { ...state, entries };
  }
  const incoming: MruEntry = { actionId, useCount: 1, lastUsedAt: now };
  const base =
    state.entries.length >= MRU_MAX_ENTRIES
      ? evictWeakest(state.entries, now)
      : state.entries;
  return { ...state, entries: [...base, incoming] };
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "command-palette-mru.json");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readMruState(): Promise<MruState> {
  const path = resolveFilePath();
  if (!existsSync(path)) return EMPTY_MRU_STATE;
  try {
    const raw = await readFile(path, "utf-8");
    return mruStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn("[command-palette-mru] schema 校验失败, 回到空状态:", err);
    return EMPTY_MRU_STATE;
  }
}

export async function writeMruState(state: MruState): Promise<void> {
  const path = resolveFilePath();
  await ensureDir(path);
  let release: (() => Promise<void>) | undefined;
  try {
    if (await fileExists(path)) {
      release = await lockfile.lock(path);
    }
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    await release?.();
  }
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `pnpm test:unit -- command-palette-mru-state`
Expected: PASS (5 passed)

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 6: Commit**

```bash
git add src/main/state/command-palette-mru.ts tests/unit/command-palette-mru-state.test.ts
git commit -m "$(cat <<'EOF'
feat(main): command-palette MRU state 模块 + cap=200 时逐出 weakest

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: main IPC + 多窗口广播

**Files:**
- Create: `src/main/ipc/command-palette-mru.ts`

main 进程层职责：
- 单实例持有当前 state 内存副本（初始 `null`，首次 `read` 时拉 + 落盘 sync）
- `record(actionId)`: 内存 record → 异步 `writeMruState` → `webContents.send` 广播给所有窗口
- `clear()`: 重置内存 + 落盘 + 广播
- 并发 record/clear: 用一个内部 promise 队列串行化，避免锁竞争

不写单测，行为靠 task 11 的 E2E 覆盖（IPC + Electron runtime mock 在 vitest 里成本太高）。

- [ ] **Step 1: 实现 IPC 注册函数**

```ts
// src/main/ipc/command-palette-mru.ts
/**
 * IPC 桥接 + 多窗口广播.
 * - read: invoke, 返回当前 state (首次会从磁盘读)
 * - record: send (fire-and-forget), 内存写 + 异步落盘 + 广播
 * - clear: invoke, 重置 + 落盘 + 广播
 *
 * 串行化: 用一个 promise 链让 record/clear 顺序执行, 避免 lockfile 抢占.
 */
import {
  EMPTY_MRU_STATE,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import { BrowserWindow, type IpcMain } from "electron";
import {
  readMruState,
  recordUse,
  writeMruState,
} from "../state/command-palette-mru.ts";

const CHANNEL_READ = "pier:command-palette-mru:read";
const CHANNEL_RECORD = "pier:command-palette-mru:record";
const CHANNEL_CLEAR = "pier:command-palette-mru:clear";
const CHANNEL_CHANGED = "pier:command-palette-mru:changed";

let memo: MruState | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // 吞掉错误避免毒化 queue, 但保留链
  queue = next.catch(() => undefined);
  return next;
}

async function ensureLoaded(): Promise<MruState> {
  if (memo) return memo;
  memo = await readMruState();
  return memo;
}

function broadcast(state: MruState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(CHANNEL_CHANGED, state);
    }
  }
}

export function registerCommandPaletteMruIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNEL_READ, async () => ensureLoaded());

  ipcMain.on(CHANNEL_RECORD, (_event, actionId: string) => {
    if (typeof actionId !== "string" || actionId.length === 0) return;
    enqueue(async () => {
      const current = await ensureLoaded();
      const next = recordUse(current, actionId, Date.now());
      memo = next;
      try {
        await writeMruState(next);
      } catch (err) {
        console.error("[command-palette-mru] 落盘失败:", err);
      }
      broadcast(next);
    });
  });

  ipcMain.handle(CHANNEL_CLEAR, async () =>
    enqueue(async () => {
      memo = EMPTY_MRU_STATE;
      try {
        await writeMruState(EMPTY_MRU_STATE);
      } catch (err) {
        console.error("[command-palette-mru] 清空落盘失败:", err);
      }
      broadcast(EMPTY_MRU_STATE);
      return EMPTY_MRU_STATE;
    })
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/command-palette-mru.ts
git commit -m "$(cat <<'EOF'
feat(ipc): command-palette MRU read/record/clear + 多窗口 changed 广播

- 内存副本 + queue 串行化避免 lockfile 抢占
- record 用 send (fire-and-forget), read/clear 用 invoke
- 落盘失败仅日志, 不阻塞 IPC 响应

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: main 入口注册 IPC

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 导入新 IPC 注册函数**

在 [src/main/index.ts:11](../../../src/main/index.ts#L11) 之后追加一行：

```ts
import { registerCommandPaletteMruIpc } from "./ipc/command-palette-mru.ts";
```

- [ ] **Step 2: 调用注册函数**

在 [src/main/index.ts:172](../../../src/main/index.ts#L172) `registerWorkspaceIpc(ipcMain);` 之后追加：

```ts
  registerCommandPaletteMruIpc(ipcMain);
```

- [ ] **Step 3: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "$(cat <<'EOF'
feat(main): 注册 command-palette-mru IPC

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: preload 挂 commandPaletteMru API

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 增加 API 接口与实现**

在 [src/preload/index.ts](../../../src/preload/index.ts) 顶部导入区追加：

```ts
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
```

在 `PierWorkspaceAPI` 接口下方追加：

```ts
export interface PierCommandPaletteMruAPI {
  read: () => Promise<MruState>;
  recordUse: (actionId: string) => void;
  clear: () => Promise<MruState>;
  /** 订阅 changed 广播, 返回解绑函数 */
  onChange: (handler: (state: MruState) => void) => () => void;
}
```

在 `PierWindowAPI` 接口内追加字段：

```ts
  commandPaletteMru: PierCommandPaletteMruAPI;
```

在 `workspaceApi` 定义之后追加 API 实现：

```ts
const commandPaletteMruApi: PierCommandPaletteMruAPI = {
  read: () => ipcRenderer.invoke("pier:command-palette-mru:read"),
  recordUse: (actionId) =>
    ipcRenderer.send("pier:command-palette-mru:record", actionId),
  clear: () => ipcRenderer.invoke("pier:command-palette-mru:clear"),
  onChange: (handler) => {
    const listener = (_event: unknown, state: MruState) => {
      handler(state);
    };
    ipcRenderer.on("pier:command-palette-mru:changed", listener);
    return () => {
      ipcRenderer.off("pier:command-palette-mru:changed", listener);
    };
  },
};
```

在 `api: PierWindowAPI = { ... }` 对象中追加字段：

```ts
  commandPaletteMru: commandPaletteMruApi,
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "$(cat <<'EOF'
feat(preload): 挂 window.pier.commandPaletteMru API

- read/recordUse/clear/onChange 全套
- onChange 返回解绑闭包

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: frecency 公式 + actionRank / groupRank

**Files:**
- Create: `src/renderer/lib/command-palette/frecency.ts`
- Test: `tests/unit/command-palette-frecency.test.ts`

renderer 端不写 entries，只算 frecency map。`buildFrecencyMap(entries, now)` 在 store 拿到 entries 时一次性算出 `Map<actionId, score>`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/command-palette-frecency.test.ts
import { describe, expect, it } from "vitest";
import type { MruEntry } from "@shared/contracts/command-palette-mru.ts";
import {
  actionRank,
  buildFrecencyMap,
  groupRank,
} from "@/lib/command-palette/frecency.ts";

const day = 86_400_000;

describe("buildFrecencyMap", () => {
  it("0 天: frecency = useCount", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now },
    ];
    const map = buildFrecencyMap(entries, now);
    expect(map.get("x")).toBeCloseTo(4);
  });

  it("14 天 (一个半衰期): frecency = useCount/2", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now - 14 * day },
    ];
    expect(buildFrecencyMap(entries, now).get("x")).toBeCloseTo(2);
  });

  it("28 天 (两个半衰期): frecency = useCount/4", () => {
    const now = 1000 * day;
    const entries: MruEntry[] = [
      { actionId: "x", useCount: 4, lastUsedAt: now - 28 * day },
    ];
    expect(buildFrecencyMap(entries, now).get("x")).toBeCloseTo(1);
  });
});

describe("actionRank", () => {
  const baseAction = (id: string, sortOrder?: number) => ({
    id,
    category: "View",
    title: () => id,
    handler: () => undefined,
    metadata: sortOrder != null ? { sortOrder } : undefined,
  });

  it("有 frecency → tier=frecency", () => {
    const map = new Map([["a", 5]]);
    const r = actionRank(baseAction("a"), map);
    expect(r.tier).toBe("frecency");
    if (r.tier === "frecency") expect(r.score).toBe(5);
  });

  it("无 frecency → tier=fallback + sortOrder", () => {
    const map = new Map<string, number>();
    const r = actionRank(baseAction("a", 7), map);
    expect(r.tier).toBe("fallback");
    if (r.tier === "fallback") expect(r.sortOrder).toBe(7);
  });

  it("无 frecency 且无 sortOrder → fallback + 0", () => {
    const r = actionRank(baseAction("a"), new Map());
    if (r.tier === "fallback") expect(r.sortOrder).toBe(0);
  });
});

describe("groupRank", () => {
  const baseAction = (id: string, category: string) => ({
    id,
    category,
    title: () => id,
    handler: () => undefined,
  });

  it("组内任一 action 有 frecency → tier=frecency + maxScore", () => {
    const actions = [baseAction("a", "View"), baseAction("b", "View")];
    const map = new Map([
      ["a", 3],
      ["b", 7],
    ]);
    const r = groupRank(actions, map);
    expect(r.tier).toBe("frecency");
    if (r.tier === "frecency") expect(r.maxScore).toBe(7);
  });

  it("组内全无 frecency → tier=fallback + CATEGORY_META.order", () => {
    const actions = [baseAction("a", "Settings")];
    const r = groupRank(actions, new Map());
    expect(r.tier).toBe("fallback");
    // Settings.order = 4 (见 command-palette.tsx CATEGORY_META)
    if (r.tier === "fallback") expect(r.order).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `pnpm test:unit -- command-palette-frecency`
Expected: FAIL — `Cannot find module '@/lib/command-palette/frecency.ts'`

- [ ] **Step 3: 实现 frecency**

```ts
// src/renderer/lib/command-palette/frecency.ts
/**
 * 命令面板 MRU 排序算法.
 *
 *   frecency = useCount × 0.5^(ageDays / HALF_LIFE_DAYS)
 *
 * 半衰期 14 天: 两周不用, 权重折半. 参数硬编码, 后续观察体感再调.
 */
import type { MruEntry } from "@shared/contracts/command-palette-mru.ts";
import type { Action } from "@/lib/actions/types.ts";

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export const CATEGORY_META: Record<string, { labelKey: string; order: number }> =
  {
    View: { order: 0, labelKey: "view" },
    Workspace: { order: 1, labelKey: "workspace" },
    Panel: { order: 2, labelKey: "panel" },
    Window: { order: 3, labelKey: "window" },
    Settings: { order: 4, labelKey: "settings" },
  };

export const UNKNOWN_ORDER = Object.keys(CATEGORY_META).length;

export function buildFrecencyMap(
  entries: readonly MruEntry[],
  now: number
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const ageDays = (now - entry.lastUsedAt) / MS_PER_DAY;
    map.set(entry.actionId, entry.useCount * Math.pow(0.5, ageDays / HALF_LIFE_DAYS));
  }
  return map;
}

export type ActionRank =
  | { tier: "frecency"; score: number }
  | { tier: "fallback"; sortOrder: number };

export function actionRank(
  action: Action,
  frecencyMap: ReadonlyMap<string, number>
): ActionRank {
  const score = frecencyMap.get(action.id);
  return score != null
    ? { tier: "frecency", score }
    : { tier: "fallback", sortOrder: action.metadata?.sortOrder ?? 0 };
}

export type GroupRank =
  | { tier: "frecency"; maxScore: number }
  | { tier: "fallback"; order: number };

export function groupRank(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): GroupRank {
  let maxScore = -Infinity;
  for (const a of actions) {
    const s = frecencyMap.get(a.id);
    if (s != null && s > maxScore) maxScore = s;
  }
  if (maxScore > -Infinity) return { tier: "frecency", maxScore };
  const category = actions[0]?.category ?? "";
  return {
    tier: "fallback",
    order: CATEGORY_META[category]?.order ?? UNKNOWN_ORDER,
  };
}

export function compareActions(
  a: Action,
  b: Action,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const ra = actionRank(a, frecencyMap);
  const rb = actionRank(b, frecencyMap);
  // frecency tier 在前
  if (ra.tier === "frecency" && rb.tier === "fallback") return -1;
  if (ra.tier === "fallback" && rb.tier === "frecency") return 1;
  if (ra.tier === "frecency" && rb.tier === "frecency") {
    return rb.score - ra.score; // 高分在前
  }
  if (ra.tier === "fallback" && rb.tier === "fallback") {
    return ra.sortOrder - rb.sortOrder; // 小 sortOrder 在前
  }
  return 0;
}

export function compareGroups(
  ga: readonly Action[],
  gb: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): number {
  const ra = groupRank(ga, frecencyMap);
  const rb = groupRank(gb, frecencyMap);
  if (ra.tier === "frecency" && rb.tier === "fallback") return -1;
  if (ra.tier === "fallback" && rb.tier === "frecency") return 1;
  if (ra.tier === "frecency" && rb.tier === "frecency") {
    return rb.maxScore - ra.maxScore;
  }
  if (ra.tier === "fallback" && rb.tier === "fallback") {
    return ra.order - rb.order;
  }
  return 0;
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `pnpm test:unit -- command-palette-frecency`
Expected: PASS (9 passed)

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/command-palette/frecency.ts tests/unit/command-palette-frecency.test.ts
git commit -m "$(cat <<'EOF'
feat(command-palette): frecency 公式 + actionRank/groupRank

- 半衰期 14 天: useCount × 0.5^(ageDays/14)
- frecency tier 一律排在 fallback tier 前
- CATEGORY_META 从 command-palette.tsx 提取到 frecency.ts 复用

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 改造 groupActions 用 frecency 排序

**Files:**
- Modify: `src/renderer/components/common/command-palette.tsx`
- Test: `tests/unit/command-palette-group-actions.test.ts`

策略：把 [groupActions](../../../src/renderer/components/common/command-palette.tsx#L66) 改成接收 `frecencyMap` 与 `query`：query 非空时维持 CATEGORY_META 顺序、不重排组内（cmdk 接管）；query 为空时按 `compareActions` / `compareGroups` 排。

把原来定义在 command-palette.tsx 内的 `CATEGORY_META` 删除，从 `frecency.ts` 复用（避免重复声明）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/unit/command-palette-group-actions.test.ts
import { describe, expect, it } from "vitest";
import type { Action } from "@/lib/actions/types.ts";
import {
  groupActionsForPalette,
} from "@/components/common/command-palette.tsx";

const mk = (id: string, category: string, sortOrder?: number): Action => ({
  id,
  category,
  title: () => id,
  handler: () => undefined,
  surfaces: ["command-palette"],
  metadata: sortOrder != null ? { sortOrder } : undefined,
});

describe("groupActionsForPalette", () => {
  it("query 非空 → 按 CATEGORY_META.order 排, 组内保持入参顺序", () => {
    const actions = [
      mk("s1", "Settings", 10),
      mk("v1", "View", 5),
      mk("v2", "View", 1),
    ];
    const groups = groupActionsForPalette(actions, new Map(), "foo");
    expect(groups.map((g) => g.category)).toEqual(["View", "Settings"]);
    expect(groups[0].actions.map((a) => a.id)).toEqual(["v1", "v2"]);
  });

  it("query 空 + 全无 frecency → 等同 CATEGORY_META.order + sortOrder", () => {
    const actions = [
      mk("v1", "View", 5),
      mk("v2", "View", 1),
      mk("s1", "Settings", 10),
    ];
    const groups = groupActionsForPalette(actions, new Map(), "");
    expect(groups.map((g) => g.category)).toEqual(["View", "Settings"]);
    expect(groups[0].actions.map((a) => a.id)).toEqual(["v2", "v1"]);
  });

  it("query 空 + 有 frecency → 组间按 max(score) 排, 组内按 score 排", () => {
    const actions = [
      mk("v1", "View"),
      mk("v2", "View"),
      mk("s1", "Settings"),
      mk("s2", "Settings"),
    ];
    const map = new Map([
      ["v1", 3],
      ["s1", 10],
      ["s2", 7],
    ]);
    const groups = groupActionsForPalette(actions, map, "");
    expect(groups[0].category).toBe("Settings");
    expect(groups[0].actions.map((a) => a.id)).toEqual(["s1", "s2"]);
    expect(groups[1].category).toBe("View");
    expect(groups[1].actions.map((a) => a.id)).toEqual(["v1", "v2"]);
  });

  it("frecency tier 整组排在 fallback tier 整组之前", () => {
    const actions = [mk("v1", "View", 5), mk("p1", "Panel")];
    const map = new Map([["p1", 1]]);
    const groups = groupActionsForPalette(actions, map, "");
    expect(groups.map((g) => g.category)).toEqual(["Panel", "View"]);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `pnpm test:unit -- command-palette-group-actions`
Expected: FAIL — `groupActionsForPalette` 不存在

- [ ] **Step 3: 改造 command-palette.tsx**

在 [src/renderer/components/common/command-palette.tsx](../../../src/renderer/components/common/command-palette.tsx) 顶部 import 区追加：

```ts
import {
  CATEGORY_META,
  compareActions,
  compareGroups,
  UNKNOWN_ORDER,
} from "@/lib/command-palette/frecency.ts";
```

删除文件内原 `CATEGORY_META` / `UNKNOWN_ORDER` / `categoryRank` 定义（lines 39–59，与 frecency.ts 重复）。

把原 `groupActions` 替换为 export 出去的版本：

```ts
export function groupActionsForPalette(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>,
  query: string
): ActionGroup[] {
  const map = new Map<string, Action[]>();
  for (const action of actions) {
    const list = map.get(action.category) ?? [];
    list.push(action);
    map.set(action.category, list);
  }
  const groups = Array.from(map.entries()).map(([category, list]) => ({
    category,
    actions: list,
  }));

  if (query.length > 0) {
    // 有搜索时不重排组内, 让 cmdk fuzzy score 接管
    return groups.sort(
      (a, b) =>
        (CATEGORY_META[a.category]?.order ?? UNKNOWN_ORDER) -
        (CATEGORY_META[b.category]?.order ?? UNKNOWN_ORDER)
    );
  }

  for (const g of groups) {
    g.actions.sort((a, b) => compareActions(a, b, frecencyMap));
  }
  return groups.sort((ga, gb) =>
    compareGroups(ga.actions, gb.actions, frecencyMap)
  );
}
```

更新 `CommandPalette` 组件内调用点，让 `groups` 计算依赖 `frecencyMap` 与 `query`（[command-palette.tsx:119](../../../src/renderer/components/common/command-palette.tsx#L119)）。`frecencyMap` 来源在 Task 9 接入；这一步先用空 Map 占位：

```ts
const groups = groupActionsForPalette(actions, new Map(), query);
```

`CommandsView` 内部继续用 `CATEGORY_META` 取 heading labelKey，这里改成从 `@/lib/command-palette/frecency.ts` import 的版本。

- [ ] **Step 4: 跑测试看通过**

Run: `pnpm test:unit -- command-palette-group-actions`
Expected: PASS (4 passed)

- [ ] **Step 5: 跑全部已有单测确认无回归**

Run: `pnpm test:unit`
Expected: 全 PASS

- [ ] **Step 6: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/common/command-palette.tsx tests/unit/command-palette-group-actions.test.ts
git commit -m "$(cat <<'EOF'
refactor(command-palette): 抽 groupActionsForPalette + 接 frecency 排序

- CATEGORY_META 改从 frecency.ts 复用
- query 非空走 cmdk fuzzy score, 不重排组内
- query 为空按 compareActions / compareGroups 双层排序

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: renderer store + 启动 bootstrap

**Files:**
- Create: `src/renderer/stores/command-palette-mru.store.ts`
- Modify: `src/renderer/main.tsx`

store 职责：
- 初始 `entries = []`、`frecencyMap = empty`
- `init()`：调 `window.pier.commandPaletteMru.read()` 拉 entries + 算 frecencyMap + 订阅 onChange
- `recordUse(actionId)`：本地先 `recordUse(state, ...)` 改 entries + 重算 map（保证本会话排序立即反馈），再 IPC fire
- `clear()`：IPC invoke，等 main 广播回来再清

frecencyMap 仅在 entries 引用变化时重算，**不**按"现在时间"在 render 时实时重算（spec 明确说"打开瞬间算一次就够"）。

- [ ] **Step 1: 实现 store**

```ts
// src/renderer/stores/command-palette-mru.store.ts
/**
 * 命令面板 MRU store. 详见 specs/2026-06-23-command-palette-mru-design.md.
 *
 * - init: read + 订阅 onChange (main 端 record/clear 都会广播)
 * - recordUse: 本地立即更新 + fire-and-forget IPC
 * - frecencyMap 仅 entries 引用变化时重算
 */
import {
  EMPTY_MRU_STATE,
  type MruEntry,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import { create } from "zustand";
import { buildFrecencyMap } from "@/lib/command-palette/frecency.ts";

interface CommandPaletteMruStore {
  entries: readonly MruEntry[];
  frecencyMap: ReadonlyMap<string, number>;
  recordUse(actionId: string): void;
  clear(): Promise<void>;
}

function recompute(entries: readonly MruEntry[]): ReadonlyMap<string, number> {
  return buildFrecencyMap(entries, Date.now());
}

function applyLocal(
  prev: readonly MruEntry[],
  actionId: string,
  now: number
): readonly MruEntry[] {
  const idx = prev.findIndex((e) => e.actionId === actionId);
  if (idx >= 0) {
    const updated: MruEntry = {
      ...prev[idx],
      useCount: prev[idx].useCount + 1,
      lastUsedAt: now,
    };
    const next = prev.slice();
    next[idx] = updated;
    return next;
  }
  return [...prev, { actionId, useCount: 1, lastUsedAt: now }];
}

export const useCommandPaletteMru = create<CommandPaletteMruStore>(
  (set, get) => ({
    entries: EMPTY_MRU_STATE.entries,
    frecencyMap: new Map(),

    recordUse: (actionId) => {
      const nextEntries = applyLocal(get().entries, actionId, Date.now());
      set({ entries: nextEntries, frecencyMap: recompute(nextEntries) });
      window.pier?.commandPaletteMru?.recordUse?.(actionId);
    },

    clear: async () => {
      try {
        await window.pier?.commandPaletteMru?.clear?.();
        // 广播回来会通过 onChange 重置, 这里不直接 set 避免双写
      } catch (err) {
        console.error("[command-palette-mru] clear 失败:", err);
        // 仍然本地清空保持 UI 一致
        set({ entries: [], frecencyMap: new Map() });
      }
    },
  })
);

export async function initCommandPaletteMru(): Promise<void> {
  const api = window.pier?.commandPaletteMru;
  if (!api) return;
  try {
    const state = await api.read();
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  } catch (err) {
    console.error("[command-palette-mru] init read 失败:", err);
  }
  api.onChange((state: MruState) => {
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  });
}
```

- [ ] **Step 2: 接入 main.tsx bootstrap**

修改 [src/renderer/main.tsx](../../../src/renderer/main.tsx)：

顶部导入区追加：

```ts
import { initCommandPaletteMru } from "./stores/command-palette-mru.store.ts";
```

在 `installDragWatcher();` 之后追加：

```ts
  initCommandPaletteMru().catch(() => undefined);
```

- [ ] **Step 3: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/command-palette-mru.store.ts src/renderer/main.tsx
git commit -m "$(cat <<'EOF'
feat(stores): command-palette MRU store + bootstrap init

- recordUse 本地立即更新 + IPC fire-and-forget (保证本会话排序反馈)
- onChange 订阅 main 广播保持多窗口一致
- frecencyMap 仅 entries 变化时重算

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: CommandPalette 接 store + 改 handleExecuteAction

**Files:**
- Modify: `src/renderer/components/common/command-palette.tsx`

- [ ] **Step 1: 在组件内订阅 store**

在 [src/renderer/components/common/command-palette.tsx](../../../src/renderer/components/common/command-palette.tsx) 顶部 import 区追加：

```ts
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";
```

在 `CommandPalette` 函数体内（`useActions()` 之后）追加：

```ts
const frecencyMap = useCommandPaletteMru((s) => s.frecencyMap);
```

把 Task 8 留下的占位 `groups = groupActionsForPalette(actions, new Map(), query)` 改为：

```ts
const groups = groupActionsForPalette(actions, frecencyMap, query);
```

- [ ] **Step 2: 改 handleExecuteAction 加 recordUse 调用**

把原 `handleExecuteAction`（[command-palette.tsx:258-273](../../../src/renderer/components/common/command-palette.tsx#L258)）改为：

```ts
const handleExecuteAction = async (action: Action) => {
  if (action.enabled?.() === false) {
    return;
  }
  const before = useCommandPaletteController.getState().requestId;
  try {
    await action.handler();
    if (!action.metadata?.excludeFromMru) {
      useCommandPaletteMru.getState().recordUse(action.id);
    }
    const after = useCommandPaletteController.getState();
    if (after.requestId === before && after.mode === "commands") {
      useCommandPaletteController.getState().close();
    }
  } catch (err) {
    console.error(`[command-palette] action ${action.id} threw:`, err);
  }
};
```

- [ ] **Step 3: 跑全部已有单测确认无回归**

Run: `pnpm test:unit`
Expected: 全 PASS

- [ ] **Step 4: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/common/command-palette.tsx
git commit -m "$(cat <<'EOF'
feat(command-palette): 接 frecency store + 执行后 recordUse

- handler throw 不记录
- excludeFromMru === true 不记录
- handler 成功后才 recordUse, 保持失败命令不污染 MRU

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: clearRecent action + i18n

**Files:**
- Create: `src/renderer/lib/actions/command-palette-mru-action.ts`
- Modify: `src/renderer/i18n/locales/zh-cn.ts`
- Modify: `src/renderer/i18n/locales/en.ts`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: 新增 i18n key (zh-cn)**

在 [src/renderer/i18n/locales/zh-cn.ts](../../../src/renderer/i18n/locales/zh-cn.ts) 的 `commandPalette.action` 对象中追加一行（在 `resetLayout` 之后）：

```ts
      clearRecent: "清空命令面板使用记录",
```

- [ ] **Step 2: 新增 i18n key (en)**

在 [src/renderer/i18n/locales/en.ts](../../../src/renderer/i18n/locales/en.ts) 的对应位置追加：

```ts
      clearRecent: "Clear command palette history",
```

- [ ] **Step 3: 注册 action**

```ts
// src/renderer/lib/actions/command-palette-mru-action.ts
/**
 * "清空命令面板使用记录" 元命令.
 *
 * 自身设 excludeFromMru = true, 避免清空后立刻把自己写回 MRU 顶部
 * (体感上违反 "清空" 语义).
 */
import i18next from "i18next";
import { Eraser } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";

export function registerCommandPaletteMruAction(): () => void {
  return actionRegistry.register({
    id: "pier.commandPalette.clearRecent",
    category: "Settings",
    title: () => i18next.t("commandPalette.action.clearRecent"),
    surfaces: ["command-palette"],
    metadata: {
      iconComponent: Eraser,
      sortOrder: 30,
      excludeFromMru: true,
      keywords: ["clear", "reset", "history", "清空", "重置", "历史"],
    },
    handler: () => {
      useCommandPaletteMru.getState().clear().catch(() => undefined);
    },
  });
}
```

- [ ] **Step 4: 在 bootstrap 中注册**

修改 [src/renderer/main.tsx](../../../src/renderer/main.tsx)：

顶部导入区追加：

```ts
import { registerCommandPaletteMruAction } from "./lib/actions/command-palette-mru-action.ts";
```

在 `registerSettingsActions();` 之后追加：

```ts
  registerCommandPaletteMruAction();
```

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 退出码 0

- [ ] **Step 6: Lint**

Run: `pnpm lint`
Expected: 退出码 0（若有 Biome 报警，按规则修）

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/actions/command-palette-mru-action.ts src/renderer/i18n/locales/zh-cn.ts src/renderer/i18n/locales/en.ts src/renderer/main.tsx
git commit -m "$(cat <<'EOF'
feat(command-palette): "清空命令面板使用记录" action + i18n

- excludeFromMru 防止清空后自己回到顶部
- Settings 分类 sortOrder=30, Eraser 图标

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: E2E 验证

**Files:**
- Modify: `tests/e2e/command-palette.spec.ts`

补一个 E2E 场景：执行 "打开设置" 后再次打开命令面板，"打开设置" 应排在第一位。
选 "打开设置" 是因为它的 handler 不开 quick-pick，行为可预测。

E2E selector 复用现有的 `[cmdk-input]` / `[cmdk-item]` / `[cmdk-group-heading]`（[tests/e2e/command-palette.spec.ts](../../../tests/e2e/command-palette.spec.ts) 既有用法），launch 走 `out/main/index.js`，所以跑前必须先 `pnpm build`。

每个 E2E test 用 fresh Electron 实例（既有用例同款 pattern）；两个新增用例之间需要清空 `userData/command-palette-mru.json` 隔离状态——通过启动参数 `--user-data-dir=<tmpdir>` 给每个用例独立 userData，最干净。

- [ ] **Step 1: 在 tests/e2e/command-palette.spec.ts 末尾追加用例**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// 既有 import 已包含 join / _electron / expect / test, 这里只补 fs+os

test("MRU 顶置最近执行的 action", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-mru-e2e-"));
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // 1. 打开命令面板, 执行 "打开设置" (handler 不开 quick-pick)
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(800);
    await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
    // 设置弹窗会打开, Esc 关掉
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);

    // 2. 重开命令面板
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(800);

    // 3. 第一个 cmdk-item 应是 "打开设置"
    const firstItem = win.locator("[cmdk-item]").first();
    await expect(firstItem).toContainText("打开设置");
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("清空命令面板使用记录后恢复默认顺序", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-mru-e2e-"));
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // 1. 执行 "打开设置" 让它进 MRU
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(800);
    await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);

    // 2. 验证它确实顶置 (sanity check)
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(800);
    await expect(win.locator("[cmdk-item]").first()).toContainText("打开设置");

    // 3. 触发清空
    await win
      .locator("[cmdk-item]")
      .filter({ hasText: "清空命令面板使用记录" })
      .click();
    await win.waitForTimeout(500);

    // 4. 重开命令面板, "打开设置" 不应在第一位 (CATEGORY_META.View=0 排前)
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(800);
    await expect(win.locator("[cmdk-item]").first()).not.toContainText(
      "打开设置"
    );
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 先构建再跑 E2E**

Run: `pnpm build && pnpm test:e2e`
Expected: 全 PASS（既有用例 + 两个新增 MRU 用例）

- [ ] **Step 3: 跑完整 check + 全单测**

Run: `pnpm check && pnpm test:unit`
Expected: 全部 PASS

- [ ] **Step 4: 手工验证**

Run: `pnpm dev`
1. 打开命令面板，连续执行 "打开设置" 三次（每次 Esc 关掉设置弹窗）
2. 关闭命令面板，重新打开
3. 确认 "打开设置" 出现在 Settings 分组顶部，并且 Settings 分组出现在最上面
4. 触发 "清空命令面板使用记录"
5. 重开命令面板，确认顺序回到 CATEGORY_META 默认（View → Workspace → Panel → Window → Settings）
6. 退出 dev → 检查 `~/Library/Application Support/Pier-dev/userData/command-palette-mru.json` 内容是 `{ "version": 1, "entries": [] }`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/command-palette.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): MRU 顶置最近执行的 action + clear 恢复默认顺序

每个用例独立 userDataDir 隔离 MRU 状态

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 完工后建议

- 收集一周内部使用数据观察半衰期 14 天是否合适。如果"老命令一直压顶"，降到 7 天；如果"偶尔用一次就跳顶部"，升到 21 天。
- 后续如果引入超过 50 个 surfaces 为 "command-palette" 的 action，再考虑是否要给 cap 200 加 GC（按 frecency < 0.01 自动剪枝）。
