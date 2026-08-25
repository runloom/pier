# 增强输入粘贴分档展示与编辑设计

日期：2026-08-10  
状态：已实现；**发送 / 点击 / 正文 token 仍以本文为准**。附件轨视觉已由 [`2026-08-25-composer-attachment-rail-preview-design.md`](./2026-08-25-composer-attachment-rail-preview-design.md) 修订（废止 §5.1 统一 56 方格）。  
范围：按需增强输入中，纯文本粘贴的分档阈值、附件轨展示、点击编辑弹窗、发送语义与逃生路径。  
不包含：终端 PTY 多行粘贴确认、智能体 TUI 自有 `[Pasted text #N]` 协议、图片/文件粘贴既有路径改造。

相关：

- 附件基线：[`2026-07-21-rich-input-attachments-design.md`](./2026-07-21-rich-input-attachments-design.md)
- 结构化编辑器与旧「≥10k → 附件」：[`2026-07-22-rich-input-structured-composer-design.md`](./2026-07-22-rich-input-structured-composer-design.md)（**§6.2 由本规格修订**）
- 宿主内容弹窗：[`2026-07-15-host-content-dialog-architecture-design.md`](./2026-07-15-host-content-dialog-architecture-design.md)
- **现网 UI 真源（实现对照，禁止另起一套）：**
  - 轨：`src/renderer/panel-kits/terminal/composer-attachment/rail.tsx`
  - 模型：`composer-attachments-model.ts`
  - 正文 token：`structured-composer/attachment-token-node.tsx` + `composer-chip-styles.ts`

## 1. 背景与目标

### 1.1 现状

| 路径 | 行为 |
|------|------|
| 增强输入纯文本 | `length < 10_000`：**全文插入**编辑器；`≥ 10_000`：落盘 `.txt` + 附件轨 + 正文 `[#n]` |
| 图片 / 本地文件 | 附件轨 chip；发送注入绝对路径 |
| 终端内智能体 TUI | 自有折叠占位（如 Claude Code）；与增强输入无关 |

痛点：中段粘贴（数百行但 &lt;10k）仍撑满输入卡片；与用户在 TUI 里见到的「精简展示」体感不一致。业界强制「大粘贴只变文件、不可编辑」又招致大量抱怨。

### 1.2 目标

1. **小粘贴**：仍全文插入，保持可直接改。
2. **中 / 大粘贴**：复用**现网**附件轨 tile + 正文 `AttachmentTokenNode`，输入区不被长文撑爆。
3. **点击 paste 轨 tile**：在**不改轨壳**的前提下打开宿主 content dialog 编辑全文（图片仍全屏预览、文件仍 reveal）。
4. **发送语义分档**：中档优先当**正文**交给智能体；大档继续 **path / 附件**。
5. **失败逃生**：仅 materialize 失败时「仍插入正文」；编辑弹窗不提供「插入正文」（用户用 × 删附件即可）。

### 1.3 非目标

- 行内 `[Pasted text #1 +N lines]` 与 Claude Code 字节级一致（增强输入不走 TUI paste-cache）。
- 粘贴偏好设置页（可后续；本规格默认策略钉死即可）。
- 改 `MAX_SEND_TEXT_LENGTH = 64_000` 上限。
- 粘贴块进工作区磁盘（仍用 `pier-terminal-pastes/` 临时目录或内存 blob）。
- **新视觉语言**：横向命名条、行数副标题、第二套 chip 样式、轨上 context menu、替换 `openContentPreview` 图片路径。

## 2. 业界取舍（决策依据）

| 做法 | 代表 | Pier 取舍 |
|------|------|-----------|
| 行内折叠占位，提交展开 | Claude Code / Codex TUI | **不作为增强输入默认**；GUI 已有附件轨 |
| 强制 `.txt` 附件、难编辑 | Claude.ai / ChatGPT / 部分 Codex 桌面 | **不照搬**；补点击可编辑 |
| 小全文 + 大附件 | Cursor / 现网 Pier ≥10k | **扩展**：中段也上轨，且可编辑 |
| 多行确认对话框 | VS Code / Ghostty 终端 | 仅 PTY 路径；增强输入不靠确认挡刷屏 |

**锁定产品形态：** 展示对齐附件；中档发送对齐「正文意图」；大档发送对齐「文件路径意图」。

