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

内置插件与宿主 renderer 同 realm 运行（静态 import，无隔离）；capability 断言（`assertPluginCapability`）与
manifest 声明校验是工程纪律，靠 depcruise + 包扫描测试维持，不构成对恶意代码的防护——main 侧
`authorizeCommand` 按 client-kind 授权，不区分插件身份。当前前提：**仅允许 builtin 插件**。引入第三方
插件前必须先设计真正的隔离（独立 realm/进程 + main 侧按插件主体授权），不得直接放开加载路径。

### 宿主弹窗使用规范

宿主级确认/提示弹窗统一走 `src/renderer/components/common/app-dialog-host.tsx`：

- 业务代码不要直接 import `@pier/ui/alert-dialog.tsx`；宿主 renderer 使用 `showAppConfirm` / `showAppAlert`，插件使用 `RendererPluginContext.dialogs`。
- 短确认弹窗必须显式传 `size: "sm"`，例如退出确认、打开 Review、删除/撤销/丢弃类确认。
- 只有需要承载较长说明、错误详情或复杂内容的弹窗才显式传 `size: "default"`。
- 破坏性确认必须显式传 `intent: "destructive"`，普通确认显式传 `intent: "default"`；不要在 `AppDialogHost` 里按标题、按钮文案或业务字符串猜测危险程度。
- `showAppAlert` 可保持默认尺寸，用于错误详情时避免把长输出塞进小弹窗；短 alert 如需小尺寸应由调用方显式传 `size: "sm"`。
- 检查点在 `tests/unit/renderer/app-dialog-governance.test.ts`：锁定文档存在、禁止绕过 `AppDialogHost` 直接使用 shadcn `AlertDialog` primitive，并要求 confirm API 的 `size` / `intent` 保持必填。

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
