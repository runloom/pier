# Live Modules（C 轨）质量验证清单

日期：2026-07-26  
状态：可执行验收  
相关：

- 设计：[`2026-07-25-live-modules-and-project-components-design.md`](./2026-07-25-live-modules-and-project-components-design.md)
- 计划：[`../plans/2026-07-25-live-modules-c-track.md`](../plans/2026-07-25-live-modules-c-track.md)
- 多框架验收：[`2026-07-26-live-modules-multi-framework-checklist.md`](./2026-07-26-live-modules-multi-framework-checklist.md)

## 0. 先回答两个问题

### 0.1 架构对不对？

**对。** 主轴应保持：

| 层 | 职责 |
|---|---|
| main | 注册 root、esbuild、围栏、ticket、watch、广播 |
| `pier-live://` | 只暴露 opaque ticket / runtime shim，不带磁盘路径 |
| renderer | 宿主 React 单例、`pier/canvas`、`import(url)`、挂载 |
| 产品面（P 轨） | Library / 创建 / kind 文案；C 轨 Viewer 仅作验收 harness |

不要用「能打开 hello」代替架构验收；要用下面分层信号。

### 0.2 要不要复杂 Demo？

**要。** 但不是一个巨型文件糊满组件。

| Demo 类型 | 作用 | 不够证明什么 |
|---|---|---|
| **冒烟** `smoke/hello.canvas.*`（React / Vue / Solid / Svelte） | 协议 + 编译 + 挂载通了 | 多文件图、hooks、真产品复杂度 |
| **薄模板** `templates/blank.canvas.tsx` | 最小 composition 起稿 | 依赖图深度、交互态 |
| **Plan dogfood** `.pier/plans/.../plan.canvas.tsx` | 多文件相对 import + JSON + Tab 交互 | 业务 Provider / 项目 Tailwind / 任意 `src/` 深依赖 |

原则：

1. **冒烟必绿**，否则管道坏了。  
2. **Plan dogfood 必绿**，才敢说「能做技术设计稿 / 多文件图」。  
3. **负例必红**（`electron` / `fs` / `..` 逃逸），才敢说围栏在干活。  
4. 不要一上来 import 宿主 `src/renderer/**` 大图——那会测成「业务依赖可编译」，不是 C 轨关门条件；真 UI 深集成用预览桶与后续切片。

---

## 1. 自动化（层 0）

在仓库根执行：

```bash
pnpm test:unit -- \
  tests/unit/main/live-modules-contract.test.ts \
  tests/unit/main/live-modules-service.test.ts \
  tests/unit/main/live-modules-frameworks.test.ts \
  tests/unit/main/live-modules-package-resolve.test.ts \
  tests/unit/renderer/live-modules-runtime.test.ts \
  tests/unit/plugins/file-canvas-preview.test.tsx \
  tests/unit/shared/live-module-canvas-path.test.ts \
  tests/unit/shared/pier-canvas-meta.test.ts
```

- [ ] 全部通过  
- [ ] service 测覆盖：`@/` Button、home 禁 paths、force 预览桶、protocol 404、smoke/blank 编译  
- [ ] service 测覆盖：plan dogfood `canvas-capabilities-v1/plan.canvas.tsx` 编译成功（含 plan-model + plan.json）

**通过含义：** 契约与编译管道可信。  
**不通过含义：** 先修测试，不要进 Electron 手工。

---

## 2. 真机冷路径（层 1）

```bash
pnpm dev
```

打开**本仓库**为项目根后，在文件树依次打开：

| # | 路径 | 期望 |
|---|---|---|
| A | `.pier/canvases/smoke/hello.canvas.tsx` | 进入 Live Modules 预览；loading → ready |
| B | `.pier/canvases/templates/blank.canvas.tsx` | composition scaffold |
| C | **`.pier/plans/canvas-capabilities-v1/plan.canvas.tsx`** | Tab 需求/依赖图/任务；多文件 graph |

勾选：

- [ ] A–C 均走 Viewer（标题栏有路径 / Reload）  
- [ ] ready 后可见 UI（不是白屏、不是未编译源码）  
- [ ] 点 Reload 后仍 ready（无挂载泄漏导致空白）  
- [ ] C：三 Tab 可切换；依赖图可选中节点

---

