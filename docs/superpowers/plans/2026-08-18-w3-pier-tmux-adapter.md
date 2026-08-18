# W3 官方插件 `pier.tmux`（适配器金路径）

> **For agentic workers:** 只实现本文件。W2 已落地，不要回退。禁止实现 W4 预设糖（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` / omo shadow / `--port 4096`）。禁止改金标准 spec 正文。禁止 commit。

**Goal:** 金标准 [`docs/superpowers/specs/2026-08-17-tmux-compat-native-splits-design.md`](../specs/2026-08-17-tmux-compat-native-splits-design.md) §7 适配器 + §8 设置（仅适配器键）+ §12 金路径（**预设全关**）。用户「启动 Claude / OpenCode」后，智能体自己 `exec tmux` 落到 Pier 原生 panel。

**W2 已提供（直接用）：** `launchWrap` / `decorateSpawn`、`PIER_CONTROL_SOCKET|WINDOW|PANEL`、`terminal.open.referencePanelId`、`focus: false`、`terminal.screen/read/close`、`panel.setSize/equalize`。

---

## 0. 金标准对照

| 锁什么 | 做法 |
|---|---|
| 方言只在插件 | 宿主源码仍禁止 `TMUX` API 字面量（W2 governance 继续绿） |
| 假 tmux 热路径 | `{workDir}/bin/tmux` 内嵌 local-control **v1** NDJSON；禁止 spawn `bin/pier` / `pier.mjs` / 人类 CLI |
| `-t` + `-d` | `terminal.open` + `referencePanelId` + `placement`；有 `-d` 才 `focus: false`，无 `-d` 则 `focus: true`（或不传，宿主缺省抢焦） |
| 适配器默认可开 | `pier.tmux.adapter.enabled` default **true**；claude / opencode default **true** |
| 空白 / one-shot / omp | wrap 返回空结果（无 pathPrepend、无 decorateSpawn） |
| 预设 | schema 可以暂不声明；**T1 不得**写 Teams/omo env。W4 再加 |
| 设置文案 | locale **禁止** shim / PATH / TMUX / teams / omo 实现词 |
| 不注册命令面板「带映射启动」 | renderer 只有 settingsPage |
| 插件不 import dockview | governance 扫描 `packages/plugin-tmux` |
| 官方索引 | **不要**改已签名的 `plugins/index.v1.json`（CI `--source=release` 会去 GitHub 拉还不存在的 tgz）。走 bundled + extraResources + workspace pack，与 ssh 同路 |
| send-keys 金路径 | **必须**能写入 agent 终端。现 `resolvePanelForWrite` 拒 agent，与 §7.3 冲突 → 本波去掉该拒绝 |

---

## 1. 宿主小补丁（插件成立的阻塞依赖）

### 1.1 `terminal.send` / `terminal.key` 允许 agent panel

文件：`src/main/app-core/commands/terminal-control.ts`

删除（或短路）`resolvePanelForWrite` 里对 `role === "agent"` / Runtime Index 的写拒绝。screen/close 已允许；send-keys 是 tmux 映射的一部分，cli-local 与人类 `pier terminal send` 同 client kind，无法再拆。

更新 `tests/unit/main/app-core/terminal-control-agent-boundary.test.ts`：send/key 对 agent **成功**（与 screen 同构）。文件已在 cap 目录内，只改现有文件。

### 1.2 External main 增加 `configuration`

`packages/plugin-api/src/main.ts` `MainPluginContext` 与 `ExternalMainPluginContext` 加上与 renderer 同构的：

```ts
configuration: {
  get<T>(key: string): T;
  onDidChange(cb: (event: { changedKeys: readonly string[] }) => void): () => void;
  reset(key: string): Promise<void>;
  set(key: string, value: unknown): Promise<void>;
};
```

`createExternalMainPluginContextFactory` 注入已有 `PluginSettingsService`（`src/main/app-core/index.ts` 里 factory 创建点已有 `pluginSettings`）。set/reset 只允许 `pier.tmux.` 前缀（对齐 builtin `createMainPluginContext`）。get 走 `effectiveConfigurationValue(manifest.configuration.properties[key], userValue)`。

更新 `tests/unit/main/plugins/external-main-runtime.test.ts` 的 fake context，补 `configuration`。

### 1.3 不要做

- 不要给 renderer `terminals.open` 加 `referencePanelId`（假 tmux 不走 renderer API）
- 不要新 client kind、新 socket 家族
- 不要改金标准 spec

---

## 2. 插件包结构

新建 `packages/plugin-tmux/`，照抄 `packages/plugin-ssh/` 的 vite/tsconfig/pack 骨架。

```
packages/plugin-tmux/
  plugin.json
  package.json          # name: @pier/plugin-tmux, version 1.0.0
  tsconfig.json
  vite.config.main.ts   # lib entries: main + tmux
  vite.config.renderer.ts
  src/env.d.ts
  src/main/index.ts           # activate: 写 shim、register launchWrap、dispose
  src/main/wrap.ts            # T1/T2
  src/main/settings-keys.ts   # 配置 key 常量
  src/main/install-shim.ts    # mkdir workDir/bin + copy dist/tmux.js + chmod 755
  src/main/session-map.ts     # {workDir}/sessions/<sessionId>.json
  src/tmux/cli.ts             # 假 tmux 入口（单独 bundle）
  src/tmux/parse.ts           # argv
  src/tmux/verbs.ts           # 白名单翻译
  src/tmux/control-client.ts  # v1 NDJSON 短连接
  src/renderer/index.tsx
  src/renderer/settings-page.tsx
  src/renderer/translate.ts
