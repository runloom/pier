# Managed External Plugins 与 Codex 账号插件迁移设计

**日期**：2026-07-07
**状态**：设计已同步实现计划，待实现
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
- 不做插件资源限制、强审计、策略引擎；v1 只做最低安装/更新/启停/诊断日志。
- 不做通用账号平台、模型 provider 平台、自动调度、任务 DAG、RAG/eval/知识库平台。

## 3. 架构原则

1. **trusted external，不是沙箱**：v1 插件 main 是普通 Node ESM，可直接使用 Node 能力；renderer 插件与宿主 React 同 realm 运行。v1 没有 per-plugin principal，manifest `permissions`、RPC `pluginId` 作用域和 renderer facade 断言只构成工程纪律边界，不构成对恶意插件的安全防护。UI 和文档必须明确展示来源和风险。
2. **安装态由 Pier 管理**：安装来源、active version、enabled、sha256、pending update 都由 Pier 的 install index 记录，不信任插件 manifest 自报来源。
3. **版本目录不可变**：插件代码安装到 `installed/<id>/<version>`，运行时不覆盖 active 目录。
4. **staging 原子安装**：下载包先进入 staging，校验通过后复制到 `installed/<id>/.<version>.<nonce>.tmp` 临时 sibling，二次校验后 atomic rename 为 `installed/<id>/<version>`，最后才更新 index；启动时忽略/清理遗留 `.tmp` 目录。
5. **更新重启生效**：不处理 ESM module unload、React tree 热替换、main watcher/timer 在线迁移。
6. **Codex 默认可用**：`pier.codex` 作为官方 bundled external plugin，首次启动默认安装并启用，保持现有功能开箱即用。
7. **官方更新必须有独立信任根**：远程 `.tgz` 更新链路必须校验签名官方索引或签名包，公钥固定在 app 内；`sha256` 只做内容完整性校验，不能替代发布者身份校验。
8. **生产环境不加载本地 override**：dev override 只用于开发/测试运行时；生产包默认隐藏 UI 入口并拒绝命令，避免本地路径成为绕过官方索引的加载通道。
9. **凭据加密必须 fail-closed**：插件 `context.secrets` 不允许明文 fallback；safeStorage 不可用、解密失败或写入加密失败时必须拒绝敏感写入并产生高危诊断。
10. **Core 只保留宿主能力**：终端、panel、Git/File API、workspace、plugin management、profile/secrets 等留在宿主；Codex-specific 账号逻辑迁入插件。

## 4. 插件包与安装目录

### 4.1 插件包格式

官方发布包是 `.tgz`。解包根目录必须包含：

```text
package.json        # 必须包含 { "type": "module" }
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
- `permissions`（声明、展示和治理测试用途；v1 不是恶意插件安全授权）
- `dataSchemas`（可选，声明插件工作数据 schema 名称、可读取版本范围和当前写入版本；用于 rollback / last-known-good 兼容性判断）
- `localization`

`plugin.json` 不声明安装来源、active version、官方状态、更新策略或启用状态。包根目录的 `package.json` 只作为 Node ESM marker / package metadata，必须声明 `"type": "module"`，保证安装到 userData / app resources 后 `dist/main.js` 仍按 ESM dynamic import 加载。

示例：

```json
{
  "dataSchemas": {
    "codex.accounts": {
      "read": ">=1 <=1",
      "write": 1
    }
  }
}
```

语义固定如下：`read` 是该插件版本可读取且可安全迁移的现有数据版本范围（semver-style 整数区间）；`write` 是该插件版本会写出的 schema 版本。回滚兼容性判断只依赖 `read`：目标候选版本的 manifest `dataSchemas.<name>.read` 必须覆盖 marker 中记录的当前 schema 版本，否则拒绝该候选。`write` 用于插件首次运行时决定是否需要升级本地数据。刻意不引入第三个 `current` 字段——"通常等于 write 的 current" 是维护噪音，只会随时间产生 drift。如果 work data marker 中存在某个 schema，而目标插件 manifest 未声明该 schema，兼容性检查必须 fail-closed，禁止 rollback / last-known-good 启动该版本；如果 marker 缺失，视为该插件尚无 host-known 工作数据约束，不阻止首次启动或无数据启动。通用宿主不扫描 `accounts.json` 等插件私有文件来推断 schema 归属；拥有 schema 数据的插件必须在写入或修复数据后原子更新 marker，并且在 marker 修复成功前不得报告对应版本激活成功。

Pier 通用读取 `work/<id>/.pier-plugin-data-schemas.json` 判断当前工作数据版本，不 import 插件私有源码。插件在升级自己的 `workDir` 数据后必须原子更新该标记文件，例如：

```json
{
  "version": 1,
  "schemas": {
    "codex.accounts": {
      "version": 1,
      "updatedByPluginVersion": "1.0.0"
    }
  }
}
```

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

`index.json` 是插件安装态真相源。现有 `plugin-state.json` 的 enabled 状态应迁入此 index，避免双状态源。运行期还必须保存启动时的 **effective runtime snapshot**（实际已加载的 version/enabled/source）与 index 中的 **desired next-start state** 区分；所有需要重启的操作只改变 desired state，并在 UI 中显示 pending restart，不改变当前进程已注册的 handler/contribution。每次启动完成 desired→effective reconciliation 后，Pier 必须更新 `effectiveAtStartup` 并清除已生效的 `pendingRestart`，避免重启后仍显示 restart-required。`pendingUpdate` 表示签名官方索引中有可安装的新版本；`pendingRestart.kind === "update"` 表示更新已经写入 desired state，正在等待重启，两者不能混用。

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
      "pendingRestart": null,
      "effectiveAtStartup": {
        "version": "1.0.0",
        "enabled": true,
        "sourceKind": "official"
      },
      "devOverride": null
    }
  }
}
```

