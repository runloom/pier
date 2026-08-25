# Canvas 能力层（P0）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地工作台迁入 Canvas 的能力层：`pluginData` 投影命令 + 三个 curated hooks，经 `pier/canvas` / `pier/host` 合同暴露。

**Architecture:** 复用 canvas-host 三重闸门结构（shared 契约 → preload allowlist → main client-kind 授权）；hooks 经 live-module stub 共享宿主 store 单例。

**Tech Stack:** TypeScript strict · zod · zustand · React 19 · Vitest

**Spec:** `docs/superpowers/specs/2026-08-24-workbench-into-canvas-teardown-design.md`

## 变更记录（2026-08-24 用户裁决）

- **宿主不实现任何具体仪表盘组件**。呈现层由 skill 组装 canvas 时用既有 pier/canvas 原语 + 数据 hooks 现场拼装。
- **Task 6、Task 7 取消**（组件迁移不再执行；T6 进行中已被中止，无代码残留）。
- **Task 8 缩减**：物料页仅 hooks 数据文档行——已由 Task 5 的全覆盖守卫连带落地，本任务验收 = `pnpm vitest run tests/unit/renderer/canvas-materials tests/unit/canvases` 全绿。
- **Task 9 调整**：gold contract 断言只含三个 hooks 名（无组件名断言）；其余（只读不变式、pluginData 拒绝、preflight 收口）不变。

## Global Constraints

- 本仓库 Git 默认只读：计划内不含 commit 步骤；提交仅在用户明确要求时进行。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 用户可见文案一律走 i18n key；宿主 locale 在 `src/renderer/i18n/locales/{zh-CN,en,...}/`，zh 与 en 必须同步可读。
- 单文件硬上限 500 行；目录密度门禁 `pnpm check:dir-density`。
- 每个任务收口跑该任务相关测试；整阶段收口跑 `pnpm preflight:push`。
- `pier/host` 保持只读：本计划不加任何变更型命令；成本刷新走 store 方法不经命令。
- 工作台本体在本阶段**不动**（P2 才删）；新代码不得 import `panel-kits/workbench/**`。

---

### Task 1: pluginData 命令契约与 allowlist（shared 层）

**Files:**
- Modify: `src/shared/ipc-channels.ts`（PIER_BROADCAST 新增通道）
- Modify: `src/shared/contracts/commands.ts`（PierCommand union 新增条目）
- Modify: `src/shared/contracts/canvas-host.ts`（allowlist + 快照目标语法 + watch target 类型）
- Test: `tests/unit/shared/canvas-host-contract.test.ts`（若已有对应契约测试文件则扩展之；用 `glob tests/unit/**/*canvas-host*` 先定位）

**Interfaces:**
- Produces: 命令类型 `"pluginData.snapshot"`（payload `{ pluginId: string; key: string }`）；广播通道 `PIER_BROADCAST.PLUGIN_DATA_CHANGED = "pier://plugin-data:changed"`；watch 目标语法 `"plugin:<pluginId>/<key>"`；类型守卫 `parsePluginDataWatchTarget(target: string): { key: string; pluginId: string } | null`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 canvas-host 契约测试
import {
  isCanvasHostCommandAllowed,
  parsePluginDataWatchTarget,
} from "@shared/contracts/canvas-host.ts";

test("pluginData.snapshot joins the canvas allowlist", () => {
  expect(isCanvasHostCommandAllowed("pluginData.snapshot")).toBe(true);
});

