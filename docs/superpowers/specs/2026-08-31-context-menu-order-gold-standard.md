# 右键菜单顺序金标准

日期：2026-08-31  
状态：现行权威（顺序）  
范围：所有已登记右键表面的分组与顺序。  
不包含：命令语义、主点击、命令面板 MRU、原生菜单滚动钉住。

相关：[`2026-08-30-review-open-project-directory-gold-standard.md`](./2026-08-30-review-open-project-directory-gold-standard.md) 仍管「打开目录」的入口、门面、禁令；**组序以本文为准**。

构建器：`src/renderer/lib/context-menu/build-entries.ts`（`group` 字典序，同组 `sortOrder`，空组不占分隔线）。

---

## 一句话终态

右键第一项必须是**这个表面、这个目标**上最可能、且不会把人带离当前工作的动作。同组高频项被藏掉时，禁止让低频「离开表面」项继承第一名。菜单位置稳定，不用使用频次热排。

---

## 原则

1. **第一项 = 默认命中。** 尽量非破坏、不离开表面。
2. **按表面家族排，不按抽象「打开」语义排。** 审查 ≠ Files 树 ≠ 编辑器 ≠ 标签。
3. **隐藏提升禁令。** 同组 `menuHidden` 之后，剩下的可见项不得变成离开当前表面的导航（打开目录、在访达中显示），除非该表面本来只有路径动作（面包屑）。
4. **破坏性靠后。** 丢弃有确认；删除 `7_danger`；清屏与复制分开；关闭标签 `9_close` 最后（标签已有 ×）。
5. **应用内打开 ≠ 操作系统。** 「打开目录」禁止进 `6_path`。
6. **位置稳定。** 右键不做 MRU。`ActionMetadata.group` 仍是字符串；一条命令全表面同一组。
7. **不靠再塞 `1_xxx` 抢第一名。** 要让暂存压过打开文件，把打开文件挪出 `1_open`。查找组名必须保持 `1_find`：字典序先于 `1_new` / `1_open` / `1_reading` / `1_review` / `1_run`。禁止改成 `1_search` 等会滑到后面的名字。

---

## 表面家族

| 家族 | 表面 | 第一项（有目标时） |
|------|------|-------------------|
| 审查 | `git/review-tree-item` | 暂存 / 取消暂存 |
| 审查文档 | `git/review-diff` | 视觉第一项是复制（无选区禁用仍显示）；有选区时第一个可用项 = 复制；无选区时 = 全选。跳转到源码是打开组第一项 |
| 资源管理器 | `files/tree-item`、`files/tree-background` | 新建文件 |
| 命中 | `files/search-result` | 打开 |
| 路径对象 | `files/breadcrumb` | 复制路径 |
| 文档 | `files/editor`、`files/markdown-preview`、`files/canvas-preview`、`terminal/content`、`terminal/restored`、`panel/content` | 视觉第一项是复制（终端无选区禁用仍显示）。终端无选区时第一个可用项 = 粘贴 |
| 标签 | `dockview-tab` | 预览文件 → 固定标签；普通文件 → 复制地址；任务（新建终端已藏）→ 重新运行。关闭在最后 |

---

## 槽位（现有组名，不重命名大段）

| 槽 | 组名 | 典型项 |
|----|------|--------|
| 剪贴板编辑 | `0_edit` | 剪切 / 复制 / 粘贴 / 全选 / 运行选中内容 |
| 查找 | `1_find`（名字是契约：必须字典序小于 `1_new`） | 终端查找 |
| 表面主工作 | `1_review` / `1_new` / `1_open` / `1_run` / `1_reading` / `1_navigation` | 暂存、新建、跳转到源码、重跑、版心、转到行 |
| 本表面视图 | `2_view` / `2_agent` / `2_appearance` / `2_split` | 展开、智能体输入、外观、拆分 |
| 聚焦 / 窗口 | `3_focus` / `4_layout` / `4_window` | 聚焦组、均分、移到窗口 |
| 离开表面但仍在应用内 | `5_open` / `5_edit` | 打开目录、审查「打开文件」、重命名 |
| 操作系统路径 | `6_path` | 复制路径、在访达中显示 |
| 破坏 | `7_danger` / `8_clear` | 删除、清屏 |
| 关闭 | `9_close` | 关闭标签 / 关闭终端 |

---

## 草图

`|` 为分隔线。

