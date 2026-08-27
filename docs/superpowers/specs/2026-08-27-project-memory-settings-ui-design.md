# 项目记忆：设置页表面

日期：2026-08-27  
状态：已确认（取代 2026-08-26 设计的「插件表面」；线框按现有设置壳改过）。MCP 交付面重构见 [v3 全局注册](./2026-08-27-project-memory-global-registration-v3-design.md)：本页表面不变，「部分接入」语义改为全局注册健康，git 跟踪确认弹窗删除。  
范围：`pier.memory` 的产品表面从 dockview 面板改为插件设置页；增加条目列表与删除。引擎、账本、MCP 写入、`AGENTS.md` 引导段仍以 [2026-08-26 项目记忆插件](./2026-08-26-project-memory-plugin-design.md) 为准。  
相关：Codex 账号设置页、设置 → 项目（列表钻取详情）、通知设置（Card + `SwitchRow` 同构）、MCP 列表（`Item outline`）。

## 一句话终态

记忆是项目偏好，不是工作面。用户只在设置里开/关、查看、忘掉；智能体仍经官方 memory MCP 读写同一份本机 JSONL。交互与视觉复用现有设置页，不另做分栏、不另做开关条。

## 动机

业界把记忆治理放在设置，不放在编辑器常驻面板。Pier 侧必须再对齐**本仓库**已有表面：

| 要对齐的现有面 | 本页怎么用 |
|---|---|
| 插件设置页（Codex 账号） | 单列 `max-w-[62rem] px-4 pb-8`；`h1` 在卡片外；`Card size="sm"` 分段 |
| 设置 → 项目 | **先列表、再钻取详情**（返回 + 标题 + 路径），禁止设置内容区再做左右分栏 |
| 通知 / LSP / 终端 | 即时偏好：横向 `Field`（左标签+说明，右 Switch），即宿主 `SwitchRow` 同构 |
| 项目 MCP / 技能 | 列表用 `Item outline`；空态用 `Empty` + `EmptyMedia` |
| 插件 / 通知健康 | 卡内 `StatusStack`，禁止 `h1` 下裸 Alert |
| Codex 删账号 | `Button size="icon-sm" variant="ghost"` + `Trash2` + `aria-label`；破坏性 `dialogs.confirm` |

内置插件只能 import `src/plugins/api`、`src/shared`、`packages/ui`，**禁止** import 宿主 `pages/settings`。开关用 `@pier/ui/field` + `Switch` 拼出与 `SwitchRow` 相同的横向结构。

## 目标与非目标

### 目标

1. 拆掉 `pier.memory.panel`。命令面板和 `+` 创建器不再出现这块面板。
2. 插件声明 `projectSettings: [{ id: "pier.memory.project" }]`，设置 → 项目出现「项目记忆」tab。
3. tab 内直接是该项目的开关与可删 observation，不再做项目列表钻取。
4. 删除走宿主命令，在锁里改 `memory.jsonl`，不经 MCP 工具。

### 非目标

- 编辑 observation 正文、新建条目、展示/删除 `relation` 行。
- 把记忆文件提交进 git、团队共享存储。
- 命令面板登记 enable/disable。
- Pier Home 作为记忆根。
- 替代各智能体原生 auto memory。
- 设置内容区左右分栏、自绘开关条、正文里的「删」字按钮、body 底冒充 footer。

## 信息架构

- manifest：`projectSettings: [{ id: "pier.memory.project" }]`；`settingsPages: []`；`panels: []`。
- permissions：`workspace:read`、`file:read`（打开记忆文件）、`managedAssets:write`。去掉 `panel:register` / `panel:open`。
- 打开路径：设置 → 项目 → 项目记忆。
- `visible({ isPierHome })` 排除 Pier Home；省略时宿主默认 `!isPierHome`。
- `render` 只收宿主传入的已登记 `projectRootPath`。插件不列项目、不进侧栏。

## 页结构

开关卡、条目卡、对话框和状态对照渲染在项目详情 tab 内。外层 chrome（返回、项目标题、路径、宿主 tab）由宿主 `ProjectsSectionDetail` 提供；插件不自挂 `max-w-[62rem]` 壳、不列项目、不画详情顶栏返回。

