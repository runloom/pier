# 增强输入附件设计

日期：2026-07-21  
状态：待实现（已按设计审查修订）；**编辑器 / `@` 相关非目标已由 [`2026-07-22-rich-input-structured-composer-design.md`](./2026-07-22-rich-input-structured-composer-design.md) 修订**  
范围：按需增强输入（Rich Input）上的任意文件附件：选择、粘贴、拖拽；发送时把绝对路径交给智能体自行处理。

## 1. 背景与目标

增强输入已从「智能体运行时常驻」改为按需打开。本设计补齐文件能力，使用户不必点回原生终端，也能把本地文件交给会话中的智能体。

**目标：**

- 支持回形针多选、剪贴板粘贴、拖拽；类型不限。
- 发送时只注入绝对路径文本与正文，不引入多模态协议。
- 输入框上方展示附件轨；正文可用 `[#n]` 指称附件；删除附件时序号与正文同步。
- 与现有按需开闭、草稿、Esc/点终端关闭契约兼容。

**非目标：**

- ~~contenteditable / ProseMirror / 真·行内 DOM chip。~~ → 见结构化编辑器规格（Lexical decorator chip 允许；WYSIWYG 仍禁止）。
- 缩略图灯箱、上传进度条、复制进项目目录。
- 模式/模型快捷按钮、发送历史上键（可另案）。
- 附件个数/单文件体积的产品硬顶（仍受现网 `sendText` 总长 64 000 字符上限约束，见 §2、§6）。
- ~~`@` 路径语法、相对路径、多模态 API。~~ → `@` 工作区文件/文件夹见结构化编辑器 Phase B；相对路径发送形态与多模态 API 仍禁止。

## 2. 已锁定决策

| 项 | 决定 |
|---|---|
| 文件类型 | 任意 |
| 交给智能体 | 只注入绝对路径文本 |
| 产品硬顶 | 不设附件个数/单文件字节顶；**发送载荷**受现网 `MAX_SEND_TEXT_LENGTH = 64_000` 约束 |
| 本地已有文件 | 直接使用原绝对路径，**不复制**到临时目录 |
| 无路径位图 | 写入 `os.tmpdir()/pier-terminal-pastes/` 后再作为附件 |
| 粘贴 | 附件与文本都收 |
| 展示 | 上轨 chip + 正文可选 `[#n]` + 发送时展开路径 |
| 发送 IPC | **一次** `sendText`：路径行 + 展开正文，`submit: true`（禁止空 `text`） |
| 同 path | 按绝对路径去重；已存在则不重复添加、不插入第二个 token |
| 实现基线 | **以本规格重写**契约与 main/renderer API。工作树未合入草稿仅可借鉴临时目录与清理思路；**不得**保留仅图片 filter、选文件后 copy 本地文件、history/mode/model 入口 |

## 3. 架构与数据流

```text
[回形针] ── showOpenDialog(多选, 不限类型) ──► main resolvePaths ──► 成功子集 Attachment[]
[拖拽]   ── 收集 File.path（无 path 见 §5.3）──► main resolvePaths ──► 成功子集
[粘贴]   ─┬─ 文件：File.path 列表 ───────────► main resolvePaths ──► 成功子集
         ├─ 无 path 的 image/* ──► materializeClipboard/ImageBytes ──► Attachment
         └─ 文本 ────────────────────────────► 插入 textarea（与附件并行）
[发送]   一次 sendText({
           text: paths.join("\n") + (body ? "\n" + expandedBody : ""),
           submit: true
         })
         // text 必须非空且 ≤ 64000
```

| 层 | 职责 |
|---|---|
| main | 选文件对话框；`resolvePaths`；位图/字节落盘；不读入大文件内容到 renderer |
| shared | `TerminalComposerAttachment`、结果类型、IPC 形状 |
| renderer controller | 附件列表 + 与现有 `drafts` 共用正文；paste/drop/pick；`[#n]` 改写；单次发送序列化 |
| UI | 附件轨 + textarea + 回形针；拖放命中 = 增强输入卡片 |

## 4. 数据模型

```ts
type Attachment = {
  id: string; // uuid，稳定
  path: string; // 绝对路径，去重键
  name: string; // basename
  kind: "image" | "file";
};

// panelId → 附件列表（内存）
attachmentsByPanel: Map<string, Attachment[]>
// 正文继续用 terminal-composer 现有 drafts Map，可含 [#n]
```

- 展示序号 `#n` = 下标 + 1，不写入字段。
- 数组顺序 = chip 顺序 = 发送路径顺序。
- **`kind` 判定（v1）：** 扩展名属于 `png|jpe?g|gif|webp|bmp|svg`（大小写不敏感）→ `image`，否则 `file`。不探 mime、不读文件头。
- **缩略图（v1）：** 仅 `kind === "image"` 且 path 在临时目录 `pier-terminal-pastes` 下时，可用 `file://` 或主进程只读字节生成预览；其它本地路径**默认只显示图标**（避免 CSP/权限/大图问题）。预览失败一律降级图标，不阻断添加。

正文占位：`[#n]`，n ≥ 1 的十进制数字，无空格。词法锁定：

