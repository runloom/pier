# 智能体 CLI 运行环境一致性与失败友好提示 — 金标准

日期：2026-09-09
状态：现行权威（宿主发起的智能体 CLI 安装 / 更新 / 卸载）
范围：这些命令的环境来源、子进程工作目录、宿主 Node 事实的可见性、失败文案。
不包含：替用户升级 Node；智能体市场 / 版本托管；把第三方 stderr 归类成错误 taxonomy。

权威实现：[`host-node-runtime.ts`](../../../src/main/services/process-environment/host-node-runtime.ts)（宿主 Node 唯一生产者）、[`app-core/index.ts`](../../../src/main/app-core/index.ts)（`resolveAgentEnv`）、[`lifecycle/service.ts`](../../../src/main/services/agents/lifecycle/service.ts)（预检与失败事实）、[`lifecycle/node-requirement.ts`](../../../src/main/services/agents/lifecycle/node-requirement.ts)（`requiresNode` 判定）、[`runner/process.ts`](../../../src/main/services/agents/lifecycle/runner/process.ts)（子进程 `cwd`）、[`agent-lifecycle-format.ts`](../../../src/renderer/pages/settings/components/agent-lifecycle-format.ts)（失败文案）。
检查点：`tests/unit/main/agents/lifecycle/runtime-parity-governance.test.ts`。

---

## 一句话终态

宿主替用户跑的智能体 CLI 命令，与任务、终端走**同一份** `ProcessEnvironmentService.resolve`：带 `projectRootPath`，子进程 `cwd` 同该路径——用户项目里的 `.nvmrc` / direnv / mise 生效，不再是 HOME 里那份。宿主自己的事实（Node 版本与路径、探测到的安装位置）在设置页和失败弹窗里可见；声明了 Node 要求的智能体由宿主预检，失败给**带下一步**的文案。第三方输出照旧原样呈现，不做归因。

---

## 决策树

1. 宿主要跑一个智能体 CLI 命令（安装 / 更新 / 卸载）？→ 只经 `ProcessEnvironmentService.resolve({ source: "agent", projectRootPath })`，并把同一路径作为子进程 `cwd`。
2. 拿得到当前项目根（focused panel descriptor 的 `context.projectRootPath`）？→ 带上；拿不到（Pier Home）→ 不带，退回 HOME dump（与今日行为一致，不算回归）。
3. 想知道「Pier 用的是哪个 Node」？→ 只问 `process-environment/host-node-runtime.ts`（经 PES 暴露），不自己 spawn `node -v`。
4. 智能体官方声明了 Node 区间？→ 写进 spec 的 `requiresNode`；install / update 前预检，不满足返回 `node_requirement_unmet`。没声明 → 不检查。
5. 命令失败了？→ 失败结果带 `hostNode`（`version_unchanged` / `not_runnable` 另带 `installPaths`）；弹窗底部追加事实行。
6. 第三方 stderr 里写着 `requires Node` / `EBADENGINE`？→ **不解析**。原始输出仍由 `sanitizeProcessOutput` 原样呈现。

---

## 硬规则

### 1. 环境唯一入口

宿主发起的 CLI 命令只经 `ProcessEnvironmentService.resolve`，且与任务 / 终端同一入口：带 `projectRootPath`；子进程 `cwd` 同该路径。安装 / 更新 / 卸载的 argv、官方脚本、自定义 `shell` 步骤都要传这份 `cwd`。`wsl.exe` 的 Windows 进程工作目录不是发行版里的 Linux 目录，不要把宿主 `cwd` 传给它假装已经对齐。禁止第二套 PATH、禁止直接读 `process.env` 拼环境、禁止给 dump 之外的第二份 shell dump。

### 2. 没有项目根时不猜

`resolve` 未带 `projectRootPath` 时维持既有 HOME dump 行为：不猜目录、不补默认值、不用最近项目兜底。

### 3. Node 事实单一生产者

宿主 Node 运行时（路径 + 版本）唯一生产者在 `process-environment/host-node-runtime.ts`，只经 PES 暴露（`resolve` 诊断字段与 `hostNodeRuntime(env)`）。生命周期预检和失败事实必须探这次命令的 spawn env（`resolve` 合并结果），经 `hostNodeRuntime(env)` 传入；设置页 Node 行继续用 `resolve` 诊断（宿主 HOME dump）。无 env 时探最近一次 `resolve` 的合并结果，不得探 PES 构造期 `baseEnv` 快照。renderer / 插件 / 生命周期禁止各自 spawn 探测 Node 版本。

### 4. 探测纪律

- 不进登录 shell dump 命令（`shellEnvJsonCommand` 保持单一职责）。
- 按解析路径缓存；`invalidate()` 清空；失败结果仅短期抑制（30s）；版本 spawn 超时 2s。
- 输出必须是 `vX.Y.Z` 形状（这是我们自己的输出），否则视为探测失败。
- **任何异常都返回 `null`，绝不抛**：没有 Node 事实就退化为今日行为。

### 5. 设置页只读展示

设置 → 终端 ▸ Shell 环境 只多一行「Node 版本 + 绝对路径」；没有事实（Windows、dump 跳过、探测失败）整行不渲染。仍然不展示 dumpMode / 耗时 / PATH 差分等实现诊断。

### 6. 失败必须带事实

- `package_manager_missing` / `command_failed` 带 `hostNode`（安装、更新、卸载同一套）；弹窗可带清洗后的 stderr / 命令预览。
- `version_unchanged` / `not_runnable` 带 `hostNode` 与 `installPaths`（探测到的安装位置）；单条和批量都走弹窗底部追加事实行，不走短 toast。**不展示命令预览。**
- 声明了 `requiresNode` 的智能体，install / update 先做宿主预检；不满足返回 `node_requirement_unmet`（带 `requiredNode` + `hostNode`），runner 不启动。**不展示命令预览。**
- 批量失败：每个智能体一段说明（含该条的安装位置）；宿主 Node 事实**整窗底部一份**，不要每条重复。
- `cancelled` / `busy` / `timeout` 与运行时无关，不带事实。

### 7. 禁止归因第三方 stderr

不得匹配 `requires Node` / `detected Node` / `EBADENGINE` / `Unsupported engine` 之类文案做判断或改写；原始输出仍由 `sanitizeProcessOutput` 原样呈现。文案走 locale，禁止内联。

---

## 明确不做

- 替用户升级 / 安装 Node（`nvm install` 之类一律不由宿主执行）
- 智能体市场、版本托管、把 Node 版本管理做成产品能力
- 把第三方 stderr 归类成错误 taxonomy，或按错误码改写第三方文案
- 改登录 shell dump 命令、给 dump 加额外探测
- 在设置页暴露 PATH 差分、dump 耗时、dumpMode 等实现诊断
- 为「猜 Node 要求」给没有官方声明的智能体补 `requiresNode`

---

## 复发记录

- **2026-09-09 本机**：设置 → 智能体 ▸ 全部更新，OpenClaw 的 `npm` preinstall 因 Node 24.15.0 不满足 `>=24.16.0 <25 || >=26.1.0` 失败，宿主只能透传整段 npm stderr；Grok 的 `version_unchanged` 只说「可能仍在使用另一处安装」，不说探测到了哪些。根因是生命周期命令在 HOME dump、子进程不带 `cwd`，且宿主没有自己的运行时事实可展示。
