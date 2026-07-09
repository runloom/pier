# Files 终端状态栏「当前项目」入口

**日期**：2026-07-09  
**范围**：`pier.files` 向终端状态栏贡献项目入口；点击打开 Files 并定位到当前项目根  
**关联文档**：

- [2026-07-02-plugin-configuration-and-statusbar-design.md](2026-07-02-plugin-configuration-and-statusbar-design.md)（插件状态栏贡献 / prefs 合并）
- [2026-07-01-git-status-bar-design.md](2026-07-01-git-status-bar-design.md)（`pier.worktree.status` 形态与可见性先例）
- [2026-07-02-project-file-tree-design.md](2026-07-02-project-file-tree-design.md)（Files 树根 = 项目锚点）
- Loomdesk 参考：`header-directory-item.svelte`（终端目录入口；语义为本 spec **有意偏离** 的对照物）

## 1. 背景与问题

Loomdesk 终端顶栏有可点的 `directory` 项：展示 shell cwd（`~/...`），点击 `openExplorer` 打开文件管理。

Pier 现状：

- 终端状态栏已有 core agent/task + Git `pier.worktree.status`
- `pier.files` 的 `terminalStatusItems: []`，没有对应入口
- Files 树根锚定 `projectRootPath`（Git 优先 gitRoot，非 Git 为 cwd），不是 shell 瞬时 cwd
- Shell cwd 已有 OSC7 → `PanelContext` → tab/title 管道，不缺「cwd 上报」

若原样移植 loomdesk「展示并打开 shell cwd」，会与 Files 树根模型错位，并与 tab cwd 重复。需要的是：**终端上一键打开当前项目的文件管理**，工程形态对齐 Git 状态项。

## 2. 目标 / 非目标

### 目标

1. `pier.files` 贡献终端状态项，作为「当前项目 → 打开 Files」入口。
2. 可见性、右对齐、outline 小按钮形态与 `pier.worktree.status` 同构（工程模式对齐，不是同一字段）。
3. 展示与点击均锚定**项目根**，与 Files 树根一致。
4. 无项目上下文时不渲染；设置页 / 右键状态栏菜单自动出现该项（走现有 manifest 合并管道）。

### 非目标

- **不**做 loomdesk 等价的 shell cwd 常驻指示器（不随 `cd` 更新文案）。
- **不**新建终端 header 贡献池。
- **不**把该项做成 core 状态项。
- **不**改 Git 状态栏、不改 cwd→tab 管道。
- **不**在本项内做编码 / 行列 / 语言等编辑器 status bar。

## 3. 产品定位（为何这是最佳实践）

| 信号 | 落点 | 原因 |
|---|---|---|
| 项目 / 工作区身份 | 本状态项 + Files 面板 | 稳定、可行动；与树根一致 |
| Git 分支 / 脏状态 | `pier.worktree.status` | 已有；职责不抢 |
| Shell cwd | 终端 tab / title（已有） | 高频变化；业界也不常驻状态栏 |

状态栏适合放稳定工作区动作；shell cwd 适合进程级 UI。点击目标必须等于 Files 数据模型的根，否则「显示路径 ≠ 打开结果」。

相对 loomdesk：学「终端上有可点的目录/项目入口」，落点改为 Pier 的项目锚点——适配，不是 1:1 抄。

## 4. 设计

### 4.1 贡献声明

插件：`pier.files`  
状态项 id：`pier.files.project`

```ts
// manifest.terminalStatusItems
{
  id: "pier.files.project",
  title: "Project",
  alignment: "right",
  order: 9, // 紧挨 pier.worktree.status (order 10) 左侧
  permissions: ["panel:open", "file:read"],
}
```

- locale：`terminalStatusItems.pier.files.project.{title,description}`
- `activate` 里 `context.terminalStatusItems.register({ id, isVisible, render })`，dispose 进 cleanup

### 4.2 项目锚点与可见性

```ts
function projectAnchor(context: PanelContext | undefined): string | null {
  return (
    context?.projectRootPath ??
    context?.worktreeRoot ??
    context?.gitRoot ??
    context?.cwd ??
    null
  );
}
```

