# 窗口系统标题与多窗显示名金标准

日期：2026-09-04  
状态：现行权威  
范围：所有给人看的**窗口名字**——macOS Mission Control / App Exposé / 程序坞「显示全部窗口」/ `⌘\`` / 菜单栏「窗口」、右键「移动到其他窗口」子菜单、智能体 Index Quick Pick 的跨窗限定、`window.list` / `pier windows list` 的 `title`。  
不包含：窗内标题栏的当前面板长路径、tab 短标题（OSC / cwd / 用户钉名）、只有一个其他窗时的动作句「移动到另一窗口」、终端调试窗、窗口染色、Dock 应用图标、用户可配 `window.title` 模板、`representedFilename`。

相关：窗口仍是多路径锚点工作台，不以「一文件夹一窗口」为前提（[`2026-09-03-workbench-ux-and-ergonomics-design.md`](./2026-09-03-workbench-ux-and-ergonomics-design.md) K1）。tab 标题与身份无关（[`2026-08-29-panel-tab-chrome-gold-standard.md`](./2026-08-29-panel-tab-chrome-gold-standard.md)）。右键组序仍以 [`2026-08-31-context-menu-order-gold-standard.md`](./2026-08-31-context-menu-order-gold-standard.md) 为准；本文只改子菜单里窗口怎么叫。

权威实现：[`src/shared/window-display/`](../../../src/shared/window-display/)（算法单源，由今日 `src/renderer/components/workspace/transfer/window-display.ts` 迁入）。  
最终字符串只允许 main 写入：`WindowInfo.title` + `AppWindow`/`BaseWindow.setTitle`。  
检查点：`tests/unit/shared/window-display.test.ts`、`tests/unit/main/windows/os-title.test.ts`、`tests/unit/renderer/window-display-governance.test.ts`。

---

## 一句话终态

扫窗口时看到的名字，和右键「移动到其他窗口」、Index 跨窗行、`window.list` 是**同一串**。那一串是工作区叶子名，撞名才加稳定限定（分支 / 父目录 / 文件名或用户钉名 / ` · N`），不含 OSC。macOS 不再因为 `BaseWindow` 没接通标题而全部叫 Pier。

---

## 问题

macOS 工作台窗是 `BaseWindow` + `WebContentsView`，**不会**像 `BrowserWindow` 那样把 `document.title` 同步成 `NSWindow.title`。renderer 已经在写长标题，系统侧读不到，Mission Control / 程序坞窗口列表 / 菜单栏「窗口」一律回落应用名 Pier。

同时产品里还有第二、第三套窗口叫法：右键子菜单在「其他窗」子集上消歧；Index 用 Electron 窗口号拼「窗口 {{id}}」。同一扇窗在不同入口名字不同。

---

## 原则

1. **一个函数，一个字符串。** 对外单行名只来自 `buildWindowDisplays(全部活窗口).menuLabel`。禁止业务再拼 `recordId`、Electron id、`窗口 {{id}}`、或对子集再跑一遍消歧。
2. **消歧集合 = 全部活窗口。** 从 A 看 B 的名字，必须等于 B 在 Mission Control 下的名字。禁止「右键只看其他窗」得到更短或不同的限定。
3. **系统标题是窗口身份，不是当前文件，也不是活 tab。** 窗内标题栏继续显示活动面板长路径；tab 继续吃 OSC。`NSWindow.title` / `menuLabel` **任何一段**都不得出现 OSC、cwd 派生 tab 名、任务 chrome、provider 名。
4. **macOS 不复读应用名。** Dock 已经标明 Pier。`menuLabel` 后禁止再拼 ` — Pier`。其他平台同样只写 `menuLabel`（任务栏图标已标明应用）。
5. **最终字符串只允许 main 写。** renderer 上报身份草稿；main 消歧、`setTitle`、写入 `WindowInfo.title`。各 UI 只读。

---

## 表面清单（必须同名）

