# Phase 0: 插件列表镜像 store + 启停广播 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 renderer 侧响应式插件 registry 镜像 store（`usePluginRegistryStore`）与 main→renderer 的 `PLUGINS_CHANGED` 启停广播，并把 `PluginsSection` 从组件级 `useState` 收编为读该 store，为 Phase 2（状态栏用户控制）与 Phase 3（configuration 贡献点）提供共同前置设施。

**Architecture:** main 仍是插件 registry 的唯一数据源：`createMainPluginHostApi` 的 `refresh()`（`setEnabled` 后必经此路径）在刷新 main runtime 后经新增回调把最新 `PluginRegistryListResult` 快照广播到所有窗口（`PIER_BROADCAST.PLUGINS_CHANGED`，沿用 `PREFERENCES_CHANGED` 的"广播给包括发起窗口在内的所有 BrowserWindow"模式）。renderer 侧新增 Zustand 镜像 store，bootstrap 时先订阅广播再全量拉取；renderer 插件 runtime 改由 store 订阅驱动（按"运行态 builtin 集合"key 去重，避免无实质变化时 dispose+reactivate 全部插件）；`PluginsSection` 只读 store。

**Tech Stack:** Electron 42 IPC（`webContents.send` + preload `subscribeIpc`）· Zustand 5 · React 19 · TypeScript strict · Vitest 4（jsdom）· Biome/Ultracite · dependency-cruiser。

## Global Constraints

- TypeScript strict：禁止 `@ts-ignore`、`@ts-expect-error`、`as any` 压制类型错误。
- 所有新增/修改代码必须过 Biome/Ultracite lint（`pnpm lint`），不新加 lint 豁免。
- depcruise 边界（`dependency-cruiser.config.cjs`）：`main` ⊥ `renderer` 双向禁止；`preload` 只可 import `shared` + `electron` + preload 内部；panel-kits 不跨域 import；严禁循环依赖（本计划中 `renderer/lib/plugins/bootstrap.ts` → `renderer/stores/plugin-registry.store.ts` 单向合法，store 不得反向 import `lib/plugins`）。
- Git 规则（AGENTS.md）：禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend`、force-push；每次 commit 前先 stage 明确路径，展示 `git diff --staged` 与拟用 Conventional Commits message，**等待用户确认后**再 commit。
- 每个 Task 结束跑 `pnpm check`（typecheck + lint + depcruise + file-size）并确认通过后才进入下一个 Task。
- `src/preload/index.ts` 有 500 行硬上限（file-size 检查），当前 465 行，Task 3 只允许小幅增量。
- 单测命令：单文件用 `pnpm vitest run <path>`，全量用 `pnpm test:unit`。

---

### Task 1: `PIER_BROADCAST.PLUGINS_CHANGED` 通道常量

**Files:**
- Modify: `src/shared/ipc-channels.ts`（`PIER_BROADCAST` 常量表，L38–39 `GIT_CHANGED` 之后）
- Test: `tests/unit/shared/ipc-channels.test.ts`（新建）

**Interfaces:**
- Consumes: `PIER_BROADCAST` 常量表现有命名模式（`pier://<domain>:<action>`，参照 `GIT_CHANGED: "pier://git:changed"`）；`ALLOWED_RENDERER_CHANNELS` 由 `Object.values(PIER_BROADCAST)` 自动派生（L47–49，**已核实**，新增通道无需手工加白名单）。
- Produces: `PIER_BROADCAST.PLUGINS_CHANGED = "pier://plugins:changed"`（payload 约定为 `PluginRegistryListResult` 快照）。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/shared/ipc-channels.test.ts`：

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    ALLOWED_RENDERER_CHANNELS,
    PIER_BROADCAST,
  } from "@shared/ipc-channels.ts";

  describe("PIER_BROADCAST.PLUGINS_CHANGED", () => {
    it("遵循 pier://<domain>:<action> 命名", () => {
      expect(PIER_BROADCAST.PLUGINS_CHANGED).toBe("pier://plugins:changed");
    });

    it("自动进入 preload 订阅白名单(ALLOWED_RENDERER_CHANNELS 派生)", () => {
      expect(ALLOWED_RENDERER_CHANNELS).toContain("pier://plugins:changed");
    });
  });
  ```

- [ ] **Step 2: 跑测试确认失败**

  ```bash
  pnpm vitest run tests/unit/shared/ipc-channels.test.ts
  ```

  预期两条用例失败：`AssertionError: expected undefined to be 'pier://plugins:changed'` 与 `expected [ …channels ] to include 'pier://plugins:changed'`。

- [ ] **Step 3: 最小实现**

  在 `src/shared/ipc-channels.ts` 的 `PIER_BROADCAST` 中，`GIT_CHANGED` 行（L39）之后新增：

  ```ts
    // 插件 registry 变更广播 (main → renderer, payload PluginRegistryListResult).
    // main 在插件 setEnabled / registry refresh 后发送最新快照给所有窗口.
    PLUGINS_CHANGED: "pier://plugins:changed",
  ```

  `ALLOWED_RENDERER_CHANNELS` 不改动（自动派生）。

- [ ] **Step 4: 跑测试确认通过**

  ```bash
  pnpm vitest run tests/unit/shared/ipc-channels.test.ts
  ```

  预期 2 passed。

- [ ] **Step 5: pnpm check + commit（经用户确认）**

  ```bash
  pnpm check
  git add src/shared/ipc-channels.ts tests/unit/shared/ipc-channels.test.ts
  git diff --staged
  ```

  拟用 message：`feat(ipc): add PLUGINS_CHANGED broadcast channel`

---

### Task 2: main 广播 — host-api `onRegistryChanged` 回调 + app-core 接线

