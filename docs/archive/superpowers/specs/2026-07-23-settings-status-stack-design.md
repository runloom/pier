# 设置页状态带（Settings Status Stack）终态设计

> 日期：2026-07-23  
> 状态：**待实现**  
> 范围：设置页及官方插件设置子页的常驻状态提示（Alert / banner）呈现与治理  
> 触发：插件设置同时出现「插件清单无法读取」与「本地开发加载」两条同级 warning 全宽条  
> 相关：AGENTS.md「设置页状态提示布局」「操作反馈规范」

## 1. 目标

消除「同区多个完整 Alert 外壳叠放」造成的噪声与误读，在**不糊掉语义**的前提下，用统一状态带呈现多条状态。

### 1.1 完成标准

- [ ] 存在可复用的 `SettingsStatusStack`（或等价命名）原语：一个外壳 + 多条 item
- [ ] 插件设置：诊断 + workspace（+ 可选 error）同时存在时，**仅一个**状态带外壳；workspace 为 info；多诊断为列表而非 N 个 Alert
- [ ] 通知设置：权限 + hooks 关闭可同带并存；hooks 关闭不为 warning
- [ ] 技能：项目详情 / 导入审阅不再出现 3+ 个完整 Alert 纵向堆叠
- [ ] 治理测试锁定：设置相关路径禁止「同父节点下并列多个完整 Alert」作为状态带实现
- [ ] 设置页 Alert/状态带仍在 `Card` / `CardContent` 内（既有治理不回退）
- [ ] 操作失败路径仍走 toast / `showAppAlert`，不塞进常驻状态带

### 1.2 边界

| 做 | 不做 |
| --- | --- |
| 常驻、页内、设置域状态提示 | AppDialog / toast / 命令失败弹窗体系重做 |
| 插件 + 通知 + 技能 + 可复用规范 | 工作区 empty/error 面板、panel 内业务空态 |
| 模式类降权（info） | 「全局只显示最高优先级一条并丢弃其余文案」 |
| 诊断多条共壳 | 把不同动作糊成一句无法行动的文案 |
| 官方插件设置子页对齐规范 | 第三方插件（当前不允许） |

---

## 2. 问题基线（审计摘要）

### 2.1 HIGH

| 表面 | 可叠内容 | 根因 |
| --- | --- | --- |
| 设置 → 插件 | diagnostics ×N warning + workspace warning + 可选 destructive | 父 `PluginDiagnosticsSummary` 与子 `ManagedPluginsSection` 各抛完整 Alert；`groups.map → <Alert>` |

### 2.2 MED

| 表面 | 可叠内容 |
| --- | --- |
| 通知 `PolicyCard` | 权限 banner + hooks 关闭 warning |
| 技能项目详情 | 导入成功 / 会话刷新 / git / 冻结错误 / degraded，最多约 5 条 |
| 技能导入审阅 | risk warning + 多个 destructive（conflict 与 reload 互斥） |

### 2.3 LOW / 可接受

- 应用更新单 error；技能 drift 单条；账号页 loadError 整页替换；Claude API key 单条模式提示
- 工作区主路径无同类常驻多 Alert 带

---

## 3. 原则（冻结）

| # | 原则 | 说明 |
| --- | --- | --- |
| P1 | 一区域一条状态带 | 同一 Card/Section 顶部不得并排多个完整 `Alert` 外壳 |
| P2 | 分语义、合外壳 | 故障 / 模式 / 可消提示以 **items** 并存，共享一个 stack |
| P3 | 权重排序 | item 顺序：`destructive` → `warning` → `info` → `default`；同权重保持稳定插入序 |
| P4 | 模式 ≠ 故障 | workspace、hooks 关闭、API key mode 等默认 **info**（或 default），禁止与诊断同级 warning 抢视线 |
| P5 | 多同类问题共壳 | N 条诊断 → **一条** warning item + 列表 body（默认）；禁止 N 个完整 Alert |
| P6 | 瞬时成功优先 toast | 导入成功等短反馈默认 `toast.success`，不占常驻带 |
| P7 | 设置 Card 内布局 | 状态带挂在 `Card`/`CardContent` 顶部；遵守既有「设置 Alert 不在 Card 外裸放」 |
| P8 | 操作失败不进常驻带 | 点击/提交失败 → toast 或 `showAppAlert`；与 AGENTS 操作反馈规范一致 |
| P9 | 单 item 不显重 | `items.length === 1` 时外观接近今日单条 Alert，避免空壳面板感 |

---

## 4. 共享契约

### 4.1 数据

```ts
type SettingsStatusTone = "destructive" | "warning" | "info" | "default";

type SettingsStatusItem = {
  id: string;
  tone: SettingsStatusTone;
  title: string;
  /** 短说明；与 body 同时存在时两者都可渲染（title 下先 description 再 body） */
  description?: string;
  /** 列表、多行结构、自定义节点；按钮区优先走 action */
  body?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  dismissible?: boolean;
  onDismiss?: () => void;
};
```

### 4.2 组件

