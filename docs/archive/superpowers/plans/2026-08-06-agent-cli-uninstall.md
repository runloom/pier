# 智能体 CLI 卸载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置 → 智能体中提供 source-aware 的 CLI **卸载**，并统一 install / update / uninstall 的「项目默认（specs）+ 用户覆盖（prefs）」命令配置模型。

**Architecture:** 扩展现有 `AgentLifecycleService`（不新建并行服务）。L1 默认来自 `lifecycle/specs/*` 通道与可选 `defaultShellCommands`；L2 为 `agent*Commands` 偏好。卸载计划进 `plan/uninstall.ts`，运行进 `run-uninstall.ts`；`planLifecycle` / `run` 必须三元分支，禁止 uninstall fall-through 成 update。UI 仅在展开详情；破坏性确认 `intent: "destructive"`。

**Tech Stack:** Electron main · Zod 契约 · Vitest · React 设置页 · i18n · 现有 `LifecycleRunner` / locks / probe

**Spec:** [docs/superpowers/specs/2026-08-06-agent-cli-uninstall-design.md](../specs/2026-08-06-agent-cli-uninstall-design.md)

## Global Constraints

- 命令解析：**用户覆盖 → 项目默认（source-aware）→ 无命令**；禁止业务硬编码 `npm uninstall …`
- 项目默认唯一落点：`src/main/services/agents/lifecycle/specs/`（K20–K22）
- 用户覆盖：`agentInstallCommands` / `agentUpdateCommands` / `agentUninstallCommands`（userData，默认 `{}`，**不**拷贝 L1）
- 仅 `support === "full"` 可跑 / 可显示卸载；guided 永不显示卸载 UI（K5/K18）
- 卸载目标：PATH 默认副本 only（K2）；成功 = 后置 `after.detected === false`（K9）
- PM 成功但仍 detected → 硬失败 `still_detected`，alert 列出剩余 `installs[]`（非 soft）
- 不删配置/凭据/会话；不 kill 会话；无卸载全部；不调 `plugin.uninstall`
- 文件硬顶 500 行：`plan/build.ts` 已 470、`service.ts` 422 —— **必须**拆 `plan/uninstall.ts` + `run-uninstall.ts`
- 首合入单元禁止「只改 enum」：必须 planner 三元 + service 专用卸载入口
- 文案：产品词「智能体」；中英 locale 同步；禁实现词进前台
- 弹窗：`showAppConfirm({ intent: "destructive" })`，禁止传 `size`
- 每 Task 结束：`pnpm check:file-size` 相关路径 + 触及单测绿

---

## File map

| 文件 | 职责 |
| --- | --- |
| Modify: `src/shared/contracts/agent/lifecycle.ts` | action 加 `uninstall`；probe 字段；error codes |
| Modify: `src/shared/contracts/preferences.ts` | `agentUninstallCommands` |
| Modify: `src/main/state/preferences.ts` | 默认 `{}` |
| Modify: `src/main/services/preferences-service.ts` | `PATCHABLE_KEYS` |
| Modify: `src/main/services/agents/lifecycle/specs/types.ts` | `UninstallChannel`、`uninstall?`、`defaultShellCommands?` |
| Modify: `src/main/services/agents/lifecycle/specs/tier-a.ts` 等 | 按需显式 `uninstall` / 空数组（多数可 omit 派生） |
| Create: `src/main/services/agents/lifecycle/plan/uninstall.ts` | `buildUninstallPlan` / command helper |
| Modify: `src/main/services/agents/lifecycle/plan/source-policy.ts` | `filterUninstallChannels` |
| Modify: `src/main/services/agents/lifecycle/plan/build.ts` | `planLifecycle` 三元 + WSL 第三臂；**不**塞大段卸载逻辑 |
| Modify: `src/main/services/agents/lifecycle/plan.ts` | re-export |
| Modify: `src/main/services/agents/lifecycle/defaults.ts` | `defaultUninstallCommand` |
| Modify: `src/main/services/agents/lifecycle/probe.ts` | `canUninstall`、targets、mode |
| Create: `src/main/services/agents/lifecycle/run-uninstall.ts` | `runUninstallUnlocked` |
| Create: `src/main/services/agents/lifecycle/resolve-commands.ts`（可选） | L2 覆盖解析三动作共用 |
| Modify: `src/main/services/agents/lifecycle/service.ts` | 早分支 uninstall；`LifecycleCommandOverrides.uninstall`；`afterUninstall` |
| Modify: `src/main/app-core/agent-lifecycle-boot.ts` | prefs + afterUninstall |
| Modify: `src/renderer/stores/agent-preferences.store.ts` | uninstall commands |
| Modify: `src/renderer/stores/agent-lifecycle.store.ts` | 类型已跟契约即可 |
| Modify: `src/renderer/pages/settings/components/agent-lifecycle-format.ts` | busy/error/`still_detected` |
| Modify: `src/renderer/pages/settings/components/agent-row-details.tsx` | 卸载 InputRow + 按钮 helper |
| Create（可选）: `…/agent-row-uninstall.tsx` | 确认 + 调用 run，避免 details/row 超 500 |
| Modify: `src/renderer/i18n/locales/{en,zh-CN}/…` settings agents 文案 |
| Create/Modify tests under `tests/unit/main/agents/lifecycle/` | plan matrix、service、probe |
| Create/Modify tests under `tests/unit/renderer/` | format + UI gate |

