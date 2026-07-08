# Pier Agent Context

本文件是开发 Pier 时给 Claude Code、Codex 和 OpenCode 共用的项目级上下文。

## 01 项目定位

Pier 是本地 AI 开发工作台。参考 loomdesk 产品形态，使用 bay 的工具链栈重写。

- 核心能力：稳定终端、dockview panel 布局、代码变更预览、文件查看、多 agent 状态可见性。
- 不做：任务生命周期、SQLite 任务台账、看板、自动调度。
- 持久化分层：用户偏好/布局写 userData JSON；原始终端输出写 transcript 分段文件；代码变更实时读 Git；密钥走 safeStorage。

## 02 技术栈

- Electron 42 · React 19 · TypeScript 6 strict
- electron-vite 5 + Vite 8（main / preload / renderer 三端）
- dockview-react 6.6.1（panel 布局核心：tab + split + floating + drag）
- Tailwind CSS v4 + shadcn primitives
- Zustand 5（client state）
- Biome 2.5 + Ultracite（lint + format 单工具栈）
- pnpm 10
- Vitest 4 + Playwright（测试）

## 03 架构边界

进程边界由 dependency-cruiser 守护：

- `main/` ⊥ `renderer/`（双向禁止）
- `preload/` 只可 import `shared/` + `electron`
- `main/` 内 L1 持久化 ⊥ L2/L3/L4（单向依赖）
- **renderer 业务代码不可直接 import dockview**，必经 `components/workspace/` 边界
- renderer 不同 panel-kits 不跨域 import（走 `components/common` 或 `stores`）
- `src/plugins/builtin/*` 只可 import `src/plugins/api` + `src/shared` + `packages/ui`；宿主只在两个 builtin-catalog 处 import 插件包

### 插件边界是纪律边界，不是安全边界

内置插件与 v1 官方受管理外部插件都属于可信代码：renderer 与宿主同 realm 运行，external main
是普通 Node ESM，可访问 Node 能力。capability 断言（`assertPluginCapability`）、manifest 声明校验、
插件 RPC 的 `pluginId` 作用域和包扫描测试都是工程纪律边界，不构成对恶意代码的防护——main 侧
`authorizeCommand` 当前按 client-kind 授权，不区分插件主体身份。

当前只允许两类插件：

- `src/plugins/builtin/*` 内置插件。
- 官方 bundled / official managed external plugin（例如 `pier.codex`），必须经受管理安装索引、签名官方索引、包校验、不可变版本目录和启动时运行态快照加载。

dev override 只允许开发/测试运行时使用；生产包默认不显示入口、命令返回拒绝结果，即使历史 `index.json` 中已有 dev override 也必须忽略本地路径，并且不得把本地目录标记为官方来源。不得开放第三方插件、任意 registry、任意 git/local 扫描或 marketplace 加载路径。引入第三方插件前必须先设计真正隔离：独立 realm/进程、每插件主体身份、main 侧按插件主体授权、最小权限 host API、供应链签名与回滚策略。

### 宿主弹窗使用规范

宿主级确认/提示弹窗统一走 `src/renderer/components/common/app-dialog-host.tsx`：

- 业务代码不要直接 import `@pier/ui/alert-dialog.tsx`；宿主 renderer 使用 `showAppConfirm` / `showAppAlert`，插件使用 `RendererPluginContext.dialogs`。
- 短确认弹窗必须显式传 `size: "sm"`，例如退出确认、打开 Review、删除/撤销/丢弃类确认。
- 只有需要承载较长说明、错误详情或复杂内容的弹窗才显式传 `size: "default"`。
- 破坏性确认必须显式传 `intent: "destructive"`，普通确认显式传 `intent: "default"`；不要在 `AppDialogHost` 里按标题、按钮文案或业务字符串猜测危险程度。
- `showAppAlert` 可保持默认尺寸，用于错误详情时避免把长输出塞进小弹窗；短 alert 如需小尺寸应由调用方显式传 `size: "sm"`。
- 检查点在 `tests/unit/renderer/app-dialog-governance.test.ts`：锁定文档存在、禁止绕过 `AppDialogHost` 直接使用 shadcn `AlertDialog` primitive，并要求 confirm API 的 `size` / `intent` 保持必填。

