# 拆分与聚焦菜单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Pier 的 dockview panel 加 4 向拆分(splitLeft/Right/Up/Down)和 4 向聚焦方向导航(focusLeft/Right/Up/Down),并在右键菜单(tab + terminal 内容区)、命令面板、默认快捷键三个入口同步出现。

**Architecture:** 走 dockview activeGroup 单源 + 现有 onDidActivePanelChange sink 链路,不引入新状态源。菜单用 `Split →` / `Focus →` 子菜单聚合(经 `ActionMetadata.submenu` 字段)。focus 快捷键 `Ctrl+Shift+方向键` 需先扩 keybinding DSL 加 `ctrl` 字段。

**Tech Stack:** TypeScript / React / Zustand / dockview-react / Electron Menu / i18next / Vitest

**Spec:** [2026-06-23-context-menu-split-focus-design.md](../specs/2026-06-23-context-menu-split-focus-design.md)

---

## 文件结构总览

实施过程会改 / 新建以下文件:

| 文件 | 操作 | 任务 |
|---|---|---|
| `src/renderer/lib/actions/types.ts` | 改 | T1 |
| `src/renderer/lib/context-menu/build-entries.ts` | 改 | T2, T7 |
| `tests/unit/menu-build-entries-submenu.test.ts` | 新 | T2 |
| `src/renderer/stores/workspace.store.ts` | 改 | T3, T5 |
| `src/renderer/lib/workspace/focus-target.ts` | 新 | T4 |
| `tests/unit/focus-target.test.ts` | 新 | T4 |
| `src/renderer/lib/actions/panel-actions.ts` | 改 | T6 |
| `src/renderer/i18n/locales/en.ts` | 改 | T6 |
| `src/renderer/lib/keybindings/types.ts` | 改 | T7 |
| `src/renderer/lib/keybindings/parse.ts` | 改 | T7 |
| `src/renderer/lib/keybindings/matcher.ts` | 改 | T7 |
| `src/renderer/lib/keybindings/use-keybindings.ts` | 改 | T7 |
| `src/renderer/lib/keybindings/registry.ts` | 改 | T7 |
| `tests/unit/keybindings.test.ts` | 改 | T7 |
| `src/renderer/lib/keybindings/defaults.ts` | 改 | T8 |
| `tests/unit/default-keymap.test.ts` | 改 | T8 |

---

## Task 1: `ActionMetadata` 加 `submenu` 字段

**Files:**
- Modify: `src/renderer/lib/actions/types.ts:7-24`

无新测试 — 此任务只扩类型,运行时无新行为(还没有 action 使用此字段)。下个 task 验证。

- [ ] **Step 1.1: 在 `ActionMetadata` 加 `submenu?: () => string` 字段**

打开 `src/renderer/lib/actions/types.ts`,在 interface 末尾加:

```typescript
export interface ActionMetadata {
  /** true = 执行后不计入命令面板 MRU。仅给 clearRecent 这类元命令用 */
  excludeFromMru?: boolean;
  /**
   * 菜单/命令面板内分段 key. 不同 group 之间渲染时自动插 separator;
   * 同 group 内按 sortOrder 升序. 字典序排列, 数字前缀控制大段顺序:
   *   - "navigation"   永远第一 (VSCode 保留)
   *   - "1_*" ~ "8_*"  中间段
   *   - "9_close"      关闭类
   *   - "9_other"      未指定时默认
   *   - "z_*"          永远末尾
   * 缺省视作 "9_other".
   */
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

- [ ] **Step 1.2: 跑 typecheck 确认零回归**

Run: `pnpm typecheck`
Expected: 无错误。无 action 使用新字段,纯类型扩。

- [ ] **Step 1.3: Commit**

```bash
git add src/renderer/lib/actions/types.ts
git commit -m "$(cat <<'EOF'
feat(actions): ActionMetadata 加 submenu 字段

submenu?: () => string. 同 surface 内 submenu() 返回相同字符串的
action 会聚合成同名子菜单. 命令面板忽略, 永远平铺. 本提交仅扩
类型, 下一步在 buildMenuEntries 落地聚合算法.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `buildMenuEntries` 子菜单聚合算法

**Files:**
- Modify: `src/renderer/lib/context-menu/build-entries.ts:79-127`
- Test: `tests/unit/menu-build-entries-submenu.test.ts`(新建)

TDD: 先写测试,跑红,再实现。

- [ ] **Step 2.1: 新建测试文件 `tests/unit/menu-build-entries-submenu.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

const SURFACE = "test/submenu";

const noop = () => {};

function mkAction(id: string, group: string, sortOrder: number, submenu?: string): Action {
  return {
    id,
    title: () => id,
    category: "Test",
    handler: noop,
    surfaces: [SURFACE],
    metadata: {
      group,
      sortOrder,
      ...(submenu !== undefined && { submenu: () => submenu }),
    },
  };
}

describe("buildMenuEntries — submenu 聚合", () => {
  const disposers: (() => void)[] = [];

  beforeEach(() => {
    disposers.length = 0;
  });

  afterEach(() => {
    for (const d of disposers) d();
  });

  function register(a: Action): void {
    disposers.push(actionRegistry.register(a));
  }

  it("没 submenu 字段的 action 平铺", () => {
    register(mkAction("a", "1_g", 1));
    register(mkAction("b", "1_g", 2));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      { type: "action", id: "a", label: "a", enabled: true },
      { type: "action", id: "b", label: "b", enabled: true },
    ]);
  });

  it("同 submenu key 聚合成一个 MenuItemSubmenu", () => {
    register(mkAction("split-r", "2_split", 1, "Split"));
    register(mkAction("split-d", "2_split", 2, "Split"));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      {
        type: "submenu",
        label: "Split",
        submenu: [
          { type: "action", id: "split-r", label: "split-r", enabled: true },
          { type: "action", id: "split-d", label: "split-d", enabled: true },
        ],
      },
    ]);
  });

  it("子菜单内按 sortOrder 排", () => {
    register(mkAction("split-u", "2_split", 4, "Split"));
    register(mkAction("split-r", "2_split", 1, "Split"));
    register(mkAction("split-l", "2_split", 3, "Split"));
    register(mkAction("split-d", "2_split", 2, "Split"));
    const items = buildMenuEntries(SURFACE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "submenu", label: "Split" });
    const submenuItems = (items[0] as { submenu: unknown[] }).submenu;
    expect(submenuItems.map((x: { id: string }) => x.id)).toEqual([
      "split-r",
      "split-d",
      "split-l",
      "split-u",
    ]);
  });

  it("子菜单位置 = 其内第一个 action 的位置", () => {
    // group "2_g" 内: a(sortOrder 1), 然后两个 submenu key=Sub(sortOrder 2,3),
    // 再 c(sortOrder 4). submenu 应该出现在 a 和 c 之间.
    register(mkAction("a", "2_g", 1));
    register(mkAction("sub-b", "2_g", 2, "Sub"));
    register(mkAction("sub-c", "2_g", 3, "Sub"));
    register(mkAction("d", "2_g", 4));
    const items = buildMenuEntries(SURFACE);
    expect(items.map((x) => ("id" in x ? x.id : x.type === "submenu" ? `sub:${x.label}` : x.type))).toEqual([
      "a",
      "sub:Sub",
      "d",
    ]);
  });

  it("不同 group 的 submenu key 相同时仍聚成两个独立子菜单", () => {
    // group 不同 = 不同桶, 不跨桶聚合
    register(mkAction("a", "1_g", 1, "S"));
    register(mkAction("b", "2_g", 1, "S"));
    const items = buildMenuEntries(SURFACE);
    // 两个独立 submenu + 一个 separator
    expect(items.filter((x) => x.type === "submenu")).toHaveLength(2);
    expect(items.filter((x) => x.type === "separator")).toHaveLength(1);
  });

  it("同 group 混合 submenu / 非 submenu 的输出顺序符合预期", () => {
    register(mkAction("a", "2_g", 1));
    register(mkAction("sub-b", "2_g", 2, "Sub"));
    register(mkAction("c", "2_g", 3));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      { type: "action", id: "a", label: "a", enabled: true },
      {
        type: "submenu",
        label: "Sub",
        submenu: [{ type: "action", id: "sub-b", label: "sub-b", enabled: true }],
      },
      { type: "action", id: "c", label: "c", enabled: true },
    ]);
  });
});
```