```ts
const ATT_TOKEN = /\[#(\d+)\]/g; // 全局；数字为完整序号
```

## 5. 展示与交互

```text
┌──────────────────────────────────────────────┐
│ [#1 🖼 shot.png ×]  [#2 📄 note.pdf ×]       │  附件轨
├──────────────────────────────────────────────┤
│ 分析 [#1] 里的报错，对照 [#2] 第三节          │  textarea
│                         📎            ⏎     │
└──────────────────────────────────────────────┘
```

### 5.1 附件轨

- 顶部 `block-start`；序号徽章、类型图标、截断文件名、×。
- 无「清除全部」入口（v1 YAGNI；逐个 × 即可）。
- 无附件时不占位。

### 5.2 正文与 `[#n]`

- 纯文本 textarea。
- **每次成功追加 1 个附件后**：在**当前光标**插入 ` [#n]`（n 为追加后的新序号；左右空格按需去重，避免 `词[#1]` 粘连）。
- **一次多选/多文件 drop：** 按添加顺序依次插入多个 token，光标随每次插入后移。
- 用户可删改 token 字符；也可不写 token，只挂 chip。
- 高亮：合法序号可着色，越界警告色；v1 可先不做着色，但词法与改写必须落地。
- 不做 contenteditable 原子 chip。

### 5.3 添加入口与路径采集

| 入口 | renderer 采集 | main |
|---|---|---|
| 回形针 | 调 `pickFiles` → 得 path[] | dialog + resolve |
| 拖拽 | `dataTransfer.files`：有 `File.path` 的进 path 列表；**无 path 且 `type` 为 image/\*** 读 `arrayBuffer` 走字节落盘；无 path 非图片 → 不添加，短错误提示「无法读取该文件路径」 | resolve / materialize |
| 粘贴 | 同上看 `clipboardData.files`；**另：** 若 files 为空仅有位图，走 `materializeClipboardImage`；文本始终按浏览器默认或手动插入光标（与文件并行时：先处理文件再插文本，或 preventDefault 后手动插文本，须保证两者都在） | 同上 |

所有 path 列表（含 pick 结果）在 append 前统一：

1. 过滤已在列表中的相同绝对路径（去重，静默跳过）。
2. `resolvePaths(paths)` → **成功子集**仍添加；失败项汇总一条 alert/toast（见 §7），不阻断成功子集。
3. 每成功一项：append + 插入对应 `[#n]`。

### 5.4 删除改写算法

仅 chip × 删除附件。记被删项原序号为 k（1-based）：

1. 从数组移除该 id。
2. 正文改写（**必须**用 `ATT_TOKEN` 全局匹配，禁止朴素 `replaceAll("[#1]", …)`）：
   - 收集所有 match 的 n。
   - 去掉 n === k 的 token（邻接双空格可收成单空格，尽力即可）。
   - 对 n > k：改为 `[#(n-1)]`。
   - **从大 n 到小 n 应用替换**（或先解析成段再序列化），避免 `[#10]` 被 `[#1]` 规则误伤。
3. chip 序号随数组更新。

textarea 内 Backspace 删掉 `[#n]` 字符：**只改文案，不删附件。**

### 5.5 开闭与草稿

| 动作 | 文本 drafts | 附件 Map |
|---|---|---|
| Esc / surface 关闭 | 记忆 | 记忆 |
| 再打开同 panel | 恢复 | 恢复 |
| 发送成功 | 清空 | 清空 |
| 发送失败且**未投递** | 保留 | 保留 |
| 发送已投递但结果失败（见 §6） | 清空 | 清空 |
| 资格失效卸载 | 记忆 | 记忆 |

`canSend` = `expandedPayload.length > 0`（见 §6），即至少有一个附件或 trim 后正文非空，且通过 64k 与 token 校验前的「有内容」判断；真正发送前再跑完整校验。

## 6. 发送序列化（钉死）

### 6.1 组装载荷

```ts
function buildSendText(attachments: Attachment[], draft: string): string {
  const paths = attachments.map((a) => a.path);
  const expandedBody = expandTokens(draft, attachments); // 合法 [#n] → path
  const parts = [...paths];
  if (expandedBody.trim() !== "") {
    parts.push(expandedBody);
  }
  return parts.join("\n");
}
```

- **禁止** `sendText({ text: "", … })`（现网 `parseSendTextArgs` 拒绝空串）。
- **仅附件：** `text = path1 + "\n" + path2 + …`（最后一项后无强制多余换行；`join("\n")` 即可），`submit: true`。
- **仅正文：** 与现网一致，展开后正文（无路径前缀），`submit: true`。
- **附件 + 正文：** 路径块与展开正文之间一个 `\n`。

### 6.2 发送前校验（失败则中止，不调用 sendText）

