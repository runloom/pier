# 工作台骨架实施方案

规格：[工作树 tile 与主 / 子窗口](../specs/2026-09-07-workbench-worktree-tiles-design.md)（已确认）。  
设计稿：`.pier/canvases/workbench-shell/`（视觉金，不是 IA 真源）。  
三次任务，每次合并后产品可日常使用；禁止半套 chrome（例如侧栏已切工作树、主区仍混放）。

## 闭环原则

| 任务 | 合并后用户能做什么 | 还不能做什么（留给后面） |
|---|---|---|
| **1 主窗口成型** | 只开主窗：打开项目、侧栏切工作树并恢复布局、看区域状态栏 git 事实、点会话定位、点「任务」打开已有面板、折叠侧栏 | 子窗 tile 墙、跨窗弹簧拖拽、`cd` 重绑、待建行 |
| **2 子窗口与拖拽** | 子窗也是区域墙；§9.2 表逐行可复现；主 / 子除侧栏外同一套规则 | 加载滑块、身份改色、完整动词表、`⌘[` / `⌘⌥1…9` |
| **3 边角收口** | 规格 §7.3 / R6 / §10 / §12 剩余机制全部可点 | 09-03 正确性修复（见文末）；不在这三次里 |

依赖：2 必须在 1 之后（子窗改 tile 要复用 1 的 tile 宿主）。3 必须在 2 之后（隐藏集、弹簧替换与 `cd` / 空区域共用同一套区域生命周期）。

## 三次都遵守

- **不新增** main 服务、IPC 通道、持久化文件（规格 §16）。tile 布局写进现有 `{userData}/window-record-state.json` 的 `layout`；**哪一扇是主窗**写进同一文件的 `mainWindowRecordId`（今天窗口记录同构、没有 kind）；身份色 / 钉名 / 置顶写进现有 `preferences.json`。侧栏空态「最近」读现有 `{userData}/panel-context-state.json`，不要第三份 recents。区域栏隐藏/顺序复用 `{userData}/terminal-status-bar-prefs.json`。
- **不改** Ghostty 进程模型。隐藏区域必须保持已挂载的 dockview（`hidden` / `inert`），走现有终端可见性，禁止卸掉再从 JSON 重建（会丢 native surface）。
- 新文件放子目录，勿再堆 `src/renderer/components/workspace/` 根上：`workspace/tiles/`、`workspace/rail/`。`WorkspaceHost` 仍是 dockview 唯一业务边界，改成「一个 tile 一棵 dockview」。
- 用户文案走 locale（智能体 / 工作树 / 区域 / 需要你处理）；`tile` 只出现在规格与代码。
- 每任务结束跑文内验证命令；失败只修本任务引入的问题。
- 画板已锁视觉与 IA，实现时对齐 B1–B5，不要另发明入口。

---

## 任务 1 · 主窗口成型

### 用户可见闭环

启动 → 欢迎态是 `~` 区域里一个普通终端（侧栏空态 + 最近 + 打开项目）→ 打开 git 项目后侧栏出现该仓库的工作树 → 点工作树只切主窗、恢复该工作树自己的 pane 树 → 底部一条区域状态栏（`■ 名字 · 状态 · 分支 · ±N · ↑↓ · ⋯`）→ 点会话行定位到该终端（本窗切换或跳到已有子窗）→ 点「任务」在**当前区域**打开 `pier.tasks.board`。

子窗口这一任务**保持今天**：一棵自由 dockview + 每终端状态栏。规格 §13 允许的过渡。

### 做

1. **窗口布局 v2（同一 `layout` 字段）**  
   形状（单源建议 `src/shared/workspace-tiles/layout.ts`）：

   ```ts
   {
     version: 2,
     tiles: [{ worktreeKey, dockview, createdAt }],
     visibleWorktreeKey,          // 主窗当前显示
     hiddenWorktreeKeys,          // 已有布局但不显示
     anchorWorktreeKey,           // 窗口名输入；切换可见区域不改
     sidebar: { collapsed, widthPx }
   }
   ```

   读取时若不是 `version: 2`，当作今天的 dockview JSON：按每块面板的 `PanelContext.worktreeKey`（缺则 `gitRoot` / `cwd` / `~`）拆成多个 tile；`visible` = 当时活动面板所属；其余进 `hidden`；`anchor` = 第一个 tile。写确定性迁移函数，禁止「猜当前文件夹」。