**Files:**
- Modify: `src/main/plugins/host-api.ts`（整个 `createMainPluginHostApi`，L15–42）
- Modify: `src/main/app-core/app-core.ts`（imports L1–35；`broadcastMruState` 之后 L45–51 附近新增广播函数；`createMainPluginHostApi` 调用点 L100–102）
- Test: `tests/unit/main/plugin-runtime.test.ts`（`describe("createMainPluginHostApi")` 块，L47–85）

**Interfaces:**
- Consumes: `PluginService.list(): Promise<PluginRegistryListResult>`（`src/main/services/plugin-service.ts` L58–62）；`windowManager.getAll()`（app-core 内 `broadcastMruState` L45–51 同款遍历 + `isDestroyed()` 守卫）；`PIER_BROADCAST.PLUGINS_CHANGED`（Task 1）。
- Produces: `createMainPluginHostApi({ onRegistryChanged?: (result: PluginRegistryListResult) => void; plugins: PluginService; runtime?: MainPluginRuntimeController }): MainPluginHostApi` — `refresh()`（含 `setEnabled` 内部触发的 refresh，及 `src/main/index.ts:176` 的启动 refresh）在 `runtime.refresh(...)` 后调用 `onRegistryChanged(result)`。

- [ ] **Step 1: 写失败测试**

  在 `tests/unit/main/plugin-runtime.test.ts` 的 `describe("createMainPluginHostApi", …)` 块内（现有两条 it 之后、`});` 之前）追加：

  ```ts
    it("notifies onRegistryChanged with the latest snapshot after refresh and setEnabled", async () => {
      const runtime = {
        refresh: vi.fn(),
      };
      const plugin = entry("sample.plugin", true);
      const listResult = { diagnostics: [], entries: [plugin] };
      const plugins = {
        inspect: vi.fn(async () => plugin),
        list: vi.fn(async () => listResult),
        setEnabled: vi.fn(async () => plugin),
      };
      const onRegistryChanged = vi.fn();

      const host = createMainPluginHostApi({
        onRegistryChanged,
        plugins,
        runtime,
      });

      await host.refresh();
      expect(onRegistryChanged).toHaveBeenCalledTimes(1);
      expect(onRegistryChanged).toHaveBeenCalledWith(listResult);

      await host.plugins.setEnabled("sample.plugin", false);
      expect(onRegistryChanged).toHaveBeenCalledTimes(2);
    });
  ```

- [ ] **Step 2: 跑测试确认失败**

  ```bash
  pnpm vitest run tests/unit/main/plugin-runtime.test.ts
  ```

  预期新用例失败：`expected "spy" to be called 1 times, but got 0 times`（现有 `createMainPluginHostApi` 不接受也不会调用 `onRegistryChanged`）。

