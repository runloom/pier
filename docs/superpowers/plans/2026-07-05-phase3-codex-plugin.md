# Phase 3: Codex 内置插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1（大盘地基）与 Phase 2（账号地基）交付物之上，实现 `pier.codex` 内置插件：通过窄 `context.accounts` facade 消费账号域服务，贡献大盘 widget + 命令面板命令，完成端到端集成。同步补齐插件 facade 的宿主实现、builtin-catalog 接入、e2e 测试与 AGENTS.md 架构段落更新。

**Architecture:** 新增 `src/plugins/builtin/codex/` 插件包（manifest / main / renderer / locales），renderer 侧经 `context.accounts` facade（`assertPluginCapability` 门控、读路径走 `useAgentAccountsStore` 同步、写路径走 `window.pier.accounts`）消费 Phase 2 的账号域。facade 实现拆为 `src/renderer/lib/plugins/host-accounts-context.ts`（对齐 `host-git-context.ts` 模式）。widget 注册走 Phase 1 的 `dashboardWidgets.register` 通道。两个 builtin-catalog 各加一行。

**Tech Stack:** TypeScript 6 strict · React 19 · Vitest 4 · Zustand 5 · i18next · Playwright（e2e）

## Global Constraints

- **前置依赖**：Phase 1（大盘地基）交付的 `dashboardWidgets.register` 通道、`plugin-dashboard-widget-registry.ts` 注册表、`assertDeclaredContribution("dashboardWidget")` 扩展；Phase 2（账号地基）交付的 `agent-accounts.store.ts`（`useAgentAccountsStore`）、`window.pier.accounts` preload facade、`PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED`、`account:read`/`account:write` capability。两个 Phase 的接口定义见本文件底部跨阶段契约节。
- **不 auto-commit**：参照 `AGENTS.md` §05 安全边界，每个 task 结尾跑对应验证命令即可，commit 由用户在全部完成后统一决策。计划里不写任何 git commit 步骤。
- **禁止 `@ts-ignore` / `as any`**：所有新代码严格类型，不压制类型错误。
- **Biome + Ultracite 风格**：新代码遵循既有格式规范。
- **TDD**：先写失败测试再实现——每个含测试的 Task 严格按"写失败测试 → 确认失败 → 实现 → 确认通过"顺序。
- **测试位置惯例**：单测 `tests/unit/{main,renderer,shared}/`，组件测试 `tests/component/`；命令 `pnpm test:unit -- <file>` / `pnpm test:component -- <file>`；全量 `pnpm typecheck` / `pnpm lint` / `pnpm check`。
- **跨阶段契约逐字一致**：`context.accounts` 签名、`AgentAccountsSnapshot` 类型、capability 枚举值必须与 Phase 1/2 计划中的定义逐字匹配（见文末自检段）。

---

## File Structure

**新增（7）**：
- `src/renderer/lib/plugins/host-accounts-context.ts` — accounts facade 宿主实现
- `src/plugins/builtin/codex/manifest.ts` — 插件 manifest + 常量
- `src/plugins/builtin/codex/main/index.ts` — main 侧空 activate
- `src/plugins/builtin/codex/renderer/index.tsx` — renderer activate 组装
- `src/plugins/builtin/codex/renderer/accounts-widget.tsx` — 大盘 widget 组件
- `src/plugins/builtin/codex/renderer/account-actions.ts` — 命令面板命令处理器
- `src/plugins/builtin/codex/locales/{en.json, zh-CN.json, index.ts}` — 国际化

**修改（4）**：
- `src/plugins/api/renderer.ts` — `RendererPluginContext` 新增 `accounts` facade 类型
- `src/renderer/lib/plugins/host-context.ts` — `createRendererPluginContext` 接入 accounts facade
- `src/renderer/lib/plugins/builtin-catalog.ts` — 加 codex renderer module
- `src/main/plugins/builtin-catalog.ts` — 加 codex main module + manifest + locales

**测试新增（4）**：
- `tests/unit/renderer/host-accounts-context.test.ts` — facade 门控单测
- `tests/component/codex-accounts-widget.test.tsx` — widget 五态组件测试
- `tests/unit/renderer/codex-account-actions.test.ts` — 命令处理器单测
- `tests/e2e/dashboard-widget-persistence.spec.ts` — 大盘组装持久化 e2e

---

## Task 1: 插件 facade 类型 + 宿主实现

**Files:**
- Modify: `src/plugins/api/renderer.ts`（`RendererPluginContext` 接口尾部追加 `accounts`）
- Create: `src/renderer/lib/plugins/host-accounts-context.ts`
- Modify: `src/renderer/lib/plugins/host-context.ts`（`createRendererPluginContext` 返回对象接入；`assertDeclaredContribution` 的 `"dashboardWidget"` 扩展已由 Phase 1 Task 4 完成，本阶段不再改它）
- Create: `tests/unit/renderer/host-accounts-context.test.ts`

**Interfaces:**
- Consumes: Phase 2 的 `useAgentAccountsStore`（`src/renderer/stores/agent-accounts.store.ts`）、`window.pier.accounts`（preload facade）、`AgentAccountsSnapshot` / `AgentAccountProviderId`（`src/shared/contracts/agent-accounts.ts`）、`PierCapability`（`src/shared/contracts/permissions.ts`——Phase 2 已新增 `account:read` / `account:write`）
- Produces: `RendererPluginContext["accounts"]` 类型 + `createPluginAccountsContext` 工厂——供 Task 5 的 `createRendererPluginContext` 消费

- [ ] **Step 1: 写失败测试（facade 门控）**

在 `tests/unit/renderer/host-accounts-context.test.ts` 写入：

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

// 将在 Step 4 实现后导入
import { createPluginAccountsContext } from "@/lib/plugins/host-accounts-context.ts";

function makeEntry(
  permissions: string[]
): PluginRegistryEntry | undefined {
  return {
    effectivePermissions: permissions,
    manifest: { id: "pier.test" },
  } as unknown as PluginRegistryEntry;
}

function assertCapability(
  entry: PluginRegistryEntry | undefined,
  capability: string
): void {
  if (!entry || entry.effectivePermissions.includes(capability)) {
    return;
  }
  throw new Error(
    `plugin capability not granted: ${(entry as PluginRegistryEntry).manifest.id}:${capability}`
  );
}

