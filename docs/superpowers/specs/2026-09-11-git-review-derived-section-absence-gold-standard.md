# Git Review：派生组合阅读面的缺席语义

日期：2026-09-11
状态：**已落地** — `working` 派生段的缺席与失败分类；不改 stage / hunk 语义、不改索引事实（renderSlots）、不改失败通道与文案。
范围：`working` 段的存在性、`surfaceSections.head` 判据、派生面与槽背书面的失败语义分工。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| `2026-07-31-git-review-gold-standard-endstate-design.md` | Review 终态唯一权威 | 不改；本文只收紧派生段的缺席与失败分类 |
| `2026-08-02-git-review-live-update-failure-contract-design.md` | 背景刷新 / 失败分级契约 | 其 §7.2「瞬态 / 可重试」集合**不包含**派生面缺席；本文收窄 |
| **本文** | **派生组合面（working）的唯一规则源** | 派生段的规则与检查点 |

**实现禁令：** 未对照本文时，禁止再把「派生面读不到内容」升级成 `staleRevision` / `internal` / 协议错误来「统一处理」。

---

## 0. 一句话契约

> **派生组合面（working）没有自己的索引槽：读不到内容就是「这个面不存在」，绝不产生失败、绝不重试；只有 index 槽背书的分组才把「读不到」当陈旧事实。**

---

## 1. 现象与根因

用户看到的：审查面板对某个文件显示**「无法加载此变更」+ 重试**，而重试永远无效。`resource-projection.ts` 只给 `timeout` 专用文案，其余失败（含 `staleRevision`）都落到 `ui.reviewDocumentLoadFailed`。

触发状态都是**稳定态**，不是竞态：

| 稳定态 | git 事实 | 旧行为 |
|--------|----------|--------|
| 暂存新增 + 磁盘删除（porcelain `AD`） | HEAD 与工作区都没有该路径，`git diff <HEAD> -- <path>` 输出 0 字节 | 空输出判为 stale → 重试 3 次 → `staleRevision` → 整份文档 error |
| 暂存改名 `a→b` + 删除 `b`（`RD`） | 工作区侧不存在（b 已删），HEAD→工作区记录是 `D a` | worktree fence 读 b 得到「文件不存在」→ 判为 stale → 同上 |
| 暂存改写 + 工作区回滚到 HEAD 内容 | HEAD 与工作区内容相同，输出 0 字节 | 同 `AD` |

根因：`working` 段由 staged / unstaged 槽**派生**，却沿用了槽背书的失败语义——空输出 = stale、工作区文件读不到 = stale、raw 记录必须与派生 fact 的路径与状态逐字段一致。派生 fact 的路径与状态是对槽的继承猜测，而 HEAD→工作区是另一组比较，未必产出同一记录。

---

## 2. 硬规则

1. **存在性由 git 输出决定。** `working` 段存在当且仅当该路径组在 HEAD→工作区比较中给出**与派生 fact 匹配的单一记录**；否则该段不存在，`surfaceSections.head = null`（契约允许，schema 只要求非 null 时指向成员段）。
2. **派生面禁止产生失败或重试。** 空输出、记录不匹配、命中多条记录，对派生面都只是「这个面表达不了」：不得升级为 `staleRevision`、`internal` 或协议错误。
3. **派生面没有工作区槽。** 工作区侧不存在（unstaged 事实 `deleted`；或只有 staged 事实且其 `deleted`）时不做 worktree fence——「文件不在工作区」不是陈旧事实。
4. **槽背书分组语义不变。** staged / unstaged / committed / conflict：空输出仍是陈旧事实（有界重试），记录不匹配仍是 stale，重复记录仍是协议错误。降级只发生在派生面。
5. **分类单点。** 「空输出 → stale / 缺席」与「记录匹配 → 选中 / 缺席」只在 `document/envelope-selector.ts` 按 backing 判定；backing 由 `document/working-section.ts` 从槽事实派生；`document/index.ts` 只对 `group === "working"` 传入。
6. **槽背书分组的正文不得缺席。** builder 对非 working 分组拿到缺席一律按协议错误处理（不变量守卫，不是可达产品路径）。
7. **失败文案不变。** 仍在 `ui.reviewDocumentLoadFailed` / `ui.reviewFailureTimeout` 现有映射下；本文只消除失败的产生，不新增文案，也不在 renderer 翻译缺席。

---

## 3. 反例（禁止）

- 在 `createWorkingFact` 里用 `stat` / 文件存在性当唯一防线——同长度改写、回滚、改名删除都绕不过 diff 命令本身。
- 给 `working` 段再造一套「读文件判断工作区侧」的第二事实来源。
- 把「派生面缺席」翻译成 `ui.reviewDocumentLoadFailed`（那是失败面，不是缺席面）。
- 为了「顺手」修派生面而放宽槽背书分组的匹配规则。
- 在 renderer 里猜测 `head` 段缺席的原因（renderer 只读 `surfaceSections`）。

---

## 4. 检查点

| 检查点 | 断言 |
|--------|------|
| `tests/unit/main/git/review/derived-section-governance.test.ts` | `AD` / `RD` 类稳定态返回文档且不产出 Head 段；`workingSectionBacking` 由 unstaged 事实决定工作区侧；派生规则与空输出分类各只有一处实现 |
| `tests/unit/main/git/review/document.test.ts` | 暂存新增 + 磁盘删除（含批摘录）、暂存改写 + 工作区回滚：文档 ok、无 Head 段、槽段齐全 |
| `tests/unit/main/git/review/document-envelope.test.ts` | 空输出 / 记录不匹配 / 重复记录：派生面缺席且不抛错；同一输入对槽背书分组仍是 stale |

---

## 5. 未决

- `working`（head）段在 renderer 没有阅读面（`reading-surface.ts` 明确 `head` 不是 UI 面）。本文只保证它「缺席合法、绝不失败」。若产品要重新提供 HEAD 组合视图，必须先给它自己的索引事实（porcelain 之外的一次显式比较），不能继续沿用槽继承的猜测 fact。