- [ ] **Step 3: 最小实现 host-api**

  `src/main/plugins/host-api.ts` 全文替换为：

  ```ts
  import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
  import type { PluginService } from "../services/plugin-service.ts";
  import { MainPluginRuntime } from "./runtime.ts";

  export interface MainPluginRuntimeController {
    dispose?(): void;
    refresh(entries: Parameters<MainPluginRuntime["refresh"]>[0]): void;
  }

  export interface MainPluginHostApi {
    dispose(): void;
    plugins: PluginService;
    refresh(): Promise<void>;
  }

  export function createMainPluginHostApi({
    onRegistryChanged,
    plugins,
    runtime = new MainPluginRuntime(),
  }: {
    /**
     * registry 快照变化后的回调 — setEnabled 与显式 refresh 皆经此路径,
     * app-core 用它把最新快照广播到所有窗口 (PIER_BROADCAST.PLUGINS_CHANGED).
     */
    onRegistryChanged?: (result: PluginRegistryListResult) => void;
    plugins: PluginService;
    runtime?: MainPluginRuntimeController;
  }): MainPluginHostApi {
    async function refresh(): Promise<void> {
      const result = await plugins.list();
      runtime.refresh(result.entries);
      onRegistryChanged?.(result);
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

- [ ] **Step 4: 跑测试确认通过**

  ```bash
  pnpm vitest run tests/unit/main/plugin-runtime.test.ts
  ```

  预期全部（原 4 条 + 新 1 条）passed。

- [ ] **Step 5: app-core 接线广播**

  `src/main/app-core/app-core.ts`：

  在文件头 import 区追加（放在现有 `@shared` import 邻近位置，交给 Biome organize imports 排序）：

  ```ts
  import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
  import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
  ```

  在 `broadcastMruState`（L45–51）之后新增：

  ```ts
  function broadcastPluginRegistryChanged(result: PluginRegistryListResult): void {
    for (const win of windowManager.getAll()) {
      if (!win.isDestroyed()) {
        win.webContents.send(PIER_BROADCAST.PLUGINS_CHANGED, result);
      }
    }
  }
  ```

  把 `createPierAppCore()` 中的（L100–102）：

  ```ts
    const pluginHost = createMainPluginHostApi({
      plugins: createPluginService({ sources: createDefaultPluginSources }),
    });
  ```

  改为：

  ```ts
    const pluginHost = createMainPluginHostApi({
      onRegistryChanged: broadcastPluginRegistryChanged,
      plugins: createPluginService({ sources: createDefaultPluginSources }),
    });
  ```

  说明：`src/main/index.ts:176` 的启动 `await appCore.pluginHost.refresh()` 也会走该回调 — 此时尚无窗口，`windowManager.getAll()` 为空，安全无副作用，不需要改 `index.ts`。`app-core.ts` 依赖 electron 单例（`app`/`windowManager`），无既有单测先例，此步以 typecheck + Task 7 人工验证兜底。

- [ ] **Step 6: pnpm check + commit（经用户确认）**

  ```bash
  pnpm check
  pnpm vitest run tests/unit/main/plugin-runtime.test.ts
  git add src/main/plugins/host-api.ts src/main/app-core/app-core.ts tests/unit/main/plugin-runtime.test.ts
  git diff --staged
  ```

  拟用 message：`feat(plugins): broadcast registry snapshot to all windows after setEnabled/refresh`

---

### Task 3: preload `plugins.onChanged` 订阅入口

**Files:**
- Modify: `src/preload/index.ts`（`PierPluginsAPI` 接口 L111–116；`pluginsApi` 实现 L376–385）

**Interfaces:**
- Consumes: `subscribeIpc<P>(channel, cb): () => void`（同文件 L209–220 现有模板，"加新订阅:一行 (channel, cb)"）；`PIER_BROADCAST.PLUGINS_CHANGED`（Task 1，已随 `ALLOWED_RENDERER_CHANNELS = Object.values(PIER_BROADCAST)` 自动进入 preload 转发白名单，Task 1 Step 1 的测试已覆盖该派生）。
- Produces: `window.pier.plugins.onChanged(cb: (snapshot: PluginRegistryListResult) => void): () => void`（`PierWindowAPI` 经 `src/renderer/global.d.ts` 对 renderer 全局生效）。

- [ ] **Step 1: 扩展 `PierPluginsAPI` 接口**

  把 L111–116：

  ```ts
  export interface PierPluginsAPI {
    disable: (id: string) => Promise<PluginRegistryEntry>;
    enable: (id: string) => Promise<PluginRegistryEntry>;
    inspect: (id: string) => Promise<PluginRegistryEntry>;
    list: () => Promise<PluginRegistryListResult>;
  }
  ```

  改为：

  ```ts
  export interface PierPluginsAPI {
    disable: (id: string) => Promise<PluginRegistryEntry>;
    enable: (id: string) => Promise<PluginRegistryEntry>;
    inspect: (id: string) => Promise<PluginRegistryEntry>;
    list: () => Promise<PluginRegistryListResult>;
    /**
     * 订阅插件 registry 变更 — main 在 setEnabled / registry refresh 后
     * 广播最新快照给所有 BrowserWindow, 包括发起变更的窗口.
     */
    onChanged: (cb: (snapshot: PluginRegistryListResult) => void) => () => void;
  }
  ```

- [ ] **Step 2: 实现 `pluginsApi.onChanged`**

  把 L376–385 的 `pluginsApi`：

  ```ts
  const pluginsApi: PierPluginsAPI = {
    list: () =>
      invokePierCommand<PluginRegistryListResult>({ type: "plugin.list" }),
    inspect: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.inspect" }),
    enable: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.enable" }),
    disable: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.disable" }),
  };
  ```

  改为：

  ```ts
  const pluginsApi: PierPluginsAPI = {
    list: () =>
      invokePierCommand<PluginRegistryListResult>({ type: "plugin.list" }),
    inspect: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.inspect" }),
    enable: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.enable" }),
    disable: (id) =>
      invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.disable" }),
    onChanged: (cb) => subscribeIpc(PIER_BROADCAST.PLUGINS_CHANGED, cb),
  };
  ```

- [ ] **Step 3: 验证**

  preload 无单测先例（依赖 `ipcRenderer`），本 task 验证面 = 类型 + 白名单派生（Task 1 已测）+ 行数上限：

  ```bash
  pnpm check
  ```

  预期通过（`src/preload/index.ts` 增加约 7 行，465 → 约 472 行，低于 500 行硬上限）。

- [ ] **Step 4: commit（经用户确认）**

  ```bash
  git add src/preload/index.ts
  git diff --staged
  ```

  拟用 message：`feat(preload): expose plugins.onChanged registry subscription`

---

### Task 4: `plugin-registry.store.ts` 镜像 store

**Files:**
- Create: `src/renderer/stores/plugin-registry.store.ts`
- Test: `tests/unit/renderer/stores/plugin-registry-store.test.ts`（新建，命名参照同目录 `agent-preferences-store.test.ts`）

**Interfaces:**
- Consumes: `window.pier.plugins.list()` / `window.pier.plugins.onChanged(cb)`（Task 3）；`PluginRegistryEntry` / `PluginRegistryDiagnostic` / `PluginRegistryListResult`（`src/shared/contracts/plugin.ts` L136 / L153–155 / L161–163，**registry entry 真实类型名 = `PluginRegistryEntry`，已核实**）；Zustand `create`（惯例参照 `src/renderer/stores/agent-detect.store.ts`）。
- Produces（**Phase 2/3 硬依赖，不可改名**）：
  - `usePluginRegistryStore` — state `{ plugins: PluginRegistryEntry[]; diagnostics: PluginRegistryDiagnostic[]; initialized: boolean; error: string | null }`，action `refresh(): Promise<void>`。
  - `initPluginRegistry(): Promise<() => void>` — 先订阅广播再全量拉取，返回广播解绑函数。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/renderer/stores/plugin-registry-store.test.ts`（jsdom 环境，`window.pier` mock 模式参照 `tests/unit/renderer/stores/theme-store-native-chrome.test.ts` 的 `Object.defineProperty` + `vi.resetModules` + 动态 import 惯例）：

  ```ts
  import type {
    PluginRegistryEntry,
    PluginRegistryListResult,
  } from "@shared/contracts/plugin.ts";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

  function entry(id: string, enabled: boolean): PluginRegistryEntry {
    return {
      effectivePermissions: [],
      enabled,
      manifest: {
        apiVersion: 1,
        commands: [],
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

  function listResult(
    ...entries: PluginRegistryEntry[]
  ): PluginRegistryListResult {
    return { diagnostics: [], entries };
  }

  type BroadcastListener = (snapshot: PluginRegistryListResult) => void;

  function installPierMock(list: () => Promise<PluginRegistryListResult>) {
    const listeners = new Set<BroadcastListener>();
    const listMock = vi.fn(list);
    const onChangedMock = vi.fn((cb: BroadcastListener) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          list: listMock,
          onChanged: onChangedMock,
        },
      },
    });
    return {
      emit(snapshot: PluginRegistryListResult) {
        for (const listener of listeners) {
          listener(snapshot);
        }
      },
      listeners,
      listMock,
      onChangedMock,
    };
  }

  describe("plugin-registry.store", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("refresh() 全量拉取并置 initialized", async () => {
      installPierMock(async () => listResult(entry("pier.git", true)));
      const { usePluginRegistryStore } = await import(
        "@/stores/plugin-registry.store.ts"
      );

      expect(usePluginRegistryStore.getState().initialized).toBe(false);
      await usePluginRegistryStore.getState().refresh();

      const state = usePluginRegistryStore.getState();
      expect(state.initialized).toBe(true);
      expect(state.plugins.map((p) => p.manifest.id)).toEqual(["pier.git"]);
      expect(state.diagnostics).toEqual([]);
      expect(state.error).toBeNull();
    });

    it("refresh() 失败时记录 error 且仍置 initialized, plugins 保持原值", async () => {
      installPierMock(async () => {
        throw new Error("ipc down");
      });
      const { usePluginRegistryStore } = await import(
        "@/stores/plugin-registry.store.ts"
      );

      await usePluginRegistryStore.getState().refresh();

      const state = usePluginRegistryStore.getState();
      expect(state.error).toBe("ipc down");
      expect(state.initialized).toBe(true);
      expect(state.plugins).toEqual([]);
    });

    it("initPluginRegistry() 先订阅广播再拉取, 广播快照直接进 store", async () => {
      const pier = installPierMock(async () =>
        listResult(entry("pier.git", true))
      );
      const { initPluginRegistry, usePluginRegistryStore } = await import(
        "@/stores/plugin-registry.store.ts"
      );

      const unsubscribe = await initPluginRegistry();

      const onChangedOrder =
        pier.onChangedMock.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY;
      const listOrder = pier.listMock.mock.invocationCallOrder[0] ?? 0;
      expect(onChangedOrder).toBeLessThan(listOrder);
      expect(pier.listeners.size).toBe(1);
      expect(usePluginRegistryStore.getState().plugins).toHaveLength(1);

      pier.emit(listResult(entry("pier.git", false)));
      expect(
        usePluginRegistryStore.getState().plugins[0]?.runtime.enabled
      ).toBe(false);

      unsubscribe();
      expect(pier.listeners.size).toBe(0);
    });
  });
  ```