- [ ] **Step 2.2: 跑测试看红**

Run: `pnpm vitest run tests/unit/menu-build-entries-submenu.test.ts`
Expected: 至少前 2 个测试红 — 现 `buildMenuEntries` 不处理 submenu 字段,会把所有 action 平铺。

- [ ] **Step 2.3: 抽 `actionToMenuItem` 私有 helper**

打开 `src/renderer/lib/context-menu/build-entries.ts`。在 `buildMenuEntries` 之前抽出 helper(把现有第 110-122 行的 build action MenuItem 逻辑提取):

```typescript
function actionToMenuItem(a: Action): MenuItem {
  const binding = keybindingRegistry.getBindingsFor(a.id)[0];
  const accelerator = binding
    ? toElectronAccelerator(binding.chord)
    : undefined;
  const enabled = a.enabled?.() ?? true;
  return {
    type: "action",
    id: a.id,
    label: a.title(),
    enabled,
    ...(accelerator !== undefined && { accelerator }),
  };
}
```

- [ ] **Step 2.4: 加聚合算法到 `buildMenuEntries`**

替换 `buildMenuEntries` 内"for of bucket"循环(原 build-entries.ts:110-123)为下面的两次扫描:

```typescript
  const items: MenuItem[] = [];
  for (const [idx, g] of sortedGroups.entries()) {
    if (idx > 0) {
      items.push({ type: "separator" });
    }
    const bucket = buckets.get(g) ?? [];
    bucket.sort((a, b) => {
      const so = sortOrderOf(a) - sortOrderOf(b);
      if (so !== 0) {
        return so;
      }
      return a.title().localeCompare(b.title());
    });

    // 子菜单聚合: 同 submenu() key 合并; 没 submenu 字段平铺.
    // 子菜单位置 = 该 key 第一个 action 在桶里的相对位置.
    const placeholders: (
      | { kind: "action"; a: Action }
      | { kind: "submenu"; key: string }
    )[] = [];
    const submenuMap = new Map<string, Action[]>();
    for (const a of bucket) {
      const key = a.metadata?.submenu?.();
      if (key) {
        let group = submenuMap.get(key);
        if (!group) {
          group = [];
          submenuMap.set(key, group);
          placeholders.push({ kind: "submenu", key });
        }
        group.push(a);
      } else {
        placeholders.push({ kind: "action", a });
      }
    }
    for (const p of placeholders) {
      if (p.kind === "action") {
        items.push(actionToMenuItem(p.a));
      } else {
        // submenuMap.get(p.key) 此时一定非空 (placeholder push 时已确保).
        const subActions = submenuMap.get(p.key) ?? [];
        items.push({
          type: "submenu",
          label: p.key,
          submenu: subActions.map(actionToMenuItem),
        });
      }
    }
  }
  return items;
```

- [ ] **Step 2.5: 跑测试看绿**

Run: `pnpm vitest run tests/unit/menu-build-entries-submenu.test.ts`
Expected: 全 6 个测试绿。

- [ ] **Step 2.6: 跑现有 menu / context-menu 相关单测确认零回归**

Run: `pnpm vitest run tests/unit/`
Expected: 全绿。

- [ ] **Step 2.7: 跑 typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```
Expected: 全绿。

- [ ] **Step 2.8: Commit**

```bash
git add src/renderer/lib/context-menu/build-entries.ts tests/unit/menu-build-entries-submenu.test.ts
git commit -m "$(cat <<'EOF'
feat(menu): buildMenuEntries 支持 ActionMetadata.submenu 聚合

同 group 内 submenu() 返回相同字符串的 action 合并成 MenuItemSubmenu,
内部按 sortOrder 排. 子菜单本身在父菜单的位置 = 其内第一个 action
的相对位置. 抽 actionToMenuItem helper 复用 accelerator/enabled 求值.

新单测 menu-build-entries-submenu 覆盖: 平铺/聚合/sortOrder 排序/
子菜单位置/跨 group 不聚合/混合 submenu 与非 submenu.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `splitPanel` direction union 扩四向

**Files:**
- Modify: `src/renderer/stores/workspace.store.ts:16`

纯类型放宽 — `api.addPanel({ position: { direction } })` 在 dockview 类型上本来支持 `"left" | "right" | "above" | "below" | "within"`,只是 Pier 的 store 接口窄化了。

- [ ] **Step 3.1: 改 `WorkspaceStore` 接口 direction union**

打开 `src/renderer/stores/workspace.store.ts:16`,改:

```typescript
// before
splitPanel: (panelId: string, direction: "right" | "below") => void;
// after
splitPanel: (panelId: string, direction: "right" | "below" | "left" | "above") => void;
```

实现 (workspace.store.ts:165-185 的 splitPanel 函数体) 无需改动 — 透传 direction 到 `api.addPanel({ position: { direction } })` 已经接受这四个值。

- [ ] **Step 3.2: 跑 typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 3.3: Commit**

```bash
git add src/renderer/stores/workspace.store.ts
git commit -m "$(cat <<'EOF'
refactor(workspace): splitPanel direction union 扩四向

direction 从 "right" | "below" 放宽到 "right" | "below" | "left" |
"above". 函数体不动 — dockview addPanel 的 position.direction 字段
本来就支持这四个值. 后续 splitLeft/splitUp action 调用此 store 方法.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `pickFocusTarget` 纯函数 + 单测

**Files:**
- Create: `src/renderer/lib/workspace/focus-target.ts`
- Test: `tests/unit/focus-target.test.ts`(新建)

`pickFocusTarget` 是几何挑邻居的纯函数,不依赖 dockview。把它从 store 切出能 100% 单测覆盖。

- [ ] **Step 4.1: 新建空 `src/renderer/lib/workspace/focus-target.ts`(stub 返回 null)**

(需要先创建目录 `src/renderer/lib/workspace/`)

```typescript
/**
 * 几何挑选 focus 目标 — 在指定方向上挑出与 active group 最近的邻居.
 *
 * 算法 (照搬 loomdesk workspace-host.svelte.ts:3227-3280):
 *   - inDir: 候选 rect 必须在 active 指定方向"足够远" (容忍 tolPx 像素 gap)
 *   - overlap: 方向垂直轴上的投影重叠长度 (横向 focus 看 y 重叠, 纵向看 x)
 *   - dist: 中心距离, 重叠平分时作 tie-breaker
 *
 * 返回 candidates 数组里的 index, 或 null (无候选). isActive 的候选跳过.
 */
