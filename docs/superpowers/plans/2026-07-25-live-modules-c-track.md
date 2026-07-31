# Live Modules（C 轨）实施方案

> **For agentic workers:** 按 Task 顺序交付；每 Task 先红测再实现。P 轨（`pier.canvas` Viewer/Library）**不在本计划范围**，见文末「P 轨启动条件」。  
> **规范规格：** [`../specs/2026-07-25-live-modules-and-project-components-design.md`](../specs/2026-07-25-live-modules-and-project-components-design.md)  
> **前置约束：** Agent Assets §6 双 root（[`../specs/2026-07-23-agent-assets-home-and-instructions-design.md`](../specs/2026-07-23-agent-assets-home-and-instructions-design.md)）

**Goal:** 在宿主落地 React Live Modules：多 root 注册、路径围栏、esbuild、共享 React、`pier-live://`、诊断广播；使 `.pier/canvases`（及 Home `canvases/`）能 import 项目组件 + `pier/canvas`，供后续 `pier.canvas` 插件消费。

**质量验证清单：** [`../specs/2026-07-26-live-modules-verification-checklist.md`](../specs/2026-07-26-live-modules-verification-checklist.md)（含压测 Demo `.pier/canvases/stress/workbench-proposal.canvas.tsx`）

**Architecture:** main 拥有 compile / cache / fence / protocol；renderer 安装 React + `pier/canvas` shim，经 opaque URL `import()` 挂载；插件只调 `context.liveModules.*`，禁止自建第二份 React / esbuild。

**Tech Stack:** Electron 43 · TypeScript 6 strict · esbuild（main）· Vitest 4 · 现有 `pier-plugin` / `pier-file-preview` / `__PIER_PLUGIN_SHARED__` 先例

**Frameworks:** React 为核心（`pier/canvas`）；Vue / Solid / Svelte 为一等后缀入口（项目内框架包 + 可选 `export function mount(el)`）。  
**Out of scope (本计划):** 复刻项目 Vite/Tailwind；自动注入 Router/Store；默认打包任意 `node_modules`（框架包白名单除外）；完整 Library UX；Storybook 作编译引擎。

---

## 0. 开工前锁定（关闭规格 §8）

| # | 问题 | **本计划默认** |
|---|---|---|
| 1 | 预览桶路径与强制 | 路径 `.pier/preview-exports.ts`；默认 **鼓励不强制**（`resolve.previewBarrel` 可选；`forcePreviewBarrel` 默认 `false`） |
| 2 | `pier/canvas` 白名单 | v1：`Stack` `Row` `Frame` `Text` `Button` `Separator` `Card` `CardHeader` `CardTitle` `CardDescription` `CardContent` `Alert` `Badge`（`@pier/ui` + 宿主排版原语）；其余后置扩白名单 |
| 3 | monorepo tsconfig | 从 **canvas 文件目录向上**找最近 `tsconfig.json` / `tsconfig.app.json`；找不到则用 `projectRoot/tsconfig.json`；不自动扫整个 pnpm workspace |
| 4 | CSS | **不进 C5**；C3 仅保证「无 CSS 的 TSX fixture」；显式 `.css` / `.module.css` 可作 C3.5 可选；Tailwind 扫描另开切片 |
| 5 | `pier.canvas` 形态 | **builtin 原型** 再迁 managed；本计划只留 API，不建插件 |

### 0.1 评审 blocker（C0 必须写进契约）

