# 增强输入附件设计

日期：2026-07-21  
状态：待实现  
范围：按需增强输入（Rich Input）上的任意文件附件：选择、粘贴、拖拽；发送时把绝对路径交给智能体自行处理。

## 1. 背景与目标

增强输入已从「智能体运行时常驻」改为按需打开。本设计补齐文件能力，使用户不必点回原生终端，也能把本地文件交给会话中的智能体。

**目标：**

- 支持回形针多选、剪贴板粘贴、拖拽；类型不限。
- 发送时只注入绝对路径文本与正文，不引入多模态协议。
- 输入框上方展示附件轨；正文可用 `[#n]` 指称附件；删除附件时序号与正文同步。
- 与现有按需开闭、草稿、Esc/点终端关闭契约兼容。

**非目标：**

- contenteditable / ProseMirror / 真·行内 DOM chip。
- 缩略图灯箱、上传进度条、复制进项目目录。
- 模式/模型快捷按钮、发送历史上键（可另案）。
- 大小/数量硬顶（仅异常兜底）。
- `@` 路径语法、相对路径、多模态 API。

## 2. 已锁定决策

| 项 | 决定 |
|---|---|
| 文件类型 | 任意 |
| 交给智能体 | 只注入绝对路径文本 |
| 限额 | 不设硬顶；读盘/权限失败再报错 |
| 本地已有文件 | 直接使用原绝对路径，不复制 |
| 无路径位图 | 写入系统临时目录后再作为附件 |
| 粘贴 | 附件与文本都收 |
| 展示 | 上轨 chip + 正文可选 `[#n]` + 发送时展开路径 |
| 实现基线 | 扩展现有未合入 attachments 草稿骨架（方案 A） |

## 3. 架构与数据流

```text
[回形针] ── showOpenDialog(多选, 不限类型) ──► main 校验可读 ──► Attachment[]
[拖拽]   ── File.path ───────────────────────► main 校验可读 ──► Attachment[]
[粘贴]   ─┬─ 文件路径列表 ───────────────────► main 校验可读 ──► Attachment[]
         ├─ 仅图片字节 ──► pier-terminal-pastes 临时文件 ──► Attachment[]
         └─ 文本 ────────────────────────────► 插入 textarea 草稿
[发送]   路径按序逐行 sendText(path+"\n", submit:false)
         → 正文（[#n] 展开为绝对路径）sendText(submit:false)（若展开后非空）
         → submit / Return
```

| 层 | 职责 |
|---|---|
| main `terminal-composer-attachments` | 选文件对话框；路径可读校验；剪贴板位图落盘；返回附件结果 |
| shared 契约 | `TerminalComposerAttachment`、IPC 入参/出参 |
| renderer controller | 附件列表与正文草稿；paste/drop/pick；发送序列化；与开闭协作 |
| UI | 附件轨 + textarea + 回形针；拖放命中区为增强输入卡片 |

路径策略：

- 选择 / 拖拽 / 剪贴板文件列表 → **原绝对路径**。
- 仅剪贴板位图 → `os.tmpdir()/pier-terminal-pastes/<uuid>.ext`。
- 注入终端的字符串永远是绝对路径。

## 4. 数据模型

```ts
type Attachment = {
  id: string; // uuid，稳定，用于删除与列表 key
  path: string; // 绝对路径
  name: string; // basename，用于 chip 文案
  kind: "image" | "file";
};

// 每个终端面板一份（内存 Map；文本草稿与现有 drafts Map 合并为同一套 panel 草稿，
// 不要并行维护两份正文状态）
attachmentsByPanel: Map<string, Attachment[]>
// 正文仍走现有 drafts.get/set(panelId)，可含 [#n]
```

展示序号 `#n` = 数组下标 + 1，**不**写入 attachment 字段。数组顺序 = 展示顺序 = 发送路径顺序。

正文占位语法：`[#n]`（n ≥ 1，十进制，无空格）。

## 5. 展示与交互（金标准）

