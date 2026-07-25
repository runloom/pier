# Agent Assets 下一步：Pier Home · Skills · MCP（规则 defer）

日期：2026-07-23（2026-07-24 修订：规则 defer → Skills/MCP IA → **审查收敛 v5**）  
状态：**方案已收敛（可开工）** — 产品面只保留 **Skills + MCP**；规则整段 defer。  
范围：本机工作台、Pier 技能库 + 项目绑定、智能体全局只读发现、MCP 打开配置。不含 Live Modules / pier.canvas 实现；不含规则 UI；**不含默认写 `~/` 发现根**。

相关：

- 现行原型：[本机/项目 IA v5](../../../../.cursor/projects/Users-xyz-cursor-worktrees-pier-8bx3/canvases/pier-home-binding-proto-flows.canvas.tsx)
- Skills 现行规格：[`2026-07-14-project-skills-management-design.md`](./2026-07-14-project-skills-management-design.md)（v9.0；**维持默认不写 `~/`**）
- 远端控制 MCP：[`2026-06-24-remote-control-mcp-architecture-design.md`](./2026-06-24-remote-control-mcp-architecture-design.md)

## 0. 方案收敛（2026-07-24 v5 · 审查推荐已采纳）

多路审查结论：**主结构 Good enough（非金标准）**；采纳下列收紧后再实现。

### 0.1 产品范围

| 决定 | 说明 |
|---|---|
| 规则 | **整段 defer**（不渲染规则 Tab） |
| 主资产 | **Skills**；辅 **MCP**（发现 + 打开配置） |
| 本机工作台 Tabs | **技能 · MCP**（无环境 / 常规） |
| 仓库项目 Tabs | **环境 · 技能 · MCP · 常规** |

### 0.2 本机工作台（两段 · 轻分组 + badge）

| 段 | 内容 | 技能动作 | MCP 动作 |
|---|---|---|---|
| **各智能体全局** | `~/…` 发现根枚举（Claude / Codex / Cursor…） | **只读**：打开 / 在 Finder 显示；**不**编辑、**不**删除（维持 Skills v9） | 打开配置文件 |
| **Pier 持有** | `{userData}/pier-home/skills/library`（及可选 mcp） | 新建 / 编辑 / **删除库中的技能**（有项目绑定时确认级联卸投影） | 打开配置；可删 Pier 私有文件 |

副文案必须区分：「各智能体自己的全局配置」vs「Pier 持有的库（可装入项目）」。

可选：智能体全局行提供「**采纳到 Pier 库**」（复制进 pier-home），之后按 Pier 持有管理。

### 0.3 项目 · 技能（三来源 · 分组 + badge）

轻量分组标题 + 行内来源 badge（**仅三来源**）：

| 分组 | Badge | 动作 |
|---|---|---|
| 项目自有 | `项目` | 编辑；**删除项目技能** |
| 智能体全局 | `智能体全局` | 只读展示（不在此打开 / 改删；要看内容去本机工作台） |
| Pier 装入 | `Pier` | **添加**（从本机库）/ **从本项目移除**（只卸投影，不删库、不影响其它项目） |

**始终包含** = Pier 行上的 **锁定态**（锁标或 muted「始终包含」），**不是**第四个来源 badge。默认已装，无添加/移除。

顶栏「添加」拆成两项：

1. 新建项目技能  
2. 从本机库添加（仅非始终包含、未绑定项）

### 0.4 项目 · MCP

项目配置 + 用户全局发现；一律 **打开配置**。Pier→项目 MCP 绑定 **后置**。

### 0.5 写 `~/` 策略（ADR）

| 选项 | 本版选择 |
|---|---|
| A. 智能体全局只读 + 打开/Reveal | **采纳（默认）** — 与 Skills v9 / adapters「Never written by Pier」一致 |
| B. Home 可编删 `~/` | **不做**；若未来要做，须独立 `userGlobalSkills.*` + 白名单根 + 强确认，不得走通用 file API |

### 0.6 破坏性文案（爆炸半径）

| 场景 | 文案 |
|---|---|
| 项目 · Pier 绑定 | **从本项目移除**（禁止「删除」） |
| 项目 · 自有 | **删除项目技能** |
| Home · Pier 库 | **删除库中的技能**（说明将卸各项目投影） |
| Home · 智能体全局 | 无删除；仅打开 / 采纳到 Pier 库 |

