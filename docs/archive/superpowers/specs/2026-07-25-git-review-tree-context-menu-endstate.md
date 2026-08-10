# Git Review 树右键：终态契约

日期：2026-07-25  
状态：**P1+ 落地（Command 含 B-Select 判定 + 持续 rAF raw scroll freeze + 会话禁导航）**

## 1. 状态所有权

| 名 | 所有者 | 用途 |
|----|--------|------|
| L-Select | pierre `selectedPaths` | 树 `aria-selected` |
| L-Focus | pierre focused + DOM | 焦点环；**永不 open / 永不滚 CodeView** |
| B-Select | `selectedEntryKey` + `sectionKey` | 审查目标；**仅 B 变化可 `scrollToItem`（含 section 重绑）** |

## 2. 意图

| Intent | 条件 | 行为 |
|--------|------|------|
| **Inspect** | 右键**未** L-Select 的 **file** | select + `onOpenPath` 一次；允许导航滚动 |
| **Command** | 右键**已** L-Select 的行，或目录 | 仅菜单；禁 open / beginNavigation / scrollToItem |
| **Browse** | 用户滚 CodeView | 可 clear 导航意图（现有 wheel/touch） |

## 3. 原生菜单与滚动

- 允许 Electron `Menu.popup` 抢 web 焦点（OS 行为；关菜单后可不恢复 focus ring）。
- **Command 判定** = 树 L-Select **或** 宿主 `isActiveOpenPath`（B-Select 已打开该 file），避免「树没高亮却其实已打开」每次都当 Inspect。
- **Command**：`begin` 起 **rAF 循环**钉 CodeView 真实滚动节点的 raw `scrollTop`（解析 overflow 祖先，禁止 `restoreAnchor`）；`end` stop + 再钉两帧。会话内 `commandMenuSessionRef` 硬禁 `openTreeNode`。
- **Inspect**：不 freeze；允许一次 navigate。
- 菜单会话 `suppressOpenPathFromContextMenu` 全程有效。
- 菜单关闭后：补 L-Select 若丢失；**不** `focusPath`。

## 4. resume 规则

- 同一 `navigationKey` 已投影：只更新 watermark，**禁止** `scrollToItem`。
- `navigationKey` 变化（如 stage section 重绑）且不可见：允许一次 `scrollToItem`。
- 显式 `beginNavigation` / `tryPendingNavigation` 仍可定位。

## 5. 验收

1. 未选中 file 右键 → open 一次。  
2. 已选中 file 再右键多次 → open 0、CodeView `scrollTop` 不变。  
3. 目录右键 → 无 open。  
4. stage 换 section → resume 可 rebind 并必要时 scroll 一次。
