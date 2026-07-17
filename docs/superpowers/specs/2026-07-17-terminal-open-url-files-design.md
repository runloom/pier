# 终端本地链接优先用 files 打开设计

- 日期：2026-07-17
- 状态：draft
- 相关前作：
  - `docs/superpowers/specs/2026-07-06-files-temporary-markdown-file-design.md`
  - `docs/superpowers/specs/2026-07-09-files-project-status-item-design.md`
  - `docs/superpowers/specs/2026-07-02-project-file-tree-design.md`
- 触发问题：终端里点击文件路径（例如 agent 输出的 `docs/foo.md`）当前会落到系统默认打开方式；用户希望优先用 Pier 内置 files 插件打开，只有 files 打不开时才回退系统默认应用。

## 1. 目标与完成标准

### 1.1 本期目标

1. 终端网格内用户激活（点击 / Cmd-click）本地路径或 `file://` 链接时，优先在 `pier.files` 中打开。
2. files 无法处理时（类型不支持、读取失败、路径不在当前终端上下文锚点内、插件未激活等）回退系统默认打开方式。
3. 本地目录优先在 files 树中 reveal；失败再交给系统文件夹视图。
4. 相对路径相对**该终端当前 OSC 7 cwd** 解析；没有 cwd 时不猜测。
5. `http(s):` / `mailto:` 等非本地 URL 不进 files，继续走现有外部打开路径。
6. terminal panel-kit **不 import** files 插件；打开策略由事件 + 插件订阅完成。

### 1.2 完成标准

| 场景 | 期望 |
|---|---|
| 点击项目内文本/图片等 files 已支持文件 | 打开 files file-panel |
| 点击二进制 / 过大 / files 读失败 | `shell.openPath` 交给系统默认 App |
| 点击项目内目录 | files 打开对应项目树并 reveal 该目录 |
| 目录 files 失败 | 系统打开该目录 |
| 相对路径且终端有 cwd | 相对 cwd 解析后按上表 |
| 相对路径且无 cwd | 不猜；失败反馈（见 §4） |
| `file://...` | 解码为本地路径后按上表 |
| `https://...` | 外部导航 / 系统浏览器，不进 files |
| 架构 | `src/renderer/panel-kits/terminal/**` 不依赖 `@plugins/builtin/files`；depcruise 保持绿色 |

### 1.3 非目标

- 不改 Ghostty 的路径识别 / OSC 8 探测本身。
- 不做「始终用外部编辑器」用户设置（本轮固定 files 优先）。
- 不开放第三方插件抢注册 open-handler marketplace。
- 不把 files document 模型塞进 terminal kit。
- 不在本轮扩展 files 对更多二进制类型的内置预览能力。

## 2. 现状与缺口

### 2.1 Ghostty 已有 open_url，Pier 未接线

`libghostty` 在用户激活超链接时发出 `GHOSTTY_ACTION_OPEN_URL`，vendor 层已通过 `TerminalSurfaceOpenURLDelegate.terminalDidRequestOpenURL(url, kind:)` 暴露。

Pier 的 `TerminalEventDelegate` 目前只接了 pwd / title / command / close / search / scrollbar 等，**没有** conform `TerminalSurfaceOpenURLDelegate`。因此点击链接要么静默，要么落在底层/系统默认行为，Pier JS 侧无法拦截并改走 files。

### 2.2 files 已有可复用打开入口

- 磁盘文件：`openCreatedDiskFile` / `panels.openInstance` + `FilesDocumentPanelSource`
- 项目树：`openProjectFiles` + `revealFilesTreePath`
- 终端相关先例：右键「Markdown 内容预览」由 files 注册 `surfaces: ["terminal/content"]`，终端不 import files

### 2.3 系统打开能力不完整

- 已有：`reveal` → `shell.showItemInFolder`
- 已有：`externalNavigation` → 仅适合 http(s) 等外部 URL（带 nonce / 焦点等守卫）
- **缺少**：面向本地路径的 `shell.openPath` 封装，供 files / host 做系统回退

### 2.4 路径锚点守卫

