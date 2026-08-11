# 语言支持矩阵与三层扩展

**日期**：2026-08-11  
**状态**：现行（阶段 1 双轨扩展已落地契约与 Files 注册表）  
**相关**：[`workspace-lsp-policy.md`](./workspace-lsp-policy.md)（会话策略、hover、进程生命周期）

## 1. 原则

### 1.1 完整「语言支持」= 展示 + 服务（双轨）

要**覆盖任意语言**（Zig、Julia、Fortran…），不能只扩展语言服务。业界金标准与 Pier 目标一致：

| 轨道 | 职责 | 用户可见 | 可缺省？ |
|------|------|----------|----------|
| **句法 / 展示** | 扩展名识别、语言徽章、语法高亮（及后续折叠/大纲等） | 打开文件即有 | 可仅展示无服务 |
| **语义 / 服务** | 补全、跳转、诊断、hover 等（LSP） | 装 server 或插件后 | 可仅服务无精美高亮（体验差） |

**硬结论**：

1. **高亮与 LSP 都必须能被插件（及 L1）扩展**，否则长尾永远「Plain Text + 无跳转」或「有跳转但像纯文本」。
2. 两轨**正交**：可只贡献展示、只贡献服务、或同插件一次声明两者。
3. L0 只收**高频默认**；「支持所有语言」靠 **L1 + L2 双轨扩展**，不靠把所有 grammar 打进 dmg。

### 1.2 三层所有权

| 层级 | 所有者 | 展示（高亮 / 身份） | 服务（LSP） |
|------|--------|---------------------|-------------|
| **L0 核心默认** | 宿主 + Files 编辑器 | 内置 `FilesDocumentLanguage` / CM 包 | `providers/*` 注册 |
| **L1 用户自定义** | 偏好 | **目标**：扩展名 + 显示名 + 高亮预设 | `customServers[]`（已有） |
| **L2 官方插件** | builtin / managed | **目标**：`languageModes`（或等价贡献） | `languageServers`（已有） |

- 宿主做厚（SessionHost、Policy、Registry、**语言模式注册表**）；语言做尖（默认少而稳）。
- **不**复制 VS Code 任意第三方扩展市场；插件通道仅 builtin + 官方 managed。
- spawn 只在 main；renderer / Agent 永不直接起语言服务器。
- 同文件 LSP 仍 **priority 单 winner**（多 server 并行不在本期）。
- 同扩展名多展示贡献时：L0 固定映射优先，再按插件 priority / 启用态解析（细则见 §8）。

## 2. L0 默认矩阵

### 2.1 编程语言

| 语言 | Server | 发现方式 | Provider id |
|------|--------|----------|--------------|
| TypeScript / JavaScript | typescript-language-server | **打包进应用** | `typescript` |
| Python | pyright / basedpyright | PATH | `pyright` |
| Go | gopls | PATH | `gopls` |
| Rust | rust-analyzer | PATH | `rust-analyzer` |
| Vue | 打包 **typescript-language-server** + `@vue/typescript-plugin`（工作区或全局 `vue-language-server` 树） | 插件可解析；TLS **打包** | `vue` |
| Svelte | `svelte-language-server`（`svelteserver`） | PATH | `svelte` |

> **Vue 与跳转**：Vue LS 3 为 hybrid（需客户端转发 `tsserver/request`）。Pier 单会话宿主暂不实现该桥，因此用 **TLS + `@vue/typescript-plugin`** 提供 script/import 的 go-to-definition；`initialize` 由 main 注入 `initializationOptions.plugins`。用户 `npm i -g @vue/language-server` 即可带上插件。未解析到插件时回退 PATH `vue-language-server --stdio --tsdk=`（应用内 TS 6，进程可起，definition 能力受限）。

> **Svelte**：PATH 发现 `svelteserver`；未做 Vue 同级的 TS/插件注入。安装：`npm i -g svelte-language-server`。

### 2.2 配置与文档语言（工作台必含）

