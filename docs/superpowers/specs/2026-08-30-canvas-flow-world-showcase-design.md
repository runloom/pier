# Canvas 阅读流 / 画板流示范例 · 设计

- 日期：2026-08-30
- 状态：评审中
- 前置：Canvas 双模式壳（2026-08-26，已收口）；FlowGraph 移除（2026-08-30，见双模式壳设计稿文首注记）
- 关联：[`2026-08-26-canvas-dual-stage-and-ui-expansion-design.md`](2026-08-26-canvas-dual-stage-and-ui-expansion-design.md)（壳与积木底座）

## 1. 背景与问题

FlowGraph 移除后，Canvas v1 的能力面收敛为三种 stage 几何：**阅读流**（flow / `DocsShell`）、**满幅 fill**（`Stack fill`）、**画板流**（world / `WorldStage`），外加数据通道（`useCanvasFile` / `canvasCommand` / loopback / 插件投影）。壳与积木层已达金标准，但**示范面严重落后于底座**：

1. **画板流没有像样的示例。** `templates/design-mockup.canvas.tsx` 是占位骨架——两块画板各一行 "Replace this frame with the real product chrome" 加一个按钮，看不出设备预设、多画板空间摆放、评论 pin、相机浏览的真实表达力。仓库内可打开的 world 金样（`smoke/world.canvas.tsx` 等）已于 2026-08-28 清理删除。
2. **阅读流示例同样是骨架。** `templates/docs.canvas.tsx` 只有三节空壳导航；文档字体、阅读偏好（字号 / 舒适宽屏）、正文排版（列表 / 引用 / 表格 / 行内演示块）、Mermaid 静态图这些阅读流的核心能力没有一处被示范。
3. **后果**：agent 按 skill 从模板起步时，起点质量决定产出质量——骨架模板正是「生成的 canvas 效果差」的第一根源（FlowGraph 被移除的直接动因）。用户与 agent 都缺一个「打开就懂」的黄金对照：阅读流长什么样、画板流长什么样、什么时候选哪个。

## 2. 产品设计

### 2.1 目标

把两种 stage 的**权威模板升级为示范级**（showcase quality），并让两者内容互相呼应：

| 交付 | stage | 主题 | 升级后应达到 |
|---|---|---|---|
| `templates/docs.canvas.tsx` | 阅读流 | 「Canvas 画布模式指南」——文档内容**就是**两种流的选型说明（自指涉：打开阅读流示例，读到的正是两种流怎么选） | 真实可读的完整文档，不是骨架 |
| `templates/design-mockup.canvas.tsx` | 画板流 | 「产品界面设计稿」——三设备画板拼真实感界面 | 打开即能感受画板流的空间表达力 |

**互相指引**：docs 末节给一句「画板流示例见 design-mockup 模板」；mockup 世界坐标上放一张说明便签指回 docs。两个示例合起来回答「flow vs world 怎么选」。

### 2.2 示例内容契约

**阅读流（docs 升级）**，必须示范到的能力点：

- `DocsShell` 左导航 + 文章版心（4–5 节：模式概览 / 何时用阅读流 / 何时用画板流 / 选型决策 / 下一步）；
- 宿主**文档字体**（`--pier-document-font-family` 经 DocsShell 继承）与阅读偏好（字号 / 舒适宽屏经 `--md-scale` 被动应用——正文能看出字号跟随设置变化）；
- 正文排版全谱：段落、有序/无序列表、`Alert` 提示、表格、行内 `code`；
- 一个**行内活演示块**（live demo 用 UI 字体，与正文文档字体形成对照——这本身就是教学点）；
- 一张 `Mermaid` **静态**选型决策图（同时示范「Mermaid = 静态图示」的正确用法，巩固 FlowGraph 移除后的教法边界）;
- 关键节标题挂 `data-pier-comment-id`（评论锚点在阅读流的正确用法）。

**画板流（design-mockup 升级）**，必须示范到的能力点：

- `WorldStage` + `Layer` 世界坐标摆放 ≥3 块画板：`desktop` + `phone` 必备，第三块 `tablet` 或 `laptop`；
- 画板内容是**真实感界面**（用 `pier/canvas` 控件拼一个可信的产品界面：侧栏 + 列表 + 表单/卡片，非一行占位字）；同一界面在 desktop 与 phone 两种尺寸下的响应式差异本身就是设计稿的叙事；
- 一张**说明便签** `Layer`（`Text` 便签放在画板旁的世界坐标上——标注属于画布空间，不伪造 pin UI）；
- 每块画板根挂 `data-pier-comment-id`（Design Mode 评论锚点）；
- 隐含示范相机浏览：多画板占据足够世界面积，打开后 fit 全景、`ctrl+wheel` 放大到单板细看的旅程自然成立。

### 2.3 放置决策（关键）

**升级现有两个模板，不新增任何落仓 demo。**