2. **主窗身份 + 壳**  
   今天 `AppShell` = 标题栏 + 铺满的一棵 `WorkspaceHost`，窗口记录没有 main/sub。任务 1 在 `window-record-state.json` 增加 `mainWindowRecordId`（仍 version 1 文件）：进程里第一扇打开/恢复的窗是主窗；关主窗 = 关全部子窗（现有语义）；其余窗无侧栏。Renderer 用 `WindowContext.recordId === mainWindowRecordId` 决定是否挂侧栏，不要另做 window kind IPC。  
   `TitleBar`（`src/renderer/components/common/title-bar.tsx`）中央改为窗口 `menuLabel`（锚叶子；主窗 `+N` 为 0 不显示），不再用活动面板长路径。仅主窗左侧侧栏开关。右侧 `AgentIndexCountsControl` / 铃铛 / 更新位置不变；`pier.agents.list` Quick Pick 仍给折叠侧栏与子窗当发现入口。  
   `src/shared/window-display`：`identityPathOf` 的输入改为锚 tile 的工作树路径，不是活动面板。main `os-title.ts` `setTitle` 继续只写 `menuLabel`。

3. **一个 tile 一棵 dockview**  
   参数化 `WorkspaceHost`：`tileId` + `worktreeKey` + 自己的 dockview api。  
   `useWorkspaceStore` 升为窗口级协调器：`api` 指向**当前可见** tile；`apis: Map<tileId, DockviewApi>` 持有隐藏区域。面板命令、新建终端、`openInEditor` 一律带工作树宾语，写进对应 tile，禁止写进「当前 dockview 碰巧是谁」。  
   主窗同时只显示一个 tile；隐藏的保持挂载。

4. **归属（R1）在主窗生效**  
   Files `openInEditor`、GIT 打开审查、终端文件链接：目标 `worktreeKey` ≠ 当前可见区域 → 先切到该区域（有隐藏则恢复）再打开。同类可重定向视图（审查、目录树、任务跟踪）不叠 tab。会话视图永不重定向。  
   子窗这一任务仍可混放（过渡）。

5. **区域状态栏（主窗）**  
   主窗终端**不再挂** `TerminalStatusBar`（`shouldMountTerminalStatusBar` 在主窗恒 false）。  
   新组件消费同一批 git / files 贡献，输入改为 tile 的 `PanelContext`：`■ 名字`（身份色 `--identity-1…6`，首个空闲槽位写入 `preferences.json`）· 聚合点（读 Index，三值 max）· 分支 · `±N`（现有查看更改）· `↑↓`（现有同步）· `⋯`（本任务最小动词：新建终端、启动智能体、查看更改、在新窗口打开）。  
   智能体状态只留 tab；评论不进区域栏。插件贡献点本任务增加 `tileStatusItems`（纪律链与 `panels` 同款）；git / files 的 `terminalStatusItems` **继续声明**，宿主在主窗把它们接到区域栏，子窗仍接到每终端底栏，避免这一任务改完插件就不能用。

6. **侧栏（仅主窗）**  
   数据：`worktree.list` 按仓库分组 + Index `entries` 按 `worktreeKey` 挂会话 + 空态最近（`panel-context-state` 的 `recent`，不是新列表）。  
   IA 对齐画板：上半「项目」树（项目行 `[+]` = 现有新建工作树对话框；工作树行只切主窗；会话行品牌图标 + 定位）；发丝线下一条「任务」（`sidebarEntries`，`pier.tasks` 声明打开 `pier.tasks.board`，上下文 = 当前可见工作树）。不列议题。  
   `⌘B`：`pier.view.toggleSideTree` 改为折叠这条侧栏；面板内文件树 / 审查树改 `⌘⇧B`（四语文案一起改）。

7. **欢迎态**  
   去掉「开始」空页。主窗恒有一个 `~` 退化 tile（一个终端）。打开项目后，若 `~` 里只有初始空闲终端则关掉它、不进隐藏集。