```ts
function SettingsStatusStack(props: {
  items: readonly SettingsStatusItem[];
  className?: string;
  /** 测服用 */
  "data-testid"?: string;
}): JSX.Element | null;
```

行为：

- `items.length === 0` → `null`
- 渲染前按 P3 排序（调用方也可预排序；组件内再 sort 一次保证契约）
- **禁止**实现为 `items.map(item => <Alert …>)` 产生多个 `data-slot="alert"` 根
- 一个 stack 对应 **一个** 外层状态容器（可用现有 Alert 槽位语义扩展，或新 `data-slot="settings-status-stack"`）

### 4.3 视觉（推荐默认，实现可微调像素）

采用 **「中性/随最高 tone 的单壳 + 行级 StatusIcon」**（与先前推荐一致，不强制整壳高饱和铺满）：

- 外壳：圆角、边框、内边距与现有 Alert 同节奏；若存在任意 destructive item，外壳可跟 destructive 边框/浅底；否则若存在 warning 则跟 warning；否则 info/default
- 每一行：左侧共享 `StatusIcon`（与 toast/Alert 同套）+ 标题 + 说明/body + 可选 action / dismiss
- 行间：`gap` 或细分隔，**不再**每行一套独立描边卡片
- 密度：遵循设置页 `--card-spacing` / 12px 节奏；单行控件高度规范不因 stack 破坏

### 4.4 代码位置

| 层 | 建议路径 |
| --- | --- |
| 原语 | `packages/ui/src/status-stack.tsx`（优先，与 `alert`/`status-icon` 同层）或 `src/renderer/components/common/settings-status-stack.tsx`（若必须绑 dismiss i18n） |
| 插件组装 | `plugins-section.tsx` 唯一挂载；managed 子树只提供数据 |
| 诊断纯函数 | 保留 `groupPluginDiagnostics`；新增 `toPluginDiagnosticStatusItem(...)` 之类纯组装，便于单测 |
| 治理 | `tests/unit/renderer/settings-status-stack-governance.test.ts`（新）+ 扩展既有 settings alert 布局测若需要 |

### 4.5 与 `@pier/ui/alert` 关系

- 不删除 Alert；**单条、无同区兄弟** 的简单场景仍可用 Alert（P2 技能 drift 等）
- 一旦同区可能 ≥2 条常驻状态 → **必须** StatusStack
- 长期可让 Stack 内部复用 Alert 的 token/icon 映射，避免第二套颜色

---

## 5. 分页终态

### 5.1 插件设置（M1 / P0）

**目标结构**

```text
PluginsSection
  h1（Card 外）
  Card > CardContent
    SettingsStatusStack    ← 唯一常驻状态带
    ManagedPluginsSection  ← 不再自绘 workspace/catalog 顶栏 Alert
      Tabs + 列表…
```

**Item 组装（优先级高 → 低）**

| id 建议 | 条件 | tone | 内容 |
| --- | --- | --- | --- |
| `plugins-error` | `toggleError ?? storeError` | destructive | title=errorTitle；description=message |
| `plugins-catalog-error` | managed catalog 加载失败 | destructive | 若与上一条同时存在：**合并为一条** destructive，body 两行，避免双红 |
| `plugins-diagnostics` | diagnostics 或 runtimeDiagnostics 非空 | warning | 见下 |
| `plugins-workspace` | `pluginMode === "workspace"` | **info** | 现有 workspaceTitle / workspaceBody |

**诊断 item 规则**

- `groupPluginDiagnostics` 结果：
  - 0 组：不输出 item
  - 1 组：title = kindLabel；description = detail（可空）
  - ≥2 组：title = 汇总文案（新 i18n，如「插件存在问题」/ `Plugin issues`）；body = 无序列表，每项 `kindLabel` + 可选 detail
- **禁止** `groups.map → Alert`

**数据流**

- `ManagedPluginsSection` 通过 props 上报：`pluginMode`、`catalogError`、`officialMutationsAllowed` 等，或由父级直接读 catalog hook 上提
- 子组件删除顶栏 workspace Alert 与（若存在）与父重复的 error Alert 渲染

### 5.2 通知设置（M2）

`PolicyCard` 顶部：

| 条件 | tone | 备注 |
| --- | --- | --- |
| 权限 unsupported / denied | warning | 保持强提示 |
| 权限 unknown | info | 已有 |
| `!agentStatusHooks` | **info**（从 warning 降级） | 配置/模式说明 |

`PermissionBanner` 三态仍互斥；与 hooks 可同带两行。  
DiagnosticsCard（测通知按钮区）不塞第二套全宽状态带。

### 5.3 技能 · 项目详情（M2）

单一 stack，items：

| 来源 | tone | 备注 |
| --- | --- | --- |
| reload / frozen / error（现 `SkillsDetailBanner`） | destructive 或 warning（随现 variant） | 保留 action |
| `lastApplyOutcome === "degraded"` | warning | 保留重试 |
| `riskyGitStates.length > 0` | warning 或 info | body 列表 + 复制 gitignore action |
| `sessionRefreshHint` | info | dismissible |
| `recentImportNotice` | **默认不进 stack** | 改为 `toast.success`；去掉常驻成功条 |