## 3. 负例（层 1b，必须做）

在任意 canvas 临时加入后 Reload（测完还原）：

```tsx
import fs from "fs"; // 或 import "electron"
```

- [ ] 进入 error 态  
- [ ] 文案含 denied / resolve / fence 一类可读信息（不要静默成功）  
- [ ] 去掉坏 import 并 Reload 后恢复 ready  

另可选：相对路径 `../../../../etc/passwd` 一类逃逸 → 必须失败。

---

## 4. 热更新（层 2）

打开 `stress/workbench-proposal.canvas.tsx` 到 ready。

1. 改标题字符串并保存。  
2. **先不点 Reload**。  

- [ ] 数秒内界面自动更新（`stale` → Viewer 重编）  
- [ ] 点 Reload 仍可手动刷新  

若自动不变：查 preload `liveModules.onChanged` 与 panel 是否订阅 `type === "stale"`。

---

## 5. 架构卫生（层 3，可选扫一眼）

```bash
# esbuild 应只在 main
rg -n "from [\"']esbuild[\"']" src/

# renderer 不应直接编译
rg -n "compileLiveModule|createLiveModulesService" src/renderer

# React / pier/canvas 单例入口
rg -n "__PIER_PLUGIN_SHARED__|__PIER_LIVE_CANVAS__|installLiveModuleRuntime" src/
```

- [ ] esbuild 仅 main live-modules  
- [ ] renderer 无第二套编译器  
- [ ] URL 形态为 `pier-live://module/<ticket>`（无绝对路径）  

---

## 6. 评分卡（满分 10）

| # | 能力 | 建议验法 | 通过 |
|---|---|---|---|
| 1 | 纯 `pier/canvas` 可挂 | hello | ☐ |
| 2 | 相对路径本地组件 | composition / DemoChip | ☐ |
| 3 | 多文件依赖图 | **压测 Demo** | ☐ |
| 4 | hooks / 交互 | 压测 Demo 改数字 | ☐ |
| 5 | 围栏负例 | fs / electron | ☐ |
| 6 | opaque ticket | ready 态 URL 形态 | ☐ |
| 7 | 错误三态 | 坏 import | ☐ |
| 8 | 手动 Reload | 改文案 | ☐ |
| 9 | 自动 stale → 重编 | 改文件不点 Reload | ☐ |
| 10 | 多 worktree 互不踩 | 两项目各开 canvas（root id 按路径派生） | ☐ |

**多轮交叉审查后（并发 epoch / watch debounce / 围栏 / dispose）：预期 ≥ 9 / 10。**  
**C 轨交给 P 轨建议：≥ 9 / 10，且压测 Demo + 热更新真机必绿。**

---

## 7. Demo 阶梯（维护约定）

| 路径 | 角色 | 谁维护 |
|---|---|---|
| `smoke/hello.canvas.*` | 冒烟（各框架），保持极简 | C 轨 |
| `templates/*` | 产品写法样例 | C + 设计 |
| `stress/workbench-proposal.*` | **质量压测**（多文件 + 交互） | C 轨回归 |
| `shared/*` | 跨 entry 本地 helper（非 canvas 入口） | C 轨 |
| `fixtures/live-modules/*` | 单测专用，不进产品打开路径 | 单测 |

新增能力时：

1. 先补 **单测或 fixtures**  
2. 再让 **压测 Demo** 用到该能力（否则 Demo 会过时）  
3. 最后才扩 templates  

---

## 8. 已知缺口（验证时勿误判为「全坏」）

| 现象 | 解读 |
|---|---|
| import 宿主深层 `src/**` 失败 | 常因 Provider / 非 React 依赖；非 v1 关门 |
| 无 CSS / Tailwind 扫描 | C3.5 有意不做 |
| home Library / 创建 UX | P 轨产品面，不在 C 轨 |
| `react-dom/server` 被拒 | 浏览器管道有意拒绝 |

---

## 9. 一次最短验收（15 分钟）

1. 跑 §1 单测  
2. `pnpm dev` 打开压测 Demo §2-E  
3. 点交互确认数字变化  
4. 做一次 §3 负例  
5. 做一次 §4 热更新观察  
6. 在 §6 评分卡打分并记下日期  

把结果记在 PR 或 issue 即可；不必每次写长文。
