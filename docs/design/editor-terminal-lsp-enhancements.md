# Pier 文件面板 + 终端集成增强设计文档

**日期**：2026-07-28  
**版本**：1.0  
**作者**：Grok (xAI)  
**状态**：已实现并完成验证（TS/JS 内置；Python、Go、Rust provider 已接入并按本机可执行文件启用）
**分支**：feature-git-capabilities  
**相关文件**：`src/plugins/builtin/files/renderer/*`、`src/shared/contracts/lsp*.ts`、`src/main/services/lsp/*`、`src/main/ipc/lsp.ts`

## 1. 问题背景

当前文件面板（CodeMirror 6 + 终端 URL 集成）在 LSP 支持、文件类型高亮细粒度、goToLine 跳转、编辑器设置（Wrap/Tab/Language/EOL）以及终端直接打开文件+跳转到行等能力上存在明显不足：

- **LSP 支持**：完全缺失，无实时诊断、补全、跳转。
- **高亮与类型检测**：仅支持常见扩展，语言推断保守，未集成 LSP 语法高亮。
- **跳转能力**：goToLine 未暴露，终端打开文件后无法自动跳转行号/列号。
- **设置持久化**：Wrap/Tab/Language/EOL 仅部分支持（eol 保存时自动处理），未在设置页暴露或持久化。
- **Git 融合**：git-gutter 已接入，但与编辑器设置、LSP、跳转桥接不深。

本设计旨在**增量补齐**这些能力，保持现有 `file-editor-view-coordinator`、`Compartment`、`configuration` 持久化模式，与 git 能力无缝融合。

## 2. 总体架构

### 2.1 核心组件变更
- **文件编辑器层**：`file-editor-view-session.ts` 与 `file-editor-language-tools.ts` 通过 `Compartment` 动态应用自动换行、制表符宽度、默认语言和 LSP 扩展。
- **文件控制器层**：`file-editor-controller.ts` 暴露会话安全的 `goToLine(editorSessionId, documentId, line, column?)`。
- **终端集成层**：`TerminalOpenUrlEvent`、`files-terminal-open-url-handler.ts` 和 `files-terminal-open-url-resolve.ts` 共同支持 `:line[:column]`。
- **设置层**：Files 插件 configuration 持久化自动换行、制表符宽度、默认语言、默认换行符和编辑器语言功能开关；工作区设置管理语言服务进程策略。
- **LSP 层**：main 侧 provider registry + `LspSessionHost` 管理本地语言服务器，preload 暴露受限 IPC，renderer 使用 `@codemirror/lsp-client`。

### 2.2 数据流
```
终端 URL (file:///path:10:5) 
  ↓
resolveTerminalLocalPathTargets 
  ↓
openDiskTarget → controller.goToLine(10, 5) 
  ↓
CodeMirror dispatch (lineWrapping.of, tabSize.of, lspExtension)
  ↓
文件面板状态栏 + 设置页同步
```

### 2.3 持久化与状态
- Files 编辑器设置：插件 `configuration` 是单一持久化来源，`onDidChange` 将变更实时重配到全部已打开的 CodeMirror 会话。
- LSP 策略：宿主 `preferences.lsp` 持久化全局开关、工作树开关、空闲回收时间和本地/远程工作区上限；策略变更广播到所有窗口。
- LSP 会话：main 侧按窗口、工作区、服务器和实际服务器根复用进程；关闭事件使 renderer 清理缓存并在策略重新启用时恢复连接。
- 终端上下文：继续使用 `panelContext.projectRootPath`；是否为链接工作树由 Git 的 `gitDir` 与 `gitCommonDir` 元数据判定。

## 3. 详细功能设计

