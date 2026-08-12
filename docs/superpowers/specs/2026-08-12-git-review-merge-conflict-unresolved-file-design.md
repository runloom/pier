# Git Review 冲突详情：官方 UnresolvedFile 标准接法

日期：2026-08-12  
状态：**已落地终态实现**（官方 `UnresolvedFile` + write/`ours`/`theirs` 闭环；2026-08-12）  
引擎依据：`@pierre/diffs@1.2.12`（`UnresolvedFile`、`parseMergeConflictDiffFromFile`、`resolveConflict`）；官方文档 [diffs.com](https://diffs.com/) / [docs](https://diffs.com/docs)  
与金标准关系：补全 `conflicted` 的 **content 正文**；**不**改写多文件 CodeView 为默认整页单文件。冲突详情走 **专用原语**，与普通 diff 并列，而非塞进 `CodeView` 假扮。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| `2026-07-31-git-review-gold-standard-endstate-design.md` | SCM Review 终态权威（多文件、bodyClass、ledger） | **继承**；冲突文件 bodyClass=content 的正文由本文定义 |
| `2026-07-27-diffshub-full-alignment-design.md` | CodeView 单实例 / scroll 单写者 | **普通 diff 仍遵守**；冲突 **不**并入 CodeView 成员 id 集 |
| **本文** | 冲突详情 + 解析 UI 的唯一实现权威 | 冲突渲染 / 契约 / 写盘闭环 |

**实现禁令：**

1. 禁止把 conflict 当 `git diff` patch 再 `processFile`。
2. 禁止用 `CodeView` 的 `type: "diff"` 塞 `parseMergeConflictDiffFromFile` 结果，却宣称「已接官方 conflict UI」。
3. 禁止继续用唯一 `ready-notice: Merge conflict — resolve in the editor` 充当详情终态（过渡 PR 可并存，G2 后必须撤）。
4. 禁止在 multi-file `CodeView` 内硬接 `UnresolvedFile` 实例当 item（上游无此 item type）。

---

## 0. 一句话

> **冲突正文的官方标准入口是 `UnresolvedFile`：输入 = worktree 带 markers 的 `FileContents`；展示 / Accept = Pierre 内置 conflict 原语；写盘与 `git add` 是宿主义务。普通变更仍走 CodeView 多文件流。**

---

## 1. 官方能力（冻结事实）

### 1.1 组件边界

| 原语 | 用途 | Pier 现状 |
|------|------|-----------|
| `FileDiff` / `CodeView` item `type: "diff"` | 普通 patch / 双文件 diff | review 主路径 |
| `File` / item `type: "file"` | 无 diff 单文件 | 非冲突主路径 |
| **`UnresolvedFile`** | **merge conflict markers + resolution UI** | **未接** |

官方文案摘要：

- Merge conflict resolution UI：current / incoming 结构化为 addition/deletion，**不跑文本 diff**。
- 解析：`current` | `incoming` | `both`，即时预览。
- `UnresolvedFile`：**beta/experimental**，API 可能变 → 必须包 adapter，禁止业务直接散落调用底层 parse/resolve。

### 1.2 标准数据流（Pierre）

```
FileContents { name, contents, cacheKey? }
        │
        ▼
parseMergeConflictDiffFromFile(file, maxContextLines?)
        │  current → deletionLines
        │  incoming → additionLines
        │  ||||||| base → optional context
        │  markerRows + MergeConflictDiffAction[]
        ▼
UnresolvedFile（UnresolvedFileHunksRenderer）
        │  data-has-merge-conflict / data-merge-conflict=*
        │  Accept Current | Incoming | Both
        ▼
resolveConflict → 更新 FileDiffMetadata（预览）
        │
        ▼
宿主：写出最终 contents → 磁盘 → git add（可选）
```

### 1.3 与 CodeView 的硬边界

`CodeView` 内部仅：

- `type: "diff"` → `VirtualizedFileDiff`
- `type: "file"` → `VirtualizedFile`

**没有** unresolved 槽位。因此：

- **官方标准接法 = 独立 `UnresolvedFile` 宿主**，不是 CodeView 成员。
- 多文件金标准：**普通 content 槽仍在 CodeView**；**当前聚焦的冲突文件**切到 Unresolved 表面（或同 panel 内替换正文区）。

---

## 2. 现状缺口（Pier）

| 层 | 行为 | 问题 |
|----|------|------|
| index | porcelain `u` → `group=conflict` | 正确；**丢弃** stage OID / XY 细节 |
| document | `kind: "state", reason: "conflict"`，**拒绝** patch | 无 markers / 无 contents |
| projection | `ready-notice` | 仅文案「到编辑器解决」 |
| bodyClass | `conflicted` → content | 进槽但无真正文 |
| UI | 仅 `PierDiffView` / CodeView | 未挂 `UnresolvedFile` |
| 写路径 | 无 accept ours/theirs / mark resolved | 只能 Open in Editor |

---

## 3. 产品模型

### 3.1 阅读面

| 场景 | UI |
|------|-----|
| unstaged / staged / committed 普通文本变更 | 现有 multi-file `CodeView`（不变） |
| conflict 组列表 + 多文件导航 | 侧栏仍全量；**正文默认不把冲突当 CodeView item** |
| 选中 **可结构化** 冲突文件 | 正文区 = **`UnresolvedFile` 单文件**（官方标准） |
| 选中 **不可结构化** 冲突 | 说明卡 + 文件级动作（ours / theirs / 打开） |
| 冲突 + 同 entry 其它组 | 按现有 surface；conflict 槽优先走 Unresolved 宿主 |

### 3.2 与「始终多文件」的关系

金标准禁止 **默认** Codex 式「整页只开一个文件」当 **普通 diff** 终态。  
冲突例外：

- 官方原语本身是单文件。
- 侧栏仍可浏览全部冲突文件；切换 path 即换 `UnresolvedFile` 的 `file` prop。
- **不**要求把多个 Unresolved 实例虚拟进同一滚动容器（上游不支持）。

### 3.3 冲突分类

| 类 | 判定 | 渲染 |
|----|------|------|
| **markers-text** | worktree UTF-8 文本，含完整 conflict marker 栈 | `UnresolvedFile` |
| **file-level** | XY ∈ {DD, AU, UD, UA, DU} 等无可靠 markers，或解析失败 | 文件级 notice + 动作 |
| **binary** | 含 `\0` / 非文本 | binary notice + 选版本（后期） |
| **too-large / encoding** | 沿用 snapshot 上限 | 既有 state 文案 + 打开文件 |

`parseMergeConflictDiffFromFile` 在未闭合 marker 栈时 **throw** → 降级 file-level 或 raw 打开，禁止白屏。

### 3.4 解析动作分期

| 期 | 行为 |
|----|------|
| **P0** | 展示：`UnresolvedFile` + `mergeConflictActionsType: "none"` **或** default 仅内存预览、**不写盘**；主 CTA = Open in Editor |
| **P1** | Accept → 写 worktree（fingerprint 防覆盖）→ `git add -- path` → refresh index |
| **P2** | 文件级 ours/theirs（`git checkout --ours/--theirs` + add）、binary 选版本 |

P0 即「官方标准展示」；P1 才是完整 resolution 闭环。

---

## 4. 契约

### 4.1 Document section（新增）

在 `gitReviewFileSectionSchema` 增加（与 `patch` / `state` 并列）：

```ts
// 示意 — 实现以 zod 为准
{
  kind: "conflict",
  sectionKey: string,
  status: "conflicted",
  targetPath: relativePath,
  oldPath: null,
  // 工作区可读正文（markers-text）；file-level 时可 null
  contents: string | null,
  contentsDigest: string,      // 与 identity/stale 对齐
  conflictPresentation:
    | "markers-text"
    | "file-level"
    | "binary"
    | "tooLarge"
    | "invalidEncoding"
    | "readError",
  xy: "UU" | "AA" | "DD" | "AU" | "UD" | "UA" | "DU",
  // 可选：porcelain stage，供 P1/P2
  stages?: {
    baseOid: string | null,
    oursOid: string | null,
    theirsOid: string | null,
  },
}
```

规则：

- `conflictPresentation === "markers-text"` ⇒ `contents` 非空、可 UTF-8。
- 其它 presentation ⇒ `contents` 可为 null；UI 不挂 UnresolvedFile。
- **禁止** `reason: "conflict"` 的空 state 再作为 markers 主路径（可保留一版兼容读，G2 后删除）。

### 4.2 Index fact 补强

`origin: "conflict"` 的 group fact 应携带：

- `xy`
- stage OIDs / modes（porcelain `u` 已有，parser 今日丢弃）

digest 投影必须纳入 xy + oids，避免只改 stage 不刷 index。

### 4.3 体积与 IPC

- 复用 `GIT_REVIEW_SNAPSHOT_MAX_BYTES`（8MiB）读 worktree。
- 超大 → `tooLarge`，不塞 IPC。
- 可选后期：contents 旁路大对象 / 仅 digest + 二次拉取；P0 可同步在 document 内下发（与 patch 同量级）。

### 4.4 仍禁止

```ts
// 保持
if (fact.origin === "conflict") {
  // 不得生成 kind: "patch"
}
```

冲突 **不是** patch section。

---

## 5. Main 实现

### 5.1 `readConflictMaterial`（新模块建议）

路径建议：`src/main/services/git-review/document/conflict.ts`（或 `conflict-material.ts`）。

流程：

1. 输入：conflict fact + gitRoot + budget + signal。
2. `tryReadSnapshot`（同 untracked 守卫）。
3. 分类：
   - binary / encoding / tooLarge / readError → presentation 对应 state 形 material。
   - 文本：探测 marker（`<<<<<<<` 与闭合栈启发式）→ `markers-text` + contents + digest。
   - 无 markers 或 XY 属 file-level 集合 → `file-level`。
4. 返回 material（非 git diff）。
5. 读后 fingerprint 校验，变则 `GitReviewDocumentStaleError`（与 untracked 一致）。

### 5.2 `buildGitReviewDocument`

替换：

```ts
if (group === "conflict") {
  sections.push({ kind: "state", reason: "conflict", ... });
  continue;
}
```

为：

```ts
if (group === "conflict") {
  const material = await readConflictMaterial(...);
  sections.push(sectionFromConflictMaterial(...));
  continue;
}
```

`surfaceSections.head` 等现有 conflict 映射保持可读；renderer 以 section.kind 为准。

### 5.3 Parser

`#acceptConflict`：解析并冻结 `xy`、三个 OID；写入 fact / digest。

---

## 6. Renderer / packages/ui

### 6.1 架构

```
Review 正文区
├── 普通 content slots → PierDiffView (CodeView)   // 现路径
└── 当前 conflict focus → PierUnresolvedConflictView
        └── @pierre/diffs/react UnresolvedFile
```

**切换规则（P0）：**

1. 当前选中 section / path 的 group === `conflict` 且 section 为 `markers-text`  
   → 隐藏（或卸载）该 path 在 CodeView 中的 item，正文挂 `UnresolvedFile`。
2. 其它情况 → 现有 CodeView。
3. **冲突文件不得**再投影为 CodeView 的 `ready-notice` 假正文（G2）。

可选：冲突文件仍占 ledger 一条 estimate 高度 **仅在「多冲突连续滚」未来需求**；P0 **不做**，单文件切换即可。

### 6.2 Adapter（强制）

`packages/ui` 或 git plugin 内单一边界，例如：

```ts
// packages/ui/src/diff-view/unresolved-conflict.tsx（建议）
export function PierUnresolvedConflictView(props: {
  file: { name: string; contents: string; cacheKey: string };
  appearance: PierDiffViewAppearance;
  presentation: PierDiffViewPresentation;
  labels: { openFile: string; /* … */ };
  mergeConflictActionsType: "none" | "default" | custom;
  onOpenFile?: () => void;
  onMergeConflictAction?: ...; // P1
  onError?: (error: Error) => void;
}): JSX.Element;
```

职责：

- 主题 / 字体 / overflow 与 `PierDiffView` 对齐（复用 appearance tokens）。
- 捕获 parse 失败 → 友好降级。
- **禁止**业务组件直接 `import { UnresolvedFile }` 散落（可治理测试锁 import 边界）。

### 6.3 Header / 动作

- 状态：冲突 · markers-text | 文件级 · XY 白话。
- 主按钮：打开文件（已有 `openGitReviewPathInEditor`）。
- P0：可不显示 Accept，或 default 仅预览并 toast「请保存后标记已解决」若未接写盘。
- P1：Accept 后写盘成功 → toast / 自然 UI（列表离开 conflict 组）；失败 `showAppAlert`。

### 6.4 Projection

`resource-projection`：

- `section.kind === "conflict" && markers-text` → 专用 item / 或 document 旁路字段供 Unresolved 宿主，**不是** `PierDiffViewItem.patch`。
- file-level / binary → `ready-notice` **具体** i18n（双方删除 / 修改与删除冲突 / …），禁止笼统一句。

### 6.5 样式

- 复用 Pierre `[data-has-merge-conflict]`；appearance 已注释对齐「压平批注行」同源做法。
- 产品语义色走 token；不在业务写死 hex。

---

## 7. 写盘闭环（P1，摘要）

1. 用户 Accept → adapter 得更新后 contents（需从 resolved `FileDiffMetadata` 还原文本；若上游只给 diff 结构，用官方 `onMergeConflictResolve(file, payload)` 路径取最终 `FileContents`）。
2. main 命令（建议）：`git.review.conflict.writeResolved`  
   - path + expectedDigest + contents  
   - 校验 fingerprint → 原子写  
   - 可选 auto `git add -- path`
3. 失败：`stale` / `busy` / `commandFailed` → 契约 failure + 用户 alert。
4. 成功：mutation 提交 → index refresh → conflict 槽消失。

文件级 ours/theirs（P2）：

- `git checkout --ours|--theirs -- path` + `git add`  
- 与 markers 路径分离，避免误用 UnresolvedFile。

---

## 8. 文案（i18n）

| Key 方向 | 中文示意 | 英文示意 |
|----------|----------|----------|
| 详情标题 | 合并冲突 | Merge conflict |
| markers 说明 | 当前变更与传入变更如下；可在此接受一侧，或打开文件编辑 | Current vs incoming below… |
| 文件级 | 此冲突无法按标记展示，请选择保留版本或打开文件 | Cannot display markers… |
| 双方删除 | 双方均已删除该文件 | Both sides deleted this file |
| 打开文件 | 打开文件 | Open File |
| 写盘失败 | 无法写入已解决的内容 | Could not write resolved file |

禁止实现词：选区、renderer、patch section、UnresolvedFile 出现在用户主文案。

---

## 9. 测试与验收

### 9.1 单测 / 组件测

| 用例 | 断言 |
|------|------|
| fixtures：UU + markers | document section `markers-text`，contents 含 markers |
| fixtures：diff3 `\|\|\|\|\|\|\|` | materialize 成功，Unresolved 不炸 |
| fixtures：未闭合 marker | 降级 file-level / error，不 throw 到 UI 白屏 |
| fixtures：DD / UD | file-level presentation，无 contents 强依赖 |
| binary | binary presentation |
| parser 保留 xy + oids | digest 稳定、字段存在 |
| projection | markers → Unresolved 宿主输入；禁止 ready-notice 主路径 |
| adapter 主题 | light/dark 切换不丢 file cacheKey 纪律 |
| 治理 | 业务禁止直接 import UnresolvedFile（仅 adapter） |

### 9.2 手工 / e2e（有闲置机优先 remote）

1. 造 UU 冲突 → review conflict 面 → 见结构化 current/incoming（非 notice）。
2. Open File → 编辑器打开同 path。
3. P1：Accept Incoming → 磁盘无 markers → 文件离开 conflict 组。
4. 外部改文件中 → Accept 写盘 → stale 友好失败。

### 9.3 DoD（G0–G3）

| Gate | 含义 |
|------|------|
| G0 | 契约 + main materialize markers-text |
| G1 | UnresolvedFile 宿主展示（官方标准）+ 具体 file-level notice |
| G2 | 删除 conflict 空 state 主路径；治理测试绿 |
| G3 | P1 写盘 + add 闭环（可另 PR） |

**G1 未完成不得宣称「已接 Pierre 官方冲突 UI」。**

---

## 10. PR 切片（执行序）

### PR1 — 契约 + index 事实 + materialize（无 UI 大改）

**目标：** document 能下发冲突正文与分类；旧 UI 仍可先 map 成更好 notice。

- `shared/contracts/git-review/document.ts`：`kind: "conflict"` section  
- `primary-parser`：xy + stage OIDs  
- `document/conflict.ts`：`readConflictMaterial`  
- `document/index.ts`：conflict 分支改 materialize  
- 单测 + fixtures（UU markers、binary、DD）  
- 可选：projection 临时把 markers-text 显示为「已加载冲突正文（UI 下期）」或仍 Open File — **优先直接进 PR2 同一栈若体积可控**

**验收：** IPC 返回 contents；`pnpm test` 契约/解析绿。

### PR2 — 官方 UnresolvedFile 宿主（P0 展示）

**目标：** 选中 markers-text 冲突 = `PierUnresolvedConflictView`。

- `packages/ui` adapter + appearance 对齐  
- git review 正文区切换：conflict focus ↔ CodeView  
- i18n、Open File  
- `mergeConflictActionsType: "none"` 或 default 不写盘  
- component 测试：挂载 Unresolved、parse 失败降级  
- 治理：import 边界  

**验收：** 真机 UU 冲突可见结构化详情；G1。

### PR3 — 清理旧 notice 主路径 + bodyClass 对齐

- 删除/降级 `reason: "conflict"` 空 state 主路径  
- state-text 只服务 file-level / binary 等  
- 文档交叉链到金标准 § bodyClass content  
- 金标准一句补注：冲突正文 = UnresolvedFile  

**验收：** G2；无回归「只有一句话」。

### PR4 — 解析写盘（P1）

- `onMergeConflictResolve` / 受控 action → write + add  
- mutation 契约、stale、反馈规范  
- 单测写路径  

**验收：** G3。

### PR5 — 文件级 ours/theirs（P2，可排期）

- checkout --ours/--theirs + add  
- DD / modify-delete 文案与按钮  

---

## 11. 明确不采用的路径

| 路径 | 原因 |
|------|------|
| parse 结果塞 CodeView 当官方 UI | 无 marker 行 / Accept / 专用 renderer |
| worktree 当 `type: "file"` 展示 raw markers | 非官方 conflict UI |
| `git diff` 当冲突详情 | 语义错误 |
| 默认多 Unresolved 虚拟进 CodeView | 上游不支持 |
| 业务直接调 `parseMergeConflictDiffFromFile` 散落 | API beta，必须 adapter |

---

## 12. 风险

| 风险 | 缓解 |
|------|------|
| UnresolvedFile experimental | adapter 隔离；锁 `@pierre/diffs` 版本；升级跑 fixtures |
| 大文件 IPC | snapshot 上限；tooLarge |
| 多文件金标准 vs 单文件冲突 | 侧栏多文件 + 正文单 Unresolved；文档写明例外 |
| 半解决状态（部分 region Accept 未写盘） | P0 不写盘；P1 明确「全部解决后写」或每次 Accept 写全文件 |
| 与行内评论 | P0 冲突面可不挂 review comments；P1 再评估坐标空间 |

---

## 13. 结论

- **官方标准方案 = `UnresolvedFile` + worktree markers `FileContents`。**  
- Pier 缺口在 document 不读正文 + UI 未挂该原语，不在 Pierre 缺能力。  
- 执行序：**PR1 materialize → PR2 Unresolved 宿主（标准展示）→ PR3 清 notice → PR4 写盘。**  
- CodeView 降级路径 **不作为** 主方案，不写进 DoD。
