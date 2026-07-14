# Codex 账号设置页与用量物料完善设计

**日期**：2026-07-09  
**状态**：待用户审阅规格  
**范围**：`pier.codex` 设置页（账号管理）+ Workbench 用量物料重做 + 宿主自定义设置页贡献点；删除命令面板账号操作
**关联文档**：

- [2026-07-05-dashboard-kit-and-codex-accounts-design.md](2026-07-05-dashboard-kit-and-codex-accounts-design.md)（早期「账号 UI 仅在大盘」产品决定，**本规格修订**）
- [2026-07-07-managed-external-plugins-and-codex-migration-design.md](2026-07-07-managed-external-plugins-and-codex-migration-design.md)（账号域已迁入 `pier.codex`）

**参考 UI**：Orca Codex 设置页（图 1）、Orca Codex 用量/账户 popover（图 2）

## 1. 背景与问题

`pier.codex` 已是官方 managed external plugin，账号 CRUD / 登录 / 切换物化 / 用量轮询在插件 main + plugin RPC 中可用。但 UI 与产品预期不对齐：

1. **设置页几乎为空**：仅自动渲染 `confirmSwitch` 开关，没有账号列表与「系统默认」语义。
2. **物料仍是 CRUD 列表**：与图 2 的用量仪表盘不符；session/weekly 数据已在 main 拉取，UI 未展示。
3. **命令面板声明了三条 commands 但未注册**：用户要求不在命令面板添加入口；应删除 manifest 声明，避免半成品。
4. **旧规格写死「账号管理唯一入口是大盘」**：与当前产品方向冲突，改为设置页管账号、物料管用量。

## 2. 目标与非目标

### 目标

- 设置页对齐图 1：说明文案、系统默认卡、受管账号列表、添加账户、空态虚线框、`confirmSwitch`。
- 物料对齐图 2（子集）：会话/每周剩余进度条、相对更新时间、当前账户选择器、「管理账户…」跳转设置。
- 宿主新增可复用的 **自定义设置页贡献点**（`settingsPages`），`pier.codex` 经此注册，不特判插件 id。
- `activeAccountId === null` 表示系统默认（本机 `~/.codex`）。
- 从 `plugin.json` 删除三条 commands；renderer 不注册对应 actions。
- 用量 DTO 结构化暴露 `session` / `weekly`；系统默认活跃时也能拉用量。

### 非目标

- 不做速率限制「立即重置」UI/RPC（图 2 该区本期隐藏）。
- 不做全局状态栏账号入口。
- 不做物料内添加/删除账号。
- 不做第三方插件设置页 marketplace；贡献点仅服务官方/内置可信插件纪律链。
- 不把账号域迁回宿主；不恢复 `window.pier.accounts` / `account:*`。

## 3. 职责拆分（已确认）

| 面 | 职责 |
|----|------|
| 设置页 | 唯一账号 CRUD：添加、删除、切回系统默认、取消登录；`confirmSwitch` |
| 物料 | 用量展示 + 快速切换账号 + 「管理账户…」打开设置 |
| 命令面板 | 无 Codex 账号操作项 |

次要动作：**「接管当前登录」(`accounts.adoptCurrent`)** 保留为设置页次要入口（不抢「添加账户」主 CTA），例如空态旁或溢出菜单。

## 4. 数据模型与 RPC

### 4.1 系统默认语义

- `activeAccountId === null` → 活跃身份为系统默认，使用真实 `CODEX_HOME` / `~/.codex`，**不**物化受管 home。
- 切到受管账号：对当前活跃身份 `syncBack`（若有）后 `materialize` 目标受管 home，并写入 `activeAccountId`。
- 切回系统默认：若当前有受管活跃账号则先 `syncBack`，再将 `activeAccountId` 置 `null`（不 materialize 另一受管目录）。
- 删除：禁止删除当前活跃受管账号（保持现有约束）；须先切换到其他受管账号或系统默认。

### 4.2 用量 DTO

将 `CodexUsageSnapshot` 从「几乎只有 `raw`」改为结构化（`raw` 可保留兼容，UI 以结构化字段为准）：

