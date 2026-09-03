# 浮层分割线金标准

日期：2026-09-03  
状态：现行权威（下拉 / 右键 / 菜单栏 / Select / 命令列表 / 新建菜单页脚 / 消息中心弹层的发丝线）  
范围：产品浮层里 1px 水平分割线的左右停点、颜色、原语。  
不包含：设置 Card / 表单分区线、Sidebar `mx-2` 侧栏线、Item 列表 `ItemSeparator`、表格 `border-t`、对话框 sticky footer。

相关：新建菜单「管理智能体…」归属与入口仍以 [`2026-09-03-command-surface-preference-gold-standard.md`](./2026-09-03-command-surface-preference-gold-standard.md) 为准；命令列表何时画 `CommandSeparator` 以 [`2026-09-02-command-list-heading-gold-standard.md`](./2026-09-02-command-list-heading-gold-standard.md) 为准。本文只管线怎么画。

权威实现：[`packages/ui/src/separator.tsx`](../../../packages/ui/src/separator.tsx)（class 单源）；`DropdownMenuSeparator` / `ContextMenuSeparator` / `MenubarSeparator` / `SelectSeparator` / `CommandSeparator`；新建菜单页脚 [`create-menu-manage-agents.tsx`](../../../src/renderer/components/workspace/create-menu-manage-agents.tsx)；消息中心标题/列表 [`center-control.tsx`](../../../src/renderer/components/common/notifications/center-control.tsx)。  
检查点：`tests/unit/renderer/overlay-separator-governance.test.ts`。

---

## 一句话终态

浮层发丝线贴齐菜单壳，不跟圆角行高亮左右对齐。`p-1` 壳用原语 `-mx-1` 拉满；`p-0` 壳的区域边界用通栏 `Separator` 或容器 `border-t`。颜色一律 `bg-border/50` / `border-border/50`。禁止业务再写一套 `mx-*`。

---

## 决策树

1. **同一张命令表里的分组**（最近 / 智能体 / 运行；下拉两组命令）→ 只用该表面 Separator 原语，不要改 `mx`。
2. **换了一块区域**（列表 vs 页脚、标题 vs 列表）→ 贴壳通栏。页脚不是 cmdk item，线不得画在 `CommandList` 里。
3. **设置 Card / 侧栏 / 提交型 dialog footer** → 不是本标准。

圆角 `CommandItem` / `Button` 高亮本来就不贴壳。把线收成和高亮同宽，会把页脚读成又一条命令。

---

## 原语单源

class 字符串只来自 `packages/ui/src/separator.tsx`：

| 常量 | 用于 |
|------|------|
| `OVERLAY_MENU_SEPARATOR_CLASS` | `-mx-1 my-1 h-px bg-border/50`：抵消 `p-1`，贴到圆角壳 |
| `OVERLAY_REGION_SEPARATOR_CLASS` | `bg-border/50`：`p-0` 壳上的通栏 `Separator` |
| `OVERLAY_REGION_FOOTER_CLASS` | `border-border/50 border-t p-1`：`p-0` 壳的列表外页脚 |

`p-1` 菜单壳（viewport 或 Command 根）必须消费 `OVERLAY_MENU_SEPARATOR_CLASS`：

| 原语 | 壳 |
|------|----|
| `DropdownMenuSeparator` | dropdown viewport `p-1` |
| `ContextMenuSeparator` | context viewport `p-1` |
| `MenubarSeparator` | menubar 内容 `p-1` |
| `SelectSeparator` | Select 内容（可另加 `pointer-events-none`） |
| `CommandSeparator` | Command 根 `p-1` |

`p-0` 浮层外壳必须 `overflow-hidden`，发丝线才被圆角裁切贴壳：

| 表面 | 实现 |
|------|------|
| 新建菜单「管理智能体…」 | Popover `p-0 overflow-hidden`；页脚 `OVERLAY_REGION_FOOTER_CLASS`；按钮默认 28px ghost |
| 消息中心标题 vs 列表 | 通栏 `Separator` + `OVERLAY_REGION_SEPARATOR_CLASS` |

### Popover + Command 杂交壳

新建菜单是 Popover 壳 + 内层 Command 列表 + 壳外页脚。内层 Command **禁止**再套第二层 `rounded-3xl` 卡片（用 `rounded-none`），底边距 `pb-0`，否则通栏页脚线会被内层圆角和底 padding 读成列表内短线。命令面板 Dialog 本身就是 Command 壳，不套本条。

禁止：手写 `<hr>`；页脚用 `CommandSeparator`（会进滚动与 cmdk）；Popover+Command 杂交壳去套 `DropdownMenuSeparator`；给页脚加 `mx-1` / `mx-2` 去追文字或高亮；用 `opacity-50` 叠在 `bg-border` 上冒充 `/50`。

---

## 明确不做

- 为「精致」把区域线收成 item pill 宽
- 把 Command 内分组线改成与页脚不同的颜色或粗细
- 侧栏 / Card / dialog footer 套用 `-mx-1`
- 第三套发丝色