## 5. 官方索引与 GitHub Releases

Pier 使用中央官方索引，索引中的包资产指向 GitHub Releases。插件 manifest 自带的 update URL 不参与更新决策。v1 官方索引地址固定为 `https://pier.earendil.works/plugins/index.v1.json`；开发/测试运行时可通过 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 覆盖，生产运行时必须忽略该环境变量并记录诊断，避免本地环境变量变成远程代码执行更新源。

官方索引必须是签名 envelope：索引正文包含 `sequence` / `generatedAt` / `plugins`，签名对象包含 `keyId` / `alg` / `value`，使用 app 内固定公钥集合中与 `keyId` 匹配的 Ed25519 公钥验证。验签顺序固定为：读取原始响应字节并做大小限制，按 UTF-8 解析成 JSON 值且拒绝重复对象 key，只做最小 envelope 读取以取得 `signature.keyId` / `signature.alg` / `signature.value`，把完整解析对象中去掉 `signature` 字段后的载荷 canonicalize 并验签，验签通过后再走 strict `officialPluginIndexSchema` 校验。被签名内容不得来自 Zod `.strip()` 后的对象；未知字段若存在也必须已经被签名，然后由 strict schema 决定拒绝。canonical JSON 规则为：对象 key 按字节序排序、无额外空白、数字不做本地化格式化；`signature` 字段本身不参与签名。这样避免字段顺序、空白、未知字段剥离和签名字段递归带来的实现分歧，并为后续公钥轮换保留 `keyId`。

本地缓存记录已见过的最高 `sequence` 和每个版本的 first-seen `sha256`，拒绝索引回滚、同版本 hash 漂移、非 allowlist GitHub owner/repo 资产和跳转到非 GitHub Release 资产。资产 URL 本身必须是 allowlist owner/repo 下的 `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>.tgz`；下载时允许 GitHub Release 的实际 HTTPS CDN 跳转落到 `github.com`、`objects.githubusercontent.com` 或 `release-assets.githubusercontent.com`，但限制重定向次数，不允许跳到其他域名、非 HTTPS scheme 或携带凭据的 URL，最终内容仍必须匹配 signed index 中的 `sha256` 和 `size`。GitHub Releases 只是包存储位置，不单独作为发布者身份信任根；若未来启用 GitHub immutable releases 或 attestation，可作为额外证据纳入校验。

v1 公钥轮换依赖 app 发版更新固定公钥集合；索引中的 `keyId` 用于多公钥过渡，但不提供远程撤销机制。若需要无需发版的撤销，必须另设签名撤销列表设计。

示例：

```json
{
  "version": 1,
  "sequence": 42,
  "generatedAt": 1783449600000,
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
  },
  "signature": {
    "keyId": "pier-official-2026-01",
    "alg": "Ed25519",
    "value": "base64-ed25519-signature"
  }
}
```

版本选择、兼容性、hash 和官方状态由已签名中央索引决定。未通过签名、sequence、allowlist、hash 和 size 校验的索引或包不得进入 staging extraction。

### 5.1 签名基础设施（本计划之外的前置）

签名 Ed25519 密钥的生成、离线保管、`https://pier.earendil.works/plugins/index.v1.json` 的发布 pipeline 与 key rotation 属于本计划**之外**的独立交付：

- 私钥必须离线生成、离线保管，不进入任何 CI runner 或 build 机；签名过程必须在气隙环境或硬件 token 内完成，索引发布 pipeline 只见公钥。
- v1 无远程撤销：撤销一个 `keyId` 必须发 app 新版本更新固定公钥集合并把该 `keyId` 从可信集合中移除。因此每一次签名事件都是**长期承诺**。
- 本计划只消费固定公钥集合。Task 2 拉起时必须有至少一个可用的官方 `keyId` + 公钥硬编码进 app，且远端 `pier.earendil.works/plugins/index.v1.json` 已经是签名 envelope；否则 Task 2 无法通过 e2e。
- 若发布 pipeline 未就绪，Task 2 及后续任务不能进入 dev 联调阶段；宁可 Task 3-11 用 mocked signed index 测试通过，也不要用 unsigned index 走通然后事后补签名。

### 5.2 更新检查节流