### 操作反馈规范

所有用户触发的动作必须有可识别的完成或失败信号，静默失败（`catch (err) { console.error(...) }` 就结束）一律禁止。选择反馈方式时按以下顺序判断，防止漏报也防止重复：

- 已经有**强自然 UI 反馈**（列表新增/删除、导航切换、Modal 关闭、面板打开、表单值即时更新等）→ **不再加 toast**；重复反馈是噪声。
- 只有**弱 UI 反馈**（Save 按钮从 enabled → disabled、dirty 位清零等）或**完全无 UI 反馈**（写盘、无 refetch 的写请求、后台任务触发） → 成功走 `toast.success(t("..."))`。
- 任何可能失败的分支 → 必须 `toast.error(t("...Failed"), { description: err instanceof Error ? err.message : String(err) })`。`console.error` 不面向用户，只能作为额外日志。
- Toast 复用 `sonner`；宿主代码从 `sonner` 直接 `import { toast }`，插件走 `context.notifications.{success,error}`；文案必须走 i18n key，禁止内联字符串。

**代码审查检查点**：
- 每个 `onClick` / `onSubmit` / async mutation 都要能回答"用户怎么知道刚才发生了什么"。答不出 → finding。
- 遇到 `catch` 里只有 `console.error` / `console.warn` 而没有 `toast.error` → finding，除非注释里明确说明不面向用户的路径（如启动阶段 boot log）。
- 遇到"有明显 UI 变化 + 又加了 toast"的双反馈 → minor finding，建议删掉冗余 toast。
- 遇到内联 toast 文案字符串（未走 i18n） → finding。

### 前台活动模块 `src/main/services/foreground-activity/`

统一 agent / task / shell / idle 四态活动聚合器：

- 契约在 `src/shared/contracts/foreground-activity.ts`（`ForegroundActivity` discriminated union）
- broadcast 通道 `pier://foreground-activity:changed` 是 renderer 侧 canonical UI 状态源
- 双源迁移已完成：老 `agent-session` broadcast 已下线，此通道是唯一活动广播源
- 模块内不 import `services/agents/`（agent 只是 activity 的一种 kind，边界单向）

### 路径锚点上下文 `src/main/services/panel-context-resolver.ts` + `src/shared/contracts/panel.ts`

- `PanelContext.projectRootPath` 是当前工作区路径锚点：Git 项目优先为 `gitRoot`，非 Git 目录为 `cwd`。
- `contextId` 由 `worktreeKey` 稳定派生，用于面板上下文身份；任务、终端和插件上下文不再依赖额外 `projectId`。
- 主体不维护 `Project` 注册表，也不把 `projectId` 作为跨模块外键；需要项目粒度能力时优先使用 `projectRootPath` / `gitRoot` / `worktreeRoot`。

### 账号域模块迁移：`src/main/services/agent-accounts/` → `pier.codex`

迁移前，宿主 `src/main/services/agent-accounts/` 仍负责多 AI agent 账号的 CRUD、凭据托管与用量轮询：

- 契约在 `src/shared/contracts/agent-accounts.ts`（`AgentAccountsSnapshot` 全量快照）
- 广播通道 `pier://agent-accounts:changed` 是 renderer 侧镜像 store 的唯一数据源
- 模块内不 import `services/agents/`（账号是独立域，与 agent 集成层单向隔离，对齐 foreground-activity 先例）
- capability 门控：`account:read` / `account:write`；`desktop-renderer` 两者皆有，`cli-local` 仅 `account:read`
- 插件经 `context.accounts` facade 消费（读路径走 renderer 镜像 store，写路径走 `window.pier.accounts`）

本分支的目标终态是把 Codex 账号域迁入官方 `pier.codex` managed external plugin，并删除宿主
`agent-accounts` service、`window.pier.accounts`、`RendererPluginContext.accounts`、`account:*`
capability 和 `accounts.*` 命令。迁移完成后，Codex 账号状态是插件私有域：renderer 通过插件 RPC
读取快照和订阅事件，宿主只提供插件运行、密钥、安全持久化、路径和进程环境等通用能力。

### Managed 官方外部插件模块 `src/main/services/managed-plugins/`

