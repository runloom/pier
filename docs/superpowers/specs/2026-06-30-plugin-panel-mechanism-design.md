# 业务面板插件化机制设计

更新时间：2026-06-30

## 背景

第一期把 git-changes 做成了 core panel-kit（`src/renderer/panel-kits/git-changes/`），是务实的抄近路——当时插件「贡献 panel」的运行时尚未接通。但 Pier 的方向是插件化（能力评分清单定位为「本地能力注册」），业务面板应当走插件。

只读调研（Explore）确认了三类插件贡献的运行时成熟度：

| 贡献类型 | 成熟度 | 缺什么 |
|---|---|---|
| `commands` | 已通 | 无 |
| `terminalStatusItems` | 已通 | 无 |
| `panels` | **缺失** | 只有 manifest schema + i18n 占位；插件 API 无 register/open panel；`panel-registry` 静态；manifest 的 `component` 字符串映射不到真实组件 |

另一个关键校正：builtin 插件**可被禁用**（`canToggle: true`），所以「P0 核心不该绑可禁用插件」的顾虑对 git-changes 这类**业务面板**不成立（本就该可选），但对 terminal 这类**运行时基础设施**成立。

## 目标与非目标

目标：

- 建一套「插件贡献 panel」的运行时机制，让业务面板能通过插件系统注册并打开。
- 用 git-changes 验证机制，并把它并入现有 `git` 插件（git 域统一：worktree 命令 + git 状态项 + 变更面板 + 打开命令）。

非目标（本设计明确不做）：

- 不把 terminal 插件化。它深度耦合 native Ghostty bridge，是其他面板的 context 来源（cwd/worktree），插件化会让 core 反向依赖 plugin、破坏架构边界。terminal 保持核心，作为插件消费的能力。
- 不把 welcome 插件化。它是**系统预留**的核心面板（`workspace.store` 中 `addTab` 的默认 fallback / 空 group 占位），按设计应永久作为主系统实现——迁成可禁用插件会让 fallback 失效。welcome 与 terminal 一样属「主系统 panel」，不走插件。
- 不做第三方插件加载（local/git/registry source）、permission 沙盒、插件市集 UI。
- 不做插件 panel 的运行时热 toggle（启用/禁用后即时增删 dockview component）；第一阶段在 bootstrap 阶段注册即可，toggle 后效需重启。

## 机制设计

**核心原则：混合注册表（主系统 panel + 插件 panel 共存）。** panel-registry 同时容纳两类 panel——**主系统 panel**（terminal native bridge、welcome fallback 等系统预留能力，静态注册、不可禁用）与**业务插件 panel**（git-changes 等，动态注册、可禁用）。这是终态而非过渡：基础设施与系统预留永远走主系统实现，业务面板走插件，两者在同一个 dockview 宿主里共存、统一打开。下面的动态化只是给静态注册表「叠加」一层插件来源，不替换它。

### 三层链路

```
┌─ 插件侧（src/plugins/builtin/git/renderer/）────────────────┐
│  git-changes-panel.tsx  (React 组件, import 类型走 shared)    │
│  index.ts: context.panels.register({ id, component, icon,    │
│            kind })  →  贡献一个 panel 类型                    │
│  命令 handler: context.panels.open("pier.git.changes")       │
└──────────────────────────────────────────────────────────────┘
        │ register / open
        ▼
┌─ 插件运行时（src/renderer/lib/plugins/）───────────────────┐
│  host-context.ts: panels.register → 写入 runtime 的          │
│                   panelRegistrations; panels.open → 调       │
│                   workspace.store.addPanel                   │
│  runtime.ts: RendererPluginRuntime 持有                      │
│              panelRegistrations: Map<id, registration>       │
│              + getPanelRegistrations() getter                │
│              dispose 时清理插件注册的 panel                  │
└──────────────────────────────────────────────────────────────┘
        │ getPanelRegistrations()
        ▼
┌─ workspace 边界（src/renderer/components/workspace/）───────┐
│  panel-registry.ts: getPanelComponents() 动态合并            │
│     core(terminal/welcome) + 插件注册的 panel                │
│  workspace-host.tsx: dockview components={...} 动态获取       │
└──────────────────────────────────────────────────────────────┘
```

### 改动点（机制建设，~500 行，无 breaking change）

1. **`src/shared/contracts/dockview.ts`（新建）**：`re-export type { IDockviewPanelProps } from "dockview-react"`。插件代码（`src/plugins/`，受 depcruise 约束不能 import dockview）改从这里取类型。纯类型 re-export，无副作用；未来换 dockview 只改一处。

2. **`src/plugins/api/renderer.ts`**：扩展 `RendererPluginContext.panels`：
   - 现有 `getActiveContext()` 保留。
   - 新增 `register(reg: PluginPanelRegistration): () => void`——注册一个 panel 类型，返回 dispose。
   - 新增 `open(panelId: string): void`——以单例方式打开该 panel。
   - 新增类型 `PluginPanelRegistration { id: string; component: FunctionComponent<IDockviewPanelProps>; icon: LucideIcon; kind: "web" | "terminal"; title?: string }`。

3. **`src/renderer/lib/plugins/runtime.ts`**：`RendererPluginRuntime` 加 `panelRegistrations: Map<string, PluginPanelRegistration>` + `registerPanel(reg)`（写入并返回删除函数）+ `getPanelRegistrations()`。`dispose()`/`refresh()` 时清理（plugin 的 dispose 已聚合 register 返回的删除函数）。

