# 项目记忆：设置页表面

日期：2026-08-27  
状态：已确认（取代 2026-08-26 设计的「插件表面」）  
范围：`pier.memory` 的产品表面从 dockview 面板改为插件设置页；增加条目列表与删除。引擎、账本、MCP 写入、`AGENTS.md` 引导段仍以 [2026-08-26 项目记忆插件](./2026-08-26-project-memory-plugin-design.md) 为准。  
相关：Codex 账号设置页（`settingsPages.register`）、设置 → 项目列表（`useLocalEnvironmentsStore`）。

## 一句话终态

记忆是项目偏好，不是工作面。用户只在设置里开/关、查看、忘掉；智能体仍经官方 memory MCP 读写同一份本机 JSONL。

## 动机

业界把记忆治理放在设置或会话命令，不放在编辑器常驻面板：ChatGPT / Claude.ai 是设置里的开关 + 可删条目；Cursor 在设置的 Rules / Memories；Windsurf 在设置里 Manage Memories；Claude Code 用 `/memory` 打开文件。Pier 的 dockview 面板反了：记忆不是每天盯的面。

## 目标与非目标

### 目标

1. 拆掉 `pier.memory.panel`。命令面板和 `+` 创建器不再出现这块面板。
2. 插件声明唯一 `settingsPages` 项，设置侧栏出现「项目记忆」（与 Codex 账号同级）。
3. 页内左列项目列表、右列选中项目的开关 + 可删 observation。
4. 删除走宿主命令，在锁里改 `memory.jsonl`，不经 MCP 工具。

### 非目标

- 编辑 observation 正文、新建条目、展示/删除 `relation` 行。
- 把记忆文件提交进 git、团队共享存储。
- 命令面板登记 enable/disable（管理只走设置页）。
- Pier Home 作为记忆根。
- 替代各智能体原生 auto memory。

## 信息架构

- manifest：`settingsPages: [{ id: "pier.memory.settings" }]`；`panels: []`。
- permissions：`workspace:read`、`managedAssets:write`。去掉 `panel:register` / `panel:open`。
- 内置插件 `RendererPluginContext` 补 `settingsPages.register`，接到已有 `registerPluginSettingsPage`（设置对话框已经按插件 id 渲染自定义页）。每个插件最多一页（契约 `max(1)`）。
- 打开：设置侧栏插件项，或插件列表「设置 →」。深链走现有 `openSection(plugin:<id>)`。
- 已持久化布局里的旧 `pier.memory.panel`：按未知插件面板卸载（与禁用插件同路），不复活。

## 页结构

对齐「设置 → 项目」的主从布局，不套第二层 Dialog。

**左列**

- 数据源：`useLocalEnvironmentsStore` 的项目登记，过滤 `kind === "pier-home"`。
- 展示：basename + 路径。无「添加项目」；要登记项目走「设置 → 项目」。
- 默认选中：当前活动面板的 `projectRootPath`（若在列表中），否则第一项。
- 列表为空：Empty「未打开项目」+「请先在设置的项目里添加文件夹。」

**右列（未选）**

Empty：「请选择一个项目。」不调记忆命令。

**右列（已选）** 两张 Card，Alert 必须在 Card 内。

### 开关卡（即时偏好）

- Switch 写 `desiredState`（`enable` / `disable`）。改即生效，无独立保存。
- 派生状态、已接入智能体数、记忆文件位置、引擎版本。
- 部分接入：Card 顶 Alert +「查看详情」→ `dialogs.alert` 列出各目标 outcome。
- git 跟踪确认：现有 `needsConfirmation` → `dialogs.confirm`（`intent: "default"`）；取消零写入。
- 启用后一行 Claude Code 首次批准提示。
- 关闭开关 **不删** `memory.jsonl`，不改已有条目。

### 条目卡

出现条件：`desiredState === "enabled"`，或 store 里已有可展示条目。

