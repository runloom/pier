# Git Review 终态架构：官方 CodeView 数据面 + SCM Index

日期：2026-07-25  
状态：**部分 supersede（2026-07-27）** — **显示几何 / CodeView 身份集 / 点树可滚** 以  
`2026-07-27-git-review-stable-ledger-design.md` **为准**。  
本文仍管辖：真正文、soft-retain、stage/hunk、failure settled-only、树 delta 开放项。  
成员策略（历史名「A」）：**仅 materialize 进 CodeView 已作废** → 全量稳定高度账本 + estimate 槽。

## 0. 决策摘要

| 项 | 决定 |
|---|---|
| 方向 | **根治终态**，禁止在 **旧** placeholder（`patch:null` 假折叠）上继续症状修补 |
| 官方对齐 | `@pierre/diffs` CodeView + 真 `FileDiffMetadata` + 可选 `loadDiffFiles` |
| DiffsHub 对齐 | **稳定 id 账本**上 scrollTo；树稳定 model + delta batch（几何见 stable-ledger） |
| Pier 独有 | L1 SCM Index（uncommitted / stage / conflict）+ Electron IPC |
| CodeView 身份集 | **superseded** → `stable-ledger`：全 `renderSlots` + estimate\|loaded\|error\|ready-notice |
| 废弃 | `patch: null` **假**槽；stage 后整图 projection 核爆；**稀疏 members 冒充对齐** |

**§4「未 materialize 不进 CodeView」整段作废。** 未 materialize 以 **estimate** 进账本（见 stable-ledger §3）。

---

## 1. 背景与问题

### 1.1 现状（将被废弃）

```
git status ──► Index 全量槽
                 │
                 ├── 树：常整表重建
                 └── CodeView：全量「placeholder 头」(patch:null)
                        │
                        └── demand 后再换成真 patch
Stage ──► write ──► watch ──► 整图 index 重建 ──► 整图投影撕贴
```

用户体感：

1. 目录树偶发无法下滚（模型重建 / reveal 抢滚动 / 高度链）  
2. 暂存/取消暂存闪错误（中间态 re-parse 进 failure 面）  
3. 点较远文件先像收起再展开（空 placeholder 污染 collapsed/loading 语义）

### 1.2 为什么局部修补不够

改 chevron 文案、delay toast、锁 scrollTop **不改变数据面所有权**。  
根因是：**自研「假 item 进 CodeView」+「写后整图刷新」**，与 Pierre 官方及 DiffsHub 的数据面不一致。

### 1.3 官方最佳实践（pierre monorepo）

- CodeView 项必须是真 `CodeViewDiffItem` / 真 `FileDiffMetadata`  
- `isPartial: true` = **patch 只含 hunk 片段**（正常 git diff），不是「未加载空壳」  
- `loadDiffFiles` 在已有 partial metadata 上 **原地水合** 全文，供展开上下文  
- DiffsHub：点树 → 必要时 `collapsed=false` → `scrollTo(item)`；树路径 **增量 batch**  
- **没有** `patch: null` 假槽占位路径

---

## 2. 目标与非目标

### 2.1 目标

1. 远文件导航：从点击到定位，**不出现**假收起帧  
2. stage/unstage 成功路径 **零错误 UI**；失败 **单次稳定反馈**  
3. status 连续事件下树 **可稳定滚动**，scrollTop/selection 可保持  
4. 大仓（数千变更文件）首屏与内存可控  
5. 渲染原语 100% 走 `@pierre/diffs` / `@pierre/trees` 官方语义  

### 2.2 非目标

- 不做远程 PR 审查产品化（DiffsHub 领域）  
- 不把 Git 逻辑塞进 host 通用 panel-kit 之外的第三方 marketplace  
- 不在 P0 改 commit 主路径 UI（可后续叠）  
- 不强制小仓也预加载全部 patch（B 策略保留为可选优化，非默认）

---

## 3. 终态三层所有权

```
L1  SCM Index（main / git-review）
    status 分组 · path · oid · stage 态 · rename · conflict
    产出：稳定 entryKey / sectionKey · tree delta · materialize 参数

L2  Tree Model（@pierre/trees）
    打开时建一次 model；之后只 batch(delta)
    保留 scroll / selection / expand 身份

L3  CodeView（@pierre/diffs）
    成员 ⊆ 已 materialize 的真 item
    processFile(patch) → 真 FileDiffMetadata
    可选 loadDiffFiles 水合全文
    折叠 / 虚拟列表 / scrollTo：官方 API
```

### 3.1 硬禁止

