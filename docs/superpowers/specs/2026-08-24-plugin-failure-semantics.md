# 插件失败语义契约（Failure Semantics Matrix）

- 状态: 已实施（矩阵每格有测试锁定）
- 日期: 2026-08-24
- 范围: 官方插件（builtin + managed external）在 renderer 与 main 两侧的失败行为
- 关联: `docs/superpowers/specs` 插件机制路线图 Phase 1.2；AGENTS.md「插件边界是纪律边界」

## 目的

把"插件出错时会发生什么"从隐式机制变成显式契约：每一格行为都有对应测试
锁定，防止重构时悄悄丢失"单个插件故障不扩大爆炸半径"这条底线。

## 失败矩阵

| # | 故障位置 | 用户看到 | 系统行为 | 锁定测试 |
|---|---|---|---|---|
| F1 | 外部插件**面板组件渲染抛错** | 仅该面板显示"插件面板已崩溃"错误态 | `PluginPanelErrorBoundary` 局部截住；其余面板与工作台不受影响 | `tests/unit/renderer/plugin-panel-boundary.test.tsx` |
| F2 | 外部插件 **main activate 抛错** | 该插件不出现 | runtime 内部清理 RPC/disposer 并上报激活结果；reconciler **继续激活后续插件**，不中断循环 | `tests/unit/main/app-core/managed-plugin-runtime-reconciler.test.ts`（failure 用例）|
| F3 | 插件 **RPC handler 抛错** | 调用方收到 `internal_error` 响应 | rpc-bus 捕获并回传错误，进程不受影响 | `src/main/plugins/rpc-bus.ts`（既有 catch 路径）|
| F4 | 插件 **renderer 模块加载超时/挂起** | 面板显示不可用/加载态 | `loadExternalModuleWithTimeout`（10s 默认）超时放弃；激活队列代次签名防止旧代次复活 | `src/renderer/lib/plugins/runtime/index.ts` |
| F5 | 禁用/重载时 **disposer 卡住或抛错** | 操作完成后 UI 正常 | main 授权销毁 + drain/retry 协调器吞掉 wait 异常后重试；操作日志留痕 | `src/renderer/lib/plugins/runtime/drain-retry.ts`、`main-disposal-authorizations.ts` |
| F6 | manifest 解析失败 | 插件不出现在列表（诊断可见） | 进入 `list().diagnostics`；workspace.plan 同样可见——被拒绝也是"将要发生什么"的一部分 | plugin-service 测试 + plan 测试 |

## 不变量（Invariants）

1. **爆炸半径单面板化**：renderer 中任何插件代码抛错，不得导致 App 级
   ErrorBoundary（整页错误屏）接管。
2. **激活互不阻断**：一个插件 activate 失败，不得影响同批其它插件的激活。
3. **回收对称**：activate 成功后注册的一切资源，dispose 时必须被尝试回收；
   回收失败只记日志，不向上抛。
4. **诚实呈现**：所有失败路径必须对用户可感知（面板错误态 / 设置页诊断），
   禁止静默吞掉。

## 维护规则

- 新增插件生命周期钩子时，必须在本矩阵补一行并配测试。
- 本文件由治理视角维护；修改矩阵而不改测试（或反之）应在 review 中拒绝。