### 0.7 实现顺序

1. Pier 技能库（Domain B）+ 项目 `pierBindings` 账本 + 复用 plan/apply 投影  
2. 项目 Skills 三来源 UI（分组 + badge + 锁定态）  
3. Home：智能体全局 RO 列表 + Pier 库 CRUD  
4. MCP 保持 catalog + 打开配置  
5. （可选后续）`~/` 写入 API — 非本版

### 0.8 原型

[本机/项目 IA v5](../../../../.cursor/projects/Users-xyz-cursor-worktrees-pier-8bx3/canvases/pier-home-binding-proto-flows.canvas.tsx)

多会话 / Canvas 挂 Skills；不依赖规则管理。

## 1. 背景与目标

### 1.1 问题

1. **Skills 已基本落地**，跨项目仍缺 Pier 私有本机库；用户还需看见各家 MCP 配置。
2. **没有本机级锚点**：跨项目 skill / 画布草稿无处安放；规格又禁止默认写用户全局发现目录（`~/.agents` 等）。
3. **Canvas / Live Modules / 多会话** 将以 Skills 为可调用单元，规则产品会干扰主线。

### 1.2 一句话定位

宿主 **Pier Home**（`{userData}/pier-home`）+ **AssetScope（`project` | `home`）**；当前交付重心为 **Pier 技能库 + 项目绑定** 与 **MCP 发现**。智能体全局 `~/` **只读**。规则不进本切片交付。

### 1.3 完成标准（修订）

| 闭环 | 通过标准 |
|---|---|
| H1 Home 可寻址 | Home 在项目列表；Tabs = 技能 · MCP |
| H2 Scope | `home` 无客户端 path；项目拒 pier-home 冒充 |
| S1 项目 Skills 三来源 | 分组+badge；Pier **从本项目移除** ≠ 删库；始终包含为锁定态 |
| S2 Pier 技能库 | `pier-home/skills/library` + `pierBindings`；复用 plan/apply 投影 |
| S3 智能体全局 | Home 可发现并只读打开/Reveal；项目仅只读展示（不在此打开） |
| M1 MCP | catalog + 打开配置；不写 agent 配置 |
| X1 门禁 | pier-home **不得**进 known-roots；仅 library 路径可写 |
| ~~I1/I2 Rules~~ | defer |
| ~~写 ~/~~ | **本版不做** |

### 1.4 非目标（本切片）

- 规则管理产品面
- **默认写入** `~/.agents` / `~/.claude` / `~/.cursor` 等用户发现根（与 v9 一致；采纳到 Pier 库除外）
- MCP 统一编辑器、密钥托管、marketplace、Pier→项目 MCP 绑定
- Pier-as-MCP 远端控制面
- Live Modules / pier.canvas 实现（仅约束多 root + 双 scope）
- 将 pier-home 整根当作 skills 项目根做 plan/apply

## 2. 决策表

| 决策点 | 选择 | 理由 |
|---|---|---|
| 全局锚点形态 | `{userData}/pier-home` 固定目录 | 可控、可迁移、不碰 `~/`；与 skills 非目标兼容 |
| 是否进 local-environments 项目列表 | **是，标记 `kind: "pier-home"`** | 复用「当前项目」选择 UX；禁止走 setup/cleanup/copyPatterns |
| Scope 传递 | 显式 `AssetScope` 枚举，不用「空 path = 全局」 | 避免与 panel cwd 歧义 |
| Home 与真实项目关系 | Home **不是** Git 项目；`projectRootPath` 协议上允许指向 Home 绝对路径 | panel-context 已用路径锚点，少造第二套 ID |
| 规则引擎 | **新模块** `agent-rules`（产品名：**规则** / Rules） | 单文件编辑 ≠ skills 投影矩阵 |
| 规则文件落点 | **作用域根目录**（project = 仓库根；home = `pier-home/` 根） | Home 可作 agent cwd；智能体在 cwd 根发现 AGENTS.md 等，**禁止**再套 `rules/` 子目录 |
| MCP v1 | 只读路径编目 + Reveal + 系统打开；**含用户级路径（只读）** | 对齐「优先原生 MCP」；展示不等于可写 |
| Canvas 存放 | 项目默认 `.pier/canvases`；跨项目 → `pier-home/canvases` | 双作用域；本切片只建目录约定 |
| Skills 进 Home | 本切片 **不 mkdir、不投影**；仅类型层可预留 `AssetScope` | 避免 Home 进入 skills known-roots |
| `.cursor/rules` v0 | 文件可读写；目录只读+Finder；**missing 不 ensure** | 钉死；不留给实现临时决定 |
| UI IA | 列表 → 详情 + 返回 → line tabs（禁止左右常驻分栏） | 对齐现网「设置 → 项目」 |
| Tab 顺序 | `环境` → `规则` → `技能` → `MCP` → `常规` | 业界：Rules 在 Skills 前；常规始终最后 |

