# 增强输入结构化编辑器设计（Phase A / B）

日期：2026-07-22  
状态：已实现（Phase A / B）  
范围：按需增强输入从 `textarea` 升级为结构化编辑器；交付 `@` 工作区提及、token 着色、空草稿键盘透传、大粘贴改附件。不包含 `/` slash 面板、发送历史上键、代码围栏高亮、模式/模型按钮（见 Phase C / D）。

相关：

- 附件契约基线：[`2026-07-21-rich-input-attachments-design.md`](./2026-07-21-rich-input-attachments-design.md)（发送序列化、`[#n]`、附件轨仍有效；本文修订其「非目标」中与编辑器 / `@` 冲突的条目）
- 调研结论：Cursor App 3.12 / ChatGPT·Codex App 26.x 对照（会话内确认清单）
- 能力边界：[`2026-06-25-ai-workbench-capability-scorecard.md`](./2026-06-25-ai-workbench-capability-scorecard.md)

## 1. 背景与目标

增强输入已具备：按需开闭、附件轨、任意文件 pick/paste/drop、正文 `[#n]`、单次 `sendText` 路径注入。痛点：

1. 纯 `textarea` 无法承载原子 chip / 可靠 `@` autocomplete。
2. `[#n]` 无着色，越界引用难发现。
3. 空草稿几乎不透传 TUI 键（仅 Ctrl+C），agent 菜单确认体验弱于原生终端。
4. Cursor / Codex 用户习惯的 `@` 文件提及缺失；大段粘贴易撞 `64_000` 上限。

**目标（本规格）：**

- 编辑器升级为 **结构化 · 纯文本序列化**（非 WYSIWYG 富文本）。
- Phase A：编辑器底座 + mention/`[#n]` 着色 + 空草稿键盘透传。
- Phase B：`@` 工作区文件/文件夹模糊提及 + 大粘贴自动改附件。
- 发送物仍是 agent TUI 可消化的纯文本（绝对路径 + 展开正文）；不引入宿主多模态协议或上下文账本。

**产品名：** 增强输入 / Rich Input。用户可见文案禁止「富文本」。

## 2. 业界基线与 Pier 约束

| 外部做法 | Pier 取舍 |
|---|---|
| Cursor / Codex：Lexical 类结构化输入 + `@` + 附件 | **采用** 同构编辑器路径与 `@` 文件提及 |
| Cursor：`@Docs` / `@Browser` / `@Past Chats` / 上下文环 | **不做**（需宿主会话与检索域） |
| Codex：`/plan` `/goal` 等自有 slash 语义 | **本阶段不做**；Phase C 仅透传型命令建议 |
| ChatGPT：大粘贴 → 附件 | **采用**（阈值见 §6） |
| WYSIWYG 加粗斜体列表 | **明确不做**；禁格式快捷键，粘贴去格式 |

硬约束：

1. 序列化出口 = 纯文本字符串（+ 现有附件路径块规则）。
2. 不拥有 agent 协议；一切 UI 糖必须可逆展开。
3. 不建设 transcript / 上下文用量公共能力。

## 3. 已锁定决策

| 项 | 决定 |
|---|---|
| 编辑器 | **Lexical**，plain-text mode（禁 `FORMAT_TEXT`；粘贴强制纯文本） |
| 不用 | TipTap / ProseMirror 新产品壳；真 HTML 富文本；CodeMirror 作为主输入（可用作后续代码高亮插件，Phase D） |
| 序列化 | `editor.getText()` 风格纯文本；mention 节点序列化为绝对路径或保留 `[#n]` 再经现有 expand（见 §5） |
| 附件轨 | **保留** 上轨 chip；与正文 mention 并存 |
| `@` | 仅工作区 **文件 / 文件夹**；插入为 decorator chip，发送展开为绝对路径 |
| `[#n]` | 继续支持字面 token + 着色；与 `@` chip 并存一个版本周期 |
| 空草稿透传 | 对齐「原生输入对等」矩阵（§7）；非空草稿本地编辑 |
| 大粘贴 | ≥ `10_000` 字符 → 自动 materialize 为 `.txt` 附件并插入 token（§6） |
| Phase C/D | `/` 建议、发送历史、围栏高亮、模式/模型入口 → **另案**，本规格不实现 |

### 3.1 对附件规格的修订

[`2026-07-21-rich-input-attachments-design.md`](./2026-07-21-rich-input-attachments-design.md) §1 非目标中下列条目**由本规格废止**：