## 3. 已锁定决策

| 项 | 决定 |
|----|------|
| 分档 | **小 / 中 / 大** 三档（阈值见 §4） |
| 小 | 全文插入 Lexical，行为与现网短粘贴一致 |
| 中、大 | **同一展示**：走现网 `AttachmentTile` + `insertAttachmentToken`；**不**把全文灌进编辑器 |
| UI | **必须**与现网附件轨 / 正文 token **一致**（§5）；只扩展数据与 `onOpen` 分支 |
| 点击 paste tile | `openAppContentDialog` 编辑全文（§6.3）；**不**改图片 `openContentPreview`、文件 `onReveal` |
| 中档发送 | 序列化时 paste 全文进 body；**路径前缀跳过**该 medium paste（§7） |
| 大档发送 | 与现 `buildComposerSendText` 一致：缺省 path 前缀 + 正文 token 序列化为 abs path |
| 逃生 | materialize 失败时「仍插入正文」；编辑 dialog **仅** 取消 \| 保存（清空保存 = 删除）。**无**「插入正文」按钮 |
| 图片 / 文件 | 轨 UI 与点击逻辑不变；本规则仅 `text/plain` 且无 file payload |
| 产品词 | 弹窗/失败文案用「粘贴内容」；轨上**不**新增长标签（现网 tile 本无文件名） |

## 4. 阈值

字符数按 UTF-16 `string.length`（与现 `LARGE_PASTE_CHAR_THRESHOLD` 一致，便于实现与测试）。  
行数：`text.split("\n").length`（末尾单个 `\n` 不额外多计一行的细节实现可与单测钉死）。

| 档 | 条件（同时满足才入档；否则落入更低档） | 默认值 |
|----|----------------------------------------|--------|
| **小** | `charCount < SMALL_MAX_CHARS` **且** `lineCount ≤ SMALL_MAX_LINES` | `800` 字 **且** `≤ 5` 行 |
| **中** | 非小，且 `charCount < LARGE_MIN_CHARS` | `800` 字或 `> 5` 行，且 `&lt; 10_000` 字 |
| **大** | `charCount ≥ LARGE_MIN_CHARS` | `10_000`（**保持**现网 `LARGE_PASTE_CHAR_THRESHOLD`） |

常量建议集中：

```ts
// structured-composer/paste-tiers.ts（命名可微调，须单测锁定）
export const PASTE_SMALL_MAX_CHARS = 800;
export const PASTE_SMALL_MAX_LINES = 5;
export const PASTE_LARGE_MIN_CHARS = 10_000; // 原 LARGE_PASTE_CHAR_THRESHOLD
```

判定伪代码：

```ts
function classifyPlainPaste(text: string): "small" | "medium" | "large" {
  const charCount = text.length;
  if (charCount >= PASTE_LARGE_MIN_CHARS) return "large";
  const lineCount = countLines(text);
  if (charCount < PASTE_SMALL_MAX_CHARS && lineCount <= PASTE_SMALL_MAX_LINES) {
    return "small";
  }
  return "medium";
}
```

## 5. UI 一致性（硬约束 · 对照现网）

正文 token 与点击分发仍须与附件同一条轨、同一套 chip，禁止另起 `PasteChip` 或改正文 token 视觉。

**附件轨卡片形状与 56×56 方格：** 已废止。现网真源见 [`2026-08-25-composer-attachment-rail-preview-design.md`](./2026-08-25-composer-attachment-rail-preview-design.md)（图片 contain、格内文本缩略、其它文件只显示类型图标、名字在悬停提示）。

### 5.1 附件轨（历史；视觉以 2026-08-25 为准）

历史结构（实现前快照，勿再当验收）：

```text
每项 AttachmentTile：
  容器  h-14 w-14（56×56）rounded-lg border border-border/60 bg-muted/40
  主按钮  整格可点
    · image + previewDataUrl → 封面 img object-cover
    · 否则 → 居中 Lucide 文件图标 size-6 +（多附件时）底部/中部 #n 小徽章
  删除  右上角 outline icon-xs X，hover/focus 才显
轨容器  flex flex-wrap gap-2 pt-1 pr-1
```