| 表面 | 读什么 | 今天 | 终态 |
|---|---|---|---|
| Mission Control / App Exposé / 程序坞「显示全部窗口」/ `⌘\`` | `NSWindow.title` | `Pier` | `menuLabel` |
| 菜单栏「窗口」（`role: "window"`） | 同上 | `Pier` | 同上（系统菜单跟 `setTitle`，不必手写一份） |
| 右键 / 标签菜单「移动到其他窗口」「复制到其他窗口」子菜单（其他窗 ≥ 2） | 子项 `label` | 子集 `menuLabel`（集合不对） | `WindowInfo.title` |
| 智能体 Index Quick Pick 跨窗限定 | `detail` 窗口段 | `窗口 {{id}}` | 本窗「本窗口」；其他窗 `WindowInfo.title` |
| 智能体协作会话跨窗定位 | 会话行地点 | `窗口 {{id}}` | 本窗「本窗口」；其他窗 `WindowInfo.title`；缺 title 则省略，不得回退窗口号 |
| `window.list` / `pier windows list` | `WindowInfo.title` | 无 | 与系统标题相同 |

### 不是窗口名（保持原语义）

| 表面 | 规则 |
|---|---|
| 窗内标题栏 | 活动面板 `resolveLong`（绝对路径 / 全文）。不是窗口身份 |
| tab 短标题 | OSC / cwd 叶子 / 用户钉名。不顶替窗口主名；用户钉名与文件名只在撞名时当限定 |
| 其他窗恰好 1 个时的右键 | 动作句「移动到另一窗口」/ 「复制到另一窗口」，不把窗口名塞进这句 |
| `document.title` | 不再作为 OS 标题来源。可继续写，但 `page-title-updated` 必须 `preventDefault`，不得盖掉 `setTitle` |

---

## 公式

对**全部活窗口**的身份草稿跑唯一的 `buildWindowDisplays`（或等价的「草稿 → 消歧」导出）。测试可以用 `WindowInfo[]` + `PanelSnapshot[]` 喂同一函数。对外单行名 = `menuLabel`。产品表面禁止自己再喂一个窗口子集。

身份路径（活动面板，否则该窗第一块有路径的面板）：

```
worktreeRoot ?? projectRootPath ?? cwd
```

`gitRoot` 只用于图标是不是 git，不参与叶子名。

然后：

1. 有身份路径 → 叶子名（`pathBasename`）
2. 否则**稳定 tab 名**（定义见下）
3. 否则空窗文案 `workspace.panelTransfer.windowLabel`（「窗口 {{n}}」）。`n` 是该窗在 `window.list()` 数组里的 1 基下标（创建序，与 `WindowManager.list` 的 Map 插入序一致）

禁止用 `display.terminalTitle`、终端 OSC 派生的 `display.short`、cwd 叶子、任务 label、end-state chrome 当第 2 步。cwd 还没写上、只有一条活终端时，先走空窗名，等身份路径到达再换成叶子。

`menuLabel` 默认等于叶子名。仅当**全部活窗口**里有至少一扇窗共享同一叶子时，才加限定，便宜且必须能把该组拆开：

1. 互异的分支
2. 互异的父目录叶子
3. 互异的**稳定 tab 名**
4. 仍撞 → `workspace.panelTransfer.sameNameIndex`（` · {{n}}`，组内 2 起）

### 稳定 tab 名（白名单）

只允许这两种，且必须与叶子视觉不同：

| 允许 | 取值 |
|---|---|
| 文件 / diff 面板 | 文件名：`display.short` 的 basename。`kind` 为 `file` / `diff`；或 tab 图标 id 以 `pier.file:` 开头（files 插件磁盘文件与未命名文档）；或生产 files 插件 `kind: "web"` 且 `display.long` 是文件系统路径、其 basename 与 `display.short` 一致 |
| 任意面板的用户钉名 | tab 标题且 `source=user`（用户改过名） |

路径型文件名先收成 basename。与叶子相同则丢掉。Welcome、全文搜索、审查 chrome 等产品标题不是文件名，不得当稳定 tab 名，也不得当空窗的 `baseLabel`。

**禁止**当稳定名（因而也禁止进 `menuLabel`）：

- `display.terminalTitle` 与任何 OSC 0/2
- 终端 / 智能体面板里由 OSC 或 cwd 派生的 `display.short`（包括默认 `"Terminal"`、目录叶子）
- 任务 label、end-state chrome、provider 名、catalog 标签

同仓两个未钉名的终端：`pier` 与 `pier · 2`，不写成 `pier · Claude Code`。

