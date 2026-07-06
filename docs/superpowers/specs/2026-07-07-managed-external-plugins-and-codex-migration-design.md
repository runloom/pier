# Managed External Plugins 与 Codex 账号插件迁移设计

**日期**：2026-07-07  
**状态**：已确认设计，待实现计划  
**范围**：受管理的可信外部插件安装/更新体系、main/renderer 双入口 runtime、插件 RPC/Event Bus、Codex 账号域从宿主迁移到官方 external plugin

## 1. 背景与问题

当前 Pier 插件体系仍以 `src/plugins/builtin/*` 静态 import 为主。`local` / `git` / `registry` source 已出现在 manifest schema 中，但实际运行态只有 builtin 可执行，local 只是 manifest-only 预览。Codex 账号管理目前也作为 `src/plugins/builtin/codex` 内置插件接入，账号主体能力在宿主 `agent-accounts` service 中，插件只通过 `context.accounts` facade 消费。

这个模型有两个问题：

1. **Codex 账号管理不应继续伪装成 builtin 插件**。它是可选业务扩展，应验证真实插件安装、更新、启停和运行机制。
2. **仅扫描目录没有意义**。如果外部插件不是安装时加载、可更新、可回滚、可禁用，就只是把 builtin 换了目录，不能形成插件管理能力。

参考 Zed 的 extension 机制，本期采用“受管理安装包”思路：插件有安装态、版本态、更新态、加载态。考虑到 Pier 当前尚无第三方隔离 runtime，本期明确只做 **trusted external plugin v1**，不宣称安全沙箱。

## 2. 目标与非目标

### 目标

- 建立受管理插件安装体系：官方索引、GitHub Release 包、bundled seed、staging 验证、版本化 installed 目录、install index。
- 支持官方插件列表页：安装、更新提示、卸载、启用、禁用、检查更新。
- 支持 dev plugin override，方便开发本地外部插件。
- 支持 main + renderer 双入口 external plugin runtime。
- 支持外部插件贡献自定义 React UI：dockview panel、terminal status item、dashboard widget、commands、configuration。
- 支持插件 renderer ↔ main 的私有 RPC/Event Bus。
- 将 Codex 账号域完整迁入 `pier.codex` 官方 managed external plugin。
- 删除宿主 Codex 账号域 API：`agent-accounts` service、`window.pier.accounts`、`context.accounts`、`account:*` capability、`accounts.*` PierCommand。

### 非目标

- 不做第三方安全沙箱、iframe/webview 隔离、WASM runtime 或子进程隔离。
- 不做自动更新；只提示，用户手动更新。
- 不做热更新；更新后必须重启 Pier 生效。
- 不做 marketplace 搜索、评分、评论。
- 不做任意 git/registry 插件安装。
- 不做插件资源限制、强审计、策略引擎。
- 不做通用账号平台、模型 provider 平台、自动调度、任务 DAG、RAG/eval/知识库平台。

## 3. 架构原则

1. **trusted external，不是沙箱**：v1 插件 main 是普通 Node ESM，可直接使用 Node 能力；renderer 插件与宿主 React 同 realm 运行。UI 必须明确展示来源和风险。
2. **安装态由 Pier 管理**：安装来源、active version、enabled、sha256、pending update 都由 Pier 的 install index 记录，不信任插件 manifest 自报来源。
3. **版本目录不可变**：插件代码安装到 `installed/<id>/<version>`，运行时不覆盖 active 目录。
4. **staging 原子安装**：下载包先进入 staging，校验通过后再解包为新版本目录并更新 index。
5. **更新重启生效**：不处理 ESM module unload、React tree 热替换、main watcher/timer 在线迁移。
6. **Codex 默认可用**：`pier.codex` 作为官方 bundled external plugin，首次启动默认安装并启用，保持现有功能开箱即用。
7. **Core 只保留宿主能力**：终端、panel、Git/File API、workspace、plugin management、profile/secrets 等留在宿主；Codex-specific 账号逻辑迁入插件。

