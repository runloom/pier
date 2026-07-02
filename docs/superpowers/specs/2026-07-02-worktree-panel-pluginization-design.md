# Worktree 创建面板插件化设计（方向 B）

更新时间：2026-07-02。前置：[2026-07-02-worktree-creation-design.md](2026-07-02-worktree-creation-design.md)（P1 已落地，commits `728041a..a22c03a`）。

## 背景与问题

P1 把创建面板放在了 renderer core（`components/common/worktree-create-host.tsx` + `stores/worktree-create.store.ts`），并在插件 API 上开了 feature-specific 的 `worktrees.openCreatePanel` 桥。这与 git 插件整合（2026-06-30 spec）确立的方向冲突：**git 功能应住在 git 插件里**。现状不对称——worktree 的 delete/prune/list UI 在插件，create UI 却在核心。

根因是插件 UI 能力面不足：`RendererPluginContext` 只有 quick-pick / alert-confirm / dockview panel 三种表面，没有模态 overlay 原语；且插件无法读偏好、无法开终端。

## 目标与非目标

目标：

1. **通用 overlay 原语**：插件可打开自绘的模态 overlay（React render prop），宿主统一承担 blocking 三件套（keybinding scope / 终端焦点 / fullscreen web overlay）。
2. **两个 worktree 域 API**（窄能力，不给插件通用越权）：
   - `worktrees.getCreationDefaults()` → `{branchPrefix, copyPatterns, setupCommand}`（main 侧读偏好）。
   - `worktrees.openTerminal({path, runSetup})` → main 侧校验 path 是本仓已知 worktree、从偏好取 setup 命令自行拼装 launch——**插件永远不能传任意命令字符串**。
3. **创建面板整体迁入 git 插件**：组件、状态、i18n（`ui.*` 键进插件 locales JSON）全部搬走；删除核心侧面板/store/locale 与 `openCreatePanel` 桥。
4. **「+」菜单解耦**：core 通过 `actionRegistry.get("pier.worktree.create")` 按 id 执行插件注册的 action（handler/enabled/disabledReason 皆有），core 不再 import 任何 worktree UI。
5. 删除 P1 Task 4 加的 preload `terminal.open` 透传（唯一调用方是被删的 store；`worktree.openTerminal` 取代其职责）。

非目标：

- 通用的 `context.preferences` / `context.terminals` 能力（安全边界大，等第二个真实用例再立独立 spec）。
- 交互与视觉变化：面板的 UI/键位/推导语义与 P1 终态（`a22c03a`）逐像素一致。
- 非 builtin 插件的 overlay 沙箱问题（当前插件均为 builtin，同 bundle React）。

## 设计

### 1. Overlay 原语

```ts
// plugins/api/renderer.ts 新增
overlays: {
  open(overlay: {
    id: string;                                    // 插件内唯一
    render: (controls: { close(): void }) => ReactNode;
  }): void;
  close(id: string): void;
}
```

- 单例语义（同 app-dialog）：新 open 顶替当前 overlay（旧的视为 close）。
- 宿主实现：`src/renderer/stores/plugin-overlay.store.ts`（zustand，`{current: {pluginId, id, render} | null}`）+ `src/renderer/components/common/plugin-overlay-host.tsx` 挂 app-shell。host 在 overlay 存在期间执行 blocking 三件套，scope id `overlay:plugin:<pluginId>:<id>`。
- 插件自绘 Dialog（`@pier/ui` 插件本就可用，先例 `git-branch-quick-pick-row.tsx`），host 只负责挂载 `current.render({close})` 与 blocking，不包壳——保持原语最小。
- 插件 deactivate 时宿主自动 close 该插件的 overlay（host-context 的 dispose 链上做）。
- 权限：不设 manifest 权限（对齐 quick-pick / dialogs 先例，纯 renderer UI）。

### 2. 两个 worktree 域命令

契约（`shared/contracts/worktree.ts` + `commands.ts`）：