### `git/review-tree-item`

- 文件（未暂存）：暂存 → 丢弃 | 打开文件 → 打开目录 | 复制路径 → 复制相对路径 → 在访达中显示
- 目录：暂存 / 取消暂存 | 展开目录 → 折叠目录 | 打开目录 | 复制… → 访达
- 分组根：暂存或取消暂存 | 展开 → 折叠 | 打开目录（无复制 / 访达）

`pier.git.review.openFile` 与 `pier.git.review.openDirectory` 同组 `5_open`（0 / 1）。`pier.git.review.openInEditor`（跳转到源码）留在 `1_open`，只挂 diff。

### `git/review-diff`（并入 `panel/edit`；多组时并入 `panel/layout`）

复制 → 全选 | 跳转到源码 | （多组：聚焦 / 均分） | 打开目录 | 复制路径… → 访达

无选区时复制禁用仍显示。git 插件单测只锁打开/路径段；组合草图锁宿主剪贴板与布局。

### Files 树

- 文件（无树剪贴板）：新建文件 → 新建文件夹 | 在文件夹中查找 | 重命名 → 副本 → 剪切 → 复制 | 复制路径… → 访达 | 删除
- 文件（有树剪贴板）：同上，剪切 → 复制 → 粘贴
- 目录：同上，`2_view` 另含展开 / 折叠
- 空白：新建文件 → 新建文件夹 | 展开 → 折叠 → 在文件夹中查找 | 粘贴（有剪贴板时）

资源管理器家族，新建保持第一。删除已在 `7_danger`。

### 其它

- `files/search-result`：打开 | 复制路径 → 复制相对路径 → 复制匹配行 → 访达
- `files/breadcrumb`：复制路径 → 复制相对路径
- `files/editor`：剪切 → 复制 → 粘贴 → 全选 | 转到行 → 符号信息 → 选出现 / 加光标 | 自动换行 | 复制路径… → 访达
- Markdown / Canvas 预览：复制 → 全选 | 舒适 / 宽屏（当前档隐藏） | 外观（当前档隐藏；Canvas 仅自己声明的项） | 复制路径 → 访达
- `terminal/content`：复制 → 粘贴 → 全选 → 运行选中内容 | 查找 | 新建终端或重跑 / 停止 | 智能体输入 | 拆分 | 聚焦 / 均分 | 清屏 | 关闭终端
- `terminal/restored`：复制 → 全选 | 重跑 / 停止 | 均分 / 聚焦 | 关闭终端
- `dockview-tab` 预览文件：固定标签 → 复制地址 | 新建 / 拆分 / 窗口 | （审查标签）打开目录 | 关闭…
- `panel/content`：复制 → 全选 | 均分 / 聚焦（多组时）

---

## 组/顺序对照

| 动作 | 组 / sortOrder |
|------|----------------|
| `pier.git.review.openFile` | `5_open` / 0 |
| `pier.git.review.openDirectory` | `5_open` / 1 |
| `pier.git.review.openInEditor` | `1_open` / 0 |
| `pier.terminal.search` | `1_find` / 0 |
| `pier.terminal.clearScreen` | `8_clear` / 0 |
| `pier.panel.keepOpen` | `0_edit` / 1（`copyPath` 为 2） |

---

## 禁止

1. 审查目录 / 分组根第一项是「打开目录」。
2. 「打开目录」与访达同组（`6_path`）。
3. Files 树改成审查那套「暂存优先」。
4. 标签「关闭」提到第一项。
5. 右键 MRU / 按用户历史重排。
6. `group` 改成按 surface 变化的函数。
7. 靠新增 `1_xxx` 组名抢第一名；把 `1_find` 改成字典序落到 `1_new` 之后的名字。
8. 清屏与复制粘贴同一组、中间无分隔。

---

## 检查点

- `tests/unit/renderer/context-menu/order-governance.test.ts`
- `tests/unit/renderer/context-menu/order-sketches.test.ts`
- `tests/unit/renderer/context-menu/order-sketches-composed.test.ts`
- `tests/unit/renderer/git/review/tree/actions.test.ts`
- `tests/unit/renderer/git/review/diff/actions.test.ts`
- `tests/unit/renderer/terminal/context-menu-actions.test.ts`
- `tests/unit/renderer/git/review/open-directory-governance.test.ts`（打开目录仍 `5_open`）