| 语言 | Server | 发现方式 | Provider id |
|------|--------|----------|--------------|
| JSON / JSONC | vscode-json-language-server | PATH | `json` |
| CSS / SCSS | vscode-css-language-server | PATH | `css` |
| HTML | vscode-html-language-server | PATH | `html` |
| YAML | yaml-language-server | PATH | `yaml` |
| Markdown | marksman | PATH | `markdown` |

推荐本机安装（不进 dmg）：

```bash
npm i -g vscode-langservers-extracted yaml-language-server
npm i -g @vue/language-server svelte-language-server
brew install marksman   # 或 GitHub release
```

### 2.2.1 编辑器展示（与 LSP 正交）

| 文件 | 语言 id / 徽章 | 语法高亮 | 语言服务 |
|------|----------------|----------|----------|
| `.vue` | `vue` / Vue | `@codemirror/lang-vue`（HTML base） | 上表 `vue` |
| `.svelte` | `svelte` / Svelte | `@replit/codemirror-lang-svelte` | 上表 `svelte` |
| `.canvas.vue` 等 | `canvas` / Canvas | 按框架后缀选 Vue/Svelte/TSX | 仍按扩展匹配上表 provider |
| `.svg` | `svg` / SVG | XML（`lang-xml`） | **无**独立 SVG LSP（源码编辑，非位图预览） |
| `.scss` | 展示 id `css` | CSS | CSS LS，`languageId=scss` |
| `.cs` | `csharp` / C# | legacy clike csharp | **仅** L2 `pier.lsp-csharp` 启用后 |

### 2.3 明确不进 L0

| 语言 | 原因 | 通道 |
|------|------|------|
| Java | jdtls + JDK 体积与版本碎片 | L2 `pier.lsp-java` |
| C / C++ | clangd / 工具链重 | L2 `pier.lsp-cpp` |
| C# | OmniSharp / csharp-ls + SDK | L2 `pier.lsp-csharp`（展示层已识别 `.cs`） |
| SQL / PHP / Ruby / … | 长尾 | L1 custom 或后续官方插件 |

### 2.4 非目标

- 不把 jdtls / clangd / OmniSharp 打进安装包。
- 不开放任意第三方上传 LSP 插件。

### 2.5 CSS `@import` 包跳转（已支持）

Pier Files 编辑器对 `.css` / `.scss` 等：

- 解析 `@import "pkg"` / 子路径 / 相对路径（`package.json#exports` 的 **`style` condition** + monorepo/`node_modules` 上溯）
- **不依赖** `vscode-css-language-server` 是否安装
- Cmd/Ctrl+点击、F12、Cmd/Ctrl+悬停下划线共用此解析
- 落点：`src/shared/css-import-resolve.ts`、`src/plugins/builtin/files/renderer/lsp/css-import-definition.ts`

> Cursor / VS Code 内跳转仍受其 CSS LS 限制；本能力只在 Pier 文件面板生效。

## 3. 编辑器协议能力（与语言无关）

已连接的 server 共用宿主 Client；具体能力取决于 server 实现：

| 能力 | 宿主 |
|------|------|
| hover / definition / references | Files + Agent LanguageTools（只读白名单） |
| completion / signature / diagnostics | Files（CodeMirror lsp-client） |
| documentSymbol / workspaceSymbol | LanguageTools |
| format / rename / codeAction | 视 server；UI 未全量暴露 |

## 4. L1 用户自定义

### 4.1 语言服务（已有）

偏好字段：`preferences.lsp.customServers[]`。

- 设置 → **Files（插件设置）** → 编辑器偏好 + **语言服务（宿主）** 策略、工具链状态、自定义 server（高级）。
- 设置 → **插件** → 启用官方语言包（Zig / Java / …），主路径。
- **不**再单独设「语言」宿主分区；工作区只保留工作树路径等壳偏好。
- 运行时 provider id：`custom:{id}`，priority 默认 50。
- prefs 变更时 `syncCustomLanguageServers` 差量替换注册。
- command 经 PATH / 绝对路径解析后方可启动。
- 用于 Ruby、SQL、Zig（zls）等未内置语言。
- 表单解析：`src/renderer/pages/settings/components/lsp-custom-server-form.ts`

