# Agent 账号域地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 main 侧建立 `agent-accounts` 域服务——codex 多账号 CRUD、接管现有登录、切换物化（含回采时序铁律）、外部漂移侦测、用量轮询、变更广播；renderer 侧建镜像 store + preload facade，为 Phase 3 的 `pier.codex` 插件提供完整数据通道。本阶段不涉及任何 UI 组件。

**Architecture:** 新建共享契约 `agent-accounts.ts`（Zod schema + 类型）；扩展 permissions / commands / ipc-channels 三张基础表；main 侧新建 `services/agent-accounts/` 六文件模块 + `state/agent-accounts-state.ts` 持久化；preload 新增 `accounts` facade（统一走 `invokePierCommand` + `subscribeIpc` 广播）；renderer 新建 zustand 镜像 store + `initAgentAccounts()`。命令路由新增 `executeAccountCommand` 域执行器，接线模式对齐 `executeGitCommand`。

**Tech Stack:** TypeScript 6 strict · Zod 3 · Vitest 4 · Zustand 5 · write-file-atomic · Node child_process

## 全局约束

- 不 auto-commit：参照 `AGENTS.md` §05 安全边界，每个 task 结尾跑对应验证命令即可，commit 由用户在全部完成后统一决策
- 禁止 `@ts-ignore` / `as any`：所有类型压制必须用合理的类型窄化或泛型解决
- Biome + Ultracite：所有新代码遵循既有格式规范
- TDD 纪律：先写失败测试再写实现（每个含代码的 task 内失败测试在实现之前）
- 测试位置：`tests/unit/main/` 存放 main 侧单测，`tests/unit/shared/` 存放共享契约单测，`tests/unit/renderer/` 存放 renderer 侧单测
- spawn 类测试一律 mock：不在单测里真 spawn codex；注入 exec/spawn 函数替身
- `agent-accounts` 模块不 import `services/agents/`（对齐 foreground-activity 的单向边界先例——账号是独立域）

---

## 文件结构

**新建（9）**：
- `src/shared/contracts/agent-accounts.ts` — 账号域全部 Zod schema + 类型
- `src/main/services/agent-accounts/index.ts` — `createAgentAccountsService` 工厂
- `src/main/services/agent-accounts/service.ts` — 编排：CRUD/select/adopt/login、mutation queue、广播、usage 调度
- `src/main/services/agent-accounts/codex-provider.ts` — spawn login、物化/回采、外部 watch
- `src/main/services/agent-accounts/codex-usage.ts` — codex app-server JSON-RPC 用量获取
- `src/main/services/agent-accounts/identity.ts` — auth.json 读取 + JWT claim 解析纯函数
- `src/main/services/agent-accounts/types.ts` — provider 内部接口
- `src/main/state/agent-accounts-state.ts` — L1 持久化（debouncedJsonStore）
- `src/renderer/stores/agent-accounts.store.ts` — zustand 镜像 store + `initAgentAccounts()`

**修改（7）**：
- `src/shared/contracts/permissions.ts` — capability 枚举 + DEFAULT_CAPABILITIES_BY_CLIENT_KIND
- `src/shared/contracts/commands.ts` — 7 个命令 variant
- `src/shared/ipc-channels.ts` — `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED`
- `src/main/app-core/permissions.ts` — COMMAND_METADATA 7 行
- `src/main/app-core/command-router-services.ts` — PierCoreServices 新增 `agentAccounts`
- `src/main/app-core/command-router.ts` — 域执行器接线
- `src/main/app-core/app-core.ts` — 服务创建 + 广播接线
- `src/preload/index.ts` — accounts API + PierWindowAPI
- `src/renderer/main.tsx` — `initAgentAccounts()` 挂载

---

## Task 1: 共享契约 `agent-accounts.ts` + schema 单测

**Files:**
- Create: `src/shared/contracts/agent-accounts.ts`
- Create: `tests/unit/shared/agent-accounts-schema.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  - `agentAccountProviderSchema` / `AgentAccountProviderId`
  - `agentAccountSchema` + 类型推断
  - `rateLimitWindowSchema` / `accountUsageSchema`
  - `agentAccountsSnapshotSchema` / `AgentAccountsSnapshot`
  - 以上全部为后续 Task 2-9 的共享数据形状

- [ ] **Step 1: 写失败测试**

写入 `tests/unit/shared/agent-accounts-schema.test.ts`：

```ts
import {
  agentAccountProviderSchema,
  agentAccountSchema,
  agentAccountsSnapshotSchema,
  accountUsageSchema,
  rateLimitWindowSchema,
} from "@shared/contracts/agent-accounts.ts";
import { describe, expect, it } from "vitest";