## 3. 架构

```text
                    ┌─────────────────────────────────────┐
                    │         Agent Assets（产品伞）         │
                    │   Skills │ 规则 │ MCP │ Pier Home     │
                    └───────────────┬─────────────────────┘
                                    │ AssetScope
                         ┌──────────┴──────────┐
                         ▼                     ▼
              scope=project                 scope=home
         <gitRoot|cwd>/                 {userData}/pier-home/
           AGENTS.md …                    AGENTS.md …
           .pier/skills …                 canvases/（预留）
           .pier/canvases …               .pier/home.json
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                         panel-context.projectRootPath
                         （Home 时 = pier-home 绝对路径）
```

### 3.1 目录布局（Pier Home）

```text
{userData}/pier-home/
  README.md                 # 短说明（生成；用户可改）
  AGENTS.md                 # 可选；与智能体 cwd 发现一致，落在 Home 根
  CLAUDE.md / GEMINI.md …   # 同上，按需创建
  .cursor/rules             # 可选；文件可编辑，目录则 v0 只读+Finder
  canvases/                 # 预留；本切片只 mkdir
  .pier/
    home.json               # { version: 1, kind: "pier-home" }
```

禁止：

- 在 Home 下创建「投影到 ~/.agents」的 symlink 引擎（本切片）
- 本切片 **不** mkdir `skills/`（Skills 进 Home 另开规格）

### 3.2 模块边界

| 模块 | 路径（拟） | 职责 | 不可做 |
|---|---|---|---|
| `pier-home` | `src/main/services/pier-home/` | 确保根存在、路径解析、`kind` 识别 | 写用户 home 发现目录 |
| `agent-rules` | `src/main/services/agent-rules/` | 规则文件族映射、读/写、列表快照 | 调用 skills apply |
| `agent-mcp-catalog` | `src/main/services/agent-mcp-catalog/` | 各家 mcp 路径探测、打开 | 改写 mcp.json、存密钥 |
| 既有 `project-skills` | 不变 | 仅未来接受 `AssetScope` 参数 | 吞并 rules/mcp；**不得**把 pier-home 列入 known-roots |
| 既有 `local-environments` | 扩展索引条目 | 注册 Home 伪项目 | 对 Home 跑 setup / 当普通项目删除 |

### 3.3 核心类型（草案）

```ts
type AssetScope = "project" | "home";

/** home：禁止客户端传 path；由 main 从 userData 解析 */
type AssetRootRef =
  | { scope: "project"; projectRoot: ProjectRootRef } // 与 skills 写路径同级：稳定身份 + 再解析
  | { scope: "home" };

type PierHomeInfo = {
  kind: "pier-home";
  rootPath: string; // realpath
  createdAt: number;
};

type RuleFileView = {
  id: string;
  relativePath: string;
  state: "missing" | "file" | "directory" | "other";
  sizeBytes?: number;
  updatedAt?: number;
};
```

`scope: "home"` **禁止**客户端传入自定义 path，防止路径逃逸。  
`scope: "project"` 的 `rules.write` / `rules.ensure` **必须**携带与 skills 同级的 `ProjectRootRef`（或等价：再解析后校验属于已注册**且** `kind !== "pier-home"` 的项目 / 当前 panel 根）。  
**禁止**用 `scope: "project"` 指向 pier-home 根绕过 `scope: "home"`；Home 上的 `rules.*` **一律** `scope: "home"`。

### 3.4 与 local-environments 的接合

全局注册表 `local-environments.json` 扩展（向后兼容）：

