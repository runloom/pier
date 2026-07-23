# 插件「全部更新」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置 → 插件管理顶栏，当 ≥2 个已安装官方插件有可用更新时提供「全部更新」，串行复用 `plugin.update`，失败继续并在结束时汇总。

**Architecture:** Renderer-only。抽出纯函数收集可更新列表与串行执行结果；`ManagedPluginsSection` 持有 `updatingAll` 状态、顶栏按钮与反馈；经 `mutationsLocked` 禁用行内 mutate 与「检查更新」。不新增主进程命令。

**Tech Stack:** React 19 · Vitest 4 · Testing Library · sonner toast · `showAppAlert` · 现有 `window.pier.managedPlugins.update`

**Spec:** [docs/superpowers/specs/2026-07-23-plugin-update-all-design.md](../specs/2026-07-23-plugin-update-all-design.md)

## Global Constraints

- 可见性：`installed && update != null && officialMutationsAllowed`，且 **count ≥ 2** 才渲染按钮
- 执行：点击瞬间快照列表；**串行** `rejectFailedManagedPluginOperation(update(id))`；失败继续
- 反馈：全成功 `toast.success`；部分/全失败 `showAppAlert`（禁止 `toast.*(…, { description })`）
- 批量中锁定：全部更新、检查更新、行内 install/update/uninstall/rollback、managed enable/disable
- 整批结束 **一次** `refresh()`；不自动 relaunch；不强制先 `checkUpdates`
- 用户文案全部走 i18n（en + zh-CN `settings-plugins`）
- 文件硬顶 500 行：section 已 448 / rows 419 / 测试 483——逻辑进新文件，测试可拆文件
- 不改 `plugin-commands` / install-service / preload API 形状

---

## File map

| 文件 | 职责 |
| --- | --- |
| Create: `src/renderer/pages/settings/components/managed-plugin-update-all.ts` | 纯函数：收集 updatable、串行 run、格式化 alert body |
| Create: `tests/unit/renderer/managed-plugin-update-all.test.ts` | 纯函数单测 |
| Modify: `src/renderer/i18n/locales/en/settings-plugins.ts` | Update All 文案 |
| Modify: `src/renderer/i18n/locales/zh-CN/settings-plugins.ts` | 同上中文 |
| Modify: `src/renderer/pages/settings/components/managed-plugins-section.tsx` | 顶栏按钮、`updatingAll`、调用纯函数、传 `mutationsLocked` |
| Modify: `src/renderer/pages/settings/components/managed-plugin-rows.tsx` | `mutationsLocked` 禁用行动作；`UnifiedList`/actions 透传 |
| Modify: `tests/unit/renderer/managed-plugins-section.test.tsx` **或** Create: `tests/unit/renderer/managed-plugins-update-all-ui.test.tsx` | 可见性 + 点击汇总 UI 测（若原测试文件将超 500，用新文件） |

---

### Task 1: 纯函数 + 单测

**Files:**
- Create: `src/renderer/pages/settings/components/managed-plugin-update-all.ts`
- Create: `tests/unit/renderer/managed-plugin-update-all.test.ts`

**Interfaces:**

```ts
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";

export type UpdatableManagedPlugin = {
  id: string;
  name: string;
  version: string; // target update version
};

/** Stable order: localeCompare on id (en). */
export function listUpdatableManagedPlugins(
  catalog: ManagedPluginCatalogSnapshot | null | undefined,
  officialMutationsAllowed: boolean
): UpdatableManagedPlugin[];

export type ManagedPluginUpdateAllSuccess = { id: string; name: string };
export type ManagedPluginUpdateAllFailure = {
  id: string;
  name: string;
  message: string;
};

export type ManagedPluginUpdateAllResult = {
  successes: ManagedPluginUpdateAllSuccess[];
  failures: ManagedPluginUpdateAllFailure[];
};

/**
 * Serial updates. Does not refresh catalog or show UI.
 * `update` should already wrap IPC; this helper wraps each call with
 * rejectFailedManagedPluginOperation semantics (ok:false → throw).
 */
export function runManagedPluginUpdateAll(input: {
  targets: readonly UpdatableManagedPlugin[];
  update: (id: string) => Promise<unknown>;
  onProgress?: (current: number, total: number) => void;
}): Promise<ManagedPluginUpdateAllResult>;

/** Multiline body for showAppAlert. */
export function formatManagedPluginUpdateAllAlertBody(input: {
  successCount: number;
  failures: readonly ManagedPluginUpdateAllFailure[];
  successSummaryLabel: string; // already interpolated, e.g. "Updated 1 plugin." or ""
}): string;
```