限定与叶子之间用 ` · `（中间点 + 两边空格）。与叶子视觉相同的候选丢掉（`feat/foo` 与 `feat-foo` 视为同一；分支 `feat/foo` 对叶子 `foo` 仍算不同）。

两列选择器若出现：左列 `label`、右列 `description`（分支或稳定 tab 名，且不得回声叶子、不得写路径、不得写 OSC）。右键子菜单只走单行 `menuLabel`。禁止第三套。

### 例子

| 场景 | `title` / `setTitle` / 右键子项 |
|---|---|
| 两窗不同仓库 | `pier` · `codex` |
| 同仓不同工作树叶子 | `feat-bug-fix-0704` · `feat-other` |
| 同叶子、不同分支 | `pier · main` · `pier · feat-a` |
| 同路径两窗、前台是不同文件 | `pier · relocate.ts` · `pier · panel.tsx` |
| 同路径两窗、前台是未钉名终端 | `pier` · `pier · 2`（禁止 OSC） |
| 同路径两窗、用户钉了 tab | `pier · 审查` · `pier · 日志` |
| 同叶子、不同父目录 | `pier · Xyz` · `pier · worktrees` |
| 空窗 | `窗口 1` |
| 单窗有分支 | `pier`（不写分支；无碰撞不加限定） |

---

## 架构

```
各窗 renderer                    shared                         main
───────────────                  ──────                         ────
面板 descriptor / cwd / 分支  →  本窗草稿                       草稿表 keyed by windowId
                                 buildWindowDisplays(全部活窗)
                                                                WindowInfo.title
                                                                host.setTitle(title)
                                                                window.changed 带 title
UI / CLI / 右键 / Index  ←────── 只读 title
```

### 草稿

renderer 在本窗活动面板或身份字段变化时上报草稿（叶子、分支、**稳定 tab 名**、身份路径）。可复用 shared 的草稿构建辅助。草稿里不得带 OSC / `terminalTitle`。不上报最终 `menuLabel`，不为取名去 `panels.list` 打全集，也不得对子集调用 `buildWindowDisplays` 给产品表面取名。关窗丢草稿。未上报前，main 按空窗规则占位，**禁止**闪应用名 Pier。

`title` 变化走已有 `window.changed`（`WindowInfo` 带 `title`）。Index 若已打开，跟这次广播更新窗口段；右键在打开时读 `window.list()`。

允许短 debounce（≤ 50ms），避免 cwd / 分支 / 文件切换连发把 Mission Control 打满。不得用 debounce 当第二套身份。OSC 不进草稿，因此也不该仅因 OSC 上报。

### main 写入

- `AppWindow` 暴露 `setTitle` → `host.setTitle`（macOS `BaseWindow` 与非 mac `BrowserWindow` 同一条）。
- 每次活窗集合或任一份草稿变化：用全部草稿跑 `buildWindowDisplays`，逐窗 `setTitle(menuLabel)`，写进 `WindowInfo.title`。
- `webContents` 的 `page-title-updated` 一律 `preventDefault`。OS 标题不跟 `document.title`。
- 只处理 `WindowManager` 的工作台窗。终端调试窗等独立 `BrowserWindow` 不走本标准。

### 读侧

| 调用方 | 规则 |
|---|---|
| 右键 expand（≥ 2 其他窗） | `listWindows()` 的 `title` 做子项；不再对其他窗子集调用 `buildWindowDisplays` |
| Index Quick Pick | 多窗时：本窗 `agents.quickPick.thisWindow`；其他窗 `title`。禁止 `agents.quickPick.windowLabel` 填 Electron id。`title` 尚未到达则省略窗口段，不得回退窗口号 |
| 协作会话 | 本窗 `agents.collab.locationThisWindow`；其他窗 `title`（`agents.collab.locationWindow` = `{{title}}`）。禁止 `窗口 {{id}}` |
| `window.list` / CLI | 带 `title`；未计算完可省略该字段，消费者按上条处理 |
| 菜单栏「窗口」 | 无产品代码；跟 `setTitle` |

`listOtherWindows` 在其他窗 ≤ 1 时仍可跳过取名（expand 会改写成动作句）。≥ 2 时必须用全局已消歧的 `title`，禁止再 `panels.list` 本地算一遍。

---

## 文案