## 4. 插件包与安装目录

### 4.1 插件包格式

官方发布包是 `.tgz`。解包根目录必须包含：

```text
plugin.json
dist/main.js
dist/renderer.js
dist/assets/...
```

`plugin.json` 声明插件自身：

- `id`
- `name`
- `version`
- `apiVersion`
- `engines.pier`
- `main: "dist/main.js"`
- `renderer: "dist/renderer.js"`
- contributions：commands、panels、terminalStatusItems、dashboardWidgets、configuration
- `permissions`
- `localization`

`plugin.json` 不声明安装来源、active version、官方状态、更新策略或启用状态。

### 4.2 userData 目录结构

```text
{userData}/plugins/
  index.json
  installed/
    pier.codex/
      1.0.0/
        plugin.json
        dist/...
      1.1.0/
        plugin.json
        dist/...
  staging/
    <tmp>/
  work/
    pier.codex/
      ... plugin runtime data ...
```

- `installed/<id>/<version>` 是不可变代码目录。
- `staging` 存放下载、解包和校验中的临时文件。
- `work/<id>` 是插件运行数据目录，由 `context.paths.workDir` 暴露给插件。

### 4.3 install index

`index.json` 是插件安装态真相源。现有 `plugin-state.json` 的 enabled 状态应迁入此 index，避免双状态源。

示例：

```json
{
  "version": 1,
  "plugins": {
    "pier.codex": {
      "id": "pier.codex",
      "activeVersion": "1.0.0",
      "enabled": true,
      "source": {
        "kind": "official",
        "seededFromBundle": true
      },
      "installedVersions": {
        "1.0.0": {
          "installedAt": 123456,
          "sha256": "...",
          "packageUrl": "bundled://pier.codex/1.0.0"
        }
      },
      "pendingUpdate": null,
      "devOverride": null
    }
  }
}
```

## 5. 官方索引与 GitHub Releases

Pier 使用中央官方索引，索引中的包资产指向 GitHub Releases。插件 manifest 自带的 update URL 不参与更新决策。

示例：

```json
{
  "version": 1,
  "plugins": {
    "pier.codex": {
      "id": "pier.codex",
      "latest": "1.1.0",
      "displayName": "Codex",
      "description": "Codex account management and dashboard widgets for Pier.",
      "versions": {
        "1.1.0": {
          "pier": ">=0.1.0 <0.2.0",
          "assetUrl": "https://github.com/pier-plugins/codex/releases/download/v1.1.0/pier-codex-1.1.0.tgz",
          "sha256": "...",
          "size": 123456
        }
      }
    }
  }
}
```

GitHub Releases 只作为不可变包存储；版本选择、兼容性、hash 和官方状态由中央索引决定。

## 6. 安装、更新、卸载和 dev override

### 6.1 bundled seed 首次安装

`pier.codex` 随 app 带一个 bundled seed 包。启动时：

1. 读取 `{userData}/plugins/index.json`。
2. 如果 `pier.codex` 未安装，从 app resources 中的 seed 包安装。
3. 解包到 `installed/pier.codex/<seedVersion>`。
4. 写入 index：`enabled: true`、`source.kind: "official"`、`seededFromBundle: true`、`activeVersion: seedVersion`。
5. runtime 从 installed active version 加载插件。

### 6.2 更新提示与手动更新

1. 用户打开插件页或点击 Check for Updates。
2. Pier 拉取官方中央索引。
3. 选择与当前 Pier 兼容的最高版本。
4. 若高于 active version，插件页显示 Update available。
5. 用户点击 Update 后，下载 GitHub Release asset 到 staging。
6. 校验 size、sha256、tar path traversal、manifest schema、id/version、entry 文件、React peer/external 规范。
7. 解包到 `installed/<id>/<newVersion>`。
8. 更新 index 的 `activeVersion`，保留旧版本记录用于 rollback。
9. 提示用户重启 Pier 生效。

当前进程继续运行旧版本；不做热替换。

