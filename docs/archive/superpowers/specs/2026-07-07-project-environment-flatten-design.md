# 项目环境配置铺平设计

日期：2026-07-07

## 背景

Settings → Environment 目前把"项目 → 多个命名环境 → 选择当前"三层堆在同一屏里，还外挂 `worktreeBindings` 一层来记录"某个 worktree 绑到哪个 environment"。整个抽象服务于一个假想需求：同一项目下需要多套 `setup / cleanup / env` 配置，用户按 worktree 或场景来切换。

这个需求在 Pier 里没有真实场景支撑：

- 每个 AI agent 需要的账号、密钥、路径由 `agent-accounts` 域承担，与项目 environment 无关。
- 一个项目"多套 profile"（prod-like / dev / test）通常靠 `.env.local + NODE_ENV` 解决，本地开发工具不该抢这一层。
- worktree 之间需要不同 env 变量的场景极低频，且已经能通过 `.env.local` 覆盖。

结果是 UI 冗余（左侧列表 + 编辑器 + Create 表单 + Add Project dropdown）、状态复杂（`selectedEnvironmentId` + 本地 UI 选择映射 + 脏态守卫）、schema 和命令带一整套 CRUD（`environment.create / select / update`），而收益极低。

本设计把"项目 → 一份配置"作为唯一模型：每个项目直接持有 `setupCommand / cleanupCommand / env`，不再有命名环境概念，也不再有环境级选择。UI 相应铺平为单栏编辑器。

## 业界调研结论

调研来源：

- direnv：一个目录一份 `.envrc`，无 profile 概念。https://direnv.net/
- VS Code devcontainer.json：一个项目一份 dev container 定义。https://containers.dev/implementors/json_reference/
- Vercel Environment Variables：项目一张 KV 表，Prod/Preview/Dev 是"部署阶段"标签，不是本地开发的 profile。https://vercel.com/docs/environment-variables
- Warp Workflows：工作区级配置一份，无 profile 切换。https://docs.warp.dev/features/warp-drive/workflows
- Codex.app：走多 env 模型，但 Codex 的产品重心就是 profile 切换本身，与 Pier 定位不同。

稳定模式：

1. "背景配置"（worktree lifecycle 副作用 + terminal env 注入）业界统一是一份，不做 profile。
2. "运行/调试目标"（VS Code launch.json / JetBrains Run Configurations / Xcode Schemes）才做 N 个，因为配置本身就是选择目标。Pier 的 env 不属于这一类。
3. KV 变量用一张表 + 每行删除按钮 + 底部 `Save`，是所有 CI/PaaS/云平台的共识样式。

结论：Pier 应对齐 direnv / devcontainer 模式，走"项目一份配置"。

## 目标和完成标准

目标：

- 每个项目在 `local-environments.json` 里持有一份铺平的 `setupCommand / cleanupCommand / env`，不再有 `environments[]` 数组或 `selectedEnvironmentId`。
- Settings → Environment 显示当前 focus 的项目 + 直接编辑其唯一配置。
- 顶部 `Project` 切换器负责多项目切换；`+ Add folder` 按钮点击直接打开文件夹选择器。
- worktree 生命周期：在项目有 `setupCommand` 时，`worktree.create` 之后运行；在项目有 `cleanupCommand` 且该 worktree 有 `worktreeBinding` 时，`worktree.remove` 之前运行。
- 插件通过 `context.environments.worktreeBinding({ worktreePath })` 拿到的仍是"当前 worktree 有效 env"，只是背后就是所属项目的配置。

完成标准：

- 无 `EnvironmentSelector` / `CreateEnvironmentForm` 组件，无 environment 级 CRUD 命令、无 environment 级 store 方法。
- `LocalEnvironmentState` schema、preload API、command router、renderer store、Settings 组件、i18n 全部按新模型铺平，不留兼容包袱。
- 现有单元 / 组件 / 端到端测试更新至新模型；契约测试用铺平后的 schema 断言。
- 全量 `pnpm check` 与 `pnpm test:e2e tests/e2e/startup-stability.spec.ts` 通过。