### 3.1 LSP 支持
- **技术选型**：`@codemirror/lsp-client` 连接 main 托管的 stdio 语言服务器；provider registry 内置 TypeScript、Pyright、gopls 和 rust-analyzer provider。
- **编辑器能力**：受支持文件提供诊断、补全、悬停信息和跳转定义；跨文件定义通过 Files 控制器打开目标文件并定位。TS/JS 使用内置 server，Python、Go、Rust 在本机找到对应 server 时启用。
- **宿主能力**：`LspSessionHost` 负责进程复用、JSON-RPC framing、初始化、请求超时、窗口所有权和进程退出清理。
- **资源策略**：支持全局关闭、链接工作树统一开关、空闲回收、本地/远程工作区上限和 LRU 回收。
- **只读查询**：面向语言工具调用的 IPC 只允许声明、定义、类型定义、实现、引用、符号和诊断查询；拒绝 rename、executeCommand 等写入或执行方法。
- **降级行为**：provider 不可用、策略拒绝或进程退出时保留 CodeMirror 基础高亮和编辑能力；策略重新启用后，已打开编辑器自动重连。
- **与 Git 共存**：LSP 扩展、git gutter 和文件跳转共用同一编辑器会话，但不互相改写状态。

### 3.2 文件类型高亮增强
- **语言检测**：扩展 `EXTENSION_TO_LANGUAGE`（添加更多扩展 + 完整 YAML/JSON 支持），fallback 到 `text`。
- **高亮样式**：增强 `cm-highlight-style.ts`，支持主题变量 + 语义高亮（e.g. 函数名、字符串）。
- **集成**：`file-panel-status.tsx` 展示语言标签 + 高亮状态。

### 3.3 goToLine + 终端跳转
- **API**：`FileEditorController.goToLine` 同时校验 `editorSessionId` 与 `documentId`，把一基行列转换为 CodeMirror 偏移，夹取到文档边界后选中并居中滚动。
- **终端支持**：`TerminalOpenUrlEvent`、路径解析器和打开处理器保留 `file:///abs/path:10`、`file:///abs/path:10:5` 及普通路径后缀中的行列。
- **打开时序**：文件面板打开后使用 pending reveal 等待对应编辑器会话挂载，再执行精确定位，避免异步打开丢失跳转。
- **命令**：`pier.files.editor.goToLine` 注册到命令面板和编辑器菜单，默认快捷键为 `Mod+Shift+G`；输入支持 `line`、`line:column`、逗号和中文逗号。

### 3.4 编辑器设置（Wrap/Tab/Language/EOL）
- **自动换行**：通过独立 `Compartment` 动态应用 `EditorView.lineWrapping`。
- **制表符宽度**：通过独立 `Compartment` 动态应用 `EditorState.tabSize`，支持 2、4、8，并对旧值做安全归一化。
- **默认语言**：文件扩展名无法识别时，可选择自动、纯文本或任一已支持的语法语言；已识别文件仍以路径推断结果为准。
- **换行符**：CodeMirror 内部统一使用 `\n`；已有文件保存时保留检测到的 LF/CRLF，混合换行继续走显式规范化动作。新建文件使用持久化的 Auto/LF/CRLF 偏好，Auto 在 Windows 选择 CRLF，其余平台选择 LF。
- **实时同步**：插件 configuration 变更后，`FileEditorViewCoordinator` 对所有已打开会话执行 compartment reconfigure；无需重建 EditorView。
- **设置入口**：上述选项由 Files 插件设置页自动生成；宿主“工作区”页仅管理跨插件的语言服务进程策略，两个开关的职责与文案已区分。

### 3.5 跨模块协调
- **文件控制器**：统一处理会话安全的定位与跨文件打开。
- **终端 URL 处理器**：解析器只产出规范化目标，处理器负责打开面板并排队定位。
- **设置同步**：Files 编辑器偏好走插件 configuration；宿主资源策略走 `preferences.lsp`，职责不重叠。
- **Git 能力**：git gutter、LSP 和 go-to-line 共享同一 CodeMirror 会话与面板上下文。

## 4. 实现步骤

