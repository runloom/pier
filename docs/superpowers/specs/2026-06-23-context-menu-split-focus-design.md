# 拆分与聚焦菜单(含快捷键与命令面板)设计

> 日期: 2026-06-23
> 状态: 待批准

## 概述

参考 loomdesk,给 dockview panel 加"拆分"(split)和"聚焦方向导航"(focus directional)。两类操作在右键菜单(tab + terminal 内容区)、命令面板、快捷键三个入口同步出现。

共 8 个 action(4 向拆分 + 4 向聚焦),6 条默认快捷键,以 `Split →` / `Focus →` 子菜单形式折叠呈现。聚焦语义仅指方向键切焦点(focusUp/Down/Left/Right),不做最大化(zoomToggle/maximize)。

## 单源加多 sink:聚焦状态架构

main 上现有代码已明确把 dockview activePanel/activeGroup 当作"当前聚焦"的唯一源,见 [src/renderer/components/workspace/workspace-host.tsx:107](../../src/renderer/components/workspace/workspace-host.tsx) 与 [src/renderer/stores/panel-descriptor.store.ts:34-40](../../src/renderer/stores/panel-descriptor.store.ts)。所有需要"当前聚焦"信息的下游模块都是 sink,从 `onDidActivePanelChange` 回调被推。

```
              dockview activePanel / activeGroup  (唯一源)
                              |
                api.onDidActivePanelChange((panel) => {...})
                              |
              +---------------+---------------+
              v               v               v
        DescriptorStore   KeybindingScope   setActivePanelKind IPC
        .setActive(id)    .setActivePanel    -> Swift 原生层
                                              swap firstResponder
```

三个 sink 各管一摊,**不互相读、不反向写 dockview**,不是双源。

本设计新加的 `focusGroup(direction)` 只做一件事:几何算法找到目标 group,然后 `targetPanel.api.setActive()` 写回唯一源,三个 sink 自动跟随。**不引入新源、不改 sink 联动代码。**

## 方案选型(菜单分组)

围绕"8 条新 action 怎么挤进右键菜单"评估了三个方案:

| 方案 | 思路 | 放弃理由 |
|---|---|---|
| A. submenu 字段 + sortOrder 自动聚合 (采用) | 给 `ActionMetadata` 加 `submenu?: () => string` 字段,同字符串的 action 聚合成同名子菜单。builder 数据驱动,无硬编码 | — |
| B. 在 builder 里按 group 前缀硬编码子菜单 | `group: "2a_split"` 前缀自动进 `Split →` | 把"哪些 group 是子菜单"硬编码进 builder,逆现有数据驱动设计 |
| C. 拆分进子菜单,聚焦不进菜单 | split 走 `Split →`,focus 只走命令面板 + 快捷键 | 与 loomdesk 不齐,鼠标用户无入口发现 focus |

采用方案 A。理由:

1. 现有 [build-entries.ts](../../src/renderer/lib/context-menu/build-entries.ts) 已是"metadata 驱动 builder 零硬编码"的设计哲学,方案 B 破坏这一规则。
2. `submenu` 字段是 loomdesk 已验证的通用抽象,后续 `View →` / `Window →` 等聚合需求一次扩通用 schema 比每次改 builder 划算。
3. 鼠标用户依赖右键菜单发现 focus 功能,方案 C 砍掉这条发现路径。

## 改动地图

```
+-- shared/contracts -----------------------------------------+
| menu.ts                                                      |
|   已支持 submenu 节点 + 递归 zod schema   (无改动)           |
+--------------------------------------------------------------+
                          |
                          v
+-- main ------------------------------------------------------+
| ipc/menu.ts                                                  |
|   已支持递归 submenu 构建                  (无改动)          |
+--------------------------------------------------------------+
                          |
                          v
+-- renderer/lib ---------------------------------------------+
| actions/types.ts                                            |
|   ActionMetadata 加 submenu?: () => string                  |
|                                                             |
| context-menu/build-entries.ts                               |
|   桶内排序后加聚合逻辑                                       |
|                                                             |
| actions/panel-actions.ts                                    |
|   注册 splitLeft/Right/Up/Down + focusLeft/Right/Up/Down    |
|   现有 splitRight/Down 的 surfaces 补齐到 3 个               |
|                                                             |
| keybindings/defaults.ts                                     |
|   + 6 条默认 binding                                         |
+-------------------------------------------------------------+
                          |
                          v
+-- renderer/stores/workspace.store.ts -----------------------+
| splitPanel direction union 扩四向                            |
| + focusGroup(direction) 新方法                              |
| + pickFocusTarget 纯函数(算法本体,可单测)                    |
+-------------------------------------------------------------+
                          |
                          v
+-- renderer/i18n/locales ------------------------------------+
| + contextMenu.submenu.split / .focus                        |
| + contextMenu.action.splitLeft / Up / focus×4               |
+-------------------------------------------------------------+
```