8. **空区域**  
   侧栏点到「本窗没有视图」的工作树：显示该工作树的空区域（状态栏 + 新建终端 / 启动智能体），**不**自动 spawn，**不**跳到别的窗口。

### 不做（本任务）

子窗 tile 墙、§9.2 弹簧 / 边缘新建、tile 级 transfer、悬停预告条、`cd` 重绑、待建行、加载滑块、身份右键改色、完整 §10 动词表、`⌘[` `⌘⌥1…9`。

### 建议改动位置

| 区域 | 路径 |
|---|---|
| 布局契约 + 迁移 | `src/shared/workspace-tiles/`（新目录；勿再堆 `src/shared/` 根） |
| 窗口记录 | `src/main/state/window-record-state.ts`（`layout` 仍 `unknown`，解析在 shared） |
| dockview 宿主 | `src/renderer/components/workspace/host.tsx`、`stores/workspace.store.ts` |
| 区域壳 / 状态栏 | `src/renderer/components/workspace/tiles/` |
| 侧栏 | `src/renderer/components/workspace/rail/` |
| 标题栏 / 窗口名 | `title-bar.tsx`、`src/shared/window-display/`、main `setTitle` |
| 打开落点 | `src/renderer/lib/files/open-project-directory.ts`、git `review/open.ts`、终端文件打开链 |
| 状态栏挂载 | `panel-kits/terminal/status-bar.tsx`、`status-bar-merge.ts` |
| 贡献点 | `src/shared/contracts/plugin.ts`、`packages/plugin-tasks/plugin.json`（`sidebarEntries`） |
| 身份色 | `globals.css`（已有 token）、`preferences.json` 新字段 |
| 快捷键 | `src/shared/keybindings.ts`、`view-actions.ts`、四语 locale |
| 治理 | 扩 `tests/unit/renderer/workbench/tile-governance.test.ts`；新 `layout-migration.test.ts` |

### 验证（本任务通过才算闭环）

自动化：

```sh
pnpm exec vitest run \
  tests/unit/renderer/workbench \
  tests/unit/shared/window-display.test.ts \
  tests/unit/main/windows/os-title.test.ts \
  tests/unit/renderer/window-display-governance.test.ts \
  tests/unit/renderer/plugins/plugin-host-context.test.tsx \
  tests/component/app/project-canvas-scenarios.test.tsx \
  tests/component/app/worktree-create-overlay.test.tsx

pnpm exec tsc --noEmit
pnpm exec ultracite check <本任务改动的 ts/tsx>
pnpm check:file-size && pnpm check:dir-density
pnpm depcruise
```

补：`layout-migration` 用夹具覆盖「一窗混了两个 worktreeKey 的面板 → 两 tile、可见 = 活动面板那个」。  
补：主窗 `shouldMountTerminalStatusBar === false`、子窗仍 true 的单测。  
补：侧栏「打开 任务」后当前 tile 出现 `pier.tasks.board`、侧栏没有 `#412` 这种议题行。  
E2E（闲置机）：`tests/e2e/workbench/main-window-tiles.spec.ts` — 打开带两个工作树的仓库，侧栏切换，断言同一时刻主窗只有一个区域状态栏且分支跟着变；重启后布局还在。`pnpm test:e2e:auto`。

手测（对照规格 §12，不讲解）：

1. 冷启动：侧栏是空态 + 最近，窗里是能敲的终端，窗口名是 `~`。
2. 打开项目：侧栏出现工作树；`~` 空闲终端消失。
3. 两个工作树各开终端，来回点侧栏：布局各自恢复；标题栏窗口名不变；区域栏最左是名字。
4. 点另一个窗口里的会话行：跳到那一窗，不把主窗切成「空」。
5. 点「任务」：当前区域打开任务跟踪，侧栏仍只有一行「任务」。
6. `⌘B` 折叠侧栏；文件树用 `⌘⇧B`。

### 完成定义

主窗任意时刻只显示一个工作树；切换恢复布局；主窗没有每终端状态栏；老窗口打开不丢面板；`pnpm check` 中与本任务相关的静态 + 单测 + 组件测通过；上述 E2E 在闲置机绿。子窗看起来仍像今天，这是成功而不是漏做。

