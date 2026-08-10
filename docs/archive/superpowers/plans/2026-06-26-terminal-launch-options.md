# Terminal 启动参数实现计划

> 给 agent 执行时使用：按 checkbox 逐项推进；修改行为前先补回归测试。

**目标：** 支持 `terminal.open` 启动参数 `cwd`、`env`、`profileId`、`command` 从 CLI 到 renderer command、terminal IPC、native Ghostty surface 创建链路贯通。

**结构：** public command 允许携带 `TerminalLaunchOptions`。main command route 负责解析 `profileId` 并生成只包含真实启动参数的 resolved launch；main 内存 registry 持有完整 launch，renderer 只持有 `launchId` 和展示用 context，避免把 `env` 写入 dockview layout。terminal IPC 用 `launchId` 回到 main 取参数，native 只接收会影响 surface 创建的 `cwd`、`env`、`command`。

**profile 解析：** 内置 `default` profile 默认不做覆盖。自定义 profile 从 `userData/terminal-profiles.json` 读取，格式为 `{ "profiles": { "<id>": { "command": "...", "cwd": "...", "env": { "KEY": "VALUE" } } } }`。CLI 可通过 `pier terminal profiles list|get|set|delete` 管理 profile。未知 profile 会返回 `invalid_command`，不会静默降级。

---

## 任务 1：共享合约和 CLI 解析

**文件：**
- 新建：`src/shared/contracts/terminal-launch.ts`
- 修改：`src/shared/contracts/commands.ts`
- 修改：`src/shared/contracts/renderer-command.ts`
- 修改：`src/shared/contracts/terminal.ts`
- 修改：`src/main/adapters/cli/cli-parser.ts`
- 修改：`bin/pier.mjs`
- 测试：`tests/unit/app-core/cli-adapter.test.ts`
- 测试：`tests/unit/app-core/cli-bin.test.ts`
- 测试：`tests/unit/shared/panel-contract.test.ts`

- [x] 增加 `TerminalLaunchOptions` schema，支持 `cwd`、`env`、`profileId`、`command`。
- [x] 增加 resolved launch schema，native 只接收 `cwd`、`env`、`command`。
- [x] 给 public Pier command schema 增加 `terminal.open`。
- [x] 给 renderer command schema 增加 `terminal.open`，只传 `launchId`、context 和路由字段。
- [x] 给 `CreateTerminalArgs` 增加 `launchId`。
- [x] 解析 `pier terminal open --cwd <path> --profile <id> --env KEY=VALUE -- <command...>`。
- [x] 解析 `pier terminal profiles list|get|set|delete`，支持用 `--cwd`、`--env`、`--command` 或 `-- <command...>` 写入 profile。
- [x] 修复 `--` 边界：`--` 后的 `--no-focus`、`--json`、`--print-envelope` 都保留给用户命令。
- [x] 保持 `pier open <path>` 行为不变。

## 任务 2：main command route、profile 和 launch registry

**文件：**
- 新建：`src/main/state/terminal-launch-state.ts`
- 新建：`src/main/state/terminal-profile-state.ts`
- 新建：`src/main/services/terminal-profile-service.ts`
- 修改：`src/main/app-core/app-core.ts`
- 修改：`src/main/app-core/command-router.ts`
- 修改：`src/main/app-core/panel-commands.ts`
- 修改：`src/main/app-core/permissions.ts`
- 修改：`src/main/services/renderer-command-service.ts`
- 测试：`tests/unit/app-core/command-router.test.ts`
- 测试：`tests/unit/app-core/renderer-command-service.test.ts`
- 测试：`tests/unit/main/terminal-launch-state.test.ts`
- 测试：`tests/unit/main/terminal-profile-state.test.ts`