```

Vite main：`lib.entry = { main: "src/main/index.ts", tmux: "src/tmux/cli.ts" }`，产出 `dist/main.js` + `dist/tmux.js`。两者都 inline 非 node 依赖；external 仅 `node:*` 与 `@pier/plugin-api/main`（**tmux 入口不要依赖 plugin-api**，它跑在用户 PATH 下的裸 Node）。

`plugin.json`：

- id `pier.tmux`，name 面向用户（en: 工作台分屏 / 或 “Native splits”；zh 在 locales）
- permissions：`terminal:launchWrap`、`terminal:control`、`terminal:read`、`panel:control`、`panel:read`
- settingsPages：`[{ "id": "pier.tmux.adapter" }]`
- configuration.properties（boolean）：
  - `pier.tmux.adapter.enabled` default true
  - `pier.tmux.adapter.agents.claude` default true
  - `pier.tmux.adapter.agents.opencode` default true
- **不要**本波加 preset 键
- 无 commands / panels / workbenchWidgets / terminalStatusItems
- locales.en / zh-CN：settingsPages title + messages；**禁止** shim、PATH、TMUX、teams、omo、选区、Agent、worktree

### 接入宿主打包（与 ssh 逐项对齐）

| 文件 | 改什么 |
|---|---|
| `src/main/app-core/bundled-official-plugins.ts` | 加 spec `packages/plugin-tmux` / `pier.tmux` |
| `electron-builder.yml` extraResources | `packages/plugin-tmux/dist-pkg` → `plugin-packages/pier.tmux` |
| `package.json` | `plugin:tmux:build` / `plugin:tmux:pack`；`typecheck:packages` 加 tsconfig |
| `scripts/dev-with-plugins.mjs` | watch main+renderer |
| `tests/unit/main/plugins/managed-plugin-packaging-governance.test.ts` | assert extraResources 含 plugin-tmux |
| `docs/plugins.md` | 官方插件列表 + `pnpm plugin:tmux:build` |

`pnpm plugins:pack` 已是 `@pier/plugin-*`，新包会自动打进。

---

## 3. 假 `tmux`（`src/tmux/cli.ts`）

行为（严格按 §7.2）：

1. `tmux -V` / `-version` / `tmux version`：stdout `tmux 3.4\n`，exit 0，不打 socket
2. 无 `TMUX` **或** 无 `PIER_CONTROL_SOCKET`：exit 1，不打宿主
3. 白名单动词 → 读 session map → local-control v1 → 更新 map → 按 `-P -F` 打印
4. 未知动词：stderr 一行（人类可读、不要堆栈）+ exit 1；**禁止** exec 系统 tmux

v1 客户端（`control-client.ts`）：

- `net.createConnection(process.env.PIER_CONTROL_SOCKET)`
- 写一行 JSON + `\n`：
  `{ protocolVersion: 1, requestId, clientId: "cli-local", command }`
- 读一行 JSON `PierCommandResult`，关连接
- 超时失败 → exit 1
- **禁止** import 仓库 `bin/pier.mjs`

`wait-for`：进程内完成，不打宿主。`rename-window`：exit 0 空成功。

### 3.1 动词翻译（`verbs.ts`）

实现 §7.3 表。测试用 argv 夹具锁 PierCommand，不要起 Electron。

| 动词 | 命令 |
|---|---|
| `split-window` | `terminal.open`：`referencePanelId` 从 `-t`（`%N` 或当前 `TMUX_PANE`）；`-h` → `split-right`，`-v` → `split-below`（tmux 默认 `-v` 若都没写则按 tmux 默认 vertical=`split-below`）；`-d` → `focus: false`；`-c` → `launch.cwd`；子 pane `launch.env` 带同一 `TMUX`、新 `TMUX_PANE`、`PIER_CONTROL_SOCKET`、`PIER_WINDOW_ID`、**新** `PIER_PANEL_ID`（open 返回后再写 map；若必须先注入，先 open 再无法改 env——**env 在 spawn 前必须带齐**：open 的 launch.env 先带 TMUX/SOCKET/WINDOW/旧 PANEL，宿主 withPanelStatusEnv 会覆盖 PIER_PANEL_ID 为新 id。因此 **不要**在 launch.env 里写死旧 `PIER_PANEL_ID`；只传 `TMUX` / `TMUX_PANE=%新` / `PIER_CONTROL_SOCKET` / `PIER_WINDOW_ID`，让宿主盖 PANEL） |
| `new-window` / `new-session` | `terminal.open` `placement: "active-tab"`，分配新 `%N` |
| `send-keys` | literal → `terminal.send`；Enter/Escape/Tab/C-c → `terminal.key` |
| `capture-pane` | `-p` → `terminal.screen`（或 `read`）；打印 text |
| `select-pane` / `select-window` | `panel.focus` |
| `kill-pane` / `kill-window` | `terminal.close`；从 map 删；剩余 sibling 可选 `panel.equalize`（axis 由现有 split 猜，失败则跳过） |
| `list-panes` / `list-windows` | **只输出本 session 已映射 pane**；可 `terminal.get` 补几何；不得列出同窗口其它终端 |
| `resize-pane -x\|-y <pct>%` | `panel.setSize` `{ widthRatio \| heightRatio: pct/100 }`；像素参数忽略并成功 no-op |
| `select-layout even-horizontal\|even-vertical` | `panel.equalize` |
| `select-layout main-vertical` | leader `setSize({ widthRatio: 0.3 })` + 非 leader `equalize({ axis: "vertical" })`；不搬家 |
| `select-layout tiled` | 对映射 pane 所在组 equalize 横+纵各一次；组结构不允许则成功 no-op |
| `display-message` | 本地替换 `#{pane_id}` / `#{pane_current_path}` 等，几何来自 `terminal.get` |