---

## 任务 2 · 子窗口 tile 化与拖拽矩阵

### 用户可见闭环

子窗不再混放。每个区域是完整工作树（pane 树 + 底部状态栏）。标题栏「+ 工作树」追加 / 恢复隐藏区域。把 tab 拖到另一窗：已有（含隐藏）则恢复并只能落进去；没有则停住弹簧替换或落边缘新建。同窗不能把 tab 拖进别人的区域。

任务 1 的主窗行为不变；子窗每终端状态栏下线，改用与主窗同一套区域栏。

### 做

1. **子窗默认 tile 墙**  
   外层 grid / split 排可见 tile（规格允许首版简单 grid）。「+ 工作树」= 现有工作树 Quick Pick，选中后：已有可见 → 聚焦；在隐藏集 → 拿出；没有 → 新建空区域。有隐藏时按钮带「N 已隐藏」。没有 tile 即关窗。

2. **§9.2 落点（与区域数量无关，主 / 子同一实现）**  
   单一模块（建议 `workspace/tiles/drop-policy.ts`），dockview 预览层只消费结果，不各自实现。含隐藏集 = 已有。拒绝文案：「pier-login 在本窗口已有区域」。弹簧 ~0.5s，拖出未落则换回。tile 拖状态栏 = 换位 / 分屏 / 移窗 / 新窗。侧栏行可拖到任何窗口内容区。tab 拖到侧栏拒绝。沿用面板落点浮层金标准（寿命仍是 `transferId` + main `seal`）。

3. **tile 级 transfer**  
   现有 tab transfer 保留，增加「整块区域」搬家；目标窗已有同 `worktreeKey` → 按落点合并两棵 pane 树（R12）。

4. **关窗**  
   可见 + 隐藏区域的全部视图计入现有关窗保护；文案写明「含 N 个已隐藏区域」。关主窗仍关全部子窗。

5. **R1 在子窗生效**  
   跨工作树打开文件 / 审查：去该工作树在**该窗**的区域（没有则按 §9.2 新建或切过去），不再塞进当前混放 dockview。

### 不做（本任务）

`cd` 重绑、待建行、加载滑块、悬停预告、完整动词表、区域切换快捷键。不要在这一任务顺手改审查工具栏。

### 建议改动位置

| 区域 | 路径 |
|---|---|
| 落点策略 | `workspace/tiles/drop-policy.ts` + 单测（§9.2 每行一条） |
| 预览 | `workspace/transfer/overlay-preview.ts`、`attach.ts`（只接线，不拥有寿命） |
| 子窗壳 | `workspace/tiles/` grid、「+ 工作树」 |
| 关窗计数 | `workspace-close.ts`、`quit-destroy.ts` |
| 状态栏 | 子窗也走 `shouldMountTerminalStatusBar === false` |
| 治理 | `tile-governance.test.ts` 补：主 / 子创建与拖拽同源、tile 键唯一、tab 跨工作树被拒 |

### 验证

```sh
pnpm exec vitest run \
  tests/unit/renderer/workbench \
  tests/unit/renderer/workspace/panel-drop-overlay-lifecycle-governance.test.ts \
  tests/unit/renderer/workspace/panel-transfer-overlay-preview.test.ts \
  tests/unit/main/panel/transfer-overlay-preview.test.ts \
  tests/unit/renderer/workspace/panel-transfer.test.ts

pnpm exec tsc --noEmit
pnpm exec ultracite check <本任务改动>
pnpm check:file-size && pnpm check:dir-density && pnpm depcruise
```

E2E（闲置机）：`tests/e2e/workbench/drop-matrix.spec.ts` — 至少覆盖：同窗拒绝、跨窗已有则恢复、无则弹簧替换、边缘新建。`pnpm test:e2e:auto`。

手测：规格 §12「拖 tab 会落到哪 / 为什么拖不进去 / 四区域说出每块属于谁 / 子窗怎么加东西」。

### 完成定义