`plugin.checkUpdates` 会拉签名索引并做磁盘 IO。为避免用户暴力点 Check for Updates 打 `pier.earendil.works`，install service 内部对 `fetchOfficialPluginIndex` 加最小间隔（如 60 s）。命中节流窗口时返回上次缓存 + `rate_limited` diagnostic，不再发起网络请求。命中节流不算错误，UI 显示"最近已检查过更新，请稍候"提示。

## 6. 安装、更新、卸载和 dev override

### 6.1 bundled seed 首次安装

`pier.codex` 随 app 带一个 bundled seed 包。启动时：

1. 读取 `{userData}/plugins/index.json`。
2. 如果 `pier.codex` 未安装，从 app resources 中的 seed 包安装。
3. 解包/复制到 staging 后，复制进 `installed/pier.codex/.<seedVersion>.<nonce>.tmp` 临时 sibling，验证临时目录，再 atomic rename 为 `installed/pier.codex/<seedVersion>`。
4. 写入 index：`enabled: true`、`source.kind: "official"`、`seededFromBundle: true`、`activeVersion: seedVersion`，并把 seed 包 sha256 写入官方索引缓存的 first-seen hash 记忆。以后远程官方索引若声明同 id/version 但 hash 不同，按 hash 漂移拒绝。如果后续 app 版本带来同 id/version 但 sha256 不同的 seed，按构建/供应链不一致拒绝该 seed，优先保留本地已验证版本；若官方索引缓存丢失但 `index.json.installedVersions` 仍有 sha256，先用已安装记录重建 first-seen 记忆再接受远程索引。如果进程在 rename 前退出，不写 index；下次启动忽略/清理 `.tmp` sibling。
5. runtime 从 installed active version 加载插件。

如果 Pier 升级后已安装 active version 的 `engines.pier` 与当前 app 不兼容，而 bundled seed 版本兼容当前 app，启动 reconciliation 可以把 desired active version 恢复到 seed 版本并写诊断/操作日志；但必须尊重用户卸载 tombstone，用户明确卸载后不得自动复活 seed。这个恢复仍然是启动期 desired/effective reconciliation 的一部分，不在运行中的进程热切换。

### 6.2 更新提示与手动更新

1. 用户打开插件页或点击 Check for Updates。
2. Pier 拉取官方中央索引。
3. 选择与当前 Pier 兼容的最高版本。
4. 若高于 active version，插件页显示 Update available。
5. 用户点击 Update 后，下载 GitHub Release asset 到 staging。
6. 校验签名官方索引、sequence 单调性、asset allowlist、size、sha256、tar path traversal、manifest schema、id/version、`package.json` ESM marker、entry 文件、engine compatibility、renderer/main import specifier scan、React singleton/alias 规范。
7. 解包/复制到 staging 后，复制进 `installed/<id>/.<newVersion>.<nonce>.tmp` 临时 sibling，验证临时目录，再 atomic rename 为 `installed/<id>/<newVersion>`。
8. 更新 index 的 `activeVersion`，保留旧版本记录用于 rollback。若进程在 rename 前退出，不写 index；下次启动忽略/清理 `.tmp` sibling。
9. 提示用户重启 Pier 生效。

当前进程继续运行旧版本；不做热替换。v1 external 插件的 enable / disable、uninstall、dev override set/clear 也采用 next-start 生效：写入 index 的 desired state 与 `pendingRestart`，并提示重启；当前进程 UI/contribution 过滤继续使用 effective runtime snapshot，不尝试安全卸载 main RPC handler、watcher、timer 或 renderer contribution。

### 6.3 卸载

卸载官方插件时：

- 写入 index tombstone（例如 `uninstalled: true` / `uninstalledAt`）而不是简单删除记录，使下次启动不加载，并让 bundled seed 不会自动重新安装用户明确卸载过的插件。
- 默认保留 `work/<id>` 用户数据。
- 卸载在当前进程中只是 desired next-start state：重启前仍保留 effective runtime snapshot 引用的代码目录和 assets，`pier-plugin://` 继续服务当前已加载版本；物理删除旧代码只能在下一次启动确认没有 runtime snapshot 引用该版本之后进行。
- dashboard layout 中残留 widget 由宿主显示“插件未安装”占位卡。
- dockview layout 中残留 plugin panel 由宿主显示通用“Plugin panel unavailable” fallback，不删除面板、不渲染未知 component、不让布局恢复崩溃；插件外部 renderer 注册完成前也使用该 fallback/加载状态。
- **卸载后离线重装**：如果用户卸载了 `pier.codex`（写入 tombstone）后又想重装，而 `pier.earendil.works` 恰好不可达，`plugin.install(pier.codex)` 首先尝试拉签名官方索引；索引不可用时回退到 bundled seed 分支：仅当 seed 的 id/version/sha256 与该 id 在 `installedVersions` 或官方索引缓存 `versionHashes` 里**已见过的官方 hash**匹配（防旧 seed 覆盖新版本 pin），且当前 app `engines.pier` 兼容，才允许 restore-from-seed 并清 tombstone；否则命令返回 `denied` + 诊断"官方索引不可达且 bundled seed 不匹配已见过的官方 hash"。UI 在这一情况下显示次要按钮"Restore Bundled Version (offline)"，主按钮仍是 Install（需网络）。