- `isVisible` / `render`：无锚点 → 隐藏 / `null`（对齐 Git「无 worktree/gitRoot 不出现」的原则）
- 非 Git 目录：仍可显示（锚点落到 `projectRootPath` 或 `cwd`）；**不要**要求 `gitRoot`
- 启动瞬间 context 未到：隐藏，避免空路径闪烁

展示用锚点路径，**不用**状态栏上下文里的瞬时 `cwd` 字段做主文案（`cwd` 仅可进 tooltip 辅助，可选）。

### 4.3 展示

- 文案：锚点绝对路径折叠为 `~/...`（home 前缀规则；无 home 信息时显示绝对路径）
- 过长：`truncate` + `max-w-*`；tooltip 为全路径 + 简短说明（如「打开项目文件」）
- 控件：`Button` `size="xs"` `variant="outline"`，可选 `Folder` 图标，与 Git 触发器同高（`h-5`）
- `data-testid`：`files-project-status-trigger`
- i18n：插件 messages，禁止内联用户可见字符串

命名：UI / locale 用「项目 / Project」，避免「当前目录」造成 shell cwd 预期。

### 4.4 点击行为

```
click
  → resolve projectAnchor(panelContext)
  → panels.openInstance({
       componentId: FILES_FILE_PANEL_ID,
       context: panelContext,
       // 打开策略：复用现有 files 打开惯例（同 context 优先复用已有 group/instance）
     })
  → 确保文件树展开（若 collapsed 则展开）
  → revealFilesTreePath({ root: anchor, path: "" | anchor-relative root })
```

细则：

1. **打开**：带上当前终端的 `PanelContext`；优先聚焦已有同项目 Files 实例，避免无意义新开。
2. **Reveal**：定位到项目根（树根本身）。不 reveal shell 子目录。
3. **失败反馈**：打开或 reveal 失败 → `context.notifications.error`（i18n）；禁止只 `console.error`。
4. **强自然反馈**：面板打开 / 树定位成功 → 不加成功 toast。

实现上可抽 `openProjectFiles(context, panelContext)`（或等价），供状态项与未来命令复用；若现有 `openInstance` + `revealFilesTreePath` 已够，不必强行新命令。

### 4.5 与 Git 项的关系

| | `pier.files.project` | `pier.worktree.status` |
|---|---|---|
| 职责 | 打开项目文件树 | 分支 / 脏 / 特殊态 |
| 可见性字段 | 项目锚点（含非 Git） | gitRoot / worktreeRoot |
| order | 9 | 10 |
| 点击 | Files | Git status dropdown |

两者可同时出现；文案避免都刷长路径——本项以折叠路径为主，Git 保持现有分支/标志为主。

### 4.6 Shell cwd 边界（写死）

- 终端内 `cd` 到子目录：**本项文案不变**（仍是项目根）。
- Tab / document title 仍可反映 cwd（现有管道）。
- 若未来需要「打开 shell 当前目录」，另立状态项或 tab 交互，不扩展本项语义。

## 5. 测试

- 单元：`projectAnchor` 优先级；路径 `~` 折叠；无 context → 不可见。
- 组件 / 注册：manifest 声明 + register；点击调用打开/reveal（mock panels / tree registry）。
- 回归：Git 状态项、cwd→tab、Files 树根解析不受影响。

## 6. 验收标准

1. 有项目上下文的终端：右侧出现项目项，形态接近 Git 状态按钮。
2. 点击 → Files 打开，上下文正确，树在项目根。
3. 无项目上下文：该项不出现。
4. `cd` 进子目录：该项文案不变；tab 仍可反映 cwd。
5. 非 Git 目录：仍显示并可打开 Files。
6. 设置页 / 右键「管理状态栏」能看到并开关该项。

## 7. 实现提示（非绑定实现细节）

主要触点（实现计划可再拆）：

- `src/plugins/builtin/files/manifest.ts` — 声明 `terminalStatusItems`
- `src/plugins/builtin/files/locales/{en,zh-CN}.json` — `terminalStatusItems` + 通知文案
- `src/plugins/builtin/files/renderer/` — 新 status item 组件 + `openProjectFiles` 辅助 + `activate` 注册
- 必要时扩展 `revealFilesTreePath` / group 打开路径以支持「仅打开树、无磁盘文件 tab」

参考实现：`src/plugins/builtin/git/renderer/git-status-item.tsx` 的 `registerGitStatusItem`。