§9.2 表在单测里逐行锁死；手测三种落点可预测；子窗没有每终端状态栏；同工作树两窗各自布局；主窗任务 1 回归仍绿。此后代码里不应再出现「子窗自由 dockview」分支。

---

## 任务 3 · 边角收口

### 用户可见闭环

任务 1–2 能用但不「可推断」的缺口补齐：第一次用的人能靠预告 / 一次反馈 / 回退猜对规则（规格 R11 / §12）。做完后规格 §11 场景表除「移动端」外都应能在桌面点出来。

### 做

1. **§7.3 `cd` 重绑**  
   仅 `~` / 非 git 退化区域：`cd` 进工作区已有工作树 → tile 原地重绑（或切到本窗已有该区域并 300ms 高亮）。普通工作树里 `cd` 到别处：**不**迁移视图；tab 走 OSC 7，区域栏仍是该区域的工作树。`cd` 到工作区没有的仓库：保持退化，`⋯` 提供「作为项目打开」。

2. **R6 加载**  
   侧栏页头底缘滑块（异步源未齐）；待建工作树行（身份即刻、行底滑块 + 阶段文字；失败原位「失败 · 点击重试」）；区域栏顶缘滑块（git 事实读取时分支 / ±N 留空）。同一条不定长滑块，无 Spinner。

3. **§12 预告**  
   工作树行悬停：本窗可见则状态栏名字槽洗底，否则「点击切换到 ■ …」。会话行无切换预告。落下后状态栏一次 300ms 高亮。`prefers-reduced-motion` 立即到位。

4. **§10 动词表收齐**  
   区域栏 `⋯` 与侧栏右键、命令面板同一张表（新建 / 提交 / 重命名 / 置顶 / 改色 / 关闭全部视图 / 删除工作树 / 设为窗口名称 / 隐藏…）。顺序走右键菜单金标准。改色写 `preferences.json`，取首个空闲槽位可覆盖。

5. **快捷键**  
   `⌘[` / `⌘]`：主窗 = 侧栏序上一个 / 下一个工作树；子窗 = 上一个 / 下一个可见区域。终端焦点时不注册为宿主全局滚动键，不改 Ghostty `goto_split`。`⌘⌥1…9` 跳到侧栏序对应工作树（主窗）或可见区域（子窗）。

6. **定位补全**  
   通知 / 深链 / `⌘⇧Y` 走 §9.4（与会话行同一函数）。到达即把「完成未查看」标已读。Index Quick Pick 在子窗与侧栏折叠时仍可用，目标改为工作树 → 区域 → 视图。

### 不做（本任务）

审查「发送给智能体」、文件已查看、词级高亮、W04–W12（规格 §17：独立排期）。不做频次排序、推荐区、引导浮层、新台账。

### 验证

```sh
pnpm exec vitest run tests/unit/renderer/workbench tests/unit/main/terminal/cwd-identity
pnpm exec tsc --noEmit
pnpm exec ultracite check <本任务改动>
pnpm check:file-size && pnpm check:dir-density && pnpm depcruise
pnpm check   # 本任务收口，跑完整静态 + unit + component
```

E2E（闲置机）：退化区域 `cd` 进已打开项目后区域栏换成该工作树；待建失败行可点重试。

手测：规格 §12 全表（颜色、加粗、加载还是坏了、主窗与子窗关系）。

### 完成定义

规格 §11 桌面场景可手测；§17 治理测试清单（跨工作树落点拒绝、事实所有权、tile 键唯一、侧栏只在主窗、主 / 子同源、窗口名只从锚 tile 派生、老布局迁移）全部在 `tests/unit/renderer/workbench/` 有对应断言；AGENTS.md 本节与实现一致（已有骨架，按实现补检查点路径）。

---

## 不在这三次

- 09-03 归档稿的正确性修复：W04 打开目录一致性、W08 命令运行语义、W09 通知来源、W10 浮层焦点、W11 关闭语义、W12 工作树表单四组合；以及「发送给智能体 / 已查看 / 词级高亮」。
- 移动端读 L0 枚举（规格 §11 末行）——桌面三次完成后再排。
- Cursor / Codex 固定三栏、工作树历史台账、第三套任务入口。