- [ ] **Step 1: 写失败单测**

```ts
// tests/unit/renderer/managed-plugin-update-all.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import {
  formatManagedPluginUpdateAllAlertBody,
  listUpdatableManagedPlugins,
  runManagedPluginUpdateAll,
} from "@/pages/settings/components/managed-plugin-update-all.ts";

function row(
  partial: Partial<ManagedPluginCatalogSnapshot["plugins"][number]> & {
    id: string;
  }
): ManagedPluginCatalogSnapshot["plugins"][number] {
  return {
    desired: { enabled: true, source: "official", version: "1.0.0" },
    diagnostics: [],
    displayName: partial.displayName ?? partial.id,
    effective: { enabled: true, source: "official", version: "1.0.0" },
    id: partial.id,
    installed: partial.installed ?? true,
    lastKnownGoodVersion: "1.0.0",
    offlineRestoreAvailable: false,
    pendingRestart: null,
    update: partial.update === undefined ? { version: "1.1.0" } : partial.update,
    ...partial,
  };
}

function snap(
  plugins: ManagedPluginCatalogSnapshot["plugins"],
  extra?: Partial<ManagedPluginCatalogSnapshot>
): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release",
    plugins,
    ...extra,
  };
}

describe("listUpdatableManagedPlugins", () => {
  it("returns installed rows with update when mutations allowed, sorted by id", () => {
    const list = listUpdatableManagedPlugins(
      snap([
        row({ id: "pier.z", displayName: "Zed", update: { version: "2.0.0" } }),
        row({ id: "pier.a", displayName: "Ada", update: { version: "1.2.0" } }),
        row({ id: "pier.skip", update: null }),
        row({ id: "pier.gone", installed: false, update: { version: "9.0.0" } }),
      ]),
      true
    );
    expect(list.map((x) => x.id)).toEqual(["pier.a", "pier.z"]);
    expect(list[0]).toEqual({
      id: "pier.a",
      name: "Ada",
      version: "1.2.0",
    });
  });

  it("returns empty when official mutations disallowed or catalog missing", () => {
    expect(
      listUpdatableManagedPlugins(
        snap([row({ id: "pier.a" })], { officialMutationsAllowed: false }),
        false
      )
    ).toEqual([]);
    expect(listUpdatableManagedPlugins(null, true)).toEqual([]);
  });
});

describe("runManagedPluginUpdateAll", () => {
  it("runs serially and continues after failure", async () => {
    const order: string[] = [];
    const update = vi.fn(async (id: string) => {
      order.push(id);
      if (id === "pier.a") {
        return { ok: false as const, error: { message: "network down" } };
      }
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: true,
        version: "1.1.0",
      };
    });
    const onProgress = vi.fn();
    const result = await runManagedPluginUpdateAll({
      targets: [
        { id: "pier.a", name: "Ada", version: "1.1.0" },
        { id: "pier.b", name: "Bea", version: "1.1.0" },
      ],
      update,
      onProgress,
    });
    expect(order).toEqual(["pier.a", "pier.b"]);
    expect(result.successes).toEqual([{ id: "pier.b", name: "Bea" }]);
    expect(result.failures).toEqual([
      { id: "pier.a", name: "Ada", message: "network down" },
    ]);
    expect(onProgress).toHaveBeenCalledWith(1, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("treats thrown errors as failures", async () => {
    const result = await runManagedPluginUpdateAll({
      targets: [{ id: "pier.a", name: "Ada", version: "1.1.0" }],
      update: async () => {
        throw new Error("boom");
      },
    });
    expect(result.failures[0]?.message).toBe("boom");
    expect(result.successes).toEqual([]);
  });
});

describe("formatManagedPluginUpdateAllAlertBody", () => {
  it("joins success summary and failure lines", () => {
    const body = formatManagedPluginUpdateAllAlertBody({
      successCount: 1,
      successSummaryLabel: "1 updated.",
      failures: [{ id: "pier.a", name: "Ada", message: "network down" }],
    });
    expect(body).toContain("1 updated.");
    expect(body).toContain("Ada: network down");
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm exec vitest run tests/unit/renderer/managed-plugin-update-all.test.ts`