### 6.4 Dev Plugin override

Dev 插件用于开发/测试，不参与官方安装和更新。生产包默认不展示 Install Dev Plugin 入口，`plugin.devOverride.set` / `plugin.devOverride.clear` 返回拒绝结果并写诊断；只有 `isDevRuntime()` 或测试运行时可设置。index 中登记本地目录：

```json
{
  "plugins": {
    "pier.codex": {
      "activeVersion": "1.0.0",
      "enabled": true,
      "source": { "kind": "official" },
      "devOverride": {
        "path": "/Users/dev/dev/pier-codex-plugin",
        "registeredAt": 123456
      }
    }
  }
}
```

开发/测试运行时加载优先级：`devOverride` > installed activeVersion。生产运行时必须无条件忽略 index 中已经持久化的 `devOverride`，回退到已安装 active version（若可用且 enabled），并写诊断/操作日志；不得读取、验证或加载本地 override 路径。

v1 Dev 目录仅支持预构建 dist 包格式：

```text
package.json        # 必须包含 { "type": "module" }
plugin.json
dist/main.js
dist/renderer.js
```

HTTP dev-server / HMR override 不在 v1 范围内。原因是 renderer 可以安全复用浏览器动态 import，但 main 侧 Node/Electron 不支持直接 HTTP ESM import；为避免引入远程 main loader、缓存转译和额外信任边界，v1 先要求本地预构建目录。设置 dev override 时必须验证包格式；启动时也必须重新验证 dev override 目录（本地目录可能被改动），验证失败则记录诊断并回退到已安装 active version（若可用且 enabled），否则该插件本次启动不加载。生产运行时即使 `index.json` 中已有历史 `devOverride`，也必须忽略该本地路径、记录诊断，并只加载已安装官方 active version 或不加载该插件。安装或移除 dev override 后默认提示重启生效，并写入插件操作日志。


### 6.5 Codex 插件本地迭代流程（推荐）

`packages/plugin-codex/dist-package` 是 dev override 的稳定目标路径。开发者迭代插件时推荐工作流：

```bash
# Terminal 1：插件包 watcher
pnpm --filter @pier/plugin-codex build --watch
# Terminal 2：Pier 主 app
pnpm dev
# 首次：Settings → Plugins → Install Dev Plugin… → 选 packages/plugin-codex/dist-package
# 之后：改 plugin 源码 → watcher 自动 rebuild → 手动重启 Pier（外部插件是 next-start 加载，v1 不做热替换）
```

`predev` 已确保 `pnpm dev` 冷启动前 Codex seed 是最新构建产物；上面的 watcher 只是"迭代插件时不用手动 rebuild"的便利。

## 7. External plugin runtime

### 7.0 命令授权

受管理插件命令仍通过宿主 `authorizeCommand` 按 client-kind 授权。v1 授权矩阵固定为：

- `plugin.catalog.list`：只读，允许 `desktop-renderer` 和 `cli-local`。
- `plugin.install`、`plugin.update`、`plugin.rollback`、`plugin.uninstall`、`plugin.enable`、`plugin.disable`、`plugin.devOverride.set`、`plugin.devOverride.clear`：只允许 `desktop-renderer`。

本计划扩展现有 `CommandMetadata`（`src/main/app-core/permissions.ts`）由**仅 capability-based** 变为 **capability + allowedClientKinds** 双维度：

```ts
export interface CommandMetadata {
  readonly capabilities: readonly PierCapability[];
  // 未定义 = 沿用 capability 判定（现有命令的默认行为，向后兼容）
  // 定义 = 仅允许列表中的 client kind 通过；未列出的 kind 一律拒绝
  readonly allowedClientKinds?: readonly PierClientKind[];
}
```

`authorizeCommand` 判定顺序：先查 `allowedClientKinds`（存在时未列入即拒），再查 `capabilities`。原有命令行为不变（`allowedClientKinds` 缺省）；新加的 `plugin.catalog.list` 显式 `["desktop-renderer", "cli-local"]`，其它 managed plugin 命令显式 `["desktop-renderer"]`。未来任何"某些 client 只读、某些不可写"的命令都走这条路。测试锁定：未列 `mcp-local`/`mobile-paired` 的命令必须被 authorizeCommand 拒绝，不能凭 capability 默认放行。

插件 RPC 不进入 `PierCommand`，也不允许从 CLI / local-control 直接调用。

### 7.1 Main runtime

main runtime 根据 active install record 动态加载入口：