describe("createPluginAccountsContext", () => {
  it("snapshot 无 account:read 时抛出", () => {
    const ctx = createPluginAccountsContext(
      makeEntry([]),
      assertCapability
    );
    expect(() => ctx.snapshot()).toThrow("account:read");
  });

  it("snapshot 有 account:read 时透传 store 值", () => {
    // mock useAgentAccountsStore
    vi.mock("@/stores/agent-accounts.store.ts", () => ({
      useAgentAccountsStore: {
        getState: () => ({
          snapshot: {
            accounts: [],
            activeAccountId: null,
            loginPending: null,
            ts: 1,
            unmanagedActiveLogin: false,
            usage: {},
          },
        }),
      },
    }));

    const ctx = createPluginAccountsContext(
      makeEntry(["account:read"]),
      assertCapability
    );
    const snap = ctx.snapshot();
    expect(snap.ts).toBe(1);
    expect(snap.accounts).toEqual([]);
  });

  it("select 无 account:write 时抛出", async () => {
    const ctx = createPluginAccountsContext(
      makeEntry(["account:read"]),
      assertCapability
    );
    await expect(ctx.select("some-id")).rejects.toThrow("account:write");
  });

  it("add 有 account:write 时透传 window.pier.accounts", async () => {
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      pier: {
        accounts: {
          add: mockAdd,
          adoptCurrent: vi.fn(),
          cancelLogin: vi.fn(),
          remove: vi.fn(),
          select: vi.fn(),
          refreshUsage: vi.fn(),
        },
      },
    });

    const ctx = createPluginAccountsContext(
      makeEntry(["account:read", "account:write"]),
      assertCapability
    );
    await ctx.add("codex");
    expect(mockAdd).toHaveBeenCalledWith("codex");
  });

  it("onDidChange 无 account:read 时抛出", () => {
    const ctx = createPluginAccountsContext(
      makeEntry([]),
      assertCapability
    );
    expect(() => ctx.onDidChange(() => {})).toThrow("account:read");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/host-accounts-context.test.ts`
Expected: FAIL——模块 `@/lib/plugins/host-accounts-context.ts` 不存在。

- [ ] **Step 3: 在 `src/plugins/api/renderer.ts` 追加 accounts 类型**

在 `src/plugins/api/renderer.ts` 文件顶部 import 区追加：

```ts
import type {
  AgentAccountProviderId,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
```

在 `RendererPluginContext` 接口内（L186-356），`actions` 字段之前（L187 前），插入 `accounts` 字段：

```ts
  /**
   * 账号域 facade。读路径走 renderer 镜像 store（同步、免 IPC 往返），
   * 写路径透传 window.pier.accounts。每方法 assertPluginCapability 门控。
   */
  accounts: {
    add(provider: AgentAccountProviderId): Promise<void>;
    adoptCurrent(): Promise<void>;
    cancelLogin(provider: AgentAccountProviderId): Promise<void>;
    onDidChange(cb: (s: AgentAccountsSnapshot) => void): () => void;
    refreshUsage(): Promise<void>;
    remove(accountId: string): Promise<void>;
    select(accountId: string): Promise<void>;
    snapshot(): AgentAccountsSnapshot;
  };
```

- [ ] **Step 4: 创建 `host-accounts-context.ts`**

写入 `src/renderer/lib/plugins/host-accounts-context.ts`：

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useAgentAccountsStore } from "../../stores/agent-accounts.store.ts";

type AssertPluginCapability = (
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
) => void;

export function createPluginAccountsContext(
  entry: PluginRegistryEntry | undefined,
  assertPluginCapability: AssertPluginCapability
): RendererPluginContext["accounts"] {
  return {
    add: (provider) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.add(provider);
    },
    adoptCurrent: () => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.adoptCurrent();
    },
    cancelLogin: (provider) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.cancelLogin(provider);
    },
    onDidChange: (cb) => {
      assertPluginCapability(entry, "account:read");
      return useAgentAccountsStore.subscribe((state) => {
        cb(state.snapshot);
      });
    },
    refreshUsage: () => {
      assertPluginCapability(entry, "account:read");
      return window.pier.accounts.refreshUsage();
    },
    remove: (accountId) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.remove(accountId);
    },
    select: (accountId) => {
      assertPluginCapability(entry, "account:write");
      return window.pier.accounts.select(accountId);
    },
    snapshot: () => {
      assertPluginCapability(entry, "account:read");
      return useAgentAccountsStore.getState().snapshot;
    },
  };
}
```

- [ ] **Step 5: 修改 `host-context.ts` — `createRendererPluginContext` 接入 accounts**

在 `src/renderer/lib/plugins/host-context.ts` 顶部 import 区追加：

```ts
import { createPluginAccountsContext } from "./host-accounts-context.ts";
```

在 `createRendererPluginContext` 函数体的返回对象内（行号以 Phase 1 完成后的现状为准），`actions` 字段之前插入：

```ts
    accounts: createPluginAccountsContext(entry, assertPluginCapability),
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm test:unit -- tests/unit/renderer/host-accounts-context.test.ts`
Expected: PASS——5 个 case 全部通过（门控拒绝 + 读路径透传 store + 写路径透传 `window.pier.accounts`）。

- [ ] **Step 7: 跑 typecheck**

Run: `pnpm typecheck`
Expected: PASS（`RendererPluginContext` 新增 `accounts` 字段后，`createRendererPluginContext` 返回对象已补齐该字段）。

---

## Task 2: manifest + locales + main 空 activate

**Files:**
- Create: `src/plugins/builtin/codex/manifest.ts`
- Create: `src/plugins/builtin/codex/main/index.ts`
- Create: `src/plugins/builtin/codex/locales/en.json`
- Create: `src/plugins/builtin/codex/locales/zh-CN.json`
- Create: `src/plugins/builtin/codex/locales/index.ts`

**Interfaces:**
- Consumes: Phase 2 的 `account:read` / `account:write` capability（`src/shared/contracts/permissions.ts`）；Phase 1 的 `dashboardWidgets` manifest 字段（`src/shared/contracts/plugin.ts`）
- Produces: `CODEX_PLUGIN_ID`、`CODEX_PLUGIN_MANIFEST`、`CODEX_PLUGIN_LOCALES`、`codexMainPlugin` — 供 Task 5/6 的 catalog 接入消费

- [ ] **Step 1: 创建 manifest**

写入 `src/plugins/builtin/codex/manifest.ts`：

```ts
import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const CODEX_PLUGIN_ID = "pier.codex";
export const CODEX_ACCOUNTS_WIDGET_ID = "pier.codex.accounts";

export const CODEX_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [
    {
      category: "Codex",
      id: "pier.codex.switchAccount",
      permissions: ["account:read", "account:write"],
      title: "Codex: Switch Account",
    },
    {
      category: "Codex",
      id: "pier.codex.addAccount",
      permissions: ["account:write"],
      title: "Codex: Add Account",
    },
    {
      category: "Codex",
      id: "pier.codex.refreshUsage",
      permissions: ["account:read"],
      title: "Codex: Refresh Usage",
    },
  ],
  configuration: {
    properties: {
      "pier.codex.confirmSwitch": {
        default: true,
        description:
          "Show a confirmation dialog before switching the active Codex account.",
        order: 10,
        type: "boolean" as const,
      },
    },
  },
  dashboardWidgets: [
    {
      defaultSize: { w: 4, h: 4 },
      description: "Manage Codex accounts and monitor usage.",
      id: CODEX_ACCOUNTS_WIDGET_ID,
      maxSize: { w: 8, h: 10 },
      minSize: { w: 3, h: 3 },
      permissions: ["account:read"],
      title: "Codex Accounts",
    },
  ],
  description: "Built-in Codex account management and dashboard widget.",
  engines: { pier: ">=0.1.0" },
  id: CODEX_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
  },
  name: "Codex",
  panels: [],
  permissions: [
    "command:register",
    "account:read",
    "account:write",
  ],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
} satisfies PluginManifest;
```

- [ ] **Step 2: 创建 main/index.ts**

写入 `src/plugins/builtin/codex/main/index.ts`：

```ts
import type { MainPluginModule } from "@plugins/api/main.ts";
import { CODEX_PLUGIN_ID } from "../manifest.ts";

export const codexMainPlugin: MainPluginModule = {
  activate: () => () => undefined,
  id: CODEX_PLUGIN_ID,
};
```

- [ ] **Step 3: 创建 locales/en.json**

写入 `src/plugins/builtin/codex/locales/en.json`：

```json
{
  "commands": {
    "pier.codex.addAccount": {
      "aliases": ["codex add", "add account", "new account"],
      "category": "Codex",
      "description": "Add a new Codex account via browser OAuth.",
      "title": "Codex: Add Account"
    },
    "pier.codex.refreshUsage": {
      "aliases": ["codex usage", "refresh usage", "check limits"],
      "category": "Codex",
      "description": "Refresh the usage data for the active Codex account.",
      "title": "Codex: Refresh Usage"
    },
    "pier.codex.switchAccount": {
      "aliases": ["codex switch", "switch account", "change account"],
      "category": "Codex",
      "description": "Select a different Codex account as active.",
      "title": "Codex: Switch Account"
    }
  },
  "dashboardWidgets": {
    "pier.codex.accounts": {
      "description": "Manage Codex accounts and monitor usage.",
      "title": "Codex Accounts"
    }
  },
  "description": "Built-in Codex account management and dashboard widget.",
  "messages": {
    "widget.accounts.adopt": "Adopt this login",
    "widget.accounts.adoptFailed": "Failed to adopt current login",
    "widget.accounts.add": "Add Account",
    "widget.accounts.addFailed": "Failed to add account",
    "widget.accounts.cancelLogin": "Cancel",
    "widget.accounts.confirmSwitch.body": "Switching accounts affects all terminals, including those outside Pier. Running Codex sessions may be disrupted.",
    "widget.accounts.confirmSwitch.title": "Switch to {{email}}?",
    "widget.accounts.driftBanner": "Current login is unmanaged. Adopt it?",
    "widget.accounts.empty": "No Codex account configured.",
    "widget.accounts.errorUsage": "Usage unavailable",
    "widget.accounts.loginDetected": "Detected login: {{email}}",
    "widget.accounts.loginPending": "Complete login in your browser…",
    "widget.accounts.notInstalled": "Codex CLI not detected",
    "widget.accounts.notInstalledHint": "Install the Codex CLI and reopen this widget.",
    "widget.accounts.refresh": "Refresh",
    "widget.accounts.remove": "Remove",
    "widget.accounts.resetsIn": "Resets {{time}}",
    "widget.accounts.session": "Session",
    "widget.accounts.switchTo": "Switch",
    "widget.accounts.switchFailed": "Failed to switch account",
    "widget.accounts.weekly": "Weekly"
  },
  "name": "Codex",
  "settings": {
    "pier.codex.confirmSwitch": {
      "description": "Show a confirmation dialog before switching the active Codex account.",
      "label": "Confirm before switching"
    }
  }
}
```

- [ ] **Step 4: 创建 locales/zh-CN.json**

写入 `src/plugins/builtin/codex/locales/zh-CN.json`：

```json
{
  "commands": {
    "pier.codex.addAccount": {
      "aliases": ["添加账号", "codex add", "tian jia zhang hao"],
      "category": "Codex",
      "description": "通过浏览器 OAuth 添加新的 Codex 账号。",
      "title": "Codex: 添加账号"
    },
    "pier.codex.refreshUsage": {
      "aliases": ["刷新用量", "codex usage", "shua xin yong liang"],
      "category": "Codex",
      "description": "刷新当前活跃 Codex 账号的用量数据。",
      "title": "Codex: 刷新用量"
    },
    "pier.codex.switchAccount": {
      "aliases": ["切换账号", "codex switch", "qie huan zhang hao"],
      "category": "Codex",
      "description": "选择另一个 Codex 账号作为活跃账号。",
      "title": "Codex: 切换账号"
    }
  },
  "dashboardWidgets": {
    "pier.codex.accounts": {
      "description": "管理 Codex 账号并监控用量。",
      "title": "Codex 账号"
    }
  },
  "description": "内置 Codex 账号管理与大盘组件。",
  "messages": {
    "widget.accounts.adopt": "接管此登录",
    "widget.accounts.adoptFailed": "接管当前登录失败",
    "widget.accounts.add": "添加账号",
    "widget.accounts.addFailed": "添加账号失败",
    "widget.accounts.cancelLogin": "取消",
    "widget.accounts.confirmSwitch.body": "切换账号将影响所有终端（包括 Pier 外部的终端），运行中的 Codex 会话可能受到影响。",
    "widget.accounts.confirmSwitch.title": "切换到 {{email}}？",
    "widget.accounts.driftBanner": "当前登录未被托管，是否接管？",
    "widget.accounts.empty": "未配置 Codex 账号。",
    "widget.accounts.errorUsage": "用量不可用",
    "widget.accounts.loginDetected": "检测到登录：{{email}}",
    "widget.accounts.loginPending": "请在浏览器中完成登录…",
    "widget.accounts.notInstalled": "未检测到 Codex CLI",
    "widget.accounts.notInstalledHint": "安装 Codex CLI 后重新打开此组件。",
    "widget.accounts.refresh": "刷新",
    "widget.accounts.remove": "移除",
    "widget.accounts.resetsIn": "{{time}}后重置",
    "widget.accounts.session": "会话",
    "widget.accounts.switchTo": "切换",
    "widget.accounts.switchFailed": "切换账号失败",
    "widget.accounts.weekly": "每周"
  },
  "name": "Codex",
  "settings": {
    "pier.codex.confirmSwitch": {
      "description": "切换活跃 Codex 账号前是否弹出确认对话框。",
      "label": "切换前确认"
    }
  }
}
```

- [ ] **Step 5: 创建 locales/index.ts**

写入 `src/plugins/builtin/codex/locales/index.ts`：

```ts
import type { PluginLocaleMessages } from "@shared/contracts/plugin.ts";
import en from "./en.json" with { type: "json" };
import zhCN from "./zh-CN.json" with { type: "json" };

export const CODEX_PLUGIN_LOCALES = {
  en,
  "zh-CN": zhCN,
} satisfies Record<string, PluginLocaleMessages>;
```

- [ ] **Step 6: 跑 typecheck**

Run: `pnpm typecheck`
Expected: PASS（新文件均为独立模块，不影响既有代码）。

---

## Task 3: accounts-widget 状态机

**Files:**
- Create: `src/plugins/builtin/codex/renderer/accounts-widget.tsx`
- Create: `tests/component/codex-accounts-widget.test.tsx`

**Interfaces:**
- Consumes: `RendererPluginContext["accounts"]`（Task 1）、`RendererPluginContext["agents"]`（`context.agents.selection()` 读 `detectedIds`，判定 codex CLI 是否安装）、`DashboardWidgetComponentProps`（Phase 1）、`AgentAccountsSnapshot` / `AccountUsage`（Phase 2 契约）、`context.i18n.t`
- Produces: `createAccountsWidget(context: RendererPluginContext): FunctionComponent<DashboardWidgetComponentProps>` — 供 Task 5 的 activate 组装

- [ ] **Step 1: 创建 widget 组件**

写入 `src/plugins/builtin/codex/renderer/accounts-widget.tsx`：

```tsx
import type {
  DashboardWidgetComponentProps,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  AccountUsage,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
import type { AgentAccount } from "@shared/contracts/agent-accounts.ts";
import { useCallback, useEffect, useState } from "react";

function UsageBar({
  error,
  label,
  usage,
}: {
  error?: string;
  label: string;
  usage?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
}): React.ReactElement {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}:</span>
        <span className="text-destructive">{error}</span>
      </div>
    );
  }
  if (!usage) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}:</span>
        <span>—</span>
      </div>
    );
  }
  const percent = Math.round(usage.usedPercent * 100);
  const barColor =
    percent >= 90
      ? "bg-destructive"
      : percent >= 70
        ? "bg-warning"
        : "bg-primary";

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          data-testid={`usage-bar-${label.toLowerCase()}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {usage.resetsAt != null && (
        <div className="text-[10px] text-muted-foreground">
          {formatResetTime(usage.resetsAt)}
        </div>
      )}
    </div>
  );
}

function formatResetTime(resetsAt: number): string {
  const diff = resetsAt - Date.now();
  if (diff <= 0) return "Resets soon";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

interface AccountRowProps {
  account: AgentAccount;
  isActive: boolean;
  onSwitch: (accountId: string) => void;
  usage?: AccountUsage;
}

function AccountRow({
  account,
  isActive,
  onSwitch,
  usage,
}: AccountRowProps): React.ReactElement {
  return (
    <div
      className={`flex flex-col gap-1 rounded-md border p-2 ${
        isActive ? "border-primary bg-primary/5" : "border-border"
      }`}
      data-testid={`account-row-${account.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{account.email}</span>
          {account.planType && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {account.planType}
            </span>
          )}
          {isActive && (
            <span
              className="size-2 rounded-full bg-primary"
              data-testid="active-indicator"
            />
          )}
        </div>
        {!isActive && (
          <button
            className="text-xs text-primary hover:underline"
            data-testid={`switch-btn-${account.id}`}
            onClick={() => onSwitch(account.id)}
            type="button"
          >
            Switch
          </button>
        )}
      </div>
      {usage && (
        <div className="flex flex-col gap-1 pl-1">
          <UsageBar
            error={usage.status === "error" ? usage.error : undefined}
            label="Session"
            usage={usage.session}
          />
          <UsageBar
            error={usage.status === "error" ? usage.error : undefined}
            label="Weekly"
            usage={usage.weekly}
          />
        </div>
      )}
    </div>
  );
}

export function createAccountsWidget(
  context: RendererPluginContext
): React.FunctionComponent<DashboardWidgetComponentProps> {
  return function AccountsWidget(_props: DashboardWidgetComponentProps) {
    const [snapshot, setSnapshot] = useState<AgentAccountsSnapshot>(
      context.accounts.snapshot()
    );
    // 未安装态探测：默认 true 避免异步返回前闪烁未安装提示
    const [codexDetected, setCodexDetected] = useState(true);

    useEffect(() => {
      // 初始拉取确保最新
      setSnapshot(context.accounts.snapshot());
      return context.accounts.onDidChange(setSnapshot);
    }, []);

    useEffect(() => {
      let cancelled = false;
      context.agents.selection().then((sel) => {
        if (!cancelled) {
          setCodexDetected(sel.detectedIds.includes("codex"));
        }
      });
      return () => {
        cancelled = true;
      };
    }, []);

    const handleSwitch = useCallback(
      async (accountId: string) => {
        const confirmEnabled = context.configuration.get<boolean>(
          "pier.codex.confirmSwitch"
        );
        if (confirmEnabled) {
          const target = snapshot.accounts.find((a) => a.id === accountId);
          const confirmed = await context.dialogs.confirm({
            body: context.i18n.t(
              "widget.accounts.confirmSwitch.body",
              undefined,
              "Switching accounts affects all terminals, including those outside Pier. Running Codex sessions may be disrupted."
            ),
            title: context.i18n.t(
              "widget.accounts.confirmSwitch.title",
              { email: target?.email ?? accountId },
              `Switch to ${target?.email ?? accountId}?`
            ),
          });
          if (!confirmed) return;
        }
        try {
          await context.accounts.select(accountId);
        } catch (err) {
          context.notifications.error(
            context.i18n.t(
              "widget.accounts.switchFailed",
              undefined,
              "Failed to switch account"
            ),
            { description: String(err) }
          );
        }
      },
      [snapshot.accounts]
    );

    const handleAdopt = useCallback(async () => {
      try {
        await context.accounts.adoptCurrent();
      } catch (err) {
        context.notifications.error(
          context.i18n.t(
            "widget.accounts.adoptFailed",
            undefined,
            "Failed to adopt current login"
          ),
          { description: String(err) }
        );
      }
    }, []);

    const handleAdd = useCallback(async () => {
      const loading = context.notifications.loading(
        context.i18n.t(
          "widget.accounts.loginPending",
          undefined,
          "Complete login in your browser…"
        )
      );
      try {
        await context.accounts.add("codex");
        loading.success("Account added");
      } catch (err) {
        loading.dismiss();
        context.notifications.error(
          context.i18n.t(
            "widget.accounts.addFailed",
            undefined,
            "Failed to add account"
          ),
          { description: String(err) }
        );
      }
    }, []);

    const handleCancelLogin = useCallback(async () => {
      await context.accounts.cancelLogin("codex");
    }, []);

    const handleRefresh = useCallback(async () => {
      await context.accounts.refreshUsage();
    }, []);

    // 未安装态：宿主未探测到 codex CLI
    if (!codexDetected) {
      return (
        <div className="flex flex-col items-center gap-3 p-4" data-testid="state-not-installed">
          <p className="text-sm font-medium text-muted-foreground">
            {context.i18n.t(
              "widget.accounts.notInstalled",
              undefined,
              "Codex CLI not detected"
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {context.i18n.t(
              "widget.accounts.notInstalledHint",
              undefined,
              "Install the Codex CLI and reopen this widget."
            )}
          </p>
        </div>
      );
    }

    // 未接管态：没有托管账号
    if (snapshot.accounts.length === 0) {
      if (snapshot.unmanagedActiveLogin) {
        // 检测到未托管登录
        const detectedEmail = "—";
        return (
          <div className="flex flex-col items-center gap-3 p-4" data-testid="state-unmanaged-empty">
            <p className="text-sm text-muted-foreground">
              {context.i18n.t(
                "widget.accounts.loginDetected",
                { email: detectedEmail },
                `Detected login: ${detectedEmail}`
              )}
            </p>
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              data-testid="adopt-btn"
              onClick={handleAdopt}
              type="button"
            >
              {context.i18n.t("widget.accounts.adopt", undefined, "Adopt this login")}
            </button>
          </div>
        );
      }
      // 无登录 → 添加引导
      return (
        <div className="flex flex-col items-center gap-3 p-4" data-testid="state-empty">
          {snapshot.loginPending ? (
            <>
              <p className="text-sm text-muted-foreground">
                {context.i18n.t(
                  "widget.accounts.loginPending",
                  undefined,
                  "Complete login in your browser…"
                )}
              </p>
              <button
                className="text-xs text-muted-foreground hover:underline"
                data-testid="cancel-login-btn"
                onClick={handleCancelLogin}
                type="button"
              >
                {context.i18n.t("widget.accounts.cancelLogin", undefined, "Cancel")}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {context.i18n.t(
                  "widget.accounts.empty",
                  undefined,
                  "No Codex account configured."
                )}
              </p>
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                data-testid="add-btn"
                onClick={handleAdd}
                type="button"
              >
                {context.i18n.t("widget.accounts.add", undefined, "Add Account")}
              </button>
            </>
          )}
        </div>
      );
    }

    // 正常态：有托管账号
    return (
      <div className="flex flex-col gap-2 p-2" data-testid="state-normal">
        {snapshot.unmanagedActiveLogin && snapshot.accounts.length > 0 && (
          <div
            className="flex items-center justify-between rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning"
            data-testid="drift-banner"
          >
            <span>
              {context.i18n.t(
                "widget.accounts.driftBanner",
                undefined,
                "Current login is unmanaged. Adopt it?"
              )}
            </span>
            <button
              className="text-xs font-medium text-warning hover:underline"
              data-testid="drift-adopt-btn"
              onClick={handleAdopt}
              type="button"
            >
              {context.i18n.t("widget.accounts.adopt", undefined, "Adopt this login")}
            </button>
          </div>
        )}
        {snapshot.loginPending && (
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-xs">
            <span>
              {context.i18n.t(
                "widget.accounts.loginPending",
                undefined,
                "Complete login in your browser…"
              )}
            </span>
            <button
              className="text-xs text-muted-foreground hover:underline"
              data-testid="cancel-login-btn"
              onClick={handleCancelLogin}
              type="button"
            >
              {context.i18n.t("widget.accounts.cancelLogin", undefined, "Cancel")}
            </button>
          </div>
        )}
        {snapshot.accounts.map((account) => (
          <AccountRow
            account={account}
            isActive={account.id === snapshot.activeAccountId}
            key={account.id}
            onSwitch={handleSwitch}
            usage={snapshot.usage[account.id]}
          />
        ))}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            className="text-xs text-muted-foreground hover:underline"
            data-testid="refresh-btn"
            onClick={handleRefresh}
            type="button"
          >
            {context.i18n.t("widget.accounts.refresh", undefined, "Refresh")}
          </button>
          <button
            className="text-xs text-primary hover:underline"
            data-testid="add-more-btn"
            onClick={handleAdd}
            type="button"
          >
            {context.i18n.t("widget.accounts.add", undefined, "Add Account")}
          </button>
        </div>
      </div>
    );
  };
}
```

- [ ] **Step 2: 创建组件测试（五态）**

写入 `tests/component/codex-accounts-widget.test.tsx`：

```tsx
import type {
  DashboardWidgetComponentProps,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAccountsWidget } from "@plugins/builtin/codex/renderer/accounts-widget.tsx";

function makeSnapshot(
  overrides: Partial<AgentAccountsSnapshot> = {}
): AgentAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    loginPending: null,
    ts: 1,
    unmanagedActiveLogin: false,
    usage: {},
    ...overrides,
  };
}

function makeContext(
  snapshot: AgentAccountsSnapshot,
  overrides: Partial<{
    add: ReturnType<typeof vi.fn>;
    adoptCurrent: ReturnType<typeof vi.fn>;
    cancelLogin: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    configGet: ReturnType<typeof vi.fn>;
    refreshUsage: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    selection: ReturnType<typeof vi.fn>;
  }> = {}
): RendererPluginContext {
  let changeCallback: ((s: AgentAccountsSnapshot) => void) | null = null;
  return {
    accounts: {
      add: overrides.add ?? vi.fn().mockResolvedValue(undefined),
      adoptCurrent:
        overrides.adoptCurrent ?? vi.fn().mockResolvedValue(undefined),
      cancelLogin:
        overrides.cancelLogin ?? vi.fn().mockResolvedValue(undefined),
      onDidChange: (cb: (s: AgentAccountsSnapshot) => void) => {
        changeCallback = cb;
        return () => {
          changeCallback = null;
        };
      },
      refreshUsage:
        overrides.refreshUsage ?? vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      select: overrides.select ?? vi.fn().mockResolvedValue(undefined),
      snapshot: () => snapshot,
    },
    agents: {
      selection: overrides.selection ?? vi.fn().mockResolvedValue({
        detectedIds: ["codex"],
        enabledIds: ["codex"],
        selectedId: null,
      }),
    },
    configuration: {
      get: overrides.configGet ?? vi.fn(() => true),
      onDidChange: vi.fn(() => vi.fn()),
      reset: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      alert: vi.fn().mockResolvedValue(undefined),
      confirm: overrides.confirm ?? vi.fn().mockResolvedValue(true),
    },
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_id: string, fallback?: string) => fallback ?? _id),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? _key
      ),
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => ({
        dismiss: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      })),
      success: vi.fn(),
      system: vi.fn().mockResolvedValue({ shown: false }),
    },
  } as unknown as RendererPluginContext;
}

const widgetProps: DashboardWidgetComponentProps = { size: { h: 4, w: 4 } };

describe("AccountsWidget", () => {
  it("态一：未接管态——无账号无登录显示空引导", () => {
    const snap = makeSnapshot();
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(screen.getByTestId("state-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No Codex account configured.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("add-btn")).toBeInTheDocument();
  });

  it("态一变体：未接管态——检测到未托管登录显示接管按钮", () => {
    const snap = makeSnapshot({ unmanagedActiveLogin: true });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(screen.getByTestId("state-unmanaged-empty")).toBeInTheDocument();
    expect(screen.getByTestId("adopt-btn")).toBeInTheDocument();
  });

  it("态二：正常态——账号列表、active 高亮、用量双条", () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          planType: "plus",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
      usage: {
        "acc-1": {
          accountId: "acc-1",
          fetchedAt: Date.now(),
          session: { usedPercent: 0.45, resetsAt: Date.now() + 3_600_000 },
          status: "ok",
          weekly: { usedPercent: 0.72 },
        },
      },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("active-indicator")).toBeInTheDocument();
    // acc-2 无 active 指示器但有切换按钮
    expect(screen.getByTestId("switch-btn-acc-2")).toBeInTheDocument();
    // 用量条
    expect(screen.getByTestId("usage-bar-session")).toBeInTheDocument();
    expect(screen.getByTestId("usage-bar-weekly")).toBeInTheDocument();
  });

  it("态三：漂移横幅——有账号但检测到未托管登录", () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
      ],
      activeAccountId: "acc-1",
      unmanagedActiveLogin: true,
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(screen.getByTestId("drift-banner")).toBeInTheDocument();
    expect(screen.getByTestId("drift-adopt-btn")).toBeInTheDocument();
  });

  it("态四：loginPending 显示等待与取消按钮", () => {
    const snap = makeSnapshot({ loginPending: "codex" });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(
      screen.getByText("Complete login in your browser…")
    ).toBeInTheDocument();
    expect(screen.getByTestId("cancel-login-btn")).toBeInTheDocument();
  });

  it("切换账号走 confirm 链——确认后调 select", async () => {
    const selectMock = vi.fn().mockResolvedValue(undefined);
    const confirmMock = vi.fn().mockResolvedValue(true);
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
    });
    const ctx = makeContext(snap, {
      confirm: confirmMock,
      select: selectMock,
    });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("switch-btn-acc-2"));
    });

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled();
      expect(selectMock).toHaveBeenCalledWith("acc-2");
    });
  });

  it("切换账号 confirm 取消时不调 select", async () => {
    const selectMock = vi.fn().mockResolvedValue(undefined);
    const confirmMock = vi.fn().mockResolvedValue(false);
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
    });
    const ctx = makeContext(snap, {
      confirm: confirmMock,
      select: selectMock,
    });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("switch-btn-acc-2"));
    });

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalled();
    });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("用量错误态不崩溃", () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
      ],
      activeAccountId: "acc-1",
      usage: {
        "acc-1": {
          accountId: "acc-1",
          error: "Network error",
          fetchedAt: Date.now(),
          status: "error",
        },
      },
    });
    const ctx = makeContext(snap);
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(screen.getByTestId("state-normal")).toBeInTheDocument();
    // 错误态不崩溃
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("未安装态——detectedIds 不含 codex 时显示安装指引", async () => {
    const snap = makeSnapshot();
    const ctx = makeContext(snap, {
      selection: vi.fn().mockResolvedValue({
        detectedIds: [],
        enabledIds: [],
        selectedId: null,
      }),
    });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    expect(
      await screen.findByTestId("state-not-installed")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Codex CLI not detected")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("add-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-more-btn")).not.toBeInTheDocument();
  });

  it("handleSwitch select 失败时调 notifications.error", async () => {
    const selectMock = vi.fn().mockRejectedValue(new Error("network error"));
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
    });
    const ctx = makeContext(snap, { select: selectMock });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("switch-btn-acc-2"));
    });

    await waitFor(() => {
      expect(ctx.notifications.error).toHaveBeenCalled();
    });
  });

  it("handleAdopt 失败时调 notifications.error", async () => {
    const adoptMock = vi.fn().mockRejectedValue(new Error("adopt failed"));
    const snap = makeSnapshot({ unmanagedActiveLogin: true });
    const ctx = makeContext(snap, { adoptCurrent: adoptMock });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("adopt-btn"));
    });

    await waitFor(() => {
      expect(ctx.notifications.error).toHaveBeenCalled();
    });
  });

  it("handleAdd 失败时调 notifications.error", async () => {
    const addMock = vi.fn().mockRejectedValue(new Error("oauth failed"));
    const snap = makeSnapshot();
    const ctx = makeContext(snap, { add: addMock });
    const Widget = createAccountsWidget(ctx);

    render(<Widget {...widgetProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-btn"));
    });

    await waitFor(() => {
      expect(ctx.notifications.error).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: 跑组件测试**

Run: `pnpm test:component -- tests/component/codex-accounts-widget.test.tsx`
Expected: PASS——全部 11 个 case 通过。

---

## Task 4: account-actions 命令处理器

**Files:**
- Create: `src/plugins/builtin/codex/renderer/account-actions.ts`
- Create: `tests/unit/renderer/codex-account-actions.test.ts`

**Interfaces:**
- Consumes: `RendererPluginContext`（`accounts` / `commandPalette.openQuickPick` / `configuration` / `dialogs` / `notifications` / `i18n`）
- Produces: `registerCodexActions(context: RendererPluginContext): () => void` — 供 Task 5 的 activate 消费

- [ ] **Step 1: 写失败测试**

写入 `tests/unit/renderer/codex-account-actions.test.ts`：

```ts
import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginQuickPick,
} from "@plugins/api/renderer.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { describe, expect, it, vi } from "vitest";

// 将在 Step 3 实现后导入
import { registerCodexActions } from "@plugins/builtin/codex/renderer/account-actions.ts";

function makeSnapshot(
  overrides: Partial<AgentAccountsSnapshot> = {}
): AgentAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    loginPending: null,
    ts: 1,
    unmanagedActiveLogin: false,
    usage: {},
    ...overrides,
  };
}

function makeContext(
  snapshot: AgentAccountsSnapshot,
  overrides: Record<string, unknown> = {}
): {
  context: RendererPluginContext;
  mocks: {
    add: ReturnType<typeof vi.fn>;
    openQuickPick: ReturnType<typeof vi.fn>;
    refreshUsage: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
} {
  const register = vi.fn(() => vi.fn());
  const openQuickPick = vi.fn();
  const select = vi.fn().mockResolvedValue(undefined);
  const add = vi.fn().mockResolvedValue(undefined);
  const refreshUsage = vi.fn().mockResolvedValue(undefined);

  const context = {
    accounts: {
      add,
      adoptCurrent: vi.fn().mockResolvedValue(undefined),
      cancelLogin: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(() => vi.fn()),
      refreshUsage,
      remove: vi.fn().mockResolvedValue(undefined),
      select,
      snapshot: () => snapshot,
    },
    actions: { register },
    commandPalette: { openQuickPick },
    configuration: {
      get: vi.fn(() => overrides.confirmSwitch ?? true),
      onDidChange: vi.fn(() => vi.fn()),
      reset: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
    dialogs: {
      alert: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue(overrides.confirmResult ?? true),
    },
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_id: string, fallback?: string) => fallback ?? _id),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? _key
      ),
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => ({
        dismiss: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      })),
      success: vi.fn(),
      system: vi.fn().mockResolvedValue({ shown: false }),
    },
  } as unknown as RendererPluginContext;

  return { context, mocks: { add, openQuickPick, refreshUsage, register, select } };
}