test("plugin watch target parses and rejects malformed ids", () => {
  expect(parsePluginDataWatchTarget("plugin:pier.codex/accounts.usage")).toEqual({
    key: "accounts.usage",
    pluginId: "pier.codex",
  });
  expect(parsePluginDataWatchTarget("plugin:pier.codex/")).toBeNull();
  expect(parsePluginDataWatchTarget("resources")).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/shared -t pluginData`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现**

`src/shared/ipc-channels.ts` 的 `PIER_BROADCAST` 内追加：

```ts
  // 插件数据投影变更：宿主仅转发 manifest 已声明键的事件（设计 §4.1）。
  PLUGIN_DATA_CHANGED: "pier://plugin-data:changed",
```

`src/shared/contracts/commands.ts` 的 PierCommand union 中、紧邻 `pluginSettings.getAll` 条目处追加：

```ts
  z.object({
    payload: z.object({
      key: z.string().min(1),
      pluginId: z.string().min(1),
    }),
    type: z.literal("pluginData.snapshot"),
  }),
```

`src/shared/contracts/canvas-host.ts`：

```ts
// CANVAS_HOST_ALLOWED_COMMANDS 数组尾部追加：
  "pluginData.snapshot",

// CANVAS_HOST_ALLOWED_CHANNELS 数组尾部追加：
  PIER_BROADCAST.PLUGIN_DATA_CHANGED,

// 文件内新增（放 SNAPSHOT_ALIASES 定义之后）：
export function parsePluginDataWatchTarget(
  target: string
): { key: string; pluginId: string } | null {
  if (!target.startsWith("plugin:")) {
    return null;
  }
  const rest = target.slice("plugin:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    return null;
  }
  const pluginId = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (pluginId.includes("/") || key.includes("/")) {
    return null;
  }
  return { key, pluginId };
}
```

注意：`CanvasHostWatchTarget` 不改为包含任意 plugin 字符串——保持窄类型，插件目标在 renderer 侧以 `string` 传入 `useHostSnapshot` 时由运行时解析（见 Task 4），类型层面把 `useHostSnapshot` 参数放宽为 `CanvasHostWatchTarget | (string & {})` 以保留补全。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/shared`
Expected: PASS

---

### Task 2: manifest dataProjections 声明

**Files:**
- Modify: `src/shared/contracts/plugin.ts`（manifest schema）
- Modify: `src/shared/contracts/plugin/managed.ts`（managed 镜像 + 贡献计数如适用）
- Test: 扩展既有 manifest schema 测试（`glob tests/unit/**/*plugin*schema*` 定位；参考 `workbenchWidgets` 字段的既有断言写法）

**Interfaces:**
- Produces: `pluginManifestSchema.dataProjections: z.array(z.string().min(1)).default([])`；managed 包 manifest 同字段镜像

- [ ] **Step 1: 写失败测试**

```ts
test("dataProjections defaults to empty and rejects empty keys", () => {
  const parsed = pluginManifestSchema.parse({ id: "x", /* 最小合法字段同既有测试 fixture */ });
  expect(parsed.dataProjections).toEqual([]);
  expect(
    pluginManifestSchema.safeParse({ /* fixture */ dataProjections: [""] }).success
  ).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit -t dataProjections`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/shared/contracts/plugin.ts` 在 `workbenchWidgets` 字段旁追加：

```ts
    /**
     * 可投影给 canvas 的只读数据键（设计 §4.1）。未声明键的
     * pluginData.snapshot 一律拒绝——纪律边界与 panels 同链。
     */
    dataProjections: z.array(z.string().min(1)).default([]),
```

`src/shared/contracts/plugin/managed.ts` 在 `workbenchWidgets` 镜像处同步追加同 schema 引用；若 managed 计数逻辑枚举贡献数组（对齐 `managed.ts:343` 的 workbenchWidgets 计数方式），追加对应计数行。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit -t dataProjections`
Expected: PASS

---

### Task 3: 主进程投影命令与变更转发

**Files:**
- Create: `src/main/services/plugin-data-projections/service.ts`
- Modify: `src/main/app-core/command-metadata.ts`（授权元数据）
- Modify: `src/main/app-core/command-router.ts` 或命令分发处（新增 case；先 `grep -n "pluginSettings.getAll" src/main` 定位处理点，同一 switch 注册）
- Modify: `src/main/index.ts`（在已验证的 `createPluginRpcBus({...})` 装配点注入服务，约 `index.ts:226`）
- Test: `tests/unit/main/plugin-data-projections/service.test.ts`

**Interfaces:**
- Consumes: `PluginRpcBus.invoke(request: PluginRpcInvokeRequest): Promise<PluginRpcInvokeResult>`（`src/main/plugins/rpc-bus.ts:19`）；manifest 注册表（能按 pluginId 查 `dataProjections`，装配时从现有 plugin service/registry 取——实现时 `grep -n "workbenchWidgets" src/main/services/plugin-service.ts` 找到 manifest 访问入口复用同一来源）
- Produces:

```ts
export interface PluginDataProjectionService {
  /** 主进程命令处理体：声明检查 → rpc 代理。拒绝时 throw canvasHostPermissionError 同构错误。 */
  snapshot(pluginId: string, key: string): Promise<unknown>;
  /** 插件 rpc 事件过滤转发：仅转发已声明键，payload 原样。返回 dispose。 */
  tapEvents(): () => void;
}
export function createPluginDataProjectionService(deps: {
  bus: PluginRpcBus;
  broadcastToWindows: (channel: string, payload: unknown) => void;
  manifestProjections: (pluginId: string) => readonly string[];
}): PluginDataProjectionService;
```

- [ ] **Step 1: 写失败测试**

```ts
test("snapshot proxies declared projection via rpc bus", async () => {
  const calls: PluginRpcInvokeRequest[] = [];
  const service = createPluginDataProjectionService({
    broadcastToWindows: () => {},
    bus: {
      invoke: async (request) => {
        calls.push(request);
        return { data: { ok: 1 }, ok: true };
      },
    } as unknown as PluginRpcBus,
    manifestProjections: (id) => (id === "pier.codex" ? ["accounts.usage"] : []),
  });
  await expect(service.snapshot("pier.codex", "accounts.usage")).resolves.toEqual({ ok: 1 });
  expect(calls[0]).toMatchObject({
    method: "projection.accounts.usage",
    pluginId: "pier.codex",
  });
});

test("undeclared keys are rejected before touching the bus", async () => {
  const invoke = vi.fn();
  const service = createPluginDataProjectionService({
    broadcastToWindows: () => {},
    bus: { invoke } as unknown as PluginRpcBus,
    manifestProjections: () => [],
  });
  await expect(service.snapshot("pier.codex", "accounts.usage")).rejects.toMatchObject({
    code: "permission_denied",
  });
  expect(invoke).not.toHaveBeenCalled();
});

test("tapEvents forwards only declared keys", () => {
  let listener: ((event: string, payload: unknown) => void) | undefined;
  const sent: unknown[] = [];
  const service = createPluginDataProjectionService({
    broadcastToWindows: (_channel, payload) => sent.push(payload),
    bus: {
      onEvent: (fn) => {
        listener = fn;
        return () => {};
      },
    } as unknown as PluginRpcBus,
    manifestProjections: (id) => (id === "pier.codex" ? ["accounts.usage"] : []),
  });
  const dispose = service.tapEvents();
  listener?.("projection.accounts.usage", { pluginId: "pier.codex", v: 2 });
  listener?.("projection.other.key", { pluginId: "pier.codex", v: 3 });
  expect(sent).toEqual([{ key: "accounts.usage", pluginId: "pier.codex", v: 2 }]);
  dispose();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/main/plugin-data-projections`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现服务**

```ts
// src/main/services/plugin-data-projections/service.ts
import { canvasHostPermissionError } from "@shared/contracts/canvas-host.ts";
import type {
  PluginRpcBus,
  PluginRpcInvokeRequest,
} from "../../plugins/rpc-bus.ts";

const PROJECTION_METHOD_PREFIX = "projection.";
const PIER_PLUGIN_DATA_CHANGED = "pier://plugin-data:changed";

export interface PluginDataProjectionService { /* 见上方 Interfaces */ }
export function createPluginDataProjectionService(deps: {
  bus: PluginRpcBus;
  broadcastToWindows: (channel: string, payload: unknown) => void;
  manifestProjections: (pluginId: string) => readonly string[];
}): PluginDataProjectionService {
  const declared = (pluginId: string, key: string): boolean =>
    deps.manifestProjections(pluginId).includes(key);

  return {
    async snapshot(pluginId, key) {
      if (!declared(pluginId, key)) {
        throw canvasHostPermissionError(
          `plugin ${pluginId} does not declare data projection "${key}"`
        );
      }
      const request: PluginRpcInvokeRequest = {
        method: `${PROJECTION_METHOD_PREFIX}${key}`,
        payload: null,
        pluginId,
      };
      const result = await deps.bus.invoke(request);
      if (!result.ok) {
        throw canvasHostPermissionError(result.error.message);
      }
      return result.data;
    },
    tapEvents() {
      const busWithEvents = deps.bus as PluginRpcBus & {
        onEvent?: (
          listener: (event: string, pluginId: string, payload: unknown) => void
        ) => () => void;
      };
      if (!busWithEvents.onEvent) {
        return () => {};
      }
      // 若 PluginRpcBus 尚无 onEvent 钩子：在 rpc-bus.ts 的 emit() 里加一行
      // this.eventListeners?.(...) 透传（最小侵入），并在此消费。
      return busWithEvents.onEvent((event, pluginId, payload) => {
        if (!event.startsWith(PROJECTION_METHOD_PREFIX)) {
          return;
        }
        const key = event.slice(PROJECTION_METHOD_PREFIX.length);
        if (!declared(pluginId, key)) {
          return;
        }
        deps.broadcastToWindows(PIER_PLUGIN_DATA_CHANGED, {
          key,
          payload,
          pluginId,
        });
      });
    },
  };
}
```

若 `PluginRpcBus` 无事件透传钩子：在 `createPluginRpcBus` 返回对象的 `emit()` 内追加监听器通知（保持 emit 现有行为不变，只加旁路观察），并在 `rpc-bus.ts` 接口上补 `onEvent`。此改动须同步补 rpc-bus 单测一条（emit 触发 onEvent）。

- [ ] **Step 4: 授权元数据与命令接入**

`command-metadata.ts` 对齐 `plugin.list` 条目风格：

```ts
  "pluginData.snapshot": {
    allowedClientKinds: ["canvas"],
    capabilities: ["plugin:read"],
  },
```

命令分发处新增 case：解析 payload → `appCore.services.pluginDataProjections.snapshot(pluginId, key)`。装配点 `src/main/index.ts`（`createPluginRpcBus` 返回值旁）创建服务并挂到 appCore services；启动时调用一次 `tapEvents()`，dispose 挂现有 quit 清理链。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/main/plugin-data-projections tests/unit/main/rpc-bus`
Expected: PASS

---

### Task 4: preload 分支与 useHostSnapshot 插件目标

**Files:**
- Modify: `src/preload/canvas-host-api.ts`（snapshot 函数加 pluginData 分支）
- Modify: `src/renderer/lib/live-modules/host.ts`（target 解析）
- Test: 扩展 `tests/unit/renderer/live-modules` 下 host 测试（`glob tests/unit/**/*live-module*` 定位既有 host 测试文件）

**Interfaces:**
- Consumes: Task 1 的 `parsePluginDataWatchTarget`；Task 3 的命令类型
- Produces: `useHostSnapshot("plugin:pier.codex/accounts.usage")` 返回 `HostSnapshotState`；订阅走 `PIER_BROADCAST.PLUGIN_DATA_CHANGED` 且只吃匹配 `{pluginId,key}` 的事件

- [ ] **Step 1: 写失败测试**

```ts
test("plugin watch targets snapshot via command and filter changed events", async () => {
  // 渲染 useHostSnapshot 的 harness（复用既有 host 测试的 bridge mock 方式）：
  // mock bridge.invoke 断言收到 { type: "pluginData.snapshot", payload: {...} }；
  // mock bridge.subscribe 收到 "pier://plugin-data:changed"，
  // 推送 { pluginId: "pier.codex", key: "accounts.usage", payload: {v:1} } 后
  // 期望 state 变为 { data: {v:1}, status: "ready" }；
  // 再推送 key 不匹配的事件，期望 state 不变。
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer -t "plugin watch"`
Expected: FAIL

- [ ] **Step 3: 实现**

`canvas-host-api.ts` 的 `snapshot` 函数在三个既有分支前插入：

```ts
    const pluginTarget = parsePluginDataWatchTarget(channel);
    if (pluginTarget) {
      return invokeCanvasPierCommand({
        payload: { key: pluginTarget.key, pluginId: pluginTarget.pluginId },
        type: "pluginData.snapshot",
      } as PierCommand);
    }
```

（`as PierCommand` 仅当字面量未被 union 收窄时需要；Task 1 加入 union 后优先直接对象字面量让 TS 校验，禁止 any。）

`host.ts` 的 `useHostSnapshot` effect 开头、`normalizeCanvasHostSnapshotId` 之后追加：

```ts
    const pluginTarget = parsePluginDataWatchTarget(target);
    if (pluginTarget) {
      const bridge = canvasHostBridge();
      if (!bridge) {
        setState({ data: null, error: null, status: "ready" });
        return;
      }
      let cancelled = false;
      const apply = (payload: unknown): void => {
        if (cancelled) return;
        setState({ data: payload, error: null, status: "ready" });
      };
      const matches = (event: unknown): boolean =>
        isRecord(event) &&
        event.pluginId === pluginTarget.pluginId &&
        event.key === pluginTarget.key;
      bridge
        .invoke({
          payload: { key: pluginTarget.key, pluginId: pluginTarget.pluginId },
          type: "pluginData.snapshot",
        } as PierCommand)
        .then((data) => {
          if (!cancelled) apply(data);
        })
        .catch((error) => {
          if (!cancelled) fail(error); // fail 即既有错误处理闭包，抽出到 effect 外层共用
        });
      const unsub = bridge.subscribe(
        PIER_BROADCAST.PLUGIN_DATA_CHANGED,
        (event) => {
          if (matches(event)) apply(isRecord(event) ? event.payload : null);
        }
      );
      return () => {
        cancelled = true;
        unsub();
      };
    }
```

实现时将既有 `fail`/`apply` 逻辑提为 effect 内共享闭包避免复制两份；`isRecord` 为本地小工具（`typeof === "object" && !== null`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer -t host`
Expected: PASS

---

### Task 5: 三个 curated hooks 进 pier/canvas

**Files:**
- Create: `src/renderer/lib/live-modules/canvas-hooks/use-activity-overview.ts`
- Create: `src/renderer/lib/live-modules/canvas-hooks/use-system-resources.ts`
- Create: `src/renderer/lib/live-modules/canvas-hooks/use-cost-overview.ts`
- Modify: `src/shared/pier-canvas-export-names.ts`（VALUE_EXPORT_NAMES 追加三名）
- Modify: `src/renderer/lib/live-modules/pier-canvas-exports.ts`（barrel 接入三 hooks）
- Test: `tests/unit/renderer/canvas-hooks/hooks.test.tsx`（renderHook）

**Interfaces:**
- Consumes: `activityCounts(activities, taskRuns?, options?)`（`foreground-activity.store.ts`）、`combinedActivityRows`（`@shared/task-activity-sources.ts`）、`currentElectronWindowId()`（core-metrics.ts:26 同款用法）、`acquirePierResourcePolling()` / `usePierResourceStore`（`pier-resource.store.ts`）、`useUsageDataStore`（`usage-data.store.ts`）、`window.pier.usageData.refreshAll()`
- Produces（stub 透传自动生效——`stub-sources.ts:73` 按 VALUE_EXPORT_NAMES 生成 pass-through）:

```ts
export interface CanvasActivityOverview {
  counts: ActivityOverviewCounts;
  rows: ReturnType<typeof combinedActivityRows>;
}
export function useActivityOverview(): CanvasActivityOverview;

export interface CanvasSystemResources {
  cpuHistory: readonly PierResourceHistoryPoint[];
  error: string | null;
  snapshot: PierResourceSnapshot | null;
  status: "error" | "loading" | "ready";
}
export function useSystemResources(): CanvasSystemResources;

export interface CanvasCostOverview {
  /** 手动刷新聚合缓存；等价旧成本卡头部刷新按钮（store 方法，非命令）。 */
  refresh: () => Promise<void>;
  snapshot: UsageAggregateSnapshot | null;
  status: "error" | "loading" | "ready";
}
export function useCostOverview(): CanvasCostOverview;
```

- [ ] **Step 1: 写失败测试**

```tsx
import { renderHook } from "@testing-library/react";

test("useActivityOverview returns window-scoped counts and rows", () => {
  useForegroundActivityStore.setState({
    activities: { p1: makeAgentActivity({ panelId: "p1", status: "processing" }) },
    ts: 1,
  });
  const { result } = renderHook(() => useActivityOverview());
  expect(result.current.counts.running).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(result.current.rows)).toBe(true);
});

test("useSystemResources acquires polling while mounted and releases after", () => {
  const release = vi.fn();
  const acquire = vi.spyOn(resourceModule, "acquirePierResourcePolling").mockReturnValue(release);
  const { unmount } = renderHook(() => useSystemResources());
  expect(acquire).toHaveBeenCalledTimes(1);
  unmount();
  expect(release).toHaveBeenCalledTimes(1);
});

test("useCostOverview exposes refresh through the store bridge", async () => {
  const refreshAll = vi.fn().mockResolvedValue(undefined);
  (window as any).pier = { usageData: { refreshAll } }; // 测试内既有 window.pier mock 模式沿用
  const { result } = renderHook(() => useCostOverview());
  await result.current.refresh();
  expect(refreshAll).toHaveBeenCalledTimes(1);
});
```

（fixture 构造参考 `tests/unit/renderer/workbench/core-workbench-widgets.test.*` 的既有 FA fixture 写法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/canvas-hooks`
Expected: FAIL

- [ ] **Step 3: 实现 hooks**

```ts
// use-system-resources.ts —— 模式示例；另两 hook 同构
import { useEffect } from "react";
import {
  acquirePierResourcePolling,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";
import type { PierResourceHistoryPoint } from "@/stores/pier-resource.store.ts";
import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";

export interface CanvasSystemResources { /* 见 Interfaces */ }

function statusOf(state: {
  error: string | null;
  snapshot: PierResourceSnapshot | null;
}): CanvasSystemResources["status"] {
  if (state.error) return "error";
  return state.snapshot ? "ready" : "loading";
}

export function useSystemResources(): CanvasSystemResources {
  const snapshot = usePierResourceStore((s) => s.snapshot);
  const cpuHistory = usePierResourceStore((s) => s.cpuHistory);
  const error = usePierResourceStore((s) => s.error);
  useEffect(() => acquirePierResourcePolling(), []);
  const status = statusOf({ error, snapshot });
  return { cpuHistory, error, snapshot, status };
}
```

`use-activity-overview.ts`：

```ts
export function useActivityOverview(): CanvasActivityOverview {
  const activities = useForegroundActivityStore((s) => s.activities);
  const taskRuns = useTaskRunsStore((s) => s.snapshot);
  const windowScope = activityWindowScope(); // 从 core-metrics.ts 平移该 8 行工具函数
  const counts = useMemo(
    () => activityCounts(activities, taskRuns, windowScope),
    [activities, taskRuns, windowScope]
  );
  const rows = useMemo(
    () => combinedActivityRows(activities, taskRuns ?? emptyTaskRunsSnapshot()),
    [activities, taskRuns]
  );
  return { counts, rows };
}
```

`use-cost-overview.ts`：订阅 `useUsageDataStore`（snapshot/error/loadStatus → status 映射同 resources），`refresh = () => window.pier.usageData.refreshAll()`。

barrel 与清单：`PIER_CANVAS_VALUE_EXPORT_NAMES` 改为 `["useActivityOverview", "useCanvasFile", "useCostOverview", "useSystemResources"]`（保持字母序，若有排序 lint 以 lint 为准）；`pier-canvas-exports.ts` 从三个新文件 re-export 三名。编译 stub 由 `stub-sources.ts:73` 循环自动生成，无需改。

- [ ] **Step 4: 跑导出一致性守卫测试**

Run: `pnpm vitest run tests/unit/renderer/canvas-materials tests/unit/canvases`
Expected: PASS（既有 export-names ↔ barrel 一致性测试锁住清单同步）

---

### Task 6:（已取消——2026-08-24 裁决，见变更记录）

**已取消说明**：本任务（Kpi/Gauge/Trend/Ranking 四组件迁移）随 2026-08-24 用户裁决整体取消——宿主不实现任何具体仪表盘组件，呈现层由 skill 组装 canvas 时用既有 pier/canvas 原语现场拼装。原 Files/Interfaces/Step 1-5 全部作废，详见「变更记录（2026-08-24 用户裁决）」。物料页无需为这四个名字做任何登记。

---

### Task 7:（已取消——2026-08-24 裁决，见变更记录）

**已取消说明**：本任务（ActivityList/ResourceStats/CostOverview 三组件迁移）随 2026-08-24 用户裁决整体取消，与 Task 6 同因——宿主不实现任何具体仪表盘组件。原 Files/Interfaces/Step 1-5 全部作废，详见「变更记录（2026-08-24 用户裁决）」。资源/成本/活动的呈现改由 skill 用 `useSystemResources()` / `useCostOverview()` / `useActivityOverview()` 三 hooks + 原语现场拼装。

---

### Task 8: 物料页登记与文档行（已缩减）


**缩减说明**：七组件部分随 Task 6/7 取消而移除；本任务仅剩 data 家族三个 hook 行的登记，且已由 Task 5 的分组守卫连带落地——验收 = 物料测试绿（`tests/unit/renderer/canvas-materials`）。
**Files:**
- Modify: `src/renderer/lib/canvas-materials/catalog-data.ts`（三 hooks 的 usage 样例与元数据；已落地）
- Modify: `src/renderer/lib/canvas-materials/groups.ts`（data 家族新行；已落地）
- Modify: `src/renderer/i18n/locales/{zh-CN,en,ja,ko}/settings-materials.ts`（hooks prop 描述 key；已落地）
- Test: 既有 `tests/unit/renderer/canvas-materials/{registry,host-api}.test.ts` 全绿即为验收（全覆盖 guard 自动要求新导出行登记）

**Interfaces:**
- Consumes: Task 5 的三个 hook 名与 props 表；`importLineFor(exportName, usage)` 自动收集 pier/canvas 标识符
- Produces: 物料列表数据家族出现 3 个 hook 行（无组件行）；usage 样例可直接复制编译通过

- [ ] **Step 1: 先写守卫失败的证明** → Run: `pnpm vitest run tests/unit/renderer/canvas-materials` Expected: FAIL（ungroupedPierCanvasExports 报未分组新导出）

- [ ] **Step 2: 登记 groups 行**

```ts
// groups.ts 追加（family: "data"，hooks 成员行，格式与 useCanvasFile 行一致；已落地）：
{ id: "activityOverview", members: ["useActivityOverview"] },
{ id: "systemResources", members: ["useSystemResources"] },
{ id: "costOverview", members: ["useCostOverview"] },
```

hooks 行对齐 `catalog-data.ts` 的 useCanvasFile 结构（signature/returns/nestedTypes）。i18n 描述 key 仅覆盖三 hooks 的字段。

- [ ] **Step 3: 跑物料页全部测试** → Run: `pnpm vitest run tests/unit/renderer/canvas-materials tests/unit/canvases` Expected: PASS

---

### Task 9: 治理测试与阶段收口

**Files:**
- Test: `tests/unit/canvases/workbench-into-canvas-gold.test.ts`（或扩展现有 gold 挂接链）
- Test: `tests/unit/shared/canvas-host-readonly.test.ts`（新治理断言）

- [ ] **Step 1: 只读不变式治理**

```ts
test("canvas host stays read-only after pluginData addition", () => {
  // 锁定：allowlist 内不存在任何 COMMAND_METADATA capabilities 含 ":write" 的类型
  for (const type of CANVAS_HOST_ALLOWED_COMMANDS) {
    const meta = PIER_COMMAND_METADATA[type]; // 以实际导出名/导入路径为准
    expect(meta?.capabilities.some((c) => c.endsWith(":write")) ?? false).toBe(false);
  }
});
```

- [ ] **Step 2: gold 契约扩展**：在 `.pier/canvases/workbench-into-canvas/contracts.test.ts` 追加断言——三个 hook 名（`useActivityOverview`/`useSystemResources`/`useCostOverview`）∈ `PIER_CANVAS_VALUE_EXPORT_NAMES`；`parsePluginDataWatchTarget` 正反例。（七组件断言随 Task 6/7 取消而删除。）

- [ ] **Step 3: 静态门禁** → Run: `pnpm check:file-size && pnpm check:dir-density && pnpm lint` Expected: 全绿。

- [ ] **Step 4: 阶段全量** → Run: `pnpm preflight:push` Expected: 绿。工作台功能回归不受影响（本阶段未动它）。

- [ ] **Step 5: 冒烟验证（行为证据）**

启动 `pnpm dev`，打开 `.pier/canvases/activity-overview/activity-overview.canvas.tsx` 预览，临时改用 `useSystemResources()` + 既有 pier/canvas 原语现场拼装一张资源卡（冒烟后还原）：确认实时 CPU 序列滚动、卸载面板后 `pgrep` 侧资源轮询停止可通过 store 单测替代验证（单元层已覆盖 acquire/release）。

---

## Self-Review 记录

1. **Spec 覆盖**：§4.1→Task 1-4；§4.2→Task 5；§4.3 无宿主实现工作（组件迁移随裁决取消，无 Task 6/7 对应物）；§5 物料登记部分→Task 8（模板与 skill 属 P1 计划）；§7 治理→Task 9。pluginData 真实插件键注册属 P1（依赖账号域迁移进度）。
2. **占位符扫描**：Task 3 Step 3 的 `onEvent` 兜底路径与 Task 4 的 `as PierCommand` 均给了明确决策规则，非 TBD。
3. **类型一致性**：`CanvasActivityOverview/CanvasSystemResources/CanvasCostOverview` 在 Task 5 定义并被三 hooks 返回值引用；`parsePluginDataWatchTarget` Task 1 定义、Task 4 消费同名。
