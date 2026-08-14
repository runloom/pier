# Git Review 树跳转钉住（两相位 pending_scroll）

日期：2026-08-14  
状态：**导航 Commit 条件以此文为准**。  
部分 supersede：

- [`2026-07-31-git-review-gold-standard-endstate-design.md`](./2026-07-31-git-review-gold-standard-endstate-design.md) §7：`content 已在表面` **不含** estimate；`finishTerminal` 不是整页 settle，而是目标槽离开 estimate。
- [`2026-07-27-git-review-stable-ledger-design.md`](./2026-07-27-git-review-stable-ledger-design.md) K6 / K6b：第二次 `scrollTo` 仅允许目标自身 `estimate→loaded|error|notice`。
- [`2026-07-31-git-review-zed-feel-design.md`](./2026-07-31-git-review-zed-feel-design.md) K4：禁止等 **整页** document settle；**必须**等目标自己的正文终态再结束导航事务。

体感标杆仍是 Zed `pending_scroll`；引擎仍是 Pierre CodeView。不改成单文件 Review。

---

## 0. 一句话

> **Intent 立刻滚到账本 id（含骨架）；Commit 等目标槽变成 loaded / error / notice 并再钉一次顶。骨架可见 ≠ 跳转成功。**

---

## 1. 病理

旧实现把「骨架头可见 + 2 帧稳定」当成导航成功。远距离文件的中间槽几乎都是固定 5 行骨架高；跳过去后 lookahead 把目标上方文件灌成真高，目标被顶走，且 `preserveAnchor` 已关。

---

## 2. Key Decisions

| # | 决策 | 理由 |
|---|---|---|
| D1 | Intent 立刻 `scrollTo(instant, start)`，可打在 estimate | Zed 瞬跳 |
| D2 | `finishTerminal` 仅当目标 cacheKey **不是** `estimate:` | 骨架不是 attached body |
| D3 | 目标 cacheKey 从 estimate 变成真正文时，恰好 1 次 corrective | 兑现 K6b |
| D4 | navigating 时 demand 不含目标上方、尚未 follower 的新文件 | 邻文件撑高是远跳主因 |
| D5 | `selectedEntryKey != null` 时 `updateItem` 带 `preserveAnchor` | pending 结束后上方水合仍钉顶 |
| D6 | estimate 虚高用 numstat（`additions+deletions`），clamp 5..48 行 | 5 行骨架只是 UI |
| D7 | 用户滚轮走 `clearForUserIntent`，清 pending 与选中钉住 | 阅读权在用户 |
| D8 | 禁止 `loader.settled` / 整页水合 / verify 轮询 rescroll | 金标准 K4 仍成立 |

---

## 3. 两相位

```
onTreeSelect:
  侧栏选中立刻
  meta / 默认 notice → 不滚、立即终态
  beginNavigation
  Intent: ledger 有 id → scrollTo(instant, start)

finishTerminal 仅当:
  cacheKey 不是 estimate
  且 isItemVisible(sectionId, that cacheKey)
  且 该几何 2 帧稳定
  且 render window 已回报该 id
```

`scrollToCount`：已是真正文 → 1；先骨架后正文 → 2。前序文件增高 → 0 次应用层 `scrollTo`。

---

## 4. Demand

`composeReviewDocumentDemand` 在 `navigationPending || protectSelectedAnchor` 时只保留 **目标及其后序**。  
已 loaded 的上方文件靠 sticky / retention 保活，不从 demand 新开。

---

## 5. 估高

```
virtualLines = clamp(additions + deletions, 5, 48)
estimateHeight = header + virtualLines × lineHeight + pad
```

无 numstat → 仍用 5 行骨架槽高。骨架条仍是 5 根，画在预留体顶部；预留体用同色淡填充，高度只读 `geometry.ts`。

---

## 6. 探针

| 探针 | 终态 |
|---|---|
| 近处已 loaded | `scrollToCount = 1` |
| 远处先 estimate | `scrollToCount = 2`；estimate 期间 `navigationPending = true` |
| navigating demand | 不含目标上方新 entry |
| 选中未滚动时 hydrate | `preserveAnchor: true`；无第三次 `scrollTo` |
| 用户滚动 | pending 立即 false |

---

## 7. 拒绝

- 等整页 settle
- 前序测高变化就 rescroll
- `setTimeout` 当定位成功
- 单文件 Review
- 应用层写 `scrollTop`
- 固定 5 行骨架当远距离滚动尺
