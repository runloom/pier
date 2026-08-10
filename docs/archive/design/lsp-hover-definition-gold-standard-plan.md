# LSP 悬停与定义跳转：金标准对齐改造清单

**日期**：2026-07-30  
**状态**：方案 Z（Zed 对齐）已落地——普通悬停为唯一文档浮层；Cmd+悬停仅下划线；Cmd+Click/F12 跳转  
**前置分析**：会话内对 hover UI、Cmd+Click、协议/导航一致性的审查  
**关联设计**：[`workspace-lsp-policy.md`](../../design/workspace-lsp-policy.md) §7（悬停 / 定义预览 / 键盘）  
**范围**：Files 编辑器内 **悬停展示** + **统一跳转到定义**；不扩 Peek 多标签、Type/Implementation 命令面

---

## 0. 目标与完成定义

### 0.1 产品目标（范围内核）

用户在 TS/JS（及已接入的 Python/Go/Rust）中应得到与 VS Code 同级的**最小完整**体验：

1. **普通悬停**：轻量、内容优先的文档浮层；无信息时不弹层。  
2. **Cmd/Ctrl + 悬停（Scheme Z）**：仅符号可点暗示（下划线 affordance）；**不**打开定义预览卡。  
3. **Cmd/Ctrl + 点击**：直接跳转到定义（与 F12、卡内点选共用同一导航出口）；多目标时再出定义列表。  
4. **F12**：与上同一套 Location / LocationLink 归一化与打开逻辑。  
5. **Mod+I**：主动「符号信息」；仅此路径在无信息时显示可读空态/失败态。

### 0.2 非目标（本轮不做）

- Peek Definition 编辑器栈、可固定文档工具窗。  
- Go to Type / Implementation / Declaration 的命令与快捷键（可后续挂同一 navigate 出口）。  
- 多定义策略设置项（`goto` / `peek` / `gotoAndPeek` 偏好）。  
- 迁移 Monaco 或替换 `@codemirror/lsp-client` 包。

### 0.3 完成验收（必须同时满足）

| # | 验收项 | 证据 |
|---|---|---|
| A | 三入口跳转一致：卡内点击 / Cmd+Click / F12 | 单测 + 可选 e2e |
| B | Location 与 LocationLink 均正确；优先 `targetSelectionRange` | 单测 |
| C | 被动悬停无内容不挂载 tooltip；Mod+I 可显示空态 | 单测（改契约） |
| D | 无 `@pier/ui/Card` 产品壳；单层 editor/popover 浮层 | 卡组件单测 + 目视 |
| E | 定义区 ≥560px 横排、否则竖排；文档 max 480、定义/符号 max 640×360 | 卡单测 |
| F | 跳转失败有本地化用户反馈（非 silent catch） | action/controller 单测 |
| G | Cmd 修饰悬停仅下划线 affordance（无定义预览卡） | 单测 decoration |
| H | 既有 completion / signature / diagnostics / Shift+F12 不回归 | client-config 单测 |

---

## 1. 目标架构

```
指针 / 键盘 / F12
        │
        ▼
┌───────────────────────┐
│ HoverController       │  模式：documentation | definition | symbol
│ + ClickDefinition     │  空结果纪律、sticky 收敛、capability 门闸
└───────────┬───────────┘
            │ 定义目标列表
            ▼
┌───────────────────────┐
│ parseFilesLspDefinitions │  已有：Location + LocationLink
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ navigateFilesLspDefinition │  新增唯一出口
│  mapping + displayFile  │
│  + 选中 range + 反馈  │
└───────────┬───────────┘
            │
            ▼
   EditorView 聚焦与滚动

展示：files-lsp-hover-card（轻量 DOM，非 Card）
样式：editor-theme.ts（.cm-lsp-hover-tooltip / documentation）
```

**硬规则**：禁止再出现第二套 `loc.uri` / `loc.range` 手写跳转；上游 `jumpToDefinitionKeymap` 替换为 Pier 命令/keymap。

---

## 2. Phase A — 正确性（导航统一 + 手势 + 空结果）

> 优先合入；可不依赖 UI 换壳，但空结果纪律与 navigate 必须先落地。

### A1. 新增统一导航模块