---

### Task 1: 契约 + Spec 类型（L1 形状）

**Files:**
- Modify: `src/shared/contracts/agent/lifecycle.ts`
- Modify: `src/main/services/agents/lifecycle/specs/types.ts`
- Test: `tests/unit/main/agents/lifecycle/specs.test.ts`（扩展）或新建 `uninstall-contract.test.ts`

**Interfaces:**
- Consumes: 现有 `AgentLifecycleAction` / `AgentLifecycleProbe` / `AgentLifecycleSpec`
- Produces:
  - `AgentLifecycleAction = "install" | "update" | "uninstall"`
  - `AgentLifecycleUninstallMode = "managed" | "none"`
  - Probe: `canUninstall`, `defaultUninstallCommand`, `uninstallMode`, `uninstallTargetPath`, `uninstallTargetSource`
  - Errors: `"still_detected"`（及可选 `"not_installed"`）
  - Spec: `UninstallChannel`、`uninstall?`、`defaultShellCommands?`

- [ ] **Step 1: 写失败测试 — schema 接受 uninstall action**

```ts
// tests/unit/main/agents/lifecycle/uninstall-contract.test.ts
import { describe, expect, it } from "vitest";
import {
  agentLifecycleActionSchema,
  agentLifecycleProbeSchema,
  agentLifecycleErrorCodeSchema,
} from "../../../../../src/shared/contracts/agent/lifecycle.ts";

describe("lifecycle uninstall contract", () => {
  it("parses uninstall action", () => {
    expect(agentLifecycleActionSchema.parse("uninstall")).toBe("uninstall");
  });

  it("parses still_detected error", () => {
    expect(agentLifecycleErrorCodeSchema.parse("still_detected")).toBe(
      "still_detected"
    );
  });

  it("requires canUninstall and uninstallMode on probe", () => {
    const probe = agentLifecycleProbeSchema.parse({
      agentId: "claude",
      canInstall: true,
      canUninstall: false,
      detected: true,
      installedButBroken: false,
      installs: [],
      isConflict: false,
      latestVersion: null,
      support: "full",
      updateAvailable: false,
      updateMode: "versioned",
      updateOffered: true,
      uninstallMode: "none",
      version: "1.0.0",
    });
    expect(probe.canUninstall).toBe(false);
    expect(probe.uninstallMode).toBe("none");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-contract.test.ts
```

Expected: FAIL（schema 尚无 uninstall / canUninstall）

- [ ] **Step 3: 实现契约与 types**

`lifecycle.ts` 关键 diff 要点：

```ts
export const agentLifecycleActionSchema = z.enum([
  "install",
  "update",
  "uninstall",
]);

export const agentLifecycleUninstallModeSchema = z.enum(["managed", "none"]);

// probe 对象内追加（与 canInstall 并列）:
canUninstall: z.boolean(),
defaultUninstallCommand: z.string().nullable().optional(),
uninstallMode: agentLifecycleUninstallModeSchema,
uninstallTargetPath: z.string().nullable().optional(),
uninstallTargetSource: z.string().nullable().optional(),

// error enum 追加:
"still_detected",
```