`isDiskSourceRootAllowed` 要求 `source.root` 落在 panel context 的 `projectRootPath` / `worktreeRoot` / `gitRoot` / `cwd` / `openedPath` 之一。终端打开若随意 invent root，会打开半残 panel。本设计用「锚点内才进 files」规避改守卫语义。

## 3. 方案选择

对比过三条路径：

| 方案 | 结论 |
|---|---|
| A. 终端 open_url 事件 + files 插件订阅处理 | **采用**。符合 terminal ⟂ files 解耦，复用 pwd 同构转发链 |
| B. 点击仍系统打开，另做「在 Files 中打开」命令 | 不满足默认进 files |
| C. terminal kit 直接 import files API | 破坏插件边界与 depcruise |

## 4. 用户可见行为契约

| 点击目标 | 优先 | 回退 |
|---|---|---|
| 锚点内本地文件（files 可开） | files file-panel | — |
| 锚点内本地文件（binary / too large / 读失败 / open 抛错） | — | `shell.openPath` |
| 锚点内本地目录 | files 开项目树 + reveal | `shell.openPath` |
| 锚点外本地文件/目录 | — | `shell.openPath` |
| 相对路径 + 有 cwd | 解析后按上表 | 同左 |
| 相对路径 + 无 cwd | — | 失败 toast；不调用系统（无绝对路径可交） |
| 缺失路径（stat 失败）但仍是绝对路径 | — | `shell.openPath`（交给 OS） |
| `http(s):` / `mailto:` 等 | 现有 external navigation / 系统 | 不进 files |

成功打开（files 或系统）**不 toast**。仅解析失败 / `openPath` 失败时短错误反馈；有详细 `Error.message` 时可用 alert。

## 5. 架构与数据流

### 5.1 原则

1. **terminal 只生产事件**，不解释「开 files 还是系统」。
2. **files 消费本地路径**；失败再请求 host 做系统回退。
3. 复用 **pwd forward 同构链路**，不新造插件总线。
4. **远程 URL**（`http(s):` / `mailto:` 等）由 host 打开（现有 `externalNavigation` 或等价系统打开）；files 必须忽略并返回未处理。
5. **无 files 订阅者**时，host 对本地绝对路径直接 `shell.openPath`，保证至少系统能开。

### 5.2 数据流

```text
Ghostty click / OSC8
  → GHOSTTY_ACTION_OPEN_URL
  → TerminalEventDelegate.terminalDidRequestOpenURL
  → native addon ThreadSafeFunction (setOpenUrlForwardCallback)
  → main (windowId, panelId, url, kind)
  → webContents.send(pier://terminal:open-url)
  → preload TerminalAPI.onOpenUrl
  → host 分发
       ├─ 粗判非本地 URL → externalNavigation / 系统（files 忽略）
       └─ 本地候选 → files 插件
            ├─ 锚点内文件 → openInstance(file-panel)
            ├─ 锚点内目录 → openProjectFiles + revealFilesTreePath
            └─ 失败 / 锚点外 → files.openPath → shell.openPath
```

### 5.3 分层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| Swift `GhosttyBridge` | conform `TerminalSurfaceOpenURLDelegate`，forward `(windowId, panelId, url, kind)` | 解析 file vs http、开 panel |
| native addon | 与 pwd 同构的 TSF 通道 | 业务策略 |
| main terminal IPC | 校验 panel 归属窗口后广播 | 默认直接 `shell.openPath`（仅无订阅者兜底可走） |
| preload / `TerminalAPI` | `onOpenUrl(cb)` | 打开逻辑 |
| host / plugin runtime | 把事件交给订阅者；无订阅者时本地绝对路径系统兜底 | files document 模型 |
| files 插件 | 解析、stat、锚点判断、开 panel / reveal、失败调 `openPath` | 处理 http(s) |
| file-service | 新增 `openPath(path)` → `shell.openPath` | UI |

## 6. API 契约

### 6.1 终端 open_url 事件