## 非目标

- 不做每 worktree 独立 env 覆盖（真需要时用 `.env.local`）。
- 不做 preset / 模板 / duplicate。
- 不做 setup 与 cleanup 命令的语法高亮或试跑按钮。
- 不做 `.env` 文件导入或导出。
- 不引入 User / Project scope 二级 tab（Settings 保持扁平；只在需要项目作用域的 section 内部承担项目切换）。
- 不做数据迁移或兼容分支：项目尚未发布，直接以新 schema 上线。

## 数据模型

### `local-environments.json` 铺平前

```ts
LocalEnvironmentProject {
  environments: LocalEnvironmentProfile[];
  projectRootPath: string;
  selectedEnvironmentId: string | null;
  updatedAt: number;
}
LocalEnvironmentProfile {
  cleanupCommand: string;
  env: Record<string, string>;
  id: string;
  name: string;
  setupCommand: string;
  updatedAt: number;
}
LocalEnvironmentWorktreeBinding {
  createdAt: number;
  environmentId: string;
  projectRootPath: string;
  worktreePath: string;
}
```

### 铺平后

```ts
LocalEnvironmentProject {
  cleanupCommand: string;
  env: Record<string, string>;
  projectRootPath: string;
  setupCommand: string;
  updatedAt: number;
}
LocalEnvironmentWorktreeBinding {
  createdAt: number;
  projectRootPath: string;
  worktreePath: string;
}
LocalEnvironmentState {
  projects: LocalEnvironmentProject[];
  version: 1;
  worktreeBindings: LocalEnvironmentWorktreeBinding[];
}
```

变化点：

- 删除 `LocalEnvironmentProfile` 类型和 `localEnvironmentProfileSchema`。
- 删除 `localEnvironmentIdSchema`（这是环境级 ID，项目级 ID 用 `projectRootPath` 即可）。
- 项目级字段收纳 `setupCommand / cleanupCommand / env`。
- `LocalEnvironmentWorktreeBinding` 删除 `environmentId` 字段；剩余字段的语义是"这个 worktree 是 Pier 建的、属于这个项目"。删除 worktree 时凭 binding 存在判定是否跑 cleanup。

### `LocalEnvironmentWorktreeBindingSnapshot` 铺平

铺平前用于 plugin API 的 snapshot：

```ts
LocalEnvironmentWorktreeBindingSnapshot {
  environmentId: string;
  environmentName: string | null;
  hasCleanupScript: boolean;
  projectRootPath: string;
  worktreePath: string;
}
```

铺平后：

```ts
LocalEnvironmentWorktreeBindingSnapshot {
  cleanupCommand: string;
  env: Record<string, string>;
  hasCleanupScript: boolean;
  projectRootPath: string;
  setupCommand: string;
  worktreePath: string;
}
```

`hasCleanupScript` 与 `cleanupCommand !== ""` 语义等价，保留 boolean 是因为插件读侧更常用"有没有清理"这个是/否，不用去看字符串是否为空。

### 命令契约变更

删除：

- `environment.create`
- `environment.select`
- `environmentCreateRequestSchema`
- `environmentSelectRequestSchema`

改造：

- `environment.update` 的请求从 `{ environmentId, projectRootPath, cleanupCommand, env, name, setupCommand }` 铺平为 `{ projectRootPath, cleanupCommand, env, setupCommand }`。项目级配置没有 `name`，项目本身的名字用 `projectBasename(projectRootPath)` 展示。

保留：

- `environment.snapshot`
- `environment.project.add`
- `environment.project.remove`
- `environment.worktreeBinding`

`environment.worktreeBinding` 结果由铺平后的 snapshot 定义。

### store 与 preload API

`useLocalEnvironmentsStore`：

- 删除 `createEnvironment / selectEnvironment` 方法。
- `updateEnvironment` 改名为 `updateProject`，签名对齐新的 `environment.update` 请求。
- `projects[i]` 由铺平后的 `LocalEnvironmentProject` 直接消费。