```ts
interface CodexUsageWindow {
  usedPercent: number;
  resetsAt?: number; // epoch ms
  windowMinutes?: number;
}

interface CodexUsageSnapshot {
  fetchedAt: number;
  status: "ok" | "error";
  error?: string;
  session?: CodexUsageWindow;
  weekly?: CodexUsageWindow;
  raw?: unknown; // optional debug / forward-compat
}
```

用量归属「当前活跃身份」：

- 受管活跃：缓存键继续用 `accountId`。
- 系统默认活跃：使用专用缓存键（如 `"__system__"`），`doRefreshUsage` **不得**在 `activeAccountId === null` 时直接 return。

展示：剩余 % = `max(0, 100 - usedPercent)`；`Resets in …` / `Updated … ago` 用共享相对时间 formatter。

### 4.3 RPC 面

| Method | 变更 |
|--------|------|
| `accounts.snapshot` | 不变；usage 字段形状升级 |
| `accounts.add` | 不变（设置页主 CTA） |
| `accounts.remove` | 不变（仅设置页） |
| `accounts.cancelLogin` | 不变 |
| `accounts.adoptCurrent` | 不变（次要入口） |
| `accounts.refreshUsage` | 支持系统默认活跃 |
| `accounts.select` | 仅受管 `accountId: string` |
| `accounts.selectSystemDefault` | **新增**：切回系统默认 |

事件仍为 `accounts.changed`（全量 snapshot）。

`confirmSwitch`：renderer 在调用 `select` / `selectSystemDefault` 前读取 `configuration.get("pier.codex.confirmSwitch")`，为 true 时先 `dialogs.confirm`。

## 5. 宿主：自定义设置页贡献点

### 5.1 Manifest

在插件 manifest（`plugin.ts` / `managed-plugin.ts` schema）增加：

```ts
settingsPages?: Array<{
  id: string;
  title?: string; // 可选；默认用插件名
}>;
```

`pier.codex` 声明例如：

```json
"settingsPages": [{ "id": "pier.codex.accounts" }]
```

locales：`locales.<lang>.settingsPages.<id>.title`（可选）。

侧栏出现条件：插件已启用，且（有 `configuration` **或** 有非空 `settingsPages`）。

### 5.2 Renderer API

`ExternalRendererPluginContext` 增加：

```ts
settingsPages: {
  register(registration: {
    id: string;
    component: ComponentType<PluginSettingsPageProps>;
  }): () => void;
};

app: {
  /** 打开宿主设置并定位到 section（如 `plugin:pier.codex`） */
  openSettings(options?: { section?: string }): void;
};

dialogs.confirm(options: {
  title: string;
  body?: string;
  intent?: "default" | "destructive"; // 删除账号用 destructive
}): Promise<boolean>;
```

`PluginSettingsPageProps`：v1 与现有 external widget 一致——`register` 时用闭包注入 `context`，组件 props 为空对象 `{}`（宿主只负责挂载，不传账号域数据）。

纪律链：`assertDeclaredContribution("settingsPage")` → `plugin-settings-page-registry` → `SettingsDialog` 渲染。

**v1 约束**：每个插件最多一个 `settingsPages` 条目；manifest 声明多于一个或 register 多于一个均为错误（assert / 启动诊断）。后续若需多页再扩展。

### 5.3 SettingsDialog 渲染优先级

对 `plugin:<pluginId>` section：

1. 若该 plugin 已注册 settingsPage → 只渲染该自定义组件。
2. 否则 → 现有 `PluginConfigurationSection`。

自定义页内自行渲染 `confirmSwitch`（读/写 `context.configuration`），避免「自定义页 + 下方再挂一份自动 schema」双入口。manifest 可保留 `configuration.properties` 供存储与默认值，但当存在已注册 settingsPage 时宿主 **不再**自动渲染 configuration 表单。

### 5.4 打开设置

物料「管理账户…」调用 `context.app.openSettings({ section: "plugin:pier.codex" })`，内部映射到 `useSettingsDialogStore.openSection(...)`。

## 6. 设置页 UI（图 1）

组件建议落在 `packages/plugin-codex/src/renderer/accounts-settings-page.tsx`。

结构：