Expected: FAIL module not found / export missing

- [ ] **Step 3: 实现纯函数**

`managed-plugin-update-all.ts`：

```ts
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import { rejectFailedManagedPluginOperation } from "./managed-plugin-rows.ts";

export type UpdatableManagedPlugin = {
  id: string;
  name: string;
  version: string;
};

export type ManagedPluginUpdateAllSuccess = { id: string; name: string };
export type ManagedPluginUpdateAllFailure = {
  id: string;
  name: string;
  message: string;
};

export type ManagedPluginUpdateAllResult = {
  successes: ManagedPluginUpdateAllSuccess[];
  failures: ManagedPluginUpdateAllFailure[];
};

function displayName(
  row: ManagedPluginCatalogSnapshot["plugins"][number]
): string {
  return row.displayName?.trim() || row.id;
}

export function listUpdatableManagedPlugins(
  catalog: ManagedPluginCatalogSnapshot | null | undefined,
  officialMutationsAllowed: boolean
): UpdatableManagedPlugin[] {
  if (!(catalog && officialMutationsAllowed)) {
    return [];
  }
  const out: UpdatableManagedPlugin[] = [];
  for (const plugin of catalog.plugins) {
    if (!(plugin.installed && plugin.update)) {
      continue;
    }
    out.push({
      id: plugin.id,
      name: displayName(plugin),
      version: plugin.update.version,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function runManagedPluginUpdateAll(input: {
  targets: readonly UpdatableManagedPlugin[];
  update: (id: string) => Promise<unknown>;
  onProgress?: (current: number, total: number) => void;
}): Promise<ManagedPluginUpdateAllResult> {
  const successes: ManagedPluginUpdateAllSuccess[] = [];
  const failures: ManagedPluginUpdateAllFailure[] = [];
  const total = input.targets.length;
  let current = 0;
  for (const target of input.targets) {
    current += 1;
    input.onProgress?.(current, total);
    try {
      await rejectFailedManagedPluginOperation(input.update(target.id));
      successes.push({ id: target.id, name: target.name });
    } catch (err) {
      failures.push({
        id: target.id,
        name: target.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { successes, failures };
}

export function formatManagedPluginUpdateAllAlertBody(input: {
  successCount: number;
  failures: readonly ManagedPluginUpdateAllFailure[];
  successSummaryLabel: string;
}): string {
  const lines: string[] = [];
  if (input.successCount > 0 && input.successSummaryLabel.trim()) {
    lines.push(input.successSummaryLabel.trim());
  }
  for (const failure of input.failures) {
    lines.push(`${failure.name}: ${failure.message}`);
  }
  return lines.join("\n");
}
```

注意：若 `rejectFailedManagedPluginOperation` 从 rows 导入会拉 React 组件图，可改为：

