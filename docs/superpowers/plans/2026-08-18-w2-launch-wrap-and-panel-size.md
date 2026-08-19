# W2 宿主 spawn 装饰 + 比例尺寸

> **For agentic workers:** 只实现本文件。完成后主会话审查。禁止开始 W3（`packages/plugin-tmux/`）。禁止改金标准 spec 正文。禁止 commit。

**Goal:** 金标准 [`docs/superpowers/specs/2026-08-17-tmux-compat-native-splits-design.md`](../specs/2026-08-17-tmux-compat-native-splits-design.md) §6 + §5.2 尺寸 API。宿主提供 `launchWrap` / `decorateSpawn`、T2 注入 `PIER_CONTROL_SOCKET` / `PIER_WINDOW_ID` / `PIER_PANEL_ID`、spawn-ephemeral 剥离、`panel.setSize` / `panel.equalize`。宿主 API **零 tmux 词**。

**W1 已落地（不要重做、不要回退）：** `terminal.open.referencePanelId`、`focus: false`、`terminal.screen` / `read` / `close`。UI 未传 `focus` 仍抢焦点。

**本波不包含：** `pier.tmux`、假 tmux、PATH 前插真实 shim、预设、`terminals.open` 透传 `referencePanelId`（W3）、scrollback `terminal.read`。

---

## 0. 金标准对照（审查用）

| 锁什么 | 做法 |
|---|---|
| 两条启动链都走 wrap | `prepareLaunch` / `prepareLaunchFromSpec` **和** `terminal.open` 且 `launch.agentId` |
| 空白终端不包装 | 无 `agentId` → 不调用 wrap / decorateSpawn |
| one-shot | 宿主 **不** 解析 `-p`；留给 W3 插件 wrap no-op。不要发明 one-shot parser |
| T1 无 panelId | wrap 输入不含 window/panel；禁止把宿主身份 env 交给 wrap 去写 |
| T2 才有身份 | 先 `withPanelStatusEnv` 注入三项 `PIER_*`，再 `decorateSpawn` |
| T2 永远再跑 | 禁止「env 里已有某键则跳过 decorateSpawn」 |
| 恢复会话 | 再跑 T1 wrap（PATH 前插可再次发生）；身份必须是 **新** panel 的 `PIER_*` |
| 宿主不写 TMUX | `src/main` / `src/shared` / `src/renderer` / `packages/plugin-api` **不得**出现 `TMUX` 字面量（测试与 docs 除外） |
| spawn-ephemeral 不落盘 | decorateSpawn 返回的 env **键名** + 宿主身份三键，不得进入 restore launch spec / layout |
| 多 wrap 串联 | pluginId `localeCompare` 顺序；`decorateSpawn` 只接受 **第一个** 非空 env，其余 ignore + `logger.warn` |
| `terminal:launchWrap` | 仅插件 manifest 声明；**不要**放进 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND` |
| setSize / equalize | 相对直接 split 父组；不搬家、不重建拓扑、不调用全局 `equalizeDockviewSplits` |
| 尺寸命令含 agent 终端 | **禁止** `resolvePanelForWrite`（它拒 agent） |

---

## 1. 架构

```
prepareLaunch / terminal.open(agentId)
  → applyWrapT1 (无 panelId)
  → register launch（decorateSpawn 旗标走 side channel，不进 ResolvedTerminalLaunchOptions）
create-handler（windowId+panelId 已知）
  → 恢复路径也 applyWrapT1
  → withPanelStatusEnv（PIER_CONTROL_SOCKET / WINDOW / PANEL）
  → applyDecorateSpawnT2（若 T1 声明）
  → persist：toRestoreLaunch 已无 env；再断言 spawn env 的 ephemeral 键未写盘
  → native create 用带 ephemeral 的 spawn env