1. **页头**：Codex 图标 + 标题；两段说明（可选；本机登录上下文保留在此设备）。
2. **「账户」区头**：副标题（正在显示此设备的账户…）+ 右侧「+ 添加账户」。
3. **系统默认卡**（实线）：标题「系统默认」；`activeAccountId === null` 时「当前」Badge；描述使用本机 Codex 登录；非当前时可切换回来（走 confirm）。
4. **受管账号列表**：实线卡；label、状态、当前 Badge；非当前：切换 / 删除（删除 `intent: "destructive"`）。
5. **空态**：无受管账号时虚线框说明文案（Orca 风格）。
6. **登录中**：Alert +「取消登录」；添加禁用。
7. **confirmSwitch**：同页开关。
8. **adoptCurrent**：次要按钮/菜单项，不与「添加账户」并列抢主视觉。

视觉：走现有 shadcn / token；实线 vs 虚线边框区分「实体卡」与「空态提示」；深浅色均可验收。

操作反馈：失败 `notifications.error`；成功依赖列表/Badge 自然反馈，不加冗余 success toast。

## 7. 物料 UI（图 2 子集）

重写 `accounts-widget.tsx`（可拆 `usage-meter.tsx` / `account-picker.tsx`）。

结构：

1. **头**：图标 +「Codex」；`Updated {relative}`（`usage.fetchedAt`）。
2. **会话** / **每周**：进度条（剩余 %）+ `Resets in …`；无数据时 empty/error 态。
3. **Codex 账户**：
   - 当前标签（系统默认或账号 label）+ chevron → 选择器（系统默认 + 受管列表）。
   - 「管理账户…」→ `openSettings`。
4. 遵守物料红线：`WidgetSkeleton` / `WidgetEmpty` / `WidgetError`；消费宿主 `visible` / `refreshToken`（`visible=false` 不触发额外 refresh；`refreshToken` 变化时 `accounts.refreshUsage`）。
5. manifest：可标 `refreshable: true`；调整 `defaultSize` 以适配纵向仪表盘（实现时按视觉微调，建议约 `w: 3–4, h: 5–6`）。

**不做**：添加/删除、速率重置区、页内大「Refresh usage」主按钮。

## 8. 命令面板

从 `plugin.json` 的 `commands` 与 `locales.*.commands` 删除：

- `pier.codex.addAccount`
- `pier.codex.switchAccount`
- `pier.codex.refreshUsage`

renderer `activate` 不调用 `context.actions.register`。相关单测若断言命令存在则删除/改写。

## 9. i18n

- 设置页与物料文案一律 `context.i18n.t(key, fallback)`，**英文 fallback 必须完整可用**（当前 external `i18n.t` 只返回 fallback，本期不阻塞去接通 manifest `messages`；zh-CN 用户侧栏/物料标题仍可走既有 manifest `locales` 贡献标题通道）。
- 禁止宿主 `src/renderer/i18n` 硬编码 Codex 账号业务文案。

## 10. 测试

- 单元：`selectSystemDefault`（含从受管 syncBack 后清空 active）；系统默认下 `refreshUsage` 写入 `__system__` 缓存；usage DTO 解析。
- 组件：设置页渲染系统默认 + 空态 + 添加/删除调用 RPC；物料渲染双进度条与账户选择；「管理账户」触发 `openSettings`。
- 宿主：settingsPage 未声明即 register → assert；有 settingsPage 时侧栏出现且优先于自动 configuration 表单；无 settingsPage 仅有 configuration 时行为不变。
- 回归：manifest 无上述三条 commands。

## 11. 修订说明（相对旧规格）

| 旧决定（2026-07-05） | 本规格 |
|---------------------|--------|
| 账号管理唯一入口是大盘 widget | 设置页唯一 CRUD；物料只用量 + 快切 |
| 命令面板三条账号命令 | 删除，不进命令面板 |
| 设置页只有 confirmSwitch | 自定义设置页完整账号 UI |

## 12. 实现顺序建议

1. 宿主 `settingsPages` + `app.openSettings` + `dialogs.confirm.intent`
2. 插件 DTO / `selectSystemDefault` / 系统默认用量
3. 设置页 UI
4. 物料重写
5. 删除 commands + 测试与 i18n 收尾
`)