1. 把 `rejectFailedManagedPluginOperation` + `isManagedOperationFailure` 挪到同文件 `managed-plugin-operation.ts`，rows 与 update-all 都从那里 import；或  
2. 在 `runManagedPluginUpdateAll` 内联相同 ok:false 检查（小重复，可接受）。

**推荐 (1)**：Create `managed-plugin-operation.ts`，从 `managed-plugin-rows.tsx` 挪出这两个函数并 re-export 或改 rows 的 import。保持单一实现。

- [ ] **Step 4: 跑测通过**

Run: `pnpm exec vitest run tests/unit/renderer/managed-plugin-update-all.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/renderer/pages/settings/components/managed-plugin-update-all.ts \
  src/renderer/pages/settings/components/managed-plugin-operation.ts \
  src/renderer/pages/settings/components/managed-plugin-rows.tsx \
  tests/unit/renderer/managed-plugin-update-all.test.ts
git commit -m "$(cat <<'EOF'
feat(plugins): add update-all pure helpers

Extract serial batch update runner and updatable list selection
for settings plugin management.
EOF
)"
```

（若未拆 operation 文件，commit 列表去掉该路径。）

---

### Task 2: i18n 文案

**Files:**
- Modify: `src/renderer/i18n/locales/en/settings-plugins.ts`
- Modify: `src/renderer/i18n/locales/zh-CN/settings-plugins.ts`

**Interfaces:** keys under `settings.plugins.*`（与现有 `action` / `toast` 同级结构）

- [ ] **Step 1: 英文**

在 `action` 增加：

```ts
updateAll: "Update All",
```

在 `toast` 增加：

```ts
updatingAll: "Updating plugins…",
updatingAllProgress: "Updating {{current}}/{{total}}…",
updatedAll: "Updated {{count}} plugins",
updateAllPartialTitle: "Some plugins couldn't be updated",
updateAllFailedTitle: "Couldn't update plugins",
updateAllSuccessSummary: "{{count}} updated.",
```

- [ ] **Step 2: 中文**

```ts
// action
updateAll: "全部更新",

// toast
updatingAll: "正在更新插件…",
updatingAllProgress: "正在更新 {{current}}/{{total}}…",
updatedAll: "已更新 {{count}} 个插件",
updateAllPartialTitle: "部分插件未能更新",
updateAllFailedTitle: "无法更新插件",
updateAllSuccessSummary: "已成功 {{count}} 个。",
```

- [ ] **Step 3: Commit**

```bash
git add \
  src/renderer/i18n/locales/en/settings-plugins.ts \
  src/renderer/i18n/locales/zh-CN/settings-plugins.ts
git commit -m "feat(i18n): add plugin Update All copy"
```

---

### Task 3: Section UI + 行锁定 + 组件测

**Files:**
- Modify: `src/renderer/pages/settings/components/managed-plugins-section.tsx`
- Modify: `src/renderer/pages/settings/components/managed-plugin-rows.tsx`
- Create: `tests/unit/renderer/managed-plugins-update-all-ui.test.tsx`（推荐新文件，避免原测试超硬顶）

**Interfaces:**

```ts
// ManagedRowExtraActions / AvailableManagedRow / UnavailableManagedRow / UnifiedList
mutationsLocked?: boolean; // default false; when true disable mutate buttons

// section
const officialMutationsAllowed = catalog?.officialMutationsAllowed ?? true;
const updatable = listUpdatableManagedPlugins(catalog, officialMutationsAllowed);
const showUpdateAll = updatable.length >= 2;
const [updatingAll, setUpdatingAll] = useState(false);
const mutationsLocked = updatingAll; // can OR with other future locks
```

- [ ] **Step 1: 写 UI 失败测**

