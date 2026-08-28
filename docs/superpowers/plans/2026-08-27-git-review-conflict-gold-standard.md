# Git Review 冲突阅读面金标准修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并更改面做到：侧栏全量冲突文件、徽标与工作区一致、正文只展示当前选中的那一个冲突（标记编辑器或文件级动作卡），且文件级动作能真正解决冲突、不会冲掉已改好的工作区。

**Architecture:** 冲突身份在分组「合并更改」；树字母只反映工作区存在性（A/D/M）；正文由树选中的 `sectionKey` 驱动，一次只挂一个 `PierUnresolvedConflictView` 或一张文件级卡。解析动作走已有 `git.resolveReviewConflict`，补 `stage`（只 `git add`），缺 stage OID 继续 `git rm`。冲突槽在水合期也不得进入 CodeView。

**Tech Stack:** git 插件 renderer（`ReviewConflictView` / `content-body` / 树模型）、`git.resolveReviewConflict`、共享派生 `conflict-kind.ts`、契约 `git-review`。

**权威文档（冲突时）：**

- 冲突阅读 / 解析：`docs/archive/superpowers/specs/2026-08-12-git-review-merge-conflict-unresolved-file-design.md`（§3.1–3.4、§7 P2、§11 禁止多 Unresolved 虚拟化）
- SCM 体感约束只借用三条：侧栏 ⊥ 正文、冲突不是 CodeView item、始终多文件对**普通 diff** 成立——冲突正文例外为一文一屏（同 §3.2）
- **不**把 `2026-07-31-git-review-gold-standard-endstate-design.md` 的 G0–G6 加载/骨架里程碑纳入本计划

## Global Constraints

- 不给 `@pierre/trees` 打补丁加 `C` 字母；冲突身份由分组名承担。
- 不把多个 `UnresolvedFile` 虚拟进 CodeView / 同一滚动容器。
- 冲突槽禁止投影为 CodeView `ready-notice` 主路径。
- 用户文案走插件 locale，禁止「选区 / UnresolvedFile / ours / theirs」进前台。
- 破坏性动作在冲突卡内联按钮（SCM 决策面），不套第二层 `showAppConfirm`。
- 文件级缺 blob 的一侧用 `git rm -f -- path`，有 blob 用 `checkout --ours|--theirs`，然后 `git add`。
- 已落地、本计划**不要重做**：conflict slot 透传 `xy`、`kind: "conflict"` 投影、ours/theirs + `git rm`、标记编辑器 P1 写盘。

## 已落地（对照，禁止回退）

| 项 | 位置 |
|---|---|
| `xy` 在 conflict render slot | `src/shared/contracts/git-review/base.ts` superRefine |
| 树字母 `DU/DD→D`、`AU/UA/AA→A`、`UU→M` | `conflict-kind.ts` + `tree.tsx` `treeStatus` |
| 文件级投影 `kind: "conflict"` | `resource-projection.ts` |
| 文件级 ours/theirs 按钮 | `conflict-view.tsx` |
| 缺 OID → `git rm` | `conflict-resolve.ts` |

## 钉死的产品语义

1. **侧栏 = 全量冲突文件；正文 = 当前选中的那一个。** 树 6 个文件时，右边只渲染选中项，不再把 UU 编辑器叠 DU 横幅。
2. **树字母 = 工作区存在性，不是「冲突种类字母」。**
   - `DU` / `DD`：工作区没有该文件 → `deleted`
   - `UD` / `UU`：工作区仍有文件 → `modified`（**纠正当前把 `UD` 标成 D**）
   - `AU` / `UA` / `AA` → `added`
3. **文件级动作按 `xy` + presentation：**
   - `DU`/`UD`/`DD`/`AU`/`UA`：现有确认删除 / 保留 / 采用传入
   - `UU`/`AA` 且 `presentation === "file-level"`（工作区已无标记、只差暂存）：主按钮 **暂存当前文件**（`action: "stage"`），次按钮采用当前 / 采用传入（会覆盖工作区）
   - `tooLarge` / `invalidEncoding` / `readError`：主路径 **打开文件**；ours/theirs 仍可给
   - 工作区文件不存在（`DU`/`DD`）不展示「打开文件」

---

## 文件分工

