# App Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 production mac 包能从公开 GitHub Latest 自动检查并后台下载宿主更新，经右上角入口与 Settings → Updates 完成安装。

**Architecture:** 复用现有 `AppUpdateService` / preload / Settings UI。P0 增加 tag 触发的 release workflow；P1 将 `autoDownload` 改为 true，加生产调度器（30s / 24h / focus），renderer 增加共享 store 与 TitleBar `UpdateControl`。不自动 `quitAndInstall`。

**Tech Stack:** electron-updater 6.8.9 · electron-builder 26 · GitHub Actions · React 19 · Zustand 5 · Vitest 4

## Global Constraints

- 仅 production 启用真更新；dev/test 保持 `disabled`
- 插件 release 不得占 GitHub Latest
- 自动路径：check → 自动 download → downloaded；禁止自动 quitAndInstall
- 用户可见文案全部 i18n
- 单行控件 28px；titlebar 控件 `app-no-drag`
- 文件尽量 ≤500 行；优先改现有文件

---

### Task 1: Release CI + 版本校验

**Files:**
- Create: `.github/workflows/release-app.yml`
- Create: `scripts/verify-app-release-version.mjs`
- Create: `docs/app-release.md`
- Test: `tests/unit/main/app-release-workflow.test.ts`

**Interfaces:**
- Produces: tag `v*` / workflow_dispatch → `pnpm build:dist --publish=always`
- Produces: `node scripts/verify-app-release-version.mjs <versionWithoutV>` exit 0 iff equals package.json version