`window.pier.environments`：

- 删除 `create` / `select`。
- `update` 请求类型改为新的 flat payload。
- `worktreeBinding` 返回类型改为新的 snapshot。

## 所有权划分

- 数据：`main/services/local-environments-service.ts` 生成 `LocalEnvironmentState` 快照，负责 `worktreeBindings` 增删和 `hasCleanupScript` 派生。
- 生命周期：`main/services/worktree-service.ts` 在 `worktree.create` / `worktree.remove` 时调用 `local-environment-scripts.ts` 跑 `setupCommand` / `cleanupCommand`；判定逻辑走"项目存在 + 命令非空 + binding 命中"，无环境级 ID。
- 命令：`main/app-core/environment-commands.ts` 只暴露 snapshot / project.add / project.remove / update / worktreeBinding。
- Renderer 状态：`renderer/stores/local-environments.store.ts` 镜像 main 广播的 `LocalEnvironmentState`。
- UI：`renderer/pages/settings/components/environment-section.tsx` 只做布局与 project 切换；`renderer/pages/settings/components/environment-editor.tsx` 承载单份 project 配置的表单。
- 测试：契约测试断言新 schema；组件测试断言编辑器行为；main 侧单测覆盖 setup / cleanup 判定。

## 交互设计

### 全屏结构

```text
Environment ────────────────────────────────────────

Project [ pier ▾ ]                    [ + Add folder ]
~/ABC/pier

Setup command
┌────────────────────────────────────────────────┐
│ pnpm setup:worktree                            │
└────────────────────────────────────────────────┘
Runs when a worktree is created.

Cleanup command
┌────────────────────────────────────────────────┐
│ pnpm cleanup:worktree                          │
└────────────────────────────────────────────────┘
Runs when a worktree is removed.

Variables
┌───────────┬────────────────────────────┬───┐
│ NODE_ENV  │ development                │ − │
├───────────┼────────────────────────────┼───┤
│ PORT      │ 5173                       │ − │
└───────────┴────────────────────────────┴───┘
+ Add variable

                                       [ Save ]
```

### 顶部项目行

- 左侧 `Project` combobox：使用 `DropdownMenu`（沿用现有 `@pier/ui/dropdown-menu.tsx`），项目按 `projectBasename` 显示，副标题小灰字给完整路径。
- 打开 Settings → Environment 时 focus 判定顺序：用户当次会话中在 UI 里选择过的项目 → `activeProjectRootPath` 若在 `projects[]` 中命中 → 第一个项目 → 无。UI 侧选择映射存 `useState`，不落盘。`activeProjectRootPath` 若不在 `projects[]` 中不作为 focus 依据，也不自动加入。
- 右侧 `+ Add folder` 按钮直接调 `window.pier.environments.pickProjectDirectory()` → 若返回路径则 `project.add({ projectRootPath })` → focus 到新项目。整个链路是一次点击，不再有 dropdown。

### 中部编辑器

- Setup / Cleanup 命令：`Textarea`，`font-mono`，`min-h-32`，下方 `text-muted-foreground text-xs` 一行说明分别写 "Runs when a worktree is created." / "Runs when a worktree is removed."。
- Variables：KV 表，KEY 用 `Input` monospace 窄列（约 160px），VALUE 用 `Input` monospace flex 铺满，右侧固定 `−` 按钮列。`+ Add variable` 使用 `variant="ghost"` 的 `Button`，左对齐在表下方。
- 空 KEY 的行在 Save 时被丢弃（对齐现有 `rowsToEnv` 行为）。

### 底部动作

- 右下角只有 `[ Save ]`。
- Save disabled 当且仅当草稿等于原值。
- 无 Cancel 按钮：切换项目 / 关闭 Settings 时用脏态守卫覆盖误改场景。

### 脏态守卫

