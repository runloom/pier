# Live Modules（C 轨）：宿主基建 + 项目真实组件预览

日期：2026-07-25  
状态：**方案草案（可评审 / 建议先审 C0 契约再开工）**  
范围：宿主 **Live Modules** 编译 / 协议 / 共享 React 运行时；使 `.pier/canvases`（及 Home `canvases/`）中的 React 模块能 **import 当前项目源码组件**，服务 AI 技术设计出「接近真品」的 UI。  
不含：`pier.canvas` 产品 Viewer / Library 的完整 UX（属 P 轨，但本文锁定其对 C 的依赖）；不含多框架（Vue/Svelte）奇偶支持。

相关：

- Agent Assets 前置与双 root 约束：[`2026-07-23-agent-assets-home-and-instructions-design.md`](./2026-07-23-agent-assets-home-and-instructions-design.md) §6  
- **实施方案（Task / 文件落点 / 验收）：** [`../plans/2026-07-25-live-modules-c-track.md`](../plans/2026-07-25-live-modules-c-track.md)  
- Skills 管理（生成侧可发现 skill，不在本文实现）：[`2026-07-14-project-skills-management-design.md`](./2026-07-14-project-skills-management-design.md)  
- 讨论收敛画布（可选参考，以本文为准；路径随本机 Cursor project 目录变化）：  
  - `pier-live-modules-impl-plan.canvas.tsx`  
  - `pier-live-modules-project-components.canvas.tsx`  
  - `pier-agent-assets-dag.canvas.tsx`

---

## 0. 一句话与决策表

### 0.1 一句话

Pier 主体提供 **React Live Modules**（多 root 注册、路径围栏、esbuild、共享 React、`pier-live://`、诊断广播）。Canvas 文件在保留 `pier/canvas`（宿主 `@pier/ui`）的同时，能 **按项目 tsconfig paths / 相对路径 import 仓库组件**，让 Agent 写的设计稿直接拼出产品真实 UI。

### 0.2 已拍板

| 点 | 选择 | 理由 |
|---|---|---|
| 运行时 | **共享单一 React**（仿 `__PIER_PLUGIN_SHARED__`） | 与宿主 / 插件同构；避免双 React |
| 宿主 SDK | `pier/canvas` → `@pier/ui` 精选 re-export | 跨项目通用壳；插件开发默认 React |
| 真 UI 缺口 | **项目源码 resolve**（非多框架） | AI 技术设计要长得像该产品 |
| 多框架 | **v1 不做** | 偏离目标；Storybook 也用 Composition 而非单 runtime 混跑 |
| 多 root | **必须** `registerRoot × N` | Agent Assets §6：project `.pier/canvases` + home `canvases/` |
| 产品语义 | **不进主体**（kind / Library / 晋升文案） | 对齐 git-changes 插件化；归 `pier.canvas` |
| Home resolve | **关闭项目 paths** | Home 无业务源码；仅宿主 SDK |
| 预览桶 | **推荐 + 可选强制** | 降低「一 import 拉进半个 App」 |

### 0.3 非目标（v1）

- Vue / Svelte / Solid 等奇偶渲染器  
- 完整复刻项目 Vite/Webpack 配置并在 Electron 内跑  
- 自动注入各项目 Router / Store / Auth Provider  
- 默认打包任意 `node_modules`（除明确白名单）  
- 扫描并完整复现项目 `tailwind.config`  
- 把 `pier-home` 整根当作 skills known-root（已有门禁）  
- MCP 统一编辑、规则产品面（属其它轨）

---

## 1. 背景与问题

### 1.1 为什么要 C 轨

Agent Assets（Home / Skills / MCP）已基本落地；下一步要让 AI 在工作台里交付 **可交互的技术设计稿**。若只能用宿主 `@pier/ui` 画通用壳，设计稿与真实产品脱节；若把业务 Canvas 塞进主体 panel-kit，会违反「业务面板走插件」纪律。

因此拆成两层：

| 层 | 名称 | 职责 |
|---|---|---|
| C | Live Modules（主体） | 编译、围栏、协议、共享 React、多 root API |
| P | pier.canvas（插件） | 注册哪个目录、Viewer/Library、kind、命令、skill 文案 |

### 1.2 真正要打通的两条 import

| 类型 | 示例 | 状态 |
|---|---|---|
| 宿主 SDK | `import { Stack, Text } from "pier/canvas"` | 设计已有；实现时接 shim |
| **项目组件** | `import { CheckoutForm } from "@/features/checkout"` | **缺口**（本文主目标） |