```ts
// projects[] 条目
{ projectRootPath: string, kind?: "project" | "pier-home" }
// 缺省 kind = "project"
```

**索引 / wire / renderer**：`LocalEnvironmentProject` 与 snapshot / Zustand 必须透传 `kind`（缺省 `"project"`），否则「本机工作台」标题、徽标、门禁无法落地。

行为：

- 启动时 `ensurePierHome()` → **专用 upsert**（不得走普通 `addProject` 种子 `.pier/environment.json` + copyPatterns）将 Home `rootPath` 写入索引且 `kind: "pier-home"`。
- **环境读写短路**：`kind=pier-home` 时 `environment.snapshot` / update **不读不写** `.pier/environment.json`；**UI 不渲染「环境」Tab**（Pier「环境」= 工作树 setup/cleanup/copyPatterns，不是通用全局 env）。若未来要做真正的全局环境配置，再与项目详情同构交付，而不是空态占位。
- UI 列表展示名固定「本机工作台」/ EN **Pier Home**（不用 This Mac，避免与技能「On this Mac / 本机全局」撞车）；**禁止**用路径 basename 作主标题；徽标中文「本机」、EN **Home**（对照现网「当前」/ Current）。
- Home **置底**（用户项目优先）；「仅有 Home、无真实项目」时仍显示 Home，并保留空态提示引导添加项目（勿因 `length > 0` 吞掉空态）。
- **门禁（kind=pier-home → 拒绝）**：
  - `environment.update` / setup / cleanup
  - `environment.project.remove` 与 UI「移除此项目」
  - `addProject` 若目标 path 即 Home 根
  - `bindWorktree`（Home 不可作为工作树的 project 侧）
- **Home 详情 Tabs（钉死）**：只渲染 **`技能` · `MCP`**。**不渲染**「规则」「环境」「常规」。技能库引擎未完成前 Skills Tab 可为占位，不得挂假编辑器。
- **Skills known-roots**：`listKnownProjectRoots` 必须同时：
  1. 排除环境索引里 `kind: "pier-home"`；
  2. 排除 panel 最近根中 **realpath === pier-home 根** 的条目（panel 源无 kind，仅靠路径判定）。
- **`skills.projects.snapshot` 覆盖根**：若调用方传入 `projectRootPath`（设置页常用 active panel 根）会在 known-roots 过滤后 **prepend**——该覆盖路径也必须拒绝 pier-home（realpath 相等则丢弃或报错），否则 Home 仍会进入技能项目列表并拿到 `ProjectRootRef`。

### 3.5 Skills / 启动门禁（相对 pier-home）

仅靠 UI 隐藏不够。下列路径在目标根为 pier-home（或 `kind: "pier-home"`）时必须 **短路拒绝 / no-op**，并有单测：

| 路径 | 行为 |
|---|---|
| `skills.plan` / `skills.apply` / repair | 拒绝（明确错误码）；不得写出 `.pier/skills` / `.agents` |
| `skills.projects.snapshot` 的 `projectRootPath` 覆盖 | 若为 pier-home → 丢弃覆盖或拒绝（不得 prepend 进列表） |
| `ManagedAgentLaunchGate` / `ensureReady` | 对 pier-home cwd：**跳过** `systemSkills.reconcile` 及任何向该根发布 skills 的步骤 |
| `systemSkills.reconcile` | 若 `projectRoot` 为 pier-home → no-op |

X1 通过标准含上述门禁，不只 UI。

### 3.6 命令面（拟）

| 命令 | PierCapability | 说明 |
|---|---|---|
| `pierHome.info` | `app:read` | 返回 rootPath / 是否就绪 |
| `pierHome.reveal` | `file:read` | Finder 显示 Home 根 |
| `rules.snapshot` | `file:read` | 入参含 `AssetRootRef`；`{ scope, files: RuleFileView[] }` |
| `rules.read` | `file:read` | 读单文件正文（大小上限） |
| `rules.write` | `file:write` | 原子写；仅映射表白名单相对路径 |
| `rules.ensure` | `file:write` | 缺失时按模板创建（先 `showAppConfirm`）；**不含** `cursor-rules`（见 §4.1） |
| `agentMcp.catalog` | `file:read` | 入参含 **`AssetRootRef`**（与 rules 对称）；见 §5.2 行集合；拒 pier-home 冒充 project |
| `agentMcp.reveal` | `file:read` | Finder 显示 |
| `agentMcp.open` | `file:read` | 用系统默认应用打开路径 |

