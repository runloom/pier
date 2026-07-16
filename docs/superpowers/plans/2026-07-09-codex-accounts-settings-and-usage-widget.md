# Codex Accounts Settings + Usage Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `pier.codex` 设置页成为账号 CRUD 唯一入口（对齐 Orca 图 1），Workbench 物料改为用量仪表盘（对齐图 2 子集），并删除命令面板账号操作；宿主新增可复用的 `settingsPages` 贡献点。

**Architecture:** 宿主增加 `settingsPages` 纪律链（manifest → assert → registry → SettingsDialog）。插件经 `context.settingsPages.register` 挂自定义设置页；物料只做用量 + 快切 + `context.app.openSettings`。`activeAccountId === null` 表示系统默认；新增 `accounts.selectSystemDefault`；用量 DTO 结构化并支持系统默认缓存键 `__system__`。

**Tech Stack:** TypeScript 6 strict · React 19 · Vitest 4 · Zod · `@pier/ui`（Progress / widget-state / format）· plugin RPC

**Spec:** [docs/superpowers/specs/2026-07-09-codex-accounts-settings-and-usage-widget-design.md](../specs/2026-07-09-codex-accounts-settings-and-usage-widget-design.md)

## Global Constraints

- **不 auto-commit**：每个 Task 结尾跑验证命令即可；commit 由用户统一决策。计划里不写 git commit 步骤。
- **禁止 `@ts-ignore` / `@ts-expect-error` / `as any`**。
- **TDD**：含测试的 Task 按「写失败测试 → 确认失败 → 实现 → 确认通过」。
- **操作反馈**：失败必须 `notifications.error` / toast；成功有强自然 UI 反馈时不加 success toast。
- **破坏性确认**：删除账号 `dialogs.confirm` 必须能传 `intent: "destructive"`（扩展 external dialogs API）。
- **插件边界**：不特判 `pier.codex` 硬编码设置页；不做速率限制「立即重置」。
- **测试命令**：`pnpm test:unit -- <file>`；类型 `pnpm typecheck`。

---

## File Structure

**新增：**
- `src/renderer/lib/plugins/plugin-settings-page-registry.ts` — settingsPage 运行时注册表
- `packages/plugin-codex/src/renderer/accounts-settings-page.tsx` — 图 1 设置页
- `packages/plugin-codex/src/renderer/usage-meter.tsx` — 会话/每周进度条
- `packages/plugin-codex/src/renderer/account-picker.tsx` — 物料内账号选择
- `packages/plugin-codex/src/shared/usage.ts` — 用量展示纯函数（remaining %、resets label）
- `tests/unit/renderer/plugin-settings-page-registry.test.ts`
- `tests/unit/renderer/codex-accounts-settings-page.test.tsx`
- `tests/unit/shared/codex-usage-display.test.ts`（或放 `tests/unit/plugin-codex/` 若仓库已有惯例则跟现有）

**修改：**
- `src/shared/contracts/plugin.ts` — `settingsPages` + locale
- `src/shared/contracts/managed-plugin.ts` — package manifest `settingsPages`
- `packages/plugin-api/src/renderer.ts` — `settingsPages` / `app` / `dialogs.confirm.intent`
- `src/renderer/lib/plugins/external-plugin-context.ts` — 接线
- `src/renderer/lib/plugins/host-context.ts` — 若 builtin 也暴露同 API 则对齐（external 必做；builtin 可选同构以免类型分叉）
- `src/renderer/pages/settings/data/appearance-nav.ts` — 侧栏出现条件
- `src/renderer/pages/settings/settings-dialog.tsx` — 优先渲染自定义页
- `packages/plugin-codex/plugin.json` — settingsPages、删 commands、refreshable、尺寸
- `packages/plugin-codex/src/shared/accounts.ts` — usage DTO + 无新 payload 类型也可
- `packages/plugin-codex/src/main/accounts-service.ts` — selectSystemDefault + 系统默认用量
- `packages/plugin-codex/src/main/index.ts` — 注册 RPC
- `packages/plugin-codex/src/renderer/accounts-widget.tsx` — 重写为用量仪表盘
- `packages/plugin-codex/src/renderer/index.tsx` — 注册 settingsPage + widget（消费宿主 props）
- `tests/unit/renderer/plugin-settings-nav.test.ts`
- `tests/unit/renderer/codex-accounts-widget.test.tsx`
- `tests/unit/main/codex-plugin-accounts-service.test.ts`

---

### Task 1: Manifest schema — `settingsPages`