| 用途 | key | zh-CN | en |
|---|---|---|---|
| 空窗单行名 | `workspace.panelTransfer.windowLabel` | 窗口 {{n}} | Window {{n}} |
| 空窗两列右栏 | `workspace.panelTransfer.emptyWindowDescription` | 空窗口 | Empty window |
| 仍撞名的序号 | `workspace.panelTransfer.sameNameIndex` | ` · {{n}}` | ` · {{n}}` |
| Index 本窗 | `agents.quickPick.thisWindow` | 本窗口 | This window |

四语都要有。空窗 / 序号与 shared 算法输入必须同值；治理测试锁 locale 与 copy 函数。删除 Index 用 Electron id 的 `agents.quickPick.windowLabel`（或不再被任何产品路径引用）。

实现词不得进这些名字：窗口号、recordId、panelId、renderer。

---

## AGENTS.md 摘要

实现时在 AGENTS.md 增加「窗口系统标题与多窗显示名」节，与本文标题绑定。摘要必须包含：

- 对外单行名 = `src/shared/window-display` 的 `menuLabel`，main 写入 `WindowInfo.title` 与 `setTitle`
- 消歧集合是全部活窗口
- macOS `BaseWindow` 必须显式 `setTitle`，禁止依赖 `document.title`
- 右键子菜单 / Index 跨窗 / `window.list` 只读 `title`
- 窗内标题栏长路径与 tab OSC 不是窗口名；撞名限定只用分支 / 父目录 / 稳定 tab 名（文件名或用户钉名）/ ` · N`
- 检查点路径

---

## 明确不做

- 把活动文件长路径、OSC、cwd 派生 tab 名、任务 chrome 写进 `NSWindow.title` 或 `menuLabel` 的任何一段
- 标题末尾加 ` — Pier` / 应用名
- 窗口染色、换 Dock 图标、用户可配标题模板
- `setRepresentedFilename`（本轮不做；代理图标在 `hiddenInset` 下不可见）
- 右键「只有一个其他窗」时把窗口名塞进动作句
- 改窗内标题栏长路径规则
- 改 tab OSC / cwd / 用户钉名规则
- 给调试窗、恢复页套本标准
- renderer 各自 `setTitle`、或 main 每窗 `listPanels` 打全集来取名

---

## 落地顺序

1. 算法原文件迁到 `src/shared/window-display/`。renderer 旧路径只准再导出或改 import，禁止复制。
2. `WindowInfo.title`；`AppWindow.setTitle`；main 消歧 + `setTitle` + `page-title-updated` preventDefault。
3. renderer 上报草稿；创建窗先占位空窗名。
4. 右键 / `listOtherWindows` 改读 `title`。
5. Index 跨窗段改读 `title` / 「本窗口」；删窗口号文案路径。
6. 治理测试锁定本节、单源路径、禁止子集消歧、禁止 `windowLabel` + id。

---

## 检查点

| 项 | 锁什么 |
|---|---|
| `tests/unit/shared/window-display.test.ts` | 迁入现有用例（文件 tab 限定仍然有效）；**新增**：两窗同叶时两条 `menuLabel` 互异且都带限定（消歧含本窗）；同路径两终端仅 OSC 不同 → `pier` 与 `pier · 2`，字符串不含 OSC |
| `tests/unit/main/windows/os-title.test.ts` | `setTitle` 等于 `WindowInfo.title`；`page-title-updated` 被 preventDefault；创建窗先占位空窗名而不是 `Pier` |
| `tests/unit/renderer/window-display-governance.test.ts` | 锁定本文标题与 AGENTS.md 对应节；算法只在 `src/shared/window-display/`；右键 / Index / `pick-window.ts` 不调用 `buildWindowDisplays`；产品路径不引用 `agents.quickPick.windowLabel`；稳定 tab 名白名单与 OSC 禁令写在规格里 |
| `tests/unit/renderer/workspace/pick-window.test.ts` | ≥ 2 其他窗时子项等于 `WindowInfo.title` |
| `tests/unit/renderer/actions/agent-runtime-actions.test.ts` | Index 跨窗 detail 用 `title`，本窗用「本窗口」，不用 Electron id |
| `tests/unit/renderer/agent-runtime/collab-view-model.test.ts` | 协作跨窗地点用 `title`，缺 title 省略，不用 Electron id |