- `.pier/canvases/` 准入（README）：不带测试或 catalog 消费者不得新增 demo——排除「新目录」方案；
- `resources/system-skills/pier-canvas/templates/` 本来就是权威示范面与 agent 起点（2026-08-28 清理时明确的单一真源），骨架级模板正是问题本体，升级它们是最短路径；
- 模板已有测试消费者（`tests/component/misc/bundled-pier-canvas-templates.test.tsx` 挂载 + `bundled-pier-canvas-runtime.test.ts` 编译），升级后自动在治理覆盖内，零新增测试面。

**开发期验收路径**：临时复制两个模板到本 worktree `.pier/canvases/`（或任一测试项目）打开预览走查，验收后删除副本，不入库。

### 2.4 非目标

- 不加第三种「应用模式」stage（双模式壳设计稿 §2.2 已定）；
- 不复活 FlowGraph / 活图原语（2026-08-30 决策）；示例中的图只有 `Mermaid` 静态图示；
- 不动壳、原语、编译管线——纯内容层示范；示范过程中发现的底座问题单独开修，不夹带；
- 不在 `.pier/canvases/` 新增目录；不重建 per-recipe 金样体系；
- 模板保持英文源串 + 「交付时改写为用户语言」的既有约定（模板是 agent 起点，不是最终交付物）。

## 3. 技术设计

### 3.1 docs 模板结构（阅读流）

```text
DocsShell
├─ header：Badge(docs) + 标题 + 读者定位一句话
├─ nav：overview / flow / world / choosing / next（5 节）
└─ 各节文章体
   ├─ overview：两种 stage 一段话 + 对照表（Table）
   ├─ flow：适用场景列表 + Alert（版心/字号由宿主偏好接管，作者不管排版）
   │        + 行内活演示块（UI 字体 vs 文档字体对照）
   ├─ world：适用场景 + 相机交互说明（wheel 平移 / ctrl+wheel 缩放 / 双击 fit）
   ├─ choosing：Mermaid 静态决策图（flow vs fill vs world）
   └─ next：指向 design-mockup 模板 + skill 入口
```

### 3.2 design-mockup 模板结构（画板流）

```text
WorldStage (padding=40)
├─ Layer(32, 32)      Artboard preset=desktop 「Library — Desktop」
│                     侧栏(导航列表) + 主区(搜索行 + 卡片网格)
├─ Layer(~1400, 32)   Artboard preset=phone   「Library — Phone」
│                     同一界面收窄：顶栏 + 单列列表(同数据)
├─ Layer(~1900, 32)   Artboard preset=tablet  「Library — Tablet」（可选第三块）
└─ Layer(32, ~950)    说明便签：设计意图 2–3 行 + 「文档流示例见 docs 模板」
```

界面主题用中性的「素材库 / Library」（列表 + 卡片是控件覆盖面最好的组合），不绑定 Pier 自身产品面，避免与真实设置页产生「这是产品截图吗」的混淆。

### 3.3 治理与测试

| 检查点 | 处置 |
|---|---|
| `bundled-pier-canvas-templates`（组件挂载）+ `bundled-pier-canvas-runtime`（编译） | 既有，升级后自动覆盖 |
| `pier-canvas-methodology-packs`（SKILL 引用模板路径） | 模板文件名不变，零影响 |
| 模板质量锚点（新增断言，防退化回骨架） | docs：源含 `DocsShell` 且 nav ≥4 节、含 `Mermaid`；mockup：含 ≥3 `Artboard`、≥2 种 `preset`、含 `data-pier-comment-id`。落点：`bundled-pier-canvas-templates.test.tsx` 内加轻量源码断言 |
| 用户文案治理 | 模板英文源不受中文禁词表约束（交付时 agent 改写）；注释保留「Rewrite every user-visible string」约定 |

### 3.4 SKILL 随动

- `SKILL.md` stage 选型表与 `references/authoring.md` 的模板描述核对一遍（模板结构升级后引用锚点是否仍准确）；预期只有 docs 模板「三节」之类的措辞需要跟随，无结构性改动。

## 4. 路线与规模

| 步 | 内容 | 规模 |
|---|---|---|
| T1 | docs 模板升级（§3.1）+ 质量锚点断言 | S（半天内） |
| T2 | design-mockup 模板升级（§3.2）+ 质量锚点断言 | S |
| T3 | SKILL/authoring 措辞核对 + 本地复制走查（两模板打开、字号偏好切换、相机交互、评论 pin） | S |

T1 ⊥ T2 可并行；合计一天内。

## 5. 风险与取舍

- **模板体积**：示范级内容会让模板从 ~55 行涨到 200–350 行；仍远低于 500 行硬上限，且模板是「起点素材」，内容丰富是特性不是负担。agent 交付时按需求裁剪。
- **自指涉主题的边界**：docs 示例讲「画布模式选型」有一处教法重叠（SKILL 也教选型）——刻意为之：模板面向**打开画布的人**（视觉示范），SKILL 面向**生成画布的 agent**（操作规程），同一知识两个受众。若评审认为重叠过多，docs 主题可替换为任意真实文档主题（如「团队 onboarding 手册」），能力点契约（§2.2）不变。
- **「Library」主题的语言**：英文源串在中文用户打开时是英文——与所有模板一致（交付时改写），示范用途可接受；若要求开箱中文，需给模板体系整体引入 locale 机制，超出本设计范围（记为后续可选项）。
