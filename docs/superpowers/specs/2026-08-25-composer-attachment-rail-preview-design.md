# 增强输入附件轨：识别优先预览

日期：2026-08-25  
状态：已实现  
范围：按需增强输入顶部附件轨的**展示**。点击分发、发送序列化、粘贴分档阈值、正文 📎 token **不变**。  
不包含：多模态 API、把文件全文灌进 renderer、第二套正文 chip。

相关：

- 附件基线：[`2026-07-21-rich-input-attachments-design.md`](./2026-07-21-rich-input-attachments-design.md)
- 粘贴分档（本规格**废止**其 §5.1 统一 56 方格视觉）：[`2026-08-10-composer-paste-tiered-ux-design.md`](./2026-08-10-composer-paste-tiered-ux-design.md)

## 1. 背景

现网轨把图片、粘贴、任意文件压成同一套 56×56 方格：图片 `object-cover` 裁切，文本只显示类型图标、不露正文、不露文件名。发送前很难确认「贴的是哪一张图 / 哪一段文字」。

增强输入叠在终端上，垂直空间仍贵，但不能牺牲识别。

## 2. 目标

1. **图片完整可见**：contain 装进方格，不裁边、不把格子拉宽。
2. **文本 / 粘贴在格内露出开头缩略**；二进制文件只放类型图标，全名在 tooltip。
3. **引用只留正文 `📎 n`**；轨上不叠 `#n`。
4. 轨是一行胶片，过多则横滑，不折行顶高终端。

## 3. 已锁定决策

| 项 | 决定 |
|----|------|
| 视觉 | **等格胶片：全部 48×48**；对齐 assistant-ui composer 附件成品（`size-14` 方格 + tooltip 名字） |
| 图片 | `object-contain` 装进 48×48，不裁、不放大；格上无文件名 |
| 文本 / 粘贴 | 48×48 **内容缩略**（开头几行），无文件名、无 `#n` |
| 其它文件 / 目录 | 格内 **只有类型图标**；文件名只在 tooltip 与 `aria-label` |
| 序号 | **轨上不画 `#n`**；引用只留正文 `📎 n` |
| 轨滚动 | `flex-nowrap overflow-x-auto`，**不折行** |
| 点击 | 不变：图 → 全屏预览；粘贴 → 编辑弹窗；其它 → 在访达中显示 |
| 发送 | 不变（中档粘贴仍展开正文，大档 / 文件仍 path） |
| 失败 | 图预览失败仍保持图身份（48×48 空框，点击全屏）；空粘贴仍是文档图标格。添加本身不阻断 |

## 4. 三种卡片

轨容器：`flex flex-nowrap gap-1 overflow-x-auto p-1`，`data-scrollbar="none"`，无附件时不占位。删除仍是右上角 ×（hover / focus 才显；隐藏时 `pointer-events-none`，避免挡住邻格）。壳 `rounded-md`，无 tile 阴影。

**轨上不画 `#n`。** 多附件靠缩略/图标 + tooltip 全名；与正文 `📎 n` 的对应靠添加顺序（数组序 = 从左到右）。

共享几何（单一来源 `composer-attachment/layout.ts`）：

| 常量 | 值 |
|------|----|
| 格子（三种卡片相同） | **48×48** |

### 4.1 图片

`kind === "image"` 且非目录（**不论**预览是否成功）：

- 有 `previewDataUrl`：contain 装进 **48×48**，**scale ≤ 1**。16:9 截图约为 48×27，上下留边。
- 竖图左右留边；小图标居中不放大。
- 预览失败 → **48×48 空框**（无 `<img>`），点击仍全屏预览。
- 轨上不叠文件名。

### 4.2 文本 / 粘贴

`kind === "paste"`，或非目录且 `textPreview` 非空：

- 格内画开头几行真实文字（`line-clamp-3`，等宽 9px），**无文件名、无 `#n`**。
- 空粘贴回退「粘贴内容」（只在无 snippet 时）。
- tooltip / 读屏：粘贴用「粘贴内容」；文本文件用 basename。
- 点粘贴仍打开编辑弹窗。

