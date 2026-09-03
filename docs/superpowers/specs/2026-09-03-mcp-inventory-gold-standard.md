# MCP 跨智能体清单金标准

日期：2026-09-03  
状态：现行权威（设置 → 项目 / 本机工作台 → MCP）  
范围：跨智能体只读清单的信息架构、契约、解析与设置页。  
不包含：MCP 运行时（启停、握手、工具列表）、跨客户端写入、市场、OAuth、密钥托管、Grok 插件目录、配置热监听。

权威实现：`src/main/services/agent-mcp-catalog/` + `src/renderer/pages/settings/components/project/mcp-*.tsx`。  
检查点：`tests/unit/renderer/settings/mcp-inventory-governance.test.ts`、`tests/unit/main/agents/agent-mcp-catalog-parse.test.ts`、`tests/unit/main/agents/agent-mcp-catalog-service.test.ts`、`tests/unit/renderer/settings/mcp-panel.test.tsx`、`tests/unit/plugins/file-panel-breadcrumb-reveal.test.ts`。

相关：项目记忆写入面仍以 [`2026-08-27-project-memory-global-registration-v3-design.md`](./2026-08-27-project-memory-global-registration-v3-design.md) 为准；本面只**识别** `pier-memory`，不改注册器。

---

## 一句话终态

列出各智能体配置里有哪些 MCP 服务器、从哪来、谁能用、已装智能体里谁还没有。Pier **不改这些文件，也不启动这些服务器。**

---

## 原则

1. **清单，不是控制台。** Pier 不是 MCP 客户端。禁止 spawn、启停、`tools/list`、连接绿点、把文件存在当成「已连接」。
2. **所有权决定动作。** 用户/项目配置 → 打开文件；Pier 托管 → 仓库项目打开「项目记忆」Tab；本机工作台没有该 Tab，只打开配置。
3. **名字不是进程。** 按服务器名聚合（跨智能体价值）；详情必须拆到具体配置文件。同名在两家配置里可以是两套传输。
4. **无密钥。** catalog 快照只含名字、范围、传输枚举、开关、路径。禁止 `command` / `args` / `env` / `url` / `headers` 原文。
5. **谁能用必须可读。** 智能体识别 = 图标 + 名称。禁止只丢图标。Grok 的 X 徽标不得单独出现，否则会被读成失败。
6. **缺口是本面独特价值。** 已装且吃 MCP、但配置里没有这个名字的智能体，必须看见。不吃 MCP 的产品不进缺口。
7. **原生入口，不包第二套 API。** 添加/开关/授权走各家 CLI 或设置。空态只说明下一步，不做添加表单。

去掉 Pier 后用户仍能用 `claude mcp add` / `grok mcp add` / Cursor Settings 完成的动作，本面不做。

---

## 分组

空组不渲染。顺序固定：

| 组 | 条件 |
|----|------|
| Pier 托管 | 服务器名 = `PIER_MANAGED_MCP_SERVER_NAME`（`pier-memory`） |
| 项目内 | 非托管，且至少一条 listing 的 `scopeLabel` 为 `project` |
| 用户配置 | 其余 |

同名既在项目又在用户配置 → 归「项目内」；用户来源仍出现在「配置来源」菜单，并带范围徽章。

---

## 行模型

| 槽 | 规则 |
|----|------|
| 标题 | 等宽服务器名。Pier 托管主标题用产品词「项目记忆」，等宽副名 `pier-memory` |
| 徽章 | 范围；传输（本地进程 / 远程；`unknown` 不展示）；`enabled=false` 为「已关闭」。多来源不一致时传输/开关为「混合」，按来源菜单拆开 |
| 谁能用 | 已装且声明了的智能体：图标 + 名称。全未装则「智能体暂不可用」 |
| 来源路径 | 等宽显示配置文件路径（用户级为家目录绝对路径）。禁止只给「打开配置文件」却不告诉人打开的是哪份 |
| 缺口 | 「未接入 {{智能体列表}}」。无缺口不写 |
| 主按钮 | 见下 |

打开配置走 Pier 文件面板。项目内配置用 `openUnderRootInPierEditor(projectRootPath, displayPath)`，挂在当前仓库树上。用户级配置（家目录、工作区外）才用绝对路径打开：横幅标明真实目录、面包屑用该文件的 root + 路径、编辑器要有正文。禁止把 `.cursor/mcp.json` 拆成「父目录当 root」从而冒充工作区外文档。

### 主按钮

| 行 | 主操作 |
|----|--------|
| Pier 托管 + 仓库项目 + 已登记 `pier.memory.project` | 打开项目记忆（`setProjectsTab("pier.memory.project")`）。宿主不 import 记忆插件包 |
| Pier 托管 + 本机工作台 | 打开配置文件 |
| 单来源非托管 | 打开配置文件 |
| 多来源非托管 | 「配置来源」菜单：智能体名 + 范围徽章 + 路径 |

筛选：列表里出现 ≥2 个不同「能用」智能体时，顶上 `ToggleGroup`：全部 + 各智能体。筛的是谁能用，不是藏组。

---

## 契约

`McpServerListing`：`transport: stdio \| http \| unknown`，`enabled: boolean`（缺省 true）。  
`McpServerView`：`ownership`、`transport`（可 `mixed`）、`enabled`（`on \| off \| mixed`）、`gaps: { agentKind }[]`。

解析：

- 非空 `url` / `uri`，或 `type` 为 `remote` / `http` / `sse` / `streamable_http` → `http`
- `command` / `cmd`，或 `type` 为 `local` / `stdio` → `stdio`
- `enabled === false` 或 `disabled === true` → 关闭
- Goose：跳过 `builtin` / `platform`；只收 stdio 与 streamable HTTP
- Codex/Grok TOML 优先结构化解析；失败则仅有名字，`transport=unknown`

缺口 = 已装 ∩ `consumesMcp` − 本服务器 listings 的 `agentId`。交叉复用路径（如 OMP 读 `.cursor/mcp.json`）沿用 `consumersForPath`：声明了就算能用。

---

## 非目标

- 宿主拉起 MCP、工具数、日志、OAuth
- 统一写入各家配置、市场、添加表单
- 扫描插件 `.mcp.json`
- 配置热监听（下次打开设置再刷新）
- 改 Skills 的图标条；MCP 用自己的带名称条

---

## 文案

中文：智能体、项目内、用户配置、Pier 托管、本地进程、远程、已关闭、未接入、打开项目记忆、打开配置文件、配置来源。禁止 stdio / SSE / 选区 / 上下文进主路径。页眉必须写清「不改文件、不启动服务器」。
