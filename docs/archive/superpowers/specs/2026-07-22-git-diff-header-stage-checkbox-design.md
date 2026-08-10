# Git Diff 头 Stage Checkbox 设计

日期：2026-07-22  
状态：已实现（控件为 +/- 按钮，非 checkbox；见 packages/ui DiffHeaderActions）  
范围：Changes 面板 multi-diff 文件头

## 1. 问题

当前 uncommitted multi-diff 为区分半暂存，把分组写进路径文案：

- `暂存的更改 · path/to/file.ts`
- `更改 · path/to/file.ts`

问题：

1. 路径被污染，扫读、复制、搜索都变差。
2. 与左侧树分组重复。
3. 暂存态被说成文案，而不是可操作控件。

## 1.1 已实现说明

落地时采用 **Unstage(−) / Stage(+) / Restore** 图标按钮簇，而不是原生 checkbox：
- 半暂存仍两行 diff；路径保持真实相对路径。
- `stageControl.state`：`unstaged | staged`；conflict 不显示 stage 簇。
- loading 占位仍可 stage；stats/stateNotice 仅 ready 后显示。

## 2. 目标

1. 文件头路径只显示真实仓库相对路径（rename 仍可带 previousPath）。
2. 在变更类型图标前增加可点 Stage checkbox：
   - 勾选 = 已暂存
   - 未勾选 = 未暂存
3. 半暂存仍渲染两行 diff，靠 checkbox 区分，不靠改文件名。
4. 树分组保持不变；本设计不改树 UI。

## 3. 非目标

- 不做 multi-diff 多选批量 checkbox。
- 不恢复 commit composer / AI 生成提交说明。
- 不把 stage 语义塞进 A/M/D 类型图标。
- 不在 commit / branch 只读审阅范围显示 stage checkbox。

## 4. 布局

每个 diff 文件头：

```text
[▸ 折叠] [☑/☐ stage] [A/M/D 类型]  path/to/file.ts                 -n +m
```

从左到右：

1. 现有折叠控件
2. **Stage checkbox**（本设计新增）
3. 现有变更类型图标（added / modified / deleted / renamed 等）
4. 纯路径
5. 右侧 ± 统计（现有）

## 5. 交互

| 行类型 | checkbox | 点击 |
| --- | --- | --- |
| unstaged | 未勾选 | `git.stage(paths)` |
| staged | 已勾选 | `git.unstage(paths)` |
| conflict | 不显示 | 不切换 stage |
| commit / branch scope | 不显示 | 只读浏览 |

细则：

- 进行中：checkbox `disabled` / busy，防止连点。
- 失败：走现有 git 错误反馈（面向用户的 alert / 通知），禁止静默失败。
- 路径集合：与树右键单文件一致（`targetPath` + 必要的 `oldPaths`）。
- 无障碍：
  - 未勾选：`aria-label` = 「暂存更改」
  - 已勾选：`aria-label` = 「取消暂存更改」
- 点击 checkbox 不得触发行折叠 / 选中跳转。

## 6. 架构边界

### 6.1 projection（git 插件）

`git-review-document-projection.ts`：

- `fileDisplay.path` 恢复为 `slot.targetPath`（去掉 `groupLabel ·` 前缀）。
- 为 uncommitted 的 staged / unstaged slot 附加 stage 元数据，例如：

```ts
stageControl?: {
  state: "staged" | "unstaged";
  // 供 UI 回调稳定定位；真实 git 路径仍来自 section/slot
  sectionKey: string;
} | null;
```

- conflict / committed：`stageControl = null`。

### 6.2 `packages/ui` diff header

- header 在类型图标前渲染可选 stage checkbox slot。
- UI 包只负责展示与点击回调，**不** import git 插件或执行 git 命令。
- 通过 item / header 渲染上下文接收：
  - `stageState`
  - `busy?`
  - `onToggleStage?`
- 无 `stageControl` 时不渲染 checkbox，保持 commit/branch 与旧调用方兼容。

### 6.3 git 插件接线

- Changes / ReviewDocuments 提供 `onToggleStage(sectionKey)`。
- 内部解析对应 slot/fileRef，调用现有 `context.git.stage` / `unstage`。
- 复用树动作的路径规则，避免第二套 stage 路径语义。

### 6.4 树

- 继续用「暂存的更改 / 更改 / 合并更改」分组。
- 本设计不要求树侧增加 checkbox。

## 7. 文案

| key（建议） | en | zh-CN |
| --- | --- | --- |
| stage checkbox 未勾选 | Stage Changes | 暂存更改 |
| stage checkbox 已勾选 | Unstage Changes | 取消暂存更改 |
| 进行中（可选 title） | Staging… / Unstaging… | 正在暂存… / 正在取消暂存… |

路径本身不再出现「暂存的更改」「更改」前缀。  
diff 组头前缀（若仍用于其它表面）与本文件头路径解耦。

## 8. 测试

1. projection：uncommitted item 的 `fileDisplay.path` 为纯路径；带 `stageControl`。
2. projection：half-staged 两行 path 相同，`stageControl.state` 分别为 staged / unstaged。
3. projection：conflict / committed 无 checkbox 元数据。
4. UI header：有 stageControl 时渲染 checkbox；点击触发回调且不折叠。
5. 插件：toggle staged → unstage；toggle unstaged → stage；失败有用户可见错误。
6. 回归：树分组、右键 stage、section 锚定不受影响。

## 9. 风险与取舍

1. **checkbox 被误读成多选**  
   缓解：`aria-label` 使用暂存语义；不提供 shift 多选；不与行选中模型绑定。

2. **半暂存两行同 path**  
   接受：这是准确模型；靠 checkbox 与树分组区分，不再靠路径前缀。

3. **header 自定义能力受 `@pierre/diffs` 约束**  
   优先走现有 `packages/ui` header 组合点；若槽位不够，再评估最小 patch，而不是业务层 DOM hack。

## 10. 实现顺序（建议）

1. projection 去掉路径前缀 + 增加 `stageControl` 元数据与单测。
2. `packages/ui` header 增加 checkbox slot 与回调。
3. git 插件接 `onToggleStage` 与 busy/错误处理。
4. 组件/单测补齐后做 Changes 面板手测（半暂存、冲突、只读 scope）。

## 11. 已确认决策

- 控件形态：可点 Stage checkbox（非 +/- 按钮，非只读圆点）。
- conflict：不显示 checkbox。
- 先写设计，再写实现计划，最后编码。