受管理官方插件的安装底座（本分支交付）：

- 契约在 `src/shared/contracts/managed-plugin.ts`
- 签名根：Ed25519 公钥硬编码在 `official-index.ts.OFFICIAL_PLUGIN_INDEX_PUBLIC_KEYS_BY_ID`；索引 canonical JSON + 签名校验先于 strict schema
- 安装路径固定 `{userData}/plugins/{index.json,installed/<id>/<version>,staging,work/<id>}`；`installed/<id>/<version>` 不可变；staging → temp sibling → atomic rename
- 生产环境无条件忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 和持久化的 `devOverride` 路径
- 命令授权走 `CommandMetadata.allowedClientKinds`：`plugin.catalog.list` 允许 `desktop-renderer` + `cli-local`；其它 managed 命令 + `app.relaunch` 只允许 `desktop-renderer`
- 插件 RPC 走独立 IPC 通道（`PIER.PLUGIN_RPC_INVOKE`），不进 `PierCommand`、不经 CLI local-control

### 指挥中心组件贡献点 `missionControlWidgets`

插件可经 manifest `missionControlWidgets` 声明 + renderer 运行时 `context.missionControlWidgets.register` 注册指挥中心卡片组件：

- 纪律链与 `panels` / `terminalStatusItems` 一致：`assertDeclaredContribution("missionControlWidget")` → 运行时注册表 → 宿主容器渲染
- 注册表在 `src/renderer/lib/plugins/plugin-mission-control-widget-registry.ts`（镜像 `plugin-panel-registry.ts` 结构）
- Core-owned widget 走 `CORE_MISSION_CONTROL_WIDGETS` 静态声明（平行于 `CORE_TERMINAL_STATUS_ITEMS`），不经插件通道
- 指挥中心 panel 为 core panel kit（`component: "mission-control"`，多实例 `mission-control-<uuid>`），组装状态存 dockview panel params 随 layout 持久化
- 网格几何：格子像素恒定（`CELL_WIDTH = 88`），面板宽度只决定可用列数 k；k<12 时按阅读序
  first-fit 派生排布（`deriveLayout`），派生结果不持久化——持久化的 `widgets` 数组始终是
  12 列基准布局。widget 内容响应一律用 container query（卡片 `CardContent` 已开
  `@container`），不要依赖 `size` prop 换算像素。注意 containment 会让 `position: fixed`
  后代以卡片内容区为包含块——浮层一律走 portal（Radix 组件默认如此）。

## 04 项目命令

- 安装依赖：`pnpm install`
- Electron 桌面开发：`pnpm dev`（或 `pnpm electron:dev`）
- 类型检查：`pnpm typecheck`
- Lint + Format：`pnpm lint` / `pnpm lint:fix`
- 完整检查：`pnpm check`（typecheck + lint + depcruise + file-size + unit + component 测试）
- 单元测试：`pnpm test` / `pnpm test:unit`；组件测试：`pnpm test:component`
- E2E 测试：`pnpm test:e2e`
- 构建：`pnpm build`（electron-vite build）
- 图标重建：`pnpm build:icons`（改 `build/app-icon-*.svg` 后跑一次，产出 `build/icon.{icns,ico,png}`）

### 新机首次 clone → dev 一键：`pnpm bootstrap`

`scripts/bootstrap.sh` 会依次预检 & 安装依赖，然后调 `setup:worktree`：

```bash
git clone <repo> && cd pier
pnpm bootstrap        # 预检 Xcode CLI / brew / zig@0.15 / pnpm / node → pnpm install → setup:worktree
pnpm dev              # 起 Electron dev
```

CI / 无交互场景：`BOOTSTRAP_YES=1 pnpm bootstrap` 缺依赖直接自动装。

### 已有 worktree 首次启动 checklist

git worktree **不复制** `node_modules` 也不复制 `native/build/`。第一次进 worktree 必须先：

```bash
pnpm setup:worktree   # 软链 node_modules → 主仓 + 补 GhosttyKit.xcframework + 编译 native addon
pnpm dev              # 否则 panel 内会报 "Cannot find module .../ghostty_native.node"
```

`setup:worktree` 内部：