**Files:**
- Modify: `src/shared/contracts/plugin.ts`
- Modify: `src/shared/contracts/managed-plugin.ts`
- Test: `tests/unit/shared/plugin-manifest-settings-pages.test.ts`（新建）

**Interfaces:**
- Produces:
  - `pluginSettingsPageContributionSchema = z.object({ id: z.string().min(1), title: z.string().min(1).optional() })`
  - `settingsPages: z.array(...).max(1).default([])` on both runtime + package manifests
  - `pluginLocaleMessagesSchema.settingsPages?: Record<id, { title?: string }>`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { managedPluginPackageManifestSchema } from "@shared/contracts/managed-plugin.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";

const basePackage = {
  apiVersion: 1 as const,
  id: "pier.demo",
  name: "Demo",
  version: "1.0.0",
  engines: { pier: ">=0.1.0 <0.2.0" },
  main: "dist/main.js",
  renderer: "dist/renderer.js",
};

describe("settingsPages contribution", () => {
  it("accepts a single settings page on package manifest", () => {
    const parsed = managedPluginPackageManifestSchema.parse({
      ...basePackage,
      settingsPages: [{ id: "pier.demo.accounts" }],
    });
    expect(parsed.settingsPages).toEqual([{ id: "pier.demo.accounts" }]);
  });

  it("rejects more than one settings page", () => {
    expect(() =>
      managedPluginPackageManifestSchema.parse({
        ...basePackage,
        settingsPages: [{ id: "a" }, { id: "b" }],
      })
    ).toThrow();
  });

  it("defaults settingsPages to [] on runtime manifest", () => {
    const parsed = pluginManifestSchema.parse({
      apiVersion: 1,
      id: "pier.demo",
      name: "Demo",
      version: "1.0.0",
      engines: { pier: ">=0.1.0" },
      source: { kind: "official" },
    });
    expect(parsed.settingsPages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**（unknown key stripped or schema missing）

Run: `pnpm test:unit -- tests/unit/shared/plugin-manifest-settings-pages.test.ts`

- [ ] **Step 3: Implement schemas**

在 `plugin.ts` 增加 contribution schema，并入 `pluginManifestSchema` 与 `pluginLocaleMessagesSchema`。在 `managed-plugin.ts` 的 `managedPluginPackageManifestSchema` 同样加入 `settingsPages`（从 `plugin.ts` import schema，避免重复定义）。

- [ ] **Step 4: Run test — expect PASS**

---

### Task 2: Host settingsPage registry + external context APIs

**Files:**
- Create: `src/renderer/lib/plugins/plugin-settings-page-registry.ts`
- Modify: `packages/plugin-api/src/renderer.ts`
- Modify: `src/renderer/lib/plugins/external-plugin-context.ts`
- Create: `tests/unit/renderer/plugin-settings-page-registry.test.ts`
- Modify: `tests/unit/renderer/codex-accounts-widget.test.tsx`（mock context 补 `settingsPages` / `app`，避免类型破）

**Interfaces:**
- Produces (`packages/plugin-api/src/renderer.ts`):

```ts
export interface RendererSettingsPageRegistration {
  id: string;
  component: ComponentType<Record<string, never>>;
}

// ExternalRendererPluginContext 新增：
settingsPages: {
  register(registration: RendererSettingsPageRegistration): () => void;
};
app: {
  openSettings(options?: { section?: string }): void;
};
dialogs: {
  alert(options: { body?: string; title: string }): Promise<void>;
  confirm(options: {
    body?: string;
    title: string;
    intent?: "default" | "destructive";
  }): Promise<boolean>;
};
```

- Registry API 镜像 `plugin-workbench-widget-registry.ts`：
  - `registerPluginSettingsPage(pluginId, registration)`
  - `getPluginSettingsPage(pluginId)`
  - `subscribePluginSettingsPageRegistry` / `getPluginSettingsPageRevision`
  - `clearPluginSettingsPagesForTests`

- [ ] **Step 1: Write failing registry + assert tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  clearPluginSettingsPagesForTests,
  getPluginSettingsPage,
  registerPluginSettingsPage,
} from "@/lib/plugins/plugin-settings-page-registry.ts";

describe("plugin settings page registry", () => {
  it("stores one page per plugin and dispose clears it", () => {
    clearPluginSettingsPagesForTests();
    const dispose = registerPluginSettingsPage("pier.demo", {
      id: "pier.demo.accounts",
      component: () => null,
    });
    expect(getPluginSettingsPage("pier.demo")?.id).toBe("pier.demo.accounts");
    dispose();
    expect(getPluginSettingsPage("pier.demo")).toBeUndefined();
  });
});
```

另写一条：`createExternalRendererPluginContext` 在 manifest 未声明 `settingsPages` 时 `register` 抛错（可放同文件或 `external-plugin-context` 测试）。

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement registry + wire `external-plugin-context.ts`**

要点：
- `assertDeclared` 扩展 kind `"settingsPage"`，读 `entry.manifest.settingsPages`。
- `settingsPages.register` → `registerPluginSettingsPage(pluginId, registration)`；v1 若该 plugin 已有注册则 throw。
- `app.openSettings` → `useSettingsDialogStore.getState().openSection(options?.section ?? "appearance")`（section 缺省打开 appearance；物料传 `plugin:pier.codex`）。
- `dialogs.confirm`：把 `options.intent ?? "default"` 传入 `showAppConfirm`（`size: "sm"` 保持）。

- [ ] **Step 4: Update widget test mocks** with empty `settingsPages` / `app` stubs so existing tests typecheck.

- [ ] **Step 5: Run tests PASS**

Run: `pnpm test:unit -- tests/unit/renderer/plugin-settings-page-registry.test.ts tests/unit/renderer/codex-accounts-widget.test.tsx`

---

### Task 3: SettingsDialog — nav + custom page render

**Files:**
- Modify: `src/renderer/pages/settings/data/appearance-nav.ts`
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`
- Modify: `tests/unit/renderer/plugin-settings-nav.test.ts`
- Create: `tests/unit/renderer/settings-dialog-plugin-page.test.tsx`（或扩展现有 settings dialog 测试）

**Interfaces:**
- Consumes: `getPluginSettingsPage` / revision subscription
- `pluginNavItems` 条件改为：`enabled && (configuration || settingsPages.length > 0)`

- [ ] **Step 1: Extend nav tests**

在 `plugin-settings-nav.test.ts` 的 `entry()` helper 增加 `settingsPages?: boolean`：

```ts
it("includes enabled plugins that only declare settingsPages", () => {
  const items = pluginNavItems(
    [entry("pier.only-page", { configured: false, settingsPages: true })],
    "en"
  );
  expect(items).toHaveLength(1);
  expect(items[0]?.id).toBe("plugin:pier.only-page");
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `pluginNavItems` filter**

```ts
.filter(
  (entry) =>
    entry.runtime.enabled &&
    (Boolean(entry.manifest.configuration) ||
      entry.manifest.settingsPages.length > 0)
)
```

- [ ] **Step 4: SettingsDialog render priority**

当 `activePluginId` 有值时：

```tsx
const customPage = getPluginSettingsPage(activePluginId);
// subscribe revision via useSyncExternalStore so register 后重渲染
{customPage ? (
  <customPage.component />
) : (
  <PluginConfigurationSection pluginId={activePluginId} />
)}
```

用 `useSyncExternalStore(subscribePluginSettingsPageRegistry, getPluginSettingsPageRevision)`。

组件测试：register 假页面后 `openSection("plugin:pier.demo")` 能看到自定义标记，且不渲染 configuration switch。

- [ ] **Step 5: Run PASS**

---

### Task 4: Plugin main — usage DTO + `selectSystemDefault` + system usage

**Files:**
- Modify: `packages/plugin-codex/src/shared/accounts.ts`
- Modify: `packages/plugin-codex/src/main/accounts-service.ts`
- Modify: `packages/plugin-codex/src/main/index.ts`
- Modify: `tests/unit/main/codex-plugin-accounts-service.test.ts`

**Interfaces:**
- Produces:

```ts
// shared/accounts.ts
export interface CodexUsageWindow {
  usedPercent: number;
  resetsAt?: number;
  windowMinutes?: number;
}

export interface CodexUsageSnapshot {
  fetchedAt: number;
  status: "ok" | "error";
  error?: string;
  session?: CodexUsageWindow;
  weekly?: CodexUsageWindow;
  raw?: unknown;
}

// CodexAccountsService
selectSystemDefault(): Promise<void>;
```

- 常量：`SYSTEM_USAGE_CACHE_KEY = "__system__"`
- `toSummary` / snapshot：活跃账号的 `usage` 用结构化字段；系统默认时 snapshot 可在顶层或「虚拟」方式暴露当前 usage——**约定**：在 `CodexAccountsSnapshot` 增加可选 `activeUsage: CodexUsageSnapshot | null`（当前活跃身份用量），避免 UI 还要猜缓存键。受管活跃时 `activeUsage` 与该 account.usage 一致；系统默认时只有 `activeUsage`。

- [ ] **Step 1: Write failing service tests**

```ts
it("selectSystemDefault clears activeAccountId after syncBack", async () => {
  // seed one managed active account, mock provider.syncBack → ok
  await service.selectSystemDefault();
  expect(service.snapshot().activeAccountId).toBeNull();
  expect(provider.syncBack).toHaveBeenCalled();
});

it("refreshUsage fetches for system default into activeUsage", async () => {
  // activeAccountId null; provider.fetchUsage returns session/weekly
  await service.refreshUsage(true);
  const snap = service.snapshot();
  expect(snap.activeUsage?.status).toBe("ok");
  expect(snap.activeUsage?.session?.usedPercent).toBe(32);
});
```

（按现有 test 文件的 mock 风格改写；先读 `codex-plugin-accounts-service.test.ts` 顶部 helpers。）

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`doSelectSystemDefault`：
1. 若已是 null → return
2. 若有 active 受管 → `syncBack` + drift 处理（同 `doSelect` 前半）
3. `activeAccountId = null`；emit；`doRefreshUsage(true)` fire-and-forget

`doRefreshUsage`：
- `cacheKey = activeAccountId ?? SYSTEM_USAGE_CACHE_KEY`
- 去掉「无 activeAccountId 直接 return」
- `toSummary` 写结构化 usage；`buildSnapshot` 设 `activeUsage` from `usageCache[cacheKey]`

`index.ts`：`context.rpc.handle("accounts.selectSystemDefault", ...)`

- [ ] **Step 4: Run PASS**

Run: `pnpm test:unit -- tests/unit/main/codex-plugin-accounts-service.test.ts`

---

### Task 5: Shared usage display helpers

**Files:**
- Create: `packages/plugin-codex/src/shared/usage.ts`
- Create: `tests/unit/shared/codex-usage-display.test.ts`

**Interfaces:**
- Produces:

```ts
export function remainingPercent(usedPercent: number): number;
// clamp 0..100, round

export function resetsInLabel(resetsAt: number | undefined, now: number): string | null;
// uses formatDurationShort(resetsAt - now) when resetsAt > now; else null
```

（`formatDurationShort` 从 `@pier/ui/format.tsx` 引入——若 shared 层不宜依赖 UI 包，则在 renderer 侧包一层；**优先**把纯数学放 shared，label 组装放 renderer。若 depcruise 禁止 plugin shared → ui，则 `remainingPercent` 在 shared，label 在 `usage-meter.tsx`。）

- [ ] **Step 1–4: TDD 实现 `remainingPercent`；label 在 Task 6 组件内用 `formatDurationShort` / `formatRelativeTime`。**

---

### Task 6: Settings page UI（图 1）

**Files:**
- Create: `packages/plugin-codex/src/renderer/accounts-settings-page.tsx`
- Modify: `packages/plugin-codex/src/renderer/index.tsx`
- Modify: `packages/plugin-codex/plugin.json`
- Create: `tests/unit/renderer/codex-accounts-settings-page.test.tsx`

**Interfaces:**
- Consumes: RPC + `configuration` + `dialogs` + `notifications` + `i18n`
- `plugin.json` 增加 `"settingsPages": [{ "id": "pier.codex.accounts" }]`；删除三条 `commands` 及 locales.commands；保留 `configuration.confirmSwitch`。

- [ ] **Step 1: Write failing component tests**

覆盖：
1. `activeAccountId === null` 时系统默认卡有「Current」badge；虚线空态可见。
2. 点「Add account」→ `accounts.add`。
3. 有受管账号时点删除 → `dialogs.confirm`（destructive）后 `accounts.remove`。
4. 非系统默认时点系统默认卡 →（confirmSwitch true 时先 confirm）`accounts.selectSystemDefault`。

Mock context 同 widget 测试，补全 `settingsPages` / `app`。

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement page**

布局（token，无硬编码色）：
- 标题 + 两段说明
- 「Accounts」区头 + `+ Add account`
- 系统默认实线卡
- 受管列表 / 虚线空态
- 登录中 Alert + Cancel
- `confirmSwitch` Switch（`configuration.get/set`）
- 次要：`Adopt current login` ghost/outline 小按钮

共享 snapshot 订阅逻辑可抽 `useCodexAccountsSnapshot(context)` 到 `packages/plugin-codex/src/renderer/use-accounts-snapshot.ts`，设置页与物料共用（推荐，避免双份 revision 逻辑）。

- [ ] **Step 4: Register in `index.tsx`**

```ts
const disposeSettings = context.settingsPages.register({
  id: "pier.codex.accounts",
  component: () => AccountsSettingsPage({ context }),
});
// combine dispose with widget dispose
```

- [ ] **Step 5: Run PASS**

---

### Task 7: Usage widget rewrite（图 2 子集）

**Files:**
- Rewrite: `packages/plugin-codex/src/renderer/accounts-widget.tsx`
- Create: `packages/plugin-codex/src/renderer/usage-meter.tsx`
- Create: `packages/plugin-codex/src/renderer/account-picker.tsx`
- Modify: `packages/plugin-codex/src/renderer/index.tsx`（widget 必须消费宿主 `visible` / `refreshToken`）
- Modify: `packages/plugin-codex/plugin.json`（`refreshable: true`；调整 `defaultSize` 如 `{ w: 4, h: 6 }`）
- Rewrite: `tests/unit/renderer/codex-accounts-widget.test.tsx`

**Interfaces:**
- Widget 注册改为：

```ts
component: (props) => (
  <AccountsWidget context={context} {...props} />
),
```

`AccountsWidgetProps = WorkbenchWidgetComponentProps & { context: ... }`

- [ ] **Step 1: Rewrite failing tests**

旧「Add account」测试删除。新测试：
1. 有 `activeUsage.session/weekly` 时渲染剩余 % 与 resets 文案。
2. 点账号行打开选择；选受管 → `accounts.select`；选系统默认 → `accounts.selectSystemDefault`。
3. 点「Manage accounts…」→ `app.openSettings({ section: "plugin:pier.codex" })`。
4. `refreshToken` 从 0→1 时调用 `accounts.refreshUsage`。
5. loading 用 `data-slot="widget-skeleton"`；error 用 WidgetError。

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement UI**

- Header：Codex + `formatRelativeTime(fetchedAt, now, locale)`（locale 可用 `"en"` 或 `navigator.language`；external i18n 无 locale API 时用 en）
- `UsageMeter`：`Progress` value = remainingPercent；左剩余 %，右 Resets in
- 账号区：`DropdownMenu` / `Popover` 列表（系统默认 + accounts）；Manage accounts 按钮
- `confirmSwitch` 在 select 前生效
- **无**添加/删除/速率重置

- [ ] **Step 4: Run PASS**

---

### Task 8: Manifest cleanup + cross-cutting verification

**Files:**
- Modify: `packages/plugin-codex/plugin.json`（确认 commands 已删、settingsPages 已加）
- Grep 清理任何仍引用三条 command id 的测试/文档断言
- Modify: AGENTS.md 仅当需要把「账号 UI 在大盘」旧表述改成「设置页 CRUD + 物料用量」——**一行修订**，勿扩写

- [ ] **Step 1: Grep**

```bash
rg "pier\\.codex\\.(addAccount|switchAccount|refreshUsage)" --glob '!docs/**'
```

期望：无生产/测试引用（docs 旧计划可留）。

- [ ] **Step 2: typecheck + targeted tests**

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/shared/plugin-manifest-settings-pages.test.ts tests/unit/renderer/plugin-settings-page-registry.test.ts tests/unit/renderer/plugin-settings-nav.test.ts tests/unit/main/codex-plugin-accounts-service.test.ts tests/unit/renderer/codex-accounts-settings-page.test.tsx tests/unit/renderer/codex-accounts-widget.test.tsx
```

- [ ] **Step 3: Manual smoke（开发者）**

1. `pnpm setup:worktree`（若需要）+ `pnpm dev`
2. 设置 → Codex：见系统默认 + 添加账号
3. 工作台加 Codex 物料：见双进度条；管理账号跳转设置
4. 命令面板搜索「Codex: Add」应无结果

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| settingsPages 贡献点 | 1–3 |
| 设置页图 1 CRUD + 系统默认 | 4, 6 |
| 物料图 2 用量 + 快切 + 管理账号 | 7 |
| 删命令面板 commands | 6/8 |
| selectSystemDefault + 系统默认用量 | 4 |
| 结构化 usage DTO | 4–5 |
| confirmSwitch | 6–7 |
| 不做速率重置 | 7（明确不实现） |
| dialogs destructive | 2, 6 |
| visible / refreshToken | 7 |

## Placeholder / consistency check

- 无 TBD；系统默认用量经 `snapshot.activeUsage` 暴露（Task 4 写死约定）。
- `openSettings` section 字符串与 `pluginSectionId("pier.codex")` === `"plugin:pier.codex"` 一致。
- v1 每插件最多 1 个 settingsPage（schema `.max(1)` + register assert）。