`specs/types.ts`：

```ts
export type UninstallChannel =
  | { kind: "npm-uninstall"; package: string }
  | { kind: "brew-uninstall"; formula: string; tap?: string; cask?: boolean }
  | { kind: "pipx-uninstall"; package: string }
  | { kind: "uv-uninstall"; package: string };

export interface AgentLifecycleSpec {
  // …existing…
  readonly uninstall?: readonly UninstallChannel[];
  readonly defaultShellCommands?: {
    readonly install?: string;
    readonly update?: string;
    readonly uninstall?: string;
  };
}
```

- [ ] **Step 4: 跑测试通过 + typecheck 触及文件**

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-contract.test.ts
pnpm exec tsc -p tsconfig.node.json --noEmit 2>&1 | head -40
```

注意：扩展 probe 必填字段后，现有 probe 构造处会类型失败——本 Task 若只改契约、未改 probe.ts，后续 Task 3 补齐。若 `tsc` 立刻爆，可在本 Task 给 probe 返回值先填安全默认（`canUninstall: false`, `uninstallMode: "none"`）以免主干不可编译。

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/agent/lifecycle.ts \
  src/main/services/agents/lifecycle/specs/types.ts \
  tests/unit/main/agents/lifecycle/uninstall-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): add uninstall action and probe contract fields

EOF
)"
```

---

### Task 2: L1 卸载计划 — `plan/uninstall.ts` + source-policy + planLifecycle 三元

**Files:**
- Create: `src/main/services/agents/lifecycle/plan/uninstall.ts`
- Modify: `src/main/services/agents/lifecycle/plan/source-policy.ts`
- Modify: `src/main/services/agents/lifecycle/plan/build.ts`（仅 `planLifecycle` 分支，**禁止**再长超 500）
- Modify: `src/main/services/agents/lifecycle/plan.ts` re-export
- Create: `tests/unit/main/agents/lifecycle/uninstall-plan-matrix.test.ts`

**Interfaces:**
- Consumes: `AgentLifecycleSpec`, `InstallSourceHint`, brew token helper
- Produces:
  - `deriveUninstallChannels(spec): UninstallChannel[]`
  - `filterUninstallChannels(channels, source): UninstallChannel[]`
  - `buildUninstallPlan(spec, options): PlannedPlan | null`
  - `planLifecycle(..., "uninstall")` 不再 fall-through 到 update

- [ ] **Step 1: 写失败矩阵测试**

```ts
// tests/unit/main/agents/lifecycle/uninstall-plan-matrix.test.ts
import { describe, expect, it } from "vitest";
import { buildUninstallPlan } from "../../../../../src/main/services/agents/lifecycle/plan/uninstall.ts";
import { planLifecycle } from "../../../../../src/main/services/agents/lifecycle/plan/build.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

describe("uninstall plan matrix", () => {
  it("claude @ brew → brew uninstall --cask", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      installSource: "brew",
      defaultBinPath: "/opt/homebrew/bin/claude",
    });
    expect(plan?.steps[0]).toMatchObject({
      kind: "argv",
      file: "brew",
    });
    expect(plan?.preview).toMatch(/uninstall/);
    expect(plan?.preview).toMatch(/--cask|claude-code/);
  });

  it("gemini @ npm → npm uninstall -g", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("gemini"), {
      host: "posix",
      installSource: "npm",
    });
    expect(plan?.steps[0]).toMatchObject({ kind: "argv", file: "npm" });
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).toContain("-g");
    expect(plan?.preview).toContain("@google/gemini-cli");
  });

  it("kimi @ uv → uv tool uninstall", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("kimi"), {
      host: "posix",
      installSource: "uv",
    });
    expect(plan?.steps[0]).toMatchObject({ kind: "argv", file: "uv" });
    expect(plan?.preview).toContain("tool");
    expect(plan?.preview).toContain("uninstall");
  });

  it("claude @ path → null managed plan", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "posix",
      installSource: "path",
    });
    expect(plan).toBeNull();
  });

  it("planLifecycle uninstall does not build update plan", () => {
    const plan = planLifecycle(getAgentLifecycleSpec("gemini"), "uninstall", {
      installSource: "npm",
    });
    expect(plan?.preview).toContain("uninstall");
    expect(plan?.preview).not.toMatch(/i -g|install @|upgrade/);
  });

  it("win host + brew source → null (no brew on win)", () => {
    const plan = buildUninstallPlan(getAgentLifecycleSpec("claude"), {
      host: "win",
      installSource: "brew",
    });
    expect(plan).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-plan-matrix.test.ts
```