export interface GroupCandidate {
  id: string;
  isActive: boolean;
  rect: DOMRect | null;
}

export function pickFocusTarget(
  _activeRect: DOMRect,
  _candidates: readonly GroupCandidate[],
  _direction: "right" | "down" | "left" | "up",
  _tolPx: number
): number | null {
  return null;
}
```

- [ ] **Step 4.2: 新建测试文件 `tests/unit/focus-target.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import {
  type GroupCandidate,
  pickFocusTarget,
} from "@/lib/workspace/focus-target.ts";

function rect(x: number, y: number, w: number, h: number): DOMRect {
  // DOMRect 在 node 环境不存在, 用 plain object 满足结构.
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => "",
  } as DOMRect;
}

function mkCand(id: string, r: DOMRect, isActive = false): GroupCandidate {
  return { id, isActive, rect: r };
}

const TOL = 5;

describe("pickFocusTarget", () => {
  // 布局: 左 (0,0,100,100), 右 (105,0,100,100). gap=5.
  const left = rect(0, 0, 100, 100);
  const right = rect(105, 0, 100, 100);

  it("右邻命中", () => {
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("左邻命中", () => {
    const idx = pickFocusTarget(
      right,
      [mkCand("L", left), mkCand("R", right, true)],
      "left",
      TOL
    );
    expect(idx).toBe(0);
  });

  it("下邻命中", () => {
    const top = rect(0, 0, 100, 100);
    const bottom = rect(0, 105, 100, 100);
    const idx = pickFocusTarget(
      top,
      [mkCand("T", top, true), mkCand("B", bottom)],
      "down",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("上邻命中", () => {
    const top = rect(0, 0, 100, 100);
    const bottom = rect(0, 105, 100, 100);
    const idx = pickFocusTarget(
      bottom,
      [mkCand("T", top), mkCand("B", bottom, true)],
      "up",
      TOL
    );
    expect(idx).toBe(0);
  });

  it("方向上无邻居返回 null", () => {
    // active = left, 候选只有 active 自己 → 没有右邻
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true)],
      "right",
      TOL
    );
    expect(idx).toBe(null);
  });

  it("isActive 候选跳过", () => {
    // active 在 left, candidates 含 active 自己 — pickFocusTarget 必须跳过 isActive
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("rect == null 的候选跳过", () => {
    const idx = pickFocusTarget(
      left,
      [
        mkCand("L", left, true),
        { id: "ghost", isActive: false, rect: null },
        mkCand("R", right),
      ],
      "right",
      TOL
    );
    expect(idx).toBe(2);
  });

  it("重叠平分时取中心更近", () => {
    // 两个右邻, 都与 active 完全重叠 y 范围, 但中心 y 不同.
    // active 中心 y = 50; A 中心 y = 50 (近), B 中心 y = 30 (远).
    const a = rect(105, 0, 100, 100); // y center 50
    const b = rect(105, 0, 100, 60); // y center 30
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("A", a), mkCand("B", b)],
      "right",
      TOL
    );
    expect(idx).toBe(1); // A 更近
  });

  it("重叠不同时取重叠更大", () => {
    // A 在右且完全 y 覆盖 active (100% 重叠)
    // B 在右但 y 只覆盖一半 (50% 重叠)
    const a = rect(105, 0, 100, 100);
    const b = rect(105, 0, 100, 50);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("A", a), mkCand("B", b)],
      "right",
      TOL
    );
    expect(idx).toBe(1); // A 重叠更大
  });

  it("容忍 gap 像素 — tol 内的偏差仍算在方向上", () => {
    // 右邻 left = 99 (比 active.right=100 还小 1px), 但 tol=5 容忍, 仍判右
    const right_overlap = rect(99, 0, 100, 100);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right_overlap)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("候选不足 (只有 active) 返回 null", () => {
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true)],
      "right",
      TOL
    );
    expect(idx).toBe(null);
  });
});
```

- [ ] **Step 4.3: 跑测试看红**

Run: `pnpm vitest run tests/unit/focus-target.test.ts`
Expected: 多数测试红(stub 总是返回 null,只有"无邻居返回 null"和"候选不足"两个用例蒙绿)。

- [ ] **Step 4.4: 实现 `pickFocusTarget`**

替换 `src/renderer/lib/workspace/focus-target.ts` 的 stub:

```typescript
/**
 * 几何挑选 focus 目标 — 在指定方向上挑出与 active group 最近的邻居.
 *
 * 算法 (照搬 loomdesk workspace-host.svelte.ts:3227-3280):
 *   - inDir: 候选 rect 必须在 active 指定方向"足够远" (容忍 tolPx 像素 gap)
 *   - overlap: 方向垂直轴上的投影重叠长度 (横向 focus 看 y 重叠, 纵向看 x)
 *   - dist: 中心距离, 重叠平分时作 tie-breaker
 *
 * 返回 candidates 数组里的 index, 或 null (无候选). isActive 的候选跳过.
 */