## 菜单元数据扩展

### ActionMetadata 新字段

[src/renderer/lib/actions/types.ts](../../src/renderer/lib/actions/types.ts):

```typescript
export interface ActionMetadata {
  excludeFromMru?: boolean;
  group?: string;
  iconComponent?: LucideIcon;
  keywords?: readonly string[];
  sortOrder?: number;
  /**
   * 设置后, 该 action 进同名子菜单. 同 surface 内 submenu() 返回相同字符串的
   * action 会聚合成一个 MenuItemSubmenu (label = 返回值, children = 按
   * group/sortOrder 排序). 子菜单本身在父菜单的位置 = 其内第一个 action 的位置.
   * 命令面板忽略此字段, 永远平铺展示.
   */
  submenu?: () => string;
}
```

字段返回函数而非字符串,与 `title()` 同款,locale 切换后下次右键自动用新语言。

### buildMenuEntries 聚合算法

在 [build-entries.ts](../../src/renderer/lib/context-menu/build-entries.ts) 现有桶内排序之后加聚合步骤。算法:

```typescript
function emitBucket(bucket: Action[]): MenuItem[] {
  const placeholders: (
    | { kind: "action"; a: Action }
    | { kind: "submenu"; key: string }
  )[] = [];
  const submenuMap = new Map<string, Action[]>();
  for (const a of bucket) {
    const key = a.metadata?.submenu?.();
    if (key) {
      if (!submenuMap.has(key)) {
        placeholders.push({ kind: "submenu", key });
        submenuMap.set(key, []);
      }
      submenuMap.get(key)!.push(a);
    } else {
      placeholders.push({ kind: "action", a });
    }
  }
  return placeholders.map((p) =>
    p.kind === "action"
      ? actionToMenuItem(p.a)
      : {
          type: "submenu",
          label: p.key,
          submenu: submenuMap.get(p.key)!.map(actionToMenuItem),
        }
  );
}
```

`actionToMenuItem` 由现 [build-entries.ts:116-122](../../src/renderer/lib/context-menu/build-entries.ts) 那段 build action MenuItem 的逻辑抽出为私有 helper(accelerator 反查 + enabled 求值)。

### 约定

- 子菜单内 action 再带 `submenu` 时静默忽略(不递归无限嵌套)。
- 子菜单本身在父菜单的位置 = 该子菜单第一个 action 在桶里的相对位置(顺序遍历 push placeholder 自然实现)。
- main 一侧的 menu 契约 / Zod / Electron 构建**全部无需改动**,已经支持 submenu。

## Action 注册清单

8 个 action 在 [src/renderer/lib/actions/panel-actions.ts](../../src/renderer/lib/actions/panel-actions.ts) 的 `registerPanelActions()` 内注册。surfaces 统一为 `["dockview-tab", "terminal/content", "command-palette"]`。

| Action ID | group | sortOrder | submenu | icon | excludeFromMru | enabled | handler |
|---|---|---|---|---|---|---|---|
| `pier.panel.splitRight` | `2_split` | 1 | `() => t("contextMenu.submenu.split")` | `PanelRight` | — | `api?.activePanel != null` | `splitPanel(p.id, "right")` |
| `pier.panel.splitDown` | `2_split` | 2 | 同上 | `PanelBottom` | — | 同上 | `splitPanel(p.id, "below")` |
| `pier.panel.splitLeft` | `2_split` | 3 | 同上 | `PanelLeft` | — | 同上 | `splitPanel(p.id, "left")` |
| `pier.panel.splitUp` | `2_split` | 4 | 同上 | `PanelTop` | — | 同上 | `splitPanel(p.id, "above")` |
| `pier.panel.focusRight` | `3_focus` | 1 | `() => t("contextMenu.submenu.focus")` | `ArrowRight` | **true** | `(api?.groups?.length ?? 0) > 1` | `focusGroup("right")` |
| `pier.panel.focusDown` | `3_focus` | 2 | 同上 | `ArrowDown` | **true** | 同上 | `focusGroup("down")` |
| `pier.panel.focusLeft` | `3_focus` | 3 | 同上 | `ArrowLeft` | **true** | 同上 | `focusGroup("left")` |
| `pier.panel.focusUp` | `3_focus` | 4 | 同上 | `ArrowUp` | **true** | 同上 | `focusGroup("up")` |