- [x] 增加 main 内存 launch registry，支持 `register`、`read`、`consume`、`discard` 和 TTL 清扫。
- [x] 在 renderer command 失败或抛错时清理 launch，避免 `env/command` 长期驻留内存。
- [x] 增加 profile service，在注册 launch 前把 `profileId` 解析成实际 `cwd/env/command`。
- [x] 增加 profile CRUD command：`terminal.profile.list/read/upsert/delete`。
- [x] profile CRUD 通过 main service 持久化到 `terminal-profiles.json`。
- [x] 未知 profile 明确失败，不注册 launch，不发送 renderer command。
- [x] 实现 `terminal.open` route：解析 cwd context，注册 launch，发送 renderer `terminal.open`。
- [x] 保持焦点语义：默认聚焦，`focus:false` 保持后台打开。
- [x] 保持 `panel.open` 行为不变。

## 任务 3：renderer workspace 和 terminal panel

**文件：**
- 修改：`src/renderer/stores/workspace.store.ts`
- 修改：`src/renderer/components/workspace/workspace-host.tsx`
- 修改：`src/renderer/panel-kits/terminal/terminal-panel.tsx`
- 测试：`tests/component/terminal-panel-lifecycle.test.tsx`
- 测试：`tests/component/workspace-host.test.tsx`
- 测试：`tests/unit/renderer/stores/workspace-store-terminal-cwd.test.ts`

- [x] `addTerminal` 支持 `launchId`。
- [x] panel params 只保存 context 和 `launchId`。
- [x] renderer `terminal.open` 创建带 `launchId` 的 terminal panel。
- [x] `window.pier.terminal.create` 传递 `launchId`。
- [x] 保持隐藏 panel 懒创建、恢复和焦点逻辑。

## 任务 4：terminal IPC 和 native bridge

**文件：**
- 新建：`src/main/ipc/terminal-create-launch.ts`
- 修改：`src/main/ipc/terminal.ts`
- 修改：`src/main/ipc/terminal-native-addon.ts`
- 修改：`native/src/addon.mm`
- 修改：`native/Sources/GhosttyBridge/GhosttyBridge.swift`
- 修改：`native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Surface/TerminalSurfaceOptions.swift`
- 修改：`native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Controller/TerminalController+Surface.swift`
- 修改：`native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Debug/TerminalDebugLog.swift`
- 测试：`tests/unit/main/terminal-create-launch.test.ts`
- 测试：`tests/unit/main/terminal-focus.test.ts`
- 测试：`tests/unit/main/terminal-panel-id-scoping.test.ts`

- [x] terminal IPC 通过 `launchId` 读取 main registry。
- [x] 恢复已有 terminal session 时，saved context 覆盖 launch cwd。
- [x] 恢复已有 terminal session 时，不重放一次性 `command/env`。
- [x] native addon 只解析 resolved launch 的 `cwd`、`command`、`env`。
- [x] Swift 只把 `workingDirectory`、`command`、`env` 写进 Ghostty per-surface config。
- [x] 移除 native `profileId` 字段，避免无效字段参与 surface 比较。
- [x] 同 panel reload 继续复用已有 terminal，不重放启动参数。
- [x] debug summary 只输出 env 数量，command 做截断输出。

## 任务 5：验证

- [x] 红测：新增启动参数回归测试后，相关测试按预期失败 8 项。
- [x] 红测：新增 profile 管理回归测试后，相关测试按预期失败 4 项。
- [x] 相关测试：`pnpm test:unit -- tests/unit/app-core/cli-adapter.test.ts tests/unit/app-core/cli-bin.test.ts tests/unit/app-core/command-router.test.ts tests/unit/app-core/renderer-command-service.test.ts tests/unit/shared/panel-contract.test.ts tests/unit/main/terminal-create-launch.test.ts tests/unit/main/terminal-focus.test.ts tests/unit/main/terminal-launch-state.test.ts tests/unit/main/terminal-profile-state.test.ts tests/unit/main/terminal-panel-id-scoping.test.ts tests/unit/renderer/stores/workspace-store-terminal-cwd.test.ts tests/component/terminal-panel-lifecycle.test.tsx tests/component/workspace-host.test.tsx`
- [x] 相关测试结果：88 个 test file、426 个测试通过。
- [x] `pnpm typecheck` 通过。
- [x] `CI=true pnpm build:native` 通过。
- [x] `pnpm check` 通过；只有文件大小 soft cap 提示，hard cap 通过。