- 「contenteditable / ProseMirror / 真·行内 DOM chip」→ 改为允许 Lexical decorator chip（仍禁止 Word 式富文本）。
- 「`@` 路径语法」→ Phase B 允许 `@` 文件/文件夹提及（展开绝对路径；相对路径仍不作为发送形态）。

其余附件非目标（多模态 API、mode/model 按钮、上传进度条等）仍有效。

## 4. 架构

```text
┌─ TerminalComposer (按需) ─────────────────────────────────┐
│  AttachmentRail (既有)                                     │
│  StructuredComposerEditor (Lexical)                        │
│    ├─ PlainTextPlugin / 禁格式 / 粘贴消毒                   │
│    ├─ MentionPlugin (@ 弹出 + decorator)                   │
│    ├─ AttachmentTokenPlugin ([#n] 着色)                    │
│    └─ KeyboardBridgePlugin (空草稿透传 / 非空本地)         │
│  Toolbar: 📎  ⏎                                            │
└────────────── serializeToPlainText() ──► buildSendText() ─┘
                         │
                         ▼
              pier:terminal:sendText | sendKeyPress
```

| 层 | 职责 |
|---|---|
| `structured-composer-editor.tsx` | Lexical 壳、主题 token、IME、焦点 |
| `structured-composer-serialize.ts` | 编辑器状态 → 纯文本；mention → abs path |
| `use-workspace-path-mention.ts` | `@` 查询：走现有 files / path 索引 API，debounce |
| `terminal-composer-passthrough.ts` | 扩展键表；与 Lexical command 优先级约定 |
| 附件 model / rail / send | **保持** 2026-07-21 契约；大粘贴走 materialize |

禁止 renderer 业务直接依赖 Lexical 深层 API 散落；编辑器封装在 `panel-kits/terminal/structured-composer/`。

## 5. 数据与序列化

### 5.1 节点类型（v1）

| 节点 | 编辑态 | 序列化 |
|---|---|---|
| 普通文本 | TextNode | 原文 |
| 附件引用 | 可选：字面 `[#n]` 带 mark，或 AttachmentRefNode | `[#n]` → 既有 `expandAttachmentTokens` |
| `@` 文件/文件夹 | `WorkspacePathMentionNode`（原子、不可部分删） | **绝对路径**字符串 |

删除规则：

- Backspace 删整个 mention chip；不半删路径字符。
- 删附件轨 chip：继续用既有 `[#n]` 重编号算法；若正文含已展开的绝对路径字符串，**不**自动回写（v1 YAGNI）。

### 5.2 发送管线（不变外壳）

```ts
const draftText = serializeStructuredComposer(editorState);
const payload = buildComposerSendText(attachments, draftText);
// 校验越界 [#n]、长度 ≤ 64_000 后单次 sendText
```

`@` mention 在 `serializeStructuredComposer` 阶段已变成 abs path，故 `buildComposerSendText` 无需识别 `@`。

### 5.3 草稿恢复

- per-panel：继续内存 Map。
- 存 **纯文本草稿 + 附件列表**（与现网一致）；再打开时 `setText` 灌入 Lexical，**不**尝试从纯文本重建 mention chip（v1）。  
  代价：恢复后 `@` chip 变普通路径文本；可接受。Phase D 若要芯片恢复再加文档模型版本。

## 6. Phase B：`@` 与大粘贴

### 6.1 `@` 提及

- 触发：输入 `@`（或 `⇧⌘F` 可选，v1 不做）打开 popup。
- 数据源：当前 panel `PanelContext.projectRootPath`（或 cwd）下的路径枚举 / 模糊排序；复用 files 侧已有 score，不新建索引服务。
- 结果：文件与文件夹均可；选中后插入 `WorkspacePathMentionNode`。
- 去重：与附件轨 path 去重规则独立（允许 rail 有文件且正文再 `@` 同 path；发送可能出现两次 path——**可接受**；用户可删）。
- 空查询：显示最近 / MRU 若干条（若现成有；否则仅等待输入）。
- 无项目上下文：popup 空态「未打开项目」+ 下一步文案（走 i18n）。

### 6.2 大粘贴 → 附件