1. 用 `ATT_TOKEN` 扫正文：若存在 n < 1 或 n > attachments.length → alert「存在无效的附件引用 [#n]」，中止。
2. `payload = buildSendText(...)`；若 `payload.length === 0` → return（按钮应已 disabled）。
3. 若 `payload.length > 64_000` → alert 说明内容过长（可提示减少附件或正文），中止。

### 6.3 单次 IPC

```ts
const result = await window.pier.terminal.sendText({
  panelId,
  text: payload,
  submit: true,
});
```

**一次调用**，消除多段 paste 半成功窗口。

### 6.4 结果处理

| 结果 | 行为 |
|---|---|
| `ok: true` | 清 drafts + 清附件 + `onClose` |
| `ok: false` 且 `textDelivered: true` | 同上清空关闭 + `showAppAlert` 详情（路径/正文已进智能体草稿，禁止重试重复贴） |
| `ok: false` 且未投递 | **保持打开**，附件与正文不动 + alert |

（单次 IPC 下「中途半成功」不再适用；若未来改回多段，必须把「任一次 paste 成功」视同已投递并清空关闭。）

### 6.5 发给智能体的形态示例

```text
/abs/path/to/shot.png
/abs/path/to/note.pdf
分析 /abs/path/to/shot.png 里的报错，对照 /abs/path/to/note.pdf 第三节
```

路径含空格**不加引号**。

## 7. main 侧行为

### 7.1 API 形状（逻辑名，实现时对齐 preload）

- `pickComposerFiles(): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>`  
  - 取消 → `ok: true, paths: []`（非错误）。
- `resolveComposerPaths(paths: string[]): Promise<{
    attachments: TerminalComposerAttachment[]; // 成功子集
    failures: { path: string; reason: string }[];
  }>`
- `materializeComposerImageBytes(data: { bytes: Uint8Array|number[]; mime?: string; name?: string }): Promise<…单附件或 error>`
- `materializeComposerClipboardImage(): Promise<…>`（无图 → 空成功）

### 7.2 resolve 规则

- `stat`：必须是文件、可读；目录 / ENOENT / EACCES → 写入 `failures`，不进 `attachments`。
- **部分失败：** 返回成功子集 + failures；renderer 添加子集并插入 token，并对 failures 一次 `showAppAlert` 或 `toast.error`（多条 reason 合并文案）。
- **整批 path 皆失败：** 不改附件列表；只报错。
- 不设单文件字节顶；不把文件内容读进 renderer（除 image 字节落盘路径）。

### 7.3 临时目录

- 仅服务无路径位图/图片字节。
- 可选：启动时清理超过 24h 的 `pier-terminal-pastes` 文件（借鉴草稿即可）。

## 8. 与按需增强输入的集成

- 挂载门：`open && activityKind === "agent" && !restored`。
- 附件 Map 与 drafts 均按 `panelId`；不依赖常驻挂载。
- surface 关闭：persist 正文 + 附件已在 Map 中。
- activate / `focusRequest` / Ctrl+C / Esc 关闭语义不变。

## 9. i18n

- 添加文件 / Add file  
- 移除附件 / Remove attachment  
- 无法读取文件路径 / Couldn’t read that file path  
- 部分文件无法添加（带汇总 reason）  
- 无效附件引用 / 内容过长无法发送  
- 发送失败详情仍走 `showAppAlert`  

禁止用户可见「富文本」；产品名：增强输入 / Rich Input。

## 10. 测试

**必须覆盖：**

- main：resolve 成功/目录/不可读；部分失败子集；选文件取消；位图落盘。
- `ATT_TOKEN` 改写：删中间项；`[#10]` 不被 `[#1]` 误伤；从大到小重编号。
- 发送：`buildSendText` 仅附件 / 仅正文 / 混合；展开；越界 token 拒发；>64k 拒发。
- 单次 `sendText` mock：一次调用，`submit: true`，text 非空。
- `ok` / `textDelivered` / 未投递 三种结果对草稿与附件的清理。
- 去重：同 path 第二次添加不增 chip、不插 token。
- 粘贴：files+text；无 path 图片字节；无 path 非图片提示。
- 关闭再打开：正文 + 附件恢复；发送成功后皆空。
- 回归：无附件时 Esc/发送/surface/activate 与现网一致。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 64k 上限 | 发送前校验；文案提示 |
| File.path 缺失 | 图片走字节；其它明确错误 |
| 高亮层 scroll | v1 可无高亮 |
| 未合入草稿误导 | §2 写死重写边界 |
| 自动插入 token 打扰 | 可手删字符；不删附件 |

## 12. 实现顺序

1. shared 契约 + main pick/resolve/materialize + 单测（含部分失败）  
2. 纯函数：`ATT_TOKEN` 展开/删除重编号/`buildSendText` + 单测  
3. controller：Map、去重、pick/paste/drop、单次发送与结果分支  
4. UI 附件轨 + 回形针 + 接到 `TerminalComposer` 草稿/开闭  
5. i18n + 组件/e2e 回归  

## 13. 验收要点

- 任意类型多选、拖拽、粘贴可加附件；同 path 不重复。  
- 删 chip 后 `[#n]` 与序号一致，`[#10]` 安全。  
- 仅附件也可发送成功（非空 path 载荷 + submit）。  
- 智能体侧一次收到路径（及展开正文）；无裸 `[#n]`。  
- 超 64k / 越界 token 发送前拦截。  
- 无附件时增强输入行为不回退；关开同面板草稿（文+附件）可恢复。