```tsx
// tests/unit/renderer/managed-plugins-update-all-ui.test.tsx
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { ManagedPluginsSection } from "@/pages/settings/components/managed-plugins-section.tsx";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "toast-batch"),
  promise: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
}));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return { ...actual, showAppAlert: appDialogMocks.showAppAlert };
});

function entry(id: string, name: string): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name,
      panels: [],
      permissions: [],
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: `pier-plugin://${id}/1.0.0/dist/renderer.js`,
    },
  };
}

function catalogTwoUpdates(
  extra?: Partial<ManagedPluginCatalogSnapshot>
): ManagedPluginCatalogSnapshot {
  return {
    checkedAt: 1,
    officialMutationsAllowed: true,
    pluginMode: "release",
    plugins: [
      {
        desired: { enabled: true, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Ada",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.ada",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: { version: "1.1.0" },
      },
      {
        desired: { enabled: true, source: "official", version: "1.0.0" },
        diagnostics: [],
        displayName: "Bea",
        effective: { enabled: true, source: "official", version: "1.0.0" },
        id: "pier.bea",
        installed: true,
        lastKnownGoodVersion: "1.0.0",
        offlineRestoreAvailable: false,
        pendingRestart: null,
        update: { version: "1.2.0" },
      },
    ],
    ...extra,
  };
}

function stubPier(managed: Record<string, unknown>): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: { managedPlugins: managed },
  });
}

describe("ManagedPluginsSection Update All", () => {
  beforeEach(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    toastMocks.loading.mockReset();
    toastMocks.success.mockReset();
    toastMocks.dismiss.mockReset();
    appDialogMocks.showAppAlert.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hides Update All when fewer than two plugins can update", async () => {
    const one = catalogTwoUpdates();
    one.plugins = [one.plugins[0]!];
    stubPier({
      checkUpdates: vi.fn(async () => one),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => one),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: "Update All" })).toBeNull();
  });

  it("shows Update All for two updatable plugins and updates serially", async () => {
    const cat = catalogTwoUpdates();
    const update = vi.fn(async (id: string) => ({
      ok: true as const,
      pluginId: id,
      requiresRestart: true,
      version: "1.1.0",
    }));
    const list = vi.fn(async () => cat);
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list,
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update,
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update All" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("pier.ada");
      expect(update).toHaveBeenCalledWith("pier.bea");
    });
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled();
    });
    // list: initial mount + final refresh
    await waitFor(() => {
      expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("alerts on partial failure and still calls every update", async () => {
    const cat = catalogTwoUpdates();
    const update = vi.fn(async (id: string) => {
      if (id === "pier.ada") {
        return { ok: false as const, error: { message: "network down" } };
      }
      return {
        ok: true as const,
        pluginId: id,
        requiresRestart: true,
        version: "1.2.0",
      };
    });
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => cat),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update,
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Update All" }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
      expect(appDialogMocks.showAppAlert).toHaveBeenCalled();
    });
    const arg = appDialogMocks.showAppAlert.mock.calls[0]?.[0] as {
      title: string;
      body: string;
    };
    expect(arg.title).toMatch(/couldn't be updated|未能更新/i);
    expect(arg.body).toMatch(/Ada/i);
    expect(arg.body).toMatch(/network down/i);
  });

  it("hides Update All when official mutations are disallowed", async () => {
    const cat = catalogTwoUpdates({ officialMutationsAllowed: false });
    stubPier({
      checkUpdates: vi.fn(async () => cat),
      disable: vi.fn(),
      enable: vi.fn(),
      install: vi.fn(),
      list: vi.fn(async () => cat),
      rollback: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
    });
    render(
      <ManagedPluginsSection
        builtinEntries={[entry("pier.ada", "Ada"), entry("pier.bea", "Bea")]}
        builtinInitialized
        onToggleBuiltin={vi.fn()}
        pendingBuiltinId={null}
      />
    );
    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: "Update All" })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑 UI 测确认失败**

Run: `pnpm exec vitest run tests/unit/renderer/managed-plugins-update-all-ui.test.tsx`

Expected: FAIL — no Update All button