| 项 | 粘贴（中/大）必须 |
|----|-------------------|
| 组件 | **同一** `TerminalComposerAttachmentRail` / `AttachmentTile`，不新建 `PasteChip` |
| 尺寸 / 边框 / 阴影 / hover | 与文件 tile **同一 class 路径** |
| 图标 | 落盘名 `paste-*.txt` → 现网 `fileIconForName` 已映射 `FileText`；**不要**为 paste 换新图标体系 |
| 序号 | 仅 `attachments.length > 1` 时显示 `#ordinal`（与现网一致）；单附件无 `#` |
| 文件名 / 「120 行」 | **轨上不展示**（现网 file tile 也不展示 basename） |
| 无障碍 | `aria-label` 可含「粘贴内容」+ 行数（仅读屏，不改视觉） |
| 删除 | 同一右上角 × → 现网 `onRemove` |
| data-testid | 沿用 `terminal-composer-attachment-${ordinal}` |

示意图（与现网一致，非新 UI）：

```text
┌─ 增强输入卡片 ─────────────────────────────┐
│  [📄]  [🖼]  [📄]     ← 56×56 tile，无标题条 │
│   #1         #3         （多附件才有 #）      │
│  请根据 📎1 修复…       ← 正文 AttachmentToken │
└────────────────────────────────────────────┘
```

### 5.2 正文 token（`attachment-token-node.tsx`）

中/大粘贴添加后，继续走现网：

- `insertAttachmentToken(path, ordinal)` → `AttachmentTokenNode`
- 视觉：`COMPOSER_CHIP_CLASS` + `COMPOSER_CHIP_TONE_ATTACHMENT`（或 invalid）
- 内容：**Paperclip + 序号数字**，**不**显示 path 全文、不显示「粘贴」二字
- 序列化 `getTextContent()` = abs path（现网）；中档发送展开规则在 **build 层**处理，不改 chip 外观

禁止为 paste 新增第四种 chip tone（除非 invalid）。

### 5.3 点击分发（扩展 `openAttachment`，不改壳）

现网 `TerminalComposerAttachmentRail.openAttachment`：

| kind | 现网 | 本规格 |
|------|------|--------|
| `image`（非目录） | `openContentPreview({ type: "image", … })` | **不变** |
| `file` / 目录 | `onReveal(path)` | **不变** |
| `paste`（新增） | — | `openPasteEditDialog(attachment)` → §6.3 |

- **不要**把 paste 送进 `openContentPreview`（当前 payload 仅 image / diagram，且全屏只读舞台不适合编辑）。
- **不要**为 paste 默认 `onReveal` 当主路径（临时目录对用户无产品价值）；编辑 dialog 内若需要可再提供「在访达中显示」次要链，**非**轨点击默认。

### 5.4 数据模型

在现有 `ComposerAttachment`（`image | file`）上扩展，**字段增量最小化**：

```ts
// composer-attachments-model.ts（概念）
type ComposerAttachment = {
  id: string;
  isDirectory?: boolean;
  kind: "image" | "file" | "paste";
  name: string; // basename，如 paste-<uuid>.txt；轨上仍不渲染 name
  path: string;
  previewDataUrl?: string; // paste 不设
  /** 仅 kind === "paste" */
  pasteTier?: "medium" | "large";
};
```

- 行数/字数：**不必**持久在 model 展示；编辑/读屏可现算。
- 去重：粘贴每次新 id + 新 path；**不**按内容 hash 合并。
- 文件/图片 path 去重规则不变。

### 5.5 中档存储（实现真源）

| | 行为 |
|--|------|
| 写入 | `materializeComposerTextBytes` → `pier-terminal-pastes/paste-<uuid>.txt`，同时 renderer 持有 `pasteContent` + `pasteTier` |
| 轨 | 与大档同一 `mergeAttachments` → tile + token |
| 编辑初值 / 中档发送 | **`pasteContent` 为真源**（不经文件再读）；编辑保存时 `writeComposerPasteText` 回写磁盘 |
| 中档发送 | 路径 token 展开为 `pasteContent`；path 前缀跳过；空正文时仍把 medium 正文并入载荷（可与其它 path 前缀并存） |
| 大档发送 | 现网 path 前缀逻辑（智能体侧读 path） |
| 无 `pasteContent` 的 paste | 按 path 语义（不 expand），避免 silent 空串 |