### 4.3 其它文件 / 目录

格内 **只放类型图标**：与文件树同一套 `PierFileIcon`（按扩展名着色，24px），不用 `muted` 线框。目录用文件夹图标、`text-foreground`。文件名只在 tooltip 与 `aria-label`。

## 5. 数据

`TerminalComposerAttachmentDto` / `ComposerAttachment` 增量：

```ts
previewDataUrl?: string;   // 现有
previewWidth?: number;     // 原图像素宽，仅图片预览成功时
previewHeight?: number;
textPreview?: string;      // 已裁切；粘贴创建与编辑时与 pasteContent 同步
```

### 5.1 图片缩略

main `nativeImage`：最长边缩到 320px 出 PNG data URL，单张超过 250KB 则放弃预览。宽高始终报**原图**尺寸。任意可读图片路径都可试（不限临时目录）。

### 5.2 文本缩略

常量在 `src/shared/composer-attachment-kind.ts`：

- 最多读 4096 字节
- 最多 2 行、400 个 UTF-16 单位
- 跳过开头空行，保留缩进
- 含 NUL → 当二进制，不生成 `textPreview`

尝试读取的条件：非目录、非 `kind === "image"`、扩展名不在二进制名单（压缩包 / 音视频 / PDF / 办公二进制 / 字体 / 动态库等）。无扩展名（如 `Makefile`）允许试读，靠 NUL 嗅探。

main 在 `resolvePaths` / 落盘时生成；失败省略字段。renderer **不**为预览再读盘。

粘贴编辑保存后，弹窗与发送仍以 `pasteContent` 为准；轨缩略同步已裁切的 `textPreview`。

## 6. 对既有规格的修订

### 6.1 `2026-08-10-composer-paste-tiered-ux-design.md`

废止：

- §5.1 / §11 / §12 中「必须 56×56」「paste 与 file 肉眼无法区分」「轨上不展示文件名」
- 「零 class 变更」

保留：同一条轨、同一套点击表、同一套发送语义、正文 token 外观。

### 6.2 `2026-07-21-rich-input-attachments-design.md`

§4 缩略图与 §5.1「序号徽章 + 截断文件名」的方格描述：以实现与本规格为准。图片预览不限于临时目录。

## 7. i18n

| Key | 中文 | English | 位置 |
|-----|------|---------|------|
| `terminal.composer.pasteAttachmentLabel` | 粘贴内容 | Pasted content | 文本卡标题（可见） |
| `terminal.composer.pasteAttachmentAria` | （沿用） | （沿用） | 读屏 |
| `terminal.composer.removeAttachment` | （沿用） | （沿用） | × |

禁止实现词；粘贴 tooltip / 读屏用「粘贴内容」，不要写 paste / token。格上不出现该词。

## 8. 测试要点

| 场景 | 期望 |
|------|------|
| 宽截图 | 48×48 格子里 contain；`object-contain`；无 `object-cover` |
| 小图标图 | 48×48 盒内居中，不放大 |
| 中档粘贴 | 格内可见开头片段；无「粘贴内容」标题、无 `#n` |
| `.ts` | 格内可见代码头；无文件名 |
| `.pdf` | 格内仅图标；无文件名、无 `#n`；`aria-label` 为 basename |
| 目录 | 文件夹图标；名字只在 tooltip |
| 多附件 | 无轨上 `#n`；轨 `overflow-x-auto` 不折行 |
| 点击 | 图 / 粘贴 / 文件行为与现网一致 |
| 正文 📎 | 外观不变 |

## 9. 验收

- 贴两张不同截图，不点开也能分清。
- 两段不同粘贴/文本，不点开也能从缩略分清。
- 文件格内无文件名、无 `#n`；悬停可见全名。
- 附件过多横滑，不折成第二行。
- 无预览时仍能添加、发送。