- [ ] **Step 1: 写 workflow 存在性与关键步骤测试**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app release workflow", () => {
  it("publishes mac app updates to GitHub Latest on version tags", async () => {
    const source = await readFile(
      join(process.cwd(), ".github/workflows/release-app.yml"),
      "utf8"
    );
    expect(source).toContain("name: Release App");
    expect(source).toContain("tags:");
    expect(source).toContain("v*");
    expect(source).toContain("workflow_dispatch");
    expect(source).toContain("verify-app-release-version.mjs");
    expect(source).toContain("pnpm build:dist --publish=always");
    expect(source).toContain("contents: write");
  });
});
```

- [ ] **Step 2: 实现 version 校验脚本 + workflow + 短文档**

`scripts/verify-app-release-version.mjs`：读 `package.json` version，与 argv[2] 比较。  
`release-app.yml`：macos-latest；checkout；pnpm/node 24；校验 version；需要的 secrets 用 `CSC_*` / Apple notarize / `GH_TOKEN`；跑 `pnpm build:dist --publish=always`。  
`docs/app-release.md`：tag 流程、secrets、与插件 Latest 隔离、本地兜底命令。

- [ ] **Step 3: 跑测试**

Run: `pnpm exec vitest run tests/unit/main/app-release-workflow.test.ts`

---

### Task 2: autoDownload + service 自动下载路径

**Files:**
- Modify: `src/main/services/app-updates/electron-updater-adapter.ts`
- Modify: `src/main/services/app-updates/app-update-service.ts`
- Modify: `tests/unit/main/app-update-service.test.ts`

**Interfaces:**
- Adapter: `autoDownload = true`；保留 check/download/on/quitAndInstall
- Service `check()`：若 updater 返回新版本，状态先 `available`，若 autoDownload 则继续走到 download（或依赖 updater 事件）；最终有更新时应能到 `downloading`/`downloaded`
- 单飞：并发 check 复用 in-flight Promise
- `quitAndInstall` 仅 `downloaded`

实现要点：

1. adapter `autoDownload = true`
2. service 增加 in-flight check/download promise
3. `check()` 发现新版本后：若 adapter 会自动下载，监听 progress 直到完成；或 check 成功后内部调用 `downloadUpdate()` 一次（更可控，推荐内部显式 `download()` 以保持现有进度映射，同时 adapter autoDownload=true 作为行业默认与 notify 兼容）
4. 推荐：**service 在 check 到 available 后自动调用内部 download**（不依赖 electron-updater 隐式行为），adapter 仍设 `autoDownload=true` 以匹配文档/未来 `checkForUpdatesAndNotify`；若双重下载有风险则 adapter 保持 false、仅 service 自动 download——**选 service 自动 download + adapter autoDownload=false 也可**，但 spec 写的是 autoDownload=true。折中：**adapter autoDownload=true，service check 到 available 后若未在 downloading/downloaded 则 await downloadUpdate 一次，download 方法做单飞去重**。

- [ ] **Step 1: 扩展单测**（自动下载、单飞、quit 门闩）
- [ ] **Step 2: 实现**
- [ ] **Step 3: 跑 `pnpm exec vitest run tests/unit/main/app-update-service.test.ts`**

---

### Task 3: 生产调度器

**Files:**
- Create: `src/main/services/app-updates/app-update-scheduler.ts`
- Modify: `src/main/index.ts`（或 app-core 启动后）接 `browser-window-focus` + start scheduler
- Test: `tests/unit/main/app-update-scheduler.test.ts`

**Interfaces:**

```ts
createAppUpdateScheduler(options: {
  check: () => Promise<unknown>;
  enabled: boolean;
  initialDelayMs?: number; // default 30_000
  intervalMs?: number; // default 24 * 60 * 60 * 1000
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}): { start(): void; stop(): void; onFocusGained(): void };
```

- enabled=false 时 start/onFocus 为空操作
- start：initialDelay 后 check，再每 interval 检查
- onFocusGained：若 now - lastCheckAt >= interval 则 check
- stop：清全部 timer

接线：production 且 appUpdates 存在时 `scheduler.start()`；现有 `app.on("browser-window-focus")` 旁调用 `onFocusGained()`。

- [ ] **Step 1: 单测 fake timer**
- [ ] **Step 2: 实现 + 接线**
- [ ] **Step 3: 跑 scheduler + service 测试**

---

### Task 4: renderer store + UpdateControl + Settings

**Files:**
- Create: `src/renderer/stores/app-update.store.ts`
- Create: `src/renderer/components/common/app-update-control.tsx`
- Modify: `src/renderer/components/common/title-bar.tsx`
- Modify: `src/renderer/components/common/agent-index-chrome-bar.tsx`
- Modify: `src/renderer/pages/settings/components/app-update-section.tsx`
- Modify: `src/renderer/pages/settings/settings-dialog.tsx`（侧栏圆点，若导航渲染处更合适则改那）
- Modify: `src/renderer/i18n/locales/en/settings.ts` + `zh-CN/settings.ts`
- Modify: `src/renderer/components/common/app-shell.tsx`（挂载 store bootstrap 若需要）
- Test: `tests/unit/renderer/app-update-control.test.tsx`（及更新 section 测试）

**Interfaces:**

```ts
// store
useAppUpdateStore: {
  snapshot: AppUpdateSnapshot | null;
  bootstrap(): () => void; // status + onChanged；返回 unsubscribe
  check(): Promise<void>;
  download(): Promise<void>;
  quitAndInstall(): Promise<void>;
}
```

UpdateControl 可见性按 spec 表；downloaded 主按钮 quitAndInstall；其它 openSection("updates")。  
downloaded 首次进入：toast 一次 / version。  
Settings section 改读 store，去掉本地重复 status 订阅。

- [ ] **Step 1: store + control 测试**
- [ ] **Step 2: 实现 UI/i18n/接线**
- [ ] **Step 3: 跑 renderer 相关测试**

---

### Task 5: 收尾验收

- [ ] `pnpm exec vitest run tests/unit/main/app-update-service.test.ts tests/unit/main/app-update-scheduler.test.ts tests/unit/main/app-release-workflow.test.ts tests/unit/shared/app-update-contracts.test.ts tests/unit/renderer/app-update-section.test.tsx tests/unit/renderer/app-update-control.test.tsx`
- [ ] `pnpm typecheck:host`（若耗时过长至少 tsc 改动相关无报错）
- [ ] 自审：无自动 quitAndInstall；dev disabled；插件 Latest 隔离文档/测试仍在

---

## Spec coverage

| Spec | Task |
|---|---|
| P0 release CI / version / docs | 1 |
| autoDownload + 自动下载到 downloaded | 2 |
| 30s / 24h / focus 调度 | 3 |
| 右上角入口 + Settings + toast 一次 | 4 |
| 测试验收 | 5 |
| 不自动安装 / dev disabled / 插件隔离 | 2–5 约束 |
