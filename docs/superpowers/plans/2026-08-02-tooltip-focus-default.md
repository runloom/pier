# Tooltip 聚焦默认策略实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有未显式配置的 Tooltip 在聚焦时不展示，同时保留悬停与显式例外能力。

**Architecture:** 聚焦打开策略只属于共享 `TooltipTrigger`。将其默认值收紧为 `false`，不改动 Radix 的定位、悬停、受控打开或现有全局抑制链路；调用方只有在已验证的必要场景下才传入 `openOnFocus={true}`。

**Tech Stack:** React 19、TypeScript、Radix Tooltip、Vitest、React Testing Library。

## 全局约束

- 视觉焦点环必须保留；Tooltip 不是焦点反馈。
- 悬停、受控 `open`、菜单/拖拽/失焦时的 Tooltip 抑制逻辑不得改变。
- 不新增持久化、设置项、i18n 文案或跨进程通信。
- 例外必须在调用点显式写 `openOnFocus={true}`；没有已验证需求时不添加例外。
- 仅修改共享组件与其组件测试；不以批量业务调用点补丁替代默认策略。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `packages/ui/src/tooltip.tsx` | 定义 `TooltipTrigger` 的聚焦默认策略，继续将显式属性传入现有 `handleFocus`。 |
| `tests/component/app/tooltip.test.tsx` | 覆盖默认关闭、显式开启与悬停不回退。 |

### Task 1: 收紧共享触发器的聚焦默认值

**Files:**

- Modify: `packages/ui/src/tooltip.tsx:173-205`
- Modify: `tests/component/app/tooltip.test.tsx:273-320`

**Interfaces:**

- Consumes: `TooltipTrigger` 已有属性 `openOnFocus?: boolean`，以及 `focusInputModality`、`handleFocus` 的既有逻辑。
- Produces: 未传入属性时与 `openOnFocus={false}` 等价；`openOnFocus={true}` 保留键盘聚焦打开行为。

- [x] **Step 1: 写出失败的默认行为测试，并保留显式例外测试**

在 `tests/component/app/tooltip.test.tsx` 中，将现有默认聚焦打开用例改为以下两项：

```tsx
it("does not open from keyboard focus by default", async () => {
  const { getByRole } = render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button">Trigger</button>
        </TooltipTrigger>
        <TooltipContent>Help</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const trigger = getByRole("button");
  fireEvent.keyDown(document.body, { key: "Tab" });
  fireEvent.focus(trigger);
  await waitForDelay(20);

  expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
});

it("opens from keyboard focus when explicitly enabled", async () => {
  const { getByRole } = render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild openOnFocus={true}>
          <button type="button">Trigger</button>
        </TooltipTrigger>
        <TooltipContent>Help</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const trigger = getByRole("button");
  fireEvent.keyDown(document.body, { key: "Tab" });
  fireEvent.focus(trigger);

  expect(await findTooltipContent()).toHaveTextContent("Help");
});
```

保留既有 `openOnFocus={false}` 测试和 hover 测试；前者继续证明显式关闭与默认关闭一致，后者证明指针路径未受影响。

- [x] **Step 2: 运行单测，确认新默认测试在改动前失败**

Run: `pnpm vitest run tests/component/app/tooltip.test.tsx -t "does not open from keyboard focus by default"`

Expected: FAIL；当前默认值为 `true`，测试会发现 `[data-slot="tooltip-content"]` 已存在。

- [x] **Step 3: 以最小改动收紧共享默认值**

在 `packages/ui/src/tooltip.tsx` 中只改 `TooltipTrigger` 的默认值和说明：

```tsx
function TooltipTrigger({
  onFocus,
  openOnFocus = false,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  /**
   * When true, keyboard focus may open the tooltip.
   * Focus-open is disabled by default; keep help on hover unless a caller
   * has a verified keyboard-discovery need.
   */
  openOnFocus?: boolean;
}) {
```

不要改动 `handleFocus` 的 `preventDefault()` 分支、`focusInputModality` 或任何 `TooltipProvider` 代码。

- [x] **Step 4: 运行组件测试，确认默认关闭、显式开启和悬停均通过**

Run: `pnpm vitest run tests/component/app/tooltip.test.tsx`

Expected: PASS；默认聚焦无 Tooltip，显式 `openOnFocus` 可展示，既有 hover 与全局抑制用例全部通过。

- [x] **Step 5: 审阅现有调用点，不添加未经验证的例外**

Run: `rg -n '<TooltipTrigger\b|openOnFocus\s*=' src packages --glob '*.{ts,tsx}'`

确认现有业务调用点没有因本次变更新增 `openOnFocus={true}`。当前既有的 `openOnFocus={false}` 可以保留为局部“仅悬停”意图说明，但不应为其他调用点新增冗余属性。

- [x] **Step 6: 运行静态与类型验证**

Run: `pnpm typecheck:packages && pnpm vitest run tests/component/app/tooltip.test.tsx && git diff --check`

Expected: 全部通过；仅共享 Tooltip 组件、其组件测试和本计划文件发生预期改动。

- [x] **Step 7: 提交实现**

```bash
git add packages/ui/src/tooltip.tsx tests/component/app/tooltip.test.tsx docs/superpowers/plans/2026-08-02-tooltip-focus-default.md
git commit -m "fix(ui): disable tooltip focus opening by default"
```

## 计划自检

- 设计说明的五项完成标准均由 Task 1 覆盖：默认关闭、悬停保持、显式开启、焦点与受控状态不回退、无逐点补丁。
- 没有占位符；属性名、文件路径和测试名均与现有实现一致。
- 任务只改变共享 UI 组件的局部默认值，不扩展到设置、持久化或其他进程。