| 文件 | 职责 |
|---|---|
| `src/shared/contracts/git-review/conflict-kind.ts` | `xy →` 树字母、文件级按钮、是否允许打开 |
| `src/shared/contracts/git-review/operations.ts` | `resolve` 增加 `action: "stage"` |
| `src/main/services/git-review/document/conflict-resolve.ts` | `stage` = 只 `writer.stage` |
| `src/plugins/builtin/git/renderer/review/document/content-body.tsx` | 冲突面只把选中项交给 `ReviewConflictView`；冲突槽永不进 CodeView |
| `src/plugins/builtin/git/renderer/review/document/conflict-view.tsx` | 单文件全高；文件级卡补暂存 / 打开 |
| `src/plugins/builtin/git/renderer/review/document/estimates.ts` | conflict 组 estimate 也标 `kind: "conflict"`（带 slot.xy 的占位 body） |
| `src/plugins/builtin/git/renderer/review/tree.tsx` | `UD→modified`；目录继承允许 `deleted` |
| `src/plugins/builtin/git/renderer/review/content.tsx` | 把 `selectedSectionKey` 传入 `documentContent` |
| `src/plugins/builtin/git/locales/{zh-CN,en,ja,ko}.json` | 暂存当前文件 / 打开文件 |
| 单测 | 见各 Task |

---

### Task 1: 树字母改为工作区存在性（`UD` → M）

**Files:**

- Modify: `src/shared/contracts/git-review/conflict-kind.ts`
- Modify: `src/plugins/builtin/git/renderer/review/tree.tsx` `inheritedStatus`
- Test: `tests/unit/shared/git/conflict-kind.test.ts`
- Test: `tests/unit/renderer/git/review/tree/model.test.ts`

**Interfaces:**

- Consumes: `GitReviewConflictXy`
- Produces: `gitReviewConflictTreeStatus("UD") === "modified"`；`gitReviewConflictTreeStatus("DU") === "deleted"`

- [ ] **Step 1: 改派生并锁测试**

`gitReviewConflictTreeStatus`：

```ts
case "AA":
case "AU":
case "UA":
  return "added";
case "DD":
case "DU":
  return "deleted";
case "UD":
case "UU":
  return "modified";
```

`inheritedStatus`：父目录在子节点全是 `deleted` 时保持 `deleted`，混杂仍是 `modified`：

```ts
function inheritedStatus(status: PierFileTreeGitStatus): PierFileTreeGitStatus {
  return status === "added" ||
    status === "untracked" ||
    status === "deleted"
    ? status
    : "modified";
}
```

树模型里已有逻辑：`existing.gitStatus !== nextStatus → "modified"`，因此 deleted+modified 的目录仍是 M。

测试：

```ts
expect(gitReviewConflictTreeStatus("UD")).toBe("modified");
expect(gitReviewConflictTreeStatus("DU")).toBe("deleted");
```

树模型：`xy: "UD"` 的文件行 `gitStatus === "modified"`；仅含 `DU` 文件的目录 `gitStatus === "deleted"`。

- [ ] **Step 2: 跑测**

```bash
pnpm exec vitest run tests/unit/shared/git/conflict-kind.test.ts tests/unit/renderer/git/review/tree/model.test.ts
```

Expected: PASS

---

### Task 2: 冲突正文一文一屏

**Files:**

- Modify: `src/plugins/builtin/git/renderer/review/document/content-body.tsx`
- Modify: `src/plugins/builtin/git/renderer/review/content.tsx`（传入 `selectedSectionKey`）
- Modify: `src/plugins/builtin/git/renderer/review/document/conflict-view.tsx`（去掉 `minHeight: 40vh` 堆叠；单文件 `flex-1`）
- Test: `tests/unit/renderer/git/review/document-projection.test.ts` 或新增 `tests/unit/renderer/git/review/document/content-body-conflict.test.ts`

**Interfaces:**

- Consumes: `selectedSectionKey: string | null`（已有 `useReviewSelection`）
- Produces: `ReviewConflictView` 的 `items` 长度 ≤ 1；`item.id === selectedSectionKey`（无选中则回退该面第一个冲突槽）

- [ ] **Step 1: 把选中键穿到正文**

`documentContent` 增加：

```ts
readonly selectedSectionKey: string | null;
```

