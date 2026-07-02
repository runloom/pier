> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

# Phase 3 — configuration 贡献点全链路 实施计划

日期：2026-07-02
设计文档：`docs/superpowers/specs/2026-07-02-plugin-configuration-and-statusbar-design.md` §3.2（主体）、§3.0（Phase 0 前置产物）、§3.1（复用 Phase 1 的 ContributionTable）、§4、§5、§6。

## Goal

为 Pier 插件系统新增 `configuration` 贡献点全链路：manifest schema 声明 → main L1 持久化（`plugin-settings.json`，只存用户改过的值）→ PierCommand envelope IPC + `PLUGIN_SETTINGS_CHANGED` 广播 → renderer 镜像 store → main/renderer 插件 context 同形 `configuration` API（get / set / reset / onDidChange）→ 设置对话框自动扩展插件设置 section → 详情页只读设置表 → pier.git 试点设置 `pier.git.statusItem.showDirtyIndicator` 验证全链路。

## Architecture

```
manifest（pluginManifestSchema + configuration 子 schema 校验，违规走 invalid_manifest 诊断）
  │
  ├─ main L1: src/main/state/plugin-settings.ts（DebouncedJsonStore + ensureStore，flush 挂退出链）
  │     └─ src/main/services/plugin-settings-service.ts（写前按已启用插件 schema 校验 + change 事件）
  │           ├─ command-router: pluginSettings.getAll / set / reset（PierCommand envelope）
  │           └─ app-core 订阅 → PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED 广播所有窗口
  │
  ├─ renderer: src/renderer/stores/plugin-settings.store.ts（Zustand 镜像：bootstrap 全量拉取 +
  │     订阅广播；set() resolve 路径同步镜像，广播按 diff 去重服务其它窗口）
  │
  ├─ 插件 API（同形）：src/plugins/api/configuration.ts → main context（按 entry 创建，直读 main
  │     store）/ renderer context（读镜像 store）；set/reset 断言 key 前缀 = 自身 pluginId
  │
  └─ UI：设置导航 静态项|插件项 两 variant（插件项来自 Phase 0 usePluginRegistryStore）＋
        PluginConfigurationSection（schema 驱动，即改即存）＋ 详情页只读表（Phase 1 ContributionTable）
```

生效值合并、前缀匹配、写入校验均为 `src/shared/plugin-settings.ts` 纯函数，main/renderer 共用。前缀匹配一律按点分段精确匹配（`pier.git` 匹配 `pier.git.*`，不匹配 `pier.gitx.*`）。

## Tech Stack

- Electron 42 · React 19 · TypeScript 6 strict · zod 4.4.3 · Zustand 5.0.12
- Vitest 4（unit，jsdom + @testing-library/react 16）· Playwright（e2e，`_electron.launch` + `--user-data-dir`）
- Biome 2.5 + Ultracite · dependency-cruiser 边界守护 · pnpm 10

## Global Constraints

- **TS strict**：禁 `@ts-ignore` / `@ts-expect-error` / `as any`。泛型 `get<T>` 返回统一走 `unknown` 中转（`value as T` 前先收窄为 `unknown`），不引入 any。
- **Biome/Ultracite**：每个 task 收尾跑 `pnpm lint`（必要时 `pnpm lint:fix`），对象字面量与 interface 成员保持字母序（现有代码风格）。
- **depcruise 边界**：`main/` ⊥ `renderer/`；`src/plugins` 禁 import main/renderer（试点消费只经 `context.configuration`）；renderer 业务代码不 import dockview；panel-kits 不跨域（本计划不触碰 panel-kits）。shared 是唯一公共层。
- **Git 安全边界（AGENTS.md §05）**：每个 task 的 commit 步骤 = 先 `git add <本 task 的精确路径列表>` → 展示 `git diff --staged` → 给出 Conventional Commits message → **等待用户确认后**才 commit。禁止 `git add .`、`git reset`、`git rebase`、amend、force-push。
- **每 task 结束跑 `pnpm check`**（typecheck + lint + depcruise + file-size），全绿才进入下一个 task。
- **worktree 首次启动**：若在新 worktree 执行，先 `pnpm setup:worktree`。

## Consumes（前置 Phase 产物，本计划假定已合入，不在本计划实现）

| 来源 | 接口 | 本计划消费点 |
| --- | --- | --- |
| Phase 0 | `src/renderer/stores/plugin-registry.store.ts` 导出 `usePluginRegistryStore`，state `{ plugins: PluginRegistryEntry[]; initialized: boolean }`，bootstrap 全量拉取 + 订阅 `PIER_BROADCAST.PLUGINS_CHANGED` | Task 8（renderer context 读已启用插件 configuration 声明）、Task 10（设置导航插件项）、Task 11（详情页当前生效值） |
| Phase 0 | `PIER_BROADCAST.PLUGINS_CHANGED` 常量（`src/shared/ipc-channels.ts`）及 main 侧 setEnabled/refresh 后广播 | Task 10（插件禁用 → 导航项消失 → activeSection fallback，含多窗口场景） |
| Phase 1 | `src/renderer/pages/settings/components/contribution-table.tsx` 导出 `ContributionTable`，props `{ headers: string[]; rows: ReactNode[][] }` | Task 11（详情页设置只读表） |
| Phase 1 | `plugin-details.tsx` 已表格化重构（各贡献点分区纵向堆叠，无贡献则整区隐藏） | Task 11 在其分区序列末尾挂设置区 |

## Produces（本 Phase 对外接口清单，实施时以此为准）

```ts
// src/shared/contracts/plugin.ts
export const pluginConfigurationPropertySchema: z.ZodType<PluginConfigurationProperty>;
export const pluginConfigurationSchema: z.ZodType<PluginConfiguration>;
export type PluginConfigurationProperty; export type PluginConfiguration;
export const pluginLocalizedSettingSchema; export type PluginLocalizedSetting;
// pluginManifestSchema 增 configuration?: PluginConfiguration + 顶层 superRefine（settingKey 前缀）
// pluginLocaleMessagesSchema 增 settings?: Record<string, PluginLocalizedSetting>

// src/shared/contracts/plugin-settings.ts
export type JsonValue; export const jsonValueSchema: z.ZodType<JsonValue>;
export const pluginSettingsStateSchema; export type PluginSettingsState; // { version: 1; values: Record<string, JsonValue> }
export interface PluginSettingsChangedPayload { changedKeys: string[]; values: Record<string, JsonValue>; }

// src/shared/plugin-settings.ts（纯函数）
export function matchesConfigurationPrefix(prefix: string, key: string): boolean;
export function validateConfigurationValue(property: PluginConfigurationProperty, value: unknown): ConfigurationValueValidation;
export function effectiveConfigurationValue(property: PluginConfigurationProperty, userValue: unknown): JsonValue;
export function collectEnabledConfigurationProperties(entries: readonly PluginRegistryEntry[]): ReadonlyMap<string, PluginConfigurationProperty>;
export interface PluginConfigurationChangeEvent { affectsConfiguration(prefix: string): boolean; }
export function createConfigurationChangeEvent(changedKeys: readonly string[]): PluginConfigurationChangeEvent;
export function diffConfigurationValues(previous: Record<string, JsonValue>, next: Record<string, JsonValue>): string[];

// src/main/state/plugin-settings.ts
export interface PluginSettingsStore { init(): Promise<PluginSettingsState>; read(): Promise<PluginSettingsState>; getValues(): Record<string, JsonValue>; setValue(key: string, value: JsonValue): PluginSettingsState; resetValue(key: string): PluginSettingsState; flush(): Promise<void>; }
export function createPluginSettingsStore(opts: { filePath: string }): PluginSettingsStore;
export function getDefaultPluginSettingsStore(): PluginSettingsStore;
export async function flushPluginSettings(): Promise<void>;

// src/main/services/plugin-settings-service.ts
export class PluginSettingsServiceError extends Error { readonly code: "invalid_command" | "not_found"; }
export interface PluginSettingsService { getAll(): Promise<PluginSettingsState>; getValues(): Record<string, JsonValue>; init(): Promise<void>; onDidChange(listener: (payload: PluginSettingsChangedPayload) => void): () => void; reset(key: string): Promise<PluginSettingsState>; set(key: string, value: JsonValue): Promise<PluginSettingsState>; }
export function createPluginSettingsService(opts: { plugins: PluginService; store?: PluginSettingsStore }): PluginSettingsService;

// PierCommand（src/shared/contracts/commands.ts）新命令
{ type: "pluginSettings.getAll" } | { type: "pluginSettings.set"; key: string; value: JsonValue } | { type: "pluginSettings.reset"; key: string }
// src/shared/ipc-channels.ts
PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED = "pier://plugin-settings:changed"

// src/preload/index.ts
export interface PierPluginSettingsAPI { getAll(): Promise<PluginSettingsState>; onChanged(cb: (payload: PluginSettingsChangedPayload) => void): () => void; reset(key: string): Promise<PluginSettingsState>; set(key: string, value: JsonValue): Promise<PluginSettingsState>; }
// PierWindowAPI 增 pluginSettings: PierPluginSettingsAPI

// src/renderer/stores/plugin-settings.store.ts
export const usePluginSettingsStore; // { initialized: boolean; values: Record<string, JsonValue>; applySnapshot; set; reset }
export function subscribePluginSettingsChanges(listener: (changedKeys: readonly string[]) => void): () => void;
export async function initPluginSettingsStore(): Promise<() => void>;

// src/plugins/api/configuration.ts（main + renderer context 同形）
export interface PluginConfigurationApi { get<T>(key: string): T; set(key: string, value: JsonValue): Promise<void>; reset(key: string): Promise<void>; onDidChange(listener: (e: PluginConfigurationChangeEvent) => void): () => void; }
// MainPluginContext / RendererPluginContext 均增 configuration: PluginConfigurationApi

// src/main/plugins/plugin-context.ts
export function createMainPluginContext(opts: { entries: readonly PluginRegistryEntry[]; entry: PluginRegistryEntry; settings: PluginSettingsService }): MainPluginContext;
// MainPluginRuntime 构造函数增 contextFactory: (entry, entries) => MainPluginContext；
// createMainPluginHostApi 增 settings: PluginSettingsService，refresh() 先 await settings.init()

// src/renderer/lib/plugins/display.ts
export function defaultPluginSettingLabel(pluginId: string, key: string): string;
export function resolvePluginSettingDisplay(manifest: PluginManifest, key: string, locale: string): { label: string; description?: string; enumDescriptions?: readonly string[] };
export function resolvePluginConfigurationTitle(entry: PluginRegistryEntry, locale: string): string;

// src/renderer/pages/settings/data/appearance-nav.ts
export interface StaticNavItem { icon: LucideIcon; id: string; variant: "static" }
export interface PluginNavItem { icon: LucideIcon; id: string; label: string; pluginId: string; variant: "plugin" }
export function pluginSectionId(pluginId: string): string; // `plugin:${pluginId}`
export function pluginIdFromSectionId(sectionId: string): string | null;
export function pluginNavItems(entries: readonly PluginRegistryEntry[], locale: string): PluginNavItem[];

// src/renderer/stores/settings-dialog.store.ts 增 activeSection: string; setActiveSection(id: string): void
// src/renderer/pages/settings/components/plugin-configuration-section.tsx 导出 PluginConfigurationSection({ pluginId })
// src/renderer/pages/settings/components/plugin-settings-contribution.tsx 导出 PluginSettingsContribution({ entry })
```

## Task 总览

| # | Task | 依赖 |
| --- | --- | --- |
| 1 | manifest `configuration` schema + 校验（子 schema + 顶层 superRefine） | — |
| 2 | registry 层「插件 id 不得互为点分前缀」校验 | — |
| 3 | shared 契约（plugin-settings state / JsonValue）+ 纯函数（前缀匹配 / 校验 / 生效值 / diff / change event） | 1 |
| 4 | main L1 store `plugin-settings.ts` + 退出 flush 链 | 3 |
| 5 | PluginSettingsService + PierCommand 三命令 + 广播 + preload | 3, 4 |
| 6 | renderer 镜像 store `usePluginSettingsStore` + bootstrap 接线 | 5 |
| 7 | main 侧 `createMainPluginContext(entry)` 按插件创建 + host-api init 前置 | 5 |
| 8 | renderer context `configuration` API | 6 |
| 9 | i18n：locale schema `settings` 段 + display.ts 解析器 | 1 |
| 10 | 设置 UI：导航两 variant + `PluginConfigurationSection` + fallback + UI 文案 | 6, 9 |
| 11 | 详情页设置只读表 + 「打开设置」按钮 | 9, 10 |
| 12 | pier.git 试点设置 + git-status-item 消费 + E2E | 7, 8, 10 |

---

## Task 1：manifest `configuration` schema 与子 schema 校验

**Files:**

- Modify: `src/shared/contracts/plugin.ts`
  - 在 `pluginTerminalStatusItemContributionSchema`（现 77–85 行）之后插入 configuration 两个 schema；
  - `pluginManifestSchema`（现 87–110 行）增加 `configuration` 字段并追加顶层 `superRefine`。
- Test: `tests/unit/shared/plugin-configuration-schema.test.ts`（新建）

**Interfaces:**

- Consumes: `zod@4.4.3`（`ctx.addIssue({ code: "custom" })`；zod 4 中 `.superRefine()` 不再包 ZodEffects，`pluginManifestSchema.parse` / 既有 `pluginRegistryEntrySchema`（现 125–136 行）引用不受影响）。
- Produces:
  - `pluginConfigurationPropertySchema` / `PluginConfigurationProperty`
  - `pluginConfigurationSchema` / `PluginConfiguration`
  - `pluginManifestSchema` 新增 `configuration?: PluginConfiguration`，顶层 superRefine 校验每个 settingKey 以 `<pluginId>.` 为前缀。

**Steps:**

- [ ] 新建 `tests/unit/shared/plugin-configuration-schema.test.ts`，写全量失败测试：

```ts
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

function manifestWith(configuration?: unknown): unknown {
  return {
    apiVersion: 1,
    engines: { pier: ">=0.1.0" },
    id: "pier.sample",
    name: "Sample",
    source: { kind: "builtin" },
    version: "1.0.0",
    ...(configuration === undefined ? {} : { configuration }),
  };
}

function propertiesWith(properties: Record<string, unknown>): unknown {
  return { properties };
}

describe("pluginManifestSchema — configuration", () => {
  it("接受省略 configuration 的 manifest（向后兼容）", () => {
    expect(
      pluginManifestSchema.parse(manifestWith()).configuration
    ).toBeUndefined();
  });

  it("接受合法的 boolean/number/string-enum 声明", () => {
    const parsed = pluginManifestSchema.parse(
      manifestWith({
        properties: {
          "pier.sample.enabled": { default: true, type: "boolean" },
          "pier.sample.limit": {
            default: 10,
            maximum: 100,
            minimum: 1,
            order: 2,
            type: "number",
          },
          "pier.sample.mode": {
            default: "auto",
            description: "Mode of operation.",
            enum: ["auto", "manual"],
            enumDescriptions: ["Automatic", "Manual"],
            type: "string",
          },
        },
        title: "Sample",
      })
    );
    expect(parsed.configuration?.title).toBe("Sample");
    expect(
      parsed.configuration?.properties["pier.sample.mode"]?.enum
    ).toEqual(["auto", "manual"]);
  });

  it("拒绝 default 类型与 type 不匹配", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.enabled": { default: "yes", type: "boolean" },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 enum 配非 string 类型", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.limit": {
              default: 1,
              enum: ["1", "2"],
              type: "number",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 default 不在 enum 内", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "off",
              enum: ["auto", "manual"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 enumDescriptions 与 enum 不等长或无 enum 的 enumDescriptions", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "auto",
              enum: ["auto", "manual"],
              enumDescriptions: ["only-one"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": {
              default: "auto",
              enumDescriptions: ["dangling"],
              type: "string",
            },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝 minimum/maximum 配非 number 类型", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample.mode": { default: "a", minimum: 1, type: "string" },
          })
        )
      )
    ).toThrow();
  });

  it("拒绝设置 key 不带 <pluginId>. 前缀（顶层 superRefine）", () => {
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "other.enabled": { default: true, type: "boolean" },
          })
        )
      )
    ).toThrow();
    // key 恰好等于 pluginId 也不合法（前缀后必须还有剩余段）
    expect(() =>
      pluginManifestSchema.parse(
        manifestWith(
          propertiesWith({
            "pier.sample": { default: true, type: "boolean" },
          })
        )
      )
    ).toThrow();
  });
});
```

