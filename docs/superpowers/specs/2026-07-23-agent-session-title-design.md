# Agent 会话标题（sessionTitle）产品设计

> 日期：2026-07-23  
> 状态：**P0/P1/P2 已实现**  
> 实施计划：[../plans/2026-07-23-agent-session-title.md](../plans/2026-07-23-agent-session-title.md)  
> 前置：[`2026-07-15-agent-runtime-index-and-attention-design.md`](./2026-07-15-agent-runtime-index-and-attention-design.md)（Index 主标题用 catalog，故意不读 OSC）  
> 范围：Agent 面板 / Index / title bar / 关闭摘要 / activity 物料的**产品主标题**；不含普通 shell 终端 OSC 行为变更

## 1. 目标与完成标准

### 1.1 一句话定位

为 Agent 会话引入一等公民 **`sessionTitle`**（产品名），与 **`terminalTitle`（OSC 0/2）** 彻底分离。全 UI 只通过单一 resolver 读产品名；OSC 降级为终端元数据。

### 1.2 要解决的问题

1. 当前把 OSC 当会话名 → cwd / 长首条消息 / 品牌名混用，体验不友好且跨表面不一致。  
2. Index 已纪律性不用 OSC，tab / title bar 仍吃 OSC → 同一 agent 多处文案分裂。  
3. 缺少手改优先、只命名一次、失败留占位等业界金标准约束。

### 1.3 金标准（冻结）

| # | 原则 | 冻结语义 |
| --- | --- | --- |
| G1 | 字段分离 | `sessionTitle` ≠ `terminalTitle`（OSC） |
| G2 | 占位 → 一次命名 | 启动用 placeholder；首条后最多自动写一次（P1） |
| G3 | 专用生成 | 规则或轻量模型；禁止依赖主 agent 自觉 `/rename` |
| G4 | 手改优先 | `source: "user"` 永不被 auto 覆盖 |
| G5 | 失败安全 | 生成失败留 placeholder；禁止回退成长 OSC / cwd 全文 |
| G6 | UI 单源 | tab / Index / title bar / 通知摘要 / activity 物料同一 resolver |

### 1.4 完成标准（按阶段）

| 闭环 | 阶段 | 通过标准 |
| --- | --- | --- |
| T0 | **P0** | Agent 主标题不再来自 OSC；全调用点走 `resolveAgentSessionTitle`；无 title 时稳定显示 `catalogLabel · projectBasename` |
| T1 | **P1** | `UserPromptSubmit` 规则生成 → 写入 `sessionTitle(source=auto)`；每会话一次；失败不影响回合 |
| T2 | **P2** | 可选小模型 refine；Claude 双写 provider `sessionTitle`；用户「重命名会话」入口 |

本文件正文锁定 **P0**；P1/P2 仅规定接口与禁止项，避免实现时漂移。

### 1.5 边界

- **做**：Agent kind 的产品主标题契约、resolver、展示换源、OSC 降权。  
- **不做（P0）**：自动生成、小模型、provider `/rename` 双写、用户 rename UI。  
- **不动**：FA 五态状态机、hook status 权威、OSC 转发与 `updateTerminalPanelTitle` 持久化（OSC 管线保留）。  
- **普通 shell**：仍可用 cwd / OSC；本设计只约束 `activity.kind === "agent"`。

---

## 2. 现状梳理（基线）

### 2.1 今日管线

```text
Agent TUI → OSC 0/2 → Ghostty → main 转发
  → 持久化 terminal session.title（实为 OSC）
  → pier://terminal:title-changed
  → renderer effectiveTitle
  → agentTabTitleFromTerminal(OSC, catalog)  // ≤40 / 无换行才用 OSC
  → display.short → dockview tab
  → display.long = 完整 OSC 或 cwd     // title bar / tooltip 仍可能很长
```

关键代码：

- `terminal-panel.tsx`：`effectiveTitle = sequenceTitle ?? savedSession?.title`
- `terminal-tab-chrome.ts`：`agentTabTitleFromTerminal` / `activityTabChromeOverlay` / `terminalPanelDescriptor`
- Index：catalog label + 路径（已不读 OSC）
- `panel-close-activity.ts` / `activity-widget.tsx`：存在 raw `agentId` 展示

### 2.2 根因

**没有会话标题字段**；OSC 被误用为产品名。40 字截断是止血，不是模型。

---

## 3. 目标模型

### 3.1 字段

```ts
/** 产品会话名；与 OSC terminalTitle 分离 */
type AgentSessionTitleSource = "user" | "auto";

interface AgentSessionTitleState {
  sessionTitle: string; // 已 trim，单行，建议 ≤40
  source: AgentSessionTitleSource;
  updatedAt: number;
}
```

**FA（`AgentActivity`）扩展（可选字段，strict schema 增加）**：

- `sessionTitle?: string`
- `sessionTitleSource?: "user" | "auto"`

P0：字段可出现在契约中但运行时恒缺席 → resolver 走 placeholder。  
P1：main 写入后经既有 FA broadcast 到达 renderer。