### 4.2 展示扩展（目标）

仅配 custom server **不够**：用户仍会看到 Plain Text。L1 目标字段（可与 custom server 同表或分表，产品上宜同向引导）：

| 字段 | 作用 |
|------|------|
| `extensions` | 如 `.zig`、`.zon` |
| `displayName` / `languageId` | 徽章与 didOpen languageId |
| `highlightPreset` | 封闭枚举，映射到宿主已有 CM 能力（见 §8.2） |

与 `customServers` 的 `languageIds` / `extensions` 应对齐，避免「服务认 .zig、展示仍 text」。

## 5. L2 插件贡献

### 5.1 现状：仅服务轨

已有 manifest `languageServers` + 权限 `lsp:provide`。

```json
{
  "languageServers": [
    {
      "id": "jdtls",
      "displayName": "Java",
      "extensions": [".java"],
      "languageIds": ["java"],
      "rootMarkers": ["pom.xml", "build.gradle", "build.gradle.kts"],
      "command": "jdtls",
      "args": [],
      "priority": 70
    }
  ],
  "permissions": ["lsp:provide"]
}
```

- Main 按 manifest 物化 / `context.languageServers.register`。
- 运行时 provider id：`{pluginId}:{contribution.id}`。
- 卸载时 unregister 并关 session。
- **缺口**：不声明编辑器语言身份时，依赖 Files 内置映射；无映射则徽章/高亮缺失（历史 `.cs` 误绑 C++ 即此类问题）。

### 5.2 目标：展示轨 + 服务轨同插件

官方语言插件应一次声明**完整语言支持**（对齐 VS Code「Language Support」扩展，而非仅 Language Server）：

```json
{
  "languageModes": [
    {
      "id": "zig",
      "displayName": "Zig",
      "extensions": [".zig", ".zon"],
      "highlight": "clike",
      "priority": 70
    }
  ],
  "languageServers": [
    {
      "id": "zls",
      "displayName": "Zig",
      "extensions": [".zig", ".zon"],
      "languageIds": ["zig"],
      "command": "zls",
      "rootMarkers": ["build.zig", ".git"],
      "priority": 70
    }
  ],
  "permissions": ["lsp:provide", "languageMode:provide"]
}
```

| 贡献 | 权限（建议） | 消费方 |
|------|--------------|--------|
| `languageModes` | `languageMode:provide`（待增） | Files：`languageForPath` / 徽章 / `cmLanguageExtension` / hover fence |
| `languageServers` | `lsp:provide`（已有） | 宿主 LSP Registry / SessionHost |

规则：

- 可只贡献 `languageModes`（纯展示，无 server）。
- 可只贡献 `languageServers`（兼容现状；展示仍靠 L0 或另声明 modes）。
- **推荐**：官方语言插件两者都声明，且 `extensions` / languageId 一致。
- 卸载插件：撤 modes 注册 + 卸 server + 已开标签回落 text 或保留至重开。

### 5.3 用户主路径：启用语言插件（不是填表）

**产品默认**：用户只需 **设置 → 插件 → 启用「Zig 语言」等**。插件内自带 `languageModes` + `languageServers`。

| 用户动作 | 得到 |
|----------|------|
| 启用插件 | 扩展名识别、徽章、语法高亮（预设） |
| 本机 PATH 有对应 server（如 zls） | 补全 / 跳转 / 诊断 |
| PATH 无 server | 仍有高亮；芯片展示插件声明的 `installCommand`（如 `brew install zls`） |