describe("registerCodexActions", () => {
  it("注册三个 action，且形状满足 RendererPluginAction 契约", () => {
    const snap = makeSnapshot();
    const { context, mocks } = makeContext(snap);

    const dispose = registerCodexActions(context);

    expect(mocks.register).toHaveBeenCalledTimes(3);
    const actions = mocks.register.mock.calls.map(
      ([action]: [RendererPluginAction]) => action
    );
    const ids = actions.map((action) => action.id);
    expect(ids).toContain("pier.codex.switchAccount");
    expect(ids).toContain("pier.codex.addAccount");
    expect(ids).toContain("pier.codex.refreshUsage");

    // 契约形状：handler/title 是函数、category 非空、命令面板可见。
    // register 被 mock，这里的断言就是防"字段名写错但测试全绿"的唯一防线。
    for (const action of actions) {
      expect(typeof action.handler).toBe("function");
      expect(typeof action.title).toBe("function");
      expect(action.category).toBe("Codex");
      expect(action.surfaces).toContain("command-palette");
      expect(action.metadata?.categoryKey).toBe("settings");
    }

    expect(typeof dispose).toBe("function");
  });

  it("switchAccount handler 打开 quickPick；onAccept 经 confirm 后调 select", async () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          planType: "plus",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context, mocks } = makeContext(snap);

    registerCodexActions(context);

    const switchCall = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.switchAccount"
    );
    expect(switchCall).toBeDefined();

    const switchAction = switchCall![0] as RendererPluginAction;
    await switchAction.handler();

    expect(mocks.openQuickPick).toHaveBeenCalledTimes(1);
    const quickPick = mocks.openQuickPick.mock
      .calls[0]![0] as RendererPluginQuickPick;
    expect(quickPick.title).toBeTruthy();
    expect(quickPick.items?.length).toBe(2);

    // onAccept 收到的是 item 对象（非 id 字符串）；confirm mock 返回 true。
    await quickPick.onAccept({ id: "acc-2", label: "bob@example.com" });
    expect(mocks.select).toHaveBeenCalledWith("acc-2");
  });

  it("onAccept 选中当前 active 账号时不触发 select", async () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context, mocks } = makeContext(snap);

    registerCodexActions(context);

    const switchAction = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.switchAccount"
    )![0] as RendererPluginAction;
    await switchAction.handler();

    const quickPick = mocks.openQuickPick.mock
      .calls[0]![0] as RendererPluginQuickPick;
    await quickPick.onAccept({ id: "acc-1", label: "alice@example.com" });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("addAccount handler 调 accounts.add", async () => {
    const snap = makeSnapshot();
    const { context, mocks } = makeContext(snap);

    registerCodexActions(context);

    const addAction = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.addAccount"
    )![0] as RendererPluginAction;
    await addAction.handler();

    expect(mocks.add).toHaveBeenCalledWith("codex");
  });

  it("refreshUsage handler 调 accounts.refreshUsage", async () => {
    const snap = makeSnapshot();
    const { context, mocks } = makeContext(snap);

    registerCodexActions(context);

    const refreshAction = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.refreshUsage"
    )![0] as RendererPluginAction;
    await refreshAction.handler();

    expect(mocks.refreshUsage).toHaveBeenCalled();
  });

  it("switchAccount onAccept select 失败时调 notifications.error", async () => {
    const snap = makeSnapshot({
      accounts: [
        {
          createdAt: 1,
          email: "alice@example.com",
          id: "acc-1",
          provider: "codex",
          updatedAt: 1,
        },
        {
          createdAt: 2,
          email: "bob@example.com",
          id: "acc-2",
          provider: "codex",
          updatedAt: 2,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context, mocks } = makeContext(snap);
    mocks.select.mockRejectedValue(new Error("network error"));

    registerCodexActions(context);

    const switchAction = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.switchAccount"
    )![0] as RendererPluginAction;
    await switchAction.handler();

    const quickPick = mocks.openQuickPick.mock
      .calls[0]![0] as RendererPluginQuickPick;
    await quickPick.onAccept({ id: "acc-2", label: "bob@example.com" });

    expect(context.notifications.error).toHaveBeenCalled();
  });

  it("addAccount handler 失败时 dismiss loading 并调 notifications.error", async () => {
    const snap = makeSnapshot();
    const { context, mocks } = makeContext(snap);
    mocks.add.mockRejectedValue(new Error("oauth failed"));

    registerCodexActions(context);

    const addAction = mocks.register.mock.calls.find(
      ([action]: [RendererPluginAction]) =>
        action.id === "pier.codex.addAccount"
    )![0] as RendererPluginAction;
    await addAction.handler();

    expect(context.notifications.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/codex-account-actions.test.ts`
Expected: FAIL——模块 `@plugins/builtin/codex/renderer/account-actions.ts` 不存在。

- [ ] **Step 3: 创建 account-actions.ts**

写入 `src/plugins/builtin/codex/renderer/account-actions.ts`：

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";

/**
 * 三个命令面板 action。注册形状对齐 git 插件先例
 * （git-stash-actions.ts:registerStashAction）：
 * category/handler/title thunk/surfaces/metadata.categoryKey。
 * title 用 context.i18n.commandTitle 解析 manifest.commands 本地化。
 */
export function registerCodexActions(
  context: RendererPluginContext
): () => void {
  const disposeSwitchAccount = context.actions.register({
    category: "Codex",
    enabled: () => context.accounts.snapshot().accounts.length > 0,
    handler: () => {
      const snap = context.accounts.snapshot();
      const items = snap.accounts.map((account) => ({
        description: account.planType ?? undefined,
        id: account.id,
        label:
          account.id === snap.activeAccountId
            ? `● ${account.email}`
            : account.email,
      }));

      context.commandPalette.openQuickPick({
        items,
        onAccept: async (item) => {
          if (item.id === snap.activeAccountId) {
            return;
          }

          const confirmEnabled = context.configuration.get<boolean>(
            "pier.codex.confirmSwitch"
          );
          if (confirmEnabled) {
            const target = snap.accounts.find((a) => a.id === item.id);
            const confirmed = await context.dialogs.confirm({
              body: context.i18n.t(
                "widget.accounts.confirmSwitch.body",
                undefined,
                "Switching accounts affects all terminals, including those outside Pier. Running Codex sessions may be disrupted."
              ),
              title: context.i18n.t(
                "widget.accounts.confirmSwitch.title",
                { email: target?.email ?? item.id },
                `Switch to ${target?.email ?? item.id}?`
              ),
            });
            if (!confirmed) {
              return;
            }
          }

          try {
            await context.accounts.select(item.id);
          } catch (err) {
            context.notifications.error(
              context.i18n.t(
                "widget.accounts.switchFailed",
                undefined,
                "Failed to switch account"
              ),
              { description: String(err) }
            );
          }
        },
        placeholder: context.i18n.t(
          "widget.accounts.switchTo",
          undefined,
          "Select an account…"
        ),
        title: context.i18n.commandTitle(
          "pier.codex.switchAccount",
          "Codex: Switch Account"
        ),
      });
    },
    id: "pier.codex.switchAccount",
    metadata: {
      categoryKey: "settings",
      sortOrder: 10,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle(
        "pier.codex.switchAccount",
        "Codex: Switch Account"
      ),
  });

  const disposeAddAccount = context.actions.register({
    category: "Codex",
    handler: async () => {
      const loading = context.notifications.loading(
        context.i18n.t(
          "widget.accounts.loginPending",
          undefined,
          "Complete login in your browser…"
        )
      );
      try {
        await context.accounts.add("codex");
        loading.success(
          context.i18n.t(
            "widget.accounts.addSuccess",
            undefined,
            "Account added"
          )
        );
      } catch (err) {
        loading.dismiss();
        context.notifications.error(
          context.i18n.t(
            "widget.accounts.addFailed",
            undefined,
            "Failed to add account"
          ),
          { description: String(err) }
        );
      }
    },
    id: "pier.codex.addAccount",
    metadata: {
      categoryKey: "settings",
      sortOrder: 11,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.codex.addAccount", "Codex: Add Account"),
  });

  const disposeRefreshUsage = context.actions.register({
    category: "Codex",
    handler: async () => {
      await context.accounts.refreshUsage();
    },
    id: "pier.codex.refreshUsage",
    metadata: {
      categoryKey: "settings",
      sortOrder: 12,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle(
        "pier.codex.refreshUsage",
        "Codex: Refresh Usage"
      ),
  });

  return () => {
    disposeSwitchAccount();
    disposeAddAccount();
    disposeRefreshUsage();
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test:unit -- tests/unit/renderer/codex-account-actions.test.ts`
Expected: PASS——7 个 case 全部通过（含契约形状断言、active 账号不触发 select、select 失败 → error、add 失败 → error）。

---

## Task 5: renderer/index.tsx activate 组装 + builtin-catalog 接入

**Files:**
- Create: `src/plugins/builtin/codex/renderer/index.tsx`
- Modify: `src/renderer/lib/plugins/builtin-catalog.ts`（L1-8）
- Modify: `src/main/plugins/builtin-catalog.ts`（L1-56）

**Interfaces:**
- Consumes: `createAccountsWidget`（Task 3）、`registerCodexActions`（Task 4）、`CODEX_PLUGIN_ID` / `CODEX_ACCOUNTS_WIDGET_ID`（Task 2）、Phase 1 的 `RendererDashboardWidgetRegistration`
- Produces: `codexRendererPlugin: RendererPluginModule` — 接入 builtin-catalog 后宿主自动发现并激活

- [ ] **Step 1: 创建 renderer/index.tsx**

写入 `src/plugins/builtin/codex/renderer/index.tsx`：

```tsx
import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { KeyRound } from "lucide-react";
import { CODEX_ACCOUNTS_WIDGET_ID, CODEX_PLUGIN_ID } from "../manifest.ts";
import { registerCodexActions } from "./account-actions.ts";
import { createAccountsWidget } from "./accounts-widget.tsx";

function registerCodexPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerCodexActions(context),
    context.dashboardWidgets.register({
      component: createAccountsWidget(context),
      icon: KeyRound,
      id: CODEX_ACCOUNTS_WIDGET_ID,
      title: () =>
        context.i18n.t(
          "dashboardWidgets.pier.codex.accounts.title",
          undefined,
          "Codex Accounts"
        ),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export const codexRendererPlugin: RendererPluginModule = {
  activate: (context) => registerCodexPluginContributions(context),
  icon: KeyRound,
  id: CODEX_PLUGIN_ID,
};
```

- [ ] **Step 2: 修改 renderer builtin-catalog**

打开 `src/renderer/lib/plugins/builtin-catalog.ts`（当前 L1-14）。

在 import 区追加：

```ts
import { codexRendererPlugin } from "@plugins/builtin/codex/renderer/index.tsx";
```

将 `BUILTIN_RENDERER_PLUGIN_MODULES` 数组（L5-8）修改为：

```ts
export const BUILTIN_RENDERER_PLUGIN_MODULES = [
  gitRendererPlugin,
  filesRendererPlugin,
  codexRendererPlugin,
] satisfies readonly RendererPluginModule[];
```

- [ ] **Step 3: 修改 main builtin-catalog**

打开 `src/main/plugins/builtin-catalog.ts`（当前 L1-56）。

在 import 区追加三行：

```ts
import { CODEX_PLUGIN_LOCALES } from "@plugins/builtin/codex/locales/index.ts";
import { codexMainPlugin } from "@plugins/builtin/codex/main/index.ts";
import { CODEX_PLUGIN_MANIFEST } from "@plugins/builtin/codex/manifest.ts";
```

修改 `pluginPackageBaseDir` 函数签名（L21）——将参数类型从 `"files" | "git"` 扩展为 `"codex" | "files" | "git"`，并在 `urlByPlugin` 对象内追加 `codex` 条目：

```ts
function pluginPackageBaseDir(pluginId: "codex" | "files" | "git"): string {
  const urlByPlugin = {
    codex: new URL("../../plugins/builtin/codex/", import.meta.url),
    files: new URL("../../plugins/builtin/files/", import.meta.url),
    git: new URL("../../plugins/builtin/git/", import.meta.url),
  } satisfies Record<typeof pluginId, URL>;
  const url = urlByPlugin[pluginId];
  if (url.protocol === "file:") {
    return fileURLToPath(url);
  }
  return resolve(process.cwd(), `src/plugins/builtin/${pluginId}`);
}
```

在 `BUILTIN_PLUGIN_SOURCES` 数组（L33-52）的末尾（`files` 条目之后）追加 `codex` 条目：

```ts
  {
    baseDir: pluginPackageBaseDir("codex"),
    defaultEnabled: true,
    id: CODEX_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: CODEX_PLUGIN_LOCALES,
    main: codexMainPlugin,
    manifest: CODEX_PLUGIN_MANIFEST,
  },
```

- [ ] **Step 4: 跑 typecheck**

Run: `pnpm typecheck`
Expected: PASS——codex 插件完整接入编译链，所有类型一致。

---

## Task 6: e2e 测试——大盘组装持久化

**Files:**
- Create: `tests/e2e/dashboard-widget-persistence.spec.ts`

**Interfaces:**
- Consumes: Phase 1 的大盘 panel kit（`pier.panel.newDashboard` action、`dashboard` component）、core widget `core.activity-overview`、dockview layout 持久化链路
- Produces: e2e 验证——新建大盘 → 添加 core activity widget → 重启后布局与组装恢复

- [ ] **Step 1: 创建 e2e spec**

写入 `tests/e2e/dashboard-widget-persistence.spec.ts`：

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

async function launchPierApp(userDataDir: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
}

/**
 * 等 workspace 完成异步布局恢复并挂出终端面板（对齐 command-palette.spec.ts
 * 的 waitForAppShellReady：domcontentloaded 太早，此时全局 keydown 监听
 * 尚未注册，CDP 按键会被丢掉）。
 */
async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

/** 经命令面板执行"新建大盘"（renderer action 无 preload 直调通道，命令面板是标准入口）。 */
async function openDashboardViaPalette(win: Page): Promise<void> {
  await win.keyboard.press("Meta+Shift+KeyP");
  await expect(win.locator("[cmdk-input]")).toBeVisible({ timeout: 10_000 });
  const item = win.locator("[cmdk-item]").filter({ hasText: "新建大盘" });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

test.describe("Dashboard widget persistence e2e", () => {
  test("新建大盘 → 添加 core activity widget → 重启 → 组装恢复", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-dashboard-e2e-"));
    try {
      // 第一次启动：新建大盘 + 添加 widget
      const firstApp = await launchPierApp(userDataDir);
      const firstWindow = await firstApp.firstWindow();
      await waitForAppShellReady(firstWindow);

      await openDashboardViaPalette(firstWindow);

      // 空态大盘出现（Phase 1 dashboard-panel.tsx 的空态 testid）
      await firstWindow.waitForSelector('[data-testid="dashboard-empty"]', {
        timeout: 5_000,
      });

      // 点击"添加组件"，选择 core.activity-overview
      await firstWindow
        .locator('[data-testid="dashboard-add-widget"]')
        .click();
      await firstWindow
        .locator(
          '[data-testid="dashboard-widget-picker-item-core.activity-overview"]'
        )
        .click();

      // 验证 widget 卡片出现
      await firstWindow.waitForSelector(
        '[data-testid="dashboard-widget-core.activity-overview"]',
        { timeout: 5_000 }
      );

      // 关闭第一个 app 实例。布局保存有 500ms debounce，但 workspace-host
      // 的 beforeunload flush 会在关闭前立即补发 save（见 workspace-host.tsx）。
      await firstApp.close();

      // 第二次启动：验证恢复
      const restoredApp = await launchPierApp(userDataDir);
      try {
        const restoredWindow = await restoredApp.firstWindow();
        // 恢复的布局里大盘是活跃 tab，终端在后台 tab（dockview 不挂后台
        // 面板内容，.terminal-anchor 恒为 0）——不能用 waitForAppShellReady，
        // 直接等恢复目标本身。
        await restoredWindow.waitForLoadState("domcontentloaded");
        const widgetCard = restoredWindow.locator(
          '[data-testid="dashboard-widget-core.activity-overview"]'
        );
        await expect(widgetCard).toBeVisible({ timeout: 15_000 });
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 验证 e2e 测试文件格式**

Run: `pnpm typecheck`
Expected: PASS（e2e spec 类型无误）。

注意：实际执行 e2e 需先 `pnpm build`。

Run: `pnpm test:e2e -- tests/e2e/dashboard-widget-persistence.spec.ts`
Expected: PASS——大盘创建、widget 添加、重启恢复全链路通过。

---

## Task 7: AGENTS.md 架构段落更新 + 收尾验证

**Files:**
- Modify: `AGENTS.md`（§03 架构边界，追加两个新段落）

**Interfaces:** 无

- [ ] **Step 1: 在 AGENTS.md §03 架构边界末尾追加两个段落**

打开 `AGENTS.md`。在 §03 架构边界节的最后一个段落（当前为"路径锚点上下文"段，末行 L55）之后、§04 之前，追加以下两个段落：

```markdown
### 账号域模块 `src/main/services/agent-accounts/`

多 AI agent 账号的 CRUD、凭据托管与用量轮询：

- 契约在 `src/shared/contracts/agent-accounts.ts`（`AgentAccountsSnapshot` 全量快照）
- 广播通道 `pier://agent-accounts:changed` 是 renderer 侧镜像 store 的唯一数据源
- 模块内不 import `services/agents/`（账号是独立域，与 agent 集成层单向隔离，对齐 foreground-activity 先例）
- capability 门控：`account:read` / `account:write`；`desktop-renderer` 两者皆有，`cli-local` 仅 `account:read`
- 插件经 `context.accounts` facade 消费（读路径走 renderer 镜像 store，写路径走 `window.pier.accounts`）

### 大盘组件贡献点 `dashboardWidgets`

插件可经 manifest `dashboardWidgets` 声明 + renderer 运行时 `context.dashboardWidgets.register` 注册大盘卡片组件：

- 纪律链与 `panels` / `terminalStatusItems` 一致：`assertDeclaredContribution("dashboardWidget")` → 运行时注册表 → 宿主容器渲染
- 注册表在 `src/renderer/lib/plugins/plugin-dashboard-widget-registry.ts`（镜像 `plugin-panel-registry.ts` 结构）
- Core-owned widget 走 `CORE_DASHBOARD_WIDGETS` 静态声明（平行于 `CORE_TERMINAL_STATUS_ITEMS`），不经插件通道
- 大盘 panel 为 core panel kit（`component: "dashboard"`，多实例 `dashboard-<uuid>`），组装状态存 dockview panel params 随 layout 持久化
```

- [ ] **Step 2: 全量类型检查**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Lint 检查**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 4: 完整检查**

Run: `pnpm check`
Expected: PASS（typecheck + lint + depcruise + file-size + unit + component 全部通过）。

---

## Self-Review 记录

**Spec 覆盖**：

| 设计规格节 | 计划覆盖 |
|---|---|
| §4.8 插件 facade `context.accounts` | Task 1 Step 3-6：类型定义 + 宿主实现 + 门控测试 |
| §4.9 codex 插件 `src/plugins/builtin/codex/` | Task 2（manifest + locales + main）、Task 3（widget 状态机五态，含未安装态）、Task 4（actions 三命令）、Task 5（activate 组装 + catalog 接入） |
| §4.9 失败路径 `notifications.error` | Task 3（handleSwitch/handleAdopt/handleAdd catch → `notifications.error`）、Task 4（switchAccount/addAccount catch）、Task 2 locales 三个 Failed key |
| §6 Phase 3 表 | Task 1-5 覆盖全部 Phase 3 新建/修改文件 |
| §6 Phase 4 表（e2e + AGENTS.md） | Task 6（e2e 大盘持久化）、Task 7（AGENTS.md 段落） |
| §7 测试（component: accounts-widget 五态 + 失败路径） | Task 3 Step 2：11 个 case 覆盖未安装/未接管/正常/漂移/loginPending/切换 confirm 链/取消/错误态/switch 失败/adopt 失败/add 失败 |
| §7 测试（unit: assertDeclaredContribution dashboardWidget） | 属 Phase 1 范围（phase1 计划 Task 4 单测），本阶段不重复 |
| §7 测试（unit: account-actions 失败路径） | Task 4 Step 1：7 个 case（原 5 + switchAccount select reject → error + addAccount reject → error） |
| §9 验收清单尾部项（`pnpm check` 全绿 / e2e / AGENTS.md） | Task 6 + Task 7 |

**占位扫描**：无 TBD/TODO；每个代码 Step 均为完整可粘贴的代码块；每个验证 Step 给出精确命令与预期结果。

**类型一致性（与跨阶段契约逐字比对）**：

- `context.accounts` 签名（Task 1 Step 3）——`add(provider: AgentAccountProviderId): Promise<void>` / `adoptCurrent(): Promise<void>` / `cancelLogin(provider: AgentAccountProviderId): Promise<void>` / `onDidChange(cb: (s: AgentAccountsSnapshot) => void): () => void` / `refreshUsage(): Promise<void>` / `remove(accountId: string): Promise<void>` / `select(accountId: string): Promise<void>` / `snapshot(): AgentAccountsSnapshot` ✓ 逐字匹配设计规格 §4.8。
- `DashboardWidgetComponentProps { size: DashboardGridSize }` — Task 3/5 消费 ✓ 匹配 Phase 1 契约（网格尺寸模型：`DashboardGridSize = { h: int 1..24, w: int 1..12 }`；尺寸三元组 defaultSize/minSize/maxSize 声明在 manifest 贡献点，缺省由 `HOST_DEFAULT_WIDGET_SIZE` / `HOST_MIN_WIDGET_SIZE` / `HOST_MAX_WIDGET_SIZE` 补齐；`DASHBOARD_GRID_COLS = 12`）。
- `RendererDashboardWidgetRegistration { component, icon, id, title? }` — Task 5 Step 1 ✓ 匹配 Phase 1 契约。
- `AgentAccountsSnapshot` 字段 `{ accounts, activeAccountId, loginPending, ts, unmanagedActiveLogin, usage }` — Task 3 测试 mock 与 Task 1 实现 ✓ 匹配 Phase 2 契约。
- capability `account:read` / `account:write` — Task 1 门控 + Task 2 manifest permissions ✓ 匹配 Phase 2 契约。
- `CODEX_ACCOUNTS_WIDGET_ID = "pier.codex.accounts"` — Task 2 manifest + Task 5 register ✓ 匹配设计规格 §4.9。
- 命令 id `pier.codex.switchAccount` / `pier.codex.addAccount` / `pier.codex.refreshUsage` — Task 2 manifest + Task 4 register ✓ 匹配设计规格 §4.9。
- 配置 key `pier.codex.confirmSwitch` — Task 2 manifest + Task 3/4 `configuration.get` ✓ 匹配设计规格 §4.9。
- i18n key `widget.accounts.addFailed` / `switchFailed` / `adoptFailed` — Task 2 locales + Task 3/4 catch `context.i18n.t` ✓ 匹配设计规格 §4.9 失败路径。