1. **Trust model：** Live Module 在 **主 renderer 同 realm** 执行项目代码；信任级别 =「用户已打开该项目」；不是沙箱。v1 不做 iframe。  
2. **URL：** `pier-live://module/<ticket>`（或等价 opaque id）；**禁止** URL 携带绝对路径；main 侧 registry 映射 ticket → cache 文件。对齐 `pier-file-preview` ticket 思路。  
3. **React external：** bundle 内 `react` / `react-dom` / `react/jsx-runtime` / `pier/canvas` 必须解析到宿主单例（Import Map **或** 编译期改写到 `pier-live://runtime/...` + 与 `__PIER_PLUGIN_SHARED__` 同源）。C2 出口必须有 hooks 单测。  
4. **CSP：** `script-src` /（如需）`connect-src` 增加 `pier-live:`（对齐现有 `pier-plugin:`）。  
5. **不做**多 renderer 插件体系；C0–C5 仅 React 管道。

---

## 1. 文件落点（拟）

```text
src/shared/contracts/live-modules.ts          # LiveRootSpec / CompileResult / Diagnostic / events
src/shared/live-module-url.ts                 # scheme + ticket parse（镜像 file-preview-url）
src/shared/contracts/commands.ts              # liveModules.* 命令（若走 command bus）
src/shared/contracts/permissions.ts           # live-modules:read / live-modules:write（按现有能力风格）

src/main/services/live-modules/
  service.ts                                  # registerRoot / compile / invalidate / subscribe
  root-registry.ts                            # LiveRootSpec 实例与锚点校验
  fence.ts                                    # realpath 围栏；deny bare / electron / node:
  resolve.ts                                  # tsconfig paths + 相对路径
  compile.ts                                  # esbuild 管道；external；体积/超时
  graph.ts                                    # 依赖图 → watch 失效
  cache.ts                                    # userData 或 tmp cache/<hash>.js
  ticket-registry.ts                          # opaque ticket → artifact

src/main/live-modules/
  live-module-protocol.ts                     # registerSchemesAsPrivileged + protocol.handle

src/main/index.ts / csp.ts                    # scheme 注册时机 + CSP

src/renderer/lib/live-modules/
  install-runtime.ts                          # Import Map / runtime 模块 + 复用 plugin shared React
  mount.ts                                    # mount(el, mod.default) / unmount
  pier-canvas-exports.ts                      # pier/canvas 白名单 re-export 源（或 shared 包）

src/main/plugins/context.ts            # context.liveModules（main 暴露面，若插件 main 需）
src/renderer/lib/plugins/host-context.ts      # renderer 插件 context.liveModules
packages/plugin-api/src/renderer.ts           # ExternalRenderer 类型（若 external 也要）

tests/unit/main/live-modules-*.test.ts
tests/unit/renderer/live-modules-runtime.test.ts
fixtures/live-modules/                        # Button + 纯 pier/canvas canvas + 越界负例
```

---

## 2. 分期 Task（C0→C5）

### Task C0 — 契约与非目标钉死

**Estimate:** 0.5–1d  

**Files:**
- Create: `src/shared/contracts/live-modules.ts`
- Create: `src/shared/live-module-url.ts`
- Create: `tests/unit/main/live-modules-contract.test.ts`
- Update（仅类型/注释级）: 规格已锁定的默认值写入 contract 注释；本计划 §0 为准

**Deliverables:**
- Zod（或项目现有 schema 风格）校验 `LiveRootSpec` / `CompileResult` / `Diagnostic` / `LiveModuleEvent`
- `AssetRootRef`：`home` 禁止自定义 path；`project` 必须带 `ProjectRootRef`；拒绝 pier-home 冒充 project（复用 skills/agent-assets 先例）
- URL helper：`createLiveModuleUrl(ticket)` / `parseLiveModuleTicket(url)`
- 单测：合法/非法 spec；home 强制 `tsconfigPaths: false`

- [x] **Step 1:** 写 contract 红测（非法 anchor、缺 projectRoot、home+tsconfigPaths）
- [x] **Step 2:** 实现 schema + URL helpers
- [x] **Step 3:** 绿测；不实现 service