- [ ] **Step 3: 实现 source-policy + uninstall planner**

`filterUninstallChannels` 逻辑（与 update 对称，**单通道优先**，无 multi-fallback）：

- `npm` 族 → 只保留 `npm-uninstall`
- `brew` → 只保留 `brew-uninstall`
- `pipx` / `uv` → 对应 kind
- `path` / `wsl` / `scoop` / `winget` / `choco` / 空 → `[]`

`buildUninstallPlan` 伪代码：

```ts
export function buildUninstallPlan(
  spec: AgentLifecycleSpec,
  options: {
    host: "posix" | "win";
    installSource?: InstallSourceHint;
    defaultBinPath?: string | null;
  }
): PlannedPlan | null {
  if (spec.support !== "full") return null;
  const channels =
    spec.uninstall !== undefined
      ? [...spec.uninstall]
      : deriveUninstallChannels(spec); // from install[] npm/brew/pipx/uv only
  const filtered = filterUninstallChannels(channels, options.installSource);
  // single step only — first mappable channel after filter
  const step = channelToArgv(filtered[0], options); // brew cask / win null rules mirror install
  if (step) return { steps: [step], preview: previewPlan([step]) };
  const shell = spec.defaultShellCommands?.uninstall?.trim();
  if (shell) {
    return { steps: [{ kind: "shell", command: shell }], preview: shell };
  }
  return null;
}
```

`deriveUninstallChannels`：从 `install[]` 映射，**不**映射 `official-script`。包名/公式 **只**读 spec 字段。

`planLifecycle` 改为：

```ts
if (action === "install") { … }
else if (action === "uninstall") {
  plan = buildUninstallPlan(spec, { host, … });
} else {
  plan = buildUpdatePlan(…); // update only
}
// WSL wrap: third arm calls buildUninstallPlan(spec, { host: "posix", … })
```

- [ ] **Step 4: 测试绿 + file-size**

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-plan-matrix.test.ts
pnpm check:file-size
```

Expected: PASS；`build.ts` ≤ 500

- [ ] **Step 5: Commit**

```bash
git add src/main/services/agents/lifecycle/plan/ \
  tests/unit/main/agents/lifecycle/uninstall-plan-matrix.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-lifecycle): source-aware uninstall plans from project specs

EOF
)"
```

---

### Task 3: Probe + defaults（L1 暴露）

**Files:**
- Modify: `src/main/services/agents/lifecycle/defaults.ts`
- Modify: `src/main/services/agents/lifecycle/probe.ts`
- Test: `tests/unit/main/agents/lifecycle/uninstall-probe.test.ts`

**Interfaces:**
- Produces: probe 始终带 `canUninstall` / `uninstallMode` / targets（K19）/ `defaultUninstallCommand`

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { probeOneAgent } from "../../../../../src/main/services/agents/lifecycle/probe.ts";

describe("uninstall probe fields", () => {
  it("sets targets from PATH-default even when canUninstall is false", async () => {
    // Inject env via real enumerate is heavy — prefer unit-testing a pure
    // helper if extracted; otherwise mock enumerateInstalls.
    // Minimum: env=null degraded path still has canUninstall boolean + mode.
    const probe = await probeOneAgent("claude", null, {
      deep: false,
      checkLatest: false,
      envDegraded: true,
      host: "posix",
    });
    expect(typeof probe.canUninstall).toBe("boolean");
    expect(probe.uninstallMode === "managed" || probe.uninstallMode === "none").toBe(
      true
    );
  });
});
```

对「path 源 + detected」场景：若测试难接真实 enum，抽出：

```ts
// plan/uninstall.ts 或 probe-helpers
export function resolveUninstallProbeFields(spec, host, defaultInstall): {
  canUninstall: boolean;
  uninstallMode: "managed" | "none";
  defaultUninstallCommand: string | null;
  uninstallTargetPath: string | null;
  uninstallTargetSource: string | null;
}
```