`content.tsx` 调用处传入已有的 `selectedSectionKey`。

- [ ] **Step 2: 冲突槽永远不进 CodeView**

替换 `content-body.tsx` 里按 `kind === "conflict"` 分流的逻辑：

```ts
function isConflictSurfaceItem(item: PierDiffViewItem): boolean {
  return (
    item.kind === "conflict" ||
    (item.kind === "estimate" && item.conflict !== undefined)
  );
}

const conflictItems = displayProjection.items.filter(isConflictSurfaceItem);
const codeItems = displayProjection.items.filter(
  (item) => !isConflictSurfaceItem(item)
);
const focused =
  conflictItems.find((item) => item.id === options.selectedSectionKey) ??
  conflictItems[0];
const conflictFocusItems = focused === undefined ? [] : [focused];
```

`conflictOnly` 条件改为：本阅读面 `diffBase === "conflict"` **或** `codeItems.length === 0 && conflictFocusItems.length > 0`。合并更改 tab 下即使选中项仍是 estimate，也只渲染 `ReviewConflictView`，禁止再挂 `ReviewCodeView`。

`ReviewConflictView` 单文件容器：

```tsx
<div className="flex h-full min-h-0 min-w-0 flex-col" data-git-review-conflict-view="">
  {/* 一个 child：UnresolvedFile 或文件级卡，className="min-h-0 flex-1" */}
</div>
```

删除 `style={{ minHeight: "40vh" }}` 和 `items.map` 多文件堆叠。

- [ ] **Step 3: 测试**

断言辅助函数（可抽到 `content-body.tsx` 旁的纯函数 `focusConflictItems(items, selectedSectionKey)` 以便单测）：

```ts
expect(
  focusConflictItems(
    [{ id: "a" }, { id: "b" }],
    "b"
  ).map((item) => item.id)
).toEqual(["b"]);
expect(
  focusConflictItems([{ id: "a" }, { id: "b" }], null).map((item) => item.id)
).toEqual(["a"]);
```

- [ ] **Step 4: 跑测**

```bash
pnpm exec vitest run tests/unit/renderer/git/review/document-projection.test.ts tests/unit/renderer/git/review/tree/model.test.ts
```

Expected: PASS；合并更改面不再把未选中冲突画进 CodeView。

---

### Task 3: 水合期冲突 estimate 也带 conflict body

**Files:**

- Modify: `src/plugins/builtin/git/renderer/review/document/estimates.ts`
- Modify: `src/plugins/builtin/git/renderer/review/document/ledger-projection.ts`（若 estimate 工厂只在这里调用）
- Test: `tests/unit/renderer/git/review/document-projection.test.ts`

**Interfaces:**

- Consumes: `slot.group === "conflict"` 且 `slot.xy` 已在 index 上
- Produces: conflict 组 estimate 的 `kind: "conflict"`，`conflict.presentation` 暂用 `"file-level"`，`contents: null`，`xy: slot.xy`，无 `stateNotice` 或短「正在加载…」（走 locale）

- [ ] **Step 1: estimate 工厂**

```ts
export function estimateReviewSlotItem(options: {
  readonly entry: GitReviewIndexEntry;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
}): PierDiffViewItem {
  const { slot } = options;
  const base = { /* 现有 fileDisplay / id / lineStats / patch:null */ };
  if (slot.group === "conflict" && slot.xy !== undefined) {
    return {
      ...base,
      conflict: {
        contents: null,
        contentsDigest: `estimate:${slot.sectionKey}`,
        presentation: "file-level",
        stages: { baseOid: null, oursOid: null, theirsOid: null },
        xy: slot.xy,
      },
      kind: "conflict",
    };
  }
  return { ...base, kind: "estimate" };
}
```

`ReviewConflictView` 对 `contents === null` 的 markers 未就绪：文件级卡形态、按钮 `disabled`（`busy` 或无 document）。加载完成后 projection 替换为真 `markers-text` / 真 file-level。

- [ ] **Step 2: 测试**

未 loaded 的 conflict slot：`projectReviewLedger` 对该 id 的 item `kind === "conflict"`，且 `conflict.xy` 来自 slot。禁止 `kind === "estimate"` 出现在 `diffBase: "conflict"` 的 ledger 里。