| 禁止 | 原因 |
|---|---|
| `patch: null` 的 placeholder 进 CodeView | 污染 collapsed/loading，造成假收起 |
| 用 `isPartial + lineCount=0` 伪造未加载 | 官方 `isPartial` 不是「未 materialize」 |
| stage 后 `projectReviewDocuments(全量)` 整表换血 | 闪错、闪烁、树抖 |
| 每次 status 用全新 paths 重建 FileTree model | 滚不动、丢 selection |
| 未 settled 的 parse 错误进 failure banner / toast | 闪错 |

### 3.2 稳定身份

- `entryKey`：逻辑文件身份（跨 stage 搬家保持或显式映射表）  
- `sectionKey`：CodeView item `id`（半暂存双 section 时两个 id）  
- materialize 后的 `FileDiffMetadata` 对象：hydrate 时 **保持 identity**（对齐官方）  

---

## 4. CodeView 成员策略 A（**整节作废** → stable-ledger）

> **Superseded by** `2026-07-27-git-review-stable-ledger-design.md`。  
> 下式仅为历史记录，**禁止**再实现。正确：全 `renderSlots` 进账本；未 materialize = **estimate**。

### 4.1 成员集合（历史，勿实现）

```
// 作废：
CodeViewMembers =
  Materialized(entryKeys)
  ∪ ViewportBuffer(entryKeys)
  ∪ SelectedEntry
  ∪ Seed(first N)
```

- **现行：** 未 materialize **以 estimate 进 CodeView 账本**；demand 只水合正文  
- 侧栏加载态可保留；**禁止** collapsed 伪加载  

### 4.2 首批 seed

- 有界：`min(估算视口条数, MAX)`，MAX 与现有 seed 量级同阶（约 25–96，实现时钉常量）  
- 仅 seed **真 materialize**，不是假槽  

### 4.3 视口驱动

- 继续消费 CodeView 官方 render window / visible+buffered item ids  
- 映射为 entryKey demand → materialize → `addItem`/`updateItem`  
- 离开缓冲且非 selected/protected 的 item：可 `removeItem` 或保留 LRU（实现选一，须文档化；默认 **LRU 上限** 防内存涨）  

---

## 5. 正文加载（官方语义）

### 5.1 Materialize

```
demand(entryKey)
  → main: git-review document（真 unified/split patch 文本）
  → renderer: processFile(patch, { isGitDiff: true, ... })
  → CodeView add/update item { id: sectionKey, type: 'diff', fileDiff }
```

- 失败：仅 **该项 settled 失败** 时进入失败面（行内或稳定 banner），可 retry  
- 禁止把 loading 编码成 `collapsed: true`  

### 5.2 loadDiffFiles（可选二期，契约预留）

- 用途：展开 patch 外上下文、完整文件高亮  
- 签名对齐 `@pierre/diffs` `FileDiffContentsLoader`  
- 从 git show / 工作区读 old/new blob，**原地**升级 metadata  

### 5.3 导航（DiffsHub 同形）

```
onTreeSelect(entryKey, sectionKey):
  if !hasItem(sectionKey):
    await materialize(entryKey)   // 可并行 show tree row busy
  item = getItem(sectionKey)
  if item.collapsed: item.collapsed = false; updateItem(item)
  scrollTo({ type: 'item', id: sectionKey, align: 'start' })
```

删除「对 placeholder 滚动 + 长 verify 超时」作为主路径（最多保留为防御性日志）。

---

## 6. 树（L2）

### 6.1 更新

- 打开：`useFileTree({ paths: initialSnapshot, gitStatus })` 一次  
- 之后：`model.batch` 应用 L1 delta（add / remove / status 更新）  
- 排序：保持 VS Code 式 conflict → staged → unstaged；与现 `TREE_GROUP_ORDER` 一致  

### 6.2 滚动所有权

- 用户滚动：任何 reveal/status 不得抢 scrollTop，除非：  
  - 用户刚点选该 path，或  
  - 显式 API `reveal(path, { scroll })`  
- status 刷新：默认 **保持** scrollTop 与 expanded 集合  

---

## 7. Stage / Unstage 乐观事务（L1↔L2↔L3）

### 7.1 状态机（每 section 或 path 聚合）

```
idle
  → optimistic_busy（本地 stageControl.busy + 分组乐观搬家）
  → write IPC
       ├─ fail → rollback + 单次 error 反馈
       └─ ok → optimistic_committed
            → background index reconcile (delta only)
                 ├─ matches → clear busy，静默
                 └─ diverges → surgical 纠正冲突项 only
```

### 7.2 硬规则

- 成功路径：**零** toast.error / failure banner  
- write 进行中：忽略同源 path 的瞬态 document/render error 进用户面  
- reconcile **禁止** `resetGeneration` 清空 CodeView 再全量灌  
- half-staged / rename：L1 给出稳定 sectionKey；L3 只 update stageControl / group，不换 id  