```ts
// shared/contracts/terminal.ts
type TerminalOpenUrlKind = "text" | "html" | "unknown";

interface TerminalOpenUrlEvent {
  panelId: string;
  url: string; // Ghostty 原始字符串
  kind: TerminalOpenUrlKind;
}
```

- IPC 广播：`PIER_BROADCAST.TERMINAL_OPEN_URL = "pier://terminal:open-url"`
- `TerminalAPI.onOpenUrl(cb: (event: TerminalOpenUrlEvent) => void): () => void`
- 订阅模式与 `onCwdChange` 相同：多 listener，各自过滤
- **不把 cwd 塞进事件**；files 用该 `panelId` 对应的 panel context / session cwd 解析相对路径
- main 侧 payload 用 zod 校验后再 `send`

### 6.2 系统打开本地路径

```ts
// file-service + preload files API / plugin context.files
openPath(path: string): Promise<
  | { opened: true }
  | { opened: false; reason: "invalid-path" | "open-failed" }
>
```

- 实现：`shell.openPath(path)`
- 目录回退也走 `openPath`（macOS 通常开 Finder）；本轮不额外 `showItemInFolder`，除非后续产品要求「显示所在位置」

### 6.3 files 插件处理入口

- activate 时订阅 `context.terminal.onOpenUrl`（若 plugin API 尚无该面，则经 host 封装，避免业务代码散落 `window.pier`）
- 纯函数可单测：

```ts
type ResolvedTerminalOpenTarget =
  | { kind: "remote"; url: string }
  | { kind: "local-file"; path: string }
  | { kind: "local-dir"; path: string }
  | { kind: "unresolved"; reason: "relative-without-cwd" | "invalid" };

function resolveTerminalOpenTarget(
  url: string,
  cwd: string | null
): ResolvedTerminalOpenTarget;
```

- 打开文件复用现有 `createFileFilePanelInstanceId` + `panels.openInstance` 路径
- 打开目录复用 `openProjectFiles` + `revealFilesTreePath`

说明：`resolveTerminalOpenTarget` 的 file/dir 区分依赖 `stat`；纯解析阶段可先产出 `local-path`，再由 handler `stat` 成 file/dir。实现计划允许把类型拆成两步，但对外行为不变。

### 6.4 插件上下文：cwd 与锚点

对触发事件的 `panelId`：

1. 读取该终端 panel 的 `PanelContext`（至少含 `cwd` / `projectRootPath` / `gitRoot` / `worktreeRoot` / `openedPath`）
2. 相对路径：`path.resolve(cwd, raw)`；`cwd` 缺失 → `unresolved`
3. `file://`：按平台安全解码为本地绝对路径（处理 host、百分号编码）
4. 锚点集合 = context 中非空的 `projectRootPath` / `worktreeRoot` / `gitRoot` / `cwd` / `openedPath`
5. 本地 path 落在某一锚点之下（`isSamePathOrDescendant`）→ files；否则 → `openPath`
6. files 打开时 `source.root` = **覆盖该 path 的最长锚点**（更贴 worktree）；目录同理用该锚点作 project root

## 7. 处理顺序与并发

files handler（逻辑串行意图）：

1. 解析 URL / 路径
2. `remote` → 返回未处理；**host 负责**走 externalNavigation / 系统打开（接上 delegate 后绝不能出现「谁都不开」）
3. `unresolved` → 错误 toast（i18n）
4. `stat`（或等价探测）
5. 锚点外 → `openPath`
6. 文件 → `openInstance`；binary / too large / 抛错 → `openPath`
7. 目录 → open + reveal；失败 → `openPath`
8. 标记「已处理」，避免 host 再开一次造成双开

并发：

- 同一规范化 path / url 做 inflight 去重（对齐 markdown `externalOpenBusy`）
- 不同目标可并行；panel 打开本身允许微任务串行以免 tab 抖动

## 8. 错误反馈与文案

| 情况 | 反馈 |
|---|---|
| files 成功 | 无 toast |
| 系统回退成功 | 无 toast |
| 相对路径无 cwd | toast：无法解析相对路径（en + zh-CN） |
| `openPath` 失败 | toast 或带 `Error.message` 的 alert |
| 非法 URL | toast 短失败 |