不要与「多框架」混谈：插件与宿主继续 React；缺口是 **项目源码图**。

### 1.3 多框架（React 核心 + Vue / Solid / Svelte）

**React 是宿主核心路径**：`pier/canvas`（`@pier/ui`）只服务 React canvas。  
**Vue / Solid / Svelte 为一等入口**（后缀选型），编译与运行时依赖 **项目内** 框架包（bundled into module），不塞进宿主第二套 UI 栈。

```text
Live Modules 核心（框架无关）
  registerRoot / compile / watch / pier-live serve / diagnostics
        │
        ├─ react   *.canvas.tsx|jsx     host React 单例 + pier/canvas
        ├─ vue     *.canvas.vue         项目 vue + @vue/compiler-sfc
        ├─ solid   *.canvas.solid.tsx   项目 solid-js（jsxImportSource）
        └─ svelte  *.canvas.svelte      项目 svelte/compiler
```

约束：

- **一文件一框架**；不要在同一 canvas 混 React+Vue  
- 非 React **没有** `pier/canvas`；自定义组件 = 项目源码 resolve（相对路径 / tsconfig paths / 预览桶）  
- 打开面：files 插件 source/preview（与 Markdown 同构）

### 1.4 与 Cursor Canvas 的区别

Cursor IDE 的 `.canvas.tsx` 与 Pier 拟做的 Live Modules **不是同一套系统**：

| 维度 | Cursor Canvas（IDE 旁路） | Pier Live Modules（本规格） |
|---|---|---|
| 跑在哪 | Cursor IDE 内置编译/预览 | Pier Electron 宿主 |
| 文件放哪 | `~/.cursor/projects/<ws>/canvases/*.canvas.tsx` | 仓库 `.pier/canvases` 或 `pier-home/canvases` |
| SDK | 只能 `import from "cursor/canvas"` | `pier/canvas`（`@pier/ui`）+ **可 import 项目源码** |
| 框架 | **仅 React** | v1 **仅 React**；多框架后置 |
| 目的 | Agent 分析结果可视化（表、图、DAG） | **产品技术设计稿**，尽量长得像真实 App |
| 能否引用你业务组件 | **不能**（隔离 SDK，无项目 resolve） | **要能**（本文主目标） |
| 热更新 | IDE 监视 canvas 文件重编 | 宿主 watch canvas **与其依赖的项目组件** |

一句话：Cursor Canvas = IDE 里的「分析仪表盘」；Pier Live Modules = 工作台里的「可引用仓库组件的 living UI」。名字都叫 canvas，职责不同。

### 1.5 与 Storybook 的对照

| 维度 | Storybook | Pier Live Modules |
|---|---|---|
| 编译归属 | 项目自己的 Vite/Webpack | **宿主 esbuild**（在 Electron main） |
| 为何能引用组件 | 故事在仓库内，resolve 天然是项目的 | 必须 **显式** 继承 tsconfig paths + 围栏 |
| React | 项目依赖的一份 | **必须 external 到宿主单例** |
| 多框架 | 一实例一 framework；混合用 Composition | v1 单 React；不引入第二框架 |
| AI 写稿 | 非主目标 | **主目标之一** |

---

## 2. 架构

### 2.1 分层

```text
┌─────────────────────────────────────────────────────────┐
│  P · pier.canvas 插件                                    │
│  registerRoot · Viewer / Library · create/open · skill   │
└───────────────────────────┬─────────────────────────────┘
                            │ context.liveModules.*
┌───────────────────────────▼─────────────────────────────┐
│  C · Host API + broadcast                                │
│  registerRoot / compile / getUrl / subscribe             │
│  pier://live-modules:changed + diagnostics               │
└───────────────┬─────────────────────────┬───────────────┘
                │                         │
┌───────────────▼───────────────┐ ┌───────▼────────────────┐
│  Renderer 运行时               │ │  Compile 管道 (main)    │
│  React 单例 shim               │ │  esbuild TSX→ESM        │
│  pier/canvas → @pier/ui        │ │  tsconfig paths + fence │
│  dynamic import(pier-live://)  │ │  react* external        │
└───────────────────────────────┘ └───────────┬────────────┘
                                              │
                                  ┌───────────▼────────────┐
                                  │  项目 / Home 文件系统   │
                                  │  .pier/canvases         │
                                  │  src/** 业务组件        │
                                  │  可选 preview-exports   │
                                  └────────────────────────┘
```