- [ ] **Step 3: 跑测**

```bash
pnpm exec vitest run tests/unit/renderer/git/review/document-projection.test.ts tests/unit/renderer/git/review/gold-standard-dod.test.ts
```

Expected: PASS

---

### Task 4: `resolve` 增加 `stage`；UU 文件级主按钮暂存当前文件

**Files:**

- Modify: `src/shared/contracts/git-review/operations.ts`
- Modify: `src/main/services/git-review/document/conflict-resolve.ts`
- Modify: `src/shared/contracts/git-review/conflict-kind.ts`（按钮列表）
- Modify: `src/plugins/builtin/git/renderer/review/document/conflict-view.tsx`
- Modify: 四份 locale
- Test: `tests/unit/main/git/review/conflict-resolve.test.ts`
- Test: `tests/unit/shared/git/conflict-kind.test.ts`
- Test: `tests/unit/shared/git/review-contract.test.ts`

**Interfaces:**

```ts
action: z.enum(["ours", "theirs", "write", "stage"])
```

- `stage`：不 checkout、不写盘，只 `writer.stage(cwd, { paths: [path] })`；路径仍须 `origin === "conflict"`。
- `gitReviewConflictFileActions` 扩展为可含 `{ action: "stage", destructive: false, intent: "stage-current" }`。
- UU/AA file-level 顺序：`ours`、`theirs`、`stage`（`stage` 最右，主按钮）。
- `write` 仍要求 `resolvedContents` + `expectedContentsDigest`；`stage`/`ours`/`theirs` 不要。

- [ ] **Step 1: 契约 + resolve 实现 + 测试**

`conflict-resolve.ts`：

```ts
if (request.action === "write") { /* 现有 */ }
else if (request.action === "stage") {
  await writer.stage(cwd, { paths: [path] });
} else {
  /* 现有 ours/theirs + git rm */
}
```

单测（复用 `createUuConflict` 后把工作区写成无标记文本）：

```ts
await writeFile(join(root, "conflict.ts"), "resolved\n", "utf8");
const result = await service.resolveConflict({
  action: "stage",
  operationId: randomUUID(),
  source: fileSource(root),
}, { ...gitReviewRequestOptions(), writer: createGitService() });
expect(result.kind).toBe("ok");
expect(await readFile(join(root, "conflict.ts"), "utf8")).toBe("resolved\n");
expect(await execGit(["status", "--porcelain=v1", "--", "conflict.ts"], { cwd: root }))
  .not.toMatch(/^UU /mu);
```

- [ ] **Step 2: 按钮与文案**

locale：

- `ui.reviewConflictStageCurrent`：暂存当前文件 / Stage Current File
- `ui.reviewOpenFile` 已存在，文件级卡复用

`conflict-view.tsx` 文件级卡：

- 工作区可打开：`gitReviewConflictCanOpen(xy)` 为 true 时加 outline「打开文件」，走现有 `openGitReviewPathInEditor`
- `DU`/`DD`：`gitReviewConflictCanOpen` = false
- `UD`/`UU`/`AA`/`AU`/`UA`：true

```ts
export function gitReviewConflictCanOpen(xy: GitReviewConflictXy): boolean {
  return xy !== "DU" && xy !== "DD";
}
```

UU/AA file-level 文案改回「工作区已是结果则暂存；否则采用当前或传入版本」（不再暗示打开是唯一出路，打开是附加动作）。

- [ ] **Step 3: 跑测**

```bash
pnpm exec vitest run tests/unit/main/git/review/conflict-resolve.test.ts tests/unit/shared/git/conflict-kind.test.ts tests/unit/shared/git/review-contract.test.ts tests/unit/renderer/git/review/conflict-section-text.test.ts
```

Expected: PASS

---

### Task 5: 文件级卡补「打开文件」；tooLarge / 编码 / 读失败主路径

**Files:**

- Modify: `src/plugins/builtin/git/renderer/review/document/conflict-view.tsx`
- Modify: `src/plugins/builtin/git/renderer/review/document/state-text.ts` 与四份 locale
- Test: `tests/unit/renderer/git/review/conflict-section-text.test.ts`

**Interfaces:**