### 3.2 持久化归属（锁定）

| 数据 | 存哪 | 说明 |
| --- | --- | --- |
| OSC | 现有 `terminal-session-state` 的 `title` | **改名语义**：文档与代码注释称为 `terminalTitle`；存储键可暂不 rename 以免大迁移，但 API/类型别名必须区分 |
| `sessionTitle` + `source` | **同一 session JSON 旁路新键** `sessionTitle` / `sessionTitleSource` | reload 可恢复；与 OSC 并存 |
| 运行投影 | FA `AgentActivity` 可选字段 | Index / Attention 继续只订 FA，无需第二订阅 |

**为什么挂 FA，不另起旁路 map（P0 决策）**：

- Index 已从 FA 投影；标题进 FA 才能满足 G6「单源」而不开第二广播。  
- FA 仍是活动语义源；title 是 agent 活动的展示属性，不是新编排域。  
- status 映射函数禁止读/写 title（纪律测试锁死）。

### 3.3 Resolver（唯一入口）

```ts
function resolveAgentSessionTitle(input: {
  agentId: AgentKind;
  projectRootPath?: string | null;
  cwd?: string | null;
  sessionTitle?: string | null;
  sessionTitleSource?: AgentSessionTitleSource | null;
  // 明确禁止传入 OSC 作为主标题候选——类型上不接收 terminalTitle
}): {
  primary: string; // tab / Index 主行 / title bar
  secondary?: string; // Index 副行等：项目短名或路径
  placeholder: string; // 无 sessionTitle 时的 primary
};
```

**优先级（高 → 低）**：

1. 非空 `sessionTitle`（无论 user/auto；写入时已保证 user 不被覆盖）  
2. `placeholder = `${catalogLabel} · ${projectBasename}``  
   - `catalogLabel`：`getAgentCatalogEntry(agentId).label ?? agentId`  
   - `projectBasename`：`basename(projectRootPath ?? cwd)`；皆空则省略 ` · …`，仅品牌名  
3. **禁止**：OSC、cwd 全文、首条消息原文作为 `primary`

### 3.4 目标数据流

```text
[P0] 启动 → placeholder → 全 UI
     OSC 仍转发，仅可进 tooltip（可选、须截断），不进 primary

[P1] UserPromptSubmit → 规则生成 → 写 session JSON + FA
     → resolver 输出短标题；每会话 auto 一次；user 不覆盖

[P2] 可选 refine / Claude 双写 / 手改 UI
```

---

## 4. P0 实施设计

### 4.1 行为变更（用户可见）

| 表面 | P0 之前 | P0 之后 |
| --- | --- | --- |
| Agent tab | 短 OSC 或 catalog | **恒** `sessionTitle` 或 `Claude · pier` |
| Title bar / document.title | 常为完整 OSC 或 cwd | **与 tab 同一 primary**（不再灌长 OSC） |
| Tab tooltip | 完整 OSC | 允许保留截断后的 `terminalTitle`（建议 ≤120）或省略 |
| Index | catalog + 路径 | primary 同 resolver；副行仍路径/状态（有 sessionTitle 时主行用它） |
| 关闭摘要 / activity 物料 | 常 raw `agentId` | catalog / resolver primary |

### 4.2 代码改动清单（必改）

| # | 位置 | 改法 |
| --- | --- | --- |
| 1 | `shared/contracts/foreground-activity.ts` | `AgentActivity` 增加可选 `sessionTitle` / `sessionTitleSource` |
| 2 | 新建 `shared/agent-session-title.ts`（或 `renderer`+`shared` 纯函数包） | `resolveAgentSessionTitle` + `agentSessionPlaceholder` + 长度常量 |
| 3 | `terminal-tab-chrome.ts` | `activityTabChromeOverlay` 改用 resolver；**删除或降级** `agentTabTitleFromTerminal` 为主路径 |
| 4 | `terminalPanelDescriptor` | agent 场景 `display.short` / `display.long` 均来自 resolver primary；`terminalTitle` 仅填 OSC 截断（可选） |
| 5 | `terminal-panel.tsx` | overlay 传入 FA 的 sessionTitle，**不要**把 `effectiveTitle`(OSC) 当主标题候选 |
| 6 | `agent-index-quickpick.ts` | 主 label 走 resolver（P0 无 sessionTitle 时等于 catalog·项目，与现 catalog 对齐并统一项目段） |
| 7 | `panel-close-activity.ts` | `label` 用 catalog/resolver，禁止 raw `agentId` |
| 8 | `activity-widget.tsx` | 同上 |
| 9 | 单测 | resolver 优先级；agent overlay 不因长 OSC 改变 primary；governance：禁止业务再 call 旧 OSC→tab 主路径 |

### 4.3 明确不改（P0）

- `terminal-task-lifecycle-wiring` OSC 转发  
- FA status ingest / hook install 命令  
- Attention 通知策略（标题字符串可随后用 resolver，但不改触发矩阵）

### 4.4 对现状逻辑的影响

