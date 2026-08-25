# Canvas 方向纠偏：先稳框架

日期：2026-07-27  
状态：**已确认（纠偏）**  
前置：

- Live Modules：[`2026-07-25-live-modules-and-project-components-design.md`](./2026-07-25-live-modules-and-project-components-design.md)
- Canvas UI brief：[`2026-07-25-pier-canvas-ui-design-brief.md`](./2026-07-25-pier-canvas-ui-design-brief.md)

---

## 0. 问题

### 0.1 症状

近期主线变成「金样级 Plan 工作台」：`pier/plan-kit`、`.pier/plans/**` dogfood、`plan-canvas` Skill。预览仍难对齐金样，且建设重心偏离宿主框架。

### 0.2 根因

| 错位 | 说明 |
|------|------|
| 领域产物当平台 | Plan 三表面是一类 canvas **产物**，不是 Live Modules 核心 |
| 过早垂直深化 | 通用 `/canvas` 生成合同未稳时先做意见化 Plan Kit |
| 验收绑死 dogfood | `.pier/plans` 越厚，越掩盖「框架是否够用」 |

### 0.3 判定

**当前主线不对。** 应暂停 Plan 产物线，先稳住 L1 框架与通用产物路径 `.pier/canvases`。

---

## 1. 正确目标

```text
/canvas（生成合同，后置产品化）
        │ 写出薄 *.canvas.tsx + 可选数据
        ▼
.pier/canvases/**          ← 通用产物目录
        │ import
        ▼
┌───────────────────────────────────────┐
│ 系统基础物料：pier/canvas（@pier/ui）   │
│ 自定义物料：项目源码组件（tsconfig/相对）│
│ 运行：Live Modules compile/fence/mount │
└───────────────────────────────────────┘
```

一句话：**核心是「能稳定生成并预览 canvas」；物料 = 系统白名单 + 项目自定义；Plan 工作台不是现在的平台投资中心。**

---

## 2. 建设焦点 vs 暂停

| 做（框架） | 不做（本阶段） |
|------------|----------------|
| Live Modules 编译 / 围栏 / 挂载 / 诊断 | `pier/plan-kit` 领域面 |
| `pier/canvas` 系统基础物料 | `.pier/plans` dogfood / VISUAL-SPEC 金样追平 |
| 项目组件 resolve（真 UI） | 完整 `/canvas` Skill 产品化（仅钉合同草图） |
| `.pier/canvases` smoke + templates | 把 Plan IDE 壳塞进宿主 |

---

## 3. `/canvas` 生成合同（草图，后置实现）

Skill / 命令只允许：

1. 在 `.pier/canvases/<id>/` 写薄 `*.canvas.tsx`（+ 可选同目录 json）
2. import：`pier/canvas`、`react`、相对路径、项目 `tsconfig` paths（框架已允许的）
3. 使用系统物料 + 项目自定义组件拼 composition

禁止：

- 复制宿主 Kit 源码进产物树
- `:root` / `html` / `body` 全局 CSS
- 任意 npm（围栏外）
- 以 `.pier/plans` 为默认生成根（本阶段不恢复 plans 专用树）

薄入口示例：

```tsx
import { Frame, Stack, Text } from "pier/canvas";
// optional: import { CheckoutForm } from "@/features/checkout";

export const canvas = {
  title: "…",
  kind: "composition" as const,
  description: "…",
};

export default function () {
  return (
    <Frame>
      <Stack gap={10}>
        <Text as="h2">…</Text>
      </Stack>
    </Frame>
  );
}
```

---

## 4. 里程碑

1. **本轮**：删除 plans / plan-canvas skill；拆除 `pier/plan-kit`；清理过时 Plan 规格与 `project-plan` 契约；`.pier/canvases` 为唯一产物/验收根
2. **下一轮**：框架回归硬化（compile / fence / 项目组件）后，再产品化 `/canvas` Skill
3. **可选更后**：领域 Kit（含 Plan）作为**官方物料包**再引入，不得再变成第二平台

---

## 5. 与旧文档关系

- 已删除（纠偏后不再保留）：`2026-07-27-plan-canvas-system-design.md`、`2026-07-26-canvas-product-design-workflow-design.md`、对应实施 plan
- Live Modules / Canvas UI brief（07-25）：**继续有效**，是建设真源
- 验收清单：[`2026-07-26-live-modules-verification-checklist.md`](./2026-07-26-live-modules-verification-checklist.md)（以 `.pier/canvases` 为准）