| 项 | 内容 |
|---|---|
| **新文件** | `src/plugins/builtin/files/renderer/files-lsp/definition-navigate.ts` |
| **职责** | 给定 `plugin`、已准备的 `WorkspaceMapping`（或内部 `withMapping`）、归一化后的单个 `FilesLspPreparedDefinition` / 原始 response，执行打开 + 定位 + 选中 |
| **API 草案** | 见下 |
| **错误** | 返回判别联合，**不** swallow；调用方负责 i18n 反馈 |

```ts
// 草案（实现时可微调命名，保持窄 API）
export type FilesLspNavigateDefinitionResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "open-failed" | "map-failed" };

export async function navigateFilesLspDefinition(input: {
  mapping: WorkspaceMapping;
  plugin: LSPPlugin;
  sourceView: EditorView;
  target: { uri: string; range: { start: Position; end: Position } };
}): Promise<FilesLspNavigateDefinitionResult>;

/** F12 / 命令：自建 mapping、请求 definition、多目标策略 */
export async function jumpToFilesLspDefinition(
  view: EditorView
): Promise<FilesLspNavigateDefinitionResult & { multi?: boolean }>;
```

**行为细则：**

1. `target.uri === plugin.uri` → 用 `sourceView`；否则 `workspace.displayFile(uri)`。  
2. 有 mapping 用 `mapPosition`；否则 `plugin.fromPosition`（与现逻辑一致）。  
3. **选中整个 range**：`selection: { anchor: start, head: end }`（至少选中 start→end；行内符号可见）。  
4. `scrollIntoView: true`，`userEvent: "select.definition"`。  
5. mapping 生命周期：  
   - 卡内点击：沿用 controller 已持有 mapping，navigate 后由 controller destroy 一次。  
   - F12 / Cmd+Click 即时跳：navigate 内部 `workspaceMapping` + `finally destroy`，或 `withMapping` 等价。  
6. 多目标（F12 / Cmd+Click）：**单目标直跳**；**多目标**打开 definition 模式卡片（复用 controller 展示 API），不静默只跳 `[0]`（相对上游金标准：有列表即可，不做 peek）。

**改动文件：**

- 新增 `files-lsp/definition-navigate.ts`  
- `files-lsp/hover-controller.ts`：`#activateDefinition` 改为调用 navigate；删除内联 display/dispatch  
- `files-lsp/client-config.ts`：移除 `jumpToDefinitionKeymap`，改为 Pier keymap（见 A2）  
- 可选：`files-lsp/definitions.ts` 导出供 navigate 使用的类型，避免循环依赖

**测试契约：**

| 文件 | 变更 |
|---|---|
| 新增 `tests/unit/renderer/files-lsp-definition-navigate.test.ts` | Location、LocationLink、同文件、跨文件 displayFile、mapping/fromPosition、选中 range、open-failed |
| `files-lsp-hover.test.tsx` | 卡内点击断言改为 spy navigate 或保留最终 dispatch 形状（含 `head`） |
| 新增 `tests/unit/renderer/files-lsp-click-definition.test.tsx` | 见 A3 |

---

### A2. 替换上游 F12，接入统一跳转

| 项 | 内容 |
|---|---|
| **文件** | `files-lsp/client-config.ts`、`files-lsp/definition-navigate.ts`、可选 `files-editor/actions.ts` |
| **做法** | `keymap.of([{ key: "F12", run: (view) => { void jumpToFilesLspDefinition(view); return true }, preventDefault: true }])` |
| **能力检查** | `hasCapability("definitionProvider") === false` → 不请求，返回 unavailable |
| **命令面板（建议本阶段做）** | 新增 `pier.files.editor.goToDefinition`（manifest + locale + 可选默认 F12 进共享 keybindings 表以便可发现）；若本阶段只做 CM keymap，在清单勾选「P2 可发现性」跟踪 |

**测试：**

- `files-lsp-client-config.test.ts`：断言 **不再** 使用上游 `jumpToDefinitionKeymap` 原样数组，而是 Pier 绑定；仍含 format/rename/references/completion/diagnostics。  
- navigate 单测覆盖 LocationLink 的 F12 路径（mock client.request）。

---

### A3. Cmd/Ctrl + 点击跳转