### 6.3 卸载

卸载官方插件时：

- 从 index 删除或标记 uninstalled，使下次启动不加载。
- 默认保留 `work/<id>` 用户数据。
- dashboard layout 中残留 widget 由宿主显示“插件未安装”占位卡。

### 6.4 Dev Plugin override

Dev 插件用于开发，不参与官方安装和更新。index 中登记本地目录：

```json
{
  "plugins": {
    "pier.codex": {
      "activeVersion": "1.0.0",
      "enabled": true,
      "source": { "kind": "official" },
      "devOverride": {
        "path": "/Users/xyz/dev/pier-codex-plugin",
        "registeredAt": 123456
      }
    }
  }
}
```

加载优先级：`devOverride` > installed activeVersion。

Dev 目录支持两种格式：

1. 预构建 dist：

```text
plugin.json
dist/main.js
dist/renderer.js
```

2. dev manifest：

```json
{
  "id": "pier.codex",
  "manifest": "plugin.json",
  "main": "http://localhost:43110/main.js",
  "renderer": "http://localhost:43110/renderer.js"
}
```

安装或移除 dev override 后默认提示重启生效。v1 不要求 HMR 或 reload-dev。

## 7. External plugin runtime

### 7.1 Main runtime

main runtime 根据 active install record 动态加载入口：

- official installed：`installed/<id>/<version>/<main>`
- dev override：本地目录或 dev URL

main 入口导出：

```ts
export const plugin: MainPluginModule = {
  id: "pier.codex",
  activate(context) {
    return () => {
      // cleanup
    };
  }
};
```

`MainPluginContext` 提供：

- `context.plugin.id`
- `context.paths.workDir`
- `context.paths.dataDir`
- `context.configuration`
- `context.rpc.handle(name, handler)`
- `context.events.emit(name, payload)`
- `context.events.on(name, cb)`
- `context.commands.register(command)`
- `context.logger`

v1 插件仍可直接使用 Node API；host API 负责生命周期、RPC、事件和宿主整合。

### 7.2 Renderer runtime

renderer 入口导出：

```ts
export const plugin: RendererPluginModule = {
  id: "pier.codex",
  activate(context) {
    return () => {};
  }
};
```

renderer context 在现有能力基础上新增：

```ts
rpc: {
  invoke<T>(name: string, payload?: unknown): Promise<T>;
  on<T>(event: string, cb: (payload: T) => void): () => void;
}
```

renderer 插件可继续注册：

- `context.actions.register`
- `context.panels.register`
- `context.terminalStatusItems.register`
- `context.dashboardWidgets.register`
- `context.overlays.open`
- `context.dialogs`
- `context.files` / `context.git` / `context.worktrees` / `context.ai` 等宿主 facade

### 7.3 RPC/Event Bus

RPC 自动按 pluginId 命名空间隔离。插件 renderer 默认只能调用同 pluginId main handler。

main：

```ts
context.rpc.handle("accounts.snapshot", async () => snapshot);
context.rpc.handle("accounts.add", async () => addAccount());
```

renderer：

```ts
await context.rpc.invoke("accounts.add");
```

事件：

```ts
context.events.emit("accounts.changed", snapshot);
context.rpc.on("accounts.changed", setSnapshot);
```

main emit 后，host 广播到所有 renderer windows；renderer runtime 只分发给同 pluginId 的 active plugin instance。

### 7.4 React 加载规范

外部 renderer 插件允许自定义 React UI，但必须满足：

- `react` / `react-dom` 必须 external，不可打入插件 bundle。
- `@pier/ui` 推荐 external，由宿主提供同版本。
- `lucide-react` 推荐 external。
- 插件不能 import `src/renderer/*` 或 `src/main/*`。
- 插件只通过 `@pier/plugin-api` 和 `@pier/ui` 消费宿主能力。
- 插件 CSS 需要命名空间化，禁止全局 reset。

应提供 `@pier/plugin-api` 包和插件 build preset，统一处理 peer/external 依赖。