### 开关卡（即时偏好）

- `CardContent`：可选 `StatusStack`（部分接入 / 加载失败）→ `FieldSet` → 横向 `Field`（`SwitchRow` 同构）：
  - 标签：启用项目记忆
  - 说明：已接入 {n} 个智能体（关着则为已关闭的一句说明）
  - 右侧 Switch，改即 `enable`/`disable`
- `FieldSeparator` 后两组只读说明（标签在上、值在下）：记忆文件位置（**可点击路径**：`Button variant="link"` 等宽、`break-all` 自动换行完整展示 `storePathDisplay`——main 侧把家目录折叠为 `~`；绝对路径进 `title`；点击经 `context.files.openInEditor` 在 Pier 文件面板打开该 JSONL，成功后 `context.settings.close()` 关闭设置让路，失败 `dialogs.alert`）、引擎版本（等宽值）。不新增 reveal 类命令。
- 启用后：`text-muted-foreground text-sm` 的 Claude 首次批准提示（不是 Alert）。
- 部分接入：卡顶 `StatusStack`；需要技术明细时按钮打开 `dialogs.alert`。
- git 跟踪：现有 `needsConfirmation` → `dialogs.confirm`（`intent: "default"`）。取消则 Switch 保持关。
- **默认启用**：宿主在项目首次进入时自动 enable（见 08-26「默认启用」）；本页 Switch 通常初始即开。自动路径跳过的 tracked 项目初始为关，用户开启时才见确认。
- 关闭开关不删 JSONL。

### 条目卡

出现条件：`desiredState === "enabled"`，或 store 里已有可展示条目。

- `CardHeader` / `CardTitle`：记忆条目（或同等 locale）。
- `CardContent`：`ItemGroup`。每条 observation 一个 `Item outline` `size="sm"`：
  - `ItemTitle`：观察正文
  - `ItemDescription`：实体名 · 类型白话（约定 / 踩过的坑 / 拍板决策 / 环境事实）
  - `ItemActions`：`Trash2` 的 `icon-sm` ghost 按钮，`aria-label` 删除这条记忆
- 分组用 `FieldLegend` 或 `DIALOG_SECTION_TITLE_CLASS` 同类小节标题，顺序 convention → pitfall → decision → environment。不要为分组加 `Separator`，除非无法用标题表达。
- 卡底主操作：`Button variant="outline"`「清空本项目记忆」（设置页不是 content dialog，**不要** `setFooter`）。
- 启用但无条目：卡内 `Empty`（与 MCP 空列表同构），不要假列表。
- 未启用且文件空：不渲染条目卡。
- 文件 > 8MB：条目卡只留说明，禁止列出和删除。

无成功 toast。删除靠该 `Item` 消失。失败 `dialogs.alert`。

## 线框

### 设置壳（设置 → 项目 → 项目记忆）

侧栏选中「项目」。内容区是宿主 `ProjectsSectionDetail`：返回 + 标题 + 路径 + tab。插件只渲染「项目记忆」tab 的开关卡 / 条目卡，不进侧栏、不自挂 `max-w-[62rem]` 壳。

```
+------------------------------------------------------------------+
| 设置                                                          [X] |
| 外观、智能体、通知和项目偏好。                                     |
+----------+-------------------------------------------------------+
| 通用     |  [<]  pier                              当前           |
| 外观     |       /Users/xyz/ABC/pier                              |
| 通知     |  环境 | 技能 | MCP | *项目记忆* | 常规                  |
| *项目*   |                                                       |
| …        |  （tab 内：开关卡 / 条目卡，见下）                      |
| 插件     |                                                       |
| Codex 账号                                                        |
+----------+-------------------------------------------------------+
```

### tab · 已关闭

开关卡用横向 Field，不是自定义两端对齐条。无条目卡。宿主 chrome 见上图，不在插件里再画返回顶栏。