**安装提示归属**：`languageServers[].installCommand` 由**语言插件 manifest** 声明；Files 只聚合进 `lspInstallGuideRegistry` 展示，**禁止**在 Files 内写死各语言安装命令。
**L1 自定义语言服务** 仅逃生舱（未知语言、企业内私服），**不要**作为 Zig/Java 等官方语言的正常路径——用户不知道扩展名、languageId、高亮预设怎么填。

### 5.4 首批官方语言包（managed，可安装 / 卸载）

| 插件 id | 语言 | 二进制 | 用户动作 | 展示 + 服务 |
|---------|------|--------|----------|-------------|
| `pier.lsp-java` | Java | jdtls | 设置 → 插件 → 安装 | `languageModes` + `languageServers` |
| `pier.lsp-cpp` | C / C++ | clangd | 同上 | 同上 |
| `pier.lsp-csharp` | C# | csharp-ls / OmniSharp | 同上 | 同上 |
| `pier.lsp-zig` | Zig | zls | 同上 | 同上（长尾示范） |

落点：`packages/plugin-lsp-{java,cpp,csharp,zig}/`（官方 managed 包，与 `pier.codex` 同管线）。均为 adapter + PATH；不附带工具链。安装并启用后宿主按 manifest 注册 modes（renderer 注册表）与 servers（main Registry）。

## 6. Priority 约定（LSP）

| 来源 | 默认 priority |
|------|----------------|
| L0 TypeScript | 100 |
| L0 其他编程语言 | 90 |
| L0 配置/文档语言 | 80 |
| L2 插件 | 70（可声明，硬顶 100） |
| L1 custom | 50 |

同 path 多匹配时取 priority 最高者。

## 7. 实现落点（现行）

| 模块 | 路径 |
|------|------|
| Provider 契约 | `src/shared/contracts/lsp-provider.ts` |
| 插件 LS 贡献 | `src/shared/contracts/plugin-language-server.ts` |
| 策略偏好 | `src/shared/contracts/lsp.ts` |
| 共享 PATH 解析 | `src/main/services/lsp/resolve-command.ts` |
| 工厂 | `src/main/services/lsp/providers/create-path-provider.ts` |
| Bootstrap | `src/main/services/lsp/bootstrap-providers.ts` |
| Registry | `src/main/services/lsp/server-registry.ts` |
| 设置 UI | `src/renderer/pages/settings/components/lsp-settings-card.tsx` |
| 编辑器语言检测 | `src/plugins/builtin/files/renderer/editor/language-detection.ts` |
| 编辑器 CM 高亮 | `src/plugins/builtin/files/renderer/editor/cm-language.ts` |
| Hover fence 高亮 | `src/plugins/builtin/files/renderer/lsp/highlight-language.ts` |

## 8. 扩展模型目标态（高亮 + LSP 双可扩展）

本节是「支持所有语言」的架构契约；**实现分阶段**，与业界金标准对齐方向，不一次上 TextMate 市场。

### 8.1 业界对照（金标准方向）

| 产品 | 展示扩展 | 服务扩展 |
|------|----------|----------|
| VS Code | TextMate `grammars` + `languages` | 扩展启动 LSP |
| Zed / Helix | Tree-sitter grammar + queries | 扩展配置 LSP |
| Neovim | tree-sitter + 插件 | nvim-lspconfig 等 |
| **Pier 目标** | 插件 / L1 声明 **语言模式**；宿主映射到 CM | 插件 / L1 声明 **languageServers**（已有） |

Pier 使用 CodeMirror，短期**不**自建 TextMate/Tree-sitter 市场；用**封闭高亮预设 + 可选后续挂真 CM/Lezer 包**逼近。

### 8.2 高亮扩展：封闭预设（阶段 1）

`highlight` / `highlightPreset` 枚举由宿主维护，例如：

`text` · `javascript` · `typescript` · `jsx` · `html` · `xml` · `css` · `json` · `yaml` · `markdown` · `python` · `go` · `rust` · `clike` · `java` · `csharp` · `shell` · `sql` · `toml` · `vue` · `svelte` …