单一工厂：`createPasteAttachment`；`dtoToAttachment` 不得单独拼出可展开中档。

## 6. 交互

### 6.1 粘贴入口

`PastePlainTextPlugin` + 现网 `materializeLargePlainPaste` 扩展为分档：

1. 有 file payload → 不处理（现网）。
2. `text/plain` → `classifyPlainPaste`。
3. **small** → 现网纯文本节点插入。
4. **medium / large** → materialize → `mergeAttachments`（现网插 token）→ **默认无 toast**（新 tile 即反馈；与「强自然 UI 不加 toast」一致）。若现网大粘贴已有成功 toast，**中档不要新增**；大档可保持或去掉，实现时与操作反馈规范对齐，优先不加。
5. 失败 → 现网 `showAppConfirm` +「仍插入正文」（`pasteInsertAnyway`）。

### 6.2 点击（仅行为表，无新轨控件）

见 §5.3。轨上仍只有：主按钮打开、× 删除。

### 6.3 编辑弹窗（唯一新 UI 壳 · 宿主 content dialog）

对齐 Agents 弹窗表单：**提交型** `openAppContentDialog`。

| 项 | 决定 |
|----|------|
| API | `openAppContentDialog` + `setFooter` / 等价 footer 注册 |
| 布局 | `DIALOG_COMMIT_FORM_CLASS`：Label → 全宽 Textarea；**禁止** body 底仿 footer |
| 标题 | i18n：`编辑粘贴内容` / `Edit pasted content` |
| 初值 | `attachment.pasteContent`（内存真源；与落盘在 materialize/save 时同步） |
| Footer | 右簇：`取消` \| 主按钮 **保存**（主按钮最右） |
| 保存非空 | 回写文件；关 dialog；轨/token 不变（path 同） |
| 保存空 | **删除**该附件 + 现网 `rewriteAttachmentTokensAfterRemove` |
| 取消 / Esc | 丢弃草稿 |
| 控件密度 | 默认 28px 体系；Textarea 非单行控件可加高 |
| 禁止 | 自挂 `@pier/ui/dialog`；嵌套产品壳；改 `ContentPreviewHost` 硬塞编辑 |

### 6.4 失败时仍插入正文

仅 **materialize 失败** 的 confirm 提供「仍插入正文」（`pasteInsertAnyway`）：把剪贴板全文插入编辑器。编辑弹窗**不**提供此动作。

### 6.5 删除

轨上 ×（现网）；或 dialog 清空内容后保存。

### 6.6 关闭增强输入

附件清空规则不变（附件规格 §5.5）。

## 7. 发送序列化（修订 · 贴合现网 `buildComposerSendText`）

现网逻辑（`composer-attachments-model.ts`）：

- 正文 token 序列化后 draft 里是 **abs path 字符串**（不是字面 `[#n]`）。
- `buildComposerSendText`：轨上 path 若尚未出现在 draft，则作为前缀行补上。

本规格在此之上增量：

```ts
// 概念；实现见 buildComposerSendText
// 1) 可展开 medium（有 pasteContent）：draft 内 path → pasteContent
// 2) 路径前缀：跳过可展开 medium；file/image/large 同现网
// 3) body 空时：missingPaths + medium 正文（可并存），勿只发 path
```

| 档 | draft 内 token 序列化 | 路径前缀 | 最终智能体看到 |
|----|----------------------|----------|----------------|
| medium + pasteContent | 发送前 path → **pasteContent** | **不**前缀该 path | 正文中的粘贴内容 |
| medium 无 pasteContent | 保持 path | 可前缀 | path（降级） |
| large paste | 保持 path | 缺则前缀 path | path |
| file / image | 保持 path | 现网 | path |

### 7.1 示例

**中档**（token 序列化为 path，发送前替换）：

```text
请分析 <粘贴全文...>
```

**大档**（与现网一致）：

```text
/var/.../pier-terminal-pastes/paste-uuid.txt
请分析 /var/.../pier-terminal-pastes/paste-uuid.txt
```

（若 draft 已含 path，前缀去重，现网 `findPresentAttachmentPaths`。）