- [ ] **Step 3: rows 增加 `mutationsLocked`**

`ManagedRowExtraActions` / `AvailableManagedRow` 动作按钮：

```tsx
disabled={pending || mutationsLocked}
```

`UnifiedList` props 增加 `mutationsLocked?: boolean`，传给 `ManagedRowExtraActions`、`AvailableManagedRow`、`UnavailableManagedRow`。

`toggle` 侧：section 的 `toggleManaged` 在 `updatingAll` 时直接 return；传给 PluginRow 的 pending 逻辑保持；enable/disable 按钮若由 PluginRow 控制，在 `onToggleManaged` no-op + 可选 disable（若 PluginRow 无 disabled prop，至少 no-op + 不进入 pending）。

检查更新按钮：

```tsx
disabled={checkingUpdates || updatingAll}
```

- [ ] **Step 4: section 接线**

在 `ManagedPluginsSection` 内（保持文件 ≤500：handler 尽量短，逻辑在纯函数）：

```tsx
import {
  formatManagedPluginUpdateAllAlertBody,
  listUpdatableManagedPlugins,
  runManagedPluginUpdateAll,
} from "./managed-plugin-update-all.ts";

// inside component:
const [updatingAll, setUpdatingAll] = useState(false);
const officialMutationsAllowed = catalog?.officialMutationsAllowed ?? true;
const updatable = listUpdatableManagedPlugins(
  catalog,
  officialMutationsAllowed
);
const showUpdateAll = updatable.length >= 2;

const handleUpdateAll = useCallback((): void => {
  if (updatingAll) return;
  const targets = listUpdatableManagedPlugins(
    catalog,
    catalog?.officialMutationsAllowed ?? true
  );
  if (targets.length < 2) return;
  const updateFn = win?.managedPlugins?.update;
  if (!updateFn) return;

  setUpdatingAll(true);
  const loadingId = toast.loading(t("settings.plugins.toast.updatingAll"));

  void runManagedPluginUpdateAll({
    targets,
    update: (id) => updateFn(id),
    onProgress: (current, total) => {
      toast.loading(
        t("settings.plugins.toast.updatingAllProgress", { current, total }),
        { id: loadingId }
      );
    },
  })
    .then((result) => {
      const { successes, failures } = result;
      if (failures.length === 0) {
        toast.success(
          t("settings.plugins.toast.updatedAll", {
            count: successes.length,
          }),
          { id: loadingId }
        );
        return;
      }
      toast.dismiss(loadingId);
      const successSummaryLabel =
        successes.length > 0
          ? t("settings.plugins.toast.updateAllSuccessSummary", {
              count: successes.length,
            })
          : "";
      showAppAlert({
        title: t(
          successes.length === 0
            ? "settings.plugins.toast.updateAllFailedTitle"
            : "settings.plugins.toast.updateAllPartialTitle"
        ),
        body: formatManagedPluginUpdateAllAlertBody({
          successCount: successes.length,
          failures,
          successSummaryLabel,
        }),
      });
    })
    .catch((err: unknown) => {
      toast.dismiss(loadingId);
      showAppAlert({
        title: t("settings.plugins.toast.updateAllFailedTitle"),
        body: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      setUpdatingAll(false);
      refresh();
    });
}, [catalog, refresh, t, updatingAll, win]);
```

顶栏（「立即重启」与检查更新之间）：

```tsx
{showUpdateAll ? (
  <Button
    disabled={updatingAll}
    onClick={handleUpdateAll}
    size="sm"
    type="button"
    variant="default"
  >
    {updatingAll ? (
      <Loader2 aria-hidden className="animate-spin" data-icon="inline-start" />
    ) : null}
    {t("settings.plugins.action.updateAll")}
  </Button>
) : null}
```

导入 `Loader2`（若 section 尚未导入）。

`UnifiedList` 增加 `mutationsLocked={updatingAll}`。