单测该纯函数：

```ts
it("path source → canUninstall false but targets set", () => {
  const f = resolveUninstallProbeFields(spec, "posix", {
    path: "/Users/x/.local/bin/claude",
    source: "path",
    isPathDefault: true,
    runnable: true,
    version: "1.0.0",
  });
  expect(f.canUninstall).toBe(false);
  expect(f.uninstallTargetPath).toBe("/Users/x/.local/bin/claude");
  expect(f.uninstallTargetSource).toBe("path");
});

it("npm source → canUninstall true when plan exists", () => {
  const f = resolveUninstallProbeFields(getAgentLifecycleSpec("gemini"), "posix", {
    path: "/usr/local/bin/gemini",
    source: "npm",
    isPathDefault: true,
    runnable: true,
    version: "1.0.0",
  });
  expect(f.canUninstall).toBe(true);
  expect(f.uninstallMode).toBe("managed");
  expect(f.defaultUninstallCommand).toContain("uninstall");
});
```

- [ ] **Step 2–4: 实现、跑通、commit**

`canUninstall = support===full && buildUninstallPlan(...) !== null`  
`uninstallMode = canUninstall ? "managed" : "none"`  
targets：**只要**有 defaultInstall 就写 path/source（与 canUninstall 无关）

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-probe.test.ts
git commit -m "feat(agent-lifecycle): probe canUninstall and default uninstall command"
```

---

### Task 4: `run-uninstall.ts` + service 安全入口（禁止 fall-through）

**Files:**
- Create: `src/main/services/agents/lifecycle/run-uninstall.ts`
- Create: `src/main/services/agents/lifecycle/resolve-commands.ts`（三动作 L2 共用）
- Modify: `src/main/services/agents/lifecycle/service.ts`
- Test: `tests/unit/main/agents/lifecycle/uninstall-service.test.ts`

**Interfaces:**
- Consumes: `LifecycleRunner`, probe, plan, locks（由 service 持有）
- Produces: `runUninstallUnlocked(ctx): Promise<AgentLifecycleActionResult>`
- Service: `if (action === "uninstall") return runUninstallUnlocked(...)` **在** `runUnlocked` 入口，**绝不**进入 install/update 后置逻辑

- [ ] **Step 1: 失败测试（fake runner）**

```ts
describe("run uninstall service", () => {
  it("never calls afterInstall on successful uninstall", async () => {
    const afterInstall = vi.fn();
    const afterUninstall = vi.fn();
    // runner: ok; probe after: detected false
    const svc = createAgentLifecycleService({
      getEnv: async () => process.env,
      runner: fakeOkRunner(),
      afterInstall,
      afterUninstall,
      // probe sequence: before detected npm, after not detected — inject via deps if needed
    });
    // … assert afterUninstall called, afterInstall not
  });

  it("still_detected is hard fail with remaining paths in errorDetail", async () => {
    // runner ok; after.detected true with two installs
    // expect ok:false, errorCode: "still_detected", errorDetail includes path
  });

  it("custom uninstall shell runs when canUninstall is false (full + path)", async () => {
    const svc = createAgentLifecycleService({
      getLifecycleCommands: async () => ({
        install: {},
        update: {},
        uninstall: { claude: "echo uninstall-claude" },
      }),
      // …
    });
    // expect runner received shell step
  });

  it("support guided → unsupported", async () => {
    // pick a guided agentId from tier-c
    const result = await svc.run(guidedId, "uninstall");
    expect(result).toMatchObject({ ok: false, errorCode: "unsupported" });
  });
});
```

实现时若 probe 难注入：给 `createAgentLifecycleService` 保留现有测试钩子模式（见 `service-runner.test.ts`），或导出 `runUninstallUnlocked` 直接测。

- [ ] **Step 2: 实现 `resolve-commands.ts`**

```ts
export function applyLifecycleCommandOverride(
  action: AgentLifecycleAction,
  agentId: AgentKind,
  planned: PlannedPlan | null,
  cmds: LifecycleCommandOverrides
): PlannedPlan | null {
  const custom = cmds[action][agentId]?.trim();
  if (custom) {
    return { steps: [{ kind: "shell", command: custom }], preview: custom };
  }
  return planned;
}
```

install/update 路径改为调用同一 helper（替换 service 内 install/update 二分 if）。

- [ ] **Step 3: 实现 `runUninstallUnlocked` 控制流**

顺序（与 design §6.2 一致）：

1. `support !== "full"` → `unsupported`
2. resolve env；abort checks
3. probe before（deep）
4. 若 `!before.detected` → `{ ok: true, skipped: true }`
5. plan L1 `buildUninstallPlan` / `planLifecycle`；应用 L2 override（**即使** `!canUninstall`）
6. 无 plan → `no_command`
7. runner **单步计划**（不跑 version-stuck 多通道循环）
8. probe after：`after.detected === false` → refreshDetection + `afterUninstall` → ok  
   else → `still_detected`，`errorDetail` 格式化 `after.installs` 每行 `[source] path`
9. **永不** `afterInstall`；**永不** `not_found_after_install` 成功路径

`CreateAgentLifecycleServiceOptions`：

```ts
afterUninstall?: (agentId: AgentKind) => Promise<void>;
// LifecycleCommandOverrides 增加 uninstall
```

`run` / `runUnlocked`：

```ts
if (action === "uninstall") {
  return runUninstallUnlocked({ …ctx, afterUninstall: options.afterUninstall });
}
// existing install/update path unchanged except shared override helper
```

- [ ] **Step 4: 测试 + file-size**

```bash
pnpm exec vitest run tests/unit/main/agents/lifecycle/uninstall-service.test.ts tests/unit/main/agents/lifecycle/service-runner.test.ts
pnpm check:file-size
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-lifecycle): run uninstall with still_detected contract"
```

---

### Task 5: afterUninstall + 偏好 L2 + boot

**Files:**
- Modify: `src/shared/contracts/preferences.ts`
- Modify: `src/main/state/preferences.ts`
- Modify: `src/main/services/preferences-service.ts`（**必须** `PATCHABLE_KEYS`）
- Modify: `src/main/app-core/agent-lifecycle-boot.ts`
- Modify: `src/renderer/stores/agent-preferences.store.ts`
- Test: prefs roundtrip + afterUninstall 行为（可挂在 uninstall-service 或独立）

- [ ] **Step 1: schema + defaults + PATCHABLE**

```ts
// preferences.ts
agentUninstallCommands: z.partialRecord(agentKindSchema, z.string()).default({}),