全部进 `COMMAND_METADATA` + `allowedClientKinds: desktop-renderer`（CLI 只读可后续加）。

## 4. Rules（规则）v0 设计

### 4.1 文件族映射（L1）

相对路径均相对 **scope 根**（project = 仓库根；home = `pier-home/` 根）：

| id | 相对路径 | 智能体语义 | v0 行为 |
|---|---|---|---|
| `agents-md` | `AGENTS.md` | 通用 / Codex / 多工具 | 缺失可 ensure；文件可读写 |
| `claude-md` | `CLAUDE.md` | Claude Code | 同上 |
| `gemini-md` | `GEMINI.md` | Gemini CLI | 同上 |
| `cursor-rules` | `.cursor/rules` | Cursor Rules | **文件** → 可读写；**目录** → 只读 + Finder；**missing 不提供 ensure**（由用户在 Cursor/Finder 创建） |

### 4.2 写路径安全

- 只允许映射表白名单相对路径；`..`、绝对路径、symlink 逃出根 → 拒绝。
- 单文件上限（建议 512 KiB）；超限只读提示，拒写。
- 原子写：`write-file-atomic`；写前 `lstat` 拒绝替换非普通文件。
- 不提供「同步改所有智能体文件」；用户显式保存当前打开的那一个。
- `rules.ensure`：调用前 `showAppConfirm({ intent: "default", size: "sm", … })`（host 必填 `intent`/`size`）；取消则不写。

### 4.3 UI

- **交互对齐现有「设置 → 项目」**：整页项目列表 → 点进详情（左上返回）→ 详情内 `TabsList variant="line"`。**不要**做成左侧常驻项目列表 + 右侧内容的分栏。
- 详情 Tabs（真实项目）：`环境` → `技能` → `MCP` → `常规`（**无规则**）。
- 详情 Tabs（本机工作台）：`技能` → `MCP`（见 §3.4 / §0）。
- 命名：**规则** = Cursor / 业界 **Rules**（亦覆盖 Codex *Custom instructions* / Claude *Project instructions* 所管理的文件）。**不要**使用「说明文件」等自造叫法。
- 列表行：basename 标题、等宽路径副标题、右侧摘要 + chevron；本机工作台置顶，徽标「本机」/「当前」。
- 规则 Tab：左文件族 / 右编辑器；**保存**在 tabs 行右侧；副文案区分常驻规则 vs 按需技能。
- MCP Tab：只读表 +「在 Finder 中显示」+「用外部编辑器打开」；范围标签见 §5.2。
- 原型：[Agent Assets 原型](../../../../.cursor/projects/Users-xyz-cursor-worktrees-pier-8bx3/canvases/pier-agent-assets-prototypes.canvas.tsx)
- 文案走 i18n；失败 `showAppAlert`；成功靠 dirty 清除（不强加 toast）。

### 4.4 文案锚点（中英同步）

| 位置 | 中文 | English |
|---|---|---|
| 新 Tab | 规则 | Rules |
| 既有 Tab | 技能 · 环境 · 常规 · MCP | Skills · Environment · General · MCP |
| 列表/详情标题 | 本机工作台 | Pier Home |
| 徽标 | 本机 / 当前 | Home / Current |
| 项目 section 说明 | 按项目配置环境、规则、技能与 MCP。也可用本机工作台管理跨项目内容。 | Configure environment, rules, skills, and MCP per project. Use Pier Home for cross-project content. |
| 规则 Tab 提示 | 规则会在新开的智能体会话里自动生效。按需流程请放到「技能」。 | Rules apply automatically in new agent sessions. Put on-demand workflows in Skills. |
| MCP 提示 | Pier 不会改这些文件 | Pier won’t edit these files |
| MCP 范围·项目 | 项目内 | In project |
| MCP 范围·用户配置 | 用户配置 | User config |
| ensure 确认 | 创建此规则文件？ | Create this rules file? |

禁止在前台主路径使用「上下文」「说明文件」「Instructions」作产品名。  
EN「Pier Home / Home」与技能层「On this Mac / 本机全局」分层，禁止把工作台也译成 This Mac。