### 2.2 模块落点（拟）

| 模块 | 进程 | 路径（拟） | 职责 |
|---|---|---|---|
| `LiveModulesService` | main | `src/main/services/live-modules/` | root 注册、watch、compile、cache、围栏 |
| `pier-live` protocol | main | 对齐 `file-preview-protocol` / `plugin-asset-protocol` | 按 moduleId 提供 ESM 字节流 |
| `live-module-runtime` | renderer | `src/renderer/lib/live-modules/` | 安装 React shim、import map、mount 助手 |
| contracts | shared | `src/shared/contracts/live-modules.ts` | `LiveRootSpec`、`CompileResult`、`Diagnostic` |
| `pier.canvas` | plugin | `src/plugins/builtin/canvas/`（或后续 managed） | 产品 UI；只消费 API |

### 2.3 核心类型（草案 → C0 已落地）

实现见 `src/shared/contracts/live-modules.ts` 与 `src/shared/live-module-url.ts`。  
`anchor` 复用 Agent Assets `AssetRootRef`（`project` 用 `projectRootPath`；`home` 无 path）。

```ts
// 示意；以 shared 合同为准
type LiveRootSpec = {
  id: string; // e.g. "pier.canvas.project"
  anchor: AssetRootRef;
  directory: string; // project: ".pier/canvases"；home: "canvases"
  pattern: string; // "**/*.canvas.tsx"
  resolve: {
    /** 仅 project 有意义；home 强制 false（schema 拒绝 true） */
    tsconfigPaths: boolean;
    previewBarrel?: string; // 推荐 ".pier/preview-exports.ts"
    forcePreviewBarrel?: boolean; // 默认 false
    allowNodeModules?: boolean; // 默认 false
  };
};
```

模块 URL：`pier-live://module/<ticket>`（opaque，禁止路径）。  
Runtime shim：`pier-live://runtime/{react|react-dom|jsx-runtime|jsx-dev-runtime|pier-canvas}`。

### 2.4 宿主永远 external / 永远提供

| 说明符 | 行为 |
|---|---|
| `react` / `react-dom` / `react/jsx-runtime` | external → 宿主单例 |
| `pier/canvas` | external → `@pier/ui` 精选（或 `pier/ui-runtime` 再由插件别名） |
| 项目内相对路径、`@/` 等 paths | **编入** bundle（在围栏内） |

---

## 3. 关键流程

### 3.1 编译与热更新

```text
[fs watch] canvas 或依赖组件变更
    → invalidate module graph（按文件反查）
    → resolve imports（§3.2）
    → esbuild bundle (format:esm, platform:browser)
         external: react*, pier/canvas
         plugins: tsconfig-paths · projectRoot-fence · deny-node
    → write cache/<hash>.js (+ .map)
    → broadcast pier://live-modules:changed { rootId, moduleId }
    → Viewer: import(url?rev=…) → default → createRoot(el).render()
```

### 3.2 Import 解析决策

```text
                    import 说明符
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
 react* / pier/canvas   @/ 或 paths      ./ 相对路径
 → external 宿主         → tsconfig 映射    → 相对 canvas 文件
        │                 │                 │
        └────────────┬────┴─────────────────┘
                     ▼
              realpath 围栏
           必须落在 projectRoot
           （home root：仅允许
            home canvases 目录内文件；
            禁止项目 paths）
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
      通过→编入   electron/node  越界路径
                  → 拒+diagnostic → 拒+diagnostic
```

### 3.3 Viewer 挂载（P 轨消费，C 提供数据）

```text
Viewer(panel)
  on mount / on changed:
    setState(loading)
    result = await liveModules.compile(rootId, path)
    if !result.ok → setState(error, diagnostics)   // 三态
    else:
      mod = await import(result.url)
      unmount?.(); unmount = mount(el, mod.default)
      setState(ready)

Host boot (once):
  installLiveModuleRuntime()  // 对齐 installPluginSharedRuntime
```

### 3.4 双 root

| 时刻 | project root | home root |
|---|---|---|
| 插件 activate | `registerRoot(anchor:project, .pier/canvases)` | `registerRoot(anchor:home, canvases/)` |
| 创建对话框 | **默认**写入当前项目 | 可选「保存到本机工作台」 |
| 项目组件 resolve | **启用** tsconfig paths | **关闭**；仅 `pier/canvas` |
| AI 真 UI 设计 | **主路径** | 跨项目草稿 / 平台规划 |