- [ ] **Step 2: 跑测试确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/stores/plugin-registry-store.test.ts
  ```

  预期 3 条用例全部失败：`Error: Failed to load url @/stores/plugin-registry.store.ts`（模块不存在）。

- [ ] **Step 3: 最小实现**

  新建 `src/renderer/stores/plugin-registry.store.ts`：

  ```ts
  import type {
    PluginRegistryDiagnostic,
    PluginRegistryEntry,
    PluginRegistryListResult,
  } from "@shared/contracts/plugin.ts";
  import { create } from "zustand";

  /**
   * 插件 registry 的 renderer 镜像 store.
   *
   * main 是唯一数据源: bootstrap 时经 initPluginRegistry() 全量拉取一次,
   * 之后由 PIER_BROADCAST.PLUGINS_CHANGED 广播保持同步(含多窗口一致性).
   *
   * `plugins` / `initialized` / `refresh` 是 Phase 2(状态栏用户控制)与
   * Phase 3(configuration 贡献点)的硬依赖, 不可改名.
   */
  interface PluginRegistryStoreState {
    diagnostics: PluginRegistryDiagnostic[];
    /** 最近一次全量拉取失败的错误消息; 快照应用成功后清空. */
    error: string | null;
    /** 首次全量拉取(成功或失败)完成后为 true — UI 以此区分 loading 态. */
    initialized: boolean;
    plugins: PluginRegistryEntry[];
    refresh: () => Promise<void>;
  }

  function snapshotPatch(result: PluginRegistryListResult) {
    return {
      diagnostics: result.diagnostics,
      error: null,
      initialized: true,
      plugins: result.entries,
    };
  }

  export const usePluginRegistryStore = create<PluginRegistryStoreState>(
    (set) => ({
      diagnostics: [],
      error: null,
      initialized: false,
      plugins: [],

      async refresh() {
        try {
          set(snapshotPatch(await window.pier.plugins.list()));
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            initialized: true,
          });
        }
      },
    })
  );

  /**
   * bootstrap 时每窗口调用一次: 先订阅广播(避免拉取窗口期丢事件), 再全量拉取.
   * 返回广播解绑函数.
   */
  export async function initPluginRegistry(): Promise<() => void> {
    const unsubscribe = window.pier.plugins.onChanged((snapshot) => {
      usePluginRegistryStore.setState(snapshotPatch(snapshot));
    });
    await usePluginRegistryStore.getState().refresh();
    return unsubscribe;
  }
  ```

- [ ] **Step 4: 跑测试确认通过**

  ```bash
  pnpm vitest run tests/unit/renderer/stores/plugin-registry-store.test.ts
  ```

  预期 3 passed。

- [ ] **Step 5: pnpm check + commit（经用户确认）**

  ```bash
  pnpm check
  git add src/renderer/stores/plugin-registry.store.ts tests/unit/renderer/stores/plugin-registry-store.test.ts
  git diff --staged
  ```

  拟用 message：`feat(renderer): add plugin registry mirror store with broadcast sync`

---

### Task 5: bootstrap 收编 — renderer 插件 runtime 改由 store 驱动

**Files:**
- Modify: `src/renderer/lib/plugins/bootstrap.ts`（全文，现 L1–24；本 task **暂时保留** `refreshBuiltinPlugins` 导出，`plugins-section.tsx` L40/L256 仍在使用，Task 6 一并移除）
- Test: `tests/unit/renderer/plugin-bootstrap.test.ts`（新建，与 `plugin-panel-registry.test.ts` 同级）

**Interfaces:**
- Consumes: `usePluginRegistryStore` / `initPluginRegistry`（Task 4）；`rendererPluginRuntime.refresh(entries) / .dispose()`（`src/renderer/lib/plugins/runtime.ts` L29–46）；Zustand 5 `store.subscribe((state, prev) => void)`。
- Produces:
  - `bootstrapBuiltinPlugins(): Promise<() => void>`（签名不变，`src/renderer/main.tsx:88` 调用点零改动；语义变为"订阅 store → 初始拉取 → store 驱动 runtime"）。
  - `activeBuiltinPluginKey(entries: readonly PluginRegistryEntry[]): string`（导出的纯函数，运行态 builtin 集合去重 key，供测试与后续复用）。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/renderer/plugin-bootstrap.test.ts`（mock 掉 `runtime.ts` 单例避免激活真实 builtin 插件图；`window.pier` mock 复用 Task 4 模式）：

  ```ts
  import type {
    PluginRegistryEntry,
    PluginRegistryListResult,
  } from "@shared/contracts/plugin.ts";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  const { runtimeMock } = vi.hoisted(() => ({
    runtimeMock: { dispose: vi.fn(), refresh: vi.fn() },
  }));

  vi.mock("@/lib/plugins/runtime.ts", () => ({
    rendererPluginRuntime: runtimeMock,
  }));

  function entry(id: string, enabled: boolean): PluginRegistryEntry {
    return {
      effectivePermissions: [],
      enabled,
      manifest: {
        apiVersion: 1,
        commands: [],
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

  function listResult(
    ...entries: PluginRegistryEntry[]
  ): PluginRegistryListResult {
    return { diagnostics: [], entries };
  }

  type BroadcastListener = (snapshot: PluginRegistryListResult) => void;

  function installPierMock(list: () => Promise<PluginRegistryListResult>) {
    const listeners = new Set<BroadcastListener>();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          list: vi.fn(list),
          onChanged: vi.fn((cb: BroadcastListener) => {
            listeners.add(cb);
            return () => {
              listeners.delete(cb);
            };
          }),
        },
      },
    });
    return {
      emit(snapshot: PluginRegistryListResult) {
        for (const listener of listeners) {
          listener(snapshot);
        }
      },
    };
  }

  describe("bootstrapBuiltinPlugins (store 驱动)", () => {
    beforeEach(() => {
      vi.resetModules();
      runtimeMock.dispose.mockClear();
      runtimeMock.refresh.mockClear();
    });

    it("activeBuiltinPluginKey 只统计运行态 builtin 插件", async () => {
      const { activeBuiltinPluginKey } = await import(
        "@/lib/plugins/bootstrap.ts"
      );
      const disabled = entry("pier.b", false);
      const manifestOnly: PluginRegistryEntry = {
        ...entry("pier.c", true),
        runtime: { canToggle: false, enabled: false, kind: "manifest-only" },
      };
      expect(
        activeBuiltinPluginKey([entry("pier.a", true), disabled, manifestOnly])
      ).toBe("pier.a");
      expect(activeBuiltinPluginKey([])).toBe("");
    });

    it("初始拉取后 refresh runtime 一次", async () => {
      installPierMock(async () => listResult(entry("pier.git", true)));
      const { bootstrapBuiltinPlugins } = await import(
        "@/lib/plugins/bootstrap.ts"
      );

      await bootstrapBuiltinPlugins();

      expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
      const passed = runtimeMock.refresh.mock.calls[0]?.[0] as
        | PluginRegistryEntry[]
        | undefined;
      expect(passed?.map((e) => e.manifest.id)).toEqual(["pier.git"]);
    });

    it("广播运行态集合变化才 refresh runtime, 无实质变化去重", async () => {
      const pier = installPierMock(async () =>
        listResult(entry("pier.git", true))
      );
      const { bootstrapBuiltinPlugins } = await import(
        "@/lib/plugins/bootstrap.ts"
      );
      await bootstrapBuiltinPlugins();
      runtimeMock.refresh.mockClear();

      // 新数组引用、相同运行态集合 → 去重, 不 dispose+reactivate
      pier.emit(listResult(entry("pier.git", true)));
      expect(runtimeMock.refresh).not.toHaveBeenCalled();

      // 运行态集合变化 → refresh
      pier.emit(listResult(entry("pier.git", false)));
      expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
    });

    it("返回的清理函数注销订阅并 dispose runtime", async () => {
      const pier = installPierMock(async () =>
        listResult(entry("pier.git", true))
      );
      const { bootstrapBuiltinPlugins } = await import(
        "@/lib/plugins/bootstrap.ts"
      );
      const cleanup = await bootstrapBuiltinPlugins();
      runtimeMock.refresh.mockClear();

      cleanup();

      expect(runtimeMock.dispose).toHaveBeenCalledTimes(1);
      pier.emit(listResult(entry("pier.git", false)));
      expect(runtimeMock.refresh).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: 跑测试确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/plugin-bootstrap.test.ts
  ```

  预期失败：第一条 `SyntaxError: The requested module '@/lib/plugins/bootstrap.ts' does not provide an export named 'activeBuiltinPluginKey'`；其余用例中现实现的 `bootstrapBuiltinPlugins` 不订阅 `onChanged`，广播相关断言失败。