```
+----------------------------------------------------------+
| [<]  pier                                    当前        |
|      /Users/xyz/ABC/pier                                 |
|                                                          |
| +------------------------------------------------------+ |
| | 启用项目记忆                                    [ ]  | |
| | 开启后,智能体会跨会话记住这个项目的约定、踩过的坑     | |
| | 和决策。                                              | |
| | ---------------------------------------------------- | |
| | 记忆文件位置                                           | |
| | ~/.pier/memory/eba32e…5a/memory.jsonl (可点击,换行)  | |
| | 引擎版本                                               | |
| | @modelcontextprotocol/server-memory@2026.7.4            | |
| +------------------------------------------------------+ |
+----------------------------------------------------------+
```

### tab · 已启用、有条目

条目是 `Item`，删除是图标按钮，不是「删」字。清空是 outline 按钮，贴在卡片内容底，不是 Dialog footer。

```
+----------------------------------------------------------+
| [<]  pier                                    当前        |
|      /Users/xyz/ABC/pier                                 |
|                                                          |
| +------------------------------------------------------+ |
| | 启用项目记忆                                    [x]  | |
| | 已接入 3 个智能体                                      | |
| | ---------------------------------------------------- | |
| | 记忆文件位置  ~/…/memory.jsonl(可点击,换行)           | |
| | 引擎版本  @…@2026.7.4                                     | |
| |                                                      | |
| | Claude Code 第一次使用项目记忆时会要求一次性批准。     | |
| +------------------------------------------------------+ |
| +------------------------------------------------------+ |
| | 记忆条目                                               | |
| |                                                      | |
| | 约定                                                   | |
| | +--------------------------------------------------+ | |
| | | 包管理器用 pnpm                              [🗑] | | |
| | | pnpm · 约定                                      | | |
| | +--------------------------------------------------+ | |
| | 踩过的坑                                               | |
| | +--------------------------------------------------+ | |
| | | 新工作树必须先跑 pnpm setup:worktree         [🗑] | | |
| | | worktree · 踩过的坑                              | | |
| | +--------------------------------------------------+ | |
| | 拍板决策                                               | |
| | +--------------------------------------------------+ | |
| | | 布局只走 dockview                            [🗑] | | |
| | | dockview · 拍板决策                              | | |
| | +--------------------------------------------------+ | |
| | 环境事实                                               | |
| | +--------------------------------------------------+ | |
| | | 编译需要 zig 0.15.2                          [🗑] | | |
| | | zig · 环境事实                                   | | |
| | +--------------------------------------------------+ | |
| |                                                      | |
| | [清空本项目记忆]                                       | |
| +------------------------------------------------------+ |
+----------------------------------------------------------+
```

`[🗑]` = `Trash2`、`size="icon-sm"`、`variant="ghost"`，不是字面垃圾桶 emoji。

### tab · 已启用、无条目

```
| +------------------------------------------------------+ |
| | 记忆条目                                               | |
| |                    [文档]                              | |
| |                  还没有记忆                             | |
| |         智能体在会话里记下的内容会出现在这里。           | |
| +------------------------------------------------------+ |
```

### tab · 部分接入

`StatusStack` 在开关卡 **Content 顶部**（与插件设置、通知「提醒方式」同位置）。

```
| +------------------------------------------------------+ |
| | ⚠ 部分智能体没有接上。                    [查看详情]   | |
| | 启用项目记忆                                    [x]  | |
| | 已接入 2 个智能体                                      | |
| +------------------------------------------------------+ |
```

「查看详情」→ `dialogs.alert`（固定 `sm`，单主按钮右簇），body 为各目标路径 + outcome。

### tab · 文件过大

```
| +------------------------------------------------------+ |
| | 记忆条目                                               | |
| | 记忆文件较大，无法在设置里列出或删除。                   | |
| +------------------------------------------------------+ |
```

### 对话框（已有宿主规范，不另画壳）

全部走插件 `dialogs.*`，宽度/footer/侧标由 kind 决定，调用方不传 `size`。

| 场景 | API | intent | 按钮 |
|---|---|---|---|
| git 跟踪确认 | `confirm` | `default` | 取消 \| 继续 |
| 删除一条 | `confirm` | `destructive` | 取消 \| 删除 |
| 清空本项目 | `confirm` | `destructive` | 取消 \| 清空 |
| 失败 / 接入详情 | `alert` | — | 知道了 |