export interface GroupCandidate {
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
  let bestDist = Number.POSITIVE_INFINITY;
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
      ? Math.max(
          0,
          Math.min(activeRect.right, r.right) - Math.max(activeRect.left, r.left)
        )
      : Math.max(
          0,
          Math.min(activeRect.bottom, r.bottom) - Math.max(activeRect.top, r.top)
        );
    const dist = isVert
      ? Math.abs(
          (r.top + r.height / 2) - (activeRect.top + activeRect.height / 2)
        )
      : Math.abs(
          (r.left + r.width / 2) - (activeRect.left + activeRect.width / 2)
        );

    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && dist < bestDist)
    ) {
      bestOverlap = overlap;
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
```

- [ ] **Step 4.5: 跑测试看绿**

Run: `pnpm vitest run tests/unit/focus-target.test.ts`
Expected: 全 11 个测试绿。

- [ ] **Step 4.6: 跑 typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```
Expected: 全绿。

- [ ] **Step 4.7: Commit**

```bash
git add src/renderer/lib/workspace/focus-target.ts tests/unit/focus-target.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): pickFocusTarget 纯函数 (focus 方向导航算法)

在指定方向上挑选与 active group 最近的邻居 group. 算法照搬 loomdesk
workspace-host.svelte.ts:3227-3280: inDir + overlap + dist tie-break.

纯函数, 不依赖 dockview, 11 个单测覆盖四向 / isActive 跳过 / rect=null
跳过 / overlap 平分 / 重叠取大 / 容忍 gap / 候选不足.

下一步 focusGroup workspace store action 调此函数 + 调
dockview activePanel.setActive() 写回单源.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `focusGroup` workspace store action

**Files:**
- Modify: `src/renderer/stores/workspace.store.ts`(接口 + 实现)

挂 `focusGroup` 到 dockview api,内部调 `pickFocusTarget`,挑出目标后 `targetPanel.api.setActive()`。这是**唯一一次写回单源**,后续 sink 联动由现有 onDidActivePanelChange 回调自动触发。

- [ ] **Step 5.1: 加 `focusGroup` 到 `WorkspaceStore` interface**

打开 `src/renderer/stores/workspace.store.ts`,在 interface 顶部加(splitPanel 字段附近):

```typescript
interface WorkspaceStore {
  // ... 现有字段 ...
  splitPanel: (panelId: string, direction: "right" | "below" | "left" | "above") => void;
  focusGroup: (direction: "right" | "down" | "left" | "up") => void;
  // ... 其它 ...
}
```

- [ ] **Step 5.2: 加 import**

文件顶部加 import:

```typescript
import { pickFocusTarget } from "@/lib/workspace/focus-target.ts";
```

- [ ] **Step 5.3: 加 `getGroupElement` helper(模块顶层私有)**

放在 import 之后、`create<WorkspaceStore>` 之前:

```typescript
/**
 * 拿 dockview group 的 HTMLElement. dockview 没把 group.element 列入 public API,
 * cast + instanceof 守卫: 升级 dockview 若改 group 类型, focus 安全降级为 no-op
 * 而非 crash.
 */
function getGroupElement(g: unknown): HTMLElement | null {
  const el = (g as { element?: HTMLElement } | null)?.element;
  return el instanceof HTMLElement ? el : null;
}

/**
 * = pierTheme.gap (4) + 1. 改 gap 必须同步此常量.
 * 容忍像素让相邻 group 的边界比较不被 gap 卡掉.
 */
const FOCUS_TOL_PX = 5;
```

- [ ] **Step 5.4: 加 `focusGroup` 实现**

在 `create<WorkspaceStore>((set, get) => ({...}))` 内,挨着 `splitPanel` 实现加:

```typescript
  focusGroup: (direction) => {
    const api = get().api;
    if (!api) return;
    const active = api.activeGroup;
    if (!active) return;
    if (api.groups.length < 2) return;

    const activeEl = getGroupElement(active);
    if (!activeEl) return;
    const activeRect = activeEl.getBoundingClientRect();

    const candidates = api.groups.map((g) => ({
      id: g.id,
      isActive: g.id === active.id,
      rect: getGroupElement(g)?.getBoundingClientRect() ?? null,
    }));
    const targetIdx = pickFocusTarget(activeRect, candidates, direction, FOCUS_TOL_PX);
    if (targetIdx == null) return;

    const targetGroup = api.groups[targetIdx];
    if (!targetGroup) return;
    const targetPanel = targetGroup.activePanel ?? targetGroup.panels[0];
    if (!targetPanel) return;

    // 写回 dockview 单源 — onDidActivePanelChange 回调会自动联动
    // DescriptorStore / KeybindingScope / Swift firstResponder.
    const panel = api.panels.find((p) => p.id === targetPanel.id);
    panel?.api.setActive();
  },
```

- [ ] **Step 5.5: 跑 typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 5.6: 跑全部现有单测确保零回归**

Run: `pnpm vitest run tests/unit/`
Expected: 全绿。

- [ ] **Step 5.7: 跑 lint**

Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 5.8: Commit**

```bash
git add src/renderer/stores/workspace.store.ts
git commit -m "$(cat <<'EOF'
feat(workspace): focusGroup store action (4 向 focus 方向导航)

读 api.activeGroup 起点, 几何挑邻居 (pickFocusTarget), targetPanel.
api.setActive() 写回 dockview 单源. DescriptorStore / KeybindingScope /
Swift firstResponder 三个 sink 由现有 onDidActivePanelChange 回调
自动联动, focusGroup 不直接写任何 sink.

getGroupElement helper 用 instanceof HTMLElement 守卫 dockview group.
element 私有 API. FOCUS_TOL_PX=5 与 pierTheme.gap=4 + 1 同步.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 注册 8 个 action + i18n + 现有 splitRight/Down 改 surfaces

**Files:**
- Modify: `src/renderer/lib/actions/panel-actions.ts:128-162`(现 splitRight/Down 改 surfaces + submenu;+ 6 个新 action)
- Modify: `src/renderer/i18n/locales/en.ts`(+ 8 个 key)

注意 lucide-react 图标 import:`PanelRight`, `PanelBottom`, `PanelLeft`, `PanelTop`, `ArrowRight`, `ArrowDown`, `ArrowLeft`, `ArrowUp`。

- [ ] **Step 6.1: en.ts 加 8 个 i18n key**

打开 `src/renderer/i18n/locales/en.ts`,在 `contextMenu.action.*` 已有 key 附近加:

```typescript
// 子菜单 label
"contextMenu.submenu.split": "Split",
"contextMenu.submenu.focus": "Focus",
// split 4 向 (现有 splitRight/splitDown 保留, 此处加缺的两向)
"contextMenu.action.splitLeft": "Split Left",
"contextMenu.action.splitUp": "Split Up",
// focus 4 向 (全部新增)
"contextMenu.action.focusRight": "Focus Right",
"contextMenu.action.focusDown": "Focus Down",
"contextMenu.action.focusLeft": "Focus Left",
"contextMenu.action.focusUp": "Focus Up",
```

如果项目有其它 locale 文件(如 `zh.ts`),同步加对应中文 key。

- [ ] **Step 6.2: panel-actions.ts 改 splitRight 加 surfaces 和 submenu**

打开 `src/renderer/lib/actions/panel-actions.ts`,找到现 splitRight 注册块(约 128-144 行),改:

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "right");
        }
      },
      id: "pier.panel.splitRight",
      metadata: {
        group: "2_split",
        sortOrder: 1,
        iconComponent: PanelRight,
        submenu: () => i18next.t("contextMenu.submenu.split"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.splitRight"),
    })
  );
```

(改动 = 加 iconComponent、加 submenu、surfaces 扩到 3 个)

- [ ] **Step 6.3: panel-actions.ts 改 splitDown 同样补全**

找到 splitDown 注册块(约 146-162 行),改:

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "below");
        }
      },
      id: "pier.panel.splitDown",
      metadata: {
        group: "2_split",
        sortOrder: 2,
        iconComponent: PanelBottom,
        submenu: () => i18next.t("contextMenu.submenu.split"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.splitDown"),
    })
  );
```

- [ ] **Step 6.4: 注册 splitLeft**

在 splitDown 之后加:

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "left");
        }
      },
      id: "pier.panel.splitLeft",
      metadata: {
        group: "2_split",
        sortOrder: 3,
        iconComponent: PanelLeft,
        submenu: () => i18next.t("contextMenu.submenu.split"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.splitLeft"),
    })
  );
```

- [ ] **Step 6.5: 注册 splitUp**

在 splitLeft 之后加:

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "above");
        }
      },
      id: "pier.panel.splitUp",
      metadata: {
        group: "2_split",
        sortOrder: 4,
        iconComponent: PanelTop,
        submenu: () => i18next.t("contextMenu.submenu.split"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.splitUp"),
    })
  );
```

- [ ] **Step 6.6: 注册 focusRight (含 `excludeFromMru: true`)**