- official installed：`installed/<id>/<version>/<main>`
- dev override：本地预构建目录

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
- `context.lifecycle.onBeforeQuit(cb)`：app quit 前 await，用于 flush 持久化状态
- `context.processEnv.resolveCliEnvironment()`：返回宿主解析后的 CLI PATH/env，用于 GUI 启动时 spawn `codex` 等 CLI
- `context.secrets`：按插件 id 命名空间化的 safeStorage facade，用于插件持久化密钥；v1 不把它作为恶意插件隔离边界。插件 secrets 必须使用加密写入，不能继承现有明文 fallback 行为；safeStorage 不可用或写入/解密失败时，`set` / `get` 必须 fail-closed 并写入 diagnostics，插件应把非敏感状态放到 `workDir`。
- `context.logger`

v1 不提供 main-side `context.commands.register`。用户可见命令仍走 manifest 声明 + renderer `context.actions.register`，或由插件 renderer action 调用插件 main RPC。

v1 插件仍可直接使用 Node API；host API 负责生命周期、RPC、事件和宿主整合。

官方 Codex 旧数据迁移路径不进入公共 `@pier/plugin-api` 的 `MainPluginContext` 类型。宿主只在 `plugin.id === "pier.codex"` 时通过内部 adapter 注入 `codexLegacyAccounts`，并有测试保证其它插件拿不到旧账号 state/baseDir 路径。

**内建插件（Git / Files / 迁移前的 Codex）**同样接收扩展后的 `MainPluginContext`（`plugin`/`paths`/`rpc`/`events`/`lifecycle`/`processEnv`/`secrets`/`logger`）——它们本来就是 trusted code，扩展 facade 不改变其信任层级。**但** builtin 边界测试必须锁定它们**没有意外用上** `context.rpc.handle` 或 `context.secrets`（内建插件之间的耦合应通过既有 shared contract 而非 RPC 命名空间，否则容易在 v1 之后被误升级为"内建 RPC 契约"）：

```ts
expect(scanFileText("src/plugins/builtin/git/**/*.ts")).not.toMatch(/context\.(rpc|secrets)/);
expect(scanFileText("src/plugins/builtin/files/**/*.ts")).not.toMatch(/context\.(rpc|secrets)/);
```

现有 Git/Files 单测的 fake context stub 需要同步补 `plugin`/`paths`/`logger`/`rpc`/`events`/`lifecycle`/`secrets` 字段，用最小空实现即可，防止扩展公共接口后 fake 编不过。

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

RPC 自动按 pluginId 命名空间隔离。插件 renderer 侧公开 API 只暴露 `context.rpc.invoke(method, payload)`，由 host runtime 在创建 plugin context 时注入当前 pluginId；`pluginId` 不作为外部插件可传的 public API 参数。插件 RPC 走专用 renderer-window IPC 通道，不进入 `PierCommand`、CLI local-control 或仅靠 command capability 授权的公共命令路由。注意 v1 同 realm trusted 插件无法形成安全隔离，这里是 host API 纪律边界，不是恶意代码防护；恶意 renderer 插件仍可尝试访问宿主公共 preload API，恶意 main 插件等价本机代码执行。

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

main emit 后，host 广播到所有 renderer windows；renderer runtime 只分发给同 pluginId 的 active plugin instance。v1 事件方向只有 plugin main → renderer；不提供 renderer → main 或插件间 event subscription。main RPC bus 返回 `{ ok, data | error }` transport envelope；renderer `context.rpc.invoke<T>()` 必须 unwrap `ok: true` 为 `T`，并把 `ok: false` 转为结构化错误/throw，避免插件 UI 直接消费 transport envelope。

因为事件会先到达所有 Pier renderer window 再由运行时按 `pluginId` 过滤，事件 payload 不能包含 auth token、原始 `auth.json`、safeStorage ciphertext 或其它密钥材料；敏感内容只能经插件 main RPC 在需要时读取并继续受插件上下文约束。

### 7.4 React 加载规范

外部 renderer 插件允许自定义 React UI，但必须满足：

- 插件最终 renderer bundle 不得包含第二份 React runtime。
- 浏览器动态 import `pier-plugin://.../renderer.js` 时不能留下裸模块 specifier；最终 bundle 不得包含 `import "react"`、`import "react/jsx-runtime"`、`import "react-dom"`、`import "@pier/ui"` 或 `import "lucide-react"` 等浏览器无法解析的 bare import。
- `@pier/plugin-api` 必须提供 React classic runtime、automatic JSX runtime（`jsx` / `jsxs` / `Fragment`）、dev JSX runtime，以及必要的 host bridge shim；插件 build preset 将 `react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom/*` 映射到这些 shim。**shim 必须完整枚举**当前 `react` / `react-dom/client` 的公共具名导出（`useState`、`useEffect`、`useMemo`、`useCallback`、`useRef`、`useContext`、`useReducer`、`useLayoutEffect`、`useSyncExternalStore`、`useTransition`、`useDeferredValue`、`useOptimistic`、`useId`、`use`、`createElement`、`createContext`、`createRef`、`forwardRef`、`lazy`、`memo`、`startTransition`、`Suspense`、`StrictMode`、`Profiler`、`Fragment`、`cloneElement`、`Children`、`isValidElement`、`PureComponent`、`Component`、`version` 以及 `react-dom/client` 的 `createRoot`、`hydrateRoot`），从 `globalThis.__PIER_PLUGIN_SHARED__` 的 `React` / `ReactDOMClient` 对象上解构导出。fixture 测试断言 shim 的 export 集合是 `Object.keys(require("react"))` 的超集，防止 React 版本升级引入新 export 时 shim 静默过时。
- `@pier/ui` / `lucide-react` v1 可以由插件 bundle 打入，但其内部 React import 也必须经 build preset 映射到 host React shim；如未来改成 host shared module，必须先引入 import map 或 protocol-served shared module loader。
- 插件不能 import `src/renderer/*` 或 `src/main/*`。
- 插件只通过 `@pier/plugin-api` 和允许的包消费宿主能力。
- 插件 CSS 需要命名空间化，禁止全局 reset。