文案：

- git：标题「要把记忆配置写进 git 跟踪的文件吗？」正文说明本机记忆、配置常被跟踪、别的机器无效。
- 删除：标题「删除这条记忆？」正文「智能体以后不会再读到这条。」
- 清空：标题「清空这个项目的记忆？」正文「只清空本机记忆内容，不会关掉项目记忆，也不会改智能体配置。」

### 状态对照

| 状态 | 屏 | 开关卡 | 条目卡 |
|---|---|---|---|
| 无登记项目 | 宿主项目列表 Empty | — | — |
| 有项目未点进 | 宿主项目列表 | — | — |
| 已关闭、文件空 | tab | Switch 关 | 无 |
| 已关闭、仍有旧条目 | tab | Switch 关 | 有，可删/清空 |
| 已启用、无条目 | tab | Switch 开 | Empty |
| 已启用、有条目 | tab | Switch 开 + Claude 提示 | Item 列表 |
| 部分接入 | tab | StatusStack + Switch 开 | 按文件 |
| 文件过大 | tab | 照常 | 仅说明 |

## 命令与 facade

现有 `memory.enable` / `memory.disable` / `memory.status` 保留。新增（`allowedClientKinds: ["desktop-renderer"]`，不进 CLI）：

| 命令 | 能力 | 作用 |
|---|---|---|
| `memory.list` | `managedAssets:write` | 返回可展示 observation 列表 |
| `memory.deleteObservation` | `managedAssets:write` | 按实体名 + 下标 + 原文删一条 |
| `memory.clearStore` | `managedAssets:write` | 清空 JSONL，保留空文件与权限 |

打开记忆文件不走 memory 命令：插件经宿主跨插件入口 `files.openInEditor`（`file:read`）在文件面板打开 `storePath`。

`root` 仍是 `AssetRootRef`；本页只发 `scope: "project"`。

`list` 项：

```ts
{
  entityName: string;
  entityType: "convention" | "pitfall" | "decision" | "environment";
  index: number;
  observation: string;
}
```

分组顺序固定：convention → pitfall → decision → environment。

`deleteObservation`：`root` + `entityName` + `index` + `observation`（原文）。磁盘上该下标的原文不一致即拒删（防「列表过期 → 并发错删」）；命中后数组空则删除整行 entity。越界失败。文件超 8MB 时命令侧同样拒绝（不只靠 UI 藏按钮）。

`clearStore`：截成空文件（0600），不碰 `desiredState` 与 MCP 目标。

`context.projectMemory` 增 `list` / `deleteObservation` / `clearStore`。

## 删除实现

- `FilePathTransactionLock` + per-projectKey 互斥。
- 只改 `type: "entity"` 且四类 `entityType` 的 observation；按「实体名 + 下标 + 原文」三元组匹配，只删第一处。
- 不经 MCP 工具。
- 破坏性确认见上表。

## 内置插件接线

1. `RendererPluginContext` 增加 `projectSettings.register`。
2. 复用 `project-settings-registry.ts`。
3. 宿主 `ProjectsSectionDetail` 按注册项渲染 tab；宿主不直 import `pier.memory` 页面。
4. tab 内组件只使用 `@pier/ui` 原语（`Card` / `Field` / `Switch` / `Item` / `Empty` / `StatusStack` / `Button`），密度默认 28px，图标按钮不另写尺寸 class。

## 测试与治理

- 治理：无 `panels`、无 `settingsPages`、恰好一个 `projectSettings`；locale 四语言键一致；`managedAssets:write` 仅 desktop-renderer。
- 命令：`list` 过滤；精确删除；清空不动 MCP / `desiredState`。
- 组件：开关 / 删除 / git 确认。
- 宿主 tab：登记项目显示、Home 隐藏。

## 检查点

- `tests/unit/plugins/pier-memory-governance.test.ts`
- `tests/unit/main/agent-managed-assets/`（list / delete / clear）
- `tests/unit/plugins/pier-memory-settings.test.tsx`
- `tests/unit/renderer/app/dialog-form-governance.test.ts` 与设置 Alert 布局治理（不在插件源码里再发明横向开关）