// state/preferences.ts
agentUninstallCommands: {},

// preferences-service PATCHABLE_KEYS 数组加入 "agentUninstallCommands"
```

- [ ] **Step 2: boot**

```ts
getLifecycleCommands: async () => {
  const prefs = await options.preferences.read();
  return {
    install: prefs.agentInstallCommands ?? {},
    update: prefs.agentUpdateCommands ?? {},
    uninstall: prefs.agentUninstallCommands ?? {},
  };
},
afterUninstall: async (agentId) => {
  try {
    const { getAgentHookIntegration } = await import(
      "../services/agents/integrations/registry.ts"
    );
    const integration = getAgentHookIntegration(agentId);
    if (integration) await integration.uninstall(); // 无 detect 门 — 对齐 uninstallAllAgentHooks
  } catch (err) {
    console.warn(`[agent-lifecycle] afterUninstall hooks failed for ${agentId}`, err);
  }
  const prefs = await options.preferences.read();
  const disabledAgentIds = prefs.disabledAgentIds.filter((id) => id !== agentId);
  const defaultAgentId =
    prefs.defaultAgentId === agentId ? null : prefs.defaultAgentId;
  if (
    disabledAgentIds.length !== prefs.disabledAgentIds.length ||
    defaultAgentId !== prefs.defaultAgentId
  ) {
    await options.preferences.update({ disabledAgentIds, defaultAgentId });
  }
  // 保留 agent*Commands，便于重装
},
```

- [ ] **Step 3: renderer store**

镜像 `agentInstallCommands` 模式：`setAgentUninstallCommands`、`snapshotFrom`、hydrate。

- [ ] **Step 4: 测试 PATCHABLE 与 store**

写最小单测：update prefs 含 `agentUninstallCommands` 不被 strip（若已有 preferences-service 测试模式则跟随）。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-lifecycle): uninstall command prefs and afterUninstall hygiene"
```