4. **`src/renderer/lib/plugins/host-context.ts`**：`createRendererPluginContext` 的 `panels` 接上 runtime——`register` 调 `rendererPluginRuntime.registerPanel`；`open` 调 `useWorkspaceStore.getState()` 的单例打开逻辑（复用现有 `api.panels.find` + `addPanel` + `activateWorkspacePanel` 模式）。

5. **`src/renderer/components/workspace/panel-registry.ts`**：把静态 `panelComponents`/`panelKinds`/`panelIconOf` 改为动态——`getPanelComponents()` 合并 core `panelKits` 与 `rendererPluginRuntime.getPanelRegistrations()`；`panelKindOf`/`panelIconOf` 在 core 查不到时回落到插件注册表。core 的 terminal/welcome 仍是静态条目。

6. **`src/renderer/components/workspace/workspace-host.tsx`**：`components={panelComponents}`（行 348）改为 render 时动态获取（`useMemo` 或直接 `getPanelComponents()`）；`panelKindOf` 消费点（行 65/79）同步走动态版本。

7. **`src/shared/contracts/permissions.ts`**：把粗粒度的 panel 能力拆为 `panel:register` 与 `panel:open`（Explore 指出单一 `panel:control` 会让权限形同虚设）。git 插件 manifest 声明这两项。

### 数据流

- **注册**：`main.tsx` 的 `bootstrapBuiltinPlugins()`（App mount 前）→ `runtime.refresh()` → 对 git 插件 `module.activate(context)` → 插件调 `context.panels.register(git-changes 组件)` → 写入 `runtime.panelRegistrations`。首次 render 时 `getPanelComponents()` 已含该 panel，dockview 拿到组件映射。
- **打开**：用户在命令面板执行「Git: 打开变更面板」→ 插件命令 handler 调 `context.panels.open("pier.git.changes")` → `workspace.store` 单例打开 → dockview 用 `component: "pier.git.changes"` 渲染插件组件。

## git-changes 并入 git 插件

- **移除** core 实现：`src/renderer/panel-kits/git-changes/`（panel + register-actions + open-git-changes）整目录删除；`panel-registry.ts` 去掉 `gitChanges` 静态条目；`workspace.store` 不再有 git-changes 相关 helper；`main.tsx` 去掉 `registerGitChangesActions`。
- **新增** 插件实现：`src/plugins/builtin/git/renderer/` 下加 `git-changes-panel.tsx`（占位面板，类型走 `@shared/contracts/dockview.ts`）；`renderer/index.ts` 的 activate 里 `context.panels.register(git-changes)`；新增一条插件命令 `pier.git.changes.open`（manifest + action），handler 调 `context.panels.open`。
- **manifest**：git 插件 `panels` 声明一条 git-changes；`permissions` 加 `panel:register`/`panel:open`。
- **命令分类**：新命令 categoryKey 用 `git`（与 worktree 命令同分类）。

## 第一期成果处理

| 保留 | 改造/移除 |
|---|---|
| git 插件改名 `pier.git`（id/目录/catalog/测试） | git-changes：core panel-kit → git 插件贡献的 panel |
| worktree 命令归 Git 分类（categoryKey/i18n） | 打开命令：核心侧 `register-actions` → 插件命令 + `panels.open` |
| 命令/状态项注册机制、`pier.worktree.*` id 保留 | `open-git-changes.ts`（store helper）移除，逻辑入 `panels.open` |
| frecency/file-size 等修复 | `panel-registry` 的 `gitChanges` 静态条目移除 |

## 风险

- **timing window**：`getPanelComponents()` 依赖 bootstrap 先于首次 render。现状 `main.tsx` 确实先 `bootstrapBuiltinPlugins()` 再 render，满足；需在改造时保持该顺序，并对「dockview 已 mount 但 panel 未注册」做兜底（找不到 component 时不崩）。
- **运行时 toggle**：第一阶段不支持热 toggle（启用/禁用插件后即时增删 dockview component）。toggle 后效需重启。明确写入非目标，避免误期望。
- **permission 粒度**：`panel:register`/`panel:open` 是改进，但当前全是 builtin 插件，权限检查仍是形式；真正的 gate 在第三方插件阶段才有意义。本期只做粒度铺垫 + Settings 展示。
- **plugin dependencies 缺模型**：git-changes 假设 `git` 服务存在。当前 builtin-only 无碍；第三方阶段需补依赖声明。

## 测试策略

- 机制单测：`runtime` 的 panel 注册/dispose；`getPanelComponents()` 合并 core + 插件。
- 插件 panel 渲染测试：git-changes 占位面板（照现有 `git-changes-panel.test.tsx` 迁移）。
- 命令测试：`pier.git.changes.open` 贡献元数据 + handler 调 `panels.open`。
- 回归：`git-plugin.test.tsx` 扩展覆盖 panel 贡献；全量 `pnpm vitest run` + `pnpm check`（depcruise 确认插件不直接 import dockview、panel 跨域约束）。

## 后续（不在本期）

- 其他业务面板（走插件）：文件查看、git-changes 的 diff 内容渲染、跨 worktree 聚合、外部审查入口。
- 第三方插件加载（local/git/registry）、permission 沙盒、plugin dependencies 模型、插件 panel 运行时热 toggle、插件市集 UI。