```

`decorateSpawn: boolean` **禁止**进入 `ResolvedTerminalLaunchOptions` / layout JSON。用 wrap runtime 按 `launchId` 记旗标；恢复路径没有 launchId 时，当场跑 T1 拿旗标。

---

## 2. 文件结构

新建（控制 500 行 / dir-density；`tests/unit/main/app-core/` 已满 40，**禁止**再往那里加文件）：

| 文件 | 责任 |
|---|---|
| `src/main/services/terminal-launch-wrap/registry.ts` | 注册表；capability 门控；pluginId 排序 |
| `src/main/services/terminal-launch-wrap/apply.ts` | T1 wrap / T2 decorateSpawn；PATH prepend；黑名单 |
| `src/main/services/terminal-launch-wrap/ephemeral.ts` | 记录 decorateSpawn 键；从 persist 对象剥离身份键 + 那些键 |
| `src/main/services/terminal-launch-wrap/index.ts` | 单例导出 |
| `src/main/app-core/commands/panel-size.ts` | `panel.setSize` / `panel.equalize` 命令实现 |
| `src/renderer/components/workspace/dockview-panel-size.ts` | 只动目标 split 父组 |
| `tests/unit/main/terminal/launch-wrap.test.ts` | T1/T2/空白/黑名单/双 decorateSpawn |
| `tests/unit/main/terminal/spawn-ephemeral.test.ts` | persist 不含 decorateSpawn 键；恢复再跑 T2 |
| `tests/unit/renderer/workspace/dockview-panel-size.test.ts` | fake grid：只 resize 目标组 |
| `tests/unit/app-core/panel-size-commands.test.ts` | schema / permissions / 不走 write 拒绝 |
| `tests/unit/shared/host/tmux-api-governance.test.ts` | 宿主源码无 `TMUX` 作 API |

修改（行数已贴上限，**只加调用、禁止把逻辑堆进去**）：

| 文件 | 现状行数 | 约束 |
|---|---|---|
| `src/main/app-core/permissions.ts` | 499 | 必须先抽出一块（建议 `panelTransfer.*` → `permissions-panel-transfer.ts` 或整表 `command-metadata.ts`）再加 `panel.setSize` / `panel.equalize` |
| `src/main/app-core/commands/panel.ts` | 494 | 只在 `executeTerminalOpenCommand` 里对 `launch.agentId` 调用 `applyWrapT1`；逻辑在 wrap 模块 |
| `src/main/ipc/terminal/create-handler.ts` | 472 | 只加一次 helper 调用（wrap+decorate+socket）；persist 仍用无 env 的 restore spec |
| `src/main/ipc/agents.ts` | 166 | prepareLaunch 两条路径 register 前 `applyWrapT1` |
| `src/main/ipc/terminal/create-launch.ts` | 276 | `withPanelStatusEnv` 增加 `PIER_CONTROL_SOCKET`（可选注入，缺省不写键以免测崩） |
| `packages/plugin-api/src/main.ts` | 公开 `launchWrap` 类型 | **注释与类型名禁止出现 TMUX** |
| `src/main/plugins/external-main-runtime.ts` | `ExternalMainPluginContext` 同步 `launchWrap` | |
| `src/main/app-core/external-plugin-context.ts` | factory 接线；无 `terminal:launchWrap` 则 `register` throw | |
| `src/shared/contracts/permissions.ts` | 加 `"terminal:launchWrap"`；**不**加入任何 client kind 默认表 | |
| `src/shared/contracts/host/control-commands.ts` | `panel.setSize` / `panel.equalize` schema | |
| `src/shared/contracts/commands.ts` | 并入上述 schema（若 discriminatedUnion 在此组装） | |
| `src/shared/contracts/renderer-command.ts` | 同源 renderer 命令 | |
| `src/main/app-core/command-router.ts` | `executePanelCommand` 两分支；452 行，可加 | |
| `src/renderer/components/workspace/renderer-commands.ts` | 分发 setSize/equalize | |
| `src/renderer/stores/workspace.store.ts` | 调 dockview-panel-size | |
| `bin/pier-cli-parser.js` | `panels set-size` / `panels equalize` | |
| `.pier/canvases/pier-cli-user-manual/data.json` | shipped 两条 | |
| `tests/unit/cli/cli-docs-surface.ts` | `REQUIRED_SHIPPED_COMMAND_NAMES` | |
| `tests/unit/cli/w4-cli-flags.test.ts` | stripOptions | |
| `tests/unit/terminal/panel-status-env.test.ts` | socket 注入 | |
| `tests/unit/app-core/permissions.test.ts` | 新命令能力 | |
| `tests/unit/shared/panel/contract.test.ts` | renderer schema | |

**禁止新建：** `packages/plugin-tmux/`、宿主 `PierCommand` 含 layout kind、人类 CLI `pier tmux`。

---

## 3. 插件 API（external main）

`packages/plugin-api/src/main.ts` 与 `ExternalMainPluginContext` **同构**：

```ts
launchWrap: {
  register(handler: {
    wrap(input: LaunchWrapInput): Promise<LaunchWrapResult>;
    decorateSpawn(input: LaunchSpawnInput): Promise<LaunchSpawnResult>;
  }): () => void;
};
```

- `LaunchWrapInput`: `agentId`, `command`, `env`, 可选 `cwd`。无 window/panel。
- `LaunchWrapResult`: 可选 `command`, `env`, `pathPrepend`（绝对目录数组）, `decorateSpawn`（boolean）。
- `LaunchSpawnInput`: `agentId`, `windowId`, `panelId`, `env`（已含三项 `PIER_*`）。
- `LaunchSpawnResult`: 可选 `env`（宿主 merge）。

builtin `src/plugins/api/main.ts` **不要**加 `launchWrap`（那是 configuration-only）。

`register`：`source.manifest.permissions` 不含 `terminal:launchWrap` → throw（对齐 secrets / lsp:provide）。deactivate 必须 dispose。

T1 `pathPrepend`：只接受绝对路径；相对路径忽略 + warn。宿主把目录按注册顺序拼到 `PATH` **最前**（已在 PATH 的不重复也可，但不要排到后面）。

T1 `env`：merge 进 launch.env。丢弃黑名单键（见 §4）。丢弃试图覆盖的 `PIER_CONTROL_SOCKET` / `PIER_WINDOW_ID` / `PIER_PANEL_ID`。

---

## 4. 黑名单与 ephemeral（宿主零 tmux 词）

与 `apply-host-env.ts` 的 `NEVER_APPLY_EXACT` + `DYLD_*` 前缀 + `LD_PRELOAD` / `LD_LIBRARY_PATH` 一致。额外：**丢弃 `TERM` / `TERM_PROGRAM`**（R10）。可抽 `isForbiddenLaunchWrapEnvKey(key)` 到 wrap 模块或 process-environment，避免复制两套又漏。

**不要**在宿主里写 `TMUX` / `TMUX_PANE` 字符串去剥离。做法：

1. T2 merge 前记下 `Object.keys(decorateSpawnResult.env ?? {})`。
2. persist / restore spec / 任何会写盘的 launch 对象：删这些键，以及 `PIER_CONTROL_SOCKET` / `PIER_WINDOW_ID` / `PIER_PANEL_ID`。
3. `toRestoreLaunch` 已 omit 整个 `env`——**保持**。测试仍要用「假 handler 返回自定义键」断言该键不在 persist payload；另在 **测试文件**（允许 TMUX 字面量）里用 `{ TMUX: "…", TMUX_PANE: "%0" }` 再断言 restore spec 不含这两键。
4. 内存 `terminalLaunchRegistry` 在 T1 register 时还没有 decorateSpawn env。T2 不要把 spawn env 写回 registry。

T2 **禁止**因 spawn env 已有某键而跳过 handler。

---

## 5. `PIER_CONTROL_SOCKET`

`withPanelStatusEnv` 已对所有终端（含空白）注入 `PIER_WINDOW_ID` / `PIER_PANEL_ID`。W2：当调用方传入 `controlSocketPath` 时再写 `PIER_CONTROL_SOCKET`。

路径用已有 `resolveLocalControlSocketPath(userDataDir)`（与 `registerCliLocalControl` 同一纯函数，不必单例）。`create-handler` 用 `app.getPath("userData")`；单测把 path 注入 helper，不要在 `withPanelStatusEnv` 里直接打 Electron。

空白终端：仍注入三项身份（中性、可复用），但 **不** wrap / decorateSpawn。

local-control 未起来时：不写 `PIER_CONTROL_SOCKET` 键（不要写空字符串冒充 socket）。

---

## 6. 挂钩点（缺一即 W2 失败）

### T1

1. `src/main/ipc/agents.ts` `prepareLaunch`：`resolveAgentLaunch` 之后、`register` 之前。
2. 同文件 `prepareLaunchFromSpec`：拼好 `{ agentId, command, cwd? }` 之后、`register` 之前。
3. `executeTerminalOpenCommand`：`launch.agentId` 有值时，在 `register` 之前。无 `agentId` 跳过。

`prepare-launch.test.ts` mock 了 registry；**空 wrap 表时 wrap 必须是恒等**，现有测试不得红。加一条：注册假 handler 后 `registerSpy` 收到的 launch `PATH` 含 prepend。

### T2

`create-handler.ts` 在 `addon.createTerminal(..., withPanelStatusEnv(...))` 之前：

1. 若有 `launch.launchAgentId`：对 `launchForCreate` 再跑 T1（覆盖 restore；fresh 路径 T1 已跑过，再跑必须幂等——PATH 已前插则不要叠出 `dir:dir:...` 无限重复，去重即可）。
2. `withPanelStatusEnv` 注入身份。
3. 若 T1 `decorateSpawn === true`：跑 T2，merge env。
4. persist 继续用 `toRestoreLaunch` / 已有 restore launch（无 env）。
5. native spawn 用 merge 后的 env。

`persistInitialTerminalAgent` 目前在 spawn **之前**调用且 `toRestoreLaunch` 已无 env。保持这个不变量即可；不要把 T2 env 传进 persist。

---

## 7. `panel.setSize` / `panel.equalize`

### Schema

`panel.setSize`: `{ panelId, windowId?, widthRatio?, heightRatio? }`。至少其中一个 ratio。ratio：`z.number().gt(0).lt(1)`（例如 `0.3`）。像素不做。

`panel.equalize`: `{ windowId?, panelIds: z.array(z.string().min(1)).min(1), axis: z.enum(["horizontal", "vertical"]) }`。

PierCommand 与 RendererCommand 字段一致。权限均为 `panel:control`。`cli-local` 已有该能力。

### 语义（金）

- **setSize**：相对 **直接 split 父组** 的 contentSize，不是窗口像素。`widthRatio` 找最近 HORIZONTAL 祖先；`heightRatio` 找最近 VERTICAL 祖先。无该轴 split（独叶子）→ 成功 no-op，不搬家。
- **equalize**：找到这些 panel 所在的、匹配 `axis` 的已有 split 组，只 `resizeView` / 均分 **该 splitview 的直接子节点**（整组兄弟，即使 panelIds 是子集）。**禁止**递归全树（那是 UI `equalizeDockviewSplits`）。**禁止** `addPanel` / 改 `referencePanel` / 把 panel 挪到别的 group。tabs 同组无 split → 成功 no-op。panel 分属无关 split → `invalid_command`，不改布局。
- 任意 panel（含 agent 终端、非 terminal）。找不到 panel → `not_found`。
- 现有命令面板「均分面板」(`pier.panel.equalizeSplits`) **行为不变**。

实现：从 `dockview-equalize.ts` 抽出 grid type-guard 到 `dockview-grid-internals.ts`（避免两套 internals），`dockview-panel-size.ts` 只走目标节点。renderer-commands 调 workspace store。main `panel-size.ts` 仿 `executePanelFocusCommand` 的跨窗定位，再 `rendererCommand.execute`。

### CLI

与现有 `pier panels list|focus` 同族：

```
pier panels set-size <panelId> [--width-ratio 0.3] [--height-ratio 0.4] [--window <id>] --json
pier panels equalize --axis horizontal|vertical --panel <id> [--panel <id> ...] [--window <id>] --json
```

`stripOptions` 必须吞掉 `--width-ratio` / `--height-ratio` / `--axis`（`--panel` 已有）。Canvas shipped + `REQUIRED_SHIPPED_COMMAND_NAMES` 增加 `"panels set-size"`、`"panels equalize"`。usage 字符串同步。

---

## 8. 测试（先写失败再实现）

1. **launch-wrap**：假 handler `pathPrepend` + `decorateSpawn: true`；T1 输出无 panel 身份键；T2 输入含三项 `PIER_*`；T2 调用发生在 panelId 已知之后（用假 create 管道或直接测 `apply.ts` + create-handler 薄封装）。
2. **空白终端**：无 agentId → wrap/decorateSpawn 调用次数 0；仍可注入 PIER_WINDOW/PANEL（现有 panel-status-env 行为）。
3. **双 decorateSpawn**：第二个非空 env 被忽略；可 spy warn。
4. **黑名单**：wrap/decorateSpawn 写 `NODE_OPTIONS` / `DYLD_INSERT_LIBRARIES` / `TERM` → 丢弃。
5. **ephemeral**：decorateSpawn 返回 `{ TMUX, TMUX_PANE, PIER_TMUX_SESSION }`（仅测试文件）→ `toRestoreLaunch` / persist payload 无这些键；spawn env 有。T2 在「spawn env 已含这些键」时 **仍调用** handler。
6. **恢复**：T2 使用新 panelId，不沿用旧身份。
7. **governance**：扫 `src/main` `src/shared` `src/renderer` `packages/plugin-api`（排除 `*.test.*`、fixtures、docs）无 `\bTMUX\b`、无 `main-vertical` / `tiled` 作为 API 字符串（注释/类型名同样禁止）。
8. **setSize/equalize**：fake split 树只改目标 `resizeView`；兄弟组 size 不变；不出现 addPanel。命令层：cli-local 可授权；schema 拒绝无 ratio、ratio=1、空 panelIds。
9. **CLI + canvas**。
10. `pnpm check:file-size`、`pnpm check:dir-density`、相关 unit。

`terminal:launchWrap` 加入 `pierCapabilitySchema` 后更新 `permissions.test.ts` parse 列表（若有枚举穷尽测试）。

---

## 9. 行数 / 密度 / 纪律

- 单文件 ≤ 500。`permissions.ts` 先拆再加。
- `tests/unit/main/app-core/` 硬上限 40，已满。
- `tests/unit/main/terminal/` 现 37，最多再加 3；多了就放到 `tests/unit/app-core/` 或 `tests/unit/shared/host/`。
- 禁止 `as any` / `@ts-ignore` / `@ts-expect-error`。
- 不要改无关 SSH 文件。不要 `git add .`。不要改金标准 spec。
- 用户文案：本波无新前台字符串则不碰 locale。CLI canvas 用白话（「按比例调整面板大小 / 均分指定面板所在的分屏」），不要写 tmux / 选区。

---

## 10. 完成定义

- 无注册者时启动路径与今天一致（现有 prepareLaunch / create 测试绿）。
- 有假 wrap 时：T1 PATH、T2 三项 PIER_*、ephemeral 不落盘、空白不包装。
- `panel.setSize` / `equalize` 可经 PierCommand + renderer command + CLI 到达，且不迁 panel。
- 治理扫描无宿主 TMUX API。
- 无 `packages/plugin-tmux/`。
- `pnpm exec vitest run` 覆盖上述测试文件 + `permissions` + `cli-docs-surface` + `w4-cli-flags` + `cli-bin` + `panel-status-env` + `prepare-launch` + `file-size` + `dir-density`。