- [ ] 运行 `pnpm vitest run tests/unit/shared/plugin-configuration-schema.test.ts`，预期失败输出形如：`ZodError: Unrecognized key: "configuration"`（strict 之外的字段目前会被忽略，故实际预期是「拒绝」类断言 `expected [Function] to throw` 失败 + `parsed.configuration` 为 `undefined` 导致的断言失败）。
- [ ] 在 `src/shared/contracts/plugin.ts` 的 `pluginTerminalStatusItemContributionSchema` type 导出（现 83–85 行）之后插入：

```ts
export const pluginConfigurationPropertySchema = z
  .object({
    default: z.union([z.string(), z.number(), z.boolean()]),
    description: z.string().min(1).optional(),
    enum: z.array(z.string().min(1)).min(1).optional(),
    enumDescriptions: z.array(z.string().min(1)).optional(),
    maximum: z.number().optional(),
    minimum: z.number().optional(),
    order: z.number().optional(),
    type: z.enum(["string", "number", "boolean"]),
  })
  .superRefine((property, ctx) => {
    if (typeof property.default !== property.type) {
      ctx.addIssue({
        code: "custom",
        message: `default must match type "${property.type}"`,
        path: ["default"],
      });
    }
    if (property.enum && property.type !== "string") {
      ctx.addIssue({
        code: "custom",
        message: 'enum is only allowed with type "string"',
        path: ["enum"],
      });
    }
    if (
      property.enum &&
      typeof property.default === "string" &&
      !property.enum.includes(property.default)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "default must be a member of enum",
        path: ["default"],
      });
    }
    if (property.enumDescriptions && !property.enum) {
      ctx.addIssue({
        code: "custom",
        message: "enumDescriptions requires enum",
        path: ["enumDescriptions"],
      });
    }
    if (
      property.enumDescriptions &&
      property.enum &&
      property.enumDescriptions.length !== property.enum.length
    ) {
      ctx.addIssue({
        code: "custom",
        message: "enumDescriptions must have the same length as enum",
        path: ["enumDescriptions"],
      });
    }
    if (
      (property.minimum !== undefined || property.maximum !== undefined) &&
      property.type !== "number"
    ) {
      ctx.addIssue({
        code: "custom",
        message: 'minimum/maximum are only allowed with type "number"',
        path: ["minimum"],
      });
    }
  });
export type PluginConfigurationProperty = z.infer<
  typeof pluginConfigurationPropertySchema
>;

export const pluginConfigurationSchema = z.object({
  properties: z.record(z.string().min(1), pluginConfigurationPropertySchema),
  title: z.string().min(1).optional(),
});
export type PluginConfiguration = z.infer<typeof pluginConfigurationSchema>;
```

- [ ] `pluginManifestSchema`（现 87 行起）：在 `commands` 字段后按字母序插入 `configuration: pluginConfigurationSchema.optional(),`，并把 `z.object({...})` 尾部改为链式 `.superRefine(...)`：

```ts
export const pluginManifestSchema = z
  .object({
    apiVersion: z.literal(1),
    commands: z.array(pluginCommandContributionSchema).default([]),
    configuration: pluginConfigurationSchema.optional(),
    description: z.string().min(1).optional(),
    // …其余字段与现状 91–109 行完全一致，不动…
  })
  .superRefine((manifest, ctx) => {
    if (!manifest.configuration) {
      return;
    }
    const prefix = `${manifest.id}.`;
    for (const key of Object.keys(manifest.configuration.properties)) {
      if (!(key.startsWith(prefix) && key.length > prefix.length)) {
        ctx.addIssue({
          code: "custom",
          message: `configuration key must start with "${prefix}": ${key}`,
          path: ["configuration", "properties", key],
        });
      }
    }
  });
```

（实施时把 91–109 行原文完整保留在 object 内，仅加 `configuration` 一行与尾部 superRefine，勿改动其它字段。）

- [ ] 运行 `pnpm vitest run tests/unit/shared/plugin-configuration-schema.test.ts` 全绿；跑 `pnpm test:unit` 确认无回归（`invalid_manifest` 诊断路径复用：`plugin-service.ts` 的 `parseManifest`（现 181–187 行）对 schema 失败统一抛 `PluginServiceError("invalid_manifest", …)`，无需改动）。
- [ ] `pnpm check` 全绿。
- [ ] Commit（AGENTS.md 流程）：`git add src/shared/contracts/plugin.ts tests/unit/shared/plugin-configuration-schema.test.ts` → 展示 `git diff --staged` → message `feat(plugin): add configuration contribution schema with per-property and key-prefix validation` → 等待用户确认。

---

## Task 2：registry 层「插件 id 不得互为点分前缀」校验

**Files:**

- Modify: `src/main/services/plugin-service.ts`
  - 新增导出纯函数 `findPluginIdDotPrefixConflict`；
  - `list()` 内 `manifests.push(...)`（现 268 行）前插入冲突检查。
- Test: `tests/unit/main/plugin-id-prefix.test.ts`（新建）

**Interfaces:**

- Consumes: `createPluginService({ sources, state })`（现 241–245 行签名，支持注入 state，测试用内存实现）。
- Produces: `export function findPluginIdDotPrefixConflict(acceptedIds: readonly string[], candidateId: string): string | null`；冲突插件不进 entries，进 `invalid_manifest` 诊断。

**Steps:**

- [ ] 新建 `tests/unit/main/plugin-id-prefix.test.ts`：

```ts
import type { PluginStateStore } from "@main/services/plugin-service.ts";
import {
  createPluginService,
  findPluginIdDotPrefixConflict,
} from "@main/services/plugin-service.ts";
import type { PluginRegistryState } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

function builtinSource(id: string) {
  return {
    kind: "builtin" as const,
    manifest: {
      apiVersion: 1,
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      source: { kind: "builtin" },
      version: "1.0.0",
    },
  };
}

function memoryState(): PluginStateStore {
  let state: PluginRegistryState = { plugins: {}, version: 1 };
  return {
    read: () => Promise.resolve(state),
    setEnabled: (id, enabled) => {
      state = {
        ...state,
        plugins: { ...state.plugins, [id]: { enabled, updatedAt: 0 } },
      };
      return Promise.resolve(state);
    },
  };
}

describe("findPluginIdDotPrefixConflict", () => {
  it("点分段前缀与重复 id 都算冲突", () => {
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.git.extras")).toBe(
      "pier.git"
    );
    expect(findPluginIdDotPrefixConflict(["pier.git.extras"], "pier.git")).toBe(
      "pier.git.extras"
    );
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.git")).toBe(
      "pier.git"
    );
  });

  it("非点分段前缀不算冲突（pier.git vs pier.gitx）", () => {
    expect(findPluginIdDotPrefixConflict(["pier.git"], "pier.gitx")).toBeNull();
  });
});

describe("plugin registry — 插件 id 互为点分前缀拒绝", () => {
  it("pier.git 与 pier.git.extras 不能共存，后者走 invalid_manifest 诊断", async () => {
    const service = createPluginService({
      sources: [builtinSource("pier.git"), builtinSource("pier.git.extras")],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.git",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("invalid_manifest");
    expect(result.diagnostics[0]?.message).toContain("pier.git.extras");
  });

  it("pier.git 与 pier.gitx 可以共存", async () => {
    const service = createPluginService({
      sources: [builtinSource("pier.git"), builtinSource("pier.gitx")],
      state: memoryState(),
    });
    const result = await service.list();
    expect(result.entries.map((entry) => entry.manifest.id)).toEqual([
      "pier.git",
      "pier.gitx",
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
```

- [ ] 运行 `pnpm vitest run tests/unit/main/plugin-id-prefix.test.ts`，预期失败：`findPluginIdDotPrefixConflict` 不存在（`SyntaxError: ... does not provide an export named 'findPluginIdDotPrefixConflict'`）。
- [ ] `src/main/services/plugin-service.ts`：在 `collectEffectivePermissions`（现 79–104 行）之后加入：

```ts
export function findPluginIdDotPrefixConflict(
  acceptedIds: readonly string[],
  candidateId: string
): string | null {
  for (const id of acceptedIds) {
    if (
      id === candidateId ||
      id.startsWith(`${candidateId}.`) ||
      candidateId.startsWith(`${id}.`)
    ) {
      return id;
    }
  }
  return null;
}
```

- [ ] `list()` 内（现 256–271 行 for 循环），在 `manifests.push({ manifest: withLocales.manifest, source });` 之前插入：

```ts
const conflict = findPluginIdDotPrefixConflict(
  manifests.map((item) => item.manifest.id),
  withLocales.manifest.id
);
if (conflict) {
  diagnostics.push({
    code: "invalid_manifest",
    message: `plugin id must not be a dot-separated prefix of another plugin id ("${conflict}"): ${withLocales.manifest.id}`,
    source: diagnosticSource(source),
  });
  continue;
}
```

- [ ] `pnpm vitest run tests/unit/main/plugin-id-prefix.test.ts` 全绿；`pnpm test:unit` 无回归（`plugin-service.test.ts` / `plugin-sources.test.ts` 现有用例 id 均不互为前缀）。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/main/services/plugin-service.ts tests/unit/main/plugin-id-prefix.test.ts` → diff → `feat(plugin): reject plugin ids that are dot-separated prefixes of each other` → 等确认。

---

## Task 3：shared 契约与纯函数（settings state / 校验 / 生效值 / diff / change event）

**Files:**

- Create: `src/shared/contracts/plugin-settings.ts`
- Create: `src/shared/plugin-settings.ts`
- Test: `tests/unit/shared/plugin-settings-helpers.test.ts`（新建）

**Interfaces:**

- Consumes: Task 1 的 `PluginConfigurationProperty`；`PluginRegistryEntry`（`src/shared/contracts/plugin.ts` 现 125–136 行）。
- Produces: 见「Produces」清单中 `src/shared/contracts/plugin-settings.ts` 与 `src/shared/plugin-settings.ts` 两段（签名逐字一致）。

**Steps:**

- [ ] 新建 `tests/unit/shared/plugin-settings-helpers.test.ts`：

```ts
import type { PluginConfigurationProperty } from "@shared/contracts/plugin.ts";
import { pluginSettingsStateSchema } from "@shared/contracts/plugin-settings.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  diffConfigurationValues,
  effectiveConfigurationValue,
  matchesConfigurationPrefix,
  validateConfigurationValue,
} from "@shared/plugin-settings.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const boolProp: PluginConfigurationProperty = {
  default: true,
  type: "boolean",
};
const numProp: PluginConfigurationProperty = {
  default: 10,
  maximum: 100,
  minimum: 1,
  type: "number",
};
const enumProp: PluginConfigurationProperty = {
  default: "auto",
  enum: ["auto", "manual"],
  type: "string",
};

function entry(
  id: string,
  enabled: boolean,
  properties: Record<string, PluginConfigurationProperty>
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: { properties },
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("pluginSettingsStateSchema", () => {
  it("接受空 values 并拒绝错误 version", () => {
    expect(
      pluginSettingsStateSchema.parse({ values: {}, version: 1 }).values
    ).toEqual({});
    expect(() =>
      pluginSettingsStateSchema.parse({ values: {}, version: 2 })
    ).toThrow();
  });
});

describe("matchesConfigurationPrefix — 点分段精确匹配", () => {
  it("pier.git 匹配 pier.git.* 与自身，不匹配 pier.gitx.*", () => {
    expect(matchesConfigurationPrefix("pier.git", "pier.git.a.b")).toBe(true);
    expect(matchesConfigurationPrefix("pier.git", "pier.git")).toBe(true);
    expect(matchesConfigurationPrefix("pier.git", "pier.gitx.a")).toBe(false);
  });
});

describe("validateConfigurationValue", () => {
  it("类型不匹配 / enum 越界 / min-max 越界 均拒绝", () => {
    expect(validateConfigurationValue(boolProp, "yes").ok).toBe(false);
    expect(validateConfigurationValue(enumProp, "off").ok).toBe(false);
    expect(validateConfigurationValue(numProp, 0).ok).toBe(false);
    expect(validateConfigurationValue(numProp, 101).ok).toBe(false);
    expect(validateConfigurationValue(numProp, Number.NaN).ok).toBe(false);
  });

  it("合法值通过", () => {
    expect(validateConfigurationValue(boolProp, false).ok).toBe(true);
    expect(validateConfigurationValue(enumProp, "manual").ok).toBe(true);
    expect(validateConfigurationValue(numProp, 100).ok).toBe(true);
  });
});

describe("effectiveConfigurationValue — 用户值 ?? default", () => {
  it("无用户值回落 default，非法存量值也回落 default", () => {
    expect(effectiveConfigurationValue(boolProp, undefined)).toBe(true);
    expect(effectiveConfigurationValue(boolProp, false)).toBe(false);
    expect(effectiveConfigurationValue(enumProp, "stale-value")).toBe("auto");
  });
});

describe("collectEnabledConfigurationProperties", () => {
  it("只收集已启用插件的声明", () => {
    const map = collectEnabledConfigurationProperties([
      entry("pier.a", true, { "pier.a.x": boolProp }),
      entry("pier.b", false, { "pier.b.y": boolProp }),
    ]);
    expect(map.has("pier.a.x")).toBe(true);
    expect(map.has("pier.b.y")).toBe(false);
  });
});

describe("createConfigurationChangeEvent", () => {
  it("affectsConfiguration 按点分段前缀匹配 changedKeys", () => {
    const event = createConfigurationChangeEvent([
      "pier.git.statusItem.showDirtyIndicator",
    ]);
    expect(event.affectsConfiguration("pier.git")).toBe(true);
    expect(event.affectsConfiguration("pier.git.statusItem")).toBe(true);
    expect(event.affectsConfiguration("pier.gitx")).toBe(false);
  });
});

describe("diffConfigurationValues", () => {
  it("新增/修改/删除的 key 全部计入", () => {
    expect(
      diffConfigurationValues({ a: 1, b: "x", c: true }, { a: 2, b: "x" }).sort()
    ).toEqual(["a", "c"]);
    expect(diffConfigurationValues({}, {})).toEqual([]);
  });
});
```

- [ ] 运行 `pnpm vitest run tests/unit/shared/plugin-settings-helpers.test.ts`，预期失败：`Cannot find module '@shared/contracts/plugin-settings.ts'`。
- [ ] 新建 `src/shared/contracts/plugin-settings.ts`：

```ts
import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/** plugin-settings.json 的持久化形态 — 只存用户显式设置过的值（平铺 settingKey）。 */
export const pluginSettingsStateSchema = z.object({
  values: z.record(z.string(), jsonValueSchema),
  version: z.literal(1),
});
export type PluginSettingsState = z.infer<typeof pluginSettingsStateSchema>;

/** PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED 载荷：changedKeys + 全量新快照。 */
export interface PluginSettingsChangedPayload {
  changedKeys: string[];
  values: Record<string, JsonValue>;
}
```

- [ ] 新建 `src/shared/plugin-settings.ts`：

```ts
import type { JsonValue } from "./contracts/plugin-settings.ts";
import type {
  PluginConfigurationProperty,
  PluginRegistryEntry,
} from "./contracts/plugin.ts";

export type ConfigurationValueValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** 前缀匹配一律按点分段精确匹配：`pier.git` 匹配 `pier.git.*`，不匹配 `pier.gitx.*`。 */
export function matchesConfigurationPrefix(
  prefix: string,
  key: string
): boolean {
  return key === prefix || key.startsWith(`${prefix}.`);
}

export function validateConfigurationValue(
  property: PluginConfigurationProperty,
  value: unknown
): ConfigurationValueValidation {
  if (typeof value !== property.type) {
    return { ok: false, reason: `expected ${property.type}` };
  }
  if (property.type === "number" && typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: "expected a finite number" };
    }
    if (property.minimum !== undefined && value < property.minimum) {
      return { ok: false, reason: `minimum is ${property.minimum}` };
    }
    if (property.maximum !== undefined && value > property.maximum) {
      return { ok: false, reason: `maximum is ${property.maximum}` };
    }
  }
  if (
    property.enum &&
    typeof value === "string" &&
    !property.enum.includes(value)
  ) {
    return {
      ok: false,
      reason: `expected one of: ${property.enum.join(", ")}`,
    };
  }
  return { ok: true };
}