在 splitUp 之后加。注意 enabled 用 `groups.length > 1`,不用 activePanel:

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => (useWorkspaceStore.getState().api?.groups?.length ?? 0) > 1,
      handler: () => useWorkspaceStore.getState().focusGroup("right"),
      id: "pier.panel.focusRight",
      metadata: {
        group: "3_focus",
        sortOrder: 1,
        iconComponent: ArrowRight,
        excludeFromMru: true,
        submenu: () => i18next.t("contextMenu.submenu.focus"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.focusRight"),
    })
  );
```

- [ ] **Step 6.7: 注册 focusDown**

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => (useWorkspaceStore.getState().api?.groups?.length ?? 0) > 1,
      handler: () => useWorkspaceStore.getState().focusGroup("down"),
      id: "pier.panel.focusDown",
      metadata: {
        group: "3_focus",
        sortOrder: 2,
        iconComponent: ArrowDown,
        excludeFromMru: true,
        submenu: () => i18next.t("contextMenu.submenu.focus"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.focusDown"),
    })
  );
```

- [ ] **Step 6.8: 注册 focusLeft**

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => (useWorkspaceStore.getState().api?.groups?.length ?? 0) > 1,
      handler: () => useWorkspaceStore.getState().focusGroup("left"),
      id: "pier.panel.focusLeft",
      metadata: {
        group: "3_focus",
        sortOrder: 3,
        iconComponent: ArrowLeft,
        excludeFromMru: true,
        submenu: () => i18next.t("contextMenu.submenu.focus"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.focusLeft"),
    })
  );
```

- [ ] **Step 6.9: 注册 focusUp**

```typescript
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => (useWorkspaceStore.getState().api?.groups?.length ?? 0) > 1,
      handler: () => useWorkspaceStore.getState().focusGroup("up"),
      id: "pier.panel.focusUp",
      metadata: {
        group: "3_focus",
        sortOrder: 4,
        iconComponent: ArrowUp,
        excludeFromMru: true,
        submenu: () => i18next.t("contextMenu.submenu.focus"),
      },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.focusUp"),
    })
  );
```

- [ ] **Step 6.10: 同步顶部 import lucide 图标**

在 panel-actions.ts 顶部的 `import { ... } from "lucide-react"` 加新 icon:

```typescript
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  RotateCcw,
  // ... 其它 icon
} from "lucide-react";
```

(具体 import 列表保持仓库现有排序约定)

- [ ] **Step 6.11: 跑 typecheck**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 6.12: 跑 lint**

Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 6.13: 跑全部单测**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 6.14: Commit**

```bash
git add src/renderer/lib/actions/panel-actions.ts src/renderer/i18n/locales/en.ts
git commit -m "$(cat <<'EOF'
feat(panel): 注册 4 向 split + 4 向 focus action (含子菜单聚合)

新增 6 个 action:
- pier.panel.splitLeft / splitUp (补齐现 splitRight/splitDown 的 4 向)
- pier.panel.focusRight / focusDown / focusLeft / focusUp

现 splitRight/splitDown 同步扩 surfaces 到 ["dockview-tab",
"terminal/content", "command-palette"], 加 submenu 字段聚合到
Split → 子菜单. focus 系列同 submenu 聚合到 Focus →, 全部带
excludeFromMru: true 避免方向键高频操作顶满命令面板 MRU.

enabled 区分: split 用 activePanel != null, focus 用
groups.length > 1 (至少有一个邻居才能方向导航).

i18n key 加 contextMenu.submenu.{split,focus} +
contextMenu.action.{splitLeft,splitUp,focusRight,focusDown,
focusLeft,focusUp}.

快捷键暂未绑定 — 待 DSL 扩 ctrl 字段后, defaults.ts 单独提交.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 扩 keybinding DSL 加 `ctrl` 字段

**Files:**
- Modify: `src/renderer/lib/keybindings/types.ts`(KeyChord 加 ctrl)
- Modify: `src/renderer/lib/keybindings/parse.ts`(加 Ctrl+ 前缀,parseChord 加 isMac 参数)
- Modify: `src/renderer/lib/keybindings/matcher.ts`(chordFromEvent + chordEquals 加 ctrl)
- Modify: `src/renderer/lib/keybindings/use-keybindings.ts`(chordFromNativeForward 加 ctrl)
- Modify: `src/renderer/lib/keybindings/registry.ts`(调 parseChord 处传 isMac())
- Modify: `src/renderer/lib/context-menu/build-entries.ts`(toElectronAccelerator 加 ctrl → "Control")
- Modify: `tests/unit/keybindings.test.ts`

整个 DSL 扩展作一次性 commit — 各处改动小,但相互依赖(types 改了后 matcher 必须跟,否则 typecheck 红)。

- [ ] **Step 7.1: 改 KeyChord 加 `ctrl` 字段**

打开 `src/renderer/lib/keybindings/types.ts`,改 KeyChord interface:

```typescript
export interface KeyChord {
  readonly alt: boolean;
  /** "Mod" — mac 上等价 metaKey, 其他平台等价 ctrlKey. */
  readonly cmdOrCtrl: boolean;
  /**
   * 独立 Ctrl 物理键. mac 上独立于 Cmd; 非 mac 上无意义 (永远 false, 因为
   * Mod 和 Ctrl 在非 mac 上是同一物理键). 用于表达 mac 上 "Ctrl+Shift+方向键"
   * 这种与 Cmd 区分的 binding.
   */
  readonly ctrl: boolean;
  /** KeyboardEvent.code 值: "KeyP" / "Digit1" / "ArrowUp" / "Escape" 等. */
  readonly code: string;
  readonly shift: boolean;
}
```

- [ ] **Step 7.2: 跑 typecheck 看红**

Run: `pnpm typecheck`
Expected: 多处红 — matcher.ts chordFromEvent / chordEquals 返回 KeyChord 时缺 ctrl 字段。

- [ ] **Step 7.3: 改 `chordFromEvent` 加 ctrl**

打开 `src/renderer/lib/keybindings/matcher.ts`,改:

```typescript
export function chordFromEvent(e: KeyboardEvent): KeyChord {
  return {
    cmdOrCtrl: IS_MAC ? e.metaKey : e.ctrlKey,
    // mac 上 Ctrl 物理键独立; 非 mac 上 Ctrl == Mod, 此字段永远 false (避免与
    // cmdOrCtrl 重复表达).
    ctrl: IS_MAC ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    code: e.code,
  };
}
```

- [ ] **Step 7.4: 改 `chordEquals` 加 ctrl 比较**

同文件 `matcher.ts`,改:

```typescript
export function chordEquals(a: KeyChord, b: KeyChord): boolean {
  return (
    a.cmdOrCtrl === b.cmdOrCtrl &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.code === b.code
  );
}
```

- [ ] **Step 7.5: 改 `chordFromNativeForward` 加 ctrl**

打开 `src/renderer/lib/keybindings/use-keybindings.ts:124-136`,替换 `chordFromNativeForward` 整个函数体:

```typescript
function chordFromNativeForward(
  modifierFlags: number,
  chars: string
): KeyChord {
  const hasCmd = hasFlag(modifierFlags, NS_FLAG_COMMAND);
  const hasCtrl = hasFlag(modifierFlags, NS_FLAG_CONTROL);
  // 路径 2 仅在 mac 上跑 (NS_FLAG_* 是 mac 概念). mac 上 Mod = Cmd, ctrl 字段
  // 独立表达 Ctrl 物理键. 同时按 Cmd+Ctrl 时 ctrl 仍真; chordEquals 严格匹配
  // 决定 resolve 结果.
  return {
    cmdOrCtrl: hasCmd,
    ctrl: hasCtrl,
    alt: hasFlag(modifierFlags, NS_FLAG_OPTION),
    shift: hasFlag(modifierFlags, NS_FLAG_SHIFT),
    code: charsToCode(chars),
  };
}
```

**注意行为变化**: 原实现 `cmdOrCtrl: hasCmd || hasCtrl`,这意味着 mac 上单按 Ctrl 触发的转发会被当 cmdOrCtrl 路径处理。新实现 `cmdOrCtrl: hasCmd` 让 Ctrl 完全归入 ctrl 字段。这是必要修正,以让 `Mod+KeyW`(cmdOrCtrl=true) 和 `Ctrl+KeyW`(mac 上 ctrl=true) 是两个**不同**的 binding。

- [ ] **Step 7.6: 改 `parse.ts` 加 `Ctrl+` 前缀 + isMac 参数**

打开 `src/renderer/lib/keybindings/parse.ts`,改:

```typescript
/**
 * DSL 解析: "Mod+Shift+KeyP" / "Ctrl+Shift+ArrowUp" → KeyChord.
 *
 * 修饰符 token 接受: Mod / Ctrl / Alt / Shift.
 * - Mod: 平台主修饰键 (mac=Cmd, 非 mac=Ctrl). cmdOrCtrl=true, ctrl=false.
 * - Ctrl:
 *   - mac 上 → 独立 Ctrl 物理键 (cmdOrCtrl=false, ctrl=true).
 *   - 非 mac 上 → 等价 Mod (cmdOrCtrl=true, ctrl=false), 因为非 mac 上
 *     Ctrl 就是 Mod 物理键, 不区分.
 *
 * key 主体直接是 KeyboardEvent.code 字面量 ("KeyP" / "Digit1" / "Escape" / ...).
 */
import type { KeyChord } from "./types.ts";

export interface ParsedCommandId {
  readonly commandId: string;
  /** true → 这是 "-cmd" 解绑标记, commandId 是去掉 "-" 之后的 id. */
  readonly unbind: boolean;
}

export function parseCommandId(raw: string): ParsedCommandId {
  if (raw.startsWith("-")) {
    return { unbind: true, commandId: raw.slice(1) };
  }
  return { unbind: false, commandId: raw };
}

const MOD_PREFIX = "Mod+";
const CTRL_PREFIX = "Ctrl+";
const ALT_PREFIX = "Alt+";
const SHIFT_PREFIX = "Shift+";

export function parseChord(keys: string, isMac = false): KeyChord {
  let cmdOrCtrl = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let rest = keys;
  let consumed = true;
  while (consumed) {
    consumed = false;
    if (rest.startsWith(MOD_PREFIX)) {
      if (cmdOrCtrl) {
        throw new Error(`Keybinding "${keys}" has duplicate "Mod"`);
      }
      cmdOrCtrl = true;
      rest = rest.slice(MOD_PREFIX.length);
      consumed = true;
    } else if (rest.startsWith(CTRL_PREFIX)) {
      if (ctrl || (cmdOrCtrl && !isMac)) {
        throw new Error(`Keybinding "${keys}" has duplicate "Ctrl"/"Mod"`);
      }
      if (isMac) {
        ctrl = true;
      } else {
        cmdOrCtrl = true;
      }
      rest = rest.slice(CTRL_PREFIX.length);
      consumed = true;
    } else if (rest.startsWith(ALT_PREFIX)) {
      if (alt) {
        throw new Error(`Keybinding "${keys}" has duplicate "Alt"`);
      }
      alt = true;
      rest = rest.slice(ALT_PREFIX.length);
      consumed = true;
    } else if (rest.startsWith(SHIFT_PREFIX)) {
      if (shift) {
        throw new Error(`Keybinding "${keys}" has duplicate "Shift"`);
      }
      shift = true;
      rest = rest.slice(SHIFT_PREFIX.length);
      consumed = true;
    }
  }
  const code = rest.trim();
  if (!code) {
    throw new Error(`Keybinding "${keys}" has no key code`);
  }
  return { cmdOrCtrl, ctrl, alt, shift, code };
}
```

- [ ] **Step 7.7: 改 `registry.ts:116` 调 parseChord 处传 isMac()**

打开 `src/renderer/lib/keybindings/registry.ts:116`,改:

```typescript
// before
const chord = parseChord(input.keys);
// after
const chord = parseChord(input.keys, isMac());
```

同时在文件顶部 import 区(约第 13 行附近 `import { parseChord, parseCommandId } from "./parse.ts";` 之后)加:

```typescript
import { isMac } from "./matcher.ts";
```

- [ ] **Step 7.8: 改 `toElectronAccelerator` 加 ctrl → `"Control"`**

打开 `src/renderer/lib/context-menu/build-entries.ts`,改 `toElectronAccelerator`:

```typescript
export function toElectronAccelerator(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.cmdOrCtrl) {
    parts.push("CmdOrCtrl");
  }
  if (chord.ctrl) {
    // Electron accelerator 用 "Control" 字面表示独立 Ctrl (mac 上区分 Cmd/Ctrl).
    parts.push("Control");
  }
  if (chord.alt) {
    parts.push("Alt");
  }
  if (chord.shift) {
    parts.push("Shift");
  }
  let key: string;
  if (chord.code.startsWith("Key")) {
    key = chord.code.slice(3);
  } else if (chord.code.startsWith("Digit")) {
    key = chord.code.slice(5);
  } else {
    key = CODE_TO_ELECTRON[chord.code] ?? chord.code;
  }
  parts.push(key);
  return parts.join("+");
}
```

- [ ] **Step 7.9: 跑 typecheck 应绿**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 7.10: 跑现有 keybindings 单测看是否仍绿**

Run: `pnpm vitest run tests/unit/keybindings.test.ts tests/unit/default-keymap.test.ts`
Expected: 全绿(现有测试都用 `Mod+...` 写法,parseChord 默认 isMac=false 时 `Mod+...` 行为不变)。

如有红:检查是否调 `parseChord` 处传错 isMac 参数。

- [ ] **Step 7.11: 扩 `tests/unit/keybindings.test.ts` 加 ctrl 单测**

在 `describe("keybinding engine", () => {...})` 内加测试:

```typescript
  it("parses Ctrl+ on mac as ctrl=true / cmdOrCtrl=false", () => {
    const chord = parseChord("Ctrl+Shift+ArrowUp", true);
    expect(chord).toEqual({
      cmdOrCtrl: false,
      ctrl: true,
      alt: false,
      shift: true,
      code: "ArrowUp",
    });
  });

  it("parses Ctrl+ on non-mac as cmdOrCtrl=true / ctrl=false (Mod 等价)", () => {
    const chord = parseChord("Ctrl+Shift+ArrowUp", false);
    expect(chord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: "ArrowUp",
    });
  });

  it("rejects duplicate Ctrl/Mod prefix on non-mac", () => {
    expect(() => parseChord("Mod+Ctrl+KeyA", false)).toThrow(/duplicate/);
  });

  it("parses Mod+ unaffected by isMac (always cmdOrCtrl)", () => {
    const macChord = parseChord("Mod+KeyP", true);
    const linuxChord = parseChord("Mod+KeyP", false);
    expect(macChord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: "KeyP",
    });
    expect(linuxChord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: "KeyP",
    });
  });

  it("chordEquals distinguishes ctrl from cmdOrCtrl", () => {
    const a = { cmdOrCtrl: true, ctrl: false, alt: false, shift: false, code: "KeyW" };
    const b = { cmdOrCtrl: false, ctrl: true, alt: false, shift: false, code: "KeyW" };
    expect(chordEquals(a, b)).toBe(false);
  });
```

注意:现有 keybindings.test.ts 已 import `parseChord` 和 `chordEquals`。无需新 import。

- [ ] **Step 7.12: 跑测试看绿**

Run: `pnpm vitest run tests/unit/keybindings.test.ts`
Expected: 全绿(含新加的 5 个 ctrl 用例)。

- [ ] **Step 7.13: 跑全部单测**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 7.14: 跑 lint**

Run: `pnpm lint`
Expected: 全绿。

- [ ] **Step 7.15: Commit**

```bash
git add src/renderer/lib/keybindings/types.ts \
        src/renderer/lib/keybindings/parse.ts \
        src/renderer/lib/keybindings/matcher.ts \
        src/renderer/lib/keybindings/use-keybindings.ts \
        src/renderer/lib/keybindings/registry.ts \
        src/renderer/lib/context-menu/build-entries.ts \
        tests/unit/keybindings.test.ts
git commit -m "$(cat <<'EOF'
feat(keybindings): DSL 加 Ctrl+ 字面 + KeyChord 加 ctrl 字段

支持 "Ctrl+Shift+ArrowUp" 这种 mac 上独立 Ctrl 物理键 binding (与
Cmd/Mod 区分). 非 mac 上 Ctrl+ 等价 Mod+ (同一物理键, 自动归一化到
cmdOrCtrl=true).

KeyChord 加 readonly ctrl: boolean 字段; chordFromEvent/chordEquals/
chordFromNativeForward 全部同步; parseChord(keys, isMac) 接平台参数;
registry 调 parseChord 处传 isMac(); toElectronAccelerator 加
"Control" 输出.

下一步 defaults.ts 加 6 条 split/focus binding (3 条 Mod+, 4 条
Ctrl+Shift+ArrowXxx).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 6 条默认快捷键 + default-keymap 单测扩

**Files:**
- Modify: `src/renderer/lib/keybindings/defaults.ts:10-25`(+ 6 条)
- Modify: `tests/unit/default-keymap.test.ts`

TDD: 先扩单测断言 6 条新 binding,跑红,再加 binding。

- [ ] **Step 8.1: 扩 `default-keymap.test.ts` 加 6 条断言**

打开 `tests/unit/default-keymap.test.ts`,在 `describe("DEFAULT_KEYMAP", () => {...})` 内加新 `it`:

```typescript
  it("contains split / focus shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitRight",
      keys: "Mod+KeyD",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitDown",
      keys: "Mod+Shift+KeyD",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusUp",
      keys: "Ctrl+Shift+ArrowUp",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusDown",
      keys: "Ctrl+Shift+ArrowDown",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusLeft",
      keys: "Ctrl+Shift+ArrowLeft",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusRight",
      keys: "Ctrl+Shift+ArrowRight",
      scope: "global",
    });
  });
```

- [ ] **Step 8.2: 跑测试看红**

Run: `pnpm vitest run tests/unit/default-keymap.test.ts`
Expected: "contains split / focus shortcuts" 测试红 — 6 个 binding 还没加。

- [ ] **Step 8.3: 在 `defaults.ts` 加 6 条 binding**

打开 `src/renderer/lib/keybindings/defaults.ts`,在 `DEFAULT_KEYMAP` 数组末尾加(在 `pier.settings.open` 之后,数组关闭的 `]` 之前):

```typescript
  // Split — splitLeft / splitUp 不绑默认 (用户可自定义)
  { commandId: "pier.panel.splitRight", keys: "Mod+KeyD", scope: "global" },
  { commandId: "pier.panel.splitDown", keys: "Mod+Shift+KeyD", scope: "global" },
  // Focus — Ctrl+Shift+方向键 (mac 上 = 独立 Ctrl, 非 mac 上 = Mod 等价)
  {
    commandId: "pier.panel.focusUp",
    keys: "Ctrl+Shift+ArrowUp",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusDown",
    keys: "Ctrl+Shift+ArrowDown",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusLeft",
    keys: "Ctrl+Shift+ArrowLeft",
    scope: "global",
  },
  {
    commandId: "pier.panel.focusRight",
    keys: "Ctrl+Shift+ArrowRight",
    scope: "global",
  },
```

- [ ] **Step 8.4: 跑测试看绿**

Run: `pnpm vitest run tests/unit/default-keymap.test.ts`
Expected: 全绿。

- [ ] **Step 8.5: 跑全部单测**

Run: `pnpm vitest run`
Expected: 全绿。

- [ ] **Step 8.6: 跑 typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```
Expected: 全绿。

- [ ] **Step 8.7: Commit**