应提供 `@pier/plugin-api` 包和插件 build preset，统一处理 peer/external/alias 依赖，并用解析器扫描所有 JS chunk 的 static import/export 和字面量 dynamic import，阻止裸 React/UI import 残留；非字面量 dynamic import 在 v1 禁止或只能指向相对路径。CSS `@import`、source map `sourcesContent`、大小写重复路径和运行时 chunk 也必须纳入校验。

main bundle 也必须可从 `userData/plugins/installed/<id>/<version>` 或 app resources 直接 `file://` dynamic import：`dist/main.js` 不得留下 `@pier/plugin-api`、`@shared/*`、`src/*`、workspace alias、第三方运行时依赖等裸 import；允许相对 import 和 `node:` builtins。v1 `ELECTRON_MAIN_IMPORT_ALLOWLIST` 为空，外部插件 main bundle 不得 import `electron`，除非后续设计明确某个 Electron API 及测试。运行时依赖必须 bundle 进 main bundle 或由明确定义的 resolver 提供。

renderer 插件 bundle 不得依赖 `eval` / `new Function`；插件包 validation 独立拒收 eval 用法。宿主生产 CSP 不为官方插件放开 `unsafe-eval`。宿主 **dev CSP 仍保留 `'unsafe-eval'`**——Vite HMR + react-refresh 依赖 eval 才能热更新，去掉会破坏 `pnpm dev`；这是宿主已知的 dev-only 例外。CSP 是纵深防御的最后一层；对官方插件的 eval 拒收由**包 validation** 主防（Task 2/3），CSP 是兜底。

### 7.5 错误收敛

- main activate try/catch；失败写 diagnostics，插件 runtime disabled。
- renderer activate try/catch；失败写 renderer diagnostics。
- main 和 renderer 激活结果必须回传 install service：`recordActivationResult(pluginId, version, phase, result)` 至少包含 `phase: "main" | "renderer"`、版本、窗口/实例 id、错误诊断。`lastKnownGoodVersion` 只能在 main 激活成功、至少一个 renderer 激活成功、包 hash 仍匹配、工作数据 schema 与该版本 manifest 兼容后推进；无窗口启动时不得错误推进，只保留待确认状态。
- 激活失败不在当前进程切换到旧版本。main 失败则本次启动该插件不可用，renderer runtime 不再 import 该插件 renderer entry，只显示 fallback 和诊断；renderer 失败则对应 UI 显示 fallback 和诊断。rollback / last-known-good 只改变下一次启动的 desired state，避免 main 新版本与 renderer 旧版本在同一进程内混用导致 RPC 契约错配。
- `onBeforeQuit` flush 必须有超时；单个插件 callback 超时后记录诊断并继续退出，不能让插件无限阻塞应用退出。
- main 进程必须把 `flushAllBeforeQuit()` 接入 Electron 退出序列：首次 `before-quit` 拦截 `event.preventDefault()`，await 所有插件 flush（逐插件超时），完成后设置内部标记并再次调用 `app.quit()`；第二次进入 `before-quit` 时直接放行，避免递归阻塞。`will-quit` 只做兜底清理，不再等待插件长任务。
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
  runtime-homes/
    <accountId>/
      auth.json          # 可重建的 CLI 运行态文件，0600，不是持久化真相源
      .pier-managed-home