### 5.4 技能 · 导入审阅（M2）

| 来源 | tone | 备注 |
| --- | --- | --- |
| hasRisk | warning | |
| conflict | destructive | 与 reload 互斥 |
| reloadRequired && !conflict | destructive | |
| actionBlocked | destructive | |
| expired | destructive | |

全部进入同一 stack；conflict/reload 互斥逻辑保留。

### 5.5 技能 · 单 skill 详情 / 只读内容（M3）

- drift、content unavailable、truncated：允许继续单 Alert，或单 item stack
- 同卡新增第二条常驻状态时必须并入 stack

### 5.6 官方插件账号设置（M3）

- loadError 整页替换：保留
- API key mode 等：单条 → info 或 default；不得与错误同级双 warning 并排
- 新增模式类提示遵循 P4

### 5.7 明确非目标页

- App Update 单 error：可保持 Alert
- SSH/Codex/Grok 无叠条问题：规范对齐即可，无强制重构除非新增第二条

---

## 6. i18n

| 用途 | 说明 |
| --- | --- |
| 插件诊断汇总 title（≥2） | 新 key，中英；白话、非实现词 |
| workspace / hooks 等 | 复用现有 title/body，仅 tone 变更 |
| 导入成功 | 走现有或补充 toast key；删除对常驻条的依赖 |
| stack dismiss aria-label | 若 dismissible：「关闭」类通用 key |

禁止业务内联用户可见中英文串。

---

## 7. 治理与测试

### 7.1 Governance

新增（或扩展）单测，扫描例如：

- `src/renderer/pages/settings/**`
- 可选 `packages/plugin-*/src/renderer/**settings*`

规则草案：

1. 同一 TSX 文件中，若出现 ≥2 处独立 `<Alert` 且位于同一返回树的「状态区」——难静态判时，采用更硬规则：  
   - **禁止** `diagnostics.map` / `groups.map` 直接返回 `<Alert`  
   - **禁止** `ManagedPluginsSection` 渲染 workspace/catalog 顶栏 Alert（迁走后锁死）  
2. 允许：`SettingsStatusStack` 文件内部、测试、story  
3. 设置 Alert 仍须在 Card 内（既有 `settings-section-alert-layout-governance`）

### 7.2 组件 / 单测

- Stack：空 → null；排序；单 item；多 item 仅一个 stack 根；dismiss 回调
- 插件：workspace+诊断 → 一个 stack、含 info 与 warning；双 error 合并
- 通知：hooks tone 为 info
- 技能：项目详情不再 mount 多个 `data-slot="alert"` 根（改为 stack 测）

### 7.3 验收清单（产品）

- [ ] 复现图场景：仅一条状态带；上/内为诊断，workspace 为 info 样式
- [ ] 多诊断：一条 warning + 列表
- [ ] 通知：未授权 + hooks 关 → 单带两行
- [ ] 技能项目：导入成功用 toast；其余状态共带
- [ ] 无设置页 Card 外裸 Alert 回退

---

## 8. 迁移阶段

| 阶段 | 交付 | 依赖 |
| --- | --- | --- |
| **M0** | StatusStack 原语 + 单测 + governance 骨架 | 无 |
| **M1** | 插件页迁入（消除截图问题） | M0 |
| **M2** | 通知 + 技能项目详情 + 导入审阅 | M0 |
| **M3** | 技能其余 + 账号页对齐 + governance 收紧 | M1–M2 |

M1 可独立上线并关闭 HIGH 问题；M2/M3 不阻塞 M1。

---

## 9. 风险与取舍

| 风险 | 缓解 |
| --- | --- |
| Stack 视觉与旧 Alert 不一致 | 单 item 对齐 Alert；复用 StatusIcon/token |
| 文件体积（plugins-section） | item 组装抽纯函数/小 hook |
| 治理误伤合法多 Alert（不同 Card） | 按文件+禁止 map-Alert + 禁止 managed 顶栏，而非粗暴「一文件只能一个 Alert」 |
| 导入成功改 toast 有人想留条 | P6 冻结；需要时 dismissible info，不默认 |

### 否决

- 仅改 workspace 文案颜色、不抽 stack（技能/通知仍会叠）
- 全站只显示最高优先级一条并隐藏诊断细节
- 诊断与 workspace 合并成一句混合文案

---

## 10. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 架构 | 共享 StatusStack | 根治叠壳，可治理 |
| 多诊断 | 一条 item + 列表 | 业界 Problems 汇总；降噪声 |
| workspace / hooks | info | 模式 ≠ 故障 |
| 导入成功 | toast | 瞬时反馈规范 |
| 视觉 | 单壳 + 行级 icon；外壳可随最高 tone | 平衡识别与降噪 |
| 范围 | 插件+通知+技能+规范 | 用户选定全量终态 |
| 实现分期 | M0→M3 | P0 先关截图问题 |

---

## 11. 下一步

1. 本 spec 确认后 → `docs/archive/superpowers/plans/2026-07-23-settings-status-stack.md` 按 M0–M3 拆任务  
2. 先实现 M0+M1，验证插件复现场景后再铺 M2/M3  