拒绝（exit 1）：`bind-key`、`source-file`、`attach-session`。

`-P -F #{pane_id}`：stdout 只打格式化后的 id（如 `%2`），这是 omo 解析依赖。

### 3.2 session map

路径：`{workDir}/sessions/<sessionId>.json`。不要写 layout JSON、不要写密钥、不要写 transcript。

T2 生成：

- `sessionId`：稳定派生自 `windowId`（不要用随机导致恢复丢失；可用 windowId 本身或 hash）
- `TMUX=<workDir>/sessions/<sessionId>.sock,<pid>,0`（文件不必可连）
- `TMUX_PANE=%0`
- map `%0 → { panelId, windowId }`

leader 已关或文件 mtime > 24h → 下次 split/list **重置** session（新 `%0` 绑定当前 panel）。

并发：同一 session 文件用同步读写 + 简单 mutex（单 PTY 一般单线程 shim 进程；多个 pane 会有多个 shim 进程 → 用 `writeFileSync` 整文件替换，先读后写接受最后写者，但分配 `%N` 必须单调。实现：读-改-写时若发现 id 冲突则重新读一次）。

---

## 4. wrap / decorateSpawn

`src/main/wrap.ts`，activate 时 `context.launchWrap.register`。

**T1 wrap**

- 无 `agentId` → `{}`
- `agentId` 不是 `claude` / `opencode` → `{}`
- one-shot：command 匹配 `(^|\s)(-p|--print)(\s|$)` → `{}`（保守，避免误伤）
- `adapter.enabled === false` 或该 agent 开关 false → `{}`
- 否则 `{ pathPrepend: [join(workDir, "bin")], decorateSpawn: true }`
- **禁止**写 TMUX\*；**禁止**写预设 env