| 项 | 内容 |
|---|---|
| **文件** | `files-lsp/hover-controller.ts`（或 `files-lsp-click-definition.ts` 由 controller 挂载） |
| **事件** | 在 `contentDOM` 上 `click`（或 `mousedown` + click 防重；推荐 **click** 且 `exactFilesLspDefinitionModifier`） |
| **流程** | `preventDefault` → sync → definition 请求 → parse → 单目标 `navigate`；多目标 `#begin`/`show` definition 卡并 prepared mapping |
| **与 Cmd+悬停协调** | 已打开 definition 卡时：单击（带修饰键）在**同一 candidate** 上 → 若仅 1 目标则 navigate 并 clear；多目标保持卡。避免重复全量请求可用已有 prepared 结果（卡 session 已有 targets 时优先复用） |
| **修饰键** | 复用 `exactFilesLspDefinitionModifier`（mac 仅 Meta，其它仅 Ctrl；Alt/Shift 否） |
| **多光标** | 不处理；有其它修饰键时不触发 |

**测试（新文件契约）：** `tests/unit/renderer/files-lsp-click-definition.test.tsx`

1. mac Meta+click / linux Ctrl+click 调用 navigate 一次。  
2. 错误修饰键（mac Ctrl、带 Shift）不跳转。  
3. LocationLink 跨文件。  
4. 多目标 → 出现 dialog，不立刻 navigate。  
5. 请求失败 → 不静默（见 A5）。  
6. 与 documentation 300ms 无冲突：click 路径不依赖 hover 卡。

---

### A4. 被动悬停空结果纪律

| 模式 | 无内容 | 请求失败 |
|---|---|---|
| documentation（鼠标） | **不 show** tooltip | **不 show**（可选：不打扰；失败不弹层） |
| definition（Cmd+悬停） | **不 show** | **不 show** |
| symbol（Mod+I） | show `noInformation` | show `unavailable` |

**改动：**

- `files-lsp/hover-controller.ts` `#requestTransient`：documentation 在 contents 全空且 !error 时直接 return；error 时也不弹（被动）。  
- definition：`targets.length === 0` 时 destroy mapping、不 show（今天会 show 空 dialog）。  
- `#runManual` 保持 show 空态/失败态。  
- `createFilesLspHoverModel` 可增加 `hasContent` 纯函数便于测。

**测试契约变更（破坏性，必须改）：**

| 旧契约（删除/改写） | 新契约 |
|---|---|
| hover `null` 仍可能挂 region | 鼠标路径 `null`/空 → DOM 无 `[data-slot=files-lsp-hover-card]` |
| definition `[]` 仍 dialog | Cmd+悬停 `[]` → 无 dialog |
| `renders distinct no-result...` 用 showManual | **保留** Mod+I 空态/失败态断言 |

涉及：`files-lsp-hover.test.tsx` 中依赖「空也显示」的用例。

---

### A5. 跳转失败反馈

| 项 | 内容 |
|---|---|
| **文案** | Files locale：`filePanel.editor.goToDefinition.failed` / `unavailable`（中英） |
| **谁弹** | 卡内点击、Cmd+Click、F12 失败时：短 `toast.error` 或 `showAppAlert`（有 `Error.message` 技术细节时用 alert）；**禁止** 仅 `console` |
| **注入** | hover input 或 navigate 可选 `onNavigateError(reason)`；controller/F12 注入，单测 mock |

**改动文件：**

- `locales/en.json`、`zh-CN.json`  
- `file-panel-markdown-labels.ts` / labels 类型（若走 labels 注入）  
- controller / jump 调用点  

**测试：** navigate 返回 `open-failed` 时 onNavigateError 被调用一次。

---

### A6. Capability 与 ready 门闸（鼠标路径）

| 项 | 内容 |
|---|---|
| **hover** | `hasCapability("hoverProvider") === false` → 不请求 |
| **definition** | `definitionProvider === false` → 不请求、不 click 跳 |
| **plugin 缺失** | 维持现 clear/unavailable |
| **paused/starting** | 鼠标路径：不发请求（与现「无 plugin 则 clear」一致）；Mod+I 继续 queued/prepareForManual |

**测试：** mock `hasCapability` 返回 false 时 request 次数为 0。

---

### A7. Phase A 自检命令

```bash
pnpm exec vitest run \
  tests/unit/renderer/files-lsp-definition-navigate.test.ts \
  tests/unit/renderer/files-lsp-click-definition.test.tsx \
  tests/unit/renderer/files-lsp-hover.test.tsx \
  tests/unit/renderer/files-lsp-definitions.test.ts \
  tests/unit/renderer/files-lsp-client-config.test.ts \
  tests/unit/renderer/files-editor-actions-navigation.test.ts
```

---

## 3. Phase B — 呈现与抛光（UI / sticky / affordance / 锚定）