### 7.5 错误收敛

- main activate try/catch；失败写 diagnostics，插件 runtime disabled。
- renderer activate try/catch；失败写 renderer diagnostics。
- panel/dashboard widget 包 ErrorBoundary。
- dispose try/catch，避免一个插件卸载失败阻断其它插件。
- RPC handler 异常转为 structured error 返回 renderer。

## 8. Codex 账号插件迁移

### 8.1 删除宿主 Codex 账号域

宿主 core 删除：

- `src/main/services/agent-accounts/*`
- `src/main/state/agent-accounts-state.ts`
- `window.pier.accounts`
- `RendererPluginContext.accounts`
- `account:*` capability
- `accounts.*` PierCommand
- `src/renderer/stores/agent-accounts.store.ts`

### 8.2 Codex 插件结构

`pier.codex` external plugin 包内包含：

```text
plugin.json
dist/main.js
dist/renderer.js
src/main/accounts-service.ts
src/main/codex-provider.ts
src/main/codex-usage.ts
src/renderer/accounts-widget.tsx
```

运行数据放在：

```text
{userData}/plugins/work/pier.codex/
  accounts.json
  accounts/
    <accountId>/
      auth.json
      .pier-managed-home
```

### 8.3 Codex RPC API

Codex renderer 通过插件 RPC 调 main：

- `accounts.snapshot`
- `accounts.add`
- `accounts.cancelLogin`
- `accounts.select`
- `accounts.remove`
- `accounts.refreshUsage`
- `accounts.adoptCurrent`

事件：

- `accounts.changed`

renderer widget 使用插件内部 hook：mount 时拉 snapshot，订阅 `accounts.changed`，写操作调用 RPC。

### 8.4 账号行为

迁移后保持现有语义：

- 首次 init 发现真实 `~/.codex/auth.json` 时自动接管。
- 添加账号 spawn `codex login`，`CODEX_HOME` 指向托管目录。
- 添加账号不自动切换。
- 切换账号先 syncBack 当前账号，再 materialize 目标账号到真实 `~/.codex/auth.json`。
- watcher 监听真实 `~/.codex` 目录，处理外部 drift。
- 用量通过 `codex app-server` JSON-RPC 拉取。
- 用量只主动拉 active account。
- mutation queue 串行化。
- login 可取消。
- dispose 时取消 login、清 timer、清 watcher。

### 8.5 Widget、Commands 与配置

Codex renderer 注册：

- dashboard widget：`pier.codex.accounts`
- commands：
  - `pier.codex.addAccount`
  - `pier.codex.switchAccount`
  - `pier.codex.refreshUsage`
- configuration：
  - `pier.codex.confirmSwitch`

UI 保留现有账号 widget 形态，但数据源从 `context.accounts` 改为 plugin RPC。

### 8.6 旧数据迁移

如果用户已有 core 版账号数据：

```text
{userData}/agent-accounts.json
{userData}/agent-accounts/codex/*
```

Codex 插件首次运行时：

1. 如果 `work/pier.codex/accounts.json` 不存在，检查旧路径。
2. 迁移旧 state 到插件 workDir。
3. 复制托管账号目录。
4. 写迁移 marker。
5. 不删除旧数据，避免回滚 Pier 版本时丢失。

### 8.7 加载失败 UX

- 插件未安装、禁用或加载失败：dashboard 中残留 widget 显示占位卡。
- 命令面板不显示 Codex commands。
- 插件页显示错误诊断。
- 卸载 Codex 插件默认保留 `work/pier.codex` 数据。

## 9. 插件管理 UI

Settings 的 Plugins section 升级为官方插件管理页，展示：

1. Installed
   - active version
   - enabled / disabled
   - official / bundled seed / dev override badge
   - update available badge
   - diagnostics
2. Available official plugins
   - 来自中央索引
   - 未安装时显示 Install
3. Dev override
   - 本地路径
   - Remove Dev Override
   - trusted local code warning

操作：