## 5. MCP 发现 v1 设计

### 5.1 与「Pier-as-MCP」切割

| | 本切片 agentMcp | 远端控制 MCP 规格 |
|---|---|---|
| 对象 | 各 coding agent 的 mcp 配置文件 | Pier 自己暴露 MCP server |
| 动作 | 发现路径、Reveal、系统打开 | 工具调用 Pier 命令 |
| 设置入口 | 项目资产 Tabs | CLI / 未来 Remote |

### 5.2 编目与 scope（已拍板）

| AgentKind | 候选路径（示例，实现前再核验官方 docs） |
|---|---|
| cursor | `<project>/.cursor/mcp.json`；`~/.cursor/mcp.json` |
| claude | `<project>/.mcp.json`；Claude 用户配置路径（只列官方文档路径） |
| codex | 官方 docs 记载路径 |
| … | 无官方依据则 `unsupported`，不猜 |

**`agentMcp.catalog` 行集合**（入参 `AssetRootRef`，与 `rules.*` 对称；pier-home 冒充 `scope: "project"` → 拒绝）：

| AssetRootRef | 返回行 |
|---|---|
| `{ scope: "project", projectRoot }` | 该 `ProjectRootRef` 解析根下的项目级路径 + 用户配置路径（只读） |
| `{ scope: "home" }` | **仅**用户配置路径（只读）；无「项目内」行 |

- 用户配置路径：**永不由 Pier 写入**；UI 范围列用「用户配置」/ User config（不用「本机」，避免与工作台徽标撞车）。
- UI：智能体 × 路径 × `present|missing|unsupported`；操作「在 Finder 中显示」/「用外部编辑器打开」。

### 5.3 安全

- `agentMcp.catalog` **不返回文件内容**。
- `reveal` / `open` 只传 main 已解析的绝对路径；打开前再次 `realpath` 校验仍落在白名单根（项目根或已知用户配置父目录）。

## 6. 对后续 Canvas / Live Modules 的接口约束（本切片锁定）

1. Live Modules `registerRoot` **必须**支持多个 root；至少：
   - `project:.pier/canvases`
   - `home:pier-home/canvases`
2. Canvas 创建对话框：**默认当前项目**；可选「保存到本机工作台」（不用未锁定的「本机画布」产品名）。
3. 本切片负责 `mkdir` Home `canvases/`，不实现编译与 Viewer。

## 7. 分期实施计划

### Phase 0 — 规格确认（0.5d）

- [x] Home 展示名：本机工作台 / Pier Home（§4.4）
- [x] 规则文件族 L1（§4.1）与 `.cursor/rules` 目录行为
- [x] MCP 含用户级只读路径（§5.2）
- [x] 实现前再核验 MCP 路径表官方 docs 初值

### Phase 1 — Pier Home + Scope（2–3d）

- [x] `pier-home` ensure + `home.json`（专用 upsert，不 seed env）
- [x] local-environments 索引 + wire + UI `kind`
- [x] 门禁：update/setup/cleanup/remove/add(Home)/bindWorktree
- [x] env snapshot 对 Home 短路空态
- [x] Skills：known-roots（索引+panel 路径）排除；plan/apply/ensureReady 门禁
- [x] Home 详情隐藏技能/常规；规则/MCP Tab 已接入（见 Phase 2/3）
- [x] 设置/项目列表「本机工作台」置顶 + 徽标
- [x] 单测：ensure、kind 门禁、upsert 不 seed

### Phase 2 — Rules（规则）v0（3–4d）

- [x] 映射表 + snapshot/read/write/ensure（project 带 ProjectRootRef；拒绝 pier-home 冒充 project）
- [x] 设置 UI：列表 + 编辑 + 保存；目录态 Finder；cursor-rules 无 ensure
- [x] i18n + `showAppConfirm` / `showAppAlert` 治理
- [x] 组件/单测：白名单、大小上限、原子写

### Phase 3 — MCP catalog v1（2d）

- [x] 注册表 + catalog(scope)/reveal/open
- [x] 设置 UI 只读表（project：项目内+用户配置；home：仅用户配置）
- [x] 核验 3–4 个主智能体官方路径