> 依赖 Phase A 的模式与空结果语义稳定后再换壳，避免双线改测试。

### B1. 去掉产品 Card，轻量浮层

| 项 | 内容 |
|---|---|
| **文件** | `files-lsp/hover-card.tsx` |
| **删除** | `@pier/ui/card` 的 Card/Header/Title/Description/Content |
| **结构** | 根 `div[data-slot=files-lsp-hover-card]`：`role=region|dialog`、`aria-labelledby`、`aria-modal=false`（dialog） |
| **标题** | documentation：**可见标题可选 sr-only**（a11y 保留名称）；definition/symbol：一行轻标题「定义 (N)」/「符号信息」，**去掉当前文件绝对路径副标题**（路径噪声；需要时仅定义目标行显示路径） |
| **样式** | `bg`/`border`/`shadow` 只消费 popover/editor token；圆角与 `.cm-tooltip` 协调（避免双层边框：tooltip 根透明或卡根不设第二 ring） |
| **class** | 根挂 `cm-lsp-hover-tooltip`；**仅文档 HTML 容器**挂 `cm-lsp-documentation`（外链委托） |

**测试契约变更：**

- `files-lsp-hover-card.test.tsx` / `files-lsp-hover-card-review.test.tsx`：  
  - 不再要求 shadcn Card class / `data-slot=card`  
  - documentation **不要求**可见「Documentation」大标题（可 assert `aria-labelledby` 指向 sr-only）  
  - 仍要求 Esc、sticky 回调、Tab 到定义按钮、sanitize sink  
- e2e `files-lsp-hover.spec.ts`：标题可见性断言改为 a11y 名称或签名/文档正文（Mod+I 仍可有可见「符号信息」）

---

### B2. 定义区布局按设计 7.5

| 项 | 内容 |
|---|---|
| **列表** | 紧凑行（非全宽 outline Button 双行路径）；basename + 行号为主，完整路径 `title` tooltip 或次行 truncate |
| **预览** | 单活动预览；**不要**与列表重复同一 basename 头，或预览仅行号+代码 |
| **响应式** | 可用宽 ≥560px：`grid` 约 200px 列表 + 1fr 预览；否则纵向堆叠（用 CSS var 或 container/matchMedia；与 `--files-lsp-editor-available-width` 一致） |
| **截断** | 行截断提示不破坏等宽行几何（角标/下一行 muted） |
| **尺寸** | documentation `max-width: min(480px, var(--files-lsp-editor-available-width))`；definition/symbol 640×360；**documentation 补 max-height** 与单一 body 滚动 |

**测试：** review 单测保留「仅一个 active preview」；新增宽/窄 class 或 data 属性断言（如 `data-layout=split|stack`）。

---

### B3. `editor-theme.ts` 语义样式

| 选择器 | 内容 |
|---|---|
| `.cm-lsp-hover-tooltip` | padding、字体、行高、max 尺寸兜底；与 React inline max 不冲突 |
| `.cm-lsp-documentation` | `p/pre/ul/ol/li/code/table` 间距；链接色用语义 token |
| 签名块 | mono + 可选与 `tok-*` 一致的容器 |

保证 Pier 自定义 tooltip **实际挂上**这些 class（B1）。

**测试：** 可选 governance 或 card 单测 assert className 包含 `cm-lsp-hover-tooltip`。

---

### B4. 去掉二次 sanitize；签名/文档呈现

| 项 | 内容 |
|---|---|
| **DocumentationBlock** | 若 `html` 已来自 `plugin.docToHTML`（client sanitizeHTML），**禁止**再 `sanitizeFilesLspHtml`；仅在未走 docToHTML 的防御路径 purify |
| **签名** | 尽量走与上游类似的代码高亮路径，或至少统一 mono 样式；不把签名 HTML 当 markdown 双渲染 |
| **normalize** | 保持 `files-lsp/hover-content.ts`；不伪造 signature |

**测试：** `files-lsp-hover-card-review` 仍保证危险 HTML 不可进 DOM（在 model 构造层注入已净化/未净化边界写清）。

---

### B5. Hover 锚定改用 server `range`

| 项 | 内容 |
|---|---|
| **文件** | `files-lsp/hover-controller.ts`、`files-lsp/hover-data.ts`、`files-lsp/hover-preview.ts` |
| **行为** | documentation 响应含 `range` 时，tooltip `pos/end` 用 range；否则回退 wordAt / 点击位置 |
| **candidate 身份** | 防抖 identity 仍可用 word 或 range 规范化，避免微移重入 |