/** 生效值 = 用户值 ?? schema default；存量非法值（如 schema 演化后）按 default 兜底。 */
export function effectiveConfigurationValue(
  property: PluginConfigurationProperty,
  userValue: unknown
): JsonValue {
  if (userValue === undefined) {
    return property.default;
  }
  return validateConfigurationValue(property, userValue).ok
    ? (userValue as JsonValue)
    : property.default;
}

export function collectEnabledConfigurationProperties(
  entries: readonly PluginRegistryEntry[]
): ReadonlyMap<string, PluginConfigurationProperty> {
  const properties = new Map<string, PluginConfigurationProperty>();
  for (const entry of entries) {
    if (!(entry.runtime.enabled && entry.manifest.configuration)) {
      continue;
    }
    for (const [key, property] of Object.entries(
      entry.manifest.configuration.properties
    )) {
      properties.set(key, property);
    }
  }
  return properties;
}

export interface PluginConfigurationChangeEvent {
  affectsConfiguration(prefix: string): boolean;
}

export function createConfigurationChangeEvent(
  changedKeys: readonly string[]
): PluginConfigurationChangeEvent {
  return {
    affectsConfiguration: (prefix) =>
      changedKeys.some((key) => matchesConfigurationPrefix(prefix, key)),
  };
}

export function diffConfigurationValues(
  previous: Record<string, JsonValue>,
  next: Record<string, JsonValue>
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}
```

- [ ] `pnpm vitest run tests/unit/shared/plugin-settings-helpers.test.ts` 全绿。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/shared/contracts/plugin-settings.ts src/shared/plugin-settings.ts tests/unit/shared/plugin-settings-helpers.test.ts` → diff → `feat(plugin): add plugin-settings contracts and pure merge/validation helpers` → 等确认。

---

## Task 4：main L1 store `plugin-settings.json` + 退出 flush 链

**Files:**

- Create: `src/main/state/plugin-settings.ts`
- Modify: `src/main/services/window-service.ts`
  - import 区（现 6 行 `flushPluginState` 旁）加 `flushPluginSettings`；
  - `flushWindowBeforeClose` 的 `Promise.all`（现 48–53 行）加入 `flushPluginSettings()`。
- Test: `tests/unit/main/plugin-settings-state.test.ts`（新建）

**Interfaces:**

- Consumes: `debouncedJsonStore`（`src/main/state/debounced-store.ts` 现 35–159 行）；`ensureStore` 包装模式照抄 `src/main/state/plugin-state.ts` 现 34–48 行；Task 3 的 `pluginSettingsStateSchema` / `JsonValue`。
- Produces: `PluginSettingsStore` 接口、`createPluginSettingsStore({ filePath })`（测试注入路径）、`getDefaultPluginSettingsStore()`（`userData/plugin-settings.json` 懒单例）、`flushPluginSettings()`（挂退出链）。

**Steps:**

- [ ] 新建 `tests/unit/main/plugin-settings-state.test.ts`：

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDefaultPluginSettingsStore 在懒初始化时才读 app.getPath；
// 本测试全部走 createPluginSettingsStore({ filePath }) 注入，electron 仅需可 import。
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";

describe("plugin-settings store (L1)", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-settings-"));
    filePath = join(tempDir, "plugin-settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("setValue 后内存立即可读，flush 后落盘", async () => {
    const store = createPluginSettingsStore({ filePath });
    await store.init();
    store.setValue("pier.git.statusItem.showDirtyIndicator", false);
    expect(store.getValues()).toEqual({
      "pier.git.statusItem.showDirtyIndicator": false,
    });
    await store.flush();
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw).toEqual({
      values: { "pier.git.statusItem.showDirtyIndicator": false },
      version: 1,
    });
  });

  it("resetValue 删除 key（恢复默认 = 删除存储值）", async () => {
    const store = createPluginSettingsStore({ filePath });
    await store.init();
    store.setValue("pier.a.x", 3);
    const next = store.resetValue("pier.a.x");
    expect(next.values).toEqual({});
  });

  it("损坏 JSON 与 schema 不合法均重置为默认值", async () => {
    await writeFile(filePath, "{not json");
    const corrupt = createPluginSettingsStore({ filePath });
    expect((await corrupt.init()).values).toEqual({});

    const badVersionPath = join(tempDir, "bad-version.json");
    await writeFile(
      badVersionPath,
      `${JSON.stringify({ values: {}, version: 99 })}\n`
    );
    const badVersion = createPluginSettingsStore({ filePath: badVersionPath });
    expect((await badVersion.init()).version).toBe(1);
  });

  it("重启读回持久化值", async () => {
    const first = createPluginSettingsStore({ filePath });
    await first.init();
    first.setValue("pier.a.x", "manual");
    await first.flush();

    const second = createPluginSettingsStore({ filePath });
    expect((await second.init()).values).toEqual({ "pier.a.x": "manual" });
  });
});
```

- [ ] `pnpm vitest run tests/unit/main/plugin-settings-state.test.ts`，预期失败：`Cannot find module '@main/state/plugin-settings.ts'`。
- [ ] 新建 `src/main/state/plugin-settings.ts`：

```ts
import { join } from "node:path";
import {
  type JsonValue,
  type PluginSettingsState,
  pluginSettingsStateSchema,
} from "@shared/contracts/plugin-settings.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const DEFAULTS: PluginSettingsState = {
  values: {},
  version: 1,
};

export interface PluginSettingsStore {
  flush(): Promise<void>;
  /** 同步读内存态 — 必须先 await init()（host-api refresh 入口保证）。 */
  getValues(): Record<string, JsonValue>;
  init(): Promise<PluginSettingsState>;
  read(): Promise<PluginSettingsState>;
  resetValue(key: string): PluginSettingsState;
  setValue(key: string, value: JsonValue): PluginSettingsState;
}

export function createPluginSettingsStore({
  filePath,
}: {
  filePath: string;
}): PluginSettingsStore {
  const store: DebouncedJsonStore<PluginSettingsState> = debouncedJsonStore({
    debounceMs: 500,
    defaults: DEFAULTS,
    filePath,
  });

  // 照抄 plugin-state.ts 的 ensureStore 包装：zod 校验层，损坏/不合法即重置默认。
  async function ensureStore(): Promise<DebouncedJsonStore<PluginSettingsState>> {
    try {
      const raw = await store.init();
      const parsed = pluginSettingsStateSchema.parse(raw);
      if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
        store.replace(parsed);
      }
    } catch (err) {
      console.warn(
        "[plugin-settings] parse failed, resetting to defaults:",
        err
      );
      await store.clear();
      await store.init();
    }
    return store;
  }

  return {
    flush: async () => {
      await (await ensureStore()).flush();
    },
    getValues: () => structuredClone(store.get().values),
    init: async () => structuredClone((await ensureStore()).get()),
    read: async () => structuredClone((await ensureStore()).get()),
    resetValue: (key) =>
      structuredClone(
        store.mutate((state) => {
          const { [key]: _removed, ...rest } = state.values;
          return { ...state, values: rest };
        })
      ),
    setValue: (key, value) =>
      structuredClone(
        store.mutate((state) => ({
          ...state,
          values: { ...state.values, [key]: value },
        }))
      ),
  };
}

let defaultStore: PluginSettingsStore | undefined;

export function getDefaultPluginSettingsStore(): PluginSettingsStore {
  if (!defaultStore) {
    defaultStore = createPluginSettingsStore({
      filePath: join(app.getPath("userData"), "plugin-settings.json"),
    });
  }
  return defaultStore;
}

export async function flushPluginSettings(): Promise<void> {
  await getDefaultPluginSettingsStore().flush();
}
```

- [ ] `src/main/services/window-service.ts`：第 6 行旁新增 `import { flushPluginSettings } from "../state/plugin-settings.ts";`，`flushWindowBeforeClose`（现 48–53 行）改为：

```ts
await Promise.all([
  flushPluginState(),
  flushPluginSettings(),
  flushTerminalSessionState(),
  flushWindowRecordState(),
]);
```

（`before-quit` 的 `flushOpenWindows()`（`src/main/index.ts` 现 293–313 行）已覆盖此链，无需改 index.ts。）

- [ ] `pnpm vitest run tests/unit/main/plugin-settings-state.test.ts` 全绿；`pnpm vitest run tests/unit/main/window-service.test.ts` 无回归。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/main/state/plugin-settings.ts src/main/services/window-service.ts tests/unit/main/plugin-settings-state.test.ts` → diff → `feat(plugin): add plugin-settings L1 store with exit flush chain` → 等确认。

---

## Task 5：PluginSettingsService + PierCommand 三命令 + 广播 + preload

**Files:**

- Create: `src/main/services/plugin-settings-service.ts`
- Modify: `src/shared/contracts/commands.ts`（union 现 51–310 行：在 `plugin.disable` 条目（现 178–180 行）后加三条；顶部 import 区加 `jsonValueSchema`）
- Modify: `src/shared/ipc-channels.ts`（`PIER_BROADCAST` 现 23–43 行加 `PLUGIN_SETTINGS_CHANGED`；`ALLOWED_RENDERER_CHANNELS` 现 48–49 行由 `Object.values(PIER_BROADCAST)` 派生，自动生效）
- Modify: `src/main/app-core/permissions.ts`（`REQUIRED_CAPABILITIES_BY_COMMAND` 现 9–81 行，`plugin.list` 行（现 23 行）后加三条）
- Modify: `src/main/ipc/command.ts`（`RENDERER_FACADE_COMMAND_TYPES` 现 10–57 行加三条）
- Modify: `src/main/app-core/command-router.ts`（`executePluginCommand` 现 91–123 行加三 case；`executeKnownCommand` catch（现 377–400 行）加 `PluginSettingsServiceError` 映射；import 区加对应导入）
- Modify: `src/main/app-core/command-router-services.ts`（`PierCoreServices` 加 `pluginSettings`）
- Modify: `src/main/app-core/app-core.ts`（现 100–102 行 pluginHost 创建处：抽出 base plugin service、创建 settings service、订阅广播、注入 services）
- Modify: `src/preload/index.ts`（`PierPluginsAPI`（现 111–116 行）旁加 `PierPluginSettingsAPI`；`pluginsApi`（现 376–385 行）旁加实现；`PierWindowAPI`（现 170–200 行）与 `api` 对象（现 430–462 行）加 `pluginSettings` 字段）
- Test: `tests/unit/main/plugin-settings-service.test.ts`（新建）

**Interfaces:**

- Consumes: Task 3 纯函数与契约；Task 4 store；`PluginService.list()`（`plugin-service.ts` 现 58–62 行）；`invokePierCommand`（preload 现 222–235 行）；`subscribeIpc`（preload 现 209–220 行）；`commandSuccess/commandFailure`（`command-results.ts`）。
- Produces: `PluginSettingsService` / `PluginSettingsServiceError`；PierCommand `pluginSettings.getAll|set|reset`；`PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED`；`window.pier.pluginSettings`。
- **set() resolve 语义**：`service.set` 在 store 内存态 mutate 完成后才 resolve 并返回全量新 `PluginSettingsState`（磁盘写仍防抖异步）；IPC resolve 时 main 内存已提交。广播（含发起窗口）服务其它窗口，发起窗口在 resolve 路径用返回值同步镜像（Task 6）。

**Steps:**

- [ ] 新建 `tests/unit/main/plugin-settings-service.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import type { PluginService } from "@main/services/plugin-service.ts";
import {
  PluginSettingsServiceError,
  createPluginSettingsService,
} from "@main/services/plugin-settings-service.ts";
import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

function gitEntry(enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
          "pier.git.statusItem.mode": {
            default: "auto",
            enum: ["auto", "manual"],
            type: "string",
          },
          "pier.git.statusItem.limit": {
            default: 10,
            maximum: 100,
            minimum: 1,
            type: "number",
          },
        },
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

function pluginsWith(entries: PluginRegistryEntry[]): PluginService {
  return {
    inspect: (id) =>
      Promise.resolve(
        entries.find((entry) => entry.manifest.id === id) ?? null
      ),
    list: () => Promise.resolve({ diagnostics: [], entries }),
    setEnabled: () => Promise.reject(new Error("unused in this test")),
  };
}

describe("PluginSettingsService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-settings-service-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  function makeService(entries = [gitEntry()]) {
    return createPluginSettingsService({
      plugins: pluginsWith(entries),
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });
  }

  it("set 合法值：resolve 时内存已提交，返回全量新快照并广播 changedKeys", async () => {
    const service = makeService();
    const payloads: unknown[] = [];
    service.onDidChange((payload) => payloads.push(payload));

    const state = await service.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(state.values["pier.git.statusItem.showDirtyIndicator"]).toBe(false);
    expect(service.getValues()["pier.git.statusItem.showDirtyIndicator"]).toBe(
      false
    );
    expect(payloads).toEqual([
      {
        changedKeys: ["pier.git.statusItem.showDirtyIndicator"],
        values: { "pier.git.statusItem.showDirtyIndicator": false },
      },
    ]);
  });

  it("set 未声明 key → not_found；禁用插件的 key 同样 not_found", async () => {
    await expect(
      makeService().set("pier.git.unknown", true)
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      makeService([gitEntry(false)]).set(
        "pier.git.statusItem.showDirtyIndicator",
        false
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("set 类型/enum/min-max 不合法 → invalid_command", async () => {
    const service = makeService();
    await expect(
      service.set("pier.git.statusItem.showDirtyIndicator", "yes")
    ).rejects.toBeInstanceOf(PluginSettingsServiceError);
    await expect(
      service.set("pier.git.statusItem.mode", "off")
    ).rejects.toMatchObject({ code: "invalid_command" });
    await expect(
      service.set("pier.git.statusItem.limit", 0)
    ).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("reset 删除 key 且仅在 key 存在时广播", async () => {
    const service = makeService();
    const payloads: unknown[] = [];
    await service.set("pier.git.statusItem.mode", "manual");
    service.onDidChange((payload) => payloads.push(payload));

    const state = await service.reset("pier.git.statusItem.mode");
    expect(state.values).toEqual({});
    expect(payloads).toHaveLength(1);

    await service.reset("pier.git.statusItem.mode");
    expect(payloads).toHaveLength(1);
  });
});
```

- [ ] `pnpm vitest run tests/unit/main/plugin-settings-service.test.ts`，预期失败：`Cannot find module '@main/services/plugin-settings-service.ts'`。
- [ ] 新建 `src/main/services/plugin-settings-service.ts`：

