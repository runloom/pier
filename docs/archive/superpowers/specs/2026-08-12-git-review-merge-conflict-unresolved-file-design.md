# Git Review 冲突详情：官方 UnresolvedFile 标准接法

日期：2026-08-12  
状态：**终态契约**（2026-09-30 修订：冲突与普通 diff 共用连续多文件审查；废止单文件冲突例外）  
引擎依据：`@pierre/diffs@1.2.12`（`UnresolvedFile`、`parseMergeConflictDiffFromFile`、`resolveConflict`）；官方文档 [diffs.com](https://diffs.com/) / [docs](https://diffs.com/docs)  
与金标准关系：补全 `conflicted` 的 **content 正文**；冲突保留在多文件 CodeView 账本，文件头、折叠、导航和纵向滚动由同一个 CodeView 拥有。标记正文仍使用专用 `UnresolvedFile`，通过文件级 annotation 挂载，不将标记解析结果伪装成普通 patch。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| `../../../superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md` | SCM Review 终态权威（多文件、bodyClass、ledger） | **继承**；冲突文件 bodyClass=content 的正文由本文定义 |
| `../../../superpowers/specs/2026-07-27-diffshub-full-alignment-design.md` | CodeView 单实例 / scroll 单写者 | 普通 diff 与冲突共用正文账本；冲突正文作为 annotation |
| **本文** | 冲突详情 + 解析 UI 的唯一实现权威 | 冲突渲染 / 契约 / 写盘闭环 |

**实现禁令：**

1. 禁止把 conflict 当 `git diff` patch 再 `processFile`。
2. 禁止用 `CodeView` 的 `type: "diff"` 塞 `parseMergeConflictDiffFromFile` 结果，却宣称「已接官方 conflict UI」。
3. 禁止继续用唯一 `ready-notice: Merge conflict — resolve in the editor` 充当详情终态（过渡 PR 可并存，G2 后必须撤）。
4. 禁止为每个冲突创建独立 CodeView 或纵向滚动区；`UnresolvedFile` 只挂在共享 CodeView 的文件级 annotation 中，隐藏自身文件头。

---

## 0. 一句话

> **冲突与普通 diff 都是连续多文件审查：CodeView 拥有文件列表与滚动，`UnresolvedFile` 拥有标记展示和 Accept；写盘与 `git add` 是宿主义务。**

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

**没有** unresolved 槽位，因此不扩展上游 item type：

- CodeView item 保留文件头和文件级 annotation；annotation 内挂官方 `UnresolvedFile`。
- 文件级正文按真实高度参与既有 annotation 测量；不创建第二个 CodeView，不新增纵向滚动所有者。

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
| conflict 组列表 + 多文件导航 | 侧栏全量，正文保留所有 content 冲突槽；点击文件只定位该文件头 |
| **可结构化** 冲突文件 | 文件级 annotation = **`UnresolvedFile`**；共用 CodeView 文件头，不重复标题 |
| **不可结构化** 冲突 | 同一文件槽内展示工作区文本、两侧 stage diff 或说明，并保留文件级动作 |
| 冲突 + 同 entry 其它组 | 按现有 surface 过滤；不因选中冲突而裁掉其他正文成员 |

### 3.2 与「始终多文件」的关系

冲突不再是单文件例外：

- 一组冲突共享一个 CodeView 正文，保持 index 顺序、文件折叠与树导航。
- `UnresolvedFile` 是每个标记冲突的正文原语，不是整页布局所有者。
- 水合、选中和刷新均不得将冲突列表裁成当前文件；解决后只移除已解决的槽。

### 3.3 冲突分类

| 类 | 判定 | 渲染 |
|----|------|------|
| **markers-text** | worktree UTF-8 文本，含完整 conflict marker 栈 | `UnresolvedFile` |
| **file-level** | XY ∈ {DD, AU, UD, UA, DU} 等无可靠 markers，或解析失败 | 工作区仍有可读文本：只显示工作区 `File` 正文。工作区文件不存在、且当前侧与传入侧都能读成文本（缺 blob 的一侧为空）：直接投影为与普通 diff 相同的 CodeView FileDiff 项。任一侧二进制、超限或读失败：只在共享文件头显示说明 |
| **binary** | 含 `\0` / 非文本 | 共享文件头显示说明；版本选择走既有右键菜单 |
| **too-large / encoding / readError** | 沿用 snapshot 上限，或读失败 | 共享文件头显示说明；文件仍在时沿用打开文件入口，文件级解决动作走既有右键菜单 |

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
- stage OIDs / modes（保留 porcelain `u` 的三个 stage 身份；缺席 mode 为 `000000`）

index 与 contentsDigest 投影必须纳入 xy + 三个 stage 的 OID / mode，避免相同 blob 的权限或类型改变逃过 freshness 校验；所有 presentation 使用同一规则，公开 stage DTO 仍只携带 OID。

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

`#acceptConflict`：解析并冻结 `xy`、三个 OID 及对应 mode；写入私有 fact / digest。

---

## 6. Renderer / packages/ui

### 6.1 架构

```
Review 正文区 → PierDiffView（一个 CodeView、一个纵向滚动区）
├── 普通 content slots → 原有 diff 正文
└── conflict slots → 同一个 CodeView 文件头
        ├── markers-text → annotation 内的官方 UnresolvedFile
        ├── 可读工作区 → annotation 内的官方 File
        ├── 工作区缺席且 stage 可读 → 原生 FileDiff 正文（不嵌套第二个 diff）
        └── 不可读 → 仅共享文件头说明
```

1. 全部冲突 content 槽进入共享账本；`selectedSectionKey` 只服务定位，不决定成员集。
2. annotation 内的 UnresolvedFile / File 隐藏文件头、按正文自然高度测量；stage 比较直接进入普通 diff 正文，不嵌套 FileDiff。
3. 冲突不得再投影为 `ready-notice` 假正文，也不得切换到整页单文件阅读面。
4. 加载与失败沿用普通 diff 的 estimate / error 槽和重试反馈。

### 6.2 Adapter（强制）

适配器唯一位于 `packages/ui/src/diff-view/unresolved-conflict/host.tsx`。业务通过
`PierDiffView` 的 `unresolvedConflict` host 接入；冲突数据来自同一份 `items`，不再提供
独立的单文件阅读组件。只有标记正文与工作区正文使用文件级 annotation；stage 比较直接复用普通 FileDiff 项。

职责：

- 主题 / 字体 / overflow 与 `PierDiffView` 对齐（复用 appearance tokens）。
- 主题与写入锁通过实时共享上下文传入；Pierre 缓存的 annotation 不得保留初始主题或操作状态。
- Accept 与右键文件级解决共用 repository mutation authority；成功与失败均等待权威刷新后释放，禁止只靠正文局部 busy 状态隔离两条入口。
- 捕获 parse 失败 → 友好降级。
- **禁止**业务组件直接 `import { UnresolvedFile }` 散落（可治理测试锁 import 边界）。

### 6.3 Header / 动作

- 状态：冲突 · markers-text | 文件级 · XY 白话。
- 打开文件沿用共享文件头路径及既有右键入口；工作区文件缺席时不得打开不存在的文件。
- 窄窗共享文件头先截断状态说明，保留现有标题槽上限内的完整文件名；文件名仅超过该上限时截断。此优先级在普通差异与冲突共用的文件头实现，不改变字体、行高或间距。
- 文件级确认删除 / 保留当前 / 采用传入 / 暂存当前等动作只出现在既有正文右键菜单，按现有复制与源码入口之后的稳定分组呈现；不增加文件头图标，不在正文渲染按钮条或卡片。
- P1：Accept 后写盘成功 → toast / 自然 UI（列表离开 conflict 组）；失败 `showAppAlert`。

### 6.4 Projection

`resource-projection`：

- 标记与可读工作区正文使用 `kind: "conflict"` 文件槽内的 annotation；可读 stage 比较直接生成真实 FileDiffMetadata，不隐藏真实差异行。
- 不可读说明只在共享文件头出现一次，文件级解决动作来自该次右键目标，不能落到其他文件。

### 6.5 样式

- 复用 Pierre `[data-has-merge-conflict]`；appearance 已注释对齐「压平批注行」同源做法。
- 产品语义色走 token；不在业务写死 hex。
- 正文不得有独立操作条、“当前→传入”说明行或为它们保留的空白。
- 标记 / 工作区正文复用普通 diff 的 `CODE_VIEW_CUSTOM_CSS`、`diffMetrics` 行高与字体变量；嵌套正文不叠加原生 File 顶距或第二份文件底垫。
- 文件头、折叠、行号、增删色条、选区、滚动条与普通 diff 同源；允许的差异只限官方冲突标记与回合内 Accept 交互。

---

## 7. 写盘闭环

1. 用户 Accept → adapter 经官方 `onMergeConflictResolve` 路径还原已解决的完整 contents。
2. 唯一 main 命令 `git.resolveReviewConflict`：
   - `source` + 必填 `expectedContentsDigest` + `action`；`write` 另带 `resolvedContents`。
   - digest 同时覆盖工作区正文与文件身份、XY、base/ours/theirs stage 的 OID / mode；`write` / `ours` / `theirs` / `stage` 一律复核，拒绝旧正文或旧索引事实。
   - 冲突工作区身份同样进入 `indexRevision`，外部修改必须触发正文更新；普通 numstat 不读取冲突文件，不能让一个不可读冲突阻断整份索引。存在冲突时只查询普通 tracked fact 的精确路径，按字节 / 路径数量分批，并让 rename / copy 的旧新路径同批；禁止把全量冲突排除项展开到一次 argv。
   - `write` 不接受残留（含未闭合）标记或超过 8MiB 的 UTF-8 字节；写入前再验证原文件身份与内容。
   - 同目录临时文件完整写入、保留 owner / mode，持有临时 fd 到发布完成；flush 前记录 stat，flush 后对比请求字节，并再次校验 fd 与 no-follow 临时目录项的普通文件类型、身份与内容相关 stat。macOS 以 `O_NOFOLLOW_ANY` 打开父目录并用 `openat` / `renameat` 锚定，Linux 走既有无符号链接 fd walk 与 `/proc/self/fd`。失败不得先截断原文；只清理仍属自身 inode 的临时目录项，禁止删除其他进程的替换文件。最终 stat 校验不宣称与 rename 构成内核 compare-and-swap。
   - 成功写入后执行 `git add -- path`；不能把写盘失败或残留标记当成已解决。
3. 失败：`staleRevision` / `busy` / `commandFailed` 等契约 failure → 复用本地化下一步提示与技术详情的宿主 alert。
4. 成功或失败都保持共享 mutation 权限占用，直到权威 index refresh 完成；成功只移除对应 conflict 槽。

文件级解决：

- 有所选 stage：`git checkout --ours|--theirs -- path` + `git add`。仅 `100644` / `100755` 普通文件用原生 `git grep --no-textconv -I -q` 检查残留行首标记；仅退出码 1 表示无匹配，其他失败传播。二进制跳过文本匹配，不把完整 blob 传入审查输出预算；symlink 的目标路径不作正文标记检查。
- `160000` gitlink 不在主仓库读取子模块 commit；checkout 加 `--recurse-submodules`，使子模块 HEAD 与所选 stage 一致后再暂存，不能把旧子模块 HEAD 当作所选版本。
- 所选 stage 缺席：`git rm -- path` 完成删除与索引解决，不再对消失路径重复 `git add`。
- 已人工解决的正文：`stage` 复核同一 digest，拒绝残留标记，然后 `git add`。
- 与 markers 路径分离，避免误用 UnresolvedFile；五个右键命令必须在插件 manifest 声明 `git:write` 并提供四语标题，真实宿主声明校验不得被测试替身绕开。

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
| stage OID / mode-only 外部变更 | 所有解决动作拒绝旧 digest；工作区与索引不变，缺席工作区同样受保护 |
| 临时目录项换成 symlink / 普通文件，或同 inode 内容篡改 | 发布拒绝、原文件身份与内容不变；保留其他进程的替换目录项 |
| 5,000 个长路径冲突 + 普通双组变更 / rename / 共享源 copy | 索引可读，普通计数与移动身份正确；精确路径同样支持文件名前缀、目录内重命名、Unicode / glob 字符，不读取冲突后代 |
| 主仓库无子模块 commit 的 gitlink | 当前 / 传入选择均成功，子模块 HEAD 与 stage 0 匹配所选 commit |
| 65MiB binary 含标记样字节 | 可选择并暂存，stage 0 与文件 hash 匹配所选 blob |
| 超大普通文本尾部未闭合标记 | 拒绝选择版本，原工作区与未合并索引不变 |
| projection | markers → Unresolved 宿主输入；禁止 ready-notice 主路径 |
| adapter 主题 | light/dark 切换不丢 file cacheKey 纪律 |
| 治理 | 业务禁止直接 import UnresolvedFile（仅 adapter） |

### 9.2 手工 / e2e（有闲置机优先 remote）

1. 造 UU 冲突 → review conflict 面 → 见结构化 current/incoming（非 notice）。
2. Open File → 编辑器打开同 path。
3. P1：Accept Incoming → 磁盘无 markers → 文件离开 conflict 组。
4. 外部改文件中 → Accept 写盘 → stale 友好失败。

自动场景在 `tests/e2e/git/conflicts.spec.ts`：保留现有 conflict / index surface 过滤，验证多冲突导航与独立折叠、真实 Accept 写盘与 stage、文件级删除确认 / 版本选择 / 暂存、Files 同路径打开，以及外部编辑后的 stale 防覆盖。必须附 light / dark / narrow 与失败态截图。

原生菜单自动化观察真实 `Menu.popup`，仍调用原 popup，并选择其真实启用 `MenuItem` 回调；不替换宿主声明、菜单结果或 GIT。stale 场景通过 CDP 暂停已派发的 Accept 点击后改磁盘，避免靠 watcher 延迟碰运气。

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

**目标：** markers-text 冲突在连续多文件列表的 annotation 内挂官方 `UnresolvedFile`。

- `packages/ui` adapter + appearance 对齐  
- git review 所有正文共用 CodeView，不再按 conflict focus 替换整页
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
| `git diff` 当**带标记**冲突详情 | 语义错误；标记正文只走 `UnresolvedFile`。工作区文件已不存在时的两侧 stage 文本 diff 是文件级唯一正文，见 §3.3 |
| 每个冲突独立 CodeView / 独立纵向滚动区 | 破坏共享列表、折叠与树导航；只允许在外层 CodeView annotation 内挂正文原语 |
| 业务直接调 `parseMergeConflictDiffFromFile` 散落 | API beta，必须 adapter |

---

## 12. 风险

| 风险 | 缓解 |
|------|------|
| UnresolvedFile experimental | adapter 隔离；锁 `@pierre/diffs` 版本；升级跑 fixtures |
| 大文件 IPC | snapshot 上限；tooLarge |
| annotation 正文高度变化 | 复用 CodeView annotation 测量；验收多个冲突连续浏览、折叠、树定位与单点解决后的成员稳定 |
| 半解决状态（部分 region Accept 未写盘） | P0 不写盘；P1 明确「全部解决后写」或每次 Accept 写全文件 |
| 与行内评论 | P0 冲突面可不挂 review comments；P1 再评估坐标空间 |

---

## 13. 结论

- **官方标准方案 = `UnresolvedFile` + worktree markers `FileContents`。**  
- Pier 缺口在 document 不读正文 + UI 未挂该原语，不在 Pierre 缺能力。  
- 执行序：**PR1 materialize → PR2 Unresolved 宿主（标准展示）→ PR3 清 notice → PR4 写盘。**  
- CodeView 只拥有列表 chrome 与滚动；标记详情始终由官方 UnresolvedFile 展示，不以普通 diff 或 raw markers 降级冒充。