- Install
- Update
- Uninstall
- Enable / Disable
- Check for Updates
- Install Dev Plugin…

更新完成后提示：

> Update installed. Restart Pier to use version x.y.z.

## 10. 测试策略

### Package validation

- 缺 `plugin.json`
- manifest schema 错误
- id/version 与索引不匹配
- main/renderer entry 缺失
- tar path traversal
- sha256 mismatch
- size mismatch
- incompatible `engines.pier`
- React peer/external 规范不满足

### Install service

- bundled seed 首次安装
- staging 安装成功
- staging 失败不影响当前版本
- update 修改 activeVersion，但当前进程仍运行旧版本直到重启
- uninstall 保留 work 数据
- dev override 优先级
- dev override 移除后恢复 installed activeVersion

### Runtime

- main external plugin activate/dispose
- renderer external plugin activate/dispose
- RPC invoke success/error
- event broadcast 到多窗口
- external plugin 贡献 panel/status/dashboard/action
- activate 失败进入 diagnostics

### Codex migration

- 旧 core 数据迁移到 plugin workDir
- 旧数据不删除
- add/select/remove/usage 行为保持
- dispose 取消 login、timer、watcher
- widget 从 RPC 获取 snapshot 和事件

### Boundary

- host 不再 import `src/plugins/builtin/codex`
- `context.accounts`、`window.pier.accounts`、`account:*` 移除
- Codex 只通过 plugin RPC 通信
- external renderer plugin 不 import `src/renderer/*`

## 11. 实施阶段

### Phase 1：插件安装管理底座

- plugin install service
- `userData/plugins/{installed,staging,work,index.json}`
- bundled seed install
- central index fetch
- package validation
- install/update/uninstall state model
- settings page 管理 UI 第一版
- 暂不运行 external plugin

### Phase 2：External plugin runtime

- main dynamic import runtime
- renderer dynamic import runtime
- RPC/Event Bus
- contribution activation
- React external dependency contract
- dev override
- diagnostics

### Phase 3：Codex 迁移

- 创建 `pier.codex` external plugin package
- 迁移 account service/provider/usage/widget/actions/config
- 删除 core account service/API
- 旧数据迁移
- bundled seed 默认安装启用

### Phase 4：收敛与回归

- 插件页 polish
- dashboard placeholder 状态
- AGENTS.md 更新 trusted plugin 边界
- depcruise / package boundary tests
- full `pnpm check`

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| trusted Node 插件等价远程代码执行 | 官方索引 + GitHub Release + sha256 + 用户手动更新 + UI 风险提示；不开放任意 registry 自动更新 |
| React 多副本导致 hooks 崩溃 | `react` / `react-dom` external 强约束；提供 `@pier/plugin-api` 和 build preset |
| ESM module cache 无法卸载 | 更新必须重启生效；版本目录不可变 |
| 插件 activate 崩溃影响宿主 | activate/dispose try-catch、diagnostics、widget ErrorBoundary |
| Codex 迁移丢账号数据 | 旧数据复制迁移，不删除旧路径，写迁移 marker |
| dev override 行为不可预测 | Dev badge、重启生效、移除 override 可回到 official installed version |
| 官方索引不可达 | 已安装版本继续可用；更新检查失败只显示诊断 |

## 13. 验收标准

- 首次启动后 `pier.codex` 以 managed external plugin 形式安装并启用。
- 插件页可显示官方插件、版本、来源、启用状态和 diagnostics。
- 可检查 GitHub Release 更新；更新安装后提示重启生效。
- 插件包安装失败不破坏当前版本。
- Dev Plugin override 可覆盖同 id official plugin，移除后恢复 official。
- External plugin 可贡献 dashboard widget、panel、terminal status item 和 commands。
- Codex dashboard widget 使用 plugin RPC 获取账号状态。
- 宿主 `agent-accounts` API 已移除，Codex 账号逻辑在插件内运行。
- 旧账号数据可迁移且回滚安全。
- `pnpm check` 通过。
