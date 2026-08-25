# Live Modules 多框架验收清单

日期：2026-07-26  
相关：设计规格 §1.3；files 预览模式；样例 `.pier/canvases/smoke/hello.canvas.*`

## 0. 架构（当前）

| 层 | 职责 |
|---|---|
| files | 打开 `.pier/canvases/*`，source/preview 切换，文件树 |
| main Live Modules | 按后缀选型框架、编译、围栏、ticket、watch |
| React | 宿主单例 + `pier/canvas` |
| Vue / Solid / Svelte | 项目内框架包编入 bundle；注入或手写 `mount(el)` |

**一文件一框架。** 自定义组件 = 项目源码 import（围栏内）。

## 1. 后缀选型

| 后缀 | 框架 |
|---|---|
| `*.canvas.tsx` / `*.canvas.jsx` | React |
| `*.canvas.vue` | Vue 3 |
| `*.canvas.solid.tsx` / `*.canvas.solid.jsx` | Solid |
| `*.canvas.svelte` | Svelte |

必须位于 **`.pier/canvases/`** 下。

## 2. 自动化

```bash
pnpm exec vitest run \
  tests/unit/main/live-modules-frameworks.test.ts \
  tests/unit/main/live-modules-service.test.ts \
  tests/unit/shared/live-module-canvas-path.test.ts \
  tests/unit/plugins/files-language-detection-canvas.test.ts
```

- [ ] 全部通过（含 Vue/Solid/Svelte 样例编译）

## 3. 真机（`pnpm dev`）

| # | 打开路径 | 预期 |
|---|---|---|
| R | `.pier/canvases/smoke/hello.canvas.tsx` | files 外壳 + 默认预览 + 可切源码 |
| V | `smoke/hello.canvas.vue` | 预览可点 Count |
| S | `smoke/hello.canvas.solid.tsx` | 预览可点 Count |
| Sv | `smoke/hello.canvas.svelte` | 预览可点 Count |
| X | `src/foo.tsx` 或 `src/x.canvas.tsx` | **不是** canvas language |

- [ ] R / V / S / Sv 预览成功  
- [ ] 源码切换正常  
- [ ] 文件树仍是 files 侧栏（无第二套 canvas 目录）  

## 4. 自定义组件（各框架）

- [ ] React：相对路径或 `@/` 引入项目组件（fixture / 业务浅组件）  
- [ ] Vue/Solid/Svelte：同围栏内引入项目组件（需该框架组件）  
- [ ] 非 React 引用 `pier/canvas` → 应失败并提示 React-only  

## 5. 依赖说明

本仓 dogfood 已在 **devDependencies** 安装：`vue`、`@vue/compiler-sfc`、`solid-js`、`svelte`。  
用户项目需自备对应依赖；缺失时 compile diagnostic 会提示安装命令。

## 6. 非目标（本清单不验收）

- 完整复刻各框架 Vite 插件生态  
- 宿主提供 Vue/Solid UI kit（仅 React `pier/canvas`）  
- 同一 canvas 混多框架  
- Library / 创建对话框（P 轨）  