PATH 去重由宿主 W2 负责。wrap 可被 create 路径再跑一次，必须幂等。

**T2 decorateSpawn**

- 用 `PIER_WINDOW_ID` / `PIER_PANEL_ID` 建/更新 session
- 返回 `{ env: { TMUX, TMUX_PANE: "%0" } }`（仅测试文件和插件源码出现 TMUX 字面量）
- 每次都跑，不要因 env 已有 TMUX 而跳过

activate 必须 `installShim`：把 `dist/tmux.js` 写成 `workDir/bin/tmux`（从 `import.meta.url` 解析 sibling），`chmod 0o755`，文件头 `#!/usr/bin/env node`。

dispose：unregister wrap；不要删用户 session 文件。

---

## 5. 设置页

`settingsPages.register` **会替换**宿主自动 configuration 表单，所以必须自己渲染，并 `configuration.set` 同一批 key。

- 即时偏好，无 footer，无提交按钮
- **垂直** `Field`（Label → 全宽 Switch → Description）。金标准 §8 明确要求垂直 Field；不要用设置页水平 `SwitchRow`
- 不要 Card 当表单壳；可用 `FieldSet` + `FieldLegend`
- 控件默认 28px 密度，不要 `size="sm"`
- 总开关关时：T1 不再前插；文案一句话说明「已打开的会话保持当时环境，需要重新启动该智能体」
- i18n 走 plugin locales；失败 `show` 用 `context.dialogs.alert`（有详情）或 toast（短失败）——改开关是即时写，失败必须让用户知道
- 禁止嵌套 `@pier/ui/dialog`

文案方向（§8）：

- enabled：**将智能体打开的分屏接到工作台面板**
- claude / opencode：产品名即可
- 不要写「假 tmux / PATH / 适配器实现」

---

## 6. 测试

放 `tests/unit/plugins/tmux/`（不要往已满的 `tests/unit/main/app-core/` 加文件）。`tests/unit/main/plugins/` 现 33，尽量别再堆。

1. **argv → PierCommand**：`split-window -t %1 -v -d -P -F #{pane_id}` 含 `referencePanelId`（%1 映射的 panel）且 `focus: false`
2. 无 `-d` 的 split **不**带 `focus: false`
3. 未知动词 exit 1；`-V` 不连 socket
4. 无 TMUX 或无 PIER_CONTROL_SOCKET → exit 1
5. `list-panes` 不泄漏未映射 pane
6. wrap：adapter 开 + claude → pathPrepend 含 `bin`；空白 / one-shot `-p` → 空结果；env 无 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
7. decorateSpawn 写 TMUX\*（插件测试允许该字面量）
8. governance：`packages/plugin-tmux` locale 无禁用实现词；源码不 import dockview；不出现 `spawn`/`exec` 指向 `pier.mjs` / `bin/pier`
9. 宿主：agent 终端 `terminal.send` 成功
10. 打包治理：electron-builder 含 plugin-tmux

可用 `node:net` 假 socket 测 control-client，不要起 Electron。

---

## 7. 完成定义

- `pnpm plugin:tmux:build` 产出 `dist/main.js`、`dist/tmux.js`、`dist/renderer.js`
- `pnpm --filter @pier/plugin-tmux build:package` 产出 dist-pkg tgz
- wrap 默认让 claude/opencode 的 PATH 前插假 tmux；预设 env 不出现
- 假 tmux 金路径命令表有单测
- 宿主 TMUX governance 仍绿
- `pnpm check:file-size` / `pnpm check:dir-density` 绿
- `pnpm exec vitest run` 覆盖上述测试 + agent-boundary + packaging-governance + external-main-runtime
- 不改 `plugins/index.v1.json`、不 commit