```ts
import type {
  JsonValue,
  PluginSettingsChangedPayload,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import {
  collectEnabledConfigurationProperties,
  validateConfigurationValue,
} from "@shared/plugin-settings.ts";
import {
  getDefaultPluginSettingsStore,
  type PluginSettingsStore,
} from "../state/plugin-settings.ts";
import type { PluginService } from "./plugin-service.ts";

export type PluginSettingsServiceErrorCode = "invalid_command" | "not_found";

export class PluginSettingsServiceError extends Error {
  readonly code: PluginSettingsServiceErrorCode;

  constructor(code: PluginSettingsServiceErrorCode, message: string) {
    super(message);
    this.name = "PluginSettingsServiceError";
    this.code = code;
  }
}

export interface PluginSettingsService {
  getAll(): Promise<PluginSettingsState>;
  /** 同步读内存态 — 供 main 插件 context 的同步 get()；init() 已在 host refresh 前完成。 */
  getValues(): Record<string, JsonValue>;
  init(): Promise<void>;
  onDidChange(
    listener: (payload: PluginSettingsChangedPayload) => void
  ): () => void;
  reset(key: string): Promise<PluginSettingsState>;
  set(key: string, value: JsonValue): Promise<PluginSettingsState>;
}

export function createPluginSettingsService({
  plugins,
  store = getDefaultPluginSettingsStore(),
}: {
  plugins: PluginService;
  store?: PluginSettingsStore;
}): PluginSettingsService {
  const listeners = new Set<
    (payload: PluginSettingsChangedPayload) => void
  >();

  function emit(changedKeys: string[], state: PluginSettingsState): void {
    const payload: PluginSettingsChangedPayload = {
      changedKeys,
      values: state.values,
    };
    for (const listener of listeners) {
      listener(payload);
    }
  }

  return {
    getAll: async () => {
      return await store.read();
    },
    getValues: () => store.getValues(),
    init: async () => {
      await store.init();
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: async (key) => {
      await store.init();
      const hadValue = key in store.getValues();
      const next = store.resetValue(key);
      if (hadValue) {
        emit([key], next);
      }
      return next;
    },
    set: async (key, value) => {
      const { entries } = await plugins.list();
      const property = collectEnabledConfigurationProperties(entries).get(key);
      if (!property) {
        throw new PluginSettingsServiceError(
          "not_found",
          `setting is not declared by any enabled plugin: ${key}`
        );
      }
      const validation = validateConfigurationValue(property, value);
      if (!validation.ok) {
        throw new PluginSettingsServiceError(
          "invalid_command",
          `invalid value for ${key}: ${validation.reason}`
        );
      }
      await store.init();
      // resolve 语义：mutate 同步提交内存态后才 return（磁盘写防抖异步）。
      const next = store.setValue(key, value);
      emit([key], next);
      return next;
    },
  };
}
```

- [ ] `pnpm vitest run tests/unit/main/plugin-settings-service.test.ts` 全绿。
- [ ] `src/shared/contracts/commands.ts`：import 区（现 17 行 `pluginInspectRequestSchema` 旁）加 `import { jsonValueSchema } from "./plugin-settings.ts";`；在 `plugin.disable` 条目（现 178–180 行）之后插入：

```ts
z.object({ type: z.literal("pluginSettings.getAll") }),
z.object({
  key: z.string().min(1),
  type: z.literal("pluginSettings.set"),
  value: jsonValueSchema,
}),
z.object({
  key: z.string().min(1),
  type: z.literal("pluginSettings.reset"),
}),
```

- [ ] `src/shared/ipc-channels.ts` `PIER_BROADCAST`（现 23–43 行，Phase 0 已加 `PLUGINS_CHANGED`）追加：

```ts
// 插件设置变更广播 (main → renderer, payload PluginSettingsChangedPayload).
PLUGIN_SETTINGS_CHANGED: "pier://plugin-settings:changed",
```

- [ ] `src/main/app-core/permissions.ts`（现 23 行 `"plugin.list"` 后）：

```ts
"pluginSettings.getAll": ["plugin:read"],
"pluginSettings.reset": ["plugin:write"],
"pluginSettings.set": ["plugin:write"],
```

（`desktop-renderer` 默认 capabilities 已含 `plugin:read`/`plugin:write`，`src/shared/contracts/permissions.ts` 现 60–83 行，无需改。）

- [ ] `src/main/ipc/command.ts` `RENDERER_FACADE_COMMAND_TYPES`（现 10–57 行，`"plugin.list"` 后）加：

```ts
"pluginSettings.getAll",
"pluginSettings.reset",
"pluginSettings.set",
```

- [ ] `src/main/app-core/command-router-services.ts`：import 加 `import type { PluginSettingsService } from "../services/plugin-settings-service.ts";`，`PierCoreServices`（`plugins: PluginService;` 行后）加 `pluginSettings: PluginSettingsService;`。
- [ ] `src/main/app-core/command-router.ts`：
  - import 加 `import { PluginSettingsServiceError } from "../services/plugin-settings-service.ts";`；
  - `executePluginCommand`（现 91–123 行）`plugin.inspect` case 后加：

```ts
case "pluginSettings.getAll":
  return success(requestId, await services.pluginSettings.getAll());
case "pluginSettings.set":
  return success(
    requestId,
    await services.pluginSettings.set(command.key, command.value)
  );
case "pluginSettings.reset":
  return success(requestId, await services.pluginSettings.reset(command.key));
```

  - `executeKnownCommand` catch（现 377–400 行）在 `PluginServiceError` 分支后加：

```ts
if (err instanceof PluginSettingsServiceError) {
  return failure(requestId, err.code, err.message);
}
```

- [ ] `src/main/app-core/app-core.ts`：
  - import 加 `import { PIER_BROADCAST } from "@shared/ipc-channels.ts";` 与 `import { createPluginSettingsService } from "../services/plugin-settings-service.ts";`；
  - `createPierAppCore`（现 94–148 行）把 100–102 行改为：

```ts
const basePlugins = createPluginService({ sources: createDefaultPluginSources });
const pluginSettings = createPluginSettingsService({ plugins: basePlugins });
pluginSettings.onDidChange((payload) => {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED, payload);
    }
  }
});
const pluginHost = createMainPluginHostApi({ plugins: basePlugins });
```

  - `services` 对象 `plugins: pluginHost.plugins,` 行后加 `pluginSettings,`。
- [ ] `src/preload/index.ts`：
  - import type 区加 `import type { JsonValue, PluginSettingsChangedPayload, PluginSettingsState } from "@shared/contracts/plugin-settings.ts";`；
  - `PierPluginsAPI`（现 111–116 行）后加：

```ts
export interface PierPluginSettingsAPI {
  getAll: () => Promise<PluginSettingsState>;
  /** 订阅设置变更广播 — main 会广播给所有窗口（含发起窗口，镜像 store 按 diff 去重）。 */
  onChanged: (cb: (payload: PluginSettingsChangedPayload) => void) => () => void;
  reset: (key: string) => Promise<PluginSettingsState>;
  /** resolve 时 main 内存已提交；返回全量新快照供发起窗口同步镜像。 */
  set: (key: string, value: JsonValue) => Promise<PluginSettingsState>;
}
```

  - `pluginsApi`（现 376–385 行）后加：

```ts
const pluginSettingsApi: PierPluginSettingsAPI = {
  getAll: () =>
    invokePierCommand<PluginSettingsState>({ type: "pluginSettings.getAll" }),
  onChanged: (cb) => subscribeIpc(PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED, cb),
  reset: (key) =>
    invokePierCommand<PluginSettingsState>({
      key,
      type: "pluginSettings.reset",
    }),
  set: (key, value) =>
    invokePierCommand<PluginSettingsState>({
      key,
      type: "pluginSettings.set",
      value,
    }),
};
```

  - `PierWindowAPI`（现 189 行 `plugins: PierPluginsAPI;` 后）加 `pluginSettings: PierPluginSettingsAPI;`；`api` 对象（现 450 行 `plugins: pluginsApi,` 后）加 `pluginSettings: pluginSettingsApi,`。
- [ ] 运行 `pnpm test:unit`（重点：`tests/unit/main/ipc-command.test.ts`、`tests/unit/app-core/command-router.test.ts`、`tests/unit/app-core/permissions.test.ts` —— 若有「所有 command type 都有 capability 映射」类穷举断言，本 task 的三个新命令已补齐映射，应通过）。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/main/services/plugin-settings-service.ts src/shared/contracts/commands.ts src/shared/ipc-channels.ts src/main/app-core/permissions.ts src/main/ipc/command.ts src/main/app-core/command-router.ts src/main/app-core/command-router-services.ts src/main/app-core/app-core.ts src/preload/index.ts tests/unit/main/plugin-settings-service.test.ts` → diff → `feat(plugin): plugin settings service, envelope commands and change broadcast` → 等确认。

---

## Task 6：renderer 镜像 store `usePluginSettingsStore`

**Files:**

- Create: `src/renderer/stores/plugin-settings.store.ts`
- Modify: `src/renderer/main.tsx`（现 88 行 `await bootstrapBuiltinPlugins();` 之前插入 `await initPluginSettingsStore();` 及对应 import —— 插件激活时 context 需要同步 `get()`，镜像必须先就绪；Phase 0 的 plugin-registry store init 同理已在此之前）
- Test: `tests/unit/renderer/stores/plugin-settings-store.test.ts`（新建）

**Interfaces:**

- Consumes: Task 5 的 `window.pier.pluginSettings`；Task 3 `diffConfigurationValues`。
- Produces: `usePluginSettingsStore`（state `{ initialized, values, applySnapshot, set, reset }`）、`subscribePluginSettingsChanges`、`initPluginSettingsStore`。
- **resolve 语义落点**：`set/reset` 用 IPC 返回的全量快照在 resolve 路径同步 `applySnapshot`；广播路径同样 `applySnapshot`，`diffConfigurationValues` 为空则跳过（发起窗口双投递去重）。

**Steps:**

- [ ] 新建 `tests/unit/renderer/stores/plugin-settings-store.test.ts`：

```ts
import type { PluginSettingsChangedPayload } from "@shared/contracts/plugin-settings.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initPluginSettingsStore,
  subscribePluginSettingsChanges,
  usePluginSettingsStore,
} from "@/stores/plugin-settings.store.ts";

type BroadcastListener = (payload: PluginSettingsChangedPayload) => void;