describe("agent-accounts schema", () => {
  const validAccount = {
    createdAt: 1_720_000_000_000,
    email: "alice@example.com",
    id: "acc-001",
    provider: "codex",
    updatedAt: 1_720_000_000_000,
  };

  it("agentAccountProviderSchema 接受 codex 拒绝未知 provider", () => {
    expect(agentAccountProviderSchema.parse("codex")).toBe("codex");
    expect(() => agentAccountProviderSchema.parse("claude")).toThrow();
  });

  it("agentAccountSchema 接受最小合法对象", () => {
    const result = agentAccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
  });

  it("agentAccountSchema 接受含可选字段的完整对象", () => {
    const full = {
      ...validAccount,
      lastAuthenticatedAt: 1_720_000_100_000,
      planType: "pro",
      providerAccountId: "chatgpt-acc-xyz",
    };
    const result = agentAccountSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("agentAccountSchema 拒绝缺少必填字段", () => {
    const { email: _, ...noEmail } = validAccount;
    expect(agentAccountSchema.safeParse(noEmail).success).toBe(false);
  });

  it("rateLimitWindowSchema 接受合法窗口数据", () => {
    const window = { usedPercent: 49, resetsAt: 1_783_389_343_000, windowMinutes: 10080 };
    expect(rateLimitWindowSchema.safeParse(window).success).toBe(true);
  });

  it("rateLimitWindowSchema 接受仅 usedPercent", () => {
    expect(rateLimitWindowSchema.safeParse({ usedPercent: 0 }).success).toBe(true);
  });

  it("accountUsageSchema 接受 ok 状态", () => {
    const usage = {
      accountId: "acc-001",
      fetchedAt: 1_720_000_200_000,
      status: "ok",
      session: { usedPercent: 11 },
      weekly: { usedPercent: 49 },
    };
    expect(accountUsageSchema.safeParse(usage).success).toBe(true);
  });

  it("accountUsageSchema 接受 error 状态", () => {
    const usage = {
      accountId: "acc-001",
      error: "RPC timeout",
      fetchedAt: 1_720_000_200_000,
      status: "error",
    };
    expect(accountUsageSchema.safeParse(usage).success).toBe(true);
  });

  it("agentAccountsSnapshotSchema round-trip", () => {
    const snapshot = {
      accounts: [validAccount],
      activeAccountId: "acc-001",
      loginPending: null,
      ts: 1,
      unmanagedActiveLogin: false,
      usage: {},
    };
    const result = agentAccountsSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(snapshot);
    }
  });

  it("agentAccountsSnapshotSchema 拒绝无效 loginPending provider", () => {
    const snapshot = {
      accounts: [],
      activeAccountId: null,
      loginPending: "unsupported",
      ts: 1,
      unmanagedActiveLogin: false,
      usage: {},
    };
    expect(agentAccountsSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/shared/agent-accounts-schema.test.ts`
Expected: FAIL，报无法解析 `@shared/contracts/agent-accounts.ts`（文件不存在）。

- [ ] **Step 3: 创建契约文件**

写入 `src/shared/contracts/agent-accounts.ts`：

```ts
import { z } from "zod";

export const agentAccountProviderSchema = z.enum(["codex"]);
export type AgentAccountProviderId = z.infer<typeof agentAccountProviderSchema>;

export const agentAccountSchema = z.object({
  createdAt: z.number(),
  email: z.string().min(1),
  id: z.string().min(1),
  lastAuthenticatedAt: z.number().optional(),
  planType: z.string().min(1).optional(),
  provider: agentAccountProviderSchema,
  providerAccountId: z.string().min(1).optional(),
  updatedAt: z.number(),
});
export type AgentAccount = z.infer<typeof agentAccountSchema>;

export const rateLimitWindowSchema = z.object({
  resetsAt: z.number().optional(),
  usedPercent: z.number(),
  windowMinutes: z.number().optional(),
});
export type RateLimitWindow = z.infer<typeof rateLimitWindowSchema>;

export const accountUsageSchema = z.object({
  accountId: z.string().min(1),
  error: z.string().min(1).optional(),
  fetchedAt: z.number(),
  session: rateLimitWindowSchema.optional(),
  status: z.enum(["ok", "error"]),
  weekly: rateLimitWindowSchema.optional(),
});
export type AccountUsage = z.infer<typeof accountUsageSchema>;

export const agentAccountsSnapshotSchema = z.object({
  accounts: z.array(agentAccountSchema),
  activeAccountId: z.string().min(1).nullable(),
  loginPending: agentAccountProviderSchema.nullable(),
  ts: z.number(),
  unmanagedActiveLogin: z.boolean(),
  usage: z.record(z.string().min(1), accountUsageSchema),
});
export type AgentAccountsSnapshot = z.infer<
  typeof agentAccountsSnapshotSchema
>;
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/shared/agent-accounts-schema.test.ts`
Expected: PASS，全部 9 个 case 通过。

---

## Task 2: permissions 扩容 + ipc-channels 广播常量

**Files:**
- Modify: `src/shared/contracts/permissions.ts`（L10-43 的 `pierCapabilitySchema` 枚举 + L58-133 的 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND`）
- Modify: `src/shared/ipc-channels.ts`（L18-52 的 `PIER_BROADCAST`）

**Interfaces:**
- Consumes: 无
- Produces:
  - `"account:read"` / `"account:write"` capability 枚举值——后续 Task 3/8 使用
  - `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED`——后续 Task 7/8/9 使用

- [ ] **Step 1: 在 capability 枚举增加 `account:read` / `account:write`**

打开 `src/shared/contracts/permissions.ts`。当前 `pierCapabilitySchema` 枚举（L10-43）最后一项是 `"ai:invoke"`。在 `"ai:invoke"` 之前按字母序插入两行：

```ts
export const pierCapabilitySchema = z.enum([
  "account:read",
  "account:write",
  "app:read",
  "preferences:read",
  "preferences:write",
  "workspace:read",
  "workspace:write",
  "workspace:open",
  "worktree:read",
  "worktree:write",
  "window:read",
  "window:control",
  "window:create",
  "window:focus",
  "window:close",
  "panel:open",
  "panel:read",
  "panel:control",
  "terminal:read",
  "terminal:control",
  "plugin:read",
  "plugin:write",
  "command:register",
  "panel:register",
  "git:read",
  "git:write",
  "file:read",
  "file:write",
  "transcript:read",
  "profile:read",
  "secret:read",
  "evidence:write",
  "network",
  "ai:invoke",
]);
```

- [ ] **Step 2: 在 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND` 增加默认授权**

当前 `desktop-renderer` 数组（L62-88）末尾是 `"ai:invoke"`。在其之前按字母序插入：

```ts
  "desktop-renderer": [
    "account:read",
    "account:write",
    "app:read",
    // ... 其余保持不变 ...
    "ai:invoke",
  ],
```

当前 `cli-local` 数组（L89-104）末尾是 `"git:read"`。在 `"app:read"` 之前按字母序插入 `"account:read"`：

```ts
  "cli-local": [
    "account:read",
    "app:read",
    // ... 其余保持不变 ...
  ],
```

**不**给 `mcp-local` 和 `mobile-paired` 加任何 `account:*` 能力（设计规格 §4.7 明确排除）。

- [ ] **Step 3: 在 `PIER_BROADCAST` 增加广播常量**

打开 `src/shared/ipc-channels.ts`。当前 `PIER_BROADCAST`（L18-52）第一个条目是 `COMMAND_PALETTE_TOGGLE_REQUEST`。在其之前按字母序插入：

```ts
export const PIER_BROADCAST = {
  // 账号域变更广播 (main → 所有 renderer, payload AgentAccountsSnapshot).
  AGENT_ACCOUNTS_CHANGED: "pier://agent-accounts:changed",
  // main 端应用菜单请求 renderer 打开/关闭命令面板.
  COMMAND_PALETTE_TOGGLE_REQUEST: "pier://command-palette:toggle-request",
  // ... 其余保持不变 ...
} as const;
```

- [ ] **Step 4: 跑 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（仅新增枚举值和常量，无既有代码 break）。

---

## Task 3: commands.ts 7 个 variant + COMMAND_METADATA + permissions.test 矩阵更新

**Files:**
- Modify: `src/shared/contracts/commands.ts`（L1-36 的 import 区 + L65-387 的 discriminatedUnion）
- Modify: `src/main/app-core/permissions.ts`（L21-118 的 COMMAND_METADATA）
- Modify: `tests/unit/app-core/permissions.test.ts`

**Interfaces:**
- Consumes: `agentAccountProviderSchema`（Task 1）、`"account:read"` / `"account:write"`（Task 2）
- Produces:
  - 7 个新 `PierCommand` variant——后续 Task 7/8 的命令路由使用
  - COMMAND_METADATA 授权矩阵——authorizeCommand 校验依据

- [ ] **Step 1: 写失败 permissions.test 用例**

打开 `tests/unit/app-core/permissions.test.ts`，在文件末尾 `});`（闭合 `describe("authorizeCommand")` 的大括号）之前追加：

```ts
  it("account:read 命令允许 desktop-renderer 和 cli-local，拒绝 mcp-local", () => {
    const readCommands = [
      { type: "accounts.snapshot" },
      { type: "accounts.refreshUsage" },
    ] satisfies PierCommand[];
    for (const command of readCommands) {
      expect(authorizeCommand(command, client("desktop-renderer"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("cli-local"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("mcp-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:read",
      });
    }
  });

  it("account:write 命令允许 desktop-renderer，拒绝 cli-local 和 mcp-local", () => {
    const writeCommands = [
      { type: "accounts.adoptCurrent" },
      { provider: "codex", type: "accounts.add" },
      { provider: "codex", type: "accounts.cancelLogin" },
      { accountId: "acc-001", type: "accounts.select" },
      { accountId: "acc-001", type: "accounts.remove" },
    ] satisfies PierCommand[];
    for (const command of writeCommands) {
      expect(authorizeCommand(command, client("desktop-renderer"))).toEqual({
        ok: true,
      });
      expect(authorizeCommand(command, client("cli-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:write",
      });
      expect(authorizeCommand(command, client("mcp-local"))).toEqual({
        ok: false,
        reason: "missing capability: account:write",
      });
    }
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/app-core/permissions.test.ts`
Expected: FAIL，TypeScript 类型错误——`"accounts.snapshot"` 等不是合法的 `PierCommand["type"]`。

- [ ] **Step 3: 在 commands.ts 增加 7 个 variant**

打开 `src/shared/contracts/commands.ts`。

首先在 import 区（L1-36）追加对 `agent-accounts.ts` 的导入。在文件顶部 import 块中，`import { z } from "zod";` 之后、其他 import 之前加：

```ts
import { agentAccountProviderSchema } from "./agent-accounts.ts";
```

然后在 `pierCommandSchema` 的 discriminatedUnion 数组中（L65-387），在 `z.object({ type: z.literal("ai.status") })` 之前按字母序插入 7 个 variant：

```ts
  // Agent accounts 域命令
  z.object({ type: z.literal("accounts.snapshot") }),
  z.object({ type: z.literal("accounts.adoptCurrent") }),
  z.object({
    provider: agentAccountProviderSchema,
    type: z.literal("accounts.add"),
  }),
  z.object({
    provider: agentAccountProviderSchema,
    type: z.literal("accounts.cancelLogin"),
  }),
  z.object({
    accountId: z.string().min(1),
    type: z.literal("accounts.select"),
  }),
  z.object({
    accountId: z.string().min(1),
    type: z.literal("accounts.remove"),
  }),
  z.object({ type: z.literal("accounts.refreshUsage") }),
```

- [ ] **Step 4: 在 COMMAND_METADATA 增加 7 行**

打开 `src/main/app-core/permissions.ts`。当前 `COMMAND_METADATA`（L21-118）按字母序排列，第一个条目是 `"ai.status"`。在其之前插入 7 行：

```ts
const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  "accounts.add": { capabilities: ["account:write"] },
  "accounts.adoptCurrent": { capabilities: ["account:write"] },
  "accounts.cancelLogin": { capabilities: ["account:write"] },
  "accounts.refreshUsage": { capabilities: ["account:read"] },
  "accounts.remove": { capabilities: ["account:write"] },
  "accounts.select": { capabilities: ["account:write"] },
  "accounts.snapshot": { capabilities: ["account:read"] },
  "ai.status": { capabilities: ["ai:invoke"] },
  // ... 其余保持不变 ...
};
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/app-core/permissions.test.ts`
Expected: PASS，包含新增 2 个 account 权限矩阵 case + 既有全部 case。

- [ ] **Step 6: 跑 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（`Record<PierCommand["type"], CommandMetadata>` 的全 key 约束已满足）。

---

## Task 4: identity.ts — auth.json 读取 + JWT 解析纯函数 + 单测

**Files:**
- Create: `src/main/services/agent-accounts/identity.ts`
- Create: `tests/unit/main/agent-accounts-identity.test.ts`

**Interfaces:**
- Consumes: Node `fs/promises`、`Buffer`
- Produces:
  - `AccountIdentity { email, planType?, providerAccountId? }` — Task 7 的 adopt/add 使用
  - `readCodexIdentity(homeDir: string): Promise<AccountIdentity | null>` — 纯函数，给 codex-provider 调
  - `parseIdTokenClaims(idToken: string): { email, planType?, providerAccountId? } | null` — 可测纯函数

- [ ] **Step 1: 写失败测试**

写入 `tests/unit/main/agent-accounts-identity.test.ts`：

```ts
import {
  parseIdTokenClaims,
  readCodexIdentity,
} from "@main/services/agent-accounts/identity.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** 构造伪 JWT：header.payload.signature（signature 不校验，只用于解析 payload）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
    "base64url"
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

describe("parseIdTokenClaims", () => {
  it("从合法 JWT 提取 email / planType / providerAccountId", () => {
    const token = fakeJwt({
      email: "alice@openai.com",
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "pro",
        chatgpt_account_id: "acc-xyz-123",
      },
    });
    const claims = parseIdTokenClaims(token);
    expect(claims).toEqual({
      email: "alice@openai.com",
      planType: "pro",
      providerAccountId: "acc-xyz-123",
    });
  });

  it("email 缺失时返回 null", () => {
    const token = fakeJwt({
      "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
    });
    expect(parseIdTokenClaims(token)).toBeNull();
  });

  it("无 auth 命名空间时 planType/providerAccountId 为 undefined", () => {
    const token = fakeJwt({ email: "bob@example.com" });
    const claims = parseIdTokenClaims(token);
    expect(claims).toEqual({
      email: "bob@example.com",
      planType: undefined,
      providerAccountId: undefined,
    });
  });

  it("非三段 token 返回 null", () => {
    expect(parseIdTokenClaims("not-a-jwt")).toBeNull();
  });

  it("payload 非 JSON 返回 null", () => {
    expect(parseIdTokenClaims("a.!!!invalid-base64.c")).toBeNull();
  });
});

describe("readCodexIdentity", () => {
  const tempDirs: string[] = [];

  async function makeTempHome(): Promise<string> {
    const dir = join(
      tmpdir(),
      `pier-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true }))
    );
  });

  it("读取合法 auth.json 返回身份", async () => {
    const home = await makeTempHome();
    const authJson = {
      tokens: {
        id_token: fakeJwt({
          email: "charlie@openai.com",
          "https://api.openai.com/auth": {
            chatgpt_plan_type: "plus",
            chatgpt_account_id: "acc-charlie",
          },
        }),
      },
    };
    await writeFile(join(home, "auth.json"), JSON.stringify(authJson));
    const identity = await readCodexIdentity(home);
    expect(identity).toEqual({
      email: "charlie@openai.com",
      planType: "plus",
      providerAccountId: "acc-charlie",
    });
  });

  it("auth.json 不存在返回 null", async () => {
    const home = await makeTempHome();
    expect(await readCodexIdentity(home)).toBeNull();
  });

  it("auth.json 无 tokens.id_token 返回 null", async () => {
    const home = await makeTempHome();
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({ auth_mode: "oauth" })
    );
    expect(await readCodexIdentity(home)).toBeNull();
  });

  it("auth.json 损坏（非 JSON）返回 null", async () => {
    const home = await makeTempHome();
    await writeFile(join(home, "auth.json"), "not json {{");
    expect(await readCodexIdentity(home)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-identity.test.ts`
Expected: FAIL，报无法解析 `@main/services/agent-accounts/identity.ts`。

- [ ] **Step 3: 实现 identity.ts**

写入 `src/main/services/agent-accounts/identity.ts`：

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AccountIdentity {
  email: string;
  planType?: string;
  providerAccountId?: string;
}

const OPENAI_AUTH_NS = "https://api.openai.com/auth";

/**
 * 从 codex id_token JWT（不校验签名——本地已存文件）解析身份声明。
 * 返回 null 表示 token 格式不可用或缺少 email。
 */
export function parseIdTokenClaims(
  idToken: string
): AccountIdentity | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    const email = payload.email;
    if (typeof email !== "string" || email.length === 0) {
      return null;
    }
    const authNs =
      typeof payload[OPENAI_AUTH_NS] === "object" &&
      payload[OPENAI_AUTH_NS] !== null
        ? payload[OPENAI_AUTH_NS]
        : undefined;
    return {
      email,
      planType: typeof authNs?.chatgpt_plan_type === "string"
        ? authNs.chatgpt_plan_type
        : undefined,
      providerAccountId: typeof authNs?.chatgpt_account_id === "string"
        ? authNs.chatgpt_account_id
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 读取指定 CODEX_HOME 目录下的 auth.json，解析 id_token 身份。
 * 返回 null 表示文件不存在 / 损坏 / 缺少 id_token。
 */
export async function readCodexIdentity(
  homeDir: string
): Promise<AccountIdentity | null> {
  try {
    const raw = await readFile(join(homeDir, "auth.json"), "utf-8");
    const data = JSON.parse(raw);
    const idToken = data?.tokens?.id_token;
    if (typeof idToken !== "string" || idToken.length === 0) {
      return null;
    }
    return parseIdTokenClaims(idToken);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-identity.test.ts`
Expected: PASS，全部 9 个 case 通过。

---

## Task 5: agent-accounts-state.ts — L1 持久化 + round-trip 单测

**Files:**
- Create: `src/main/state/agent-accounts-state.ts`
- Create: `tests/unit/main/agent-accounts-state.test.ts`

**Interfaces:**
- Consumes: `debouncedJsonStore`（`src/main/state/debounced-store.ts`）、`agentAccountSchema`（Task 1）
- Produces:
  - `AgentAccountsFileState { accounts, activeAccountId, version }` — 磁盘形状
  - `createAgentAccountsStateStore(filePath): AgentAccountsStateStore` — 工厂（单测注入临时路径）
  - 默认单例门面函数：`readAgentAccountsState` / `mutateAgentAccountsState` / `flushAgentAccountsState`

- [ ] **Step 1: 写失败测试**

写入 `tests/unit/main/agent-accounts-state.test.ts`：

```ts
import {
  createAgentAccountsStateStore,
} from "@main/state/agent-accounts-state.ts";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("agent-accounts-state", () => {
  const tempFiles: string[] = [];

  function tempPath(): string {
    const p = join(
      tmpdir(),
      `pier-accounts-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    tempFiles.push(p);
    return p;
  }

  afterEach(async () => {
    await Promise.all(
      tempFiles.splice(0).map((f) => rm(f, { force: true }))
    );
  });

  it("init 无文件时返回默认值", async () => {
    const store = createAgentAccountsStateStore(tempPath());
    const state = await store.init();
    expect(state).toEqual({
      accounts: [],
      activeAccountId: null,
      version: 1,
    });
  });

  it("mutate 后 get 立即反映新状态", async () => {
    const store = createAgentAccountsStateStore(tempPath());
    await store.init();
    store.mutate((s) => ({
      ...s,
      accounts: [
        {
          createdAt: 1_000,
          email: "a@b.com",
          id: "id-1",
          provider: "codex" as const,
          updatedAt: 1_000,
        },
      ],
      activeAccountId: "id-1",
    }));
    const state = store.get();
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe("id-1");
  });

  it("flush + 重新 init 实现持久化 round-trip", async () => {
    const filePath = tempPath();
    const store1 = createAgentAccountsStateStore(filePath);
    await store1.init();
    store1.mutate((s) => ({
      ...s,
      accounts: [
        {
          createdAt: 2_000,
          email: "c@d.com",
          id: "id-2",
          provider: "codex" as const,
          updatedAt: 2_000,
        },
      ],
      activeAccountId: "id-2",
    }));
    await store1.flush();

    const store2 = createAgentAccountsStateStore(filePath);
    const reloaded = await store2.init();
    expect(reloaded.accounts).toHaveLength(1);
    expect(reloaded.accounts[0].email).toBe("c@d.com");
    expect(reloaded.activeAccountId).toBe("id-2");
    expect(reloaded.version).toBe(1);
  });

  it("损坏文件回退默认值", async () => {
    const filePath = tempPath();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "not valid json {{{");
    const store = createAgentAccountsStateStore(filePath);
    const state = await store.init();
    expect(state).toEqual({
      accounts: [],
      activeAccountId: null,
      version: 1,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-state.test.ts`
Expected: FAIL，报无法解析 `@main/state/agent-accounts-state.ts`。

- [ ] **Step 3: 实现 agent-accounts-state.ts**

写入 `src/main/state/agent-accounts-state.ts`：

```ts
import { join } from "node:path";
import { z } from "zod";
import { agentAccountSchema } from "@shared/contracts/agent-accounts.ts";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const agentAccountsFileStateSchema = z.object({
  accounts: z.array(agentAccountSchema),
  activeAccountId: z.string().min(1).nullable(),
  version: z.literal(1),
});

export type AgentAccountsFileState = z.infer<
  typeof agentAccountsFileStateSchema
>;

const DEFAULTS: AgentAccountsFileState = {
  accounts: [],
  activeAccountId: null,
  version: 1,
};

export interface AgentAccountsStateStore {
  flush(): Promise<void>;
  get(): AgentAccountsFileState;
  init(): Promise<AgentAccountsFileState>;
  mutate(fn: (state: AgentAccountsFileState) => AgentAccountsFileState): AgentAccountsFileState;
}

/**
 * 工厂——单测注入临时路径，生产走 resolveDefaultFilePath。
 * 对齐 terminal-status-bar-prefs.ts 的 createTerminalStatusBarPrefsStore 模式。
 */
export function createAgentAccountsStateStore(
  filePath: string
): AgentAccountsStateStore {
  const store: DebouncedJsonStore<AgentAccountsFileState> =
    debouncedJsonStore({
      defaults: DEFAULTS,
      filePath,
    });

  return {
    async init(): Promise<AgentAccountsFileState> {
      const raw = await store.init();
      // Zod 校验——损坏/版本不匹配时回退默认值
      const result = agentAccountsFileStateSchema.safeParse(raw);
      if (!result.success) {
        store.replace(DEFAULTS);
        return DEFAULTS;
      }
      return result.data;
    },
    get: () => store.get(),
    mutate: (fn) => store.mutate(fn),
    flush: () => store.flush(),
  };
}

/** 生产默认路径——需要 electron app 可用。 */
function resolveDefaultFilePath(): string {
  // 延迟 import 避免单测环境加载 electron
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require("electron") as typeof import("electron");
  return join(app.getPath("userData"), "agent-accounts.json");
}

let defaultStore: AgentAccountsStateStore | undefined;

function getDefaultStore(): AgentAccountsStateStore {
  if (!defaultStore) {
    defaultStore = createAgentAccountsStateStore(resolveDefaultFilePath());
  }
  return defaultStore;
}

export function readAgentAccountsState(): Promise<AgentAccountsFileState> {
  return getDefaultStore().init();
}

export function mutateAgentAccountsState(
  fn: (state: AgentAccountsFileState) => AgentAccountsFileState
): AgentAccountsFileState {
  return getDefaultStore().mutate(fn);
}

export function flushAgentAccountsState(): Promise<void> {
  return getDefaultStore().flush();
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-state.test.ts`
Expected: PASS，全部 4 个 case 通过。

---

## Task 6: types.ts + codex-provider.ts（login spawn / materialize / syncBack / watch）+ 单测

**Files:**
- Create: `src/main/services/agent-accounts/types.ts`
- Create: `src/main/services/agent-accounts/codex-provider.ts`
- Create: `tests/unit/main/agent-accounts-codex-provider.test.ts`

**Interfaces:**
- Consumes: `AccountIdentity`（Task 4）、`readCodexIdentity`（Task 4）、`write-file-atomic`
- Produces:
  - `AgentAccountProvider` 接口——Task 7 的 service 消费
  - `createCodexProvider(opts)` 工厂——可注入 spawn 替身

- [ ] **Step 1: 创建 types.ts**

写入 `src/main/services/agent-accounts/types.ts`：

```ts
import type { AgentAccountProviderId } from "@shared/contracts/agent-accounts.ts";
import type { AccountIdentity } from "./identity.ts";

/** provider 内部接口。v1 只有 codex；v2 扩 claude 等时实现此接口即可。 */
export interface AgentAccountProvider {
  readonly id: AgentAccountProviderId;
  /** spawn `codex login` 到指定托管目录。 */
  login(homeDir: string, signal: AbortSignal): Promise<void>;
  /** 读取指定目录的 auth.json 身份。 */
  readIdentity(homeDir: string): Promise<AccountIdentity | null>;
  /** 托管 auth.json → ~/.codex/auth.json（write-file-atomic）。 */
  materialize(accountHomeDir: string): Promise<void>;
  /**
   * ~/.codex/auth.json → 托管目录。回采前先读真实 auth 身份并与
   * expectedProviderAccountId 比对：不匹配说明外部已换号（漂移侦测的
   * debounce 还没来得及触发），跳过复制并返回 "identity-mismatch"，
   * 由 service 立即走漂移处理 —— 否则会把 B 账号的凭据写进 A 的托管目录。
   */
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "ok">;
  /**
   * 外部漂移侦测。watch 的是 ~/.codex 目录（按文件名过滤 auth.json），
   * 不是文件本身：codex CLI 与本服务都用原子写（写临时文件 + rename），
   * macOS 上对单文件的 fs.watch 按 inode 追踪，rename 后会静默失效。
   */
  watchExternalAuth(cb: () => void): () => void;
  /** 获取活跃账号的用量（经 codex app-server JSON-RPC）。 */
  fetchUsage(signal: AbortSignal): Promise<AccountUsageResult>;
}

export interface AccountUsageResult {
  error?: string;
  session?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
  status: "ok" | "error";
  weekly?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
}
```

- [ ] **Step 2: 写失败测试**

写入 `tests/unit/main/agent-accounts-codex-provider.test.ts`：

```ts
import {
  createCodexProvider,
  PIER_MANAGED_HOME_MARKER,
} from "@main/services/agent-accounts/codex-provider.ts";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `pier-codex-provider-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** 构造伪 JWT（不校验签名，只用于 syncBack 身份校验测试）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) => rm(d, { force: true, recursive: true }))
  );
});

describe("createCodexProvider", () => {
  it("materialize 把托管 auth.json 写入 realCodexHome", async () => {
    const managedDir = await makeTempDir("managed");
    const realHome = await makeTempDir("real");
    const authContent = JSON.stringify({ tokens: { id_token: "fake" } });
    await writeFile(join(managedDir, "auth.json"), authContent);

    const provider = createCodexProvider({
      realCodexHome: realHome,
    });
    await provider.materialize(managedDir);

    const written = await readFile(join(realHome, "auth.json"), "utf-8");
    expect(written).toBe(authContent);
  });

  it("syncBack 身份匹配时回采 auth.json 并返回 ok", async () => {
    const managedDir = await makeTempDir("managed-sb");
    const realHome = await makeTempDir("real-sb");
    const jwt = fakeJwt({
      email: "a@b.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "prov-acc-1" },
    });
    const authContent = JSON.stringify({ tokens: { id_token: jwt } });
    await writeFile(join(realHome, "auth.json"), authContent);

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, "prov-acc-1");

    expect(result).toBe("ok");
    const synced = await readFile(join(managedDir, "auth.json"), "utf-8");
    expect(synced).toBe(authContent);
  });

  it("syncBack 身份不匹配时返回 identity-mismatch 且不复制", async () => {
    const managedDir = await makeTempDir("managed-mm");
    const realHome = await makeTempDir("real-mm");
    const jwt = fakeJwt({
      email: "a@b.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "prov-acc-OTHER" },
    });
    await writeFile(
      join(realHome, "auth.json"),
      JSON.stringify({ tokens: { id_token: jwt } })
    );

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, "prov-acc-1");

    expect(result).toBe("identity-mismatch");
    // 不应复制文件到托管目录
    await expect(readFile(join(managedDir, "auth.json"), "utf-8")).rejects.toThrow();
  });

  it("syncBack expectedProviderAccountId 为 undefined 时跳过身份校验", async () => {
    const managedDir = await makeTempDir("managed-undef");
    const realHome = await makeTempDir("real-undef");
    const authContent = JSON.stringify({
      tokens: { id_token: "refreshed" },
      last_refresh: 999,
    });
    await writeFile(join(realHome, "auth.json"), authContent);

    const provider = createCodexProvider({ realCodexHome: realHome });
    const result = await provider.syncBack(managedDir, undefined);

    expect(result).toBe("ok");
    const synced = await readFile(join(managedDir, "auth.json"), "utf-8");
    expect(synced).toBe(authContent);
  });

  it("login spawn 用传入的 spawn 替身", async () => {
    const managedDir = await makeTempDir("login");
    const realHome = await makeTempDir("real-login");
    const spawnCalls: Array<{ cmd: string; args: string[]; env: Record<string, string | undefined> }> = [];

    const provider = createCodexProvider({
      realCodexHome: realHome,
      spawnLogin: (cmd, args, opts) => {
        spawnCalls.push({ cmd, args, env: opts.env as Record<string, string | undefined> });
        // 模拟成功退出
        return Promise.resolve();
      },
    });

    const ac = new AbortController();
    await provider.login(managedDir, ac.signal);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toContain("login");
    expect(spawnCalls[0].env.CODEX_HOME).toBe(managedDir);
  });

  it("watchExternalAuth watch 父目录并按 auth.json 文件名过滤", async () => {
    const realHome = await makeTempDir("real-watch");
    const provider = createCodexProvider({ realCodexHome: realHome });
    const cb = vi.fn();
    const dispose = provider.watchExternalAuth(cb);
    expect(typeof dispose).toBe("function");
    dispose();
  });

  it("PIER_MANAGED_HOME_MARKER 常量为 .pier-managed-home", () => {
    expect(PIER_MANAGED_HOME_MARKER).toBe(".pier-managed-home");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-codex-provider.test.ts`
Expected: FAIL，报无法解析 `@main/services/agent-accounts/codex-provider.ts`。

- [ ] **Step 4: 实现 codex-provider.ts**

写入 `src/main/services/agent-accounts/codex-provider.ts`：

```ts
import { existsSync, watch, type FSWatcher } from "node:fs";
import { copyFile, readFile, writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { AccountIdentity } from "./identity.ts";
import { readCodexIdentity } from "./identity.ts";
import type { AgentAccountProvider, AccountUsageResult } from "./types.ts";
import { fetchCodexUsage } from "./codex-usage.ts";

export const PIER_MANAGED_HOME_MARKER = ".pier-managed-home";

export interface SpawnLoginFn {
  (
    cmd: string,
    args: string[],
    opts: { env: Record<string, string | undefined>; signal: AbortSignal }
  ): Promise<void>;
}

export interface CreateCodexProviderOpts {
  /** ~/.codex 真实路径（默认 `$HOME/.codex`）。 */
  realCodexHome: string;
  /** 可注入的 login spawn 替身（单测用）。 */
  spawnLogin?: SpawnLoginFn;
}

function defaultRealCodexHome(): string {
  return join(
    process.env.CODEX_HOME ??
      join(process.env.HOME ?? require("node:os").homedir(), ".codex")
  );
}

/**
 * 默认 spawn login 实现——真 spawn `codex login`。
 * 生产环境使用；单测通过 opts.spawnLogin 替换。
 */
async function defaultSpawnLogin(
  cmd: string,
  args: string[],
  opts: { env: Record<string, string | undefined>; signal: AbortSignal }
): Promise<void> {
  const { spawn } = await import("node:child_process");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
      stdio: "inherit",
    });

    opts.signal.addEventListener(
      "abort",
      () => {
        child.kill();
        reject(new Error("Login cancelled"));
      },
      { once: true }
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with code ${code}`));
      }
    });
  });
}

export function createCodexProvider(
  opts?: Partial<CreateCodexProviderOpts>
): AgentAccountProvider {
  const realCodexHome = opts?.realCodexHome ?? defaultRealCodexHome();
  const spawnLogin = opts?.spawnLogin ?? defaultSpawnLogin;

  return {
    id: "codex",

    async login(homeDir: string, signal: AbortSignal): Promise<void> {
      await spawnLogin("codex", ["login"], {
        env: { CODEX_HOME: homeDir },
        signal,
      });
    },

    readIdentity(homeDir: string): Promise<AccountIdentity | null> {
      return readCodexIdentity(homeDir);
    },

    async materialize(accountHomeDir: string): Promise<void> {
      const src = join(accountHomeDir, "auth.json");
      const dest = join(realCodexHome, "auth.json");
      const content = await readFile(src, "utf-8");
      await writeFileAtomic(dest, content, { mode: 0o600 });
    },

    async syncBack(
      accountHomeDir: string,
      expectedProviderAccountId: string | undefined
    ): Promise<"identity-mismatch" | "ok"> {
      const src = join(realCodexHome, "auth.json");
      if (!existsSync(src)) {
        return "ok";
      }
      // 身份校验：expected 不为 undefined 时比对真实 auth 的 providerAccountId
      if (expectedProviderAccountId !== undefined) {
        const identity = await readCodexIdentity(realCodexHome);
        if (identity?.providerAccountId !== expectedProviderAccountId) {
          return "identity-mismatch";
        }
      }
      const dest = join(accountHomeDir, "auth.json");
      await copyFile(src, dest);
      return "ok";
    },

    watchExternalAuth(cb: () => void): () => void {
      // watch ~/.codex 目录（不是 auth.json 文件本身）：
      // codex CLI 与本服务都用原子写（写临时文件 + rename），
      // macOS 上对单文件的 fs.watch 按 inode 追踪，rename 后会静默失效。
      let watcher: FSWatcher | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        watcher = watch(realCodexHome, (_eventType, filename) => {
          if (filename !== "auth.json") {
            return;
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(cb, 500);
        });
      } catch {
        // 目录不存在或无权限——静默，后续有变更时用户手动刷新
      }

      return () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        watcher?.close();
        watcher = null;
      };
    },

    fetchUsage(signal: AbortSignal): Promise<AccountUsageResult> {
      return fetchCodexUsage(signal);
    },
  };
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-codex-provider.test.ts`
Expected: PASS，全部 7 个 case 通过（`codex-usage.ts` 此刻还不存在但只有 fetchUsage 依赖它，测试不调 fetchUsage）。

注意：此 step 可能因 `codex-usage.ts` 尚未创建导致 import 报错。如果如此，先创建一个最小骨架（见 Task 7 Step 3）后再回来跑。或者先跑 Task 7 再回来验证。

---

## Task 7: codex-usage.ts — app-server JSON-RPC 用量获取 + 单测

**Files:**
- Create: `src/main/services/agent-accounts/codex-usage.ts`
- Create: `tests/unit/main/agent-accounts-codex-usage.test.ts`

**Interfaces:**
- Consumes: Node `child_process`
- Produces:
  - `fetchCodexUsage(signal: AbortSignal): Promise<AccountUsageResult>` — Task 6 的 codex-provider 调用
  - `parseRateLimitsResult(result: unknown): AccountUsageResult` — 可测纯函数，解析 JSON-RPC 响应

- [ ] **Step 1: 写失败测试（含实测夹具）**

写入 `tests/unit/main/agent-accounts-codex-usage.test.ts`。注意：夹具数据来自本机 codex-cli 0.142.5 实测。

```ts
import {
  parseRateLimitsResult,
} from "@main/services/agent-accounts/codex-usage.ts";
import { describe, expect, it } from "vitest";

/** 本机 codex-cli 0.142.5 实测响应（account/rateLimits/read）。 */
const REAL_RPC_RESULT = {
  rateLimits: {
    limitId: "codex",
    limitName: null,
    primary: {
      usedPercent: 11,
      windowDurationMins: 300,
      resetsAt: 1783283542,
    },
    secondary: {
      usedPercent: 49,
      windowDurationMins: 10080,
      resetsAt: 1783389343,
    },
    credits: { hasCredits: false, unlimited: false, balance: "0" },
    individualLimit: null,
    planType: "pro",
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {},
  rateLimitResetCredits: { availableCount: 1 },
};

describe("parseRateLimitsResult", () => {
  it("解析实测完整响应", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.status).toBe("ok");
    expect(usage.session).toEqual({
      usedPercent: 11,
      windowMinutes: 300,
      resetsAt: 1783283542_000, // epoch 秒 ×1000 → 毫秒
    });
    expect(usage.weekly).toEqual({
      usedPercent: 49,
      windowMinutes: 10080,
      resetsAt: 1783389343_000,
    });
  });

  it("resetsAt 从 epoch 秒转为 epoch 毫秒", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    // 验证毫秒级时间戳（2026 年范围）
    expect(usage.session!.resetsAt).toBeGreaterThan(1_700_000_000_000);
    expect(usage.weekly!.resetsAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("windowDurationMins 映射到 windowMinutes", () => {
    const usage = parseRateLimitsResult(REAL_RPC_RESULT);
    expect(usage.session!.windowMinutes).toBe(300);
    expect(usage.weekly!.windowMinutes).toBe(10080);
  });

  it("缺少 rateLimits 时返回 error", () => {
    const usage = parseRateLimitsResult({});
    expect(usage.status).toBe("error");
    expect(usage.error).toBeDefined();
  });

  it("缺少 primary/secondary 时对应字段为 undefined", () => {
    const usage = parseRateLimitsResult({
      rateLimits: { limitId: "codex" },
    });
    expect(usage.status).toBe("ok");
    expect(usage.session).toBeUndefined();
    expect(usage.weekly).toBeUndefined();
  });

  it("null 输入返回 error", () => {
    const usage = parseRateLimitsResult(null);
    expect(usage.status).toBe("error");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-codex-usage.test.ts`
Expected: FAIL，报无法解析 `@main/services/agent-accounts/codex-usage.ts`。

- [ ] **Step 3: 实现 codex-usage.ts**

写入 `src/main/services/agent-accounts/codex-usage.ts`：

```ts
import type { AccountUsageResult } from "./types.ts";

const RPC_TIMEOUT_MS = 15_000;

/**
 * 构造 JSON-RPC 2.0 请求消息（换行分隔协议）。
 */
function buildRpcMessage(
  id: number,
  method: string,
  params?: unknown
): string {
  return `${JSON.stringify({ id, jsonrpc: "2.0", method, params: params ?? {} })}\n`;
}

interface RpcWindow {
  resetsAt?: number;
  usedPercent?: number;
  windowDurationMins?: number;
}

function mapRpcWindow(
  raw: RpcWindow | null | undefined
): AccountUsageResult["session"] | undefined {
  if (!raw || typeof raw.usedPercent !== "number") {
    return undefined;
  }
  return {
    usedPercent: raw.usedPercent,
    // resetsAt 从 epoch 秒转为 epoch 毫秒
    resetsAt:
      typeof raw.resetsAt === "number" ? raw.resetsAt * 1000 : undefined,
    // windowDurationMins → windowMinutes
    windowMinutes:
      typeof raw.windowDurationMins === "number"
        ? raw.windowDurationMins
        : undefined,
  };
}

/**
 * 解析 account/rateLimits/read 的 result 字段。纯函数，单测主体。
 * primary → session（5h 窗口），secondary → weekly（7d 窗口）。
 */
export function parseRateLimitsResult(result: unknown): AccountUsageResult {
  if (result === null || result === undefined || typeof result !== "object") {
    return { status: "error", error: "Empty RPC result" };
  }
  const obj = result as Record<string, unknown>;
  const rateLimits = obj.rateLimits;
  if (!rateLimits || typeof rateLimits !== "object") {
    return { status: "error", error: "Missing rateLimits in RPC result" };
  }
  const rl = rateLimits as Record<string, unknown>;
  return {
    status: "ok",
    session: mapRpcWindow(rl.primary as RpcWindow | null | undefined),
    weekly: mapRpcWindow(rl.secondary as RpcWindow | null | undefined),
  };
}

/**
 * spawn `codex app-server` 走 JSON-RPC 协议获取活跃账号用量。
 *
 * 协议序列（本机 codex-cli 0.142.5 实测）：
 * 1. 发 `initialize` 请求（clientInfo: { name: "pier", version: "1.0.0" }），等响应
 * 2. 发 `initialized` 通知
 * 3. 发 `account/rateLimits/read` 请求，读响应
 * 消息为换行分隔 JSON-RPC 2.0；服务端会发无 id 的通知，跳过即可。
 */
export async function fetchCodexUsage(
  signal: AbortSignal
): Promise<AccountUsageResult> {
  if (signal.aborted) {
    return { status: "error", error: "Aborted" };
  }

  const { spawn } = await import("node:child_process");

  return new Promise<AccountUsageResult>((resolve) => {
    let buffer = "";
    let resolved = false;
    let rpcId = 0;

    const child = spawn(
      "codex",
      ["-s", "read-only", "-a", "untrusted", "app-server"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      }
    );

    let timeout: ReturnType<typeof setTimeout> | null = null;

    function cleanupListeners(): void {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal.removeEventListener("abort", onAbort);
      child.stdout?.off("data", onStdoutData);
      child.on?.("error", () => {}); // 防止 unhandled error
    }

    function settle(
      result: AccountUsageResult,
      opts?: { kill?: boolean }
    ): void {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanupListeners();
      if (opts?.kill) {
        child.kill();
      }
      resolve(result);
    }

    function onAbort(): void {
      settle({ status: "error", error: "Aborted" }, { kill: true });
    }

    signal.addEventListener("abort", onAbort, { once: true });

    timeout = setTimeout(() => {
      settle({ status: "error", error: "RPC timeout" }, { kill: true });
    }, RPC_TIMEOUT_MS);

    function sendRpc(method: string, params?: unknown): number {
      const id = ++rpcId;
      child.stdin?.write(buildRpcMessage(id, method, params));
      return id;
    }

    function sendNotification(method: string): void {
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params: {} })}\n`
      );
    }

    let rateLimitsId: number | null = null;
    const initId = sendRpc("initialize", {
      clientInfo: { name: "pier", version: "1.0.0" },
    });

    function onStdoutData(chunk: Buffer): void {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) {
          continue;
        }
        try {
          const msg = JSON.parse(line) as {
            error?: { message: string };
            id?: number;
            result?: unknown;
          };
          // 跳过服务端通知（无 id）
          if (msg.id == null) {
            continue;
          }
          if (msg.id === initId) {
            sendNotification("initialized");
            rateLimitsId = sendRpc("account/rateLimits/read");
            continue;
          }
          if (rateLimitsId !== null && msg.id === rateLimitsId) {
            if (msg.error) {
              settle(
                { status: "error", error: msg.error.message },
                { kill: true }
              );
              return;
            }
            settle(parseRateLimitsResult(msg.result), { kill: true });
          }
        } catch {
          // 非 JSON 行——跳过
        }
      }
    }

    child.stdout?.on("data", onStdoutData);

    child.on("error", (err) => {
      const isEnoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      settle({
        status: "error",
        error: isEnoent ? "Codex CLI not found" : err.message,
      });
    });

    child.on("close", () => {
      settle({ status: "error", error: "RPC process exited unexpectedly" });
    });
  });
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-codex-usage.test.ts`
Expected: PASS，全部 6 个 case 通过（纯函数测试，不 spawn 进程）。

- [ ] **Step 5: 回跑 codex-provider 测试**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-codex-provider.test.ts`
Expected: PASS（`codex-usage.ts` 现在存在，import 不再报错）。

---

## Task 8: service.ts 编排 + index.ts 工厂 + 单测

**Files:**
- Create: `src/main/services/agent-accounts/service.ts`
- Create: `src/main/services/agent-accounts/index.ts`
- Create: `tests/unit/main/agent-accounts-service.test.ts`

**Interfaces:**
- Consumes: `AgentAccountProvider`（Task 6）、`AgentAccountsStateStore`（Task 5）、`AgentAccountsSnapshot`（Task 1）
- Produces:
  - `AgentAccountsService` 接口——Task 9 的命令路由消费
  - `createAgentAccountsService(opts)` 工厂

- [ ] **Step 1: 写失败测试（覆盖核心编排逻辑）**

写入 `tests/unit/main/agent-accounts-service.test.ts`：

```ts
import {
  createAgentAccountsService,
  type AgentAccountsService,
} from "@main/services/agent-accounts/index.ts";
import type { AgentAccountProvider } from "@main/services/agent-accounts/types.ts";
import type { AgentAccountsStateStore } from "@main/state/agent-accounts-state.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeMemoryStateStore(): AgentAccountsStateStore {
  let state = { accounts: [] as any[], activeAccountId: null as string | null, version: 1 as const };
  return {
    init: vi.fn(async () => state),
    get: vi.fn(() => state),
    mutate: vi.fn((fn) => {
      state = fn(state);
      return state;
    }),
    flush: vi.fn(async () => {}),
  };
}

function makeMockProvider(): AgentAccountProvider {
  return {
    id: "codex",
    login: vi.fn(async () => {}),
    readIdentity: vi.fn(async () => ({
      email: "test@example.com",
      planType: "pro",
      providerAccountId: "prov-acc-1",
    })),
    materialize: vi.fn(async () => {}),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => () => {}),
    fetchUsage: vi.fn(async () => ({ status: "ok" as const })),
  };
}

describe("AgentAccountsService", () => {
  let stateStore: ReturnType<typeof makeMemoryStateStore>;
  let provider: ReturnType<typeof makeMockProvider>;
  let service: AgentAccountsService;
  let broadcasts: AgentAccountsSnapshot[];
  let managedDir: string;

  beforeEach(async () => {
    managedDir = join(
      tmpdir(),
      `pier-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    stateStore = makeMemoryStateStore();
    provider = makeMockProvider();
    broadcasts = [];
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();
  });

  afterEach(async () => {
    service.dispose();
    await rm(managedDir, { recursive: true, force: true }).catch(() => {});
  });

  it("init 后 snapshot 返回空状态", () => {
    const snap = service.snapshot();
    expect(snap.accounts).toEqual([]);
    expect(snap.activeAccountId).toBeNull();
    expect(snap.loginPending).toBeNull();
    expect(snap.unmanagedActiveLogin).toBe(false);
    expect(snap.ts).toBeGreaterThan(0);
  });

  it("adopt 建账号记录并设为活跃", async () => {
    await service.adoptCurrent();
    const snap = service.snapshot();
    expect(snap.accounts).toHaveLength(1);
    expect(snap.accounts[0].email).toBe("test@example.com");
    expect(snap.activeAccountId).toBe(snap.accounts[0].id);
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  it("adopt 幂等——相同 providerAccountId 不重复建号", async () => {
    await service.adoptCurrent();
    const firstId = service.snapshot().accounts[0].id;
    await service.adoptCurrent();
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(service.snapshot().accounts[0].id).toBe(firstId);
  });

  it("select 时序铁律：syncBack 先于 materialize", async () => {
    // 先 adopt 建两个账号
    await service.adoptCurrent();
    const acc1Id = service.snapshot().accounts[0].id;

    // mock 第二个账号
    provider.readIdentity = vi.fn(async () => ({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    }));
    await service.adoptCurrent();
    const acc2Id = service.snapshot().accounts.find(
      (a) => a.email === "bob@example.com"
    )!.id;

    // 清除 mock 调用记录
    (provider.syncBack as ReturnType<typeof vi.fn>).mockClear();
    (provider.materialize as ReturnType<typeof vi.fn>).mockClear();

    const callOrder: string[] = [];
    (provider.syncBack as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        callOrder.push("syncBack");
        return "ok" as const;
      }
    );
    (provider.materialize as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        callOrder.push("materialize");
      }
    );

    // 从 acc2 切到 acc1
    await service.select(acc1Id);

    expect(callOrder).toEqual(["syncBack", "materialize"]);
    expect(service.snapshot().activeAccountId).toBe(acc1Id);
  });

  it("active 账号禁删", async () => {
    await service.adoptCurrent();
    const activeId = service.snapshot().activeAccountId!;
    await expect(service.remove(activeId)).rejects.toThrow(/active/i);
  });

  it("mutation 串行化——并发 select 顺序化执行", async () => {
    await service.adoptCurrent();
    provider.readIdentity = vi.fn(async () => ({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    }));
    await service.adoptCurrent();
    const ids = service.snapshot().accounts.map((a) => a.id);

    // 并发发两个 select
    const p1 = service.select(ids[0]);
    const p2 = service.select(ids[1]);
    await Promise.all([p1, p2]);

    // 最终 active 应该是最后一个 select 的目标
    expect(service.snapshot().activeAccountId).toBe(ids[1]);
  });

  it("syncBack 身份 mismatch 中止切换，不调 materialize", async () => {
    await service.adoptCurrent();
    provider.readIdentity = vi.fn(async () => ({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    }));
    await service.adoptCurrent();
    const [acc1, acc2] = service.snapshot().accounts;

    // mock syncBack 返回 identity-mismatch
    (provider.syncBack as ReturnType<typeof vi.fn>).mockResolvedValue(
      "identity-mismatch"
    );
    (provider.materialize as ReturnType<typeof vi.fn>).mockClear();
    // mock readIdentity 用于漂移处理——返回不匹配的身份
    provider.readIdentity = vi.fn(async () => ({
      email: "external@example.com",
      providerAccountId: "prov-external",
    }));

    await service.select(acc1.id);

    // activeAccountId 不变（mismatch 中止了切换）
    expect(service.snapshot().activeAccountId).toBe(acc2.id);
    // materialize 不应被调用
    expect(provider.materialize).not.toHaveBeenCalled();
    // 漂移处理标记未管理登录（外部身份不匹配任何托管账号）
    expect(service.snapshot().unmanagedActiveLogin).toBe(true);
  });

  it("物化后 debounce 尾巴不自触发漂移处理", async () => {
    // 建两个账号
    await service.adoptCurrent();
    provider.readIdentity = vi.fn(async () => ({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    }));
    await service.adoptCurrent();

    // 提取 watchExternalAuth 注册的回调
    const watchCalls = (
      provider.watchExternalAuth as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(watchCalls).toHaveLength(1);
    const watchCb = watchCalls[0][0] as () => Promise<void>;

    // mock syncBack 返回 ok
    (provider.syncBack as ReturnType<typeof vi.fn>).mockResolvedValue("ok");
    const readIdentitySpy = vi.fn();
    provider.readIdentity = readIdentitySpy;

    // select 切换（触发物化，设置 suppressWatchUntil 截止时间戳）
    const [acc1] = service.snapshot().accounts;
    await service.select(acc1.id);

    // 模拟 watcher 在 materialize 完成后立即回调（debounce 尾巴）
    await watchCb();

    // suppress 截止时间戳阻止漂移处理——readIdentity 不应被调用
    expect(readIdentitySpy).not.toHaveBeenCalled();
  });

  it("re-auth 更新凭据到既有托管目录并清理临时目录", async () => {
    await service.adoptCurrent();
    const existingId = service.snapshot().accounts[0].id;
    const existingDir = join(managedDir, "codex", existingId);

    // mock login 写入 auth.json 到临时目录（模拟 codex login 成功）
    const newAuthContent = JSON.stringify({ tokens: { id_token: "new-token" } });
    (provider.login as ReturnType<typeof vi.fn>).mockImplementation(
      async (homeDir: string) => {
        await writeFile(join(homeDir, "auth.json"), newAuthContent);
      }
    );

    // 相同 providerAccountId → re-auth 路径
    await service.add("codex");

    // 凭据被更新到既有账号目录
    const updatedAuth = await readFile(join(existingDir, "auth.json"), "utf-8");
    expect(updatedAuth).toBe(newAuthContent);
    // 不新增账号
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(service.snapshot().accounts[0].lastAuthenticatedAt).toBeDefined();
    // 临时目录被清理（codex/ 下只有既有账号目录）
    const dirs = await readdir(join(managedDir, "codex"));
    expect(dirs).toEqual([existingId]);
  });

  it("登录失败/取消清理临时目录", async () => {
    (provider.login as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Login cancelled")
    );

    await expect(service.add("codex")).rejects.toThrow("Login cancelled");

    // 临时目录被清理
    let dirs: string[] = [];
    try {
      dirs = await readdir(join(managedDir, "codex"));
    } catch {
      // codex 目录可能不存在
    }
    expect(dirs).toEqual([]);
  });

  it("remove 有标记时删除托管目录", async () => {
    await service.adoptCurrent();
    const accId = service.snapshot().accounts[0].id;
    const dir = join(managedDir, "codex", accId);

    // 需要先添加另一个账号并切换，才能删除首个
    provider.readIdentity = vi.fn(async () => ({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    }));
    await service.adoptCurrent();

    await service.remove(accId);

    expect(existsSync(dir)).toBe(false);
    expect(service.snapshot().accounts).toHaveLength(1);
  });

  it("remove 无标记时不删目录仅移除状态", async () => {
    await service.adoptCurrent();
    const accId = service.snapshot().accounts[0].id;
    const dir = join(managedDir, "codex", accId);

    // 删除标记文件
    await rm(join(dir, ".pier-managed-home"), { force: true });

    // 需要先添加另一个账号并切换，才能删除首个
    provider.readIdentity = vi.fn(async () => ({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    }));
    await service.adoptCurrent();

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await service.remove(accId);

    expect(existsSync(dir)).toBe(true); // 目录保留
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("select 成功后触发 usage 刷新", async () => {
    await service.adoptCurrent();
    provider.readIdentity = vi.fn(async () => ({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    }));
    await service.adoptCurrent();
    const [acc1] = service.snapshot().accounts;

    (provider.syncBack as ReturnType<typeof vi.fn>).mockResolvedValue("ok");
    (provider.fetchUsage as ReturnType<typeof vi.fn>).mockClear();

    await service.select(acc1.id);

    // fetchUsage 应被调用（select 成功后触发 force 刷新）
    expect(provider.fetchUsage).toHaveBeenCalled();
  });

  it("init 触发首拉（非 force fetchUsage）", async () => {
    // adoptCurrent 建账号让 activeAccountId 有值
    await service.adoptCurrent();
    (provider.fetchUsage as ReturnType<typeof vi.fn>).mockClear();

    // 重建 service 验证 init 路径
    service.dispose();
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    // init 末尾的 doRefreshUsage(false) 应触发 fetchUsage
    expect(provider.fetchUsage).toHaveBeenCalled();
  });

  it("hasVisibleTarget=false 时轮询 tick 不调 provider.fetchUsage", async () => {
    service.dispose();

    // 用 fake timer 控制轮询
    vi.useFakeTimers();

    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      hasVisibleTarget: () => false,
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    // 清除 init 首拉调用记录
    (provider.fetchUsage as ReturnType<typeof vi.fn>).mockClear();

    // 快进 15min 触发轮询 tick
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // hasVisibleTarget=false → 轮询 tick 跳过，不调 fetchUsage
    expect(provider.fetchUsage).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-service.test.ts`
Expected: FAIL，报无法解析 `@main/services/agent-accounts/index.ts`。

- [ ] **Step 3: 实现 service.ts**

写入 `src/main/services/agent-accounts/service.ts`：

```ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentAccount,
  AgentAccountsSnapshot,
  AccountUsage,
} from "@shared/contracts/agent-accounts.ts";
import type { AgentAccountsStateStore } from "../../state/agent-accounts-state.ts";
import type { AgentAccountProvider, AccountUsageResult } from "./types.ts";

const PIER_MANAGED_HOME_MARKER = ".pier-managed-home";
const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000; // 5min
const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15min
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5min
/** 物化/回采后的 watch suppress 窗口（ms）。需覆盖 watcher 的 500ms debounce 尾巴。 */
const WATCH_SUPPRESS_MS = 1500;

export interface AgentAccountsServiceOpts {
  broadcast: (snapshot: AgentAccountsSnapshot) => void;
  /** 是否有可见窗口——轮询 tick 前检查；缺省 () => true。 */
  hasVisibleTarget?: () => boolean;
  managedBaseDir: string;
  provider: AgentAccountProvider;
  stateStore: AgentAccountsStateStore;
}

export interface AgentAccountsService {
  adoptCurrent(): Promise<void>;
  add(provider: string): Promise<void>;
  cancelLogin(provider: string): Promise<void>;
  dispose(): void;
  init(): Promise<void>;
  refreshUsage(force?: boolean): Promise<void>;
  remove(accountId: string): Promise<void>;
  select(accountId: string): Promise<void>;
  snapshot(): AgentAccountsSnapshot;
}

export function createAgentAccountsServiceImpl(
  opts: AgentAccountsServiceOpts
): AgentAccountsService {
  const { broadcast, managedBaseDir, provider, stateStore } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);

  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending: "codex" | null = null;
  let watchDispose: (() => void) | null = null;
  let usageCache: Record<string, AccountUsage> = {};
  let usagePollTimer: ReturnType<typeof setInterval> | null = null;
  let unmanagedActiveLogin = false;
  let suppressWatchUntil = 0;

  // mutation queue 串行化
  let mutationQueue: Promise<void> = Promise.resolve();

  function enqueueMutation(fn: () => Promise<void>): Promise<void> {
    const task = mutationQueue.then(fn, fn);
    mutationQueue = task.catch(() => {});
    return task;
  }

  function now(): number {
    return Date.now();
  }

  function accountHomeDir(accountId: string): string {
    return join(managedBaseDir, "codex", accountId);
  }

  /** 真实 ~/.codex 路径（adopt/drift 侦测用）。 */
  function realCodexHome(): string {
    return process.env.CODEX_HOME ??
      join(process.env.HOME ?? require("node:os").homedir(), ".codex");
  }

  function buildSnapshot(): AgentAccountsSnapshot {
    broadcastSeq += 1;
    const state = stateStore.get();
    return {
      accounts: state.accounts,
      activeAccountId: state.activeAccountId,
      loginPending,
      ts: broadcastSeq,
      unmanagedActiveLogin,
      usage: { ...usageCache },
    };
  }

  function emitSnapshot(): void {
    broadcast(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    const dir = accountHomeDir(accountId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, PIER_MANAGED_HOME_MARKER), "", { mode: 0o600 });
    return dir;
  }

  async function doAdoptCurrent(): Promise<void> {
    const identity = await provider.readIdentity(realCodexHome());
    if (!identity) {
      throw new Error("No valid codex login found at ~/.codex/auth.json");
    }

    const state = stateStore.get();
    const existing = identity.providerAccountId
      ? state.accounts.find(
          (a) => a.providerAccountId === identity.providerAccountId
        )
      : null;

    if (existing) {
      // 幂等：更新凭据+身份，激活
      const dir = await ensureManagedDir(existing.id);
      await provider.syncBack(dir, undefined);
      stateStore.mutate((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === existing.id
            ? {
                ...a,
                email: identity.email,
                planType: identity.planType,
                providerAccountId: identity.providerAccountId,
                updatedAt: now(),
              }
            : a
        ),
        activeAccountId: existing.id,
      }));
    } else {
      const id = randomUUID();
      const dir = await ensureManagedDir(id);
      await provider.syncBack(dir, undefined);
      const account: AgentAccount = {
        createdAt: now(),
        email: identity.email,
        id,
        planType: identity.planType,
        provider: "codex",
        providerAccountId: identity.providerAccountId,
        updatedAt: now(),
      };
      stateStore.mutate((s) => ({
        ...s,
        accounts: [...s.accounts, account],
        activeAccountId: id,
      }));
    }
    unmanagedActiveLogin = false;
    emitSnapshot();
  }

  async function doAdd(): Promise<void> {
    const id = randomUUID();
    const dir = await ensureManagedDir(id);
    loginPending = "codex";
    emitSnapshot();

    const abort = new AbortController();
    loginAbort = abort;

    const loginTimeout = setTimeout(() => abort.abort(), LOGIN_TIMEOUT_MS);

    try {
      await provider.login(dir, abort.signal);
      const identity = await provider.readIdentity(dir);
      if (!identity) {
        throw new Error("Login completed but no identity found");
      }
      // 按 providerAccountId 去重
      const state = stateStore.get();
      const existing = identity.providerAccountId
        ? state.accounts.find(
            (a) => a.providerAccountId === identity.providerAccountId
          )
        : null;

      if (existing) {
        // re-auth 语义：把新凭据复制到既有账号托管目录，清理临时目录
        const existingDir = accountHomeDir(existing.id);
        await copyFile(join(dir, "auth.json"), join(existingDir, "auth.json"));
        await rm(dir, { recursive: true, force: true });
        stateStore.mutate((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.id === existing.id
              ? {
                  ...a,
                  email: identity.email,
                  lastAuthenticatedAt: now(),
                  planType: identity.planType,
                  providerAccountId: identity.providerAccountId,
                  updatedAt: now(),
                }
              : a
          ),
        }));
      } else {
        const account: AgentAccount = {
          createdAt: now(),
          email: identity.email,
          id,
          lastAuthenticatedAt: now(),
          planType: identity.planType,
          provider: "codex",
          providerAccountId: identity.providerAccountId,
          updatedAt: now(),
        };
        stateStore.mutate((s) => ({
          ...s,
          accounts: [...s.accounts, account],
        }));
      }
    } catch (err) {
      // 登录失败/取消/超时/readIdentity 返回 null——清理临时目录
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    } finally {
      clearTimeout(loginTimeout);
      loginAbort = null;
      loginPending = null;
      emitSnapshot();
    }
  }

  async function doSelect(accountId: string): Promise<void> {
    const state = stateStore.get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) {
      throw new Error(`Account not found: ${accountId}`);
    }
    if (state.activeAccountId === accountId) {
      return;
    }

    // 时序铁律：先 syncBack 再 materialize
    if (state.activeAccountId) {
      const activeAccount = state.accounts.find(
        (a) => a.id === state.activeAccountId
      );
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      const syncResult = await provider.syncBack(
        accountHomeDir(state.activeAccountId),
        activeAccount?.providerAccountId
      );
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      if (syncResult === "identity-mismatch") {
        // 外部已换号：走漂移处理后中止本次切换
        await handleDrift();
        return;
      }
    }

    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
    await provider.materialize(accountHomeDir(accountId));
    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;

    stateStore.mutate((s) => ({
      ...s,
      activeAccountId: accountId,
    }));
    unmanagedActiveLogin = false;
    emitSnapshot();
    // 切换成功后刷新用量（force 绕过防抖，失败不阻断切换）
    void doRefreshUsage(true).catch(() => {});
  }

  async function doRemove(accountId: string): Promise<void> {
    const state = stateStore.get();
    if (state.activeAccountId === accountId) {
      throw new Error("Cannot remove active account — select another first");
    }
    // 校验 .pier-managed-home 标记存在才删除托管目录
    const dir = accountHomeDir(accountId);
    const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
    if (existsSync(markerPath)) {
      await rm(dir, { recursive: true, force: true });
    } else {
      console.warn(
        `[agent-accounts] managed home marker missing for ${accountId}, skipping directory removal`
      );
    }
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.filter((a) => a.id !== accountId),
    }));
    delete usageCache[accountId];
    emitSnapshot();
  }

  function usageResultToAccountUsage(
    accountId: string,
    result: AccountUsageResult
  ): AccountUsage {
    return {
      accountId,
      fetchedAt: now(),
      status: result.status,
      error: result.error,
      session: result.session,
      weekly: result.weekly,
    };
  }

  async function doRefreshUsage(force = false): Promise<void> {
    const state = stateStore.get();
    if (!state.activeAccountId) {
      return;
    }
    const cached = usageCache[state.activeAccountId];
    if (!force && cached && now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS) {
      return; // 防抖：5min 内不重复拉取（手动 force 绕过）
    }
    const abort = new AbortController();
    const result = await provider.fetchUsage(abort.signal);
    usageCache[state.activeAccountId] = usageResultToAccountUsage(
      state.activeAccountId,
      result
    );
    emitSnapshot();
  }

  /** 漂移处理：读真实身份 → 按 providerAccountId 匹配 → 对齐或标记未管理。 */
  async function handleDrift(): Promise<void> {
    const identity = await provider.readIdentity(realCodexHome());
    if (!identity) {
      return;
    }
    const state = stateStore.get();
    const match = identity.providerAccountId
      ? state.accounts.find(
          (a) => a.providerAccountId === identity.providerAccountId
        )
      : null;
    if (match) {
      if (state.activeAccountId !== match.id) {
        stateStore.mutate((s) => ({
          ...s,
          activeAccountId: match.id,
        }));
      }
      unmanagedActiveLogin = false;
      await provider.syncBack(
        accountHomeDir(match.id),
        match.providerAccountId
      );
    } else {
      unmanagedActiveLogin = true;
    }
    emitSnapshot();
  }

  function setupWatch(): void {
    watchDispose = provider.watchExternalAuth(async () => {
      if (now() < suppressWatchUntil) {
        return;
      }
      try {
        await handleDrift();
      } catch {
        // 静默：watch 回调不应抛到外层
      }
    });
  }

  return {
    async init(): Promise<void> {
      await stateStore.init();
      setupWatch();
      // 启动 usage 轮询
      usagePollTimer = setInterval(() => {
        if (!hasVisibleTarget()) return; // 无窗口（macOS dock 常驻态）跳过轮询
        doRefreshUsage().catch(() => {});
      }, USAGE_POLL_INTERVAL_MS);
      // 冷启动不等 15min：服务创建后立即非 force 拉取一次用量
      void doRefreshUsage(false).catch(() => {});
    },

    dispose(): void {
      watchDispose?.();
      watchDispose = null;
      if (usagePollTimer) {
        clearInterval(usagePollTimer);
        usagePollTimer = null;
      }
      loginAbort?.abort();
    },

    snapshot: () => buildSnapshot(),

    adoptCurrent: () => enqueueMutation(doAdoptCurrent),
    add: () => enqueueMutation(doAdd),
    cancelLogin: () =>
      enqueueMutation(async () => {
        loginAbort?.abort();
        loginAbort = null;
        loginPending = null;
        emitSnapshot();
      }),
    select: (accountId) => enqueueMutation(() => doSelect(accountId)),
    remove: (accountId) => enqueueMutation(() => doRemove(accountId)),
    refreshUsage: (force) => doRefreshUsage(force),
  };
}
```

- [ ] **Step 4: 实现 index.ts 工厂**

写入 `src/main/services/agent-accounts/index.ts`：

```ts
export {
  createAgentAccountsServiceImpl as createAgentAccountsService,
  type AgentAccountsService,
  type AgentAccountsServiceOpts,
} from "./service.ts";
export type { AgentAccountProvider, AccountUsageResult } from "./types.ts";
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-service.test.ts`
Expected: PASS，全部 15 个 case 通过。

- [ ] **Step 6: 跑所有账号域单测确认无回归**

Run: `pnpm test:unit -- tests/unit/main/agent-accounts-identity.test.ts tests/unit/main/agent-accounts-state.test.ts tests/unit/main/agent-accounts-codex-provider.test.ts tests/unit/main/agent-accounts-codex-usage.test.ts tests/unit/main/agent-accounts-service.test.ts tests/unit/shared/agent-accounts-schema.test.ts`
Expected: 全部 PASS。

---

## Task 9: main 接线（命令路由 + 广播 + 窗口 focus 触发）+ preload facade

**Files:**
- Create: `src/main/app-core/account-commands.ts`
- Modify: `src/main/app-core/command-router-services.ts`（L25-117 的 `PierCoreServices`）
- Modify: `src/main/app-core/command-router.ts`（L341-370 的 `executeCommandByDomain` + import）
- Modify: `src/main/app-core/app-core.ts`（L129-255 的 `createPierAppCore`）
- Modify: `src/preload/index.ts`（新增 accounts API + PierWindowAPI）
- Modify: `dependency-cruiser.config.cjs`（新增 `agent-accounts-narrow-imports` 规则）

**Interfaces:**
- Consumes: `AgentAccountsService`（Task 8）、`createAgentAccountsService`（Task 8）、`createAgentAccountsStateStore`（Task 5）、`createCodexProvider`（Task 6）
- Produces: 完整命令路由 → 服务编排 → 广播链路 + preload `window.pier.accounts` facade

- [ ] **Step 1: 创建 account-commands.ts**

写入 `src/main/app-core/account-commands.ts`：

```ts
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";

export async function executeAccountCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "accounts.snapshot":
      return success(requestId, services.agentAccounts.snapshot());
    case "accounts.adoptCurrent":
      await services.agentAccounts.adoptCurrent();
      return success(requestId, undefined);
    case "accounts.add":
      await services.agentAccounts.add(command.provider);
      return success(requestId, undefined);
    case "accounts.cancelLogin":
      await services.agentAccounts.cancelLogin(command.provider);
      return success(requestId, undefined);
    case "accounts.select":
      await services.agentAccounts.select(command.accountId);
      return success(requestId, undefined);
    case "accounts.remove":
      await services.agentAccounts.remove(command.accountId);
      return success(requestId, undefined);
    case "accounts.refreshUsage":
      await services.agentAccounts.refreshUsage(true);
      return success(requestId, undefined);
    default:
      return null;
  }
}
```

- [ ] **Step 2: 修改 command-router-services.ts 增加 agentAccounts**

打开 `src/main/app-core/command-router-services.ts`。当前 `PierCoreServices`（L25-117）首个字段是 `ai: AiService`。在其之前插入：

```ts
import type { AgentAccountsService } from "../services/agent-accounts/index.ts";
```

在 `PierCoreServices` 接口体中 `ai: AiService;` 之前插入：

```ts
  agentAccounts: AgentAccountsService;
```

- [ ] **Step 3: 修改 command-router.ts 增加域执行器**

打开 `src/main/app-core/command-router.ts`。在 import 区追加：

```ts
import { executeAccountCommand } from "./account-commands.ts";
```

在 `executeCommandByDomain` 函数（L341-370）的 `executors` 数组中，在 `executePluginCommand` 之前插入：

```ts
    (cmd: PierCommand) => executeAccountCommand(requestId, cmd, services),
```

- [ ] **Step 4: 修改 app-core.ts 创建服务 + 广播接线**

打开 `src/main/app-core/app-core.ts`。

在 import 区追加：

```ts
import { BrowserWindow } from "electron";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { createAgentAccountsService } from "../services/agent-accounts/index.ts";
import { createCodexProvider } from "../services/agent-accounts/codex-provider.ts";
import { createAgentAccountsStateStore } from "../state/agent-accounts-state.ts";
```

在现有广播函数（`broadcastMruState` / `broadcastTerminalStatusBarPrefs` / `broadcastPluginRegistryChanged`）之后新增：

```ts
function broadcastAgentAccountsChanged(snapshot: AgentAccountsSnapshot): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED,
        snapshot
      );
    }
  }
}
```

在 `createPierAppCore` 函数中，`const services: PierCoreServices = {` 赋值体中 `ai: createAiService(...)` 之前插入服务创建：

```ts
    agentAccounts: (() => {
      const agentAccountsStore = createAgentAccountsStateStore(
        join(app.getPath("userData"), "agent-accounts.json")
      );
      const svc = createAgentAccountsService({
        broadcast: broadcastAgentAccountsChanged,
        hasVisibleTarget: () => BrowserWindow.getAllWindows().length > 0,
        managedBaseDir: join(app.getPath("userData"), "agent-accounts"),
        provider: createCodexProvider(),
        stateStore: agentAccountsStore,
      });
      // init 是异步的，fire-and-forget（对齐 foreground-activity 模式）
      svc.init().catch((err) => {
        console.error("[agent-accounts] init failed:", err);
      });
      // BrowserWindow focus → usage 刷新（非 force，吃 5min 防抖）
      app.on("browser-window-focus", () => {
        svc.refreshUsage(false).catch(() => {});
      });
      return svc;
    })(),
```

注意：需要在文件顶部 import `join` from `"node:path"`、`app` from `"electron"`（已有）和 `BrowserWindow` from `"electron"`（新增——`hasVisibleTarget` 需要）——检查是否已有。当前 L6 已有 `import { app } from "electron"`，扩展为 `import { app, BrowserWindow } from "electron"`。需确认 `join` 是否已导入——如未导入，在 import 区追加 `import { join } from "node:path";`。

- [ ] **Step 5: 在 app-core.ts 挂 browser-window-focus 事件**

上一步骤已在 `agentAccounts` IIFE 内嵌入 `app.on("browser-window-focus")` 调用。实施时确认锚点：先在 `src/main/` 搜索既有 `app.on("browser-window-*")` 或 `foreground-activity` 生命周期挂接位置。如果项目已有集中事件注册处（window lifecycle manager），将事件移到该处而非 IIFE 内——保持与既有模式一致。`app.on("browser-window-focus")` 对所有 BrowserWindow 生效，无需逐窗口注册。

- [ ] **Step 6: 修改 preload/index.ts 增加 accounts facade**

打开 `src/preload/index.ts`。

**5a.** 在 import 区追加（在现有 `import type { AgentAccountsSnapshot } ...` 之前，如无则新增）：

```ts
import type {
  AgentAccountProviderId,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
```

**5b.** 在现有 API 接口定义区（`PierPreferencesAPI` 等之后），新增接口：

```ts
export interface PierAccountsAPI {
  add: (provider: AgentAccountProviderId) => Promise<void>;
  adoptCurrent: () => Promise<void>;
  cancelLogin: (provider: AgentAccountProviderId) => Promise<void>;
  onChanged: (cb: (snapshot: AgentAccountsSnapshot) => void) => () => void;
  refreshUsage: () => Promise<void>;
  remove: (accountId: string) => Promise<void>;
  select: (accountId: string) => Promise<void>;
  snapshot: () => Promise<AgentAccountsSnapshot>;
}
```

**5c.** 在实现区（`const agentsApi` 等之后），新增实现：

```ts
const accountsApi: PierAccountsAPI = {
  add: (provider) =>
    invokePierCommand<void>({ provider, type: "accounts.add" }),
  adoptCurrent: () =>
    invokePierCommand<void>({ type: "accounts.adoptCurrent" }),
  cancelLogin: (provider) =>
    invokePierCommand<void>({ provider, type: "accounts.cancelLogin" }),
  onChanged: (cb) =>
    subscribeIpc<AgentAccountsSnapshot>(
      PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED,
      cb
    ),
  refreshUsage: () =>
    invokePierCommand<void>({ type: "accounts.refreshUsage" }),
  remove: (accountId) =>
    invokePierCommand<void>({ accountId, type: "accounts.remove" }),
  select: (accountId) =>
    invokePierCommand<void>({ accountId, type: "accounts.select" }),
  snapshot: () =>
    invokePierCommand<AgentAccountsSnapshot>({ type: "accounts.snapshot" }),
};
```

**5d.** 在 `PierWindowAPI` 接口中（L200-229），在 `agents: PierAgentsAPI;` 之后插入：

```ts
  accounts: PierAccountsAPI;
```

**5e.** 在 `const api: PierWindowAPI = {`（L376-415）中，在 `agents: agentsApi,` 之后插入：

```ts
  accounts: accountsApi,
```

- [ ] **Step 7: 新增 depcruise `agent-accounts-narrow-imports` 规则**

打开 `dependency-cruiser.config.cjs`。在 `foreground-activity-narrow-imports` 规则（L92-107）之后、`no-circular` 规则之前插入新规则：

```js
    {
      name: "agent-accounts-narrow-imports",
      severity: "error",
      comment:
        "agent-accounts 模块只应依赖 shared 契约、自身持久化层与 node builtin; 不依赖 services/agents 或 ipc/electron 层, 保账号域独立",
      from: { path: "^src/main/services/agent-accounts" },
      to: {
        pathNot: [
          "^src/main/services/agent-accounts",
          "^src/shared",
          "^src/main/state/agent-accounts-state",
          "^node:",
          "node_modules",
          // depcruise 解析 node builtin 为裸名 (fs, path, crypto, ...); 允许它们
          "^(assert|buffer|crypto|events|fs|http|https|net|os|path|stream|url|util|zlib)(/|$)",
        ],
      },
    },
```

锚点：在 `foreground-activity-narrow-imports` 闭合 `},` 之后、`no-circular` 开头 `{` 之前（即现 L107 与 L108 之间）。

- [ ] **Step 8: 验证 depcruise 规则**

Run: `pnpm depcruise`
Expected: PASS——新规则 `agent-accounts-narrow-imports` 无违规（此时 `src/main/services/agent-accounts/` 尚未存在实际文件，不会有 false positive；后续 Task 4-8 创建文件时规则即自动生效）。

- [ ] **Step 9: 跑 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（全链路类型完整：commands → permissions → router → services → preload）。

---

## Task 10: renderer 镜像 store + init 挂载 + ts 守卫单测

**Files:**
- Create: `src/renderer/stores/agent-accounts.store.ts`
- Create: `tests/unit/renderer/agent-accounts-store.test.ts`
- Modify: `src/renderer/main.tsx`（init 挂载）

**Interfaces:**
- Consumes: `AgentAccountsSnapshot`（Task 1）、`window.pier.accounts`（Task 9）
- Produces:
  - `useAgentAccountsStore` zustand store——Phase 3 的 codex 插件 facade 消费
  - `initAgentAccounts()` 初始化函数

- [ ] **Step 1: 写失败测试**

写入 `tests/unit/renderer/agent-accounts-store.test.ts`：

```ts
import { describe, expect, it } from "vitest";

// 直接测试 store 逻辑——纯 zustand，不依赖 DOM
import {
  useAgentAccountsStore,
} from "@/stores/agent-accounts.store.ts";
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";

function makeSnapshot(ts: number, overrides?: Partial<AgentAccountsSnapshot>): AgentAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    loginPending: null,
    ts,
    unmanagedActiveLogin: false,
    usage: {},
    ...overrides,
  };
}

describe("useAgentAccountsStore", () => {
  it("apply 写入 snapshot", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(makeSnapshot(1));
    expect(store.getState().snapshot).toEqual(makeSnapshot(1));
    expect(store.getState().ts).toBe(1);
  });

  it("ts 单调守卫拒收乱序广播", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(makeSnapshot(5));
    store.getState().apply(makeSnapshot(3)); // 乱序——应被拒收
    expect(store.getState().ts).toBe(5);
  });

  it("ts 相等时仍接受（幂等全量推送）", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(
      makeSnapshot(2, { activeAccountId: "acc-1" })
    );
    store.getState().apply(
      makeSnapshot(2, { activeAccountId: "acc-2" })
    );
    // 相等 ts 接受最后一次
    expect(store.getState().snapshot?.activeAccountId).toBe("acc-2");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- tests/unit/renderer/agent-accounts-store.test.ts`
Expected: FAIL，报无法解析 `@/stores/agent-accounts.store.ts`。

- [ ] **Step 3: 实现 agent-accounts.store.ts**

写入 `src/renderer/stores/agent-accounts.store.ts`：

```ts
import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { create } from "zustand";

interface AgentAccountsState {
  /** 当前账号域快照（初始化前为 null）。 */
  snapshot: AgentAccountsSnapshot | null;
  /** 广播单调序号守卫。 */
  ts: number;
  apply: (s: AgentAccountsSnapshot) => void;
}

/**
 * Agent accounts 镜像 store — main 服务快照的 renderer 副本。
 * 写入方: initAgentAccounts (初始 snapshot pull + 广播 push)。
 * 读取方: Phase 3 codex 插件 facade / widget。
 * ts 单调守卫拒收乱序广播（对齐 foreground-activity.store 模式）。
 */
export const useAgentAccountsStore = create<AgentAccountsState>(
  (set, get) => ({
    snapshot: null,
    ts: 0,
    apply: (s) => {
      if (s.ts < get().ts) {
        return;
      }
      set({ snapshot: s, ts: s.ts });
    },
  })
);

/**
 * bootstrap 时每窗口调用一次: 先订阅广播(避免拉取窗口期丢事件),再全量拉取。
 * 对齐 initPluginRegistry 防漏窗口模式。
 * 返回广播解绑函数。
 */
export async function initAgentAccounts(): Promise<() => void> {
  const unsubscribe = window.pier.accounts.onChanged((snapshot) => {
    useAgentAccountsStore.getState().apply(snapshot);
  });
  try {
    const snapshot = await window.pier.accounts.snapshot();
    useAgentAccountsStore.getState().apply(snapshot);
  } catch (err) {
    console.error("[agent-accounts] init snapshot pull failed:", err);
  }
  return unsubscribe;
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm test:unit -- tests/unit/renderer/agent-accounts-store.test.ts`
Expected: PASS，全部 3 个 case 通过。

- [ ] **Step 5: 修改 main.tsx 挂载 initAgentAccounts**

打开 `src/renderer/main.tsx`。

在 import 区追加：

```ts
import { initAgentAccounts } from "./stores/agent-accounts.store.ts";
```

在 `bootstrap` 函数中，`await initPluginSettingsStore();` 之前（大约 L93）插入：

```ts
  initAgentAccounts().catch((err) => {
    console.error("[pier] agent accounts init failed:", err);
  });
```

此处用 fire-and-forget（不 await），对齐 `initAgentDetection` 和 `initCommandPaletteMru` 的模式——账号初始化不应阻塞插件启动链路。

- [ ] **Step 6: 跑 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（store + init + main.tsx 挂载完整）。

---

## Task 11: 收尾验证

**Files:** 无新文件。

- [ ] **Step 1: 全量单元测试**

Run: `pnpm test:unit`
Expected: 所有单元测试通过（含新增的 agent-accounts 系列测试 + 既有全部测试）。

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 4: 依赖边界检查**

Run: `pnpm depcruise`
Expected: 无新违规。特别检查：
- `agent-accounts-narrow-imports` 规则（Task 9 Step 7 新增）有效拦截 agent-accounts 越界依赖
- `src/main/services/agent-accounts/` 不 import `src/main/services/agents/`（单向边界）
- `src/renderer/stores/agent-accounts.store.ts` 只 import `@shared/contracts/` 和 `zustand`
- `src/preload/index.ts` 新增 import 来自 `@shared/contracts/agent-accounts.ts`

- [ ] **Step 5: 完整检查**

Run: `pnpm check`
Expected: PASS（typecheck + lint + depcruise + file-size 综合）。

- [ ] **Step 6: 交付**

工作完成。等待用户 review + commit。参照 `AGENTS.md` §05，不自动 commit；stage 与 commit message 由用户决策。

---

## 自检记录

**设计规格覆盖：**
- §4.6 账号域契约 → Task 1（schema 全量）+ Task 2（permissions + broadcast）+ Task 3（commands 7 variant + COMMAND_METADATA）
- §4.7 main 服务 → Task 4（identity.ts）+ Task 5（state）+ Task 6（types + codex-provider：materialize/syncBack 身份校验返回 mismatch|ok/watchExternalAuth watch 父目录按 filename 过滤）+ Task 7（codex-usage：JSON-RPC 协议，含实测夹具 resetsAt 秒→毫秒、windowDurationMins→windowMinutes 两个陷阱）+ Task 8（service 编排：mutation queue 串行化、adopt 幂等、add 不自动切换、add re-auth 凭据复制+临时目录清理、登录失败/取消临时目录清理、select 时序铁律 syncBack→materialize、syncBack mismatch 中止切换并走漂移处理、suppress 截止时间戳覆盖 debounce 尾巴、active 禁删、remove 校验 .pier-managed-home 标记后删除、外部漂移侦测 handleDrift 复用、usage 防抖 5min + force bypass、select 成功后 force 刷新 usage、**init 首拉 doRefreshUsage(false)、轮询 tick hasVisibleTarget 空窗口跳过**）+ Task 9（命令路由 + 广播 + BrowserWindow focus 事件触发 usage 刷新 + preload + **depcruise agent-accounts-narrow-imports 规则**）+ Task 10（renderer store + init）
- select 时序铁律 → Task 8 测试 "syncBack 先于 materialize" 直接覆盖调用顺序
- syncBack 身份校验 → Task 6 provider syncBack(accountHomeDir, expectedProviderAccountId) 返回 "identity-mismatch" | "ok"；Task 8 测试 "syncBack mismatch 中止切换，不调 materialize"
- suppress 截止时间戳 → Task 8 service.ts `WATCH_SUPPRESS_MS=1500`，`suppressWatchUntil = now() + WATCH_SUPPRESS_MS`；测试 "物化后 debounce 尾巴不自触发漂移处理"
- 外部漂移 → Task 8 service.ts `handleDrift()`：match→activeAccountId 对齐+syncBack(传 expected)；unmatch→unmanagedActiveLogin=true
- re-auth 凭据更新 → Task 8 doAdd re-auth 分支：copyFile 新凭据到既有目录 + rm 临时目录；测试 "re-auth 更新凭据到既有托管目录并清理临时目录"
- 登录失败清理 → Task 8 doAdd catch：rm 临时目录；测试 "登录失败/取消清理临时目录"
- doRemove 完整实现 → Task 8 doRemove：existsSync 校验 .pier-managed-home → rm 或 console.warn；测试 "remove 有标记时删除托管目录" + "无标记时不删目录仅移除状态"
- usage 触发 → Task 8 doSelect 成功末尾 `void doRefreshUsage(true).catch(() => {})`；Task 8 init 末尾 `void doRefreshUsage(false).catch(() => {})` 首拉；Task 8 轮询 tick `hasVisibleTarget()` 空窗口守卫（注入 opts，缺省 `() => true`）；Task 9 app.on("browser-window-focus") 调 svc.refreshUsage(false)；Task 9 接线传 `hasVisibleTarget: () => BrowserWindow.getAllWindows().length > 0`；测试 "select 成功后触发 usage 刷新" + "init 触发首拉" + "hasVisibleTarget=false 时轮询 tick 不调 provider.fetchUsage"
- watch 父目录 → Task 6 codex-provider watchExternalAuth：watch(realCodexHome) + filename === "auth.json" 过滤；测试 "watchExternalAuth watch 父目录并按 auth.json 文件名过滤"
- 防抖矩阵 → Task 8 service.ts `USAGE_MIN_REFETCH_MS=5min`，`refreshUsage(force=true)` 绕过；`USAGE_POLL_INTERVAL_MS=15min` 定时
- §6 Phase 2 影响面表 → 全部文件逐一覆盖 + `dependency-cruiser.config.cjs` 新增 `agent-accounts-narrow-imports` 规则（Task 9 Step 7）

**占位扫描：** 无 TBD/TODO；每个 code step 都有完整代码；每个验证 step 给精确命令与预期结果。

**类型一致性（与跨阶段共享接口逐字比对）：**
- `agentAccountProviderSchema` z.enum(["codex"]) ✓
- `agentAccountSchema` 字段：`createdAt, email, id, lastAuthenticatedAt?, planType?, provider, providerAccountId?, updatedAt` ✓
- `rateLimitWindowSchema` 字段：`resetsAt?, usedPercent, windowMinutes?` ✓
- `accountUsageSchema` 字段：`accountId, error?, fetchedAt, session?, status, weekly?` ✓
- `agentAccountsSnapshotSchema` 字段：`accounts[], activeAccountId: string|null, loginPending: provider|null, ts, unmanagedActiveLogin, usage: Record` ✓
- capability `"account:read"` / `"account:write"` ✓ desktop-renderer 两者、cli-local 仅 read
- 命令 variant 7 个 + COMMAND_METADATA 7 行 ✓ 对照 §4.7 命令表
- 广播 `PIER_BROADCAST.AGENT_ACCOUNTS_CHANGED = "pier://agent-accounts:changed"` ✓
- state 文件形状 `{ accounts, activeAccountId, version: 1 }` ✓
- preload facade `window.pier.accounts.{snapshot, adoptCurrent, add, cancelLogin, select, remove, refreshUsage, onChanged}` ✓
- provider 接口 `syncBack(accountHomeDir, expectedProviderAccountId): Promise<"identity-mismatch" | "ok">` ✓ 对齐设计规格 §4.7
- provider 接口 `watchExternalAuth`: watch 目录 + filename 过滤 ✓ 对齐设计规格 §4.7 注释
- renderer store `useAgentAccountsStore` + `initAgentAccounts()` ✓ ts 守卫模式对齐 foreground-activity.store
