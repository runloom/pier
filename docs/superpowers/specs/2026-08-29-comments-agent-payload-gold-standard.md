# 评论交给智能体：payload 金标准

日期：2026-08-29  
状态：现行权威（写入智能体输入框的评论文案）  
范围：git-diff / markdown / canvas 三种评论的交接文案，以及 markdown 原位钉住不得靠最近标题。  
不包含：编辑器 `code` 行评论、模糊重挂、坐标 pin、存储 schema 迁移、excerpt 改为源切片（可后置）。

与归档设计 [`2026-08-11-reading-comments-anchor-and-agent-handoff-design.md`](../../archive/superpowers/specs/2026-08-11-reading-comments-anchor-and-agent-handoff-design.md) 冲突时：**交接文案以本文为准**。该文「payload 必须带 `[located|stale]` + excerpt」作废。存储锚点、blob 防空挂、无 id 的 canvas 不钉随机节点，仍以该文与数据模型为准。

## 一句话终态

智能体只收到它能自己 Read 的定位器 + 用户评论正文。投影状态、IR 摘录、DOM 摘录、最近标题 slug 一律不进 payload。钉住对错是预览/审查 UI 的事。

## 分层

| 层 | 职责 | 允许 | 禁止 |
|----|------|------|------|
| 存储锚点 | 创建后不可变 | path、行号、`contentHash` / `blobOid` / `anchorId`、可选 excerpt（只给 UI） | 用投影态回写 target |
| 原位 UI | 精确钉 / 漂移折叠 | blob+hunk、块 hash、声明式 `anchorId` | 仅凭行号或最近标题画精确高亮 |
| 智能体 payload | 让智能体找到源 | `path:line`、`path:start-end`、`path#anchorId`、old 侧标注 + 正文 | 投影标签、IR/DOM 摘录、heading slug |

## `[located]` 为何不准

`[located]` / `[stale]` / `[soft]` / `[unknown]` 是 Pier 投影态，不是文件里的东西。终端「提交并清除」走 `projectProcessableComments`：只读已打开的 markdown/canvas 预览 surface，**从不传 `gitDiffPatches`**。因此 git 评论在生产路径恒为 `[unknown]`；markdown 预览未开同样是 `[unknown]`；即便标 located，markdown 证据还经常是「最近上方标题还在」。

补救不是把审查 patch 接到终端弹窗，而是 payload 不带投影标签。

## Payload 格式

```text
Please address these comments:

## Review
- `src/a.ts:42`: rename helper
- `src/b.ts:18` (old): 不要删这条守卫

## Document
- `docs/plan.md:42-58`: 这里把步骤写清楚

## Canvas
- `.pier/canvases/login.canvas.tsx#login-submit`: 主按钮改成提交
```

| kind | 定位器 | 不要 |
|------|--------|------|
| git-diff new | `` `path:line` `` | 状态标签、group 名、行文本、blobOid |
| git-diff old | `` `path:line` (old) `` | 同上 |
| markdown | `` `path:start-end` ``（单行则 `path:start`） | `#headingId`、IR excerpt |
| canvas 有 `anchorId` | `` `path#anchorId` `` | DOM label/excerpt、`[soft]` |
| canvas 无 id | `` `path` `` | 假装知道是哪个节点 |

硬规则：

1. 每条 = `- ` + 定位器 + `: ` + 评论正文。
2. 分组标题 `## Review|Document|Canvas` 保留（kind 分组，不是投影态）。
3. 引导句给智能体，用英文，不走用户 locale。chip 标签仍走 i18n「评论 · N」。
4. `git-file` 不进 processable（审查 drift 折叠专用）。

## Markdown 原位钉住

精确块钉 **只认 `contentHash`**。`headingId` 不得单独把线程标成 located，也不得在 hash 未命中时回退钉到章节标题。行号只作 reveal 弱提示与 payload 定位器。

评论粒度仍是预览 top-level 块的源实行范围，不是编辑器选区。

## 禁止

1. 把投影态写进智能体输入框。
2. 用 IR/DOM 重建「对应内容」冒充源文件。
3. 为让 `[located]` 变绿而把审查 patch 总线接到终端提交路径。

## 不是缺陷

- 预览没打开时 UI 无法原位高亮：列表仍可提交，智能体按路径自己读。
- hash/blob 变了，UI 标漂移，payload 仍给创建时的行号。
- canvas 无声明式 id 只能文件级。

## 检查点

- `tests/unit/renderer/lib/comments-processable.test.ts`（G0–G3：无投影标签、markdown 行范围、git `(old)`、canvas `path#id`）
- `tests/unit/renderer/lib/comments-project-thread.test.ts`
- `tests/unit/plugins/files/markdown-comment-block-text.test.ts`
- `tests/unit/plugins/files/markdown-comment-target.test.ts`

G0–G3 全绿前不得宣称本交接金标准完成。