**测试：** mock hover 带 range 时 tooltip effect 的 pos 对应 fromPosition。

---

### B6. Cmd 修饰 affordance（下划线）

| 项 | 内容 |
|---|---|
| **新/扩** | decoration field：当 exact definition modifier 且 pointer 在符号上（或已有 definition 候选），对 `originSelectionRange` 或 word range 画 underline + `cursor: pointer` |
| **数据** | 有 definition 结果后可用 origin range；请求前用 wordAt 临时暗示亦可 |
| **清理** | keyup 非 sticky、clear、destroy 时去掉 decoration |

**测试：** modifier down → decoration 存在；keyup → 清除（非 sticky）。

---

### B7. Sticky 收敛

| 规则 | 行为 |
|---|---|
| 进入卡 | 仍可 sticky（便于点链接/定义） |
| 指针离开 **编辑器 content + 卡** | 非 symbol 模式 → clear（比「永久粘住」更接近金标准） |
| sticky 期间指针移到 **另一 candidate** | 允许更新 documentation（或 clear 后按 300ms 重来）；**禁止** 永远锁死旧符号 |
| symbol（Mod+I） | 保持 sticky 至 Esc / 文档变更 / 选区变更 |
| 导航成功 | 必须 clear（已有） |

**改动：** `#onMouseMove` 去掉「sticky 则完全 return」的一刀切；改为区分 pointer-over-card vs 新 candidate。  
**测试：** sticky 后移到另一 word → 旧卡关闭或内容替换；离开编辑器 → 关闭。

---

### B8. 修饰键与快捷键冲突减弱

| 项 | 内容 |
|---|---|
| **问题** | window capture 下单独 keydown Meta 即切 definition，易打断 Cmd+C/S |
| **方向** | definition 模式以 **mousemove + modifier 已按下** 为主；keydown 仅在 pointer 仍在同一 candidate 且无其它快捷键意图时增强；或 keydown 只设「modifierActive」标记，真正请求仍由 mousemove 触发（0ms） |
| **测试** | 指针在符号上 keydown Meta → 仍 0ms definition；不强制覆盖「Meta+KeyS 不发 definition」若实现成本高，至少文档记录 |

---

### B9. Phase B 自检命令

```bash
pnpm exec vitest run \
  tests/unit/renderer/files-lsp-hover-card.test.tsx \
  tests/unit/renderer/files-lsp-hover-card-review.test.tsx \
  tests/unit/renderer/files-lsp-hover.test.tsx \
  tests/unit/renderer/files-lsp-hover-content.test.ts \
  tests/unit/renderer/files-lsp-html-sanitizer.test.ts \
  tests/unit/renderer/files-lsp-documentation-links.test.ts \
  tests/e2e/files-lsp-hover.spec.ts
```

---

## 4. 文件级改动总表

### 4.1 新增

| 路径 | Phase | 说明 |
|---|---|---|
| `files-lsp/definition-navigate.ts` | A | 唯一跳转出口 |
| `tests/unit/renderer/files-lsp-definition-navigate.test.ts` | A | |
| `tests/unit/renderer/files-lsp-click-definition.test.tsx` | A | |
| 可选 `files-lsp-definition-affordance.ts` | B | 下划线 decoration |

### 4.2 修改（实现）

| 路径 | Phase | 要点 |
|---|---|---|
| `files-lsp/hover-controller.ts` | A+B | navigate、空结果、click、sticky、capability、range 锚定 |
| `files-lsp/hover-card.tsx` | B | 去 Card、布局、class、sanitize |
| `files-lsp/hover-preview.ts` | A/B | show 条件、tooltip pos |
| `files-lsp/hover-data.ts` | A/B | hasContent、range helper |
| `files-lsp/hover-content.ts` | — | 基本不动 |
| `files-lsp/definitions.ts` | A | 类型导出供 navigate |
| `files-lsp/client-config.ts` | A | 替换 F12 keymap |
| `files-lsp/client.ts` | A | 若需注入 onNavigateError / labels |
| `files-lsp/hover.ts` | A | 导出 click 相关若拆分 |
| `editor-theme.ts` | B | hover/documentation 样式 |
| `file-panel-markdown-labels.ts` | A | 新 labels |
| `locales/en.json`、`zh-CN.json` | A | 跳转失败等文案 |
| `manifest.ts` / `keybindings.ts` / `files-editor/actions.ts` | A 可选 | goToDefinition 命令 |