### 设计决策

**方向序选择**:右/下/左/上(`Right / Down / Left / Up`)。右和下是主用方向(顺手扩屏),左和上较少用放后面。与 loomdesk 默认一致。

**子菜单内重复 "Split" / "Focus"**:`title()` 返回完整字符串 "Split Right",菜单里呈现 `Split → Split Right`(略重复)。同一份 title 同时给菜单和命令面板,命令面板搜 "split" 必须能命中。loomdesk 同款。

**focus 系列全部 `excludeFromMru: true`**:方向键操作频率极高(1 秒级配合 vim/tmux),进 MRU 会顶满命令面板,把更有意义的命令挤下去。与 main 上 `clearRecent` 这类元命令同款。split 进 MRU(用户密集拆分是真实使用信号)。

**enabled 条件差异**:split 用 `activePanel != null`(有任何 panel 即可拆),focus 用 `groups.length > 1`(至少有一个邻居)。组数小于等于 1 时菜单灰、快捷键 no-op。

### 现有两个 split action 的 surfaces 补齐

现 `splitRight` / `splitDown` 只挂 `["dockview-tab"]`(见 [panel-actions.ts:141, 159](../../src/renderer/lib/actions/panel-actions.ts))。本次一并扩到 `["dockview-tab", "terminal/content", "command-palette"]`,避免新 4 个 split 和老 2 个的可见性割裂。

### i18n key 新增

[src/renderer/i18n/locales/en.ts](../../src/renderer/i18n/locales/en.ts) 及其它 locale 文件:

```typescript
"contextMenu.submenu.split": "Split",
"contextMenu.submenu.focus": "Focus",
"contextMenu.action.splitLeft": "Split Left",
"contextMenu.action.splitUp": "Split Up",
"contextMenu.action.focusRight": "Focus Right",
"contextMenu.action.focusDown": "Focus Down",
"contextMenu.action.focusLeft": "Focus Left",
"contextMenu.action.focusUp": "Focus Up",
```

`splitRight` / `splitDown` 已存在,沿用。不另起 `commandPalette.action.split*` 系列,两个 surface 共用一份字符串。

## 默认快捷键

[src/renderer/lib/keybindings/defaults.ts](../../src/renderer/lib/keybindings/defaults.ts) 的 `DEFAULT_KEYMAP` 追加:

```typescript
{ commandId: "pier.panel.splitRight", keys: "Mod+KeyD" },
{ commandId: "pier.panel.splitDown",  keys: "Mod+Shift+KeyD" },
{ commandId: "pier.panel.focusUp",    keys: "Ctrl+Shift+ArrowUp" },
{ commandId: "pier.panel.focusDown",  keys: "Ctrl+Shift+ArrowDown" },
{ commandId: "pier.panel.focusLeft",  keys: "Ctrl+Shift+ArrowLeft" },
{ commandId: "pier.panel.focusRight", keys: "Ctrl+Shift+ArrowRight" },
```

`splitLeft` / `splitUp` 不绑默认快捷键(loomdesk 同款),菜单和命令面板入口足够。

### scope 全部 `"global"`

- focus 必须 global — 用户从 terminal panel 按方向键跳到 welcome panel 后,如果 scope 限 `panel:terminal`,跳到 welcome 后这个快捷键就失效。
- split 对称 global。

### Ctrl+ 字面 DSL 扩展

确认现状: [parse.ts:22-25](../../src/renderer/lib/keybindings/parse.ts) DSL 解析器只识别 `Mod+` / `Alt+` / `Shift+` 三个前缀; [types.ts:23-30](../../src/renderer/lib/keybindings/types.ts) `KeyChord` 只有 `cmdOrCtrl` 一个布尔字段(mac 上 = metaKey,非 mac 上 = ctrlKey),表不出"mac 上要 Ctrl 不要 Cmd"。focus 快捷键直接照搬 loomdesk 的 `Ctrl+Shift+方向键`,因此 DSL 必须扩展。

**采用方案**:`KeyChord` 加独立 `ctrl: boolean` 字段,`parse.ts` 平台感知:

- `Mod+` → `{ cmdOrCtrl: true, ctrl: false }`(语义不变)
- `Ctrl+`:
  - mac 上 → `{ cmdOrCtrl: false, ctrl: true }`(独立 Ctrl,不是 Cmd)
  - 非 mac 上 → `{ cmdOrCtrl: true, ctrl: false }`(等价 `Mod+`,因为非 mac 上 Mod = Ctrl 物理键)
- `chordFromEvent`:
  - mac 上 → `{ cmdOrCtrl: e.metaKey, ctrl: e.ctrlKey, ... }`
  - 非 mac 上 → `{ cmdOrCtrl: e.ctrlKey, ctrl: false, ... }`(非 mac 上无"独立 Ctrl"概念,ctrl 永远 false)
- `chordEquals` 加 ctrl 比较(5 字段)
- `chordFromNativeForward`(Swift IPC 路径,仅 mac):mac 逻辑同 `chordFromEvent`
- `toElectronAccelerator`(menu accelerator 显示):ctrl=true 时输出 `Control+...` 而非 `CmdOrCtrl+...`

**改动文件**:

| 文件 | 改动 |
|---|---|
| [types.ts](../../src/renderer/lib/keybindings/types.ts) | KeyChord 加 `readonly ctrl: boolean` |
| [parse.ts](../../src/renderer/lib/keybindings/parse.ts) | 加 `Ctrl+` 前缀解析;`parseChord(keys, isMac: boolean)` 函数签名扩平台参数 |
| [matcher.ts](../../src/renderer/lib/keybindings/matcher.ts) | `chordFromEvent` 加 ctrl 字段;`chordEquals` 加 ctrl 比较 |
| [use-keybindings.ts](../../src/renderer/lib/keybindings/use-keybindings.ts) | `chordFromNativeForward` 加 ctrl 字段 |
| [registry.ts](../../src/renderer/lib/keybindings/registry.ts) | 调 `parseChord` 处传 isMac() |
| [build-entries.ts](../../src/renderer/lib/context-menu/build-entries.ts) | `toElectronAccelerator` 加 ctrl → `"Control"` |

**实施粒度第 6 步分裂为 6a + 6b**:6a 完成 DSL 扩展(纯 keybinding 层改动 + 单测),6b 加 6 条 default binding。

## workspace store 改动

### splitPanel 扩四向

[src/renderer/stores/workspace.store.ts:16](../../src/renderer/stores/workspace.store.ts):

```typescript
// before
splitPanel: (panelId: string, direction: "right" | "below") => void;
// after
splitPanel: (panelId: string, direction: "right" | "below" | "left" | "above") => void;
```

实现 ([workspace.store.ts:165-185](../../src/renderer/stores/workspace.store.ts)) 不动 — `api.addPanel({ position: { referencePanel, direction } })` 的 dockview `direction` 字段本来就是 `"left" | "right" | "above" | "below" | "within"`,union 扩四向是纯类型放宽。

### focusGroup 新方法

新增到 `WorkspaceStore` 接口:

```typescript
focusGroup: (direction: "right" | "down" | "left" | "up") => void;
```

实现(参考 loomdesk 的几何算法,位于 `/Users/xyz/ABC/loomdesk/src/lib/workspace/workspace-host.svelte.ts:3227-3280`):

```typescript
focusGroup: (direction) => {
  const api = get().api;
  if (!api) return;
  const active = api.activeGroup;
  if (!active) return;
  if (api.groups.length < 2) return;

  const activeEl = getGroupElement(active);
  if (!activeEl) return;
  const ar = activeEl.getBoundingClientRect();

  const targetIdx = pickFocusTarget(
    ar,
    api.groups.map((g) => ({
      id: g.id,
      isActive: g.id === active.id,
      rect: getGroupElement(g)?.getBoundingClientRect() ?? null,
    })),
    direction,
    TOL_PX
  );
  if (targetIdx == null) return;

  const targetGroup = api.groups[targetIdx];
  const targetPanel = targetGroup.activePanel ?? targetGroup.panels[0];
  if (!targetPanel) return;
  const panel = api.panels.find((p) => p.id === targetPanel.id);
  panel?.api.setActive();
},
```

`targetPanel.api.setActive()` 是**唯一一次写回单源**,后续 sink 联动全部由现有 `onDidActivePanelChange` 回调自动完成。

### pickFocusTarget 纯函数

把"几何挑邻居"切出为纯函数,放在同文件或单独 `focus-target.ts`:

```typescript
interface GroupCandidate {
  id: string;
  isActive: boolean;
  rect: DOMRect | null;
}

export function pickFocusTarget(
  activeRect: DOMRect,
  candidates: readonly GroupCandidate[],
  direction: "right" | "down" | "left" | "up",
  tolPx: number
): number | null {
  const isVert = direction === "up" || direction === "down";
  let bestOverlap = -1;
  let bestDist = Infinity;
  let bestIdx: number | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.isActive || !c.rect) continue;
    const r = c.rect;

    const inDir =
      direction === "up"    ? r.bottom <= activeRect.top    + tolPx
      : direction === "down"  ? r.top    >= activeRect.bottom - tolPx
      : direction === "left"  ? r.right  <= activeRect.left   + tolPx
      :                         r.left   >= activeRect.right  - tolPx;
    if (!inDir) continue;

    const overlap = isVert
      ? Math.max(0, Math.min(activeRect.right, r.right) - Math.max(activeRect.left, r.left))
      : Math.max(0, Math.min(activeRect.bottom, r.bottom) - Math.max(activeRect.top, r.top));
    const dist = isVert
      ? Math.abs((r.top + r.height / 2) - (activeRect.top + activeRect.height / 2))
      : Math.abs((r.left + r.width / 2) - (activeRect.left + activeRect.width / 2));

    if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
      bestOverlap = overlap;
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
```

算法要点:

- `tolPx` 容忍像素 — 相邻 group 之间有 dockview gap,严格比较会判 false。
- `overlap` = 方向垂直轴上的投影重叠长度 — 横向 focus(left/right)看 y 重叠,纵向看 x 重叠。
- `dist` = 中心距离 — 重叠平分时作 tie-breaker。
- `c.activePanel ?? c.panels[0]` — 切到目标 group 用户上次选中的 tab(留在 store wrapper 里处理,纯函数只返 index)。

### getGroupElement helper

dockview 没把 group element 列入 public API,与 loomdesk 同款,用 cast + instanceof 守卫:

```typescript
function getGroupElement(g: unknown): HTMLElement | null {
  const el = (g as { element?: HTMLElement } | null)?.element;
  return el instanceof HTMLElement ? el : null;
}
```

落在 workspace.store.ts 同文件,不向外暴露。dockview 版本升级若改 group 类型,instanceof 让 focus 安全降级为 no-op 而非 crash。

### TOL_PX 与 pierTheme.gap 同步

`pierTheme.gap = 4`(见 [workspace-host.tsx:44](../../src/renderer/components/workspace/workspace-host.tsx))。首版 `TOL_PX = 5`(gap + 1) 硬编码 + 显式 comment:

```typescript
// = pierTheme.gap (4) + 1; 改 gap 必须同步此常量
const TOL_PX = 5;
```

后续 theme 抽公共模块时一并搬。不在本次范围。

## 边界

| 边界 | 处理 |
|---|---|
| `api == null`(启动初期) | `enabled()` 拦;`focusGroup` 内 if-return 兜底 |
| `activeGroup == null` | 同上 |
| `groups.length < 2` | `enabled()` 用该条判断菜单灰、命令面板隐藏、快捷键 no-op |
| 方向上无邻居 | `bestIdx` 留 null,函数 no-op,无视觉反馈。**不 wrap-around**(loomdesk 现状) |
| floating panel | 第一版**跳过**(若 dockview group 有 `floating === true` 字段);不参与 focus 候选。当前 Pier 无 floating UX,实施时验证 |
| `group.element == null` | `getGroupElement` instanceof 守卫,静默 no-op |

## 测试

### 单元测试(自动)

| 文件 | 覆盖 |
|---|---|
| `tests/unit/menu-build-entries-submenu.test.ts`(新) | 1) 同 submenu key 的 actions 聚合成 MenuItemSubmenu;2) 子菜单内部按 sortOrder 排;3) 子菜单本身位置 = 其内第一个 action 的相对位置;4) 没有 submenu 字段的 action 平铺、不受影响;5) 子菜单内 action 再带 submenu 时静默忽略;6) 同 group 混合 submenu / 非 submenu 时输出顺序符合预期 |
| `tests/unit/focus-target.test.ts`(新) | `pickFocusTarget` 纯函数:右邻、下邻、左邻、上邻、平分时取中心更近、无邻居返回 null、`candidates.length < 2` 返回 null、容忍 gap 像素、tie-break 中心距离 |
| `tests/unit/default-keymap.test.ts`(已存在,扩) | 加 6 条新 binding 解析断言;DSL 不支持 `Ctrl+ArrowUp` 时此 test 红 |