**仅 medium paste、用户删光正文 token：**  
path 前缀被跳过 → payload 可能空。  
**锁定：** 若前缀与 body 皆空且仍有 medium paste，则 body = 各 medium 全文按附件序 `\n\n` 连接（保证 canSend）。大档 only 仍靠 path 前缀。

### 7.2 64k

中档展开全文后仍 `> 64_000` → 现网 alert。本规格不自动降档。

## 8. i18n（新增 / 调整）

| Key 语义 | 中文 | English | 出现位置 |
|----------|------|---------|----------|
| 编辑弹窗标题 | 编辑粘贴内容 | Edit pasted content | content dialog |
| 保存 | 保存 | Save | footer 主按钮（可复用通用 key） |
| 清空保存说明（可选 Field description） | 清空并保存将移除该粘贴 | Clearing and saving removes this paste | dialog body |
| 轨 tile aria-label | 粘贴内容，第 {n} 个附件 | Pasted content, attachment {n} | 仅 a11y |
| 失败标题 | 沿用 `largePasteAttachFailed` | 同左 | confirm |
| 成功 toast | **默认不加** | — | — |

**不需要**轨上「粘贴 / N 行」可见字符串 key（轨不渲染这些）。

禁止实现词进前台。

## 9. 对既有规格的修订

### 9.1 `2026-07-22-rich-input-structured-composer-design.md`

- §3 / §6.2 已指向本规格。

### 9.2 `2026-07-21-rich-input-attachments-design.md`

- `kind` 增加 `paste`。
- 发送序列化增加 medium 展开（§7）。
- 粘贴文本：分档；中大上轨。
- **轨 UI 描述若仍写「序号徽章 + 截断文件名」**：以实现为准——现网 tile **无文件名**，仅图标 + 多附件时 `#n`；实现本规格时不要「补回文件名」破坏现状。

## 10. 实现顺序

1. `paste-tiers.ts` + 单测分类边界（799/800、5/6 行、9999/10000）。
2. `ComposerAttachment.kind = "paste"` + `pasteTier`；materialize 后 merge 写入。
3. `composer-attachment-rail.tsx`：`openAttachment` 增加 paste → 编辑 dialog；**零 class 变更**（理想 diff 只增分支）。
4. 编辑 dialog 组件（content dialog + 回写 / 空保存删除）。
5. `PastePlainTextPlugin`：三档；阈值下沉 medium。
6. `buildComposerSendText`：medium 跳过 path 前缀并展开全文；大档与 file 同路径。
7. i18n + 单测/组件测；**截图或 class 快照锁轨结构不变**。
8. CHANGELOG + 规格状态 → 已实现。

## 11. 测试要点

| 场景 | 期望 |
|------|------|
| 100 字 1 行 | 全文进编辑器，轨无新 tile |
| 100 字 10 行 | 中档：现网样式 tile + 正文 📎n；编辑器无全文 |
| 10_000 字 | 大档：同上 tile |
| 轨 DOM | paste tile 与 file tile 同 `h-14 w-14` / 同 border class 路径 |
| 正文 token | paste 与 file 同 `COMPOSER_CHIP_*`，仅 Paperclip+序号 |
| 中档发送 | payload 含全文，无该 paste 的 path 行 |
| 大档发送 | 与现网大粘贴金样一致（path 前缀行为） |
| 点 paste tile | content dialog 可编辑；点 image 仍 lightbox |
| 点 file tile | 仍 reveal |
| 编辑保存 / 空保存删除 | 见 §6.3–6.5 |
| materialize 失败 | 仍可插入正文 |
| 图片粘贴 | 不走文本分档 |
| 64k | 发送前 alert |

## 12. 验收要点

- 中段粘贴不再撑爆增强输入卡片。
- **肉眼：paste 与 file 附件轨无法区分样式差异**（仅点击后行为不同）。
- 正文 token 与现附件 token 同款。
- 中档发送为正文全文；大档为 path 语义。
- 小粘贴零回归；图片预览 / 文件 reveal 零回归。
- 无新轨菜单、无行数标题条、无第二套 chip。

## 13. 后续（不在本规格）

- 设置项：阈值 / 中档改 path 发送。
- 64k 失败一键「改为仅路径发送」。
- 若产品后续要在 tile 上显示 basename：须**统一**改 file + paste，单开规格，禁止只给 paste 加标题。
- 与 TUI paste-cache 互通。