**Exit:** 合同可被后续 Task import；开放问题 §0 已写入类型默认值注释。  
**落地：** `src/shared/contracts/live-modules.ts` · `src/shared/live-module-url.ts` · `PIER_BROADCAST.LIVE_MODULES_CHANGED` · `tests/unit/main/live-modules-contract.test.ts`（15 passed）。anchor 复用 Agent Assets `AssetRootRef`（`projectRootPath`），非草案里的独立 `ProjectRootRef`。

---

### Task C1 — Root 注册 + `pier-live://` 静态 serve

**Estimate:** 1d  

**Files:**
- Create: `src/main/services/live-modules/{service,root-registry,ticket-registry,cache}.ts`
- Create: `src/main/live-modules/protocol.ts`
- Update: `src/main/index.ts`（`app.whenReady` 前 `registerSchemesAsPrivileged`）
- Update: `src/main/csp.ts`（允许 `pier-live:`）
- Create: `tests/unit/main/live-modules-protocol.test.ts`
- Create: `fixtures/live-modules/static-hello.mjs`（无 React，纯 `export default …` 或 export 字符串）

**行为:**
- `registerRoot(spec)` → 校验 + 存档；返回 disposer
- 无 esbuild：把 fixture 字节写入 cache，发 ticket，`protocol.handle` 返回 `content-type: text/javascript`
- CORS/origin：对齐 `pier-plugin`（packaged `file://` + dev localhost）
- 未知 ticket → 404；路径逃逸测例

- [x] **Step 1:** 红测：scheme 注册特权 + ticket 命中/未命中
- [x] **Step 2:** protocol + registry
- [x] **Step 3:** CSP 更新 + 手工或单测确认 `import(url)` 在测试环境可达（能测到 handler 即可）

**Exit:** 无编译也能通过 opaque URL 取到静态 ESM。

---

### Task C2 — 最小编译 + 共享 React shim + `pier/canvas`

**Estimate:** 1–1.5d  

**Files:**
- Create: `src/main/services/live-modules/compile.ts`
- Create: `src/renderer/lib/live-modules/install-runtime.ts`
- Create: `src/renderer/lib/live-modules/mount.ts`
- Create: `src/renderer/lib/live-modules/pier-canvas-exports.ts`（白名单）
- Update: `src/renderer/lib/plugins/runtime.ts`（boot 时 `installLiveModuleRuntime()`，紧邻 `installPluginSharedRuntime`）
- Create: `fixtures/live-modules/pure-ui.canvas.tsx`（仅 `pier/canvas`）
- Create: `tests/unit/main/live-modules-compile-minimal.test.ts`
- Create: `tests/unit/renderer/live-modules-runtime.test.ts`

**行为:**
- esbuild：`format: 'esm'`, `platform: 'browser'`, `jsx: 'automatic'`
- `external: ['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime','pier/canvas']`
- **External 解析方案（二选一，C2 钉死并测）：**  
  - **推荐 A：** 编译插件把上述说明符改写为 `pier-live://runtime/react` 等；protocol 对 `/runtime/*` 返回薄 shim（读 `__PIER_PLUGIN_SHARED__` / 同 realm 注入）  
  - **B：** renderer 注入 Import Map，指向 data URL 或同 origin shim 模块  
- `pier/canvas` → 白名单组件
- `compile(rootId, relPath)` → cache + ticket + `CompileResult`
- mount 助手：`createRoot(el).render(<Default />)`；返回 unmount

- [x] **Step 1:** 红测：纯 UI canvas 编译产物不含 React 实现拷贝（external）
- [x] **Step 2:** shim + mount；runtime 单测
- [x] **Step 3:** 集成：compile → getUrl → 产物含 pier-live://runtime

**Exit:** 无项目 import 的 canvas 可在宿主 React 上挂载（测试或临时 harness）。

---

### Task C3 — 项目 resolve + 围栏

**Estimate:** 1.5–2d（主风险）  