- [ ] **Step 3: 最小实现**

  `src/renderer/lib/plugins/bootstrap.ts` 全文替换为：

  ```ts
  import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
  import {
    initPluginRegistry,
    usePluginRegistryStore,
  } from "@/stores/plugin-registry.store.ts";
  import { rendererPluginRuntime } from "./runtime.ts";

  /**
   * runtime 只关心「哪些 builtin 插件处于运行态」。广播快照的数组每次都是
   * 新引用, 用该 key 判等去重, 避免 registry 无实质变化时对全部插件做
   * dispose+reactivate。
   */
  export function activeBuiltinPluginKey(
    entries: readonly PluginRegistryEntry[]
  ): string {
    return entries
      .filter(
        (entry) => entry.runtime.enabled && entry.runtime.kind === "builtin"
      )
      .map((entry) => entry.manifest.id)
      .join("\n");
  }

  /**
   * 过渡期兼容入口(Task 6 移除): 直接按给定/拉取的 entries 刷新 runtime。
   */
  export async function refreshBuiltinPlugins(
    entries?: readonly PluginRegistryEntry[]
  ): Promise<void> {
    try {
      if (entries) {
        rendererPluginRuntime.refresh(entries);
        return;
      }
      const result = await window.pier.plugins.list();
      rendererPluginRuntime.refresh(result.entries);
    } catch {
      rendererPluginRuntime.dispose();
    }
  }

  /**
   * 启动引导: renderer 插件 runtime 由 plugin-registry 镜像 store 驱动 —
   * store 变化(初始拉取 / PLUGINS_CHANGED 广播 / 手动 refresh)且运行态
   * 集合有实质变化时刷新 runtime。返回解绑 + dispose 的清理函数。
   *
   * 注: Zustand set() 同步通知订阅者, 所以 await 返回时初始拉取对应的
   * runtime.refresh(含插件 panel 注册)已完成, main.tsx 在 App render 前
   * await 本函数的时序约束不变。
   */
  export async function bootstrapBuiltinPlugins(): Promise<() => void> {
    const unsubscribeStore = usePluginRegistryStore.subscribe(
      (state, prev) => {
        if (
          activeBuiltinPluginKey(state.plugins) !==
          activeBuiltinPluginKey(prev.plugins)
        ) {
          rendererPluginRuntime.refresh(state.plugins);
        }
      }
    );
    const unsubscribeBroadcast = await initPluginRegistry();
    return () => {
      unsubscribeBroadcast();
      unsubscribeStore();
      rendererPluginRuntime.dispose();
    };
  }
  ```

  说明：depcruise 下 `renderer/lib` → `renderer/stores` 无禁则且无循环（store 不 import lib）；`main.tsx:88` 的 `await bootstrapBuiltinPlugins()` 调用点不改。