所有用户可见字符串走 files locales（`en.json` / `zh-CN.json`）。

## 9. 实现落点（文件级预期）

### Native

- `native/Sources/GhosttyBridge/GhosttyBridge.swift`
  - `TerminalEventDelegate` conform `TerminalSurfaceOpenURLDelegate`
  - `forwardOpenUrlCallback: ((Int, String, String, String) -> Void)?`  
    参数语义：`(browserWindowId, panelId, url, kindRaw)`
  - `ghostty_bridge_set_open_url_forward_callback`
- `native/src/addon.mm`
  - 与 pwd 同构的 `OpenUrlForwardPayload` + `JsSetOpenUrlForwardCallback`
  - export `setOpenUrlForwardCallback`

### Main / shared / preload

- `src/shared/ipc-channels.ts`：`TERMINAL_OPEN_URL`
- `src/shared/contracts/terminal.ts`：`TerminalOpenUrlEvent` + `TerminalAPI.onOpenUrl`
- `src/shared/contracts/file.ts`（或并列契约）：`openPath` 请求/结果 schema
- `src/main/ipc/terminal*.ts` / `terminal-native-addon.ts`：注册 forward，按 window 广播
- `src/main/services/file-service.ts`：`openPath`
- `src/preload/terminal-api.ts` / files preload：订阅与 invoke

### Renderer / files

- plugin host：向 files 暴露 `terminal.onOpenUrl` 与 `files.openPath`
- `src/plugins/builtin/files/renderer/`：新增 resolve + handler 模块；`index.tsx` activate 订阅
- locales：新增通知文案 key
- **不修改** `panel-kits/terminal` 去 import files

## 10. 测试计划

| 层 | 覆盖 |
|---|---|
| unit: resolve | `file://`、绝对、相对+cwd、相对无 cwd、http、空格编码、`./` / `../` |
| unit: classify / 锚点 | 锚点内文件/目录 → files；锚点外 → system；missing 绝对路径 → system |
| unit: main forward | addon callback → 正确 BrowserWindow 的 broadcast payload |
| unit: file-service `openPath` | success / open-failed / invalid-path |
| unit/component: files handler | `openInstance` 参数、reveal 调用、fallback、inflight 去重、remote 忽略 |
| governance | depcruise：terminal kit 不依赖 files |
| native（若有同类测试基建） | delegate openURL forward；否则 main mock addon 即可（与 pwd 同级） |

## 11. 风险与裁定

1. **接上 delegate 后必须替换而非叠加系统打开**  
   若无 delegate 时底层已 `NSWorkspace.open`，conform 后只走 Pier 链，避免双开。实现时用手动点击验证一次。

2. **锚点外不进 files**  
   刻意不放宽 `isDiskSourceRootAllowed`，避免半开 panel；锚点外统一系统打开。

3. **无 cwd 的相对路径**  
   不猜测成 app cwd 或任意 project root；只 toast 失败。

4. **files 未激活**  
   host 对本地绝对路径兜底 `openPath`，行为退化为「与现在类似的系统打开」。

5. **html kind**  
   事件携带 `kind`，v1 files 对本地路径不区分 text/html；远程仍不进 files。预留字段避免二次改 IPC。

6. **远程链接回归**  
   接线前若靠底层默认打开浏览器，接线后必须由 host 承接 remote；验收清单已覆盖 `https://` 场景。

## 12. 验收清单

- [ ] 终端点击项目内 `README.md` → files panel 打开该文件
- [ ] 点击项目内目录 → files 树 reveal
- [ ] 点击 `.zip`（或 files 明确拒绝的类型）→ 系统默认 App
- [ ] 点击项目外绝对路径 → 系统打开，不报 files 锚点错误面板
- [ ] 点击 `https://example.com` → 浏览器，不进 files
- [ ] 相对路径在无 OSC 7 cwd 时不误开错误文件
- [ ] 卸载/禁用 files 后，本地绝对路径仍能系统打开
- [ ] depcruise / 既有 terminal-files 边界测试通过