| 项 | 值 |
|---|---|
| 阈值 | 粘贴纯文本 `length >= 10_000` |
| 行为 | `preventDefault` → main 写入 `pier-terminal-pastes/paste-<uuid>.txt` → `resolve`/`append` 附件 → 光标处插 `[#n]` |
| 失败 | `showAppAlert`；不丢用户意图——可提供「仍插入正文」次要路径（choice：改为插入 / 取消） |
| 与图片粘贴 | 图片仍走既有 materialize；本规则仅纯文本 |

## 7. Phase A：键盘桥

空草稿且无附件时，Composer 为透明键盘桥（IME composing 除外）：

| 输入 | 行为 |
|---|---|
| 普通字符 / 数字 / 标点 | `sendKeyPress` / `sendText` 单字符透传（实现选与现 native 一致的一条） |
| ←↑→↓ Tab Shift+Tab Enter | 透传 TUI |
| Ctrl+C | 始终透传 |
| Esc | 关闭增强输入（保持草稿；与现按需关闭一致）。**不**在空草稿时把 Esc 送给 TUI（避免与「关闭卡片」冲突）；需要 TUI Esc 时用户先关增强输入或点终端——若验收反例过多，另开修订 |
| Meta 组合 | 留给系统 / 应用菜单 |
| 非空草稿 | 本地编辑；Enter 发送；Shift+Enter 换行；Ctrl+C 仍透传 |

有附件但正文空：视为「有内容」——**不**走空草稿透传（避免误触把附件场景当桥）。

## 8. 非目标（本规格 + 近期）

- WYSIWYG / Markdown 实时预览主路径  
- `@Docs` `@Terminals` `@Git` `@Browser` `@Past Chats`  
- 语音、消息队列、上下文用量环  
- `/` slash 语义引擎、Goal 生命周期 UI  
- 真多模态二进制、相对路径发送形态  
- 草稿磁盘持久化、mention chip 冷启动重建  

## 9. i18n（新增）

- 提及文件或文件夹… / Mention a file or folder…  
- 未打开项目 / 请先打开项目文件夹以使用 @ 提及  
- 粘贴内容较长，已添加为附件 / Large paste added as an attachment  
- 仍插入正文 / Insert into message anyway  
- 无效附件引用 / 内容过长（沿用附件规格）  

禁止「富文本」「选区」「上下文」等实现词进前台（`@` 可写「提及文件」）。

## 10. 测试

**Phase A**

- Lexical：禁格式快捷键；粘贴 HTML 变纯文本；IME 不误发。  
- `[#n]` 合法色 / 越界色（或 mark class）。  
- 空草稿：方向键 / Tab / Shift+Tab / Enter / Ctrl+C 透传调用次数。  
- 非空：Enter 发送、Shift+Enter 换行、Esc 关闭保留草稿。  
- 序列化：仅文本 round-trip 与现 `buildComposerSendText` 金样一致。

**Phase B**

- `@` 过滤、选中插入 chip、序列化为 abs path。  
- 无项目空态文案。  
- ≥10k 粘贴 → 附件 + token；choice 插入正文分支。  
- 回归：附件轨 / 单次 sendText / 64k / 越界 `[#n]` / 去重。

## 11. 实现顺序

1. 引入 Lexical 依赖（仅 terminal structured-composer 使用）；封装编辑器替换 `InputGroupTextarea`。  
2. Attachment token 着色 + serialize 接现网发送。  
3. KeyboardBridge 空草稿透传 + 单测。  
4. `@` popup + mention 节点 + path 查询。  
5. 大粘贴阈值 + materialize txt + i18n / 组件测。  
6. 更新附件规格「非目标」交叉引用；CHANGELOG `[Unreleased]`。

## 12. 验收要点

- 增强输入不再是裸 textarea；外观仍是桌面工具卡片，无排版工具栏。  
- `@foo` 能选出工作区文件并在发送载荷中变成绝对路径。  
- `[#n]` 可见区分合法/越界。  
- agent 等待 `y/n` 或菜单时，空增强输入下方向键/数字可达 TUI（在透传矩阵内）。  
- 贴 >10k 文本变成附件而非撑爆输入框。  
- 发送形态仍符合附件规格 §6；智能体侧看不到 Lexical 内部结构。

## 13. 后续（不在本规格）

| Phase | 内容 |
|---|---|
| C | `/` 透传命令建议、发送历史上键、skills 插入 |
| D | 围栏代码语法高亮、附件预览打磨、模式/模型快捷入口 |

开启 Phase C 前须单开 design，并再次对照各 agent 命令差异（只做插入建议，不做宿主语义）。