### 4.3 修改（测试）

| 路径 | Phase | 契约方向 |
|---|---|---|
| `files-lsp-hover.test.tsx` | A+B | 空不 show；选中 head；sticky 收敛 |
| `files-lsp-hover-card*.tsx` | B | 非 Card；布局；a11y |
| `files-lsp-client-config.test.ts` | A | Pier F12 |
| `files-lsp-definitions.test.ts` | — | 保持 |
| `files-lsp-hover.spec.ts` (e2e) | B | 不依赖重标题样式 |
| `default-keymap.test.ts` | A 可选 | 若 F12 进共享表 |

### 4.4 明确不改（本轮）

- main `services/lsp/*` framing/进程（除非 navigate 暴露协议 bug）  
- Peek / TypeDefinition 上游 API 接线  
- `languageServerExtensions()` 整包（继续显式 composition）

---

## 5. 测试契约对照（旧 → 新）

| 主题 | 旧（现状/错误） | 新（金标准） |
|---|---|---|
| 鼠标 hover `null` | 可 show 空 region | **不挂载**卡 |
| Cmd+悬停无定义 | 空 dialog | **不挂载** |
| Mod+I 无信息 | show noInformation | **保持** |
| 卡根节点 | Card + 可能双层边框 | 轻量 div + `cm-lsp-hover-tooltip` |
| `cm-lsp-documentation` | 挂在整卡 | **仅**文档 HTML 容器 |
| 定义布局 | 有 preview 即 `grid-cols-2` | `split` iff 宽 ≥560 |
| F12 | 上游 first Location only | Pier navigate + LocationLink + 多目标卡 |
| Cmd+Click | 无 | 有 |
| 跳转 selection | 仅 `anchor` | `anchor` + `head`（range） |
| 跳转失败 | silent | toast/alert + 单测 |
| 二次 sanitize | 有 | 最终 sink 一次 |
| sticky 锁死旧符号 | 有 | 换 candidate 可更新/关闭 |

---

## 6. 实施顺序（建议 PR 切分）

| PR | 内容 | 风险 |
|---|---|---|
| **PR1** | A1 navigate + A2 F12 替换 + 测试 | 中：F12 行为变化（变好） |
| **PR2** | A3 Cmd+Click + A5 失败反馈 + A6 capability | 中 |
| **PR3** | A4 空结果纪律（改 hover 测试契约） | 低，行为更安静 |
| **PR4** | B1–B4 UI 换壳与主题 | 高：视觉 + 大量卡测 |
| **PR5** | B5 range 锚定 + B6 下划线 + B7 sticky | 中 |

也可 PR1+PR2 合并为「导航正确性」一大 PR，UI 单独跟。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 上游 LocationLink 与 F12 历史行为不一致 | 单测钉 LocationLink；真 TS e2e 点跨文件符号 F12 |
| 多目标 F12 从「静默第一个」改为「出卡」 | 符合可发现性；单目标路径不变 |
| UI 换壳导致 e2e 选择器失效 | 稳定 `data-slot`；少依赖可见「Documentation」标题 |
| sticky 改严后「拷文档」困难 | 指针在卡上仍 sticky；仅离开双方才关 |
| Cmd+C 误触 definition | B8 减弱 keydown 强制请求 |

---

## 8. 与 `workspace-lsp-policy.md` 的关系

- §7.1–7.5 仍是交互真源；本清单修正其中**已实现但偏离**的部分（Card 壳、空结果、F12、click）。  
- 本清单 **补全** 设计未写清但金标准必需的：**Cmd+Click**、**三入口统一 navigate**、**被动空不弹层**。  
- §7 非目标（不做完整 Peek 窗）继续有效。  
- 实施完成后，在 `workspace-lsp-policy.md` 验收表勾选对应 hover/click 项，并删除「仅 mock、无 click 测试」类缺口描述。

---

## 9. 建议的首周落地切片

若只开一个最小可合并单元，按此顺序编码：

1. `files-lsp/definition-navigate.ts` + 单测  
2. controller `#activateDefinition` 改调用  
3. client-config F12 改 Pier jump  
4. controller click 处理器  
5. 空结果 early-return + 改 hover 单测  

UI 换壳放在导航合并并 dogfood 之后，避免同时调试「跳错」与「看起来乱」。