### 7.3 与 watch 的关系

- watch 仍是真相源，但只产 **delta**  
- 乐观态与真相冲突时以真相为准，且 **单点纠正**，不整图闪  

---

## 8. 失败面

| 来源 | 用户可见时机 |
|---|---|
| stage write 失败 | 立即，一次，可带 detail alert |
| materialize 失败 | 该项 settled 后，行内/条目级 |
| parse 失败 | 同上；水合中 / busy 中 **不** 抬到全局横条 |
| index 拉取失败 | 整页/侧栏级 Empty + retry（已有能力可复用） |

删除「render error 微任务闪一下再清空」作为合法 UX。

---

## 9. 验收标准（根治判定）

1. 远文件点击：从 click 到定位，DevTools/探针 **抓不到** `patch:null` CodeView 成员帧  
2. stage/unstage 成功：自动化/手工 **零** 错误 toast 与 failure 横条  
3. stage 失败：恰好 **一次** 稳定错误  
4. 连续 `git status` 模拟刷新：树可连续滚动到底，selection 不丢  
5. 5000 文件变更仓：打开可交互；内存不随「假全量 CodeView 槽」线性暴涨  
6. 折叠：仅用户操作 / 全部折叠；与 materialize 无关  
7. 依赖边界：git renderer 不再导出/依赖「placeholder projection 金标准」路径  

不满足 1–4 视为未完成终态。

---

## 10. 删除清单（概念与代码方向）

实现迁移中应移除或降级为 internal-only 的概念：

| 旧概念 | 处置 |
|---|---|
| `git-review-placeholder:${sectionKey}` 进 CodeView | 删除 |
| `projectReviewDocuments` 全量槽投影为唯一列表源 | 改为「仅对 Materialized 集合投影/应用」或删除后由 item apply 层取代 |
| 导航主路径对 placeholder 的 scroll+verify | 删除主路径 |
| stage 后整代 `resetGeneration` + 全量 resources 重灌 | 改为 delta + 乐观 |
| 树每次 index 全量 `items` 替换触发等效重建 | 改为 delta batch |

具体文件在实现 PR 中对照修改（当前热点：`git-review-document-projection.ts`、`use-git-review-navigation.ts`、`use-git-review-document-session.ts`、`git-review-code-view.tsx`、`git-review-tree*.ts`、`git-review-failure-state.ts`、`packages/ui/diff-view-items.ts` placeholder 路径）。

---

## 11. 迁移 PR 顺序（同一架构，禁止穿插症状补丁）

| PR | 交付 | 完成定义 |
|---|---|---|
| **P0** | 本文契约 + 测试钉子（禁 placeholder 进成员、禁成功路径 error） | 文档合入；governance/契约测骨架 |
| **P1** | Materialize → `processFile` → 真 item；CodeView 仅窗口成员 | 远文件无假收起；需求 1 初过 |
| **P2** | 导航 DiffsHub 同形；收敛旧 verify 主路径 | 点树即滚，无两阶段头 |
| **P3** | 树 delta batch + 滚动所有权 | 需求 3 |
| **P4** | stage 乐观事务 + surgical reconcile | 需求 2 |
| **P5** | failure 面 settled-only；拆无用 projection/placeholder 代码 | 验收 1–7 全绿 |

**约束：** P1 前禁止再合「placeholder 外观/闪错 toast」类症状 PR，除非标注为 temporary 且有删除日期。

---

## 12. 与 DiffsHub / 官方的关系

| | DiffsHub | Pier 终态 |
|---|---|---|
| CodeView | 真 item | 真 item（窗口成员） |
| 未加载文件 | 通常不在列表 | 在 **树**，不在 CodeView |
| 加载 | stream patch / GitHub loader | materialize patch + 可选 loadDiffFiles |
| 树 | 增量 batch | 同左 |
| stage | 无 | 乐观事务 + L1 delta |
| 产品 | 只读 patch/PR | 本地 SCM Review |

终态 = **官方渲染数据面 + 桌面 SCM 控制面**，不是把 Pier 改成 DiffsHub，也不是继续自研假槽。

---

## 13. 开放实现细节（不挡 P0，P1 选型时钉死）

1. LRU 上限与 evict 策略（默认建议：max materialized items 或 max MB）  
2. `loadDiffFiles` 是否进 P1 或 P1.1（P1 可仅 patch 真 partial）  
3. half-staged 乐观搬家的 entryKey 映射表形状  
4. 与现有 panel transfer / session cache 的衔接点  

---

## 14. 确认记录

- 2026-07-25：产品确认采用终态根治，**非**局部修补路线。  
- 成员策略确认：**A（窗口成员）**。  
- 下一步：按 §11 从 **P1** 起实现（P0 = 本文）。