| 层 | 影响 |
| --- | --- |
| Status / hooks | 无 |
| OSC 管线 | 无（只降展示权） |
| 展示层 | **有意变更**：Agent 主标题变干净、可预期 |
| 契约 | FA 可选字段向前兼容；旧 renderer 忽略未知字段需确认 zod `.strict()` —— **必须同步改 schema 与所有构造点** |

---

## 5. P1 / P2 接口预留（本阶段不实现）

### 5.1 P1 写入 API（草案）

```ts
// main：仅 agent panel
setAgentSessionTitle(panelId, {
  title: string;
  source: "auto" | "user";
}): Result;
// 规则：
// - source=auto 且已有任意 sessionTitle → no-op
// - source=user → 覆盖 auto；再来的 auto no-op
// - trim / 拒换行 / 硬上限 40；失败返回 ok 且不改状态（失败安全）
```

触发：现有 `UserPromptSubmit` emit 路径旁路，**不改变** status 映射。生成：规则清洗（去 Image 占位、压缩空白、截断）；寒暄词表不命名。

### 5.2 P2

- 异步小模型 refine（fire-and-forget，超时丢弃）  
- Claude hook 回写 `hookSpecificOutput.sessionTitle`（双写，非主路径）  
- UI「重命名会话」→ `source: "user"`

### 5.3 禁止项（永久）

- 主标题回退到 OSC / cwd 全文 / 首条原文  
- 用 `additionalContext` 要求模型自行 `/rename` 作为主方案  
- auto 覆盖 user  
- 每回合自动改名（无冷却的 Stop refine 不得进默认路径）

---

## 6. 可行性 / 稳定性 / 性能

| 维度 | P0 | P1 |
| --- | --- | --- |
| 可行性 | 高：纯展示换源 + 契约预留 | 高：复用 UserPromptSubmit |
| 稳定性 | 高：行为更保守 | 高：失败留占位；`\|\| true` |
| 性能 | 无额外 IO | 每会话 ≤1 次规则生成 |
| 回归面 | Agent tab / title bar / Index / 两处 raw agentId | hook emit + session JSON + FA 投影 |

---

## 7. 验收

### 7.1 P0

- [ ] Grok/长 OSC：tab 与 title bar **均为** `Grok · <项目>`（或仅品牌），主文案无长 prompt  
- [ ] 短 OSC「Fix parser」：**不再**因 OSC 变短而进 tab（P0 故意忽略 OSC；P1 后由 sessionTitle 提供友好名）  
- [ ] Index / tab / title bar 主标题一致（同 resolver）  
- [ ] 关闭摘要与 activity 物料不显示 raw `agentId`  
- [ ] OSC 仍更新 session 持久化字段；tooltip 可选展示截断 OSC  
- [ ] FA status 单测全集绿；无 title 逻辑进入 status 分支

### 7.2 说明：P0 相对「短 OSC 进 tab」是刻意回退

今日若 TUI 写出短会话名，tab 会显示它。P0 **放弃**这条不可靠好运，换可预期占位；友好名交给 P1 正式生成。这是金标准交易，验收时不得当回归缺陷重开 OSC 主路径。

---

## 8. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 标题存哪 | session JSON 新键 + FA 可选投影 | reload + Index 单订 FA |
| P0 是否读 OSC | **否**（主标题） | 结束不可靠好运；对齐 Index 纪律 |
| 生成放哪 | P1 宿主规则，非模型自觉 | 业界可靠路径；跨 provider |
| status 与 title | 隔离 | 防止污染五态 |

---

## 9. Agent 自动命名覆盖矩阵

自动命名只认 FA `PromptSubmit` + `promptSnippet`（[`agent-session-title-effects.ts`](../../src/main/services/agents/agent-session-title-effects.ts)）。按安装形态分三档：

| 档 | 机制 | Agents | 文案来源 |
| --- | --- | --- | --- |
| A. Stdin hooks | `extract-stdin-meta` / 内联提取 `prompt`→`promptSnippet`（hook gen≥3） | claude, cursor, codex, openclaude（含 Claude 同款 dual-write）, grok, droid, qwen-code, qodercli, codebuddy, aug, gemini, antigravity, goose, devin, kimi, copilot, cline, kiro, autohand | Provider stdin JSON 顶层字符串字段 |
| B. Plugin JSONL | 生成插件 `pierPromptSnippetFrom` 写入顶层 `promptSnippet` | omp, pi, amp, opencode, mimo-code | event / properties / sessionManager best-effort；无文案则 fail-soft 留占位 |
| C. 无 PromptSubmit | **不**伪造 UPS | hermes, kilo, command-code, crush, mistral-vibe, aider | 仅 `catalog · project` 占位；上游补 UPS 后再接 |

禁止：为 C 档硬插假 `PromptSubmit`（会污染 FA 五态）；主标题回退 OSC。

---

## 10. 下一步

1. 本设计确认后 → 写 [`plans/2026-07-23-agent-session-title.md`](../plans/2026-07-23-agent-session-title.md) 拆 P0 Task。  
2. 实现 P0 → 再开 P1 生成与写入。  