```text
┌──────────────────────────────────────────────┐
│ [#1 🖼 shot.png ×]  [#2 📄 note.pdf ×]       │  附件轨
├──────────────────────────────────────────────┤
│ 分析 [#1] 里的报错，对照 [#2] 第三节          │  textarea
│                         📎            ⏎     │
└──────────────────────────────────────────────┘
```

### 5.1 附件轨

- 位置：输入卡片顶部（`block-start`）。
- 每项：序号徽章、类型图标（图片 / 通用文件）、截断文件名、移除按钮。
- 图片：有可读预览源时显示小缩略，失败则降级为图标；非图片只用类型图标。缩略为增强，不是发送前提。
- 无附件时不占位。

### 5.2 正文与 `[#n]`

- 仍为纯文本 `textarea`（保持 IME 与终端焦点模型简单）。
- **添加附件时**：在光标处插入 ` [#n]`（自动补两侧空格，避免粘词）。
- 用户可编辑或删除这些字符；也可不写 `[#n]`，只依赖附件轨（与 Claude 式「只挂附件」兼容）。
- **高亮（推荐轻量）**：合法 `[#n]`（n ∈ 1..length）用底层 mirror 或同类技法着色；越界 `[#n]` 用警告色。v1 若工期紧，等宽字面量可先不上色，但语法与改写规则必须落地。
- **明确不做** contenteditable 原子 chip。

### 5.3 添加入口

| 入口 | 行为 |
|---|---|
| 回形针 | 系统多选，不限类型 → 校验 → append → 按添加顺序在光标插入 `[#n]` |
| 拖拽到卡片 | 同上；`dragover` 需 `preventDefault` |
| 粘贴 | 有文件/图片则加入附件并插入 token；同时有文本则文本仍插入光标。仅当成功处理了文件/图片时 `preventDefault`，避免图片被粘成乱码；纯文本走默认插入 |

### 5.4 删除

**仅 chip 的 ×（或「清除全部」）删除附件**，一次事务：

1. 从数组移除该 `id` 项（记原序号 k）。
2. 正文单次改写：
   - 去掉所有 `[#k]`（并收敛邻接多余空格，避免双空格脏文案即可，不必完美）。
   - 对所有 m > k：`[#m]` → `[#m-1]`。
3. 芯片序号随数组自动更新。

**Backspace 在 textarea 内删掉 `[#n]` 字符：只改文案，不删附件。**  
避免误伤；附件生命周期与 chip 绑定。这是相对 contenteditable 原子 token 的刻意简化。

### 5.5 开闭与草稿

| 动作 | 文本草稿 | 附件列表 |
|---|---|---|
| Esc / 点终端 surface 关闭 | 按 panel 记忆 | 按 panel 记忆 |
| 再次打开同 panel | 恢复 | 恢复 |
| 发送成功 / textDelivered | 清空 | 清空 |
| 发送失败且未投递 | 保留 | 保留 |
| 智能体资格失效卸载 | 记忆保留 | 记忆保留 |

`canSend` = 正文 `trim` 非空 **或** 附件非空。

再次「打开增强输入」仍走既有 `focusRequest` 聚焦。

## 6. 发送序列化

严格顺序：

1. `disabled` 或（无附件且正文为空）→ return。
2. 发送前校验：正文中若存在越界 `[#n]`（n < 1 或 n > length）→ `showAppAlert`，中止，不发送。
3. 对每个 attachment（数组序）：`sendText({ text: path + "\n", submit: false })`。
4. 若展开后正文非空：`sendText({ text: expandedBody, submit: false })`。  
   - 展开：合法 `[#n]` → 对应 `path`；无 token 则正文原样。
5. 最后一次带 submit 的发送（与当前增强输入 `submit: true` 等价，复用既有 IPC）。
6. 全成功 → 清文本 + 清附件 + `onClose`。
7. 任一步失败：
   - 已有 `textDelivered` → 清并关 + 失败详情 alert（避免重复粘贴路径进智能体草稿区）。
   - 否则保持打开，附件与正文不动 + alert。