**Files:**
- Create: `src/main/services/live-modules/{resolve,fence}.ts`
- Update: `compile.ts`（esbuild plugin：paths / fence / deny）
- Create: `fixtures/live-modules/ui/button.tsx`
- Create: `fixtures/live-modules/import-button.canvas.tsx`（`@/` 或相对路径）
- Create: `fixtures/live-modules/tsconfig.json`（paths 指向 fixture）
- Create: `tests/unit/main/live-modules-resolve.test.ts`
- Create: `tests/unit/main/live-modules-fence.test.ts`

**行为:**
- 相对路径、tsconfig `paths`（§0.3 查找规则）
- `realpath` 后必须 ∈ `projectRoot`（project）或 home `canvases/`（home）
- deny：`electron`、`node:*`、裸 `fs` 等；默认 `allowNodeModules: false`（拒绝未白名单 bare specifier）
- 超时 + 输出体积上限 → `ok: false` diagnostics（不静默截断成功）
- `CompileResult.graph`：编入的项目相对路径列表

**建议 spike（0.5d，可并入本 Task 首日）：**  
用仓库内 fixture 跑通后，另取 **一个真实客户样本** `@/` 浅组件（无 Provider）；失败则记入 diagnostics 文案，不抬高验收。

- [x] **Step 1:** 围栏红测（`../`、绝对路径、`electron`）
- [x] **Step 2:** paths + 相对 resolve 绿测
- [x] **Step 3:** fixture Button 端到端 compile 成功

**Exit:** 规格 §5.4.3 — fixture import 仓库 Button（或等价）成功。

---

### Task C3.5（可选）— 显式 CSS

**Estimate:** 0.5d · **非关门**  

- esbuild `loader: { '.css': 'css' }` 或抽出 CSS 文本，由 mount 注入 `<style data-live-module=…>`  
- 不承诺 Tailwind / 项目全局 CSS  

若时间紧：**跳过**，记入后置切片。

---

### Task C4 — Watch、依赖图失效、广播、诊断三态

**Estimate:** 1d  

**Files:**
- Create: `src/main/services/live-modules/graph.ts`
- Update: `service.ts`（chokidar/fs.watch 策略与现有文件监视惯例对齐）
- Update: `src/shared/contracts/events.ts` 或 live-modules 内常量：`pier://live-modules:changed`
- Create: `tests/unit/main/live-modules-watch.test.ts`

**行为:**
- canvas 或 graph 内文件变更 → invalidate → 可选自动重编或发 `stale` 事件（**推荐：** 广播 changed，由 Viewer `compile` 拉取，避免 main 盲编）
- 订阅 API：`subscribe(rootId, cb)`
- 编译失败：稳定 `Diagnostic[]`（file/line/column/message）

- [x] **Step 1:** subscribe 收到 changed（watch 图已接线；fs 事件测可后补）
- [x] **Step 2:** 实现 graph + watch
- [x] **Step 3:** 错误路径诊断字段齐全

**Exit:** 规格 §5.4.5。

---

### Task C5 — 预览桶 + 双 root + 插件 API 面

**Estimate:** 1d  

**Files:**
- Update: `resolve.ts` / `fence.ts`（`forcePreviewBarrel`）
- Update: plugin host context（renderer ± main）暴露 `LiveModulesApi`
- Create: `tests/unit/main/live-modules-preview-barrel.test.ts`
- Create: `tests/unit/main/live-modules-home-root.test.ts`
- Docs: 短 skill 草稿段落可放规格附录或 `docs/superpowers/spikes/`（可选）

**行为:**
- 同时 `registerRoot(project)` + `registerRoot(home)`
- home：`tsconfigPaths` 强制 false；不能 resolve 到项目 `src/**`
- 预览桶：存在时可从 `.pier/preview-exports.ts` import；`forcePreviewBarrel: true` 时拒绝深路径
- 默认强制 = false（§0）

- [x] **Step 1:** home 负例（试图 `@/`）→ diagnostic
- [x] **Step 2:** 双 root API（project+home specs）
- [x] **Step 3:** 插件 context + preload + commands