```

Codex 账号凭据持久化真相源是宿主 `context.secrets` 中的插件命名空间密钥，例如 `account:<accountId>:authJson`。这些密钥必须加密存储，safeStorage 不可用或宿主只能明文 fallback 时，Codex 插件必须拒绝新增/接管账号并显示高危诊断，而不是写入明文 token。`accounts.json` 只保存非敏感元数据、active account、迁移 marker、`schemaVersion` 和单调 `revision`。`auth.json` 只在 `codex login`、`codex app-server`、切换账号或同步真实 `~/.codex/auth.json` 时以 `0600` materialize 到 runtime home 或真实 Codex home；退出、卸载和日志不得把 auth 内容写入诊断。

`pier.codex` 数据 schema 必须独立版本化。插件启动时只能读写自己 manifest `dataSchemas.codex.accounts.read` 支持的 `schemaVersion`；需要升级 metadata 时先写 `accounts.json.backup-before-schema-<from>-to-<to>` 或等价快照，再原子写新文件，并更新 `work/pier.codex/.pier-plugin-data-schemas.json`。代码 rollback 只能回到 manifest 声明仍支持当前工作数据 schema 的版本；如果旧代码不支持当前 schema，UI 显示“数据版本不兼容，不能回滚”，而不是启动旧插件破坏账号数据。通用兼容性检查不读取 `accounts.json` 判断 marker 缺失；Codex 账号服务在启动/迁移时如果发现 `accounts.json` 存在但 schema marker 缺失，必须先重新校验账号 metadata 与加密凭据，再补齐 marker。schema marker 损坏、格式非法或包含候选 manifest 未声明的 schema 时，宿主必须把兼容性视为未知/不兼容，阻止 rollback 和 last-known-good 晋升；Codex marker 修复失败时插件激活失败，不得晋升 last-known-good。Codex 迁移补偿由 `accounts.json`、迁移 marker 和凭据存在性驱动，不把空 workDir 的 schema marker 缺失本身当成代码版本不兼容。

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

renderer widget 使用插件内部 hook/store：先订阅 `accounts.changed`，再拉 `accounts.snapshot`，并用单调 `revision` 拒收旧快照，避免事件先到、初始 snapshot 后到时覆盖新状态。

### 8.4 账号行为

迁移后保持现有语义：

- 首次 init 发现真实 `~/.codex/auth.json` 时自动接管。
- 添加账号 spawn `codex login`，`CODEX_HOME` 指向 runtime home；登录成功后读取 `auth.json` 写入 `context.secrets`，再按是否 active 决定保留或清理运行态文件。
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

1. 如果 `accounts.json` 缺失或 `.migration-core-agent-accounts-complete` marker 缺失，检查 legacy adapter 暴露的旧状态和凭据源。
2. 宿主只通过 Codex 私有迁移 adapter 提供 legacy 账号 metadata 和凭据读取能力，避免插件猜测路径，也避免其它插件获得历史账号路径。adapter 必须覆盖当前实现中的托管目录 `{userData}/agent-accounts/codex/<accountId>/auth.json`；如果宿主当时已经把凭据迁入 `SecretsStore` / safeStorage，也必须暴露对应 encrypted legacy secret 读取分支。实现前先用测试锁定现有 legacy 存储布局，不允许只迁移 metadata 而静默丢凭据。
3. 迁移先写入 `work/pier.codex/.migration-staging-<nonce>/`：解析旧 state，从 adapter 读取并校验每个账号的 legacy credential，将凭据写入 `context.secrets`，保留 active account / account id 映射。任何 state 中存在但凭据源不可恢复的账号都必须写诊断并按合并规则跳过或阻止迁移完成，不能生成没有凭据的 active 账号。
4. 所有账号凭据和元数据校验完成后，按合并规则原子写入 `accounts.json`，再写 `.migration-core-agent-accounts-complete` marker，最后清理 staging。合并规则是已有插件账号优先，legacy 只补缺；账号 id 冲突时保留现有插件记录并把 legacy 记录分配新 id 或跳过且写诊断；secrets 已存在时先校验可解密，不覆盖已有加密凭据；`revision` 必须单调递增。
5. 若进程在中途退出，下次启动看到 marker 缺失必须重新校验并补齐，而不是因为 `accounts.json` 存在就跳过。
6. 不删除旧数据，避免回滚 Pier 版本时丢失。

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
   - 仅 dev/test 运行时显示；生产包隐藏入口并显示“本地 override 在生产不可用”的诊断

操作：

- Install
- Update
- Roll Back（仅当目标版本已验证且数据 schema 兼容）
- Uninstall
- Enable / Disable
- Check for Updates
- Install Dev Plugin…（仅 dev/test）
- **Restart Pier Now**（当任一插件 `desired ≠ effective`、即存在 pending restart 时显示；点击调 `app.relaunch()` + `app.quit()`）
- **Restore Bundled Version**（当官方索引不可达且 bundled seed 匹配已见过的官方 hash 时显示，位于 Install 主按钮旁次要位置）

更新完成后提示：

> Update installed. Restart Pier to use version x.y.z.

## 10. 测试策略

### Package validation

- 缺 `plugin.json`
- manifest schema 错误
- id/version 与索引不匹配
- main/renderer entry 缺失
- tar path traversal
- tar entry 数量、总解压字节、路径长度、目录深度超限
- 默认 `MANAGED_PLUGIN_PACKAGE_LIMITS` 覆盖 seed 目录、官方 install/update 解包和 dev override 目录
- sha256 mismatch
- size mismatch
- incompatible `engines.pier`
- React peer/external 规范不满足
- 官方索引签名失败、未知 `keyId`、canonical payload 不匹配
- 官方索引 sequence 回滚、同版本 hash 漂移、非 allowlist GitHub asset、redirect 越界
- 生产环境忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 且不会访问 env URL

### Install service

- bundled seed 首次安装
- staging 安装成功
- staging 失败不影响当前版本
- update 修改 activeVersion，但当前进程仍运行旧版本直到重启
- main/renderer 激活结果回传后才推进 `lastKnownGoodVersion`
- rollback 只能指向已安装、hash 已验证、数据 schema 兼容的 last-known-good 或用户确认版本
- `cli-local` 只能读取 managed plugin catalog，不能 check/update/install/rollback/uninstall/enable/disable/devOverride
- uninstall 保留 work 数据
- dev override 仅 dev/test 可设置，生产命令被拒绝
- 生产启动遇到历史 `devOverride` 时忽略本地路径并写诊断
- dev override 移除后恢复 installed activeVersion
- 安装、更新、回滚、卸载、启用、禁用、dev override 写入最小操作日志

### Runtime

- main external plugin activate/dispose
- renderer external plugin activate/dispose
- 多窗口 renderer 激活结果去重；无窗口时不误推进 last-known-good
- RPC invoke success/error
- event broadcast 到多窗口
- external plugin 贡献 panel/status/dashboard/action
- activate 失败进入 diagnostics

### Codex migration

- 旧 core 数据迁移到 plugin workDir
- 旧数据不删除
- `context.secrets` safeStorage 不可用时 fail-closed，不写明文 token
- `accounts.json` 带 `schemaVersion`，升级前备份，代码 rollback 校验数据 schema 兼容
- schema marker 缺失按无宿主已知数据约束处理；通用宿主不扫描插件私有文件，Codex 账号服务负责发现并修复 `accounts.json` 有数据但 marker 缺失的场景
- 半迁移修复按“已有插件账号优先、legacy 只补缺”的合并规则执行
- `auth.json` materialize 到 runtime home / 真实 Codex home 时权限为 `0600`
- `codex login` 和 `codex app-server` 都使用解析后的 PATH / CODEX_HOME 或 active account 凭据
- add/select/remove/usage 行为保持
- dispose 取消 login、timer、watcher
- widget 从 RPC 获取 snapshot 和事件，并覆盖“revision 2 event 先到、revision 1 snapshot 后到不能覆盖”的竞态

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
- React 外部依赖约束
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
| trusted Node 插件等价远程代码执行 | 签名官方索引或签名包 + app 内固定公钥 + GitHub Release allowlist + sha256/size + 用户手动更新 + UI 风险提示；不开放任意 registry 自动更新 |
| React 多副本导致 hooks 崩溃 | `react` / `react-dom` external 强约束；提供 `@pier/plugin-api` 和 build preset |
| ESM module cache 无法卸载 | 更新必须重启生效；版本目录不可变 |
| 插件 activate 崩溃影响宿主 | activate/dispose try-catch、diagnostics、widget ErrorBoundary |
| Codex 迁移丢账号数据 | staging 幂等迁移，凭据写入 fail-closed encrypted secrets，旧数据不删除，写迁移 marker，marker 缺失可重试补偿 |
| Codex 数据 schema 与代码回滚不兼容 | `accounts.json.schemaVersion`、升级前备份、rollback 前 schema 兼容检查，不兼容则阻止回滚并显示诊断 |
| dev override 行为不可预测 | 仅 dev/test 开放，Dev badge、重启生效、移除 override 可回到 official installed version |
| 官方索引不可达 | 已安装版本继续可用；更新检查失败只显示诊断 |

## 13. 验收标准

- 首次启动后 `pier.codex` 以 managed external plugin 形式安装并启用。
- 插件页可显示官方插件、版本、来源、启用状态和 diagnostics。
- 可检查 GitHub Release 更新；更新安装后提示重启生效。
- 官方索引签名、canonical payload、`keyId`、sequence、asset allowlist、redirect allowlist 和同版本 hash 漂移检查生效；生产环境忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL` 且不会访问 env URL。
- seed、官方更新包和 dev override 均受同一套默认包资源限制约束。
- 受管理插件 mutation 命令只允许 `desktop-renderer`，`cli-local` 至多读取 catalog。
- dev override 仅 dev/test 可用；生产包隐藏入口并拒绝命令。
- 插件包安装失败不破坏当前版本。
- 安装、更新、回滚、卸载、启用、禁用和 dev override 写入最小操作日志。
- Dev Plugin override 在 dev/test 可覆盖同 id official plugin，移除后恢复 official。
- External plugin 可贡献 dashboard widget、panel、terminal status item 和 commands。
- Codex dashboard widget 使用 plugin RPC 获取账号状态。
- 宿主 `agent-accounts` API 已移除，Codex 账号逻辑在插件内运行。
- Codex 凭据持久化走 fail-closed 插件命名空间 `context.secrets`，运行态 `auth.json` 只作为可重建 CLI 文件存在且权限为 `0600`。
- `accounts.json` 有 `schemaVersion` 和升级备份；插件代码 rollback 只允许回到支持当前数据 schema 的版本。
- 旧账号数据可幂等迁移且回滚安全；半迁移、重复迁移和卸载后重装都不会覆盖已有插件数据。
- `pnpm check` 通过。