- 行 = 一条 observation。按 `entityType` 分组，只认 `convention | pitfall | decision | environment`。其它类型、破损 JSON、`type !== "entity"` 的行不展示、不提供删除。
- 每行：类型、实体名、观察正文、删除。
- 底部「清空本项目记忆」：只清空 JSONL 内容，**不**改 MCP 配置、**不**改 `desiredState`。
- 未启用且文件空：不渲染条目卡。
- 文件 > 8MB：与 `snapshotStatus` 相同，放弃扫描。条目卡只留说明「记忆文件较大，无法在设置里列出或删除」，禁止删。

开关本身是反馈，不加成功 toast。删除靠行消失。失败走 `dialogs.alert`（title 用户白话，body 为 `Error.message`）。

## 命令与 facade

现有 `memory.enable` / `memory.disable` / `memory.status` 保留。新增（`allowedClientKinds: ["desktop-renderer"]`，不进 CLI）：

| 命令 | 能力 | 作用 |
|---|---|---|
| `memory.list` | `managedAssets:write` | 返回可展示 observation 列表 |
| `memory.deleteObservation` | `managedAssets:write` | 按实体名 + 下标删一条 |
| `memory.clearStore` | `managedAssets:write` | 清空 JSONL，保留空文件与权限 |

`root` 仍是 `AssetRootRef`；本页只发 `scope: "project"`。服务入口继续拒绝未登记路径。

`list` 项：

```ts
{
  entityName: string;
  entityType: "convention" | "pitfall" | "decision" | "environment";
  index: number;       // 该 entity.observations 数组下标
  observation: string;
}
```

分组顺序固定：convention → pitfall → decision → environment；同组按 JSONL 实体出现序，组内按下标。

`deleteObservation` 入参：`root` + `entityName` + `index`。读-改-写该 entity 行：去掉该下标；数组空则删除整行 entity。下标越界或实体不存在 → 失败，不静默当成功。

`clearStore`：把 store 截成空文件（保持 0600），不碰 ledger 的 `desiredState` 与 MCP 目标。

`context.projectMemory` 增 `list` / `deleteObservation` / `clearStore`，同样断言 `managedAssets:write`。

## 删除实现

- 全部在 `FilePathTransactionLock` + per-projectKey 互斥内。
- 官方引擎 JSONL：`{"type":"entity","name":...,"entityType":...,"observations":[...]}`。本版不展示、不改 `type: "relation"` 行。
- 不经 MCP 工具，避免宿主再开客户端。
- 与智能体会话并发：引擎按文件读。锁保证写完整；会话内短滞后可接受。
- 破坏性确认：`dialogs.confirm`，`intent: "destructive"`。清空与单条删除都要确认。

## 内置插件接线

今日只有外部插件能 `settingsPages.register`。本设计要求：

1. `RendererPluginContext` 增加与外部同构的 `settingsPages.register`。
2. 实现复用 `src/renderer/lib/plugins/settings-page-registry.ts`（一插件一页）。
3. 宿主仍只在 builtin-catalog 处 import 插件包；设置对话框继续按插件 id 取注册页，不直 import `pier.memory` 页面组件。

## 测试与治理

- 治理：不再声明 `panels`；声明恰好一个 `settingsPages`；locale 四语言键一致（含列表空态、删除、清空、文件过大）；`managedAssets:write` 仍只给 `desktop-renderer`。
- 命令：`list` 过滤非四类 entity；按 `entityName+index` 精确删一条；清空不动 MCP 配置和 `desiredState`；越界删除失败。
- 组件：选中项目后渲染开关；启用后出现条目；删除先 confirm。
- 回归：reconcile / serializer / 授权 / store 8MB 截断仍绿。
- 切走：旧面板 id 不在 panel registry。

## 检查点

- `tests/unit/plugins/pier-memory-governance.test.ts`
- `tests/unit/main/agent-managed-assets/`（list / delete / clear）
- `tests/unit/plugins/pier-memory-settings.test.tsx`（设置页；取代面板组件测）