- [ ] **Step 4: 跑测试确认通过 + 回归**

  ```bash
  pnpm vitest run tests/unit/renderer/plugin-bootstrap.test.ts
  pnpm test:unit
  ```

  预期新文件 4 passed，全量 unit 无回归（`plugins-section.tsx` 仍用过渡期 `refreshBuiltinPlugins`，行为兼容；过渡期内 Settings 切换插件会经"组件直调 + 广播驱动"各刷新一次 runtime，Task 6 消除）。

- [ ] **Step 5: pnpm check + commit（经用户确认）**

  ```bash
  pnpm check
  git add src/renderer/lib/plugins/bootstrap.ts tests/unit/renderer/plugin-bootstrap.test.ts
  git diff --staged
  ```

  拟用 message：`refactor(renderer): drive plugin runtime from registry mirror store`

---

### Task 6: `PluginsSection` 收编 + 移除过渡期 `refreshBuiltinPlugins`

**Files:**
- Modify: `src/renderer/pages/settings/components/plugins-section.tsx`（imports L32–48；`PluginsListContent` L193–226；`PluginsSection` L228–312）
- Modify: `src/renderer/lib/plugins/bootstrap.ts`（删除 Task 5 保留的 `refreshBuiltinPlugins`）
- Modify: `src/renderer/lib/plugins/plugin-panel-registry.ts`（L59–63 doc 注释更新，消除对已删函数的引用）
- Test: `tests/unit/renderer/plugins-section.test.tsx`（新建，组件测试惯例参照 `tests/unit/renderer/agents-section.test.tsx`：`initI18n()` + store `setState` + `Object.defineProperty(window, "pier", …)` + testing-library）