### 3.5 AI 设计闭环（目标体验）

```text
Agent
  → 扫 src/components 或读 .pier/preview-exports
  → 写 .pier/canvases/<topic>.canvas.tsx
       import { X } from "@/…"
       import { Stack } from "pier/canvas"
  → Live Modules 自动 compile
  → 用户在 Viewer 看真实组件拼出的方案
  → 反馈 → Agent 改 canvas 或改产品组件
```

理想 canvas 形态：

```tsx
// .pier/canvases/checkout-redesign.canvas.tsx
import { Stack, Text } from "pier/canvas";
import { CheckoutForm } from "@/features/checkout";
import { PriceSummary } from "../../src/ui/PriceSummary";

export default function CheckoutRedesign() {
  return (
    <Stack>
      <Text>方案 B：合并地址与支付</Text>
      <CheckoutForm variant="compact" />
      <PriceSummary />
    </Stack>
  );
}
```

---

## 4. 安全与限制

### 4.1 围栏

- 所有解析路径 `realpath` 后必须落在：  
  - project：已注册项目的 `projectRoot`  
  - home：`pier-home` 根下的 `canvases/`（及可选预览桶，若将来允许）  
- 禁止 `..` 逃逸、禁止任意绝对路径由客户端传入  
- 拒绝 `electron`、`node:fs`、main 进程模块等（deny 列表 + 单测）

### 4.2 体积与超时

- compile 设超时与输出体积上限；超限 → diagnostic，不静默截断成功  
- `CompileResult.graph` 暴露编入文件列表，便于 DX

### 4.3 预览桶（推荐）

约定可选入口：`.pier/preview-exports.ts`（名称可在 C0 定稿）。

- **推荐**：canvas / Agent 优先从桶 import  
- **可选强制**（root spec 开关）：除 `pier/canvas` 与相对路径指向桶可达模块外，拒绝深路径乱 import  
- 桶内只再导出「纯展示、props 可注入」的组件，避免强依赖 Router/Store

### 4.4 样式（v1 诚实边界）

| 支持 | 不承诺 |
|---|---|
| 显式 `.css` / `.module.css` import | 完整复现项目 Tailwind 扫描与 config |
| 宿主主题 CSS 变量（globals） | 项目全局 CSS 副作用自动注入 |

后置增强：可选「项目 CSS 入口」挂载，不进 v1 关门条件。

---

## 5. 可行性分析

### 5.1 总判

**可行，建议分阶段交付。**  
协议 / shim / 多 root / esbuild 骨架风险低（仓库已有 privileged scheme 与插件共享 React）。  
不确定点在「任意业务组件开箱即用」——Provider 依赖与样式管道会拉低保真度；用预览桶 + 明确非目标可把 v1 收成可上线切片。

### 5.2 分项（1–5）

| 能力点 | 分 | 判语 | 依据 |
|---|---|---|---|
| 共享 React + @pier/ui | 5 | 高可行 | `__PIER_PLUGIN_SHARED__` 先例 |
| 多 root register | 5 | 高可行 | Home `canvases/` 已 mkdir；§6 已锁 |
| 自定义协议 serve | 5 | 高可行 | file-preview / plugin-asset |
| esbuild 编译 canvas | 4 | 高可行 | workspace 已用 esbuild；需独立管道 |
| 继承 tsconfig paths | 4 | 可行 | 常见；monorepo 多 config 要分层 |
| 打包项目组件 | 3 | 中等 | 依赖图深度 / 副作用 |
| 项目 CSS / Tailwind | 2 | 难点 | v1 收窄范围 |
| 依赖 App Provider 的组件 | 2 | 难点 | 预览桶 + 文档 |
| React 大版本不一致 | 3 | 可控 | 强制 external + peer 文档 |
| 安全围栏 | 4 | 可行 | realpath + deny 可测 |

综合约 **3.7 / 5**。

### 5.3 风险与缓释

| 风险 | 缓释 |
|---|---|
| 组件依赖 Router/Store/Auth | 预览桶只导出纯展示；失败进 diagnostics；skill 要求 props 可注入 |
| 两套 CSS 管道 | v1 只保证显式 css；Tailwind 后置 |
| 依赖图爆炸 | 超时/体积上限；暴露 graph；鼓励浅导出 |
| React 版本漂移 | external 宿主；文档声明 peer |