```ts
worktreeCreationDefaultsRequestSchema = {}                    // 无参
WorktreeCreationDefaults = { branchPrefix: string; copyPatterns: string[]; setupCommand: string }

worktreeOpenTerminalRequestSchema = { path: string; runSetup: boolean }
```

- `worktree.creationDefaults`：权限 `worktree:read`；router 读 `services.preferences`，只返回三个 worktree 键。
- `worktree.openTerminal`：权限 `worktree:write`；router 复用 `worktree.open` 的校验（path 必须是本仓已知、非 bare/prunable 的 worktree），然后组装 `terminal.open`（`launch.cwd = path`，`runSetup && setupCommand.trim()` 时带 `command`，`focus: true`）委托 `executeTerminalOpenCommand`。
- preload `worktree-api.ts` 与插件 context `worktrees` 段同步加两个方法；`pier.worktree.create` 的 manifest permissions 增补 `worktree:read`（要 list + defaults）。

### 3. 面板迁移

- 新文件 `src/plugins/builtin/git/renderer/worktree-create-overlay.tsx`：P1 组件的插件化改写。状态从 zustand store 改为**组件本地 state**——打开时机与数据由 action handler 收集（`worktrees.list` + `git.listBranches` + `getCreationDefaults`），通过 render 闭包以 props 传入；派生（`deriveWorktreeCreation`，shared 纯函数不动）、提交流水线（create → openTerminal → notifications）全在组件内，context 经闭包捕获。
- 提交流水线语义与 P1 相同：成功→close+success toast；仅 `start:true` 调 `openTerminal({path, runSetup: true})`；openTerminal 失败→error toast 不回滚；create 失败→面板保留、error 行展示、恢复 idle。toast 走 `context.notifications`，文案走 `context.i18n.t("ui.worktreeCreate.*")`。
- action handler（`worktree-operation-actions.ts`）：目标判定与不可用分支保持不变，数据齐备后 `context.overlays.open(...)`；收集失败走 `notifications.error`。
- i18n：核心 `locales/{en,zh-CN}/worktree.ts` 的键翻译成插件 `locales/{en,zh-CN}.json` 的 `ui.worktreeCreate.*`（含 `pier.worktree.create` 命令的 aliases 顺手补上拼音，对齐现有条目风格）。

### 4. 删除与解耦清单

| 动作 | 目标 |
|---|---|
| 删 | `components/common/worktree-create-host.tsx`、`stores/worktree-create.store.ts` |
| 删 | 核心 `i18n/locales/{en,zh-CN}/worktree.ts` + 两个 index 注册 |
| 删 | 插件 API `worktrees.openCreatePanel` + host-context 实现 |
| 删 | preload `terminal.open`（含 `shared/contracts/terminal.ts` 的接口成员） |
| 改 | app-shell：`WorktreeCreateHost` → `PluginOverlayHost` |
| 改 | `add-panel-action.tsx`：菜单项改为 `actionRegistry.get("pier.worktree.create")`，`disabled = !action?.enabled()`，onClick 执行 `handler()`；删除对 worktree store 的 import |

### 5. 测试策略

- 迁移：store 单测的提交流水线语义 → overlay 组件测试（mock 插件 context，覆盖 P1 修复轮补齐的全部分支：空 setup、base 键、openTerminal 失败 toast、list 拒绝）。shared 命名测试不动。
- 新增：`worktree.openTerminal` router 测试（path 校验拒绝非 worktree、runSetup 空命令不带 command 键）、`worktree.creationDefaults` 只回三键、overlay host blocking 组件测试（打开时 pushBlockingScope、关闭时清理）、「+」菜单经 action registry 的既有组件测试改写。
- depcruise：确认 git 插件不 import renderer store/components（迁移后自然满足），host 不 import 插件。

## 风险

- overlay render prop 把 ReactNode 交给宿主渲染，builtin 场景无隔离问题；若未来支持外部插件需重新评估（已列非目标）。
- `worktree.openTerminal` 的 setup 命令来自用户偏好而非插件入参，故插件权限不扩大；review 时重点盯这条不被实现走样。