---

### Task 6: format / i18n

**Files:**
- Modify: `src/renderer/pages/settings/components/agent-lifecycle-format.ts`
- Modify: en + zh-CN settings agents locale 文件（与现有 `settings.agents.*` 同文件）
- Test: `tests/unit/renderer/agent-lifecycle-format-uninstall.test.ts`（或扩现有）

- [ ] **Step 1: 失败测试**

```ts
it("still_detected is not soft", () => {
  expect(isLifecycleSoftFailure({ errorCode: "still_detected" })).toBe(false);
});

it("busy text for uninstall", () => {
  const text = lifecycleBusyStatusText(t, {
    action: "uninstall",
    progress: undefined,
  });
  expect(text).toMatch(/卸载|Uninstall/i);
});
```

- [ ] **Step 2: 实现**

- `KNOWN_ERROR_CODES` 加 `still_detected`（及 `not_installed` 若契约有）
- `lifecycleBusyStatusText`：三路 `install | update | uninstall`（勿再 binary）
- `formatLifecycleRowFailure`：uninstall / partial（`still_detected`）文案键
- Locale keys（与 design §11 对齐），至少：

| key | zh | en |
| --- | --- | --- |
| `action.uninstall` | 卸载 | Uninstall |
| `action.uninstallBusy` | 卸载中 | Uninstalling |
| `action.uninstallFailed` | 无法卸载智能体 | Couldn't uninstall agent |
| `action.rowUninstallFailed` | 卸载失败 | Uninstall failed |
| `action.rowUninstallPartial` | 默认位置已处理，仍检测到其他安装 | Default install removed; others still detected |
| `action.uninstallConfirmTitle` | 卸载此智能体？ | Uninstall this agent? |
| `action.uninstallConfirmBody` | 将从本机移除…不删除对话与配置… | … |
| `action.uninstallConfirmContinue` | 卸载 | Uninstall |
| `action.uninstallSuccess` | 已卸载 {{name}} | Uninstalled {{name}} |
| `action.uninstallSkipped` | 未安装，无需卸载 | Not installed |
| `action.uninstallUnsupported` | 当前安装方式不支持一键卸载… | … |
| `lifecycle.errors.still_detected` | 卸载命令已执行，但仍检测到该智能体。 | … |
| `row.uninstallCommand` / Desc / Placeholder | 与 install 对称 | … |

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(settings-agents): uninstall i18n and lifecycle error formatting"
```

---

### Task 7: UI — 详情卸载 + 三命令 InputRow 对称

**Files:**
- Create: `src/renderer/pages/settings/components/agent-row-uninstall.tsx`（推荐，控体积）
- Modify: `src/renderer/pages/settings/components/agent-row-details.tsx`
- 尽量不改 `agent-row.tsx` 主体（busy 已由 format 的 `job.action` 驱动）
- Test: `tests/unit/renderer/settings/agent-row-uninstall.test.tsx` 或 component 测

**Interfaces:**
- `showUninstall = !busy && detected && support==="full" && (canUninstall || hasCustomL2)`
- confirm 使用 `uninstallTargetPath` / `uninstallTargetSource`（缺省时不要显示「—」，可降级为仅 name）

- [ ] **Step 1: 写 UI 门控纯函数测试**

```ts
// agent-row-uninstall.ts
export function shouldShowAgentUninstall(input: {
  isBusy: boolean;
  isDetected: boolean;
  support: string | undefined;
  canUninstall: boolean | undefined;
  hasCustomUninstallCommand: boolean;
}): boolean {
  return (
    !input.isBusy &&
    input.isDetected &&
    input.support === "full" &&
    (input.canUninstall === true || input.hasCustomUninstallCommand)
  );
}
```

```ts
it("guided + custom → false", () => {
  expect(
    shouldShowAgentUninstall({
      isBusy: false,
      isDetected: true,
      support: "guided",
      canUninstall: false,
      hasCustomUninstallCommand: true,
    })
  ).toBe(false);
});