**Exit:** P 轨可开工条件满足（见下）。

---

## 3. 垂直切片（建议第一周）

目标：**3–5 人日** 跑通最小闭环，再扩 watch/桶。

```text
Day 1     C0 合同 + C1 protocol hello
Day 2     C2 shim + 纯 pier/canvas canvas
Day 3–4   C3 fixture Button + 围栏
Day 5     C4 watch 骨架 或 C5 双 root（二选一优先 C4）
```

真实客户样本与预览桶文档放在 C3 后半 / C5。

---

## 4. 测试矩阵（最低）

| 用例 | 阶段 |
|---|---|
| contract 非法 anchor | C0 |
| ticket 404 / 命中 | C1 |
| CSP 含 `pier-live:` | C1 |
| 纯 UI canvas + 单 React | C2 |
| `@/` / 相对 import Button | C3 |
| `..` 逃逸、`electron`、裸 `fs` | C3 |
| 体积/超时 → 失败 diagnostic | C3 |
| 改依赖 → changed | C4 |
| home 无项目 paths | C5 |
| force 预览桶拒深路径 | C5 |

---

## 5. 明确不采用的方案（避免返工）

| 方案 | 原因 |
|---|---|
| 嵌入 Storybook / `@storybook/builder-vite` | 产品非 SDK；依赖项目 `.storybook`；与宿主 React 单例冲突 |
| Sandpack 扛整仓源码 | 虚拟 FS + 预打包，不适合任意 `@/` |
| 子进程跑项目 Vite（v1） | 端口/配置/成本；留作后置「高保真模式」 |
| C0 就做多 framework renderer 插件 | 过度抽象；规格明确后置 |
| URL 带文件系统路径 | 越权与缓存投毒 |

---

## 6. P 轨启动条件（非本计划 Task）

当且仅当：

1. C5 出口：双 root + `compile` / `subscribe` / `getUrl`  
2. 至少一条 **项目组件** 成功路径（fixture 即可）  
3. 文档：Agent 如何写 canvas + 预览桶约定  

然后另开计划：`pier.canvas` builtin（Viewer 三态 loading/error/ready、Library、创建对话框默认项目）。

可选增强（更后）：检测 `.storybook/` →「在 Storybook 打开 / iframe」旁路——**不**替代 Live Modules。

### 6.1 打开 canvas 文件 + 双 kind 模版（已确认）

对齐业界（Storybook Canvas/Docs + Figma Components + Playroom）：

| 层 | 行为 |
|---|---|
| 打开 | Files / Cmd+P 打开 `.pier/canvases/**/*.canvas.tsx` → Viewer `live-modules-canvas` |
| 元数据 | `export const canvas = { kind, title, description? }`（`composition` \| `docs` \| `kit`） |
| 模版 | `templates/kit.canvas.tsx` · `templates/composition-checkout.canvas.tsx` · `templates/docs-button.canvas.tsx` |
| hello | 仅 smoke，不是产品示例 |

- C 轨忽略 kind；Viewer 可展示 kind badge；Library / 创建属 P 轨。
- `fixtures/live-modules` 仅单测。

---

## 7. 验收对照（规格 §5.4）

| # | 标准 | 对应 Task |
|---|---|---|
| 1 | 单一 React + `pier/canvas` | C2 |
| 2 | 双 root | C5 |
| 3 | fixture `@/` 或相对 import | C3 |
| 4 | 越界 / electron → diagnostics | C3 |
| 5 | watch → 更新或 stale 信号 | C4 |
| 6 | 不以任意页面可挂为关门 | 全程约束 |

---

## 8. 变更记录

| 日期 | 说明 |
|---|---|
| 2026-07-25 | 初稿：基于设计规格 + 架构/安全评审 blocker；钉死 §8 默认值；明确不采用 Storybook/Sandpack 作引擎 |