1. [x] 扩展终端行列契约、解析器和打开处理器。
2. [x] 添加会话安全的 `goToLine` API、命令、快捷键和异步 pending reveal。
3. [x] 将自动换行、制表符宽度、默认语言和 LSP 扩展接入独立 compartments。
4. [x] 增加 Files 插件的持久化编辑器设置和宿主语言服务资源策略设置。
5. [x] 实现 provider registry、stdio 进程宿主、preload IPC 和 CodeMirror LSP 客户端。
6. [x] 完成工作树识别、进程复用/回收、权限与只读查询边界。
7. [x] 完成 Vitest、真实 TypeScript 语言服务器测试、Electron 设置重启测试和构建验证。

## 5. 依赖与边界
- **renderer 侧**：Files 插件通过控制器、插件 configuration 和 `window.pier.lsp` preload facade 组合编辑器能力。
- **main 侧**：provider registry、工作区策略、LSP 进程与会话生命周期。
- **shared**：终端行列契约、LSP 策略/会话/只读查询契约和文件 URI 转换。
- **测试**：解析器、控制器、工作树识别、策略、进程宿主、设置持久化、真实 TypeScript 定义跳转和 Electron 设置重启路径。
- **风险**：CM 实例重配置导致闪退（已用 `file-editor-view-coordinator` 规避）；LSP 首次启动耗时（可做异步）。

## 6. 验证标准
- 终端 URL `file:///path:10:5` 能打开文件并跳转到第 10 行第 5 列。
- 设置页 `Wrap/Tab/Language/EOL` 持久化并实时生效。
- LSP 启用后提供诊断、补全、悬停和跨文件跳转定义；关闭后释放进程，重新启用后恢复连接。
- `goToLine` 命令、快捷键和一基行列边界处理可用。
- 与 git-gutter、review 面板无缝。

## 7. 后续规划
- 完善 Python、Go、Rust 语言服务器的安装发现与不可用状态说明。
- 为终端 Composer 增加显式“打开文件并跳转”菜单。
- 继续扩充多语言高亮主题，并保持深浅主题变量一致。

---


**参考**：遵循 `AGENTS.md` 的插件边界、`configuration` 持久化、`Compartment` 抽象模式。

## 8. 落地记录（2026-07-29）

### 已完成

- 终端 URL 与普通终端路径支持 `:line[:column]`，异步打开文件后可靠定位。
- `pier.files.editor.goToLine` 已接入命令面板、编辑器菜单和 `Mod+Shift+G`。
- 自动换行、制表符宽度、默认语言、默认换行符和编辑器语言功能开关由 Files 插件 configuration 持久化并实时重配。
- LSP 已完成 main / preload / renderer 全链路：TS/JS 使用内置 `typescript-language-server`，Python、Go、Rust 分别接入 Pyright、gopls、rust-analyzer provider；编辑器支持诊断、补全、悬停、跳转定义和跨文件打开。
- 宿主语言服务策略已接入工作区设置：全局开关、链接工作树开关、空闲回收时间、本地/远程工作区上限。
- 会话具备窗口所有权校验、读取权限校验、只读方法白名单、JSON-RPC 初始化、超时、引用计数、LRU 和退出清理。
- 应用关闭前强制刷新 preferences，设置在立即退出并重启后仍可恢复。

### 验证

- Vitest 覆盖终端解析、行列定位、编辑器偏好、工作树身份、LSP 策略、进程宿主和只读查询契约。
- 真实 `typescript-language-server` 进程测试完成跨文件定义查询。
- Playwright Electron 测试验证工作区语言服务设置渲染、修改、关闭应用和重启恢复。
- `pnpm build:electron` 构建通过，preload sandbox 边界检查通过。

### 后续扩展

- 完善 Python、Go、Rust 语言服务器的安装发现、打包策略和不可用状态说明；provider registry 与协议链路已经就绪。
- 为引用查找和重命名设计带预览、冲突处理与撤销的写入工作流；当前只读查询边界不开放这些操作。
- 终端 Composer 可继续增加显式“打开文件并跳转”菜单，但当前 URL 和路径点击主路径已经完成。
