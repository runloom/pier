# Files 已删除文档与打开标签金标准

日期：2026-09-09
状态：现行权威（删除后的打开文档生命周期）
范围：磁盘路径进废纸篓或从磁盘消失时，已打开 Files 文档 tab 的去留、已删除条、保存重建、自动保存与关 tab 询问。
不包含：系统废纸篓恢复 API、树操作撤销栈、tab 删除线 / 新徽章、「删除时关 tab」设置、未保存保护对话框的三路选择文案（保存并删除 / 保留为临时文档 / 丢弃更改并删除）本身。

实施对照：状态走已有 `deletedOnDisk`；保存重建走已有 `expected: absent`；仅删除导致的 dirty 走已有 `isDeletionOnlyDirty`。

## 一句话终态

路径没了，打开着的标签还在。人继续读原来的内容。只有明确保存才把文件救回原处。关 tab 且没有额外编辑时直接关，不会问「要不要保存」从而把删除撤掉。

## 冻结决策

| 编号 | 决策 | 理由 |
|------|------|------|
| K1 | tab 代表缓冲，不代表文件句柄。路径没了 ≠ 关 tab | 关 tab 会拆 dockview 分栏、丢掉阅读现场 |
| K2 | 用户从树删除、访达 / Git / 智能体删文件，同一状态 `deletedOnDisk` | 禁止用户删除关 tab、外面删除留缓冲的双轨 |
| K3 | 删除成功后禁止因该路径调用 `closeInstance`；仍绑原磁盘路径的文档禁止 `removeDocumentsAfterPathMutation` | 今天关 tab 的根因就是这两步 |
| K4 | `deletedOnDisk` 不是 `diskConflict`。禁止为此进整页 Empty，禁止冻编辑器 | 冲突 = 盘上还有一份；删除 = 盘上没了 |
| K5 | 可写文档仍可编辑。保存按原路径重建 | 这是撤销这次删除的产品动作 |
| K6 | `deletedOnDisk` 期间自动保存不得写盘 | 否则开着自动保存会把文件写回来，删除等于没发生 |
| K7 | `isDeletionOnlyDirty` 不算未保存：tab 不亮脏点；关 tab 不走「要不要保存」 | 否则关幽灵 tab 被问保存，一点保存文件又回来 |
| K8 | 真有额外编辑时，脏点与关 tab 询问照旧；保存 = 重建 | 缓冲里有用户还没丢的字，才配未保存语义 |
| K9 | 信号是正文上方紧凑条 + 状态栏，不是 tab 删除线、不是新图标、不是成功 toast | 树行消失 + 条已是强自然反馈 |
| K10 | 不新增「删除时关 tab」设置 | 设置只放热路径和目录裁剪；行为只有一种 |
| K11 | 本标准不做树操作撤销栈，也不做从系统废纸篓恢复 | 打开着：保存即恢复。已经关 tab：走系统废纸篓 |
| K12 | 未保存保护对话框保留 | 管的是废纸篓里是哪一版、要不要换身份；不负责关不开 tab |

## 状态

打开中的磁盘文档，路径没了之后：

- `deletedOnDisk: true`
- `hasBackingStore: false`，`revision: null`
- **`diskConflict: false`**
- 缓冲、视口、预览 / 源码模式不动
- `dirty` 仍可由 `deletedOnDisk` 点亮（供草稿落盘与保存命令）；**未保存圆点与关 tab 询问只看 `isDeletionOnlyDirty` 的反面**

同一文档的所有实例共享这份状态，全部留着。

「保留为临时文档」是换身份：tab 还在，source 变成 untitled，不再走 `deletedOnDisk`。

「丢弃更改并删除」：trash 成功后先把缓冲收回上次保存内容，再标 `deletedOnDisk`（于是变成 `isDeletionOnlyDirty`）。

## 各表面

**树**  
行立刻消失。成功不加 toast。失败一次 `alert`，带路径细节。

**确认删除（用户点的）**  
干净文件：现有破坏性确认。脏文件：现有三路选择。无论哪条，只要删除成功且文档仍绑原路径 → 标 `deletedOnDisk`，不关 tab。

**正文**  
继续显示最后内容。上方一条紧凑条，几何对齐已有磁盘冲突的 `diff-chrome`（底边分割、左文案、右 28px 按钮），禁止换成整页 Empty。

- 标题：此文件已删除
- 说明：保存即可在原位置恢复。
- 主按钮：保存以恢复（走现有 `settleDocument`，不是第二条写盘）
- 没有「关闭」（用 tab 的 ×）
- 没有「从废纸篓恢复」
- 不可写 / 纯预览（`capabilities` 不含 `save` 或 `readOnly`）：只有说明，不放保存按钮

预览滚动记忆、源码光标、局部 diff 预览都不因删除而重置。

**tab**  
标题仍是文件名。不加删除线、不加新徽章。`isDeletionOnlyDirty` 无未保存圆点。

**状态栏**  
短标签：已删除。禁止「Deleted on disk」这类实现词。

**关 tab**  
`filesDocumentRequiresSaveOnClose` 为假（含 `isDeletionOnlyDirty`）→ 直接关并丢弃文档。有额外编辑 → 现有「要不要保存」。

**保存 / 自动保存**  
用户保存、条上「保存以恢复」、关 tab 时选保存：按原路径重建，清 `deletedOnDisk`。重建前盘上已有不同内容：才升格为 `diskConflict`。  
`scheduleDocumentAutoSave` 在 `deletedOnDisk` 时直接返回。崩溃保护草稿仍记下缓冲。

**自己删完再收到 watch**  
已经是 `deletedOnDisk` 则幂等，不闪冲突空态。

**文件又出现且缓冲没改过**  
`isDeletionOnlyDirty` 且盘上回来了：可以静默重新挂上磁盘。有额外编辑则护缓冲。

## 禁止

1. 因路径删除而 `closeInstance`
2. 用户删除走关 tab、外面删除走 `deletedOnDisk` 的双轨
3. `withDocumentDeletedOnDisk` 写 `diskConflict: true` 并盖整页 Empty
4. 为已删除冻编辑器
5. 自动保存把已删除文件写回来
6. `isDeletionOnlyDirty` 还亮未保存圆点，或关 tab 时问保存
7. 成功 toast
8. `closeOnFileDelete` 一类设置
9. 本标准里做废纸篓恢复 API、树撤销栈、tab 删除线
10. 再问一次「要不要关 tab」

## 否决

- **学 VS Code 应用内删除必关 tab。** 它靠资源管理器撤销把文件和上下文救回；Pier 没有这套栈，dockview 关 tab 也更重。禁止在撤销栈补齐之前复活关 tab。
- **整页「文件在 Pier 外被修改」。** 「加载磁盘版本」在文件已删除时不成立。
- **关 tab 时把「已删除」当成未保存。** 保存会撤销删除，和用户点 × 的意图相反。

## 检查点

- `tests/unit/plugins/files/deleted-open-document-tab-governance.test.ts`
- `tests/unit/renderer/files/tree/actions.test.ts`（删除后不关 tab）
- `tests/unit/renderer/files/document/live-sync.test.ts`（已删除不自动保存）
- `tests/unit/renderer/files/panel/tab-unsaved.test.ts`（仅删除不亮脏点）