**Interfaces:**
- Consumes: `usePluginRegistryStore`（Task 4：`plugins` / `diagnostics` / `initialized` / `error` / `refresh`）；`window.pier.plugins.enable/disable`（现有）。
- Produces: `PluginsSection`（导出名与 JSX 结构不变；数据源从组件级 `useState` + 自拉取改为镜像 store；不再 import `refreshBuiltinPlugins` —— runtime 刷新完全由 Task 5 的 store 订阅承担）。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/renderer/plugins-section.test.tsx`：

  ```tsx
  import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
  import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
  } from "@testing-library/react";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { initI18n } from "@/i18n/index.ts";
  import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
  import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

  function entry(id: string, enabled: boolean): PluginRegistryEntry {
    return {
      effectivePermissions: [],
      enabled,
      manifest: {
        apiVersion: 1,
        commands: [],
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

  const INITIAL_STORE_STATE = {
    diagnostics: [],
    error: null,
    initialized: false,
    plugins: [],
  };

  describe("PluginsSection", () => {
    beforeEach(async () => {
      await initI18n();
      usePluginRegistryStore.setState(INITIAL_STORE_STATE);
      Object.defineProperty(window, "pier", {
        configurable: true,
        value: {
          plugins: {
            disable: vi.fn(async () => entry("pier.git", false)),
            enable: vi.fn(async () => entry("pier.git", true)),
            list: vi.fn(async () => ({
              diagnostics: [],
              entries: [entry("pier.git", false)],
            })),
            onChanged: vi.fn(() => () => undefined),
          },
        },
      });
    });

    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
      usePluginRegistryStore.setState(INITIAL_STORE_STATE);
    });

    it("store 未初始化时渲染 loading 骨架", () => {
      render(<PluginsSection />);
      expect(screen.getByTestId("plugins-loading")).toBeInTheDocument();
    });

    it("渲染 store 中的插件行, 挂载时不自行发起 list 拉取", () => {
      usePluginRegistryStore.setState({
        initialized: true,
        plugins: [entry("pier.git", true)],
      });
      render(<PluginsSection />);
      expect(screen.getByTestId("plugin-row-pier.git")).toBeInTheDocument();
      expect(window.pier.plugins.list).not.toHaveBeenCalled();
    });

    it("store 更新时(模拟广播落地)行随之更新", () => {
      usePluginRegistryStore.setState({
        initialized: true,
        plugins: [entry("pier.git", true)],
      });
      render(<PluginsSection />);
      expect(screen.queryByTestId("plugin-row-pier.extra")).toBeNull();

      act(() => {
        usePluginRegistryStore.setState({
          plugins: [entry("pier.git", true), entry("pier.extra", true)],
        });
      });
      expect(screen.getByTestId("plugin-row-pier.extra")).toBeInTheDocument();
    });

    it("toggle 调用 disable 并 refresh store", async () => {
      usePluginRegistryStore.setState({
        initialized: true,
        plugins: [entry("pier.git", true)],
      });
      render(<PluginsSection />);

      fireEvent.click(
        screen.getByRole("button", { name: "Disable pier.git" })
      );

      await waitFor(() => {
        expect(window.pier.plugins.disable).toHaveBeenCalledWith("pier.git");
        // toggle resolve 后显式 refresh() → 恰好一次 list 拉取
        expect(window.pier.plugins.list).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(
          usePluginRegistryStore.getState().plugins[0]?.enabled
        ).toBe(false);
      });
    });
  });
  ```

  说明：jsdom 下 `navigator.language = "en-US"`，`initI18n()` 解析为英文资源，action 按钮 aria-label 为 `Disable {{name}}`（`src/renderer/i18n/locales/en/settings.ts` L143），本组件测试的 manifest name = id = `pier.git`。

- [ ] **Step 2: 跑测试确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/plugins-section.test.tsx
  ```

  预期至少两条失败：`挂载时不自行发起 list 拉取`（现实现 `useEffect` 挂载即 `window.pier.plugins.list()`，`expected "spy" to not be called`）与 `store 更新时行随之更新`（现实现读组件级 state，忽略 store）。

- [ ] **Step 3: 收编 `plugins-section.tsx`**

  3a. 把 imports（L32–48 中受影响的行）：

  ```tsx
  import type {
    PluginRegistryEntry,
    PluginRegistryListResult,
  } from "@shared/contracts/plugin.ts";
  import i18next from "i18next";
  import { ChevronDown, ChevronRight } from "lucide-react";
  import { Fragment, useCallback, useEffect, useState } from "react";
  import { useT } from "@/i18n/use-t.ts";
  import { refreshBuiltinPlugins } from "@/lib/plugins/bootstrap.ts";
  import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
  ```

  改为：

  ```tsx
  import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
  import i18next from "i18next";
  import { ChevronDown, ChevronRight } from "lucide-react";
  import { Fragment, useState } from "react";
  import { useT } from "@/i18n/use-t.ts";
  import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
  import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
  ```

  3b. 把 `PluginsListContent`（L193–226）替换为：

  ```tsx
  function PluginsListContent({
    entries,
    initialized,
    onToggle,
    pendingId,
  }: {
    entries: readonly PluginRegistryEntry[];
    initialized: boolean;
    onToggle(entry: PluginRegistryEntry): void;
    pendingId: string | null;
  }) {
    if (!initialized) {
      return <PluginsLoadingState />;
    }

    if (entries.length === 0) {
      return <PluginsEmptyState />;
    }

    return (
      <ItemGroup className="gap-0">
        {entries.map((entry, index) => (
          <Fragment key={entry.manifest.id}>
            {index > 0 ? (
              <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
            ) : null}
            <PluginRow
              entry={entry}
              onToggle={onToggle}
              pending={pendingId === entry.manifest.id}
            />
          </Fragment>
        ))}
      </ItemGroup>
    );
  }
  ```

  3c. 把 `PluginsSection`（L228–312）替换为：

  ```tsx
  export function PluginsSection() {
    const t = useT();
    const plugins = usePluginRegistryStore((state) => state.plugins);
    const diagnostics = usePluginRegistryStore((state) => state.diagnostics);
    const initialized = usePluginRegistryStore((state) => state.initialized);
    const storeError = usePluginRegistryStore((state) => state.error);
    const [toggleError, setToggleError] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);

    const togglePlugin = (entry: PluginRegistryEntry) => {
      setPendingId(entry.manifest.id);
      setToggleError(null);
      const request = entry.enabled
        ? window.pier.plugins.disable(entry.manifest.id)
        : window.pier.plugins.enable(entry.manifest.id);
      request
        // PLUGINS_CHANGED 广播会同步所有窗口(含本窗口); 这里在 resolve 路径
        // 再显式 refresh 一次, 让发起窗口不依赖广播到达时序, 与 preferences
        // 的"发起端确定性更新"约定一致。runtime 刷新由 bootstrap 的 store
        // 订阅按运行态集合去重, 不会重复 reactivate。
        .then(() => usePluginRegistryStore.getState().refresh())
        .catch((err: unknown) => {
          setToggleError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setPendingId(null);
        });
    };

    const error = toggleError ?? storeError;

    return (
      <div className="px-4 pb-4" id="plugins">
        <h1 className="mb-4 text-xl">{t("settings.section.plugins")}</h1>
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.plugins.title")}</CardTitle>
            <CardDescription>
              {t("settings.plugins.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-0">
            {error ? (
              <div className="px-(--card-spacing)">
                <Alert variant="destructive">
                  <AlertTitle>{t("settings.plugins.errorTitle")}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            ) : null}
            {diagnostics.length ? (
              <div className="px-(--card-spacing)">
                <Alert>
                  <AlertTitle>
                    {t("settings.plugins.diagnosticsTitle")}
                  </AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-col gap-1">
                      {diagnostics.map((diagnostic) => (
                        <div
                          key={`${diagnostic.source.kind}:${diagnostic.message}`}
                        >
                          {diagnostic.message}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}
            <PluginsListContent
              entries={plugins}
              initialized={initialized}
              onToggle={togglePlugin}
              pendingId={pendingId}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

  行为说明（有意取舍）：不再在挂载时自拉取 —— registry 仅经 app 内 `setEnabled`/refresh 变化且均有广播，打开设置页时 store 已是最新镜像。

- [ ] **Step 4: 删除过渡期 `refreshBuiltinPlugins`**

  从 `src/renderer/lib/plugins/bootstrap.ts` 删除整个 `refreshBuiltinPlugins` 函数（Task 5 Step 3 中标注"过渡期兼容入口"的块，含其 doc 注释）。文件保留 `activeBuiltinPluginKey` 与 `bootstrapBuiltinPlugins` 两个导出。

- [ ] **Step 5: 更新 `plugin-panel-registry.ts` 注释**

  把 L59–63：

  ```ts
  /**
   * 订阅插件 panel 注册表变化(给 useSyncExternalStore 用)。
   * 用户在 Settings 启用/禁用插件时,refreshBuiltinPlugins() 触发 dispose+re-activate,
   * 订阅者据此重算 dockview 组件表,保证开关插件后能立即打开/收起对应面板,无需重启。
   */
  ```

  改为：

  ```ts
  /**
   * 订阅插件 panel 注册表变化(给 useSyncExternalStore 用)。
   * 用户在 Settings 启用/禁用插件时, PLUGINS_CHANGED 广播落进 plugin-registry
   * 镜像 store, bootstrap 的订阅据此对 runtime dispose+re-activate,
   * 订阅者随之重算 dockview 组件表,保证开关插件后能立即打开/收起对应面板,无需重启。
   */
  ```

- [ ] **Step 6: 跑测试确认通过 + 回归**

  ```bash
  pnpm vitest run tests/unit/renderer/plugins-section.test.tsx
  pnpm test:unit
  ```

  预期新文件 4 passed，全量无回归（确认无其他文件 import `refreshBuiltinPlugins`：已核实仅 `plugins-section.tsx` 使用）。

- [ ] **Step 7: pnpm check + commit（经用户确认）**

  ```bash
  pnpm check
  git add src/renderer/pages/settings/components/plugins-section.tsx src/renderer/lib/plugins/bootstrap.ts src/renderer/lib/plugins/plugin-panel-registry.ts tests/unit/renderer/plugins-section.test.tsx
  git diff --staged
  ```

  拟用 message：`refactor(settings): read PluginsSection from plugin registry mirror store`

---

### Task 7: 全量验证（自动化 + 多窗口人工验证）

**Files:**
- Create/Modify: 无（纯验证）

**Interfaces:**
- Consumes: Task 1–6 全部产物。
- Produces: Phase 0 验收结论。

- [ ] **Step 1: 全量自动化检查**

  ```bash
  pnpm check
  pnpm test:unit
  ```

  预期全部通过。

- [ ] **Step 2: pnpm dev 人工验证点（UI 收编与多窗口广播无法单测的部分）**

  执行 `pnpm dev`（worktree 首次先 `pnpm setup:worktree`），逐项确认：

  1. 启动后打开设置 → Plugins section：pier.git 行正常渲染（无 loading 卡死、无 error alert）。
  2. 点击 pier.git 的 Disable：按钮 pending → 状态 badge 变 Disabled；终端底部 git 状态栏项消失、git panel 入口收起（runtime 经 store 订阅刷新）。
  3. 再 Enable：状态 badge 变 Enabled，git 状态栏项恢复。
  4. **多窗口一致性**（本 Phase 核心验收）：Cmd+N 开第二个窗口，两窗口都打开设置 Plugins section；在窗口 A 切换 pier.git 启停，**不操作窗口 B**，确认窗口 B 的插件行状态与 git 状态栏项随广播同步变化。
  5. 重复快速切换 3–4 次无报错（DevTools console 无未捕获异常）。

- [ ] **Step 3: 收尾**

  无遗留 TODO；如以上任一验证点失败，回到对应 Task 修复后重跑本 Task。

---

## Phase 0 Produces（后续 Phase 2/3 依赖的精确接口）

| 导出 | 位置 | 签名 |
| --- | --- | --- |
| `PIER_BROADCAST.PLUGINS_CHANGED` | `src/shared/ipc-channels.ts` | `"pier://plugins:changed"`，payload `PluginRegistryListResult` |
| `window.pier.plugins.onChanged` | `src/preload/index.ts`（`PierPluginsAPI`） | `(cb: (snapshot: PluginRegistryListResult) => void) => () => void` |
| `createMainPluginHostApi` 新参数 | `src/main/plugins/host-api.ts` | `onRegistryChanged?: (result: PluginRegistryListResult) => void` |
| `usePluginRegistryStore` | `src/renderer/stores/plugin-registry.store.ts` | Zustand store，state `{ plugins: PluginRegistryEntry[]; diagnostics: PluginRegistryDiagnostic[]; initialized: boolean; error: string \| null }`，action `refresh(): Promise<void>`（`plugins`/`initialized`/`refresh` 为硬依赖命名） |
| `initPluginRegistry` | 同上 | `(): Promise<() => void>` — 订阅广播 + 首次全量拉取，返回解绑函数 |
| `activeBuiltinPluginKey` | `src/renderer/lib/plugins/bootstrap.ts` | `(entries: readonly PluginRegistryEntry[]) => string` — 运行态 builtin 集合去重 key |
| `bootstrapBuiltinPlugins` | 同上 | `(): Promise<() => void>`（签名不变，语义改为 store 驱动） |