### Phase 4 — 收尾与衔接（1d）

- [x] Home 下 `canvases/` 预留
- [x] 更新 Agent Assets DAG 状态节点
- [x] CHANGELOG；可选补 Skills scope 参数设计附录（不实现）

**合计约 1.5–2 周（单人）**，可与 Skills S6 facade 小 PR 并行。

## 7.5 Domain B 终态：Pier Bindings 收敛（2026-07-25）

钉死产品心智：**Home 是跨项目库；装入项目 = 发布快照 + 受管投影**（复制进
`.pier/skills/library/<id>`，再 symlink 到发现根）。不做 live symlink 指向
`pier-home`；不把 pier-bound 写入 Git `manifest.json`。

### 双意图源 · 单收敛引擎

| 意图源 | 落点 | 提交 |
|---|---|---|
| 用户项目技能 | `manifest.json` | `skills.plan` / `skills.apply` |
| Pier 装入 | `catalog.json` alwaysInclude + `pier-bindings.json` | `convergePierBindings` → `ensureReady` |

投影卸装一律走既有 repair desired-targets / ownership teardown。

### Ledger schema v2

`{userData}/project-skills/<rootKey>/pier-bindings.json`：

```json
{
  "schemaVersion": 2,
  "generation": 1,
  "bindings": [{ "skillId": "review-guide", "delivery": { "agents": true, "claude": false } }],
  "publishedContentDigestsBySkillId": {}
}
```

v1 `boundSkillIds` 读入时迁移为 bindings（默认 agents-only）。始终包含的
delivery 来自 catalog；手动绑定用 per-bind delivery。

### desired 合并

`desired = alwaysInclude(∩ library) ∪ manualBindings(∩ library − always)`；
always 覆盖同 id 手动绑定且不可 unbind。

### 突变 → fan-out

| 动作 | converge scope |
|---|---|
| `skills.pierBindings.bind/unbind` | 当前项目 |
| `pierHome.skills.setAlwaysInclude` | 全部 known project roots |
| `pierHome.skills.write` | desired 含该 skillId 的项目 |
| `pierHome.skills.delete` | `unbindEverywhere` → skill scope converge → 再删库文件 |

删除库副本：仅当 digest ∈ Pier 已发布集合且不在 manifest / system / desired。

### 完成标准

- 删库后各项目无残留受管 symlink / Pier 发布副本
- 改 alwaysInclude / delivery 后 known projects 投影与 desired 一致
- 手动 bind 可选 Claude；Home 编辑后已装入项目副本经 converge 刷新
- 项目视图 pier-bound 行 `source.type = "pier-home"`（仅 view）

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 用户以为 Home = 写进 Claude 全局 skills | UI 文案明确「本机工作台 / Pier Home」；不提供「同步到 ~/.claude」按钮 |
| Home 被当成 Git 项目跑 setup / 被删除 | `kind` 全部门禁（含 remove）+ 专用 upsert |
| Home 误入 skills / 启动时 reconcile 写盘 | known-roots 双源过滤 + plan/apply/ensureReady/reconcile 门禁（§3.5） |
| 规则与仓库已有 AGENTS.md 冲突 | 默认打开已有文件；ensure 仅 missing 时创建 |
| MCP 路径因版本漂移失效 | 注册表带 `verifiedOn` + `officialDocsUrl`；探测失败标 unsupported |
| Scope 泄漏到任意路径 | `home` 无客户端 path；project 走 ProjectRootRef 且拒 pier-home |
| 「本机」与技能「本机全局」/ EN This Mac 混淆 | 工作台 EN=Pier Home；徽标 EN=Home；MCP 范围用「用户配置」；技能层保持「本机全局 / On this Mac」 |

## 9. 开放问题

（交叉审查后已关闭原 Q1–Q3；留下实现前核验项）

1. ~~Home Skills 内容库~~ → **本切片不做**；另开规格。
2. ~~`.cursor/rules` 目录形态~~ → **已钉死**见 §4.1。
3. ~~MCP 是否展示用户级路径~~ → **v1 只读展示**见 §5.2。
4. （实现前）各 AgentKind MCP 官方路径初值文档 URL 清单。

---

**建议确认顺序：** 复核 §2 决策表（含规则落点 = 作用域根）→ 开 Phase 1 实现。