- 切换项目、点击 `+ Add folder` 后要 focus 新项目、Settings 关闭：如果当前项目编辑器 dirty，走 `showAppConfirm({ size: "sm", intent: "destructive", title: t("settings.environment.discardTitle"), body: t("settings.environment.discardBody", { name }) })`。
- 用户 Discard 确认后执行原动作，Keep editing 取消。
- 项目删除动作也走 `showAppConfirm`（destructive），且必须给出 "N worktree(s) currently bound to this project." 计数（可用 `worktreeBindings.filter(b => b.projectRootPath === p).length` 派生）。

### 空态

- 无项目：整个 `Card` 中显示居中说明 + `+ Add folder` primary 按钮，语义与顶部按钮完全一致。
- 有项目：直接落入单份编辑器；不再有"无环境"分支。

## 组件结构

```text
renderer/pages/settings/components/
  environment-section.tsx        //  顶部 project 行 + 空态 + focus 判定
  environment-editor.tsx         //  单份配置的表单（setup/cleanup/env vars/Save/脏态）
  environment-vars-table.tsx     //  KV 表格局部组件
```

拆分理由：

- `environment-section.tsx` 只关心"哪个项目"、"没有项目怎么办"、"切换时怎么处理草稿"，无字段逻辑。
- `environment-editor.tsx` 只关心"这份配置的表单交互"，接受铺平后的 `LocalEnvironmentProject` 作为 prop，输出 Save 请求；不需要知道 project switcher 存在。
- `environment-vars-table.tsx` 从 editor 里进一步抽出 KV 表，避免 editor 文件继续膨胀（目前接近软上限）。

删除组件：`EnvironmentSelector`、`CreateEnvironmentForm`、`projectBasename` 从 editor 提出到 `environment-section.tsx` 内部（或抽到 `settings/components/project-basename.ts` 复用）。

## 主进程 setup / cleanup 判定

`worktree.create` 由 Pier 主进程发起时：

1. 找到 `projects[i]` 使 `projectRootPath === gitRoot`。
2. 若 `projects[i]` 存在且 `setupCommand !== ""` → 跑 setup。
3. 无论 setup 是否运行、无论命令是否为空，只要该 worktree 是通过 Pier UI 创建 → 写入 `worktreeBindings`。这里的 binding 记录的是"Pier 建的 worktree 归属哪个项目"，与 setup / cleanup 命令是否为空解耦。用户此后再往项目里加 cleanup 命令，删 worktree 时也能命中。

`worktree.remove` 由 Pier 主进程发起时：

1. 找 `worktreeBindings.find(b => b.worktreePath === wt)`。
2. 未命中 → 视为不是 Pier 建的，不跑任何脚本，直接返回。
3. 命中：找 `projects[i]` 使 `projectRootPath === b.projectRootPath`；若存在且 `cleanupCommand !== ""` → 跑 cleanup（用**当前** cleanupCommand，不做快照，与 devcontainer/direnv 语义一致）。
4. 无论 cleanup 是否运行，从 `worktreeBindings` 移除该条。

不引入"环境级 id"到 binding，与 schema 一致。

## 删除清单

代码：

- `EnvironmentSelector` 组件、`CreateEnvironmentForm` 组件、及所有导入。
- `useLocalEnvironmentsStore` 里的 `createEnvironment` / `selectEnvironment`。
- preload `environmentsApi.create` / `environmentsApi.select`。
- Main 侧 `environment.create` / `environment.select` command 路由分支。
- Main service `createEnvironment` / `selectEnvironment` 方法及 `LocalEnvironmentServiceError.reason = "environment_not_found"`。
- Schema `localEnvironmentProfileSchema`、`localEnvironmentIdSchema`、`environmentCreateRequestSchema`、`environmentSelectRequestSchema`。
- Renderer store 里 `selectedEnvironmentIds` 本地状态与相关 `selectEnvironment` 函数。
- i18n key：`settings.environment.createLocalEnvironment` / `create` / `id` / `envVars`（若 `envVars` 复用可保留）/`noEnvironment`（改成 `noProject`）/`selectEnvironment` 等。