`toggleManaged` 开头：`if (updatingAll) return;`

若 section 行数逼近 500：把 `handleUpdateAll` 抽到 `use-managed-plugin-update-all.ts` hook（同目录），section 只消费 `{ showUpdateAll, updatingAll, handleUpdateAll }`。

- [ ] **Step 5: 跑 UI + 纯函数测**

Run:

```bash
pnpm exec vitest run \
  tests/unit/renderer/managed-plugin-update-all.test.ts \
  tests/unit/renderer/managed-plugins-update-all-ui.test.tsx \
  tests/unit/renderer/managed-plugins-section.test.tsx
```

Expected: 全部 PASS（含既有 section 测不回归）

- [ ] **Step 6: Commit**

```bash
git add \
  src/renderer/pages/settings/components/managed-plugins-section.tsx \
  src/renderer/pages/settings/components/managed-plugin-rows.tsx \
  src/renderer/pages/settings/components/use-managed-plugin-update-all.ts \
  tests/unit/renderer/managed-plugins-update-all-ui.test.tsx
git commit -m "$(cat <<'EOF'
feat(plugins): add Update All control in settings

Show batch update when two or more managed plugins have updates;
serial IPC with continue-on-failure summary.
EOF
)"
```

（无 hook 文件则勿 add。）

---

### Task 4: 验收与收尾

**Files:** 无新文件；必要时修 file-size / lint

- [ ] **Step 1: 对照 spec §1.1**

| 标准 | 验证 |
| --- | --- |
| ≥2 显示 | UI 测 |
| <2 / workspace 门控隐藏 | UI 测 + `officialMutationsAllowed: false` |
| 串行 update、失败继续 | 纯函数 + UI partial |
| 汇总反馈 | success toast / partial alert |
| 批量锁定 | 代码审查：`disabled={… \|\| mutationsLocked}`；检查更新 `updatingAll` |
| 无新命令 / 无自动重启 | grep 无 `plugin.updateAll`；handler 无 `relaunch` |

- [ ] **Step 2: 文件体积**

Run: `wc -l src/renderer/pages/settings/components/managed-plugin*.tsx src/renderer/pages/settings/components/managed-plugin-update-all.ts`

Expected: 各文件 ≤500

- [ ] **Step 3: 定向检查**

```bash
pnpm exec vitest run \
  tests/unit/renderer/managed-plugin-update-all.test.ts \
  tests/unit/renderer/managed-plugins-update-all-ui.test.tsx \
  tests/unit/renderer/managed-plugins-section.test.tsx
```

可选：`pnpm exec biome check` 仅改动路径。

- [ ] **Step 4: 若有修复则 commit**

```bash
git add -A
git commit -m "fix(plugins): polish Update All after verification"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
| --- | --- |
| ≥2 可见性 | 1 `listUpdatable…` + 3 UI |
| officialMutationsAllowed / workspace | 1 + 3 |
| Renderer 串行 `plugin.update` | 1 `runManagedPluginUpdateAll` + 3 |
| 失败继续 + 汇总 | 1 + 3 partial/full alert |
| 批量锁 mutate / 检查更新 | 3 |
| 整批一次 refresh | 3 `finally refresh` |
| 不新命令 / 不自动重启 | 约束 + Task 4 grep |
| i18n | 2 |
| 文件硬顶 | 1 抽纯函数；3 可选 hook；UI 测新文件 |

**Placeholder scan:** 无 TBD；测试含完整代码。  
**类型一致:** `UpdatableManagedPlugin` / `ManagedPluginUpdateAllResult` 全任务同名。

---

## Execution handoff

Plan complete: `docs/superpowers/plans/2026-07-23-plugin-update-all.md`.

**两选一：**

1. **Subagent-Driven（推荐）** — 每任务新子代理 + 任务间 review  
2. **Inline Execution** — 本会话按 executing-plans 连续做

要哪种？