describe("usePluginSettingsStore", () => {
  let broadcastListener: BroadcastListener | null;
  const setMock = vi.fn();
  const resetMock = vi.fn();
  const getAllMock = vi.fn();

  beforeEach(() => {
    broadcastListener = null;
    setMock.mockReset();
    resetMock.mockReset();
    getAllMock.mockReset();
    usePluginSettingsStore.setState({ initialized: false, values: {} });
    vi.stubGlobal("window", {
      ...window,
      pier: {
        pluginSettings: {
          getAll: getAllMock,
          onChanged: (cb: BroadcastListener) => {
            broadcastListener = cb;
            return () => {
              broadcastListener = null;
            };
          },
          reset: resetMock,
          set: setMock,
        },
      },
    });
  });

  it("init 全量拉取并订阅广播", async () => {
    getAllMock.mockResolvedValue({ values: { "pier.a.x": 1 }, version: 1 });
    await initPluginSettingsStore();
    expect(usePluginSettingsStore.getState()).toMatchObject({
      initialized: true,
      values: { "pier.a.x": 1 },
    });
    expect(broadcastListener).not.toBeNull();
  });

  it("set 在 resolve 路径同步镜像并通知 changedKeys", async () => {
    getAllMock.mockResolvedValue({ values: {}, version: 1 });
    await initPluginSettingsStore();
    setMock.mockResolvedValue({ values: { "pier.a.x": false }, version: 1 });
    const changes: string[][] = [];
    subscribePluginSettingsChanges((keys) => changes.push([...keys]));

    await usePluginSettingsStore.getState().set("pier.a.x", false);
    expect(usePluginSettingsStore.getState().values).toEqual({
      "pier.a.x": false,
    });
    expect(changes).toEqual([["pier.a.x"]]);
  });

  it("广播与 resolve 双投递按 diff 去重", async () => {
    getAllMock.mockResolvedValue({ values: {}, version: 1 });
    await initPluginSettingsStore();
    setMock.mockResolvedValue({ values: { "pier.a.x": false }, version: 1 });
    const changes: string[][] = [];
    subscribePluginSettingsChanges((keys) => changes.push([...keys]));

    await usePluginSettingsStore.getState().set("pier.a.x", false);
    broadcastListener?.({
      changedKeys: ["pier.a.x"],
      values: { "pier.a.x": false },
    });
    expect(changes).toEqual([["pier.a.x"]]);
  });

  it("reset resolve 路径同步删除", async () => {
    getAllMock.mockResolvedValue({
      values: { "pier.a.x": false },
      version: 1,
    });
    await initPluginSettingsStore();
    resetMock.mockResolvedValue({ values: {}, version: 1 });

    await usePluginSettingsStore.getState().reset("pier.a.x");
    expect(usePluginSettingsStore.getState().values).toEqual({});
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/stores/plugin-settings-store.test.ts`，预期失败：`Cannot find module '@/stores/plugin-settings.store.ts'`。
- [ ] 新建 `src/renderer/stores/plugin-settings.store.ts`：

```ts
import type {
  JsonValue,
  PluginSettingsState,
} from "@shared/contracts/plugin-settings.ts";
import { diffConfigurationValues } from "@shared/plugin-settings.ts";
import { create } from "zustand";

type PluginSettingsChangeListener = (changedKeys: readonly string[]) => void;

const changeListeners = new Set<PluginSettingsChangeListener>();

/** 插件 context 的 onDidChange 底座 — 与 zustand 订阅解耦，携带 changedKeys。 */
export function subscribePluginSettingsChanges(
  listener: PluginSettingsChangeListener
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

interface PluginSettingsStoreState {
  applySnapshot: (snapshot: PluginSettingsState) => void;
  initialized: boolean;
  reset: (key: string) => Promise<void>;
  set: (key: string, value: JsonValue) => Promise<void>;
  values: Record<string, JsonValue>;
}

export const usePluginSettingsStore = create<PluginSettingsStoreState>(
  (set, get) => ({
    applySnapshot: (snapshot) => {
      const changedKeys = diffConfigurationValues(
        get().values,
        snapshot.values
      );
      // resolve 路径与广播路径双投递：无 diff 即去重跳过（首次 init 除外）。
      if (get().initialized && changedKeys.length === 0) {
        return;
      }
      set({ initialized: true, values: snapshot.values });
      for (const listener of changeListeners) {
        listener(changedKeys);
      }
    },
    initialized: false,
    reset: async (key) => {
      const snapshot = await window.pier.pluginSettings.reset(key);
      get().applySnapshot(snapshot);
    },
    set: async (key, value) => {
      // set() resolve 语义：main 内存已提交，发起窗口在 resolve 路径同步镜像。
      const snapshot = await window.pier.pluginSettings.set(key, value);
      get().applySnapshot(snapshot);
    },
    values: {},
  })
);

/** bootstrap：先订阅广播再全量拉取，避免窗口初始化窗口期丢事件。返回解绑函数。 */
export async function initPluginSettingsStore(): Promise<() => void> {
  const dispose = window.pier.pluginSettings.onChanged((payload) => {
    usePluginSettingsStore
      .getState()
      .applySnapshot({ values: payload.values, version: 1 });
  });
  const snapshot = await window.pier.pluginSettings.getAll();
  usePluginSettingsStore.getState().applySnapshot(snapshot);
  return dispose;
}
```

- [ ] `src/renderer/main.tsx`：import 区加 `import { initPluginSettingsStore } from "./stores/plugin-settings.store.ts";`；现 88 行前插入：

```ts
await initPluginSettingsStore();
```

- [ ] `pnpm vitest run tests/unit/renderer/stores/plugin-settings-store.test.ts` 全绿。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/renderer/stores/plugin-settings.store.ts src/renderer/main.tsx tests/unit/renderer/stores/plugin-settings-store.test.ts` → diff → `feat(plugin): renderer plugin-settings mirror store with resolve-path sync` → 等确认。

---

## Task 7：main 侧 `createMainPluginContext(entry)` 按插件创建 + host-api init 前置

**Files:**

- Create: `src/plugins/api/configuration.ts`
- Modify: `src/plugins/api/main.ts`（现 1–11 行：删 brand，`MainPluginContext` 增 `configuration`）
- Create: `src/main/plugins/plugin-context.ts`
- Modify: `src/main/plugins/runtime.ts`（现 11–13 行无参 `createMainPluginContext` 删除；构造函数增必选 `contextFactory`；`refresh`（现 32–58 行）改为 per-entry 创建 context）
- Modify: `src/main/plugins/host-api.ts`（现 15–42 行：`createMainPluginHostApi` 增 `settings` 参数，默认 runtime 用 context factory 构造；`refresh` 先 `await settings.init()`）
- Modify: `src/main/app-core/app-core.ts`（Task 5 改过的 pluginHost 创建行传入 `settings: pluginSettings`）
- Test: `tests/unit/main/plugin-context.test.ts`（新建）；`tests/unit/main/plugin-runtime.test.ts`（改：构造函数补 factory 参数）

**Interfaces:**

- Consumes: Task 3 `collectEnabledConfigurationProperties` / `effectiveConfigurationValue` / `createConfigurationChangeEvent`；Task 5 `PluginSettingsService`。
- Produces:
  - `PluginConfigurationApi`（main + renderer 同形，见 Produces 清单）；
  - `MainPluginContext = { configuration: PluginConfigurationApi }`；
  - `createMainPluginContext({ entries, entry, settings })`；
  - `MainPluginRuntime` 构造签名 `(modules, contextFactory)`；
  - `createMainPluginHostApi({ plugins, settings, runtime? })`，`refresh()` 保证 settings.init() 先于 `runtime.refresh()`（`src/main/index.ts` 现 176 行 `await appCore.pluginHost.refresh()` 即全局入口，无需改 index.ts）。

**Steps:**

- [ ] 新建 `src/plugins/api/configuration.ts`（先写类型，供测试 import）：

```ts
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { PluginConfigurationChangeEvent } from "@shared/plugin-settings.ts";

export type { PluginConfigurationChangeEvent };

/**
 * 插件设置 API — main / renderer context 同形。
 * get 读任意 key 的生效值（用户值 ?? default）；set/reset 仅允许操作
 * 自身 `<pluginId>.` 前缀的 key（context 层断言，对齐 assertDeclaredContribution 惯例）。
 */
export interface PluginConfigurationApi {
  get<T>(key: string): T;
  onDidChange(
    listener: (e: PluginConfigurationChangeEvent) => void
  ): () => void;
  reset(key: string): Promise<void>;
  set(key: string, value: JsonValue): Promise<void>;
}
```

- [ ] `src/plugins/api/main.ts` 全文替换为：

```ts
import type { PluginConfigurationApi } from "./configuration.ts";

export interface MainPluginContext {
  configuration: PluginConfigurationApi;
}

export interface MainPluginModule {
  activate(context: MainPluginContext): () => void;
  id: string;
}
```

- [ ] 新建 `tests/unit/main/plugin-context.test.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import { createMainPluginContext } from "@main/plugins/plugin-context.ts";
import type { PluginService } from "@main/services/plugin-service.ts";
import { createPluginSettingsService } from "@main/services/plugin-settings-service.ts";
import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

function gitEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
        },
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("createMainPluginContext(entry).configuration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-context-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  async function makeContext() {
    const entry = gitEntry();
    const entries = [entry];
    const plugins: PluginService = {
      inspect: () => Promise.resolve(entry),
      list: () => Promise.resolve({ diagnostics: [], entries }),
      setEnabled: () => Promise.reject(new Error("unused")),
    };
    const settings = createPluginSettingsService({
      plugins,
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });
    await settings.init();
    return { context: createMainPluginContext({ entries, entry, settings }) };
  }

  it("get 返回生效值：无用户值走 default，set 后 await 立即读到新值", async () => {
    const { context } = await makeContext();
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(true);
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(false);
  });

  it("set/reset 越权前缀（含 pier.gitx 伪前缀）直接抛错", async () => {
    const { context } = await makeContext();
    await expect(
      context.configuration.set("pier.other.key", true)
    ).rejects.toThrow(/not owned/);
    await expect(
      context.configuration.set("pier.gitx.key", true)
    ).rejects.toThrow(/not owned/);
    await expect(
      context.configuration.reset("pier.other.key")
    ).rejects.toThrow(/not owned/);
  });

  it("onDidChange 收到 affectsConfiguration 事件，注销后不再收", async () => {
    const { context } = await makeContext();
    const events: boolean[] = [];
    const dispose = context.configuration.onDidChange((e) => {
      events.push(e.affectsConfiguration("pier.git"));
      events.push(e.affectsConfiguration("pier.gitx"));
    });
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(events).toEqual([true, false]);
    dispose();
    await context.configuration.reset(
      "pier.git.statusItem.showDirtyIndicator"
    );
    expect(events).toEqual([true, false]);
  });
});
```

- [ ] `pnpm vitest run tests/unit/main/plugin-context.test.ts`，预期失败：`Cannot find module '@main/plugins/plugin-context.ts'`。
- [ ] 新建 `src/main/plugins/plugin-context.ts`：

```ts
import type { MainPluginContext } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";

function assertOwnedConfigurationKey(
  entry: PluginRegistryEntry,
  key: string
): void {
  // 对齐 renderer 侧 assertDeclaredContribution 的"贡献点操作不越权"惯例。
  if (!key.startsWith(`${entry.manifest.id}.`)) {
    throw new Error(
      `plugin configuration key not owned: ${entry.manifest.id}:${key}`
    );
  }
}

export function createMainPluginContext({
  entries,
  entry,
  settings,
}: {
  entries: readonly PluginRegistryEntry[];
  entry: PluginRegistryEntry;
  settings: PluginSettingsService;
}): MainPluginContext {
  const properties = collectEnabledConfigurationProperties(entries);

  function effectiveValue(key: string): unknown {
    const property = properties.get(key);
    const userValue = settings.getValues()[key];
    return property
      ? effectiveConfigurationValue(property, userValue)
      : userValue;
  }

  return {
    configuration: {
      get: <T>(key: string): T => effectiveValue(key) as T,
      onDidChange: (listener) =>
        settings.onDidChange((payload) => {
          listener(createConfigurationChangeEvent(payload.changedKeys));
        }),
      reset: async (key) => {
        assertOwnedConfigurationKey(entry, key);
        await settings.reset(key);
      },
      set: async (key, value) => {
        assertOwnedConfigurationKey(entry, key);
        await settings.set(key, value);
      },
    },
  };
}
```

- [ ] `src/main/plugins/runtime.ts` 全文替换为（删除现 11–13 行的无参单例工厂）：

```ts
import type { MainPluginContext, MainPluginModule } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { BUILTIN_MAIN_PLUGIN_MODULES } from "./builtin-catalog.ts";

export type MainPluginContextFactory = (
  entry: PluginRegistryEntry,
  entries: readonly PluginRegistryEntry[]
) => MainPluginContext;

function indexModules(
  modules: readonly MainPluginModule[]
): ReadonlyMap<string, MainPluginModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

export class MainPluginRuntime {
  private readonly createContext: MainPluginContextFactory;
  private readonly disposers = new Map<string, () => void>();
  private readonly modules: ReadonlyMap<string, MainPluginModule>;

  constructor(
    modules: readonly MainPluginModule[] = BUILTIN_MAIN_PLUGIN_MODULES,
    createContext: MainPluginContextFactory
  ) {
    this.modules = indexModules(modules);
    this.createContext = createContext;
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) {
      dispose();
    }
    this.disposers.clear();
  }

  refresh(entries: readonly PluginRegistryEntry[]): void {
    const nextActiveIds = new Set<string>();

    for (const entry of entries) {
      if (!(entry.runtime.enabled && entry.runtime.kind === "builtin")) {
        continue;
      }
      const module = this.modules.get(entry.manifest.id);
      if (!module) {
        continue;
      }
      nextActiveIds.add(entry.manifest.id);
      if (this.disposers.has(entry.manifest.id)) {
        continue;
      }
      // 按插件创建 context — set/reset 的所有权断言需要插件身份。
      this.disposers.set(
        entry.manifest.id,
        module.activate(this.createContext(entry, entries))
      );
    }

    for (const [id, dispose] of this.disposers) {
      if (nextActiveIds.has(id)) {
        continue;
      }
      dispose();
      this.disposers.delete(id);
    }
  }
}
```

- [ ] `src/main/plugins/host-api.ts` 全文替换为：

```ts
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";
import { createMainPluginContext } from "./plugin-context.ts";
import { MainPluginRuntime } from "./runtime.ts";

export interface MainPluginRuntimeController {
  dispose?(): void;
  refresh(entries: readonly PluginRegistryEntry[]): void;
}

export interface MainPluginHostApi {
  dispose(): void;
  plugins: PluginService;
  refresh(): Promise<void>;
}

export function createMainPluginHostApi({
  plugins,
  settings,
  runtime = new MainPluginRuntime(undefined, (entry, entries) =>
    createMainPluginContext({ entries, entry, settings })
  ),
}: {
  plugins: PluginService;
  settings: PluginSettingsService;
  runtime?: MainPluginRuntimeController;
}): MainPluginHostApi {
  async function refresh(): Promise<void> {
    // plugin-settings store 的异步 init 必须先于 runtime.refresh 完成，
    // 保证插件 activate 期间 context.configuration.get() 同步可用。
    await settings.init();
    const result = await plugins.list();
    runtime.refresh(result.entries);
  }

  const wrappedPlugins: PluginService = {
    inspect: (id) => plugins.inspect(id),
    list: () => plugins.list(),
    setEnabled: async (id, enabled) => {
      const entry = await plugins.setEnabled(id, enabled);
      await refresh();
      return entry;
    },
  };

  return {
    dispose: () => runtime.dispose?.(),
    plugins: wrappedPlugins,
    refresh,
  };
}
```

（注意 `new MainPluginRuntime(undefined, …)` 走 modules 默认值 `BUILTIN_MAIN_PLUGIN_MODULES`。）

- [ ] `src/main/app-core/app-core.ts`：Task 5 改出的 `const pluginHost = createMainPluginHostApi({ plugins: basePlugins });` 改为：

```ts
const pluginHost = createMainPluginHostApi({
  plugins: basePlugins,
  settings: pluginSettings,
});
```

- [ ] 更新 `tests/unit/main/plugin-runtime.test.ts`：文件顶部加 stub factory 并给所有 `new MainPluginRuntime([...])` 调用补第二参：

```ts
import type { MainPluginContext } from "@plugins/api/main.ts";

function stubContext(): MainPluginContext {
  return {
    configuration: {
      get: <T>(_key: string): T => undefined as unknown as T,
      onDidChange: () => () => undefined,
      reset: () => Promise.resolve(),
      set: () => Promise.resolve(),
    },
  };
}
// 各处：new MainPluginRuntime([{ activate, id: "sample.plugin" }], stubContext)
```

并新增一条断言 factory 按 entry 调用：

```ts
it("为每个启用插件按 entry 创建独立 context", () => {
  const seen: string[] = [];
  const runtime = new MainPluginRuntime(
    [
      { activate: () => () => undefined, id: "pier.a" },
      { activate: () => () => undefined, id: "pier.b" },
    ],
    (entry) => {
      seen.push(entry.manifest.id);
      return stubContext();
    }
  );
  runtime.refresh([entry("pier.a", true), entry("pier.b", true)]);
  expect(seen).toEqual(["pier.a", "pier.b"]);
});
```

- [ ] `pnpm vitest run tests/unit/main/plugin-context.test.ts tests/unit/main/plugin-runtime.test.ts` 全绿；`pnpm test:unit` 无回归（`src/plugins/builtin/git/main/index.ts` 的 `activate: () => () => undefined` 不读 context，无需改）。
- [ ] `pnpm check` 全绿（depcruise：`src/plugins/api/configuration.ts` 只 import `@shared`，合规；`src/main/plugins/plugin-context.ts` 属 main，import `@plugins/api` 与 `@shared`，合规）。
- [ ] Commit：`git add src/plugins/api/configuration.ts src/plugins/api/main.ts src/main/plugins/plugin-context.ts src/main/plugins/runtime.ts src/main/plugins/host-api.ts src/main/app-core/app-core.ts tests/unit/main/plugin-context.test.ts tests/unit/main/plugin-runtime.test.ts` → diff → `feat(plugin): per-plugin main context with configuration api and settings init gate` → 等确认。

---

## Task 8：renderer context `configuration` API

**Files:**

- Modify: `src/plugins/api/renderer.ts`（`RendererPluginContext`（现 151–258 行）在 `commandPalette` 与 `dialogs` 之间加 `configuration: PluginConfigurationApi;`，顶部加 import type）
- Modify: `src/renderer/lib/plugins/host-context.ts`（新增 `createPluginConfiguration(entry)`；`createRendererPluginContext`（现 296–394 行）返回对象接线）
- Test: `tests/unit/renderer/plugin-configuration-context.test.ts`（新建）

**Interfaces:**

- Consumes:
  - Task 7 `PluginConfigurationApi`（`@plugins/api/configuration.ts`）；
  - Task 6 `usePluginSettingsStore` / `subscribePluginSettingsChanges`；
  - **Phase 0** `usePluginRegistryStore`（`src/renderer/stores/plugin-registry.store.ts`，state `{ plugins: PluginRegistryEntry[]; initialized: boolean }`）—— 读已启用插件的 configuration 声明；
  - Task 3 shared 纯函数。
- Produces: `RendererPluginContext.configuration`（get/set/reset/onDidChange，set/reset 前缀断言）。

**Steps:**

- [ ] 新建 `tests/unit/renderer/plugin-configuration-context.test.ts`：

```ts
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

function gitEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
        },
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("RendererPluginContext.configuration", () => {
  const setMock = vi.fn();
  const resetMock = vi.fn();

  beforeEach(() => {
    setMock.mockReset().mockResolvedValue({ values: {}, version: 1 });
    resetMock.mockReset().mockResolvedValue({ values: {}, version: 1 });
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    usePluginSettingsStore.setState({ initialized: true, values: {} });
    vi.stubGlobal("window", {
      ...window,
      pier: {
        pluginSettings: {
          getAll: vi.fn(),
          onChanged: vi.fn(() => () => undefined),
          reset: resetMock,
          set: setMock,
        },
      },
    });
  });

  it("get 生效值 = 用户值 ?? default", () => {
    const context = createRendererPluginContext(gitEntry());
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(true);
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.git.statusItem.showDirtyIndicator": false },
    });
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(false);
  });

  it("set 走镜像 store IPC，越权前缀抛错", async () => {
    const context = createRendererPluginContext(gitEntry());
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(setMock).toHaveBeenCalledWith(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    await expect(
      context.configuration.set("pier.other.key", true)
    ).rejects.toThrow(/not owned/);
    await expect(
      context.configuration.reset("pier.gitx.key")
    ).rejects.toThrow(/not owned/);
  });

  it("onDidChange 经 subscribePluginSettingsChanges 派发 affectsConfiguration", () => {
    const context = createRendererPluginContext(gitEntry());
    const hits: boolean[] = [];
    const dispose = context.configuration.onDidChange((e) => {
      hits.push(e.affectsConfiguration("pier.git"));
    });
    usePluginSettingsStore.getState().applySnapshot({
      values: { "pier.git.statusItem.showDirtyIndicator": false },
      version: 1,
    });
    expect(hits).toEqual([true]);
    dispose();
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-configuration-context.test.ts`，预期失败：`context.configuration` 为 `undefined`（`TypeError: Cannot read properties of undefined (reading 'get')`）。
- [ ] `src/plugins/api/renderer.ts`：顶部加 `import type { PluginConfigurationApi } from "./configuration.ts";`；`RendererPluginContext`（现 151 行起）的 `commandPalette` 成员（现 155–157 行）后插入：

```ts
configuration: PluginConfigurationApi;
```

- [ ] `src/renderer/lib/plugins/host-context.ts`：
  - import 区加：

```ts
import type { PluginConfigurationApi } from "@plugins/api/configuration.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import { usePluginRegistryStore } from "../../stores/plugin-registry.store.ts";
import {
  subscribePluginSettingsChanges,
  usePluginSettingsStore,
} from "../../stores/plugin-settings.store.ts";
```

  - 在 `assertDeclaredContribution`（现 144–167 行）之后加：

```ts
function createPluginConfiguration(
  entry?: PluginRegistryEntry
): PluginConfigurationApi {
  const assertOwnedKey = (key: string): void => {
    // 与 assertDeclaredContribution 同惯例：宿主内部 context（无 entry）不受限。
    if (!entry) {
      return;
    }
    if (!key.startsWith(`${entry.manifest.id}.`)) {
      throw new Error(
        `plugin configuration key not owned: ${entry.manifest.id}:${key}`
      );
    }
  };
  const effectiveValue = (key: string): unknown => {
    const property = collectEnabledConfigurationProperties(
      usePluginRegistryStore.getState().plugins
    ).get(key);
    const userValue = usePluginSettingsStore.getState().values[key];
    return property
      ? effectiveConfigurationValue(property, userValue)
      : userValue;
  };
  return {
    get: <T>(key: string): T => effectiveValue(key) as T,
    onDidChange: (listener) =>
      subscribePluginSettingsChanges((changedKeys) => {
        listener(createConfigurationChangeEvent(changedKeys));
      }),
    reset: async (key) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().reset(key);
    },
    set: async (key, value) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().set(key, value);
    },
  };
}
```

  - `createRendererPluginContext` 返回对象在 `commandPalette` 成员后加 `configuration: createPluginConfiguration(entry),`。
- [ ] `pnpm vitest run tests/unit/renderer/plugin-configuration-context.test.ts` 全绿；`pnpm vitest run tests/unit/renderer/plugin-host-context.test.tsx tests/unit/renderer/git-plugin.test.tsx` 无回归。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/plugins/api/renderer.ts src/renderer/lib/plugins/host-context.ts tests/unit/renderer/plugin-configuration-context.test.ts` → diff → `feat(plugin): renderer plugin context configuration api with ownership assertion` → 等确认。

---

## Task 9：i18n — locale schema `settings` 段 + display.ts 解析器

**Files:**

- Modify: `src/shared/contracts/plugin.ts`（`pluginLocaleMessagesSchema` 现 32–46 行加 `settings` 字段；其上新增 `pluginLocalizedSettingSchema`）
- Modify: `src/renderer/lib/plugins/display.ts`（新增 `defaultPluginSettingLabel` / `resolveArrayFromLocales`（私有）/ `resolvePluginSettingDisplay` / `resolvePluginConfigurationTitle`）
- Test: `tests/unit/renderer/plugin-setting-display.test.ts`（新建）

**Interfaces:**

- Consumes: Task 1 `manifest.configuration`；display.ts 既有私有 `resolveFromLocales`（现 54–73 行）与 `localeCandidates`（现 31–41 行）。
- Produces:
  - `PluginLocaleMessages.settings?: Record<settingKey, { label?; description?; enumDescriptions? }>`；
  - `defaultPluginSettingLabel(pluginId, key)` — **label 缺省 = key 去掉插件前缀后的全部剩余段**（避免尾段撞名）；
  - `resolvePluginSettingDisplay(manifest, key, locale)`；
  - `resolvePluginConfigurationTitle(entry, locale)` = `configuration.title ?? resolvePluginDisplay(entry, locale).name`。

**Steps:**

- [ ] 新建 `tests/unit/renderer/plugin-setting-display.test.ts`：

```ts
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import {
  defaultPluginSettingLabel,
  resolvePluginConfigurationTitle,
  resolvePluginSettingDisplay,
} from "@/lib/plugins/display.ts";

function entryWith(overrides: {
  configurationTitle?: string;
  locales?: PluginRegistryEntry["manifest"]["locales"];
}): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            description: "Manifest fallback description.",
            type: "boolean",
          },
          "pier.git.statusItem.mode": {
            default: "auto",
            enum: ["auto", "manual"],
            enumDescriptions: ["Auto (manifest)", "Manual (manifest)"],
            type: "string",
          },
        },
        ...(overrides.configurationTitle
          ? { title: overrides.configurationTitle }
          : {}),
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      ...(overrides.locales ? { locales: overrides.locales } : {}),
      localization: {
        defaultLocale: "en",
        files: {},
        locales: ["en", "zh-CN"],
      },
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("defaultPluginSettingLabel", () => {
  it("label 缺省 = 去掉插件前缀后的全部剩余段", () => {
    expect(
      defaultPluginSettingLabel(
        "pier.git",
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe("statusItem.showDirtyIndicator");
    expect(defaultPluginSettingLabel("pier.git", "other.key")).toBe(
      "other.key"
    );
  });
});

describe("resolvePluginSettingDisplay", () => {
  it("locale settings 段优先，缺失回落 manifest description 与默认 label", () => {
    const entry = entryWith({
      locales: {
        "zh-CN": {
          settings: {
            "pier.git.statusItem.showDirtyIndicator": {
              description: "在状态项中显示变更计数。",
              label: "显示变更指示",
            },
          },
        },
      },
    });
    const zh = resolvePluginSettingDisplay(
      entry.manifest,
      "pier.git.statusItem.showDirtyIndicator",
      "zh-CN"
    );
    expect(zh).toEqual({
      description: "在状态项中显示变更计数。",
      label: "显示变更指示",
    });

    const en = resolvePluginSettingDisplay(
      entry.manifest,
      "pier.git.statusItem.showDirtyIndicator",
      "en"
    );
    expect(en.label).toBe("statusItem.showDirtyIndicator");
    expect(en.description).toBe("Manifest fallback description.");
  });

  it("enumDescriptions locale 覆盖回落 manifest", () => {
    const entry = entryWith({
      locales: {
        "zh-CN": {
          settings: {
            "pier.git.statusItem.mode": {
              enumDescriptions: ["自动", "手动"],
            },
          },
        },
      },
    });
    expect(
      resolvePluginSettingDisplay(
        entry.manifest,
        "pier.git.statusItem.mode",
        "zh-CN"
      ).enumDescriptions
    ).toEqual(["自动", "手动"]);
    expect(
      resolvePluginSettingDisplay(
        entry.manifest,
        "pier.git.statusItem.mode",
        "en"
      ).enumDescriptions
    ).toEqual(["Auto (manifest)", "Manual (manifest)"]);
  });
});

describe("resolvePluginConfigurationTitle", () => {
  it("configuration.title 优先，缺省回落插件显示名", () => {
    expect(
      resolvePluginConfigurationTitle(
        entryWith({ configurationTitle: "Git Settings" }),
        "en"
      )
    ).toBe("Git Settings");
    expect(resolvePluginConfigurationTitle(entryWith({}), "en")).toBe("Git");
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-setting-display.test.ts`，预期失败：export 不存在。
- [ ] `src/shared/contracts/plugin.ts`：在 `pluginLocalizedContributionSchema`（现 23–30 行）后加：

```ts
export const pluginLocalizedSettingSchema = z.object({
  description: z.string().min(1).optional(),
  enumDescriptions: z.array(z.string().min(1)).optional(),
  label: z.string().min(1).optional(),
});
export type PluginLocalizedSetting = z.infer<
  typeof pluginLocalizedSettingSchema
>;
```

`pluginLocaleMessagesSchema`（现 32–45 行）在 `panels` 后按字母序加：

```ts
settings: z
  .record(z.string().min(1), pluginLocalizedSettingSchema)
  .optional(),
```

- [ ] `src/renderer/lib/plugins/display.ts` 文件末尾加：

```ts
function resolveArrayFromLocales(
  manifest: PluginManifest,
  locale: string,
  pick: (messages: PluginLocaleMessages) => readonly string[] | undefined
): readonly string[] | undefined {
  for (const candidate of localeCandidates(
    locale,
    manifest.localization?.defaultLocale
  )) {
    const value = manifest.locales?.[candidate];
    if (!value) {
      continue;
    }
    const resolved = pick(value);
    if (resolved) {
      return resolved;
    }
  }
  return;
}

export interface PluginSettingDisplayText {
  description?: string;
  enumDescriptions?: readonly string[];
  label: string;
}

/** label 缺省 = key 去掉 `<pluginId>.` 前缀后的全部剩余段（避免尾段撞名）。 */
export function defaultPluginSettingLabel(
  pluginId: string,
  key: string
): string {
  const prefix = `${pluginId}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export function resolvePluginSettingDisplay(
  manifest: PluginManifest,
  key: string,
  locale: string
): PluginSettingDisplayText {
  const property = manifest.configuration?.properties[key];
  const description =
    resolveFromLocales(
      manifest,
      locale,
      (messages) => messages.settings?.[key]?.description
    ) ?? property?.description;
  const enumDescriptions =
    resolveArrayFromLocales(
      manifest,
      locale,
      (messages) => messages.settings?.[key]?.enumDescriptions
    ) ?? property?.enumDescriptions;
  return {
    label:
      resolveFromLocales(
        manifest,
        locale,
        (messages) => messages.settings?.[key]?.label
      ) ?? defaultPluginSettingLabel(manifest.id, key),
    ...(description ? { description } : {}),
    ...(enumDescriptions ? { enumDescriptions } : {}),
  };
}

/** 设置导航插件项 label：configuration.title ?? 插件显示名（后者走 manifest i18n）。 */
export function resolvePluginConfigurationTitle(
  entry: PluginRegistryEntry,
  locale: string
): string {
  return (
    entry.manifest.configuration?.title ??
    resolvePluginDisplay(entry, locale).name
  );
}
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-setting-display.test.ts` 全绿；`pnpm test:unit` 无回归。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/shared/contracts/plugin.ts src/renderer/lib/plugins/display.ts tests/unit/renderer/plugin-setting-display.test.ts` → diff → `feat(plugin): settings locale segment and setting display resolvers` → 等确认。

---

## Task 10：设置 UI — 导航两 variant + `PluginConfigurationSection` + fallback + 文案

**Files:**

- Modify: `src/renderer/stores/settings-dialog.store.ts`（全文 15 行：加 `activeSection` / `setActiveSection`）
- Modify: `src/renderer/pages/settings/data/appearance-nav.ts`（全文 23 行：拆两 variant + section id 工具 + `pluginNavItems`）
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`（导航渲染 82–100 行、section 渲染 105–114 行、`activeSection` useState 44–45 行迁入 store、SidebarGroup 分组、fallback effect）
- Create: `src/renderer/pages/settings/components/plugin-configuration-section.tsx`
- Modify: `src/renderer/i18n/locales/en/settings.ts`（`nav` 段现 6–12 行加 `pluginGroup`；顶层加 `pluginConfiguration` 段）
- Modify: `src/renderer/i18n/locales/zh-CN/settings.ts`（同结构中文文案）
- Test: `tests/unit/renderer/plugin-settings-nav.test.ts`（新建）；`tests/unit/renderer/settings-nav.test.ts`（保持通过，静态 `NAV_ITEMS` 仍无 label）

**Interfaces:**

- Consumes:
  - **Phase 0** `usePluginRegistryStore`（导航插件项数据源：已启用且声明 configuration 的插件；启停广播驱动其更新，导航项随之出现/消失——含其它窗口触发的禁用）；
  - Task 6 `usePluginSettingsStore`；Task 9 `resolvePluginConfigurationTitle` / `resolvePluginSettingDisplay`；Task 3 `effectiveConfigurationValue`；
  - 既有 rows 组件：`SwitchRow`（switch-row.tsx 10–16 行 props）、`SelectRow`（select-row.tsx 22–31 行）、`InputRow`（input-row.tsx 10–24 行）；即改即存交互参照 `terminal-section.tsx`（如 `TerminalScrollbackRow` 34–69 行的 draft + clamp-on-blur 模式）；
  - `SidebarGroup` / `SidebarGroupLabel`（`src/renderer/components/primitives/sidebar.tsx` 现 662–670 行导出）。
- Produces: 见 Produces 清单 appearance-nav / settings-dialog.store / `PluginConfigurationSection` 三段。

**Steps:**

- [ ] 新建 `tests/unit/renderer/plugin-settings-nav.test.ts`：

```ts
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  pluginIdFromSectionId,
  pluginNavItems,
  pluginSectionId,
} from "@/pages/settings/data/appearance-nav.ts";

function entry(
  id: string,
  opts: { configured?: boolean; enabled?: boolean; title?: string } = {}
): PluginRegistryEntry {
  const { configured = true, enabled = true, title } = opts;
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      ...(configured
        ? {
            configuration: {
              properties: {
                [`${id}.enabled`]: { default: true, type: "boolean" },
              },
              ...(title ? { title } : {}),
            },
          }
        : {}),
      engines: { pier: ">=0.1.0" },
      id,
      name: `${id}-name`,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("settings 导航 — 插件项 variant", () => {
  it("静态项全部是 static variant 且不含硬编码 label", () => {
    expect(NAV_ITEMS.every((item) => item.variant === "static")).toBe(true);
    expect(NAV_ITEMS.some((item) => "label" in item)).toBe(false);
  });

  it("插件项只收已启用且声明 configuration 的插件", () => {
    const items = pluginNavItems(
      [
        entry("pier.a", { title: "A Settings" }),
        entry("pier.b", { enabled: false }),
        entry("pier.c", { configured: false }),
      ],
      "en"
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "plugin:pier.a",
      label: "A Settings",
      pluginId: "pier.a",
      variant: "plugin",
    });
  });

  it("configuration.title 缺省回落插件显示名", () => {
    expect(pluginNavItems([entry("pier.a")], "en")[0]?.label).toBe(
      "pier.a-name"
    );
  });

  it("section id 与 pluginId 双向换算", () => {
    expect(pluginSectionId("pier.git")).toBe("plugin:pier.git");
    expect(pluginIdFromSectionId("plugin:pier.git")).toBe("pier.git");
    expect(pluginIdFromSectionId("plugins")).toBeNull();
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-settings-nav.test.ts`，预期失败：export 不存在。
- [ ] `src/renderer/pages/settings/data/appearance-nav.ts` 全文替换为：

```ts
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  Bot,
  Keyboard,
  type LucideIcon,
  Paintbrush,
  Plug,
  Puzzle,
  Terminal,
} from "lucide-react";
import { resolvePluginConfigurationTitle } from "@/lib/plugins/display.ts";

export interface StaticNavItem {
  icon: LucideIcon;
  id: string;
  variant: "static";
}

export interface PluginNavItem {
  icon: LucideIcon;
  id: string;
  label: string;
  pluginId: string;
  variant: "plugin";
}

export type SettingsNavItem = PluginNavItem | StaticNavItem;

export const NAV_ITEMS: readonly StaticNavItem[] = [
  { id: "appearance", icon: Paintbrush, variant: "static" },
  { id: "terminal", icon: Terminal, variant: "static" },
  { id: "keybindings", icon: Keyboard, variant: "static" },
  { id: "plugins", icon: Plug, variant: "static" },
  { id: "agents", icon: Bot, variant: "static" },
] as const;

export type SettingsSectionId = string;

const PLUGIN_SECTION_PREFIX = "plugin:";

export function pluginSectionId(pluginId: string): SettingsSectionId {
  return `${PLUGIN_SECTION_PREFIX}${pluginId}`;
}

export function pluginIdFromSectionId(
  sectionId: SettingsSectionId
): string | null {
  return sectionId.startsWith(PLUGIN_SECTION_PREFIX)
    ? sectionId.slice(PLUGIN_SECTION_PREFIX.length)
    : null;
}

/** 插件导航项：已启用且声明 configuration 的插件；icon 统一 lucide Puzzle。 */
export function pluginNavItems(
  entries: readonly PluginRegistryEntry[],
  locale: string
): PluginNavItem[] {
  return entries
    .filter((entry) => entry.runtime.enabled && entry.manifest.configuration)
    .map((entry) => ({
      icon: Puzzle,
      id: pluginSectionId(entry.manifest.id),
      label: resolvePluginConfigurationTitle(entry, locale),
      pluginId: entry.manifest.id,
      variant: "plugin" as const,
    }));
}
```

- [ ] `src/renderer/stores/settings-dialog.store.ts` 全文替换为：

```ts
import { create } from "zustand";

interface SettingsDialogState {
  activeSection: string;
  close: () => void;
  isOpen: boolean;
  open: () => void;
  setActiveSection: (activeSection: string) => void;
  setOpen: (open: boolean) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  activeSection: "appearance",
  close: () => set({ isOpen: false }),
  isOpen: false,
  open: () => set({ isOpen: true }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setOpen: (isOpen) => set({ isOpen }),
}));
```

- [ ] 新建 `src/renderer/pages/settings/components/plugin-configuration-section.tsx`：

```tsx
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { FieldSeparator, FieldSet } from "@pier/ui/field.tsx";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type {
  PluginConfigurationProperty,
  PluginRegistryEntry,
} from "@shared/contracts/plugin.ts";
import { effectiveConfigurationValue } from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  resolvePluginConfigurationTitle,
  resolvePluginSettingDisplay,
} from "@/lib/plugins/display.ts";
import { InputRow } from "@/pages/settings/components/rows/input-row.tsx";
import { SelectRow } from "@/pages/settings/components/rows/select-row.tsx";
import { SwitchRow } from "@/pages/settings/components/rows/switch-row.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

/** 组内排序：order 升序（缺省按 key 字典序垫底），同 order 按 key 字典序。 */
export function sortedConfigurationKeys(
  properties: Record<string, PluginConfigurationProperty>
): string[] {
  return Object.keys(properties).sort((a, b) => {
    const orderA = properties[a]?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = properties[b]?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.localeCompare(b);
  });
}

function writeSetting(key: string, value: JsonValue, failedText: string): void {
  usePluginSettingsStore
    .getState()
    .set(key, value)
    .catch((err: unknown) => {
      toast.error(failedText, {
        description: err instanceof Error ? err.message : String(err),
      });
    });
}

function SettingRowShell({
  children,
  modified,
  modifiedLabel,
  onReset,
  resetLabel,
}: {
  children: ReactNode;
  modified: boolean;
  modifiedLabel: string;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      {modified ? (
        <>
          <Badge variant="secondary">{modifiedLabel}</Badge>
          <Button
            aria-label={resetLabel}
            onClick={onReset}
            size="xs"
            title={resetLabel}
            type="button"
            variant="ghost"
          >
            <RotateCcw />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function StringSettingRow({
  effective,
  id,
  label,
  onCommit,
  ...rest
}: {
  description?: string;
  effective: string;
  id: string;
  label: string;
  max?: number;
  min?: number;
  onCommit: (raw: string) => void;
  type: "number" | "text";
}) {
  const [draft, setDraft] = useState(effective);
  const [prev, setPrev] = useState(effective);
  if (effective !== prev) {
    setPrev(effective);
    setDraft(effective);
  }
  return (
    <InputRow
      id={id}
      inputClassName="w-[180px]"
      label={label}
      onBlur={onCommit}
      onChange={setDraft}
      value={draft}
      {...rest}
    />
  );
}

function numberFromDraft(
  raw: string,
  property: PluginConfigurationProperty,
  fallback: number
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored =
    property.minimum !== undefined
      ? Math.max(property.minimum, parsed)
      : parsed;
  return property.maximum !== undefined
    ? Math.min(property.maximum, floored)
    : floored;
}

function PluginSettingRow({
  entry,
  property,
  settingKey,
}: {
  entry: PluginRegistryEntry;
  property: PluginConfigurationProperty;
  settingKey: string;
}) {
  const t = useT();
  const userValue = usePluginSettingsStore((s) => s.values[settingKey]);
  const display = resolvePluginSettingDisplay(
    entry.manifest,
    settingKey,
    i18next.language
  );
  const effective = effectiveConfigurationValue(property, userValue);
  const modified =
    userValue !== undefined &&
    JSON.stringify(effective) !== JSON.stringify(property.default);
  const failedText = t("settings.pluginConfiguration.writeFailed");
  const rowId = `plugin-setting-${settingKey}`;

  let control: ReactNode;
  if (property.type === "boolean") {
    control = (
      <SwitchRow
        checked={effective === true}
        description={display.description}
        id={rowId}
        label={display.label}
        onCheckedChange={(next) => writeSetting(settingKey, next, failedText)}
      />
    );
  } else if (property.enum) {
    control = (
      <SelectRow<string>
        description={display.description}
        id={rowId}
        label={display.label}
        onChange={(next) => writeSetting(settingKey, next, failedText)}
        options={property.enum.map((value, index) => ({
          label: display.enumDescriptions?.[index] ?? value,
          value,
        }))}
        triggerWidth="w-[180px]"
        value={String(effective)}
      />
    );
  } else if (property.type === "number") {
    control = (
      <StringSettingRow
        description={display.description}
        effective={String(effective)}
        id={rowId}
        label={display.label}
        max={property.maximum}
        min={property.minimum}
        onCommit={(raw) => {
          const next = numberFromDraft(raw, property, Number(effective));
          if (next !== effective) {
            writeSetting(settingKey, next, failedText);
          }
        }}
        type="number"
      />
    );
  } else {
    control = (
      <StringSettingRow
        description={display.description}
        effective={String(effective)}
        id={rowId}
        label={display.label}
        onCommit={(raw) => {
          if (raw !== effective) {
            writeSetting(settingKey, raw, failedText);
          }
        }}
        type="text"
      />
    );
  }

  return (
    <SettingRowShell
      modified={modified}
      modifiedLabel={t("settings.pluginConfiguration.modified")}
      onReset={() => {
        usePluginSettingsStore
          .getState()
          .reset(settingKey)
          .catch(() => undefined);
      }}
      resetLabel={t("settings.pluginConfiguration.resetToDefault")}
    >
      {control}
    </SettingRowShell>
  );
}

export function PluginConfigurationSection({ pluginId }: { pluginId: string }) {
  const entry = usePluginRegistryStore((s) =>
    s.plugins.find((item) => item.manifest.id === pluginId)
  );
  const configuration = entry?.manifest.configuration;
  if (!(entry && configuration)) {
    // 插件在本 section 激活期间被禁用 — settings-dialog 的 fallback effect 会切走。
    return null;
  }
  const keys = sortedConfigurationKeys(configuration.properties);
  return (
    <div className="px-4 pb-4" id={`plugin-configuration-${pluginId}`}>
      <h1 className="mb-4 text-xl">
        {resolvePluginConfigurationTitle(entry, i18next.language)}
      </h1>
      <Card>
        <CardContent>
          <FieldSet>
            {keys.map((settingKey, index) => {
              const property = configuration.properties[settingKey];
              if (!property) {
                return null;
              }
              return (
                <Fragment key={settingKey}>
                  {index > 0 ? <FieldSeparator /> : null}
                  <PluginSettingRow
                    entry={entry}
                    property={property}
                    settingKey={settingKey}
                  />
                </Fragment>
              );
            })}
          </FieldSet>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] `src/renderer/pages/settings/settings-dialog.tsx` 全文替换为：

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import i18next from "i18next";
import type { CSSProperties } from "react";
import { useEffect } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/primitives/sidebar.tsx";
import { useT } from "@/i18n/use-t.ts";
import { AgentsSection } from "@/pages/settings/components/agents-section.tsx";
import { AppearanceSection } from "@/pages/settings/components/appearance-section.tsx";
import { KeybindingsSection } from "@/pages/settings/components/keybindings-section.tsx";
import { PluginConfigurationSection } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";
import {
  NAV_ITEMS,
  type PluginNavItem,
  pluginIdFromSectionId,
  pluginNavItems,
} from "@/pages/settings/data/appearance-nav.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";

const SIDEBAR_STYLE: CSSProperties = {
  "--sidebar-width": "10rem",
  "--sidebar": "none",
} as CSSProperties;

function NavButton({
  active,
  icon: Icon,
  label,
  onSelect,
  testId,
}: {
  active: boolean;
  icon: (typeof NAV_ITEMS)[number]["icon"];
  label: string;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-current={active ? "page" : undefined}
        data-testid={testId}
        isActive={active}
        onClick={onSelect}
        type="button"
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useSettingsDialogStore((s) => s.isOpen);
  const onOpenChange = useSettingsDialogStore((s) => s.setOpen);
  const activeSection = useSettingsDialogStore((s) => s.activeSection);
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection);
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const pluginItems: PluginNavItem[] = pluginNavItems(
    plugins,
    i18next.language
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay("settings-dialog");
    const releaseWebFocus = requestTerminalWebFocus("settings-dialog");
    return () => {
      releaseWebFocus();
      route.dispose();
    };
  }, [open]);

  useEffect(
    () =>
      window.pier?.settings?.onOpenRequest?.(() => {
        useSettingsDialogStore.getState().open();
      }),
    []
  );

  // activeSection 指向的插件 section 消失（禁用/卸载，含其它窗口触发）→ fallback 到 plugins。
  useEffect(() => {
    const pluginId = pluginIdFromSectionId(activeSection);
    if (pluginId && !pluginItems.some((item) => item.pluginId === pluginId)) {
      setActiveSection("plugins");
    }
  }, [activeSection, pluginItems, setActiveSection]);

  const activePluginId = pluginIdFromSectionId(activeSection);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-[1200px] flex-col sm:max-w-[1200px]">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <SidebarProvider
          className="min-h-0 flex-1 items-start gap-3"
          style={SIDEBAR_STYLE}
        >
          <Sidebar className="hidden md:flex" collapsible="none">
            <SidebarContent className="overflow-visible">
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV_ITEMS.map((item) => (
                    <NavButton
                      active={activeSection === item.id}
                      icon={item.icon}
                      key={item.id}
                      label={t(`settings.nav.${item.id}`)}
                      onSelect={() => setActiveSection(item.id)}
                      testId={`settings-nav-${item.id}`}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
              {pluginItems.length > 0 ? (
                <SidebarGroup className="p-0">
                  <SidebarGroupLabel>
                    {t("settings.nav.pluginGroup")}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {pluginItems.map((item) => (
                        <NavButton
                          active={activeSection === item.id}
                          icon={item.icon}
                          key={item.id}
                          label={item.label}
                          onSelect={() => setActiveSection(item.id)}
                          testId={`settings-nav-plugin-${item.pluginId}`}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : null}
            </SidebarContent>
          </Sidebar>

          <main
            className="relative -mr-6 flex h-full min-h-0 flex-1 flex-col overflow-y-auto"
            data-scrollbar="stable"
          >
            {activeSection === "appearance" ? <AppearanceSection /> : null}
            {activeSection === "terminal" ? <TerminalSection /> : null}
            {activeSection === "keybindings" ? <KeybindingsSection /> : null}
            {activeSection === "plugins" ? <PluginsSection /> : null}
            {activeSection === "agents" ? <AgentsSection /> : null}
            {activePluginId ? (
              <PluginConfigurationSection pluginId={activePluginId} />
            ) : null}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] `src/renderer/i18n/locales/en/settings.ts`：`nav` 段（现 6–12 行）加 `pluginGroup: "Plugin Settings",`；`plugins` 段之后加顶层段：

```ts
pluginConfiguration: {
  columns: {
    description: "Description",
    setting: "Setting",
    value: "Value",
  },
  modified: "Modified",
  openSettings: "Open Settings",
  resetToDefault: "Reset to default",
  settingsTable: "Settings",
  writeFailed: "Failed to update setting",
},
```

- [ ] `src/renderer/i18n/locales/zh-CN/settings.ts` 同位置加：

```ts
pluginGroup: "插件设置",
```

```ts
pluginConfiguration: {
  columns: {
    description: "描述",
    setting: "设置项",
    value: "当前值",
  },
  modified: "已修改",
  openSettings: "打开设置",
  resetToDefault: "恢复默认",
  settingsTable: "设置",
  writeFailed: "设置更新失败",
},
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-settings-nav.test.ts tests/unit/renderer/settings-nav.test.ts` 全绿；`pnpm test:unit` 无回归（`agents-section.test.tsx` 等挂 SettingsDialog 相关树的用例若读 `usePluginRegistryStore` 初始空数组即可正常渲染）。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/renderer/pages/settings/data/appearance-nav.ts src/renderer/pages/settings/settings-dialog.tsx src/renderer/pages/settings/components/plugin-configuration-section.tsx src/renderer/stores/settings-dialog.store.ts src/renderer/i18n/locales/en/settings.ts src/renderer/i18n/locales/zh-CN/settings.ts tests/unit/renderer/plugin-settings-nav.test.ts` → diff → `feat(settings): schema-driven plugin configuration sections with dynamic nav` → 等确认。

---

## Task 11：详情页设置只读表 + 「打开设置」按钮

**Files:**

- Create: `src/renderer/pages/settings/components/plugin-settings-contribution.tsx`
- Modify: `src/renderer/pages/settings/components/plugin-details.tsx`（Phase 1 重构后形态：在贡献点分区序列（terminal status items 表之后、permissions 之前）挂 `<PluginSettingsContribution entry={entry} />`；Phase 1 已保证「无贡献则整区隐藏」，本组件自身对无 configuration 返回 null，挂载点无须条件包裹）
- Test: `tests/unit/renderer/plugin-settings-contribution.test.tsx`（新建）

**Interfaces:**

- Consumes:
  - **Phase 1** `ContributionTable`（`src/renderer/pages/settings/components/contribution-table.tsx`，props `{ headers: string[]; rows: ReactNode[][] }`）；
  - Task 6 `usePluginSettingsStore`（当前生效值实时刷新）；Task 9 `resolvePluginSettingDisplay`；Task 10 `pluginSectionId` / `useSettingsDialogStore.setActiveSection` / `sortedConfigurationKeys` / `settings.pluginConfiguration.*` 文案。
- Produces: `PluginSettingsContribution({ entry }: { entry: PluginRegistryEntry })` — 只读表（设置名 | 当前生效值 | 描述）+「打开设置」按钮；**插件禁用态按钮 disabled**（其导航项不存在）。

**Steps:**

- [ ] 新建 `tests/unit/renderer/plugin-settings-contribution.test.tsx`：

```tsx
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginSettingsContribution } from "@/pages/settings/components/plugin-settings-contribution.tsx";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

function gitEntry(enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            description: "Show change counts.",
            type: "boolean",
          },
        },
      },
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

describe("PluginSettingsContribution", () => {
  beforeEach(() => {
    usePluginSettingsStore.setState({ initialized: true, values: {} });
    useSettingsDialogStore.setState({ activeSection: "plugins" });
  });

  afterEach(() => {
    cleanup();
  });

  it("渲染只读表：label、当前生效值、描述", () => {
    render(<PluginSettingsContribution entry={gitEntry()} />);
    expect(
      screen.getByText("statusItem.showDirtyIndicator")
    ).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("Show change counts.")).toBeInTheDocument();
  });

  it("用户值覆盖后展示生效值", () => {
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.git.statusItem.showDirtyIndicator": false },
    });
    render(<PluginSettingsContribution entry={gitEntry()} />);
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("打开设置按钮跳转到插件 section；禁用态插件按钮 disabled", () => {
    const { unmount } = render(
      <PluginSettingsContribution entry={gitEntry()} />
    );
    fireEvent.click(
      screen.getByTestId("plugin-settings-open-pier.git")
    );
    expect(useSettingsDialogStore.getState().activeSection).toBe(
      "plugin:pier.git"
    );
    unmount();

    render(<PluginSettingsContribution entry={gitEntry(false)} />);
    expect(
      screen.getByTestId("plugin-settings-open-pier.git")
    ).toBeDisabled();
  });

  it("无 configuration 的插件整区隐藏", () => {
    const entry = gitEntry();
    const { configuration: _omitted, ...manifest } = entry.manifest;
    const { container } = render(
      <PluginSettingsContribution entry={{ ...entry, manifest }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/plugin-settings-contribution.test.tsx`，预期失败：`Cannot find module '@/pages/settings/components/plugin-settings-contribution.tsx'`。
- [ ] 新建 `src/renderer/pages/settings/components/plugin-settings-contribution.tsx`：

```tsx
import { Button } from "@pier/ui/button.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { effectiveConfigurationValue } from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginSettingDisplay } from "@/lib/plugins/display.ts";
import { ContributionTable } from "@/pages/settings/components/contribution-table.tsx";
import { sortedConfigurationKeys } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { pluginSectionId } from "@/pages/settings/data/appearance-nav.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

/** 详情页只读设置表 — 设置对话框是唯一编辑入口，这里只读 + 跳转。 */
export function PluginSettingsContribution({
  entry,
}: {
  entry: PluginRegistryEntry;
}) {
  const t = useT();
  const values = usePluginSettingsStore((s) => s.values);
  const configuration = entry.manifest.configuration;
  if (!configuration) {
    return null;
  }
  const rows = sortedConfigurationKeys(configuration.properties).flatMap(
    (settingKey) => {
      const property = configuration.properties[settingKey];
      if (!property) {
        return [];
      }
      const display = resolvePluginSettingDisplay(
        entry.manifest,
        settingKey,
        i18next.language
      );
      return [
        [
          display.label,
          String(effectiveConfigurationValue(property, values[settingKey])),
          display.description ?? "",
        ],
      ];
    }
  );
  return (
    <div className="min-w-0 space-y-2">
      <div className="font-medium text-muted-foreground">
        {t("settings.pluginConfiguration.settingsTable")}
      </div>
      <ContributionTable
        headers={[
          t("settings.pluginConfiguration.columns.setting"),
          t("settings.pluginConfiguration.columns.value"),
          t("settings.pluginConfiguration.columns.description"),
        ]}
        rows={rows}
      />
      <Button
        data-testid={`plugin-settings-open-${entry.manifest.id}`}
        disabled={!entry.runtime.enabled}
        onClick={() =>
          useSettingsDialogStore
            .getState()
            .setActiveSection(pluginSectionId(entry.manifest.id))
        }
        size="sm"
        type="button"
        variant="outline"
      >
        {t("settings.pluginConfiguration.openSettings")}
      </Button>
    </div>
  );
}
```

- [ ] `src/renderer/pages/settings/components/plugin-details.tsx`：import 加 `import { PluginSettingsContribution } from "./plugin-settings-contribution.tsx";`，在 `PluginDetails` 的贡献点分区序列中（Phase 1 重构后的 terminal status items 表之后、permissions 区之前）插入一行 `<PluginSettingsContribution entry={entry} />`。
- [ ] `pnpm vitest run tests/unit/renderer/plugin-settings-contribution.test.tsx` 全绿；`pnpm test:unit` 无回归。
- [ ] `pnpm check` 全绿。
- [ ] Commit：`git add src/renderer/pages/settings/components/plugin-settings-contribution.tsx src/renderer/pages/settings/components/plugin-details.tsx tests/unit/renderer/plugin-settings-contribution.test.tsx` → diff → `feat(settings): read-only plugin settings table in plugin details with open-settings jump` → 等确认。

---

## Task 12：pier.git 试点设置 + git-status-item 消费 + E2E

**Files:**

- Modify: `src/plugins/builtin/git/manifest.ts`（现 87–99 行之间：`commands` 数组结束后、`description` 前按字母序加 `configuration` 块）
- Modify: `src/plugins/builtin/git/locales/en.json`（顶层加 `settings` 段）
- Modify: `src/plugins/builtin/git/locales/zh-CN.json`（顶层加 `settings` 段）
- Modify: `src/plugins/builtin/git/renderer/git-status-item.tsx`（新增 `useShowDirtyIndicator` hook；`StatusBody`（现 150–220 行）的 working-tree 计数块（现 198–211 行）受设置门控并包 `data-testid="git-dirty-indicator"`；`WorktreeStatusItem`（现 222–281 行）取值下传）
- Test: `tests/unit/renderer/git-status-item-config.test.tsx`（新建）
- Test: `tests/e2e/plugin-settings.spec.ts`（新建）

**Interfaces:**

- Consumes: Task 8 `context.configuration`（`src/plugins` 禁 import main/renderer，试点消费只经 context，链路合规）；Task 10 的导航 testid `settings-nav-plugin-pier.git` 与行 id `plugin-setting-<key>`；`agents-settings.spec.ts` 的 `_electron.launch` + `--user-data-dir` 模式（现 23–43 行 launch/close helper）。
- Produces: manifest 设置 `pier.git.statusItem.showDirtyIndicator`（boolean，default `true`）；git 状态项对该设置的实时响应（onDidChange）。

**Steps:**

- [ ] `src/plugins/builtin/git/manifest.ts`：在 `commands: [...]`（现 8–87 行）之后、`description`（现 88 行）之前插入：

```ts
configuration: {
  properties: {
    "pier.git.statusItem.showDirtyIndicator": {
      default: true,
      description:
        "Show working tree change counts and line delta in the worktree status item.",
      type: "boolean",
    },
  },
},
```

- [ ] `src/plugins/builtin/git/locales/en.json` 顶层（`"panels"` 段旁）加：

```json
"settings": {
  "pier.git.statusItem.showDirtyIndicator": {
    "label": "Show dirty indicator",
    "description": "Show working tree change counts and line delta in the worktree status item."
  }
}
```

- [ ] `src/plugins/builtin/git/locales/zh-CN.json` 顶层加：

```json
"settings": {
  "pier.git.statusItem.showDirtyIndicator": {
    "label": "显示变更指示",
    "description": "在工作树状态项中显示变更文件计数与行数增减。"
  }
}
```

- [ ] 新建 `tests/unit/renderer/git-status-item-config.test.tsx`（先跑失败）：

```tsx
import type {
  RendererPluginContext,
  RendererTerminalStatusItem,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGitStatusItem } from "@plugins/builtin/git/renderer/git-status-item.tsx";

const DIRTY_STATUS = {
  branch: { ahead: 0, behind: 0, branch: "main", upstream: null },
  counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
  delta: { deletions: 3, insertions: 5 },
  repoState: { kind: "clean" },
  stashCount: 0,
};

function makeContext(showDirtyIndicator: boolean): {
  context: RendererPluginContext;
  registered: () => RendererTerminalStatusItem;
} {
  let item: RendererTerminalStatusItem | undefined;
  const context = {
    configuration: {
      get: <T,>(key: string): T => {
        if (key === "pier.git.statusItem.showDirtyIndicator") {
          return showDirtyIndicator as unknown as T;
        }
        return undefined as unknown as T;
      },
      onDidChange: vi.fn(() => () => undefined),
      reset: vi.fn(),
      set: vi.fn(),
    },
    git: {
      getStatus: vi.fn(() => Promise.resolve(DIRTY_STATUS)),
      watch: vi.fn(() => () => undefined),
    },
    i18n: {
      commandDescription: () => undefined,
      commandTitle: (id: string) => id,
      language: () => "en",
      t: (_key: string, _values?: unknown, fallback = "") => fallback,
    },
    terminalStatusItems: {
      register: (registration: RendererTerminalStatusItem) => {
        item = registration;
        return () => undefined;
      },
    },
  } as unknown as RendererPluginContext;
  return {
    context,
    registered: () => {
      if (!item) {
        throw new Error("status item not registered");
      }
      return item;
    },
  };
}

const PANEL_CONTEXT = {
  branch: "main",
  gitRoot: "/repo",
  worktreeRoot: "/repo",
} as unknown as PanelContext;

describe("git status item — showDirtyIndicator 设置消费", () => {
  afterEach(() => {
    cleanup();
  });

  async function renderItem(showDirtyIndicator: boolean) {
    const { context, registered } = makeContext(showDirtyIndicator);
    registerGitStatusItem(context);
    render(
      <>
        {registered().render({
          context: PANEL_CONTEXT,
          cwd: "/repo",
          panelId: "panel-1",
          title: null,
        })}
      </>
    );
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });
  }

  it("默认 true：渲染 dirty indicator", async () => {
    await renderItem(true);
    await waitFor(() => {
      expect(screen.getByTestId("git-dirty-indicator")).toBeInTheDocument();
    });
  });

  it("false：dirty indicator 隐藏，其余状态项内容保留", async () => {
    await renderItem(false);
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-dirty-indicator")).toBeNull();
  });
});
```

- [ ] `pnpm vitest run tests/unit/renderer/git-status-item-config.test.tsx`，预期失败：`Unable to find an element by: [data-testid="git-dirty-indicator"]`。
- [ ] `src/plugins/builtin/git/renderer/git-status-item.tsx`：
  - 常量区（现 95–96 行阈值旁）加设置 key 常量：

```ts
const SHOW_DIRTY_INDICATOR_KEY = "pier.git.statusItem.showDirtyIndicator";
```

  - `useGitStatus`（现 44–89 行）之后加 hook：

```ts
/** 试点设置消费：经 context.configuration 读生效值并 onDidChange 实时响应。 */
function useShowDirtyIndicator(pluginContext: RendererPluginContext): boolean {
  const [value, setValue] = useState<boolean>(() =>
    pluginContext.configuration.get<boolean>(SHOW_DIRTY_INDICATOR_KEY)
  );
  useEffect(
    () =>
      pluginContext.configuration.onDidChange((event) => {
        if (event.affectsConfiguration(SHOW_DIRTY_INDICATOR_KEY)) {
          setValue(
            pluginContext.configuration.get<boolean>(SHOW_DIRTY_INDICATOR_KEY)
          );
        }
      }),
    [pluginContext]
  );
  return value;
}
```

  - `StatusBody`（现 150–220 行）props 增 `showDirtyIndicator: boolean`，working-tree 块（现 198–211 行）改为：

```tsx
{showDirtyIndicator && (flags.hasWorkingChanges || flags.hasDelta) && (
  <span className="contents" data-testid="git-dirty-indicator">
    <SdDivider />
    <WorkingTreeCounts counts={flags.counts} pluginContext={pluginContext} />
    <LineDelta delta={flags.delta} pluginContext={pluginContext} />
    <LargeChangeWarning
      pluginContext={pluginContext}
      show={flags.hasLargeChange}
    />
  </span>
)}
```

  - `WorktreeStatusItem`（现 222–281 行）内加 `const showDirtyIndicator = useShowDirtyIndicator(pluginContext);`（放在 `useGitStatus` 调用旁、任何 early-return 之前，遵守 hooks 规则），`<StatusBody …/>`（现 272–278 行）加 `showDirtyIndicator={showDirtyIndicator}`。
- [ ] `pnpm vitest run tests/unit/renderer/git-status-item-config.test.tsx` 全绿；`pnpm vitest run tests/unit/renderer/git-plugin.test.tsx tests/unit/plugins/builtin-git-package.test.ts` 无回归（manifest 新增 configuration 字段经 Task 1 schema 校验合法）。
- [ ] 新建 `tests/e2e/plugin-settings.spec.ts`：

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const SETTING_ROW_ID =
  "plugin-setting-pier.git.statusItem.showDirtyIndicator";

async function launchPierApp(userDataDir: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
}

async function openGitPluginSettings(win: Page): Promise<void> {
  await win.waitForTimeout(1500);
  await win.keyboard.press(SETTINGS_ACCELERATOR);
  await expect(win.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  const navItem = win.locator('[data-testid="settings-nav-plugin-pier.git"]');
  await expect(navItem).toBeVisible({ timeout: 5000 });
  await navItem.click();
  await win.waitForTimeout(400);
}

test.describe("Plugin settings e2e", () => {
  test("插件设置导航项出现 → 改 boolean → git 状态项 dirty indicator 隐藏 → 重启持久化", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-plugin-settings-e2e-"));
    try {
      const app = await launchPierApp(userDataDir);
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 前置：默认终端 cwd 是仓库目录，git 状态项可见
      await expect(
        win.locator('[data-testid="worktree-status-trigger"]')
      ).toBeVisible({ timeout: 15_000 });

      await openGitPluginSettings(win);

      const switchControl = win.locator(`[id="${SETTING_ROW_ID}"]`);
      await expect(switchControl).toBeVisible({ timeout: 5000 });
      await expect(switchControl).toHaveAttribute("aria-checked", "true");
      await switchControl.click();
      await expect(switchControl).toHaveAttribute("aria-checked", "false");

      // 关闭设置，dirty indicator 必须消失（onDidChange 实时响应；
      // 工作树 clean 时本就不渲染 —— 断言 count 0 两种情形均成立）
      await win.keyboard.press("Escape");
      await expect(
        win.locator('[data-testid="git-dirty-indicator"]')
      ).toHaveCount(0, { timeout: 5000 });

      await app.close();

      // 二次 launch 同 userDataDir：plugin-settings.json 持久化生效
      const app2 = await launchPierApp(userDataDir);
      const win2 = await app2.firstWindow();
      await win2.waitForLoadState("domcontentloaded");
      await openGitPluginSettings(win2);
      await expect(
        win2.locator(`[id="${SETTING_ROW_ID}"]`)
      ).toHaveAttribute("aria-checked", "false", { timeout: 5000 });
      await app2.close();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] `pnpm build`（e2e 跑 `out/main/index.js`，需先构建）→ `pnpm test:e2e tests/e2e/plugin-settings.spec.ts` 通过。
- [ ] `pnpm test:unit` + `pnpm check` 全绿。
- [ ] Commit：`git add src/plugins/builtin/git/manifest.ts src/plugins/builtin/git/locales/en.json src/plugins/builtin/git/locales/zh-CN.json src/plugins/builtin/git/renderer/git-status-item.tsx tests/unit/renderer/git-status-item-config.test.tsx tests/e2e/plugin-settings.spec.ts` → diff → `feat(git): pilot showDirtyIndicator setting consumed via plugin configuration api` → 等确认。

---

## 验收清单（对照 spec §3.2 / §5 / §6）

- [ ] manifest configuration 校验四条（default/type、enum 仅 string、default ∈ enum、enumDescriptions 等长）+ min/max 仅 number + settingKey 前缀 superRefine + 插件 id 互为点分前缀拒绝，全部走 `invalid_manifest` 诊断路径（Task 1/2）。
- [ ] `plugin-settings.json` 只存用户改过的值；恢复默认 = 删 key；损坏/不合法 ensureStore 重置；flush 挂退出链；禁用/卸载插件保留存储值（store 层从不按 registry 清理，Task 4/5）。
- [ ] `set()` resolve 语义三件套：resolve 时 main 内存已提交（Task 5 service 测试）；发起窗口 resolve 路径同步镜像（Task 6 store 测试）；广播服务其它窗口且双投递去重（Task 6）。
- [ ] main/renderer context 同形 configuration API；set/reset 前缀断言；`affectsConfiguration` 点分段精确匹配（Task 3/7/8）。
- [ ] main context 按 entry 创建；plugin-settings init 先于 `MainPluginRuntime.refresh()`（host-api refresh 入口 await，Task 7）。
- [ ] 设置导航两 variant；插件项归「插件设置」SidebarGroup；label = configuration.title ?? 显示名；icon Puzzle；activeSection 指向的插件 section 消失 → fallback `plugins`（Task 10）。
- [ ] 四类控件即改即存 + 已修改标记 + 恢复默认；写失败 toast（Task 10）。
- [ ] 详情页只读表 + 打开设置（禁用态 disabled）（Task 11）。
- [ ] pier.git 试点 manifest→存储→API→UI→消费 全链路 + E2E 持久化验证（Task 12）。