测试：

- 现有 `settings-dialog-environment.test.tsx` 里"环境选择 / fallback / create-then-focus / switch-swap"用例整体重写为项目级。

## 测试策略

契约 / schema：

- `tests/unit/shared/local-environments-contract.test.ts`：解析铺平后的 state / project / binding / snapshot；旧字段（`environments`、`selectedEnvironmentId`、`environmentId`）解析失败。

Main 侧：

- `tests/unit/main/local-environments-service.test.ts`：`addProject / removeProject / updateProject / snapshot / worktreeBinding` 全走新签名；跑 setup / cleanup 的判定用真实 stub 分别覆盖"有命令有 binding"、"有命令无 binding"、"无命令"、"项目不存在"四种情形。
- `tests/unit/main/local-environment-scripts.test.ts`：现有脚本执行器实现无变化，回归即可。
- `tests/unit/main/worktree-service.test.ts`：`worktree.remove` 有 binding 时跑 cleanup、无 binding 时不跑；`worktree.create` 后写入 binding；判定不依赖环境 ID。

Renderer：

- `tests/unit/renderer/settings-dialog-environment.test.tsx` 重写：
  - 编辑器渲染单份配置的三个字段 + KV 表。
  - Save 只 dispatch `environment.update` 一次，payload 为铺平字段。
  - 切换项目时 dirty 触发 `showAppConfirm`。
  - `+ Add folder` 触发 `pickProjectDirectory` → `project.add`。
  - 无项目空态渲染 primary `+ Add folder`。
- `tests/component/environment-editor.test.tsx`（若不存在则新增，若与上一份重合则合并到单元测试）：KV 表 add / delete / trim 行为。

端到端：

- 已有 `tests/e2e/startup-stability.spec.ts` 保底，不新增 e2e 用例。

## 视觉与实现约束

- 只用 shadcn primitives + `@pier/ui`；不新增全局 CSS。
- 编辑器整体用 `flex flex-col gap-4`，与其他 settings section 一致。
- 表格式 KV 用简单 `grid grid-cols-[160px_1fr_auto] gap-2`，不引入 table primitive。
- 弹窗一律走 `showAppConfirm` / `showAppAlert`，遵循 `AGENTS.md §03 宿主弹窗使用规范`（destructive 显式传 `intent`，短确认显式传 `size: "sm"`）。
- 不新增 z-index，不写自定义颜色 token。

## 实施阶段拆分

1. **契约铺平**：改 `src/shared/contracts/environment.ts`；删除环境 ID / profile 相关 schema；改 `environment.update` payload；改 `LocalEnvironmentWorktreeBindingSnapshot`。
2. **主进程**：改 `local-environments-service.ts`；删除 `createEnvironment / selectEnvironment` 与 `environment_not_found`；`updateProject` / `worktreeBinding` 对齐新 schema。
3. **命令路由 + preload**：删除 `environment.create` / `environment.select` 分支；`environment.update` 与 `environment.worktreeBinding` 签名对齐。
4. **worktree 生命周期**：`worktree.create` 写 binding、`worktree.remove` 凭 binding 跑 cleanup，不再引用环境 ID。
5. **Renderer store**：`useLocalEnvironmentsStore` 删除 `createEnvironment / selectEnvironment`；`updateEnvironment → updateProject`；移除环境 ID 派生。
6. **UI**：重写 `environment-section.tsx` 为顶部 project 行 + 单份编辑器；拆出 `environment-vars-table.tsx`；删除 `EnvironmentSelector` / `CreateEnvironmentForm`。
7. **i18n**：删除环境级 key，新增 `discardTitle / discardBody / noProject / setupHint / cleanupHint`。
8. **测试**：按测试策略重写单测与组件测试；跑全量 `pnpm check` 与端到端。
9. **文档**：更新 `AGENTS.md §03` 中关于 environment 域的描述，把"多环境"表述换成"每项目一份"。