`pickFocusTarget` 抽离的关键作用:`focusGroup` 在 store 里要操作 dockview api(不容易 mock),把几何算法切出来后 100% 单测覆盖,store wrapper 只测 "no-op 在 api null / groups < 2" 这种边界。

### 手动验证清单

- 右键 tab → 看到 `Split →` / `Focus →` 子菜单,子菜单内有 4 个方向条目
- 右键 terminal 内容区(Swift 转发) → 同样子菜单
- 命令面板搜 "split" / "focus" → 各 4 条命中
- `Cmd+D` 拆右、`Cmd+Shift+D` 拆下,terminal panel 拆完两个 Ghostty NSView 都活
- `Ctrl+Shift+→` 从左 terminal 切到右 welcome → 键盘焦点跟过去(welcome 输入框能打字)
- `Ctrl+Shift+→` 从左 terminal 切到右 terminal → Ghostty firstResponder swap 后键盘进入新 terminal
- 单 panel / 单 group 时菜单 Focus 子菜单条目灰,按快捷键 no-op
- 命令面板执行 split 后,下次打开命令面板看到 split 排前(MRU 生效)
- 命令面板执行 focus 后,下次打开命令面板**不**看到 focus 排前(excludeFromMru 生效)

## 回归风险

| 风险 | 缓解 |
|---|---|
| `splitRight/Down` 加 `command-palette` surface 后命令面板列表行为变化 | 命令面板已按 category + frecency 分组,新加两条只是多两行,不破坏排序 |
| `ActionMetadata` 加 submenu 字段影响其它消费者 | 已检查 [command-palette.tsx](../../src/renderer/components/common/command-palette.tsx) 只读 iconComponent / keywords / excludeFromMru。其它 metadata 消费点实施时 grep 兜底 |
| `buildMenuEntries` 算法改动后现有 close 系列菜单乱 | 单测的"没有 submenu 字段的 action 平铺"测例就是为防回归。实施后手动跑现有 close/closeOthers/closeAll 兜底 |
| dockview 私有 `group.element` API 在版本升级被改 | `getGroupElement` 用 instanceof HTMLElement 守卫,无 element 时静默 no-op;升级 dockview 时跑 manual focus 验证 |
| `Ctrl+Shift+ArrowUp` DSL 不支持 | `default-keymap.test.ts` 扩展用例先红,实施时立即发现,扩 DSL 或走降级方案 `Mod+Alt+方向键` |

## 实施粒度

按 7 个独立可 commit 步骤拆解,留给 writing-plans 决定 PR 切分:

1. **菜单元数据扩展** — `ActionMetadata.submenu` 字段 + `buildMenuEntries` 聚合 + 子菜单单测。到此现有菜单行为零变化(还没 action 用新字段)
2. **`splitPanel` 扩四向** — workspace.store direction union 扩 + 不动现有调用
3. **`pickFocusTarget` 纯函数 + 单测** — 几何算法落地,纯算法、零依赖
4. **`focusGroup` store action** — 接 dockview api + 调 `pickFocusTarget` + wrapper 单测
5. **8 个 action 注册 + i18n key** — panel-actions.ts 4 个新加 + 2 个改 surfaces/submenu + 4 个 focus;不绑快捷键
6. **DSL 扩展 + 6 条默认快捷键** — 分两子步:
   - **6a. 扩 DSL** — KeyChord 加 ctrl 字段 + parse.ts 平台感知 + matcher/use-keybindings/registry/toElectronAccelerator 同步 + 单测
   - **6b. 6 条 default binding** — defaults.ts 加 + default-keymap 单测扩
7. **手动 e2e 验证 + 修 bug** — 跑手动验证清单,记 issue

每步独立可 commit。步骤 1-2 可合一 PR;3-7 可一 PR 完整 focus 功能。

## 已知未解决问题

- **TOL_PX 与 pierTheme.gap 同步**:首版硬编码 `5` + 显式 comment;后续 theme 抽公共模块时一并搬。
- **floating panel 处理**:当前 Pier 无 floating UX,实施时验证 `g.floating === true` 字段在 dockview 类型上是否存在。第一版直接跳过 floating group。

## 未来工作(明确不在本次范围)

- focus 的 wrap-around(右边到尽头继续按 → 跳到最左)
- tab strip 内单 group 多 tab 时的方向键语义(本设计永远切 group,不切 tab)
- `View →` / `Window →` 其它子菜单(本次只引入子菜单基建,不预先填充其它分类)
- floating panel 的 split / focus 行为
- 用户自定义 keymap UI(本设计只动 defaults.ts)