- Consumes: `item.conflict.presentation`、`gitReviewConflictCanOpen`
- Produces: `data-git-review-conflict-open` 按钮；`tooLarge`/`invalidEncoding`/`readError` 文案含「打开文件」且主按钮是打开

- [ ] **Step 1: 文案**

- `tooLarge` / `invalidEncoding` / `readError`：保留「打开文件」作为下一步（与 2026-08-12 §3.3 一致）
- 普通 file-level 说明不再写「请打开或暂存」当唯一 CTA

- [ ] **Step 2: UI**

文件级卡 footer 右簇：打开（outline，可隐藏）| 次要解析按钮 | 主按钮。`presentation` 为 `tooLarge` | `invalidEncoding` | `readError` 时打开为 `variant="default"` 最右。

- [ ] **Step 3: 跑测**

```bash
pnpm exec vitest run tests/unit/renderer/git/review/conflict-section-text.test.ts tests/unit/renderer/app/user-copy-governance.test.ts
```

Expected: PASS；中英禁止词不回归。

---

### Task 6: 治理与对照验收

**Files:** 不新增产品代码。

- [ ] **Step 1: 静态**

```bash
pnpm exec biome check src/shared/contracts/git-review src/main/services/git-review/document/conflict-resolve.ts src/plugins/builtin/git/renderer/review
```

Expected: 无 error。`conflict-view.tsx` 仍 < 500 行；若超则把文件级卡抽到同目录 `conflict-file-level.tsx`（注意 `document/` 目录密度，优先同文件内函数而不是新文件）。

- [ ] **Step 2: 单测包**

```bash
pnpm exec vitest run \
  tests/unit/shared/git/conflict-kind.test.ts \
  tests/unit/shared/git/review-contract.test.ts \
  tests/unit/renderer/git/review/tree/model.test.ts \
  tests/unit/renderer/git/review/document-projection.test.ts \
  tests/unit/renderer/git/review/conflict-section-text.test.ts \
  tests/unit/main/git/review/conflict-resolve.test.ts \
  tests/unit/main/git/review/index.test.ts \
  tests/unit/renderer/git/review/gold-standard-dod.test.ts
```

Expected: 全绿。

- [ ] **Step 3: 手工对照（有闲置机优先 `pnpm test:e2e:auto`，否则本机造冲突）**

1. UU 带标记：树 M；点该行只看到 UnresolvedFile，看不到其它冲突文件叠在下面。
2. DU：树 D；点该行只看到文件级卡「采用传入版本 / 确认删除」，无「打开文件」。
3. UD：树 M（文件还在）；卡上可打开、可保留当前或确认删除。
4. 手改掉 UU 标记后回到审查：主按钮「暂存当前文件」，暂存后文件离开合并更改；点采用传入会覆盖手改。
5. 切换树节点：正文立即换成对应文件，无 40vh 多卡长滚。

---

## 明确不做

| 不做 | 原因 |
|---|---|
| `@pierre/trees` 加 conflicted→C | 二次封装；分组已表达冲突 |
| 多个 UnresolvedFile 虚拟进 CodeView | 上游不支持（冲突设计 §11） |
| 把 7-31 G0–G6 加载/骨架再开一轮 | 另一里程碑，与本不一致无关 |
| 文件级再套 `showAppConfirm` | 冲突卡本身就是决策面 |
| 给 file-level 做三方 merge editor | 无标记可解析 |

## 覆盖对照

| 金标准条款 | Task |
|---|---|
| §3.1 侧栏全量、正文当前冲突文件 | Task 2 |
| §3.1 不可结构化：说明卡 + ours/theirs/打开 | Task 4–5 |
| §3.2 一文一屏，不虚拟多 Unresolved | Task 2 |
| §3.3 tooLarge/encoding + 打开 | Task 5 |
| §7 P2 ours/theirs + add | 已落地；Task 4 补 stage |
| 禁止 ready-notice 当冲突主路径 | 已落地；Task 3 堵住水合期 estimate 漏进 CodeView |
| 树与正文同一 `xy` | 已落地；Task 1 纠正 `UD` |

## 执行交接

方案已写到 `docs/superpowers/plans/2026-08-27-git-review-conflict-gold-standard.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每 Task 一个新子代理，Task 之间审查
2. **Inline Execution** — 本会话按 Task 推进，检查点停一下

要走哪一种？