it("full + path + custom → true", () => {
  expect(
    shouldShowAgentUninstall({
      isBusy: false,
      isDetected: true,
      support: "full",
      canUninstall: false,
      hasCustomUninstallCommand: true,
    })
  ).toBe(true);
});
```

- [ ] **Step 2: 实现 Uninstall 控件**

流程：

1. 用户点「卸载」
2. `showAppConfirm({ intent: "destructive", title, body with name/source/path, confirmLabel })`
3. `runLifecycle(agentId, "uninstall")`
4. ok && skipped → `toast.success(skipped)`
5. ok → `toast.success(success)`
6. hard fail → 行 failure + 有 detail 时 `showAppAlert`（`still_detected` body 已含 remaining）

InputRow：`agentUninstallCommands`，placeholder = `probe.defaultUninstallCommand`，仅 `support==="full"` 渲染。

`detected && uninstallMode==="none" && !hasCustom`：详情内固定说明 `uninstallUnsupported` + 官网链（已有 website 行则复用）。

- [ ] **Step 3: 手动验收清单（实现者勾选）**

- [ ] brew 安装的 claude（或本机有的 brew agent）：一键卸载 → 成功 toast → 行变未安装  
- [ ] npm gemini：同上  
- [ ] path/官方 installer 的 agent：无误按钮；填自定义命令可跑  
- [ ] guided agent：无卸载按钮/无卸载 InputRow  
- [ ] 双副本：卸默认后 still_detected alert 列剩余 path  
- [ ] 清空覆盖命令后 placeholder 恢复项目默认  

- [ ] **Step 4: file-size + 相关单测**

```bash
pnpm check:file-size
pnpm exec vitest run tests/unit/renderer/settings/agent-row-uninstall.test.tsx tests/unit/renderer/settings/agents-section.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(settings-agents): uninstall control in agent details"
```

---

### Task 8: 收尾门禁

- [ ] **Step 1: 静态 + 单元**

```bash
pnpm check:file-size
pnpm exec vitest run tests/unit/main/agents/lifecycle/ tests/unit/renderer/settings/
pnpm exec tsc -p tsconfig.node.json --noEmit 2>&1 | tail -20
# 若改动触及 renderer 类型：
pnpm exec tsc -p tsconfig.web.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 2: 确认无 enum-only 中间态**

Grep 守卫：

```bash
rg "action === \"install\"" src/main/services/agents/lifecycle/plan/build.ts
rg "uninstall" src/main/services/agents/lifecycle/service.ts
rg "afterInstall" src/main/services/agents/lifecycle/run-uninstall.ts
```

Expected：`planLifecycle` 含 uninstall 分支；service 调 `runUninstallUnlocked`；`run-uninstall` **无** `afterInstall`。

- [ ] **Step 3: 最终 commit（若有修复）或标记完成**

---

## 与 Spec PR 映射

| Spec PR | Tasks |
| --- | --- |
| PR1 契约 + 计划 + 安全入口 | Task 1–4 |
| PR2 afterUninstall + L2 | Task 5（+ Task 4 的 override） |
| PR3 format/i18n | Task 6 |
| PR4 UI | Task 7 |
| 门禁 | Task 8 |

建议 **git 上仍按 PR1→PR4 拆 PR 合入**；Task 顺序即推荐实现顺序。Task 1–4 可先合 PR1；Task 5 合 PR2；依此类推。

---

## Self-review（对照 spec）

| Spec 要求 | Task |
| --- | --- |
| action uninstall + 无 fall-through | 2, 4 |
| plan/uninstall.ts + file-size | 2, 4, 8 |
| L1 specs 通道 + defaultShellCommands | 1, 2 |
| L2 三命令 prefs + PATCHABLE | 5 |
| resolve 顺序 user→project | 4, 5 |
| canUninstall / targets K19 | 3 |
| showUninstall K18 | 7 |
| still_detected 硬失败 + remaining | 4, 6, 7 |
| afterUninstall hooks + disabled/default | 5 |
| 不删配置 / 无卸载全部 / 无 plugin.uninstall | 全局 / 7 验收 |
| i18n + destructive confirm | 6, 7 |
| 覆盖矩阵 brew/npm/uv/path | 2 |

无 TBD 占位步骤；类型名与 design K20–K22 一致。