### 5.4 v1 验收标准（关门）

1. 共享单一 React 实例；`pier/canvas` 能渲染 `@pier/ui`  
2. `registerRoot` 可同时挂 project + home  
3. fixture canvas **相对路径或 `@/`** import 仓库内 Button（或预览桶导出）并能渲染  
4. 越界路径、`electron` import → 拒绝并进入 diagnostics  
5. 改依赖组件 → watch → Viewer 更新（或明确的 stale + 重编信号）  
6. **不**以「任意业务页面可挂载」为 v1 关门条件  

---

## 6. 分期实施

| 阶段 | 范围 | 出口 | 风险消化 |
|---|---|---|---|
| **C0** 契约 | `LiveRootSpec` / `Diagnostic` / 多 root / resolve 规则书面化 + shared 类型 | 规格评审通过；合同单测可写 | 先钉非目标 |
| **C1** 围栏+协议 | `registerRoot` · `pier-live://` · cache 目录 | 无编译也能 serve 静态 ESM fixture | 复用现有 protocol |
| **C2** 最小编译 | esbuild canvas-only；仅 `pier/canvas` + react external | 无项目 import 的 canvas 可渲染 | 验证 shim |
| **C3** 项目 resolve | tsconfig paths + 相对路径 + fence；体积/超时 | fixture import 项目 Button 成功 | **主风险首次暴露** |
| **C4** watch+诊断 | 依赖图失效 · changed 广播 · 三态数据 | 改组件 → Viewer 更新；错误可读 | DX |
| **C5** 预览桶+双 root | preview-exports 可选强制；home 无项目 resolve | AI skill 文档闭环；**P 可开 Viewer** | 降低乱 import |

建议垂直切片（约 3–5 人日量级）：C0 合同 → 协议 hello ESM → shim + 纯 `@pier/ui` canvas → 仓库内 `fixtures/live-modules/ui/button.tsx` 被 canvas import。跑通后再接真实客户项目样本。

**P 轨启动条件**：C5 出口满足（双 root + compile/subscribe + 至少一条项目组件成功路径）。

---

## 7. 与其它轨的关系

| 轨 | 关系 |
|---|---|
| A Agent Assets | 提供 `AssetScope` / Home / `canvases/` mkdir；C 消费双 root，不改 skills 引擎 |
| C Live Modules | **本文** |
| P pier.canvas | 依赖 C5；负责产品 UX；禁止自建 esbuild / 第二份 React |
| S6 skills 插件 facade | 可选并行；完整「Agent 发现 skill → 写 canvas」体验更佳，但 **不阻塞** C0–C3 |

---

## 8. 开放问题（实现前关闭）

> **已在实施方案 §0 给出默认值**（[`../plans/2026-07-25-live-modules-c-track.md`](../plans/2026-07-25-live-modules-c-track.md)）。下表保留供评审勾选；若无异议按方案默认开工。

1. 预览桶路径与强制策略默认值 → 方案：`.pier/preview-exports.ts`，默认 **鼓励不强制**  
2. `@pier/ui` 精选导出白名单 → 方案：v1 最小集（Stack/Text/Button/Separator/Card…）  
3. monorepo：默认读哪个 `tsconfig` → 方案：自 canvas 向上最近 tsconfig，否则 `projectRoot/tsconfig.json`  
4. CSS 后置增强是否进 C5 → 方案：**不进 C5**；可选 C3.5 显式 css；Tailwind 另切片  
5. `pier.canvas` 首发 builtin 还是 managed → 方案：**builtin 原型**，再迁 managed

---

## 9. 建议决策（请评审勾选）

- [ ] 批准：React 核心 + 项目源码 resolve；多框架不进 C v1  
- [ ] 批准：分期 C0→C5；P 等 C5  
- [ ] 批准：v1 验收以预览桶 + 常见 `@/`/相对 import 为准  
- [ ] 确认开放问题 1–5 的默认值  

---

## 10. 变更记录

| 日期 | 说明 |
|---|---|
| 2026-07-25 | 初稿：从多 canvas 讨论收敛为可评审规格；纠正「多框架」误读为「项目组件 resolve」 |
| 2026-07-25 | 链到实施方案；§8 标注方案默认值；去掉易失效的绝对 canvas 路径 |