发给智能体的形态示例：

```text
/abs/path/to/shot.png
/abs/path/to/note.pdf
分析 /abs/path/to/shot.png 里的报错，对照 /abs/path/to/note.pdf 第三节
```

路径列表在前，便于只扫路径的智能体；正文内展开路径，便于叙述性指令。不把 `[#n]` 原文丢进 TUI。

路径含空格时**不加引号**（按字面写入智能体输入区；加引号会变成模型看到的字符）。若未来某智能体需要 shell 引号，另案处理。

## 7. main 侧行为

- `pickTerminalComposerFiles`：多选，filter 为全部文件；取消 → ok 且空列表。
- `resolveTerminalComposerPaths(paths: string[])`：逐个 `stat`；必须是文件且可读；目录与不可读计入错误信息；成功的返回 attachment 元数据。
- `materializeTerminalClipboardImage`：位图空则跳过；写出临时文件；保留现有 24h 清理思路（可选，实现时沿用草稿）。
- 不设字节/数量硬顶；异常消息面向用户可理解（权限、不存在、不是文件）。

IPC 命名与契约放在 `src/shared/contracts/terminal.ts`，与现有 `sendText` 并列；具体命令名实现阶段与 preload 对齐。

## 8. 与按需增强输入的集成点

- 仍仅在 `open && agent && !restored` 时挂载。
- controller 挂在 `TerminalComposer` 内或并列 hook；附件状态不得依赖「常驻挂载」。
- surface takeover 关闭前：已 persist 文本；附件 Map 同步写入。
- 不改变 activate refocus / `focusRequest` / Ctrl+C 透传 / Esc 关闭（Esc 仍关增强输入并记草稿，不向 TUI 透传 Esc）。

## 9. i18n（用户文案）

新增/调整键（中英都要）：

- 添加文件 / Add file  
- 移除附件 / Remove attachment  
- 添加失败 / 发送失败详情走既有 alert 模式  
- 占位可保持「在此输入，发送到终端中的会话」；有附件时不必改 placeholder  

禁止用户可见「富文本」；产品名保持增强输入 / Rich Input。

## 10. 测试

- main：路径校验、目录拒绝、位图落盘、选文件取消。
- 正文改写：删中间附件后 `[#n]` 重编号；越界 token 发送被拒。
- 发送顺序：mock `sendText` 调用序列（路径行 → 展开正文 → submit）。
- 粘贴：文件 + 文本同时；仅文本不 preventDefault 文件逻辑误伤。
- 组件：chip 移除、canSend 仅附件也可发送。
- 回归：无附件时增强输入行为与现网一致（Esc/发送关闭、surface/activate）。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| textarea 与高亮层 scroll 不同步 | v1 可先无高亮；有高亮必须绑 scroll 事件 |
| 自动插入 `[#n]` 打扰只想挂文件的用户 | 插入可撤销；用户删字符即可；不删附件 |
| 大文件无硬顶导致卡顿 | 仅校验可读，不读入 renderer 全量；位图才写临时盘 |
| Electron `File.path` 非标 | 仅 desktop；无 path 时图片走字节落盘，其它提示无法添加 |
| 与未合入 attachments 草稿命名冲突 | 实现时统一「文件」语义，去掉仅图片 filter |

## 12. 实现顺序建议

1. shared 契约 + main 校验/选文件/位图落盘 + 单测  
2. controller：附件 Map、`[#n]` 插入与删除改写、发送序列化  
3. UI：附件轨 + 回形针 + paste/drop  
4. 接到 `TerminalComposer` 与草稿/开闭  
5. i18n + 组件/e2e 回归  

## 13. 验收要点

- 任意类型多选、拖拽、粘贴可加附件。  
- 上方 chip 序号与正文 `[#n]` 在删除后保持一致。  
- 发送后智能体侧先见绝对路径，正文中的 `[#n]` 已展开为路径。  
- 无附件时增强输入行为不回退。  
- 关闭再打开同面板，文本与附件草稿仍在（发送成功后清空）。