1. 软链 `node_modules` 到主仓（避免每次 worktree 都 `pnpm install`）
2. 若 `native/Vendor/libghostty-spm/GhosttyKit.xcframework/` 缺失（首次 clone / 新电脑）自动跑 `pnpm build:libghostty`——**首次约 3-5 分钟**（含 fetch ghostty 上游、apply patches、跨 arch build），后续增量 60-90s
3. native addon（`ghostty_native.node` + `libGhosttyBridge.dylib`）过期则重编，约 30s

`pnpm build:libghostty` 依赖：
- `brew install zig@0.15`（硬要求 zig 0.15.2）
- `xcode-select --install`

产出：`native/Vendor/libghostty-spm/GhosttyKit.xcframework/` universal（arm64 + x86_64）。xcframework 二进制不入库；patches 在 `native/Vendor/libghostty-spm/Patches/ghostty/` 下按 `0100-` 起编号（Lakr233 的 `0001-0010` 由 `.libghostty-spm-src/` 里的仓提供）。

`pnpm dev` 的 `predev` 阶段也已加 native addon 存在性守卫，缺了会清楚提示去跑 `pnpm setup:worktree`，不会进 Electron 后才在 panel 内炸。

### 打包分发（`pnpm build:dist`）

`build:dist` 走 `scripts/build-dist.sh`：加载 `electron-builder.env` → `NATIVE_ARCHS="arm64 x86_64" pnpm build:native` → `pnpm build:electron` → `electron-builder --mac --arm64 --x64 --publish never`。

- **native 分层**：`libGhosttyBridge.dylib` 和 `ghostty_native.node` 逐 arch 编译再 `lipo -create` 成 universal fat（GhosttyKit.xcframework 本身已 universal）。dev 不打 dist 时 `pnpm build:native` 默认只编 host arch，快。
- **electron-builder**：`electron-builder.yml` mac target `arch: [arm64, x64]`，产出两个 dmg（`Pier-<ver>-arm64.dmg` + `Pier-<ver>.dmg`）。universal native 二进制两份 dmg 都能吃。
- **产物**：`dist-builder/` 下的两个 dmg。Apple Silicon 用户下 `-arm64.dmg`，Intel 用户下不带 arch 后缀那个（electron-builder 对 x64 dmg 默认不带 suffix）。
- **首次约 30 分钟**（native 85s + electron-vite 5s + 每 arch rebuild/pack/sign/notarize 各 ~15 分钟串行）；之后增量 ~20 分钟。
- **只签名不 notarize**（本机测/CI 无 notarize 凭证）：`pnpm build:dist --no-notarize`。

#### 新机器上首次打包 checklist

`pnpm bootstrap` 只解决**编译依赖**（zig / Xcode CLI / pnpm / native addon）；签名 + notarize 凭证得手动补：

1. **签名证书**（`Developer ID Application`）：
   - 源机 Keychain Access → 找证书 → 右键 Export → `.p12`（设导出密码）→ 传目标机 → 双击导入。
   - 或去 Apple Developer 后台各自申请（Team ID 会变）。
   - 验证：`security find-identity -v -p codesigning` 能看到 `Developer ID Application: ...` 一行。
2. **notarize keychain profile**：
   ```bash
   xcrun notarytool store-credentials pier-notarize \
     --apple-id "<your-apple-id>" \
     --team-id <TEAM_ID>
   # 交互式提示 Password，粘贴 app-specific password（appleid.apple.com 生成，可重用）
   ```
   验证：`xcrun notarytool history --keychain-profile pier-notarize` 不报 profile 缺失即可。
3. **`electron-builder.env`**（gitignored，每台机各建）：
   ```
   APPLE_KEYCHAIN_PROFILE=pier-notarize
   APPLE_TEAM_ID=<TEAM_ID>
   ```
   `<TEAM_ID>` 换成签名证书括号里的 10 位。
4. `pnpm build:dist`。
## 05 安全边界

- Git 默认只读。除非用户明确要求，不创建 commit、分支、PR 或 push。
- 需要 commit 时，先 stage 明确路径，展示 `git diff --staged` 和拟用 Conventional Commits message，等待用户确认。
- 禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend` 和 force-push。
- 不要用 `@ts-ignore`、`@ts-expect-error` 或 `as any` 压制类型错误。