- 插件**只引用预设 id**，不得塞任意解析器代码（纪律边界；与「仅官方插件」一致）。
- Files 将预设映射到已依赖的 `@codemirror/lang-*` / legacy-modes / 已装包。
- Zig 阶段 1 可用 `clike` 或 `text`；待核心增加真 Zig 包后改预设 id。

### 8.3 高亮扩展：真语法包（阶段 2，可选）

- 宿主 allowlist：`highlightPackage: "@codemirror/lang-foo"` 或内置 Lezer 资源路径。
- 仍禁止任意远程代码；包须随应用或官方插件分发。
- 更远期：TextMate JSON / Tree-sitter wasm（另立项，不阻塞阶段 1）。

### 8.4 运行时注册表

| 注册表 | 进程 | 内容 |
|--------|------|------|
| **LanguageModeRegistry** | renderer（Files 消费；可选 main 镜像给设置页） | extension → { languageId, label, highlight, source, priority } |
| **LspServerRegistry** | main（已有） | path → provider |

解析顺序（展示）：

1. Live Modules canvas 等**产品硬规则**（不可被插件覆盖）。
2. L0 内置扩展名表。
3. 已启用 L2 `languageModes`（priority）。
4. L1 用户语言模式。
5. 否则 `text`。

LSP 解析顺序不变：Registry priority 单 winner。

### 8.5 与 Files 封闭类型的关系

今日 `FilesDocumentLanguage` 为 TypeScript 联合类型，**阻碍动态语言 id**。

目标迁移：

- 运行时 language id 改为 `string`（或 `string & {}` + 已知字面量联合作文档）。
- 徽章：`label` 来自注册表，缺省用 languageId。
- `LANGUAGE_LABELS` / `cmLanguageExtension` 先查注册表，再落内置 switch。

### 8.6 权限与纪律

| 能力 | 权限 | 说明 |
|------|------|------|
| 贡献 LSP | `lsp:provide` | 已有 |
| 贡献语言模式 | `languageMode:provide` | 待增；无此权限则忽略 modes |
| 任意 CM 代码 | **不提供** | 阶段 1/2 均不开放 |

插件边界仍是纪律边界，非恶意代码沙箱（见 `AGENTS.md`）。

### 8.7 交付阶段

| 阶段 | 交付 | 「所有语言」含义 |
|------|------|------------------|
| **0 现行** | L0 展示+服务；L2 仅 LSP；L1 仅 custom server | 高频完整；长尾靠改核心或残缺体验 |
| **1 双轨可扩展**（已实现骨架） | `languageModes` + `languageMode:provide`；L1 `highlightPreset`；Files 注册表；启动时从插件 registry + customServers 同步 | 官方插件 / 用户可声明任意扩展名 + 预设高亮 + 可选 server |
| **2 句法增强** | 更多预设 / 真 CM 包 / 可选 semantic tokens | 长尾着色接近专业编辑器 |
| **3 非目标** | 任意第三方 grammar 市场 | 与 Pier 插件政策冲突 |

**阶段 1 是「保障能支持所有语言」的最低完整架构**；阶段 0 不能称为已支持所有语言。

### 8.8 验收标准（阶段 1）

1. 仅启用某官方插件（如未来 Zig）时：`.zig` 显示正确徽章 + 非 Plain Text 高亮（至少 preset）+ zls 在 PATH 时可跳转。
2. 仅 L1：用户为 `.zig` 配 zls + 高亮预设后，不改核心代码即可用。
3. 禁用插件 / 删 L1 项后，扩展名回落 text，无残留 server。
4. 治理测试：modes 与 servers 的权限门闩；preset 枚举白名单；canvas 硬规则不被覆盖。

## 9. 非目标（再声明）

- 不把 jdtls / clangd / OmniSharp / zls 等打进安装包。
- 不开放任意第三方上传语言插件或 grammar 市场。
- 不在本期做多 LSP 并行于同一文件。
- 不要求每个语言都有 LSP（SVG 等可仅展示）。