```bash
git add src/renderer/lib/keybindings/defaults.ts tests/unit/default-keymap.test.ts
git commit -m "$(cat <<'EOF'
feat(keybindings): split/focus 默认快捷键 (6 条)

- Mod+KeyD       → pier.panel.splitRight
- Mod+Shift+KeyD → pier.panel.splitDown
- Ctrl+Shift+ArrowUp/Down/Left/Right → pier.panel.focus{Up,Down,Left,Right}

splitLeft/splitUp 不绑默认快捷键 (loomdesk 同款约定, 留菜单和命令面板
入口). focus 用 Ctrl+Shift+方向键: mac 上是独立 Ctrl (不撞 Cmd+方向 =
workbench), 非 mac 上经 DSL 自动归一化到 Mod+Shift+方向键
(等价表达). 全部 scope: "global" — 跨 panel 都生效.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 手动 e2e 验证 + 修 bug

**Files:** N/A — 手动跑,记 issue 修 bug,可能产生 fix commit。

这是 spec 5.2 节列的"手动验证清单"。每条都要在真实 app 里 manually 验证。无测试代码,只勾选 + 报错时分析根因 + 修。

- [ ] **Step 9.1: 启动 dev 模式**

Run: `pnpm dev`
Expected: Electron 启动,welcome panel 显示。

- [ ] **Step 9.2: 验证 — 右键 tab 看到 `Split →` / `Focus →` 子菜单**

操作:右键任意 tab(welcome 或 terminal 都试)。
Expected:菜单含"Split →"和"Focus →"子菜单,展开各有 4 个方向条目(Split Right / Down / Left / Up;Focus Right / Down / Left / Up)。
不应:8 条平铺占据菜单一大半。

- [ ] **Step 9.3: 验证 — 右键 terminal 内容区(Swift 转发)同样子菜单**

操作:在 terminal panel 的字符区右键(不是 tab)。
Expected:同样的 `Split →` / `Focus →` 子菜单出现。

- [ ] **Step 9.4: 验证 — 命令面板搜 "split" 看到 4 条**

操作:`Mod+Shift+P` 打开命令面板,输入 "split"。
Expected:4 条结果(Split Right, Split Down, Split Left, Split Up),都带正确 accelerator(splitRight 显示 `⌘D`,splitDown 显示 `⌘⇧D`,splitLeft/splitUp 无 accelerator)。

- [ ] **Step 9.5: 验证 — 命令面板搜 "focus" 看到 4 条带 accelerator**

操作:命令面板输入 "focus"。
Expected:4 条结果,各带 `⌃⇧↑` `⌃⇧↓` `⌃⇧←` `⌃⇧→` 这种 accelerator 显示(macOS 上)。

- [ ] **Step 9.6: 验证 — `Cmd+D` 真的拆右,且新 panel 是 terminal 时 Ghostty 能用**

操作:启动后(默认有一个 terminal panel),按 `Cmd+D`。
Expected:左 terminal 保留,右 terminal 新出现,两个都能输入 shell 命令(打字、回车、ls 等)。

- [ ] **Step 9.7: 验证 — `Cmd+Shift+D` 拆下**

操作:在 step 9.6 基础上,在某个 terminal 按 `Cmd+Shift+D`。
Expected:该 terminal 下方出现新 terminal,所有 terminal 都能正常输入。

- [ ] **Step 9.8: 验证 — `Ctrl+Shift+→` 从左 terminal 切到右 welcome,键盘焦点跟过去**

布局:左 terminal + 右 welcome(命令面板搜 "new terminal" 关掉 + 加 welcome 或反之)。
操作:从左 terminal 按 `Ctrl+Shift+→`。
Expected:focus 跳到右 welcome,welcome 内有输入元素则能直接打字。

- [ ] **Step 9.9: 验证 — `Ctrl+Shift+→` 从左 terminal 切到右 terminal,Ghostty firstResponder swap**

布局:左 terminal + 右 terminal。
操作:从左按 `Ctrl+Shift+→`。
Expected:右 terminal 视觉上 active,键盘输入进入右 terminal。

- [ ] **Step 9.10: 验证 — 单 group 时菜单 Focus 子菜单灰**

布局:只有一个 panel(刚启动时)。
操作:右键 tab → Focus 子菜单。
Expected:`Focus →` 子菜单可展开,但 4 个条目全部 disabled(灰)。`Split →` 4 条 enabled。

- [ ] **Step 9.11: 验证 — 单 group 时按 focus 快捷键 no-op**

布局:只有一个 panel。
操作:按 `Ctrl+Shift+→`。
Expected:无视觉变化、无报错(devtools console 干净)。

- [ ] **Step 9.12: 验证 — 命令面板执行 split 后 MRU 顶置**

操作:命令面板执行 "Split Right",然后再打开命令面板看默认排序。
Expected:"Split Right" 排在命令面板靠前位置(MRU 计数生效)。

- [ ] **Step 9.13: 验证 — 命令面板执行 focus 后**不**顶置 MRU**

操作:命令面板执行 "Focus Right",然后再打开命令面板看默认排序。
Expected:"Focus Right" **不**在前列(excludeFromMru 生效)。

- [ ] **Step 9.14: 视觉验证 — 子菜单内重复字样可接受**

打开 `Split →`,看条目是 `Split Right` / `Split Down` 等。
Expected:看到的虽是 `Split → Split Right`(略重复),但符合 spec 3.1 节的有意设计:命令面板同 title 要含 "Split" 字样才能搜到。无 bug。

- [ ] **Step 9.15: 视觉验证 — 子菜单内 accelerator 显示**

打开 `Split →`,Right 条目右侧应显示 `⌘D`;Down 条目右侧显示 `⌘⇧D`;Left/Up 无 accelerator。
打开 `Focus →`,4 个条目右侧应显示 `⌃⇧↑/↓/←/→`(macOS) / `Ctrl+Shift+↑/↓/←/→`(其它)。

- [ ] **Step 9.16: 发现 bug 时**

- 记录到 GitHub issue 或 commit message 草稿
- 先看 spec 是否已覆盖该 case,没的话考虑是 spec 漏点
- 实施修复(短小)
- commit:`fix(...): <description>`

- [ ] **Step 9.17: 全部清单跑通,无 bug 时 task 结束**

无需 commit(仅手动验证)。

---

## Self-Review

写完此 plan 后,检查:

### Spec coverage

逐节对照 [docs/superpowers/specs/2026-06-23-context-menu-split-focus-design.md](../specs/2026-06-23-context-menu-split-focus-design.md):

- [x] § 单源加多 sink 架构 — focusGroup 写回 dockview 单源,sink 自动联动(T5)
- [x] § 菜单元数据扩展 — ActionMetadata.submenu(T1)、buildMenuEntries 聚合(T2)
- [x] § Action 注册清单 8 个 — T6 全部覆盖,含 surfaces 补齐和 excludeFromMru
- [x] § i18n key 8 个新增 — T6 Step 1
- [x] § 默认快捷键 6 条 — T8
- [x] § DSL 扩展(KeyChord.ctrl + parse + matcher + use-keybindings + registry + toElectronAccelerator)— T7
- [x] § workspace store splitPanel 扩四向 — T3
- [x] § focusGroup workspace store action — T5
- [x] § pickFocusTarget 纯函数 — T4
- [x] § getGroupElement helper — T5 Step 3
- [x] § TOL_PX 同步注释 — T5 Step 3 (FOCUS_TOL_PX 显式 comment)
- [x] § 边界处理 — T5 实现内涵盖 api null / activeGroup null / groups < 2 / 无邻居 / element null
- [x] § 测试 — submenu 单测(T2)、focus-target 单测(T4)、default-keymap 扩(T8)、keybindings 扩 ctrl 单测(T7)
- [x] § 手动验证清单 — T9

未覆盖项:无。

### 类型一致性

- `splitPanel` direction = `"right" | "below" | "left" | "above"` — T3 接口、T6 全部 splitXxx handler 使用,一致
- `focusGroup` direction = `"right" | "down" | "left" | "up"` — T5 接口、T6 全部 focusXxx handler 使用,一致;`pickFocusTarget` 同(T4)
- KeyChord 加 `readonly ctrl: boolean` — T7 全部相关处理(parse 输出、chordFromEvent、chordEquals、chordFromNativeForward、toElectronAccelerator)字段名一致

### Placeholder scan

无 "TBD" / "TODO" / "implement later"。所有 Step 都给完整代码或完整命令 + 期望输出。

---

## 后续计划

实施完后,如有时间或用户要求,后续可考虑(本计划不含):

- focus wrap-around(右边到尽头继续按 → 跳最左)
- tab strip 内单 group 多 tab 时 focus 方向键支持切 tab(本计划永远切 group)
- `View →` / `Window →` 其它子菜单(本计划只引入 submenu 基建)
- floating panel 的 split / focus(spec 说跳过)
- 用户自定义 keymap UI
