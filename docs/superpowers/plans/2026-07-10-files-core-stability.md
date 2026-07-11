# Files 核心稳定性与功能补全实施方案

> 日期：2026-07-10
> 状态：P0 数据安全实现中；完整静态检查、低并发全量测试、`pnpm build` 与当前工作区启动/关闭 Electron 回归已通过，发布级恢复验证尚未完成
> 范围：`pier.files` 的文件核心能力；不包含文件到 Agent 的上下文桥

## 结论

`pier.files` 已经具备一个可用文件工作区的主体：延迟加载文件树、Git 状态装饰、常用文件操作、预览与固定标签、组内标签隔离、CodeMirror 编辑、文件内查找替换、自动保存、外部修改冲突提示、草稿恢复和安全 Markdown 预览。

与本机 Cursor 3.2.16（VS Code 1.105.1 工作台基础）及 VS Code、Zed、JetBrains 系列产品相比，本分支开始实施前的主要差距不在代码智能，而在文件核心闭环：

1. 数据安全还没有形成可信边界：固定 UTF-8 读写、仅靠 `mtime` 判断冲突、2 MiB 以上草稿静默拒绝、多窗口草稿键冲突、插件停用可能清理持久草稿，以及回收 dirty 文件或目录时可能连同未保存内容一起删除。
2. 文件落盘流程不完整：临时文档没有“另存为”，编码、换行符、BOM、文件权限和符号链接语义未建模。
3. 项目导航能力不足：没有快速打开文件和可持续浏览的项目内容搜索；现有文件树搜索会递归加载整棵可见目录树，现有静态 quick pick 也不能承载异步路径查询。
4. 大型仓库缺少限流与取消：目录列举无分页，搜索无结果上限，树、搜索和监听缺少共享 glob 语法、清晰的策略来源及隐藏打开文档的监听保障。
5. 查看与比较能力不完整：二进制只靠前 8000 个字符中的 NUL 粗判，图片没有原生预览，差异比较主要服务于保存冲突。

本方案按“先保数据，再补发现，最后补体验”的顺序实施。编辑器内核继续使用 CodeMirror，不考虑更换为 Monaco；文件到 Agent 的上下文桥、LSP 语义能力、多根工作区和第三方文件系统提供器全部后置，避免扩大当前数据安全交付轮的架构面。

## 当前实施状态

本文同时承担目标方案、任务清单和实施台账三种职责。后文“实施前现状证据”和差异表均指本分支开始实施前的基准；本节是 2026-07-10 当前工作区的权威状态。不能因为单元测试通过就把尚未完成的异常退出、安装包和人工恢复验证写成已交付。

| 工作包 | 当前状态 | 已落地证据 | 仍阻塞完成的事项 |
| --- | --- | --- | --- |
| 0A 数据安全行为基准 | 进行中 | 文件服务、文档控制器、文档 store、文件面板的既有回归已扩充 | 多窗口真实运行、回收目录和提交后崩溃的端到端基准仍需补齐 |
| 1 文档读写安全边界 | 安全写入主链已落地 | `file-document-codec.ts`、`file-document-reader.ts`、`file-safe-writer.ts`、`file-path-transaction-lock.ts` 及对应测试 | 路径操作需补规范身份锁与最终符号链接语义；macOS ACL、扩展属性和所有者策略需发布验证 |
| 2 renderer 文档模型 | 进行中 | 编码、换行、修订、只读、耐久未知和磁盘删除状态已进入统一文档模型 | 外部删除后的“原路径重新创建”交互与端到端证据未完成 |
| 3 草稿与关闭屏障 | 进行中 | 按窗口所有者和代际持久化、紧急副本、插件生命周期屏障、窗口关闭协调器及单元测试已落地；真实 Electron 已覆盖启动中关闭、草稿持久化故障导致的关闭否决与修复后重试，以及多窗口焦点记录恢复 | 损坏条目可见诊断、8 MiB 强杀恢复、旧草稿人工认领和真实双窗口同键恢复尚未完成 |
| 4 另存为与全部保存 | 进行中 | 原生保存目标 IPC、主进程回执、面板重绑、布局耐久屏障和一次性全部保存反馈已落地 | 启动全局判别孤儿记录、分类汇总、项目外重启和未编辑临时文档三入口端到端证据未完成 |
| 5 路径操作保护 | 进行中 | source 影响检查、dirty 守卫、无覆盖移动、转临时文档和导航历史迁移已落地 | 统一 main 操作令牌、目标规范身份、失败补偿、持久操作日志、启动恢复和强杀验证未完成 |
| 0B、6–10 发现与规模 | 待实施 | 无 | 快速打开、项目搜索、分页、取消、搜索运行时和双架构安装包验证 |
| 11、14 查看与比较 | 待实施 | 现有保存冲突比较继续保留 | 图片/二进制查看和通用差异视图 |
| 12、13 编辑与树操作补全 | 待实施 | 现有 CodeMirror 编辑和基础树操作继续保留 | 文件级设置、剪切粘贴、排序、全部折叠和批量结果治理 |

当前结论：P0 还不能宣称完成或可发布。最短阻塞链是“另存为启动全局判别 → 路径统一身份锁/操作令牌/持久日志与启动恢复 → 8 MiB/多窗口/强杀端到端验证 → 双架构安装包验证”。P1、P2 不阻塞先完成 P0，但不得混入 P0 的数据安全承诺。

文件界面已进一步收敛：编辑区顶部不显示“保存/另存为”按钮，保存安全链仍由 `Cmd+S`、自动保存和关闭保护复用；目录树不提供手动“刷新”，文件系统监听是树与已打开文档的新鲜度来源。macOS 只上报已知目录自身时会重列已展开分支，watch 启动失败会按 250 ms 至 5 s 的有界退避持续重试，不能以静默失效换取界面简化。删除入口统一显示“删除”，执行层仍移动到系统回收站，父子多选会归一为最小路径集，保留可恢复语义且不产生后代路径误报。

## 总体方案范围

### 当前交付轮

当前工作区实施的是数据安全轮，即任务 0A、1–5。发现与规模轮、基础编辑轮以及查看与比较增强仍是总体任务清单，不属于当前交付完成口径；任务 11、14 只有被目标版本明确纳入时才进入该版本发布门槛。

### 纳入

- 文本文档读取、分类、编码、换行符、BOM 和修订版本。
- 安全写入、外部冲突检测、文件权限和符号链接处理。
- 可确认、可恢复、可观测的草稿保护。
- 所有可编辑文档的“另存为”、全部保存和文档身份迁移。
- 回收、移动、重命名、覆盖和外部删除对 dirty 文档的统一保护。
- 快速打开文件、项目内容搜索和可取消查询。
- 大目录分页、搜索限流和三类排除策略治理。
- 常见图片预览、二进制摘要、通用差异比较。
- 编辑器基础能力补齐：跳转行、自动换行、缩进、编码和换行符状态。
- 对应单元、组件、端到端、打包运行态和性能验证。

### 明确后置

- 文件到 Agent 的上下文桥，以及 Agent 选择、会话路由和上下文回执。
- `@file`、拖拽文件到 Agent、将选区附加到 Agent 等交互。
- LSP、符号索引、定义跳转、引用查找、重命名、诊断和代码补全。
- 多根工作区、远程文件系统、虚拟文件系统和第三方文件提供器。
- 音频、视频、Notebook、Office 文档等完整媒体工作台。
- 项目范围批量替换；发现与规模轮只交付只读搜索，批量替换必须另做预览、撤销与失败恢复设计。
- 本地文件历史转入独立后续架构方案，不与异常退出恢复草稿混为一套存储。

### 固定技术决策

- `pier.files` 继续使用 CodeMirror 作为编辑器内核。
- 不评估、不实施 Monaco 迁移，也不把 Monaco 作为后续待办。
- 文件级能力通过 CodeMirror 扩展、主进程文件服务和独立语言服务边界补齐，不用更换编辑器内核代替架构建设。
- 只有未来出现 CodeMirror 无法合理满足、且已经形成独立需求和技术证据的硬约束时，才允许新建专项方案重新讨论编辑器内核；本方案不预留迁移路径。

## 架构敏感判断

这是架构敏感任务，涉及插件边界、主进程文件系统所有权、IPC、持久化、查询数据流、全局快捷入口、打包和测试体系。不能把它处理成若干独立 UI 功能。

本方案的结构性完成条件是：

- renderer 不再自行递归遍历整个文件树完成项目搜索。
- `pier.files` 的所有文档写入都基于主进程返回的 revision，不再只依赖 `mtime`；旧插件 API v1 另按兼容边界处理，不扩大安全承诺。
- 无法安全识别的文本不会以 UTF-8 替换字符打开后再静默覆盖原文件。
- 草稿写入必须返回明确结果；界面只有收到持久化确认后才能显示“已保护”。
- 临时文档可以选择目标路径并完整迁移为磁盘文档。
- 开发态、构建态和安装包中的搜索引擎行为一致，不依赖用户系统预装 `rg`。
- 各层所有权、失败反馈和验收证据均由测试锁定。

## 实施前现状证据

本节冻结的是 2026-07-10 本工作区开始修改前的结构，用来解释任务来源；实施后的真实状态以“当前实施状态”一节和验收矩阵为准。

### 已有基础

- `src/main/services/file-service.ts` 已统一处理根目录内的列举、读取、写入、移动、复制、回收站和路径越界检查。
- `src/plugins/builtin/files/renderer/file-document-lifecycle.ts` 已把加载、保存、面板生命周期和文档状态拆开。
- `src/plugins/builtin/files/renderer/files-document-store.ts` 已具备共享文档、dirty、磁盘修改和草稿恢复状态。
- `src/plugins/builtin/files/renderer/file-editor-view-session.ts` 已建立 CodeMirror 会话复用和语言扩展切换。
- `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx` 已具备延迟加载、展开状态、搜索条和 Git 状态显示。
- `src/plugins/builtin/files/renderer/files-watch-hub.ts` 已按根目录共享监听。
- 文件标签已按 dockview group 隔离，文件内容文档可以跨标签共享。

### 实施前已确认的缺口

| 位置 | 当前行为 | 风险 |
| --- | --- | --- |
| `file-document-loader.ts` | 编辑上限 10 MiB；读取后只检查前 8000 字符是否含 NUL | 二进制和未知编码判断过粗 |
| `file-service.ts` | `readText` / `writeText` 固定 UTF-8 | 非 UTF-8 文件可能被替换字符污染后写回 |
| `file-service.ts` | 写冲突只比较 `expectedMtimeMs` | 时间戳精度、恢复和快速连续写可能漏判 |
| `file-service.ts` | 临时文件后 rename | 需要验证并保留权限、符号链接目标语义和失败恢复 |
| `file-drafts-service.ts` | 单条草稿上限 2 MiB，超限直接 return | 2–10 MiB 已编辑文档可能被误认为已保护 |
| `file-drafts-service.ts` | 所有草稿存于单个 `file-drafts.json`，最多 200 条 | 单文件放大、淘汰不可见、损坏影响面大 |
| `files-document-store.ts` | 临时文档 id 每个 renderer 都从固定序号开始，磁盘草稿键不含窗口身份 | 多窗口可能覆盖彼此的临时文档或 dirty 草稿 |
| `files-document-store.ts` | 清理内存状态时可以连同持久草稿一起删除 | 插件停用和运行态重载可能误删恢复数据 |
| `file-tree-actions.ts` | 回收文件或目录后直接移除受影响文档和草稿 | dirty buffer 可能在普通回收操作中丢失 |
| `files-document-factory.ts` | 磁盘文档只有 `save`，临时文档没有文件系统能力 | “另存为”链路缺失 |
| `files-tree-search-loader.ts` | 搜索前递归加载所有可见目录，并发 8 | 破坏延迟加载，大仓库内存与延迟不可控 |
| 插件 quick pick facade | 只有静态 `items`，无查询变化回调、增量更新句柄或虚拟化 | 不能直接实现 10 万路径下的增量快速打开 |
| `file-watch-service.ts` | 监听排除使用固定目录段且按根合并订阅者规则，轮询兜底每 5 秒发根级变化 | 缺少共享 glob 语法和分域策略，树隐藏规则可能压掉已打开文档变化，退化状态不可见 |
| `file-editor-view-session.ts` | `basicSetup` 加语法扩展 | 可编辑，但缺少文件级基础控制和通用比较 |
| 打包配置 | 未包含 `ripgrep` 或等价搜索运行时 | 不能假设安装机器存在 `rg` |

现有核心测试已验证：

- `tests/unit/main/file-service.test.ts`
- `tests/unit/main/file-watch-service.test.ts`
- `tests/unit/renderer/file-editor-controller.test.ts`
- `tests/unit/renderer/files-tree-search-loader.test.ts`
- `tests/unit/renderer/files-tree-store.test.ts`
- `tests/component/files-file-panel.test.tsx`
- `tests/component/ui-file-tree.test.tsx`

2026-07-10 实施前定向运行结果：7 个测试文件、177 个测试全部通过。这只证明基准行为稳定，不覆盖新完成标准，也不是当前测试总数。

## 与 Cursor 和业界产品的差异

### 对比口径

- Cursor：以本机 `/Applications/Cursor.app` 3.2.16 安装包为主证据，官方文档只补充产品语义。`Info.plist` 的 `CFBundleShortVersionString` 与 `CFBundleVersion` 均为 `3.2.16`；`Contents/Resources/app/product.json` 声明 `vscodeVersion: 1.105.1`；安装包内既有 `git`、`markdown-language-features`、`media-preview`、`merge-conflict`、`references-view`、`search-result` 和 `typescript-language-features` 等工作台扩展，也有 Cursor 自有的 `cursor-file-service`、`cursor-explorer`、`cursor-retrieval` 和 `cursor-agent-exec`。`cursor-file-service` 和 `cursor-retrieval` 的 manifest 描述为处理索引与检索，`cursor-explorer` 声明为工作区扩展，`cursor-agent-exec` 则明确描述 Agent 可在用户权限和批准下与文件、命令及工具交互。由此只能确认其安装包跨越工作台、索引检索和 Agent 文件执行边界，不是一个孤立 file 插件；manifest 不能证明具体的文件附加交互、Agent 身份选择或上下文回执路由。
- VS Code：参考其基本编辑、界面和搜索能力。
- Zed：参考其文件查找、项目搜索和导航模型。
- JetBrains：参考 Project 工具窗口和 Local History。
- 本方案只比较文件核心，不把 Agent 上下文和代码智能计入当前交付范围。

参考资料与证据：

- Cursor 对比以 2026-07-10 本机 3.2.16 安装包中的 `product.json`、内置扩展目录及上述四个 Cursor 自有扩展的 `package.json` 为稳定证据。这里仅记录安装包声明和边界推断，不把自有扩展的内部实现视为已验证；Cursor 旧版 `Files and Folders`、`Working with Context` 深链在核对时会跳转到文档首页，因此不再作为具体能力的验收依据。
- [VS Code Basic Editing](https://code.visualstudio.com/docs/editing/codebasics)
- [VS Code User Interface](https://code.visualstudio.com/docs/editing/userinterface)
- [VS Code Local History](https://code.visualstudio.com/docs/sourcecontrol/overview#_timeline-view)
- [Zed Finding and Navigating](https://zed.dev/docs/finding-navigating)
- [JetBrains Project Tool Window](https://www.jetbrains.com/help/idea/project-tool-window.html)
- [JetBrains Local History](https://www.jetbrains.com/help/idea/local-history.html)

### 差异清单

| 能力 | `pier.files` 实施前基准 | Cursor / VS Code 体系 | Zed / JetBrains 参考 | 本方案决策 |
| --- | --- | --- | --- | --- |
| 文件树延迟加载 | 已有，直接子级按需加载 | 成熟 | 成熟 | 保留 |
| 新建、重命名、移动、复制、回收站 | 已有 | 成熟 | 成熟 | 保留现有批量能力，补剪贴板与 dirty 守卫 |
| 预览标签、固定标签、分组 | 已有，且已做组隔离 | 成熟 | 成熟 | 保留并回归 |
| 文本编辑和文件内查找替换 | 已有 | 成熟 | 成熟 | 补文件级设置和状态 |
| 快速打开文件 | 缺失 | 核心入口 | 核心入口 | P1 补齐 |
| 项目内容搜索 | 缺失 | 搜索、跨文件替换、Search Editor | 持续结果视图或可编辑结果 | P1 先补可持续浏览的只读搜索；替换仍是后续差距 |
| 搜索取消、限流和打包一致性 | 缺失 | 成熟 | 成熟 | P1 补齐 |
| 编码、BOM、换行符 | 未建模，固定 UTF-8 | 可识别和切换 | 可识别 | P0 补齐安全子集 |
| 冲突判断 | `mtime` | 更完整的模型与冲突处理 | 成熟 | 改为不透明修订版本 |
| 异常退出恢复和草稿保护 | 已有但存在静默拒绝 | 成熟 | 成熟 | P0 根治 |
| 另存为 | 缺失 | 标准能力 | 标准能力 | P0 补齐 |
| 全部保存 | 缺失 | 标准能力 | 标准能力 | P0 补齐 |
| 图片和二进制预览 | 缺失 | 图片、音频、视频等媒体预览 | 常见格式预览 | P2 补图片与摘要 |
| 通用差异比较 | 主要用于保存冲突 | 多入口差异编辑器 | 成熟 | P2 补齐文件级比较 |
| 基础编辑控制 | 部分缺失 | 跳转行、换行、缩进、语言/编码/EOL 控制 | 成熟 | P1 补齐 |
| 大目录分页 | 缺失 | 有搜索、排除和虚拟化保护 | 有索引和后台扫描 | P1 补齐 |
| 文件树多选、批量移动/回收站 | 已有 | 成熟 | 成熟 | 保留并补 dirty 守卫和部分失败汇总 |
| 文件树剪切、粘贴、全部折叠和排序 | 缺失 | 成熟 | 成熟 | P1 补齐 |
| 本地文件历史 | 缺失 | Timeline / Local History | Local History | 后续独立方案，不复用草稿服务 |
| 代码智能 | 仅语法高亮 | 语言服务丰富 | 语义索引丰富 | 后置 |
| 文件到 Agent 上下文 | 后续设计 | 本地包只证实 `cursor-agent-exec` 的 Agent 文件执行边界；具体文件附加和上下文路由未由 manifest 验证 | 不纳入当前对比口径 | 明确后置；需另行解决 Agent 身份、会话路由、权限和回执 |

## 目标和完成标准

### 目标一：数据不静默丢失或损坏

- UTF-8、UTF-8 BOM、带 BOM 的 UTF-16 LE、带 BOM 的 UTF-16 BE 文本可正确读取、显示和按原格式写回；无 BOM UTF-16 不自动猜测。
- 未识别编码、二进制和超大文件返回明确分类，默认只读或拒绝打开，不以普通文本写回。
- 保存使用主进程生成的不透明 `revision` 做乐观并发控制。
- 保存保持原文件 POSIX mode；符号链接按本文定义的语义处理。
- 任何草稿写入失败、超限或配额不足都必须被 renderer 感知并向用户反馈。
- 插件停用、热重载和内存清理不得删除尚未显式保存或丢弃的持久草稿。
- 已显示“已保护”的草稿必须已经完成条目原子提交与耐久同步；多窗口草稿互不覆盖。
- 回收、覆盖或外部删除不得自动清除 dirty buffer；只有用户明确丢弃才能删除其草稿。

### 目标二：文件创建到落盘闭环

- 临时文档和磁盘文档都可以“另存为”；磁盘文档另存后原文件保持不变。
- 另存为采用可恢复状态机，不宣称“写盘和 renderer 身份迁移跨进程原子”。
- 目标已打开、目标已存在、写入失败、用户取消等分支都有确定行为。
- 面板参数、标题、语言模式、导航历史、草稿键和 dirty 状态同步迁移。
- “全部保存”覆盖当前窗口跨 group 文档和部分失败汇总；不同 Electron 窗口保持独立。

### 目标三：在大型项目中可发现、可取消

- `Cmd+P` 打开异步快速选择会话；当前窗口按 root 保存有界 MRU 提示，主进程把它与模糊匹配一起用于完整候选集排序后再截 top-K。
- `Cmd+Shift+F` 打开可持久的 Files 搜索面板，支持大小写、整词、正则、包含和排除。
- 查询由主进程执行并分批返回，renderer 不加载整棵树。
- 每次查询可取消；同一 consumer owner 的新查询替换旧查询，Quick Open 与内容搜索等不同 owner 可以并行且互不取消。
- 路径结果和内容结果均有明确上限、截断提示和耗时指标。
- 开发环境与正式安装包使用同一搜索运行时。

### 目标四：常见文件可安全查看和比较

- PNG、JPEG、GIF、WebP、SVG 提供受控预览。
- 其它二进制显示类型、大小和“在系统中显示”等摘要操作，不显示乱码编辑器。
- 任意两个已打开文本文件可以进入通用差异视图。
- 外部冲突比较复用同一差异组件，不维护第二套比较实现。

## 所有权划分

| 层 | 所有权 | 不负责 |
| --- | --- | --- |
| `FileService` | 路径作用域、文件元数据、读取字节、安全写入、权限、符号链接、目录分页 | 编辑器状态、搜索结果展示 |
| `FileDocumentCodec` | 文本/二进制分类、编码、BOM、换行符、规范化、写回编码 | 文件系统权限、UI |
| `FileDraftsService` | 草稿持久化、配额、迁移、原子写、清理策略、写入回执 | dirty 判断、关闭确认 |
| `FileQueryService` | 搜索进程、遍历策略、排除规则、取消、分批结果、临时索引 | 快速打开排序展示、面板导航 |
| shared / preload | Zod schema、类型、窄 IPC、事件解绑和能力边界 | 业务策略 |
| renderer 宿主 | 快捷键路由、可更新的异步 quick pick 会话、退出刷新屏障、原生保存对话框桥、插件能力断言 | 文件内容真相 |
| `pier.files` | 文档 buffer、dirty、编辑会话、标签语义、搜索面板、结果打开、查看器选择和路径操作前的 dirty 策略 | 直接访问 Node 文件系统 |
| `packages/ui` | 通用搜索结果行、文件图标、加载/空/错状态等无业务组件 | 项目搜索和文件保存策略 |
| 测试 | 跨层完成标准和回归证据 | 用实现细节替代用户行为 |

补充约束：

- 路径身份继续使用 `projectRootPath` / `root + relative path`，不引入 `projectId`。
- 内置插件仍属可信代码；`file:read` / `file:write` 是工程纪律边界，不宣称为恶意插件安全沙箱。
- 旧 `file.readText` / `file.writeText` 暂时按 v1 原有语义保留并标记 deprecated，避免静默破坏兼容性；它们不在 revision 安全保证内，也禁止新增调用。`pier.files` 和现有官方调用方迁移完成后，再通过独立 API 版本方案移除，不能借“兼容”改变 v1 行为。

## 核心数据模型

### 文档读取结果

新增可判别联合，不再用“字符串或抛错”表达所有情况：

```ts
type FileDocumentReadResult =
  | {
      kind: "text";
      root: string;
      path: string;
      canonicalPath: string;
      contents: string;
      format:
        | { encoding: "utf8"; bom: false | true }
        | { encoding: "utf16le" | "utf16be"; bom: true };
      eol: "lf" | "crlf" | "cr" | "mixed" | "none";
      revision: string;
      size: number;
      mode: number | null;
      writable: boolean;
    }
  | { kind: "binary"; root: string; path: string; canonicalPath: string; revision: string; mtimeMs: number; size: number; mime: string | null }
  | { kind: "unsupported-encoding"; root: string; path: string; size: number }
  | { kind: "unsupported-file"; root: string; path: string; fileType: "directory" | "fifo" | "socket" | "device" }
  | { kind: "too-large"; root: string; path: string; size: number; limit: number };
```

读取规则：

- 主进程先用 `lstat` / `stat` 拒绝目录、FIFO、socket 和 device，再读取普通文件字节并计算分类；renderer 不再通过字符串中的 NUL 自行猜测。
- 文本内容进入编辑器前统一为 `\n`，原始 `eol` 单独保存。
- `mixed` 文件第一阶段只读，并给出“规范化后编辑”的显式动作；启用后统一为用户选择的 EOL。字节级往返承诺只适用于非 mixed 文件。
- 编码和 BOM 用可判别联合建模：UTF-8 支持有/无 BOM，UTF-16 LE/BE 在当前数据安全轮只支持有 BOM；无 BOM UTF-16 返回 unknown。分类顺序固定为文件类型、大小、已知 BOM、严格 UTF-8 校验、二进制特征、未知编码。畸形 UTF-16、NUL 和控制字符有独立测试。
- `canonicalPath` 是根内真实目标的规范化相对路径，只用于发现路径别名和冲突提示，不作为共享文档 key。第一阶段文档身份仍是 locator `root + path`；直接路径和符号链接路径不合并 buffer，任一路径保存后另一别名通过 revision 进入冲突。
- `revision` 是主进程生成的不透明值，至少覆盖内容摘要、规范化真实目标身份和符号链接链。链接被改指到内容相同的另一目标时也必须冲突，renderer 不解释其结构。
- MIME 只能帮助选择查看器，不能作为安全判断的唯一依据。

### 文档写入请求

```ts
interface FileDocumentWriteRequest {
  root: string;
  path: string;
  contents: string;
  format:
    | { encoding: "utf8"; bom: false | true }
    | { encoding: "utf16le" | "utf16be"; bom: true };
  eol: "lf" | "crlf" | "cr";
  expected:
    | { kind: "revision"; revision: string }
    | { kind: "absent" };
}

type FileDocumentWriteResult =
  | {
      kind: "written";
      committed: true;
      durability: "confirmed" | "unknown";
      revision: string;
      mtimeMs: number;
      size: number;
      mode: number | null;
    }
  | { kind: "conflict"; reason: "revision-mismatch" | "target-exists" | "target-missing" }
  | { kind: "not-writable"; message: string };

type FileConfirmDurabilityResult =
  | { kind: "confirmed"; revision: string }
  | { kind: "revision-mismatch" }
  | { kind: "failed"; message: string };
```

另存为覆盖检查不复用 `readDocument`。新增 `inspectWriteTarget`，不返回正文：

```ts
type FileWriteTargetInspection =
  | { kind: "absent" }
  | {
      kind: "existing";
      revision: string;
      size: number;
      fileType: "text" | "binary" | "unsupported-encoding" | "too-large";
    }
  | { kind: "not-writable"; message: string }
  | { kind: "unsupported-file"; fileType: "directory" | "fifo" | "socket" | "device" };
```

它以流式摘要计算任意普通文件 revision，因此覆盖二进制、未知编码或超大目标时仍能在用户确认后携带 `expected revision`；非普通文件一律禁止覆盖。

`file.confirmDurability({ root, path, expectedRevision })` 只核对 revision 并重新同步文件和父目录，不接收正文、不执行 rename。目标缺失或 revision 变化返回 `revision-mismatch`；只有两级同步成功才返回 `confirmed`。

写入规则：

1. 解析并验证根内路径。
2. 对符号链接解析真实目标；真实目标必须仍在根内。临时文件建立在真实目标目录，提交到真实目标，不能替换链接目录项。
3. 同一规范化真实路径在 Pier 主进程内串行；写临时文件并 `fsync` 后，在提交前最后一次验证 `revision` 或 `absent`。
4. 按目标编码、BOM 和换行符生成字节，并把可保证保留的元数据复制到临时文件。
5. `absent` 使用 no-replace 发布，目标已出现时返回 `target-exists`，禁止普通 rename 覆盖。
6. 已存在目标在最后校验后原子替换，再同步父目录。
7. rename / no-replace 成功是提交点。提交前失败保证原文件不变；提交后父目录同步失败返回 `committed: true, durability: "unknown"`，不能伪装成“没有写入”。
8. 返回新的 revision、mtime、大小和 mode，并清理未提交临时文件。

revision 是乐观并发保护，不是跨进程强 CAS。进程内锁能阻止 Pier 自身并发写，提交前复检能缩小竞态，但外部进程仍可能在最后复检和替换之间写入。若未来要求跨进程零竞态，必须另行引入平台文件协调机制，不能扩张 revision 的承诺。

元数据策略必须在任务 1 的 macOS 技术验证中定案：

- POSIX mode、根内符号链接和普通文件内容为必须保证项。
- hardlink、owner、ACL 和 xattr 必须检测并记录验证结果。
- 不能安全保留的元数据不得静默丢弃；实现应拒绝安全写并给出可操作错误，或在专项产品决策后提供明确的非原子降级，不能默认降级。

符号链接语义固定为：

- 打开和保存：跟随根内符号链接并修改其目标，保留链接本身。
- 重命名、移动、复制、回收站：操作目录项本身，不隐式操作链接目标。
- 真实目标越出根目录：拒绝。
- 目录符号链接在文件树中显示为链接类型；列举请求携带祖先真实目录身份，服务端发现重复身份时返回循环结果，不能依赖无状态 `file.list` 自己猜测。

### 草稿持久化结果

草稿接口必须返回明确状态：

```ts
type FileDraftWriteResult =
  | { kind: "stored"; key: string; generation: number; bytes: number; updatedAt: number }
  | { kind: "rejected"; reason: "entry-too-large" | "quota-exceeded" }
  | { kind: "failed"; message: string };
```

建议目录：

```text
{userData}/file-drafts/
  index.json
  entries/
    <window-owner-id>/
      <sha256(draft-key)>.json
```

- 每个条目独立原子写并使用 `0600`，目录使用 `0700`，避免一个大 JSON 损坏所有草稿。
- `index.json` 只保存版本、键摘要、大小、更新时间和迁移状态，并且只是可从 entries 扫描重建的缓存，不是第二事实源。
- 草稿请求携带稳定窗口记录身份和单调 `generation`；untitled id 使用 UUID。两个窗口编辑同一磁盘文件时分别保留草稿，旧 generation 的回执不能把新内容标成“已保护”。
- `stored` 只在条目临时文件写入、`fsync`、原子提交和必要目录同步完成后返回，不表示“进入内存队列”。
- 初始建议单条序列化上限 32 MiB、总配额 256 MiB；最终值要通过 10 MiB 可编辑文件和双份 buffer 夹具验证，且禁止静默拒绝。
- 服务端无法从 opaque value 可靠判断 dirty 或活跃状态，因此不得自动淘汰未显式删除的草稿；配额满时拒绝并反馈。
- 启动恢复固定使用 `listKeys(owner) + get(owner,key) + claimLegacy(...)`，禁止一次通过 IPC 传输最高 256 MiB 内容。owner 由 main 根据宿主窗口记录身份注入，插件 payload 不能自行填写。
- 从旧 `file-drafts.json` 一次性迁移；迁移成功后保留备份标记，下一稳定版本再清理。
- 恢复保证只覆盖界面已经显示“已保护”的 generation；“保护中”时异常退出可能损失尚未确认的最新防抖窗口，界面不得误报。

### 查询会话

项目内容搜索使用专用 IPC 事件流，不通过一次 `PierCommand` 返回巨型数组：

```ts
type FileQueryEvent =
  | { kind: "started"; queryId: string }
  | { kind: "batch"; queryId: string; items: readonly FileQueryItem[] }
  | { kind: "done"; queryId: string; reason: "completed" | "cancelled"; truncated: boolean; scanned: number; elapsedMs: number }
  | { kind: "error"; queryId: string; code: string; message: string };
```

建议通道：

- `PIER.FILE_QUERY_START`
- `PIER.FILE_QUERY_CANCEL`
- `PIER.FILE_QUERY_EVENT`

查询规则：

- main 以 `webContents.id + queryId` 作为会话主键，事件只定向发回发起 sender；cancel 只能终止同一 sender 的查询。
- 请求携带 owner，例如 `quick-open:<sessionId>`、`content-search:<panelId>`。同一 sender 内允许不同 owner 并行；只有同 owner 的新查询、owner 释放或项目根变化才取消旧会话。`destroyed` / `did-navigate` 取消该 sender 的全部进程组。
- preload 在 start 前完成事件订阅并校验每个事件 schema；每个查询恰好收到一个 `done` 或 `error` 终态，重复 cancel 幂等。
- host facade 在 start 前断言 `file:read`，查询事件不进入全窗口广播源。
- stdout 解析设置批次条数和字节上限，并实现背压；取消先终止进程组，超时后强制结束。
- 路径查询接收最多 100 条当前窗口、当前 root 的 MRU 路径提示，由主进程在完整候选集上合并模糊匹配和 MRU 得分后截 top-K，只向 renderer 返回最多 200 个候选。发现与规模轮的 MRU 不跨窗口、不跨重启，也不复用命令面板 action MRU。
- 内容搜索使用结构化输出；命中契约保留原始行文本和字节范围，renderer 显式转换到 CodeMirror 使用的 UTF-16 位置。中文、emoji、CRLF 和 UTF-16 文件必须有定位测试。
- 支持编码范围与 `readDocument` 一致；二进制和未知编码跳过并在完成统计中说明。

## 关键数据流

### 打开文件

1. 文件树或快速打开产生 `root + path`。
2. `pier.files` 请求 `files.readDocument`。
3. 主进程完成路径校验、字节读取、分类和修订版本计算。
4. 文本结果进入共享文档 store；保存编码、换行符、revision 和 mode。
5. 图片结果进入对应查看器；二进制、未知编码、超大文件进入明确状态页。
6. 加载失败使用带详情的 `context.dialogs.alert`；不只记录控制台。

### 编辑、草稿保护和保存

1. CodeMirror 变更更新内存 buffer 和 dirty。
2. renderer 草稿协调器按文档生成递增 generation，300–500 ms 防抖后写草稿，状态先变为“保护中”。
3. 收到同一 generation 的耐久 `stored` 才变为“已保护”；旧回执只能被忽略。
4. `rejected` 或 `failed` 显示持久错误状态，并用带详情弹窗说明；不得继续显示已保护。
5. 已存在文档保存携带 `expected: { kind: "revision" }`；新建目标携带 `expected: { kind: "absent" }`。
6. `durability: "confirmed"` 才更新为完全保存并删除草稿。`unknown` 可以更新磁盘 revision 并逻辑 clean，但必须进入 `durability-unknown`、保留带目标 revision 的恢复条目，禁止显示“已完全保护”或自动重试。
7. `durability-unknown` 恢复条目只能在三种情况下删除：同会话重新执行文件及父目录同步成功；应用重启后目标 revision 仍一致；用户明确丢弃。当前进程内只重新读取 revision 不能证明目录项已经耐久。
8. 修订冲突进入统一差异视图，用户明确选择重新加载、覆盖或另存为。
9. 插件停用、单窗口关闭和应用退出先进入宿主可等待的刷新屏障；屏障提交 renderer 待写 generation，再等待主进程 `FileDraftsService.flush()`。超时或失败时取消关闭并给出详情。

### 另存为

1. 用户对任意可编辑文本执行 `pier.files.saveAs`。
2. 宿主调用 Electron `dialog.showSaveDialog`，默认目录来自 `PanelContext.projectRootPath`；main 对选择结果调用 panel context resolver，返回可持久恢复的 `root + path + PanelContext`。项目内目标保留原 context，项目外目标使用新解析的 context。
3. 用户取消时不改变文档。
4. 用户选择目标后调用 `inspectWriteTarget`；已存在普通文件时取得无正文 revision，再走显式覆盖确认，确认后的写入仍用 revision 防止竞态覆盖；目录和特殊文件禁止覆盖。
5. 迁移是可重试状态机：目标写入提交 → 建立目标磁盘文档 → 重绑发起操作的 panel → 更新标题、语言、导航和 context → 清理源草稿。
6. 任一步在写入提交后失败，都保留源文档和草稿，并明确提示“文件已写入，界面迁移失败”；重启后可以按目标 revision 恢复，不宣称跨进程原子。
7. 同一源文档被多个 panel 共享时，只重绑发起操作的 panel；其它 panel 继续引用原文档及其 dirty buffer。若它是最后一个引用，才允许把源文档身份收缩为别名。
8. 目标已经打开且 dirty 时禁止覆盖，提供激活目标或换名；目标无未保存修改时经确认写入并合并到目标共享文档。

当前实现已完成步骤 1–4、主进程写入回执、目标文档建立、发起面板重绑、布局耐久刷新和失败提示；可恢复记录实际字段为 `operationId`、`phase: prepared | written`、`sourceDocumentId`、源/目标、`savedContents`、`format`、`eol`、发起 `panelId`/`panelGroupId` 以及 `writtenResult.revision`。仍缺的是启动全局判别：若布局已提交而恢复记录尚未删除就强杀，重启只会出现目标 panel，当前挂在源 panel 的恢复入口不会运行。必须持久化目标 panel 身份和绑定阶段，由启动协调器区分“目标已恢复、源仍恢复、两者皆无”并幂等收口。

### 全部保存

1. `pier.files.saveAll` 收集当前窗口满足 `dirty || needsSaveAs || durabilityUnknown` 的文档并按稳定顺序处理。
2. 有路径文档按各自 revision 保存；临时文档逐个进入另存为，用户可跳过或取消剩余操作。
3. `durabilityUnknown` 只重试文件与父目录同步并核对 revision，不重新写入正文。
4. 不同 Electron 窗口保持独立，不由一个窗口越权保存另一个窗口的 renderer buffer。
5. 部分失败使用详情弹窗列出成功、冲突、取消和失败项，不用多个 toast 轰炸用户。

### 路径操作影响打开文档

1. 回收、覆盖、移动或重命名前，main 以 `lstat` 返回规范化影响描述。source 是符号链接目录项时只影响该 locator 前缀；source 是普通文件或目录时，才用 canonical backing 前缀补充路径别名。
2. `pier.files` 按影响描述找出打开文档；无未保存修改的文档可以关闭或重映射，dirty 文档必须进入统一守卫。
3. 回收 dirty 文件或目录时提供“保存后回收、保留为临时文档后回收、丢弃后回收、取消”；多文件对话框列出受影响文档。“保留为临时文档”必须先创建 UUID、耐久写入同 generation 草稿并重绑相关 panel，全部成功后才执行 trash。
4. 覆盖目标若已打开且 dirty，默认禁止；移动和重命名使用持久操作记录：文件系统提交后再迁移 source、草稿键、面板参数和导航记录。renderer 迁移失败时保留记录和旧草稿，重启可继续，不能宣称跨进程原子。
5. 外部删除不关闭 buffer：文档进入 `deleted-on-disk`，保留草稿，用户可重新创建、另存为或丢弃。
6. 文件系统操作部分失败时只迁移成功项；失败项保持原身份并显示详细汇总。

当前实现已有进程内层级路径锁、source 影响检查、dirty 守卫、无覆盖移动、转为临时文档和打开面板/导航记录迁移，但尚未形成一次 main 操作令牌贯穿“影响检查、锁定、提交、renderer 迁移”。移动目标的规范身份仍由 renderer 以 `newPath` 近似，移动/复制/回收也未与安全写入统一锁住规范路径；main 提交前失败后，renderer 还缺少显式 abort 来恢复加载、保存和自动保存。目录与跨设备移动虽使用隐藏暂存项和排他目标保留，但尚无持久操作记录与启动清理，强杀后可能残留暂存项、空目标或源/目标副本。这些都是任务 5 的阻断项，不能以正常异常分支清理测试替代。

### 快速打开文件

1. `Cmd+P` 触发 `pier.files.quickOpen`。
2. 从当前 `PanelContext.projectRootPath` 建立路径查询。
3. 插件使用扩展后的异步 quick pick 会话：`onQueryChange(query, signal)` 发起/取消路径查询，宿主返回可 `update` / `close` 的句柄并保持输入、选中和焦点。
4. `pier.files` 维护当前窗口、按 root 隔离、最多 100 条的内存 MRU，并作为查询提示发送；主进程在完整候选集上合并 MRU、连续字符、文件名优先和路径深度得分后只返回 top 200。
5. 宿主 quick pick 列表虚拟化，任何时刻不得为上万候选创建 DOM。
6. 选择结果后在当前 group 打开或激活文件，并只展开到目标的祖先链。
7. 文件树 store 不因查询而载入其它目录。

### 项目内容搜索

1. `Cmd+Shift+F` 打开或激活 `pier.files.searchPanel`，而不是阻塞 overlay。
2. 每次条件变化防抖创建新 `queryId` 并取消旧查询。
3. 主进程启动已打包搜索引擎，传入大小写、整词、正则、包含、排除和 gitignore 规则。
4. 结果按批次进入 renderer，面板虚拟化展示文件、行号、预览和命中范围；panel params 只持久化查询条件，不保存结果全集，恢复时重新查询。
5. 用户选择结果后在既有文件 group 或相邻 group 打开并定位，搜索面板保持可见，可连续浏览多个命中。
6. 搜索排除提供“使用搜索排除和忽略文件”开关；它与树隐藏和 watcher 噪声策略共享 glob 解析器，但不强制结果相同。
7. 截断、取消、根切换、恢复重查、无结果和错误有独立状态；详细错误走弹窗。

## 明确禁止的反模式

- 禁止 renderer 为搜索递归调用 `file.list` 并把整棵树塞入 Zustand。
- 禁止依赖用户系统的 `rg`、`grep` 或 shell 环境。
- 禁止用 `readFile(..., "utf8")` 的替换字符结果直接覆盖未知编码文件。
- 禁止只用 `mtimeMs` 判断文件内容是否变化。
- 禁止草稿服务超限后 `return`，却让调用方认为已经保存。
- 禁止插件停用、面板重建或内存 store 清理顺带删除持久草稿。
- 禁止把文件正文、搜索结果全集或草稿放入 dockview `panel.params`。
- 禁止把搜索索引绑定到新的 `projectId` 注册表；根身份继续来自 `projectRootPath`。
- 禁止在搜索能力未通过 arm64、x64 安装包验证前上线入口。
- 禁止把静态 quick pick 当作异步路径查询容器，也禁止把 20,000 个路径候选传给 renderer。
- 禁止把项目内容搜索实现为打开首个结果就消失的阻塞弹层。
- 禁止以 Monaco 迁移解决文件能力差距；`pier.files` 的编辑器内核固定为 CodeMirror。
- 禁止在当前数据安全轮引入 LSP、多根工作区或 Agent 路由来“顺便解决”文件问题。
- 禁止项目内容批量替换直接复用单文件替换；它需要独立的预览、失败回滚和撤销设计。
- 禁止把 `.cursorignore` / `.cursorindexingignore` 混入文件核心搜索；它们属于 Cursor 的 Agent 检索语义，发现与规模轮只处理 gitignore 与 Files 自定义排除。
- 禁止把树隐藏、搜索排除和 watcher 噪声排除合并成一个结果策略；只共享 glob 语法和规范化。
- 禁止查询事件全窗口广播，或只用全局 `queryId` 作为会话身份。
- 禁止自动淘汰服务端无法证明已保存的草稿。
- 禁止操作失败后只 `console.error`；反馈遵守项目的 toast / `showAppAlert` 规范。
- 禁止把 capability 断言描述为不可信插件的安全隔离。

## 实施任务

### 任务 0A：冻结数据安全行为基准

**优先级：** P0
**状态：** 进行中

**目的：** 在修改数据模型前固定已有正确行为，并为 P0 的保存、恢复和路径操作建立回归证据。

**涉及文件：**

- 修改 `tests/unit/main/file-service.test.ts`
- 修改 `tests/unit/renderer/file-editor-controller.test.ts`
- 修改 `tests/unit/renderer/files-document-store.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`
- 补充窗口关闭、插件生命周期、另存为、全部保存和路径锁定向测试

**工作项：**

- [x] 固定预览标签、固定标签、跨 group 共享文档和 dirty 关闭守卫行为。
- [x] 加入读写修订、草稿代际、关闭屏障、另存为恢复和路径操作的单元回归。
- [ ] 加入真实多窗口的同名临时文档、同一磁盘文件双窗口 dirty 基准。
- [ ] 加入回收 dirty 文件、回收包含多个 dirty 文件的目录和提交后强杀基准。

**完成证据：**

- 定向测试和 `pnpm check` 全部通过。
- 多窗口、回收目录和强杀基准在真实 Electron 运行时通过；不能用 jsdom 单元测试替代。

### 任务 0B：建立规模与性能夹具

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 0A 只提供测试约定，不阻塞 P0 数据安全实现

**目的：** 为快速打开、项目搜索和大目录治理建立可重复证据，不与 P0 数据安全混为同一发布门槛。

**涉及文件：**

- 新建 `tests/fixtures/files-large-project.ts`
- 新建 `tests/performance/files-query.perf.ts`
- 新建 `vitest.performance.config.ts`
- 修改 `package.json`

**工作项：**

- [ ] 加入 10 万路径、单目录 2 万子项、深层目录、符号链接环和排除目录夹具。
- [ ] 记录现有树搜索加载节点数、首次结果时间和 renderer store 增长。
- [ ] 单元测试只锁扫描条目数、批次字节、renderer 最大候选数和取消后事件数等确定性结构预算。
- [ ] 独立性能冒烟验证使用固定数据生成器、固定 CI 执行机、冷/热两轮记录 p95；首批路径结果 300 ms 和取消 100 ms 只作为该环境目标，不写进 jsdom 单元测试。
- [ ] 增加 `pnpm test:performance:files` 独立入口并保存冷/热 p95 结果；普通 `pnpm check` 可以不包含性能任务，但发布门槛必须显式运行。

**完成证据：**

- 新规模测试能稳定证明旧递归树搜索超出节点预算。
- 固定 CI 执行机留存冷/热两轮 p95，并能区分功能回归与性能波动。

### 任务 1：新增文档读取与写入契约

**优先级：** P0
**状态：** 安全写入主链与单元测试已落地；统一规范身份锁、最终符号链接路径语义和真实 macOS 元数据发布验证待完成
**依赖：** 任务 0A

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 修改 `src/shared/contracts/commands.ts`
- 新建 `src/main/services/file-document-codec.ts`
- 新建 `src/main/services/file-document-reader.ts`
- 新建 `src/main/services/file-path-identity.ts`
- 新建 `src/main/services/file-path-transaction-lock.ts`
- 新建 `src/main/services/file-safe-writer.ts`
- 修改 `src/main/services/file-service.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 新建 `tests/unit/main/file-document-codec.test.ts`
- 新建 `tests/unit/main/file-path-transaction-lock.test.ts`
- 新建 `tests/unit/main/file-safe-writer.test.ts`
- 修改 `tests/unit/main/file-service.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/app-core/command-router.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 修改 `tests/unit/renderer/plugin-host-context.test.tsx`

**工作项：**

- [x] 添加 `file.readDocument` / `file.writeDocument` / `file.inspectWriteTarget` / `file.confirmDurability` schema 和结果联合。
- [x] 实现 UTF-8、UTF-8 BOM、带 BOM 的 UTF-16 LE、带 BOM 的 UTF-16 BE 检测与写回，使用可判别 format 联合。
- [x] 实现二进制、未知编码、混合换行符、超大文件和非普通文件分类。
- [x] 生成包含规范目标/符号链接链的不透明 `revision`。
- [x] 实现安全写入的进程内路径锁、提交前复检、`absent` no-replace、明确提交点和 `durability` 结果。
- [ ] 让移动、复制、回收与安全写入使用同一词法路径/规范路径身份集合，并在锁内重新验证身份；当前路径操作只锁词法路径。
- [x] `confirmDurability` 核对 expected revision 后只 `fsync` 文件与父目录，不重写正文；目标缺失或变化返回判别式 mismatch。
- [x] `inspectWriteTarget` 对任意普通文件流式计算 revision，不读取正文到 renderer；特殊文件拒绝覆盖。
- [x] 单元层已验证 mode 和 hardlink 策略。
- [ ] 在真实 macOS 文件系统验证并固化 owner、ACL、xattr 策略；不允许静默丢元数据。
- [x] 实现符号链接打开、保存、目录循环和越界的安全子集。
- [ ] 路径操作对最终符号链接只操作目录项，并覆盖悬空链接、根外目标和父目录符号链接语义。
- [x] 为新命令补 capability 授权、路由和 schema 测试。
- [x] 保留旧 `readText` / `writeText` 的 v1 行为并标记 deprecated，迁移 `pier.files`，治理测试禁止新调用。

**完成证据：**

- 四种受支持文件格式在非混合换行符下可字节级往返；无 BOM UTF-16 明确不支持。
- 未知编码和二进制不会进入可保存文本态。
- 相同 `mtime`、不同内容仍能触发 revision 冲突。
- 可执行文件保存后 mode 不变。
- 根外符号链接拒绝，根内符号链接保存后链接仍存在。
- `absent` 不覆盖竞态创建的文件；提交后同步失败返回“已提交、耐久未知”。
- 耐久状态未知可以通过不重写正文的确认 API 转为 confirmed；revision 变化时保留恢复草稿并进入冲突。
- 二进制、未知编码和超大目标可取得无正文 revision 并安全确认覆盖。
- 目录、FIFO、socket、device 不进入读取阻塞路径。

### 任务 2：把 Files 文档状态迁移到新模型

**优先级：** P0
**状态：** 进行中；统一模型已落地，外部删除后的原路径重新创建未闭环
**依赖：** 任务 1

**涉及文件：**

- 修改 `src/plugins/builtin/files/renderer/files-document-types.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-factory.ts`
- 修改 `src/plugins/builtin/files/renderer/file-document-loader.ts`
- 修改 `src/plugins/builtin/files/renderer/file-document-saver.ts`
- 修改 `src/plugins/builtin/files/renderer/files-tree-create.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-store.ts`
- 新建 `src/plugins/builtin/files/renderer/files-document-state-actions.ts`
- 新建 `src/plugins/builtin/files/renderer/files-document-reducers.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-hydration.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-drafts.ts`
- 新建 `src/plugins/builtin/files/renderer/file-editor-view-coordinator.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-status.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-editor-adapter.tsx`
- 修改中英文 `locales`
- 修改 `tests/unit/renderer/file-editor-controller.test.ts`
- 修改 `tests/unit/renderer/files-document-store.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [x] 文档保存 locator `root + path`、`canonicalPath`、`format`、`eol`、`revision`、`mode` 和 `readOnlyReason`。
- [x] 文档显式保存 `hasBackingStore` / `needsSaveAs`；untitled 初始内容即使尚未编辑，也不能因 `dirty: false` 被当作可无提示关闭。
- [x] store key 继续使用 locator `root + path`，不合并直接路径与符号链接路径 buffer。
- [ ] 建立完整的 canonical 反向索引；当前移动目标影响仍由 renderer 伪造，不能覆盖父目录符号链接别名。
- [x] 删除 renderer 的前 8000 字符 NUL 判断。
- [x] 为二进制、未知编码、超大文件和无写权限提供统一状态页。
- [x] 保存成功后只使用主进程返回的新 revision 更新文档。
- [x] `durability: "unknown"` 显示“文件已写入但耐久确认失败”，保留恢复草稿，禁止重写正文。
- [x] 外部监听变化后重新取 revision，再决定重载或冲突。
- [x] P0 保持现有保存冲突比较可用；通用 `@codemirror/merge` 不阻塞其正确性。
- [ ] 固定保存冲突中重新加载、覆盖、另存为、取消的完整交互矩阵。
- [x] 将编码、换行符、只读、草稿保护失败和磁盘删除状态显示在文件状态区。
- [x] 所有新文案进入 `en` / `zh-CN` i18n。
- [x] 迁移 `pier.files` 内全部 `readText` / `writeText` 调用，包括文件树新建；治理测试禁止插件重新调用旧写接口。
- [ ] 外部删除后提供“原路径重新创建”动作；普通继续编辑必须保持 `deleted-on-disk` 事实。

**完成证据：**

- 编码与换行符状态在打开、编辑、保存、重开后保持一致。
- 不支持文件没有可编辑 CodeMirror 实例，也没有保存按钮。
- 外部变化和保存竞态测试稳定通过。
- 直接路径与符号链接路径不会错误共享 source/revision；目标变化和链接改指分别失效正确文档。

### 任务 3：重建草稿持久化和关闭语义

**优先级：** P0
**状态：** 主链、单元测试、生命周期准备模块拆分和窗口关闭失败标题本地化已落地；损坏条目诊断、结构化失败正文、真实强杀/双窗口同键和旧草稿人工恢复待完成
**依赖：** 任务 2

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 重写 `src/main/services/file-drafts-service.ts`
- 新建 `src/main/services/file-drafts-durable-io.ts`
- 新建 `src/main/services/file-drafts-storage.ts`
- 新建 `src/main/services/file-drafts-types.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/command-router.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/main/app-quit/quit-controller.ts`
- 修改 `src/main/app-core/app-core.ts`
- 修改 `src/main/app-core/plugin-commands.ts`
- 新建 `src/main/app-core/plugin-disable-transition.ts`
- 修改 `src/main/services/window-service.ts`
- 修改 `src/main/services/renderer-command-service.ts`
- 修改 `src/main/windows/window-manager.ts`
- 修改 `src/main/index.ts`
- 修改 `src/shared/contracts/renderer-command.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-barriers.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-completions.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-drains.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-finalizers.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-preparation.ts`
- 新建 `src/renderer/lib/plugins/plugin-lifecycle-receipts.ts`
- 新建 `src/main/windows/window-close-coordinator.ts`
- 新建 `src/renderer/components/workspace/workspace-lifecycle-commands.ts`
- 修改 `src/renderer/lib/plugins/bootstrap.ts`
- 修改 `src/renderer/lib/plugins/runtime.ts`
- 修改 `src/renderer/components/workspace/workspace-host.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-document-drafts.ts`
- 新建 `src/plugins/builtin/files/renderer/files-document-draft-records.ts`
- 新建 `src/plugins/builtin/files/renderer/files-draft-client-store.ts`
- 新建 `src/plugins/builtin/files/renderer/files-draft-client-types.ts`
- 新建 `src/plugins/builtin/files/renderer/files-draft-emergency-storage.ts`
- 新建 `src/plugins/builtin/files/renderer/files-draft-protection.ts`
- 新建 `src/plugins/builtin/files/renderer/files-async-drain.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-store.ts`
- 修改 `src/plugins/builtin/files/renderer/file-document-lifecycle.ts`
- 修改 `src/plugins/builtin/files/renderer/file-editor-controller.ts`
- 修改 `src/plugins/builtin/files/renderer/index.tsx`
- 修改 `tests/unit/main/file-drafts-service.test.ts`
- 新建 `tests/unit/renderer/plugin-lifecycle-barriers.test.ts`
- 修改 `tests/unit/renderer/plugin-runtime.test.ts`
- 修改 `tests/unit/app-core/renderer-command-service.test.ts`
- 修改 `tests/unit/app-core/plugin-commands.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/app-core/command-router.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 新建 `tests/unit/app-core/plugin-disable-transition.test.ts`
- 修改 `tests/unit/main/window-service.test.ts`
- 新建 `tests/unit/main/window-close-coordinator.test.ts`
- 修改 `tests/unit/main/app-quit-controller.test.ts`
- 修改 `tests/unit/main/window-lifecycle-invariants.test.ts`
- 修改 `tests/unit/main/window-manager-webcontents-view.test.ts`
- 修改 `tests/unit/renderer/workspace-renderer-commands.test.ts`
- 修改 `tests/unit/renderer/workspace-host-invariants.test.ts`
- 修改 `tests/unit/renderer/plugin-host-context.test.tsx`
- 修改 `tests/unit/renderer/plugin-bootstrap.test.ts`
- 新建 `tests/unit/renderer/files-draft-lifecycle.test.ts`
- 修改 `tests/unit/renderer/files-document-store.test.ts`
- 修改 `tests/unit/renderer/file-editor-controller.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`
- 修改 `tests/e2e/startup-stability.spec.ts`

**工作项：**

- [x] 采用版本化索引加独立条目的草稿目录；索引可从条目重建，目录和文件权限收紧。
- [ ] 损坏条目必须隔离且产生可见诊断；当前非法条目会被静默跳过。
- [x] `set` 携带窗口所有者和代际，并在条目耐久提交后返回 `stored` / `rejected` / `failed`。
- [x] 临时文档使用 UUID；磁盘和临时草稿按稳定窗口记录身份隔离。
- [x] 启动读取使用 `listKeys(owner) + get(owner,key) + claimLegacy(...)`，不全量跨 IPC 传输草稿正文。
- [x] command router 从 desktop renderer 的 sender / window record 注入 owner；schema 不接受插件自报 owner。
- [x] 旧 `file-drafts.json` 迁移可重复且失败不删原文件。
- [x] 旧格式统一迁入 `legacy-unassigned`，匹配窗口可原子认领。
- [ ] 提供未匹配旧草稿的人工恢复入口，并以真实双窗口验证只有一个窗口可认领。
- [x] renderer 增加“保护中、已保护、保护失败”状态机。
- [x] 按 BrowserWindow 隔离的 `sessionStorage` 只作为可见紧急副本，不产生耐久 `stored` 回执；禁止使用会跨窗口串键的 `localStorage`。
- [x] 宿主插件刷新屏障接入应用退出、单窗口关闭和插件停用；失败或超时可否决迁移。
- [x] 生命周期收尾器（finalizer）对同步异常仍尝试全部参与者，并阻止超时后的重试重入。
- [x] 将准备、超时、取消、排空、完成记录和提交回执拆为独立模块，并删除只供测试使用的重复运行包装；`plugin-lifecycle-barriers.ts` 保持在 500 行硬上限内。
- [x] 取消中的准备即使忽略 `AbortSignal` 也保持插件隔离，直到旧准备和补偿排空；准备排空后的立即补偿失败和超时收尾的延迟失败都保留可重试状态，排空后 runtime 自动重新协调。
- [x] 提交回执只有在插件 disposer 成功后才确认消费；disposer 失败时保留原 transition 供 main 执行 `abort` 补偿。main 已提交租约与本地推测租约显式区分：main 的 `transitionId` 精确贯穿到销毁授权、回执获取和消费，不再按 `(pluginId, reason)` 模糊取第一张回执；生命周期锁以插件实例为粒度，任何原因的新准备（包括 `prepareAll`）都会先补偿该插件全部历史回执，旧事务的迟到 `abort` 不能清除新授权。租约携带同步 `isCurrent` 校验，跨窗口回滚已删除回执时停止 disposer；本地租约还会在调用 disposer 前最后复核代际，过期即 `abort`，本地 `commit` 收尾失败时先执行 `abort` 补偿，不能留下半挂起准备。部分清理失败的 active 标记为 `cleanup-failed`，期望状态恢复同版本时先完成清理并重新激活，不能把残缺实例当健康实例。完成记录历史被限量淘汰后，未消费回执仍可补偿，不把历史缓存误当成真实所有权源。
- [x] `RendererPluginRuntime.refresh/dispose` 串行等待目标插件屏障再释放；终态 `dispose` 会先取消旧准备并循环等待后续派生排空。各插件独立执行“等待排空 → 释放”，单个永久悬挂插件不阻塞其它插件清理。
- [x] 插件 finalize 命令等待 renderer 实际卸载完成再回执；disposer 失败会返回主进程并触发用户可见失败，不把设置状态变化当成卸载成功证据。
- [x] `workspace.prepareClose` 先等待插件刷新屏障再刷布局。
- [x] window manager 的关闭前钩子使用 `allow | veto`，否决时窗口保持打开并允许重试。
- [x] renderer 反馈通道失败时只在异常路径降级到原生错误框；应用内弹窗同步入队后立即确认，不等待用户关闭，因此阅读超过 15 秒也不会触发原生双提示。
- [x] renderer 入口加载失败、preload 失败或界面进程异常退出时由 main 显示本地化“重试/关闭窗口”，不展示无反馈空窗；正常 `ERR_ABORTED` 导航取消和退出期加载不误报。启动页挂载后立即记录“启动壳已挂载”，窗口不再等待工作区布局、环境或插件异步初始化，健康但较慢的初始化不会被误判为致命失败；主进程以 15 秒截止时间覆盖从导航发起到启动壳确认的完整阶段，导航永久悬挂也会进入原生恢复。load、preload 和显示前崩溃都会关闭当前显示闸门；重试只接受新的主框架、非同页导航。每次 `dom-ready` 由 main 生成唯一挑战值并发给当前 preload，只有同时观察到启动壳挂载的该文档才能原样回执；旧文档、同一 `WebFrameMain` 的旧导航、子框架和同页导航都不能解锁窗口。终端调试窗口同样复用这套显示闸门与 load/preload/crash 恢复，不再通过 Electron `ready-to-show` 旁路，并注入统一退出状态，退出期不弹恢复框或重载。应用资源故障在多窗口恢复时合并为一个提示，统一处理全部受影响窗口；每个窗口的 retry/destroy 独立隔离异常，一个失败不会阻断其它窗口，单窗口 renderer 崩溃仍独立处理。
- [x] app core 改为首次属性访问时惰性构造，scheme 注册与构造首次访问都位于受控启动 Promise 内；`appCore.ready` 只有 managed plugin 初始化成功才完成，拒绝会继续冒泡到本地化原生提示、全量有界清理和确定退出，不以日志代替就绪结果。
- [ ] 关闭失败命令正文改传结构化 `reason + detail`，由 renderer i18n 生成用户说明。窗口内关闭失败标题、应用退出原生错误框标题和主进程启动失败标题已按当前语言本地化；当前窗口内正文仍直接承载技术错误串。
- [x] 主进程退出提交前等待 `FileDraftsService.flush()`。
- [x] 应用退出无论是否显示确认弹窗，都执行所有窗口准备关闭和主进程刷新。
- [x] 插件停用使用插件级互斥和迁移代际，提交前重新核对参与窗口集合；任一否决保持原启用状态。
- [x] WindowService 在停用迁移期间延后新窗口创建，提交或回滚后再继续。
- [x] `dispose({ clearDocuments: true })` 只清内存，不删除持久草稿。
- [x] 只有耐久确认、用户明确丢弃或安全的普通无未保存修改文档关闭时删除草稿。
- [x] 配额满时拒绝并反馈；不自动淘汰未显式删除的草稿。
- [x] 以真实 Electron 注入草稿目录故障，验证真实关闭被否决、窗口保留、只出现一个应用弹窗，修复故障后重试可关闭。
- [ ] 以真实 Electron 验证 8 MiB 强杀恢复、双窗口同键隔离和应用退出失败单次可见反馈。

**完成证据：**

- E2E 等待 8 MiB dirty 文档显示“已保护”后 SIGKILL Electron，使用同一 userData 重启可完整恢复。
- 写入失败时 UI 明确显示未保护。
- 插件停用/重新启用后草稿仍存在。
- 旧格式迁移中断后可再次启动并恢复。
- `legacy-unassigned` 在双窗口启动时只被一个匹配窗口认领，未匹配条目仍可人工恢复。
- 两个窗口的同名临时文档和同一磁盘文件 dirty 草稿互不覆盖；旧代际回执不能覆盖新状态。
- `durability-unknown` 覆盖同会话关闭、重新同步成功、重启后一致、重启后缺失/不一致四类恢复测试。
- 插件停用等待期间创建窗口不会绕过屏障；任一窗口否决时主状态保持启用。

### 任务 4：补齐“另存为”、全部保存和可恢复身份迁移

**优先级：** P0
**状态：** 主链和布局耐久屏障已落地；启动全局判别、无未保存修改目标合并、全部保存分类/取消语义与端到端崩溃证据待完成
**依赖：** 任务 2、任务 3

**涉及文件：**

- 新建 `src/shared/contracts/file-save-target.ts`
- 修改 `src/shared/ipc-channels.ts`
- 新建 `src/main/ipc/file-save-target.ts`
- 修改 `src/main/index.ts`（只注册独立 IPC 模块）
- 修改 `src/main/services/panel-context-resolver.ts`
- 新建 `src/preload/file-save-target-api.ts`
- 修改 `src/preload/index.ts`
- 修改 `src/plugins/api/renderer.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 修改 `src/renderer/lib/plugins/host-panels-context.ts`
- 新建 `src/renderer/lib/workspace/workspace-layout-persistence.ts`
- 修改 `src/plugins/builtin/files/manifest.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-types.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-factory.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-store.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-drafts.ts`
- 新建 `src/plugins/builtin/files/renderer/files-save-as-journal.ts`
- 新建 `src/plugins/builtin/files/renderer/files-document-save-as.ts`
- 修改 `src/plugins/builtin/files/renderer/file-document-saver.ts`
- 修改 `src/plugins/builtin/files/renderer/file-save-outcome.ts`
- 新建 `src/plugins/builtin/files/renderer/file-save-as-state-machine.ts`
- 新建 `src/plugins/builtin/files/renderer/file-editor-save-coordinator.ts`
- 新建 `src/plugins/builtin/files/renderer/file-save-all-action.ts`
- 新建 `src/plugins/builtin/files/renderer/use-file-panel-save-as.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改 `src/plugins/builtin/files/renderer/index.tsx`
- 修改 `src/shared/keybindings.ts`
- 修改中英文 `locales`
- 修改 `tests/unit/renderer/files-document-store.test.ts`
- 新建 `tests/unit/renderer/file-save-as-state-machine.test.ts`
- 新建 `tests/unit/renderer/file-save-all-action.test.ts`
- 新建 `tests/unit/renderer/host-files-context-save-target.test.ts`
- 修改 `tests/unit/renderer/plugin-host-context.test.tsx`
- 修改 `tests/unit/main/panel-context-resolver.test.ts`
- 新建 `tests/unit/main/file-save-target-ipc.test.ts`
- 修改 `tests/unit/shared/ipc-channels.test.ts`
- 新建 `tests/unit/shared/file-save-target.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [x] 增加独立的原生保存对话框 IPC 模块，不向插件暴露 Electron；宿主只组合 facade。
- [x] IPC 校验 sender 属于存活 Pier 窗口，插件 facade 断言 `file:write`，并覆盖取消、窗口销毁和非法请求。
- [x] main 对用户目标调用 panel context resolver，返回 `root + path + context`。
- [x] 注册 `pier.files.saveAs`、`pier.files.saveAll`、`Cmd+Shift+S` 和“全部保存”默认快捷键。
- [x] 所有可编辑文本获得 `saveAs` capability。
- [x] 普通保存和关闭守卫在 `needsSaveAs: true` 时复用同一另存为状态机；“全部保存”收集 `dirty || needsSaveAs || durabilityUnknown`。
- [x] 已存在目标显式确认覆盖，并以 revision 阻止确认后的竞态替换。
- [x] 可恢复记录持久化 `operationId`、`phase`、源文档、目标、保存内容格式和主进程写入回执；写入结果带不透明 `revision`。
- [x] 重绑发起 panel 后等待宿主工作区布局耐久提交，再清理源文档和可恢复记录；布局刷新失败时保留源文档与 written 记录。
- [ ] 可恢复记录增加目标 panel 身份和“布局已提交”阶段；启动时全局扫描：新布局已恢复则幂等清理，旧布局已恢复则重做绑定，两者皆无则进入人工恢复。当前恢复入口只挂在源 panel，布局已提交后强杀会留下孤儿记录。
- [x] 同源多 panel 时只重绑发起 panel；dirty 目标禁止覆盖。
- [ ] 固定无未保存修改目标的共享文档合并矩阵及多 panel 参数化测试。
- [x] 磁盘文档另存后原文件保持不变；取消和提交前失败保持源文档、dirty 和草稿不变。
- [x] 提交后 UI 迁移失败报告“目标已写入”并保留源草稿与恢复记录。
- [x] “全部保存”按文档身份跨 group 去重，使用一次汇总反馈。
- [ ] “全部保存”返回并汇总 saved/conflict/cancelled/failed 分类，明确临时文档取消是跳过当前还是取消剩余，并覆盖全部成功和部分失败组合。

**完成证据：**

- 终端选区生成的临时 Markdown 可保存为真实文件。
- 项目内、同 Git 根、项目外普通目录保存后关闭重开都可恢复正确 context。
- 取消、覆盖拒绝、写入失败、提交后迁移失败、目标已打开、源文档多 panel 和各阶段崩溃恢复均有参数化测试。
- “全部保存”的全部成功、跳过临时文档、冲突和部分失败均有组件测试。
- 未编辑的终端选区文档覆盖 Cmd+S、全部保存和关闭时选择“保存”三条路径。

### 任务 5：关闭路径操作导致的 dirty 数据丢失

**优先级：** P0
**状态：** source 运行时保护已落地；目标规范身份、提交前补偿、临时文档布局重绑、最终链接语义、持久日志/启动恢复和外部删除重建待完成
**依赖：** 任务 2、任务 3

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 修改 `src/shared/contracts/commands.ts`
- 修改 `src/main/services/file-service.ts`
- 新建 `src/main/services/file-move-no-replace.ts`
- 新建 `src/main/services/file-path-transaction-lock.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 新建 `src/plugins/builtin/files/renderer/files-dirty-path-guard.ts`
- 新建 `src/plugins/builtin/files/renderer/file-path-mutation-guard.ts`
- 新建 `src/plugins/builtin/files/renderer/file-tree-delete-action.ts`
- 新建 `src/plugins/builtin/files/renderer/files-mutation-gate.ts`
- 修改 `src/plugins/builtin/files/renderer/file-tree-actions.ts`
- 修改 `src/plugins/builtin/files/renderer/file-editor-path-mutations.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-store.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-drafts.ts`
- 修改 `src/plugins/builtin/files/renderer/files-nav-history.ts`
- 修改 `src/plugins/builtin/files/renderer/file-editor-controller.ts`
- 修改 `src/plugins/builtin/files/renderer/index.tsx`
- 修改中英文 `locales`
- 新建 `tests/unit/renderer/files-dirty-path-guard.test.ts`
- 修改 `tests/unit/renderer/file-tree-actions.test.ts`
- 修改 `tests/unit/main/file-service.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/app-core/command-router.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 修改 `tests/unit/renderer/files-document-store.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [x] 新增 `inspectPathImpact`：main 返回 source 的 lstat 类型、locator 前缀和必要的 canonical backing 前缀。
- [x] source 是符号链接时只按 locator 前缀计算；普通文件/目录才补充 canonical 前缀。
- [ ] main 同时返回 writable target 的 locator/canonical 影响；renderer 不得用 `newPath` 伪造目标规范身份。
- [x] 回收 dirty 文件或目录提供保存后回收、转为临时文档、明确丢弃和取消；保存路径等待耐久确认，转临时文档先等待草稿写入。
- [ ] 转临时文档后显式重绑所有受影响 panel 并等待布局耐久提交，再删除旧磁盘草稿并执行回收。
- [x] 覆盖已打开 dirty 目标默认拒绝；运行时 source/target 影响集合由路径守卫持续跟踪。
- [ ] 由 main 生成一次操作令牌贯穿影响检查、词法/规范身份锁、提交和 renderer 迁移；锁内身份变化必须拒绝。
- [ ] 先把 495 行 `file-service.ts` 中的 move/copy/trash 与身份事务提取到独立模块，再实现统一操作令牌和规范身份锁，禁止靠压缩格式越过文件硬上限。
- [ ] main 提交前失败时执行 renderer `abortPathMutation`，恢复加载、保存与 dirty 自动保存；提交后失败进入持久恢复，不走 abort。
- [ ] 路径变更可恢复记录持久化 `operationId`、阶段、源、目标和主进程提交结果；移动、重命名提交后按状态机迁移，崩溃或 UI 失败可恢复。当前仅有进程内层级路径锁、无覆盖目标保留和 renderer 迁移，不能把临时 staging 清理等同于启动恢复。
- [x] 外部删除进入 `deleted-on-disk`，继续编辑不清除此状态，并可另存为或丢弃。
- [ ] 外部删除支持按原路径重新创建，并覆盖缺失、竞态重建和重启测试。
- [x] 多选回收按成功项使用路径守卫的实时快照清理，多项失败只显示一次详情弹窗。
- [ ] 移动、复制、回收对最终符号链接使用目录项语义，并与安全写入共享词法/规范路径锁。

**完成证据：**

- 回收单个 dirty 文件、包含多个 dirty 文件的目录、多选部分失败均不静默丢内容。
- 转为临时文档后异常退出可以恢复；明确丢弃后才删除草稿。
- 外部删除、目标覆盖、移动/重命名竞态以及各状态机崩溃点均有 store 与组件测试。
- 直接路径与目录链接同时打开时，分别重命名/回收链接和真实目录只影响正确文档集合。

### 任务 6：验证并打包搜索运行时

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 0B
**门槛：** 未通过本任务，不得上线快速打开或项目搜索入口。

**涉及文件：**

- 修改 `package.json`
- 修改 `pnpm-lock.yaml`
- 修改 `electron-builder.yml`
- 新建 `scripts/fetch-file-search-runtime.mjs`
- 新建 `scripts/verify-file-search-runtime.mjs`
- 新建 `tests/unit/main/file-search-runtime.test.ts`
- 修改构建或打包检查脚本

**工作项：**

- [ ] 用短期技术验证比较 `@vscode/ripgrep`、应用自带二进制和纯 Node 遍历；任务结束必须固定一种方案，后续任务不得继续保留开放分支。
- [ ] 首选标准：可取消、支持 glob / gitignore / 正则、arm64 与 x64 可打包、签名路径清晰。
- [ ] 若采用 ripgrep，构建输入固定为 `resources/search/<arch>/rg`，记录来源、版本、许可证、SHA-256、可执行位和 arch 映射；禁止只依赖宿主架构 postinstall。
- [ ] 固定运行时解析：开发态和正式包都从应用拥有的位置解析，禁止回退系统 `PATH` 或运行时下载。
- [ ] electron-builder 按目标 arch 选取资源；验证 asar unpack、`process.resourcesPath`、`file` 架构、可执行位、`codesign --verify --deep --strict` 和双架构产物。
- [ ] 二进制不可用时返回结构化错误，不静默换成阻塞 renderer 的实现。
- [ ] 记录选型结论和不选择其它方案的原因。

**完成证据：**

- 开发态和 `out` 构建冒烟验证能运行相同搜索样例；`pnpm build` 不冒充资源打包验证。
- arm64 / x64 CI 执行机分别执行 `build:dist` 后，直接启动解包 `.app/Contents/MacOS/Pier` 完成包内搜索冒烟验证；不假设本机安装 Rosetta。
- 临时清空 `PATH` 后搜索仍成功。
- 缺失或损坏二进制时 UI 能获得明确错误码。

### 任务 7：建立主进程文件查询服务

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 6

**涉及文件：**

- 新建 `src/shared/contracts/file-query.ts`
- 修改 `src/shared/ipc-channels.ts`
- 新建 `src/main/services/file-query-service.ts`
- 新建 `src/main/ipc/file-query.ts`
- 修改 `src/main/app-core/app-core.ts`
- 修改 `src/main/app-core/command-router-services.ts`
- 修改 `src/main/index.ts`（只注册独立 IPC 模块）
- 新建 `src/preload/file-query-api.ts`
- 修改 `src/preload/index.ts`
- 修改 `src/plugins/api/renderer.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 新建 `tests/unit/main/file-query-service.test.ts`
- 新建 `tests/unit/main/file-query-ipc.test.ts`
- 新建 `tests/unit/shared/file-query-contract.test.ts`
- 修改 `tests/unit/shared/ipc-channels.test.ts`
- 修改 `tests/unit/renderer/plugin-host-context.test.tsx`

**工作项：**

- [ ] 支持路径查询和内容查询两类会话。
- [ ] 实现 `start`、幂等 `cancel`、分批事件和恰好一个 `done/error` 终态。
- [ ] 查询按 `webContents.id + owner + queryId` 隔离并定向回传；同 sender 的 Quick Open 与内容搜索可并行，destroyed / did-navigate / owner 释放时按作用域清理。
- [ ] preload 先订阅再 start，逐事件做 schema 校验；host facade 断言 `file:read`。
- [ ] 建立共享 glob 解析器，但保留 tree visibility、search exclude、watch noise 三个策略；搜索支持是否应用 gitignore / 自定义排除的开关。
- [ ] 明确测试 `.cursorignore` / `.cursorindexingignore` 不改变文件核心搜索结果，避免把 Agent 检索策略泄漏进 Files。
- [ ] 每次查询设置结果、单文件大小、单行长度和总耗时保护。
- [ ] 用结构化输出解析路径、行文本和字节范围，覆盖 Unicode / EOL / 编码位置换算。
- [ ] 设置 batch 字节上限和 stdout 背压；取消终止进程组，超时后强制结束。
- [ ] 路径缓存只有在任务 0B 性能证据证明需要后才加入；即使加入也只是按规范化 root 的短生命周期缓存，不形成项目注册表。

**完成证据：**

- 同 owner 新查询会取消旧查询，取消后不再有 batch，且每个查询只有一个终态；关闭 Quick Open 不影响仍在运行的内容搜索。
- 恶意正则、超长行、权限错误和二进制文件不会拖死服务。
- 两个窗口、两个 root 的查询和取消完全隔离；窗口销毁后无遗留进程。

### 任务 8：交付异步快速打开，并替换递归树搜索

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 7

**涉及文件：**

- 修改 `src/plugins/builtin/files/manifest.ts`
- 修改 `src/plugins/api/renderer.ts`
- 修改 `src/renderer/lib/plugins/host-context.ts`
- 新建 `src/renderer/lib/plugins/plugin-async-quick-pick.ts`
- 修改 `src/renderer/lib/command-palette/types.ts`
- 修改 `src/renderer/lib/command-palette/controller.ts`
- 修改 `src/renderer/components/common/command-palette.tsx`
- 修改 `src/renderer/components/common/command-palette-quick-pick-view.tsx`
- 新建 `src/plugins/builtin/files/renderer/files-quick-open.ts`
- 新建 `src/plugins/builtin/files/renderer/files-path-ranking.ts`
- 新建 `src/plugins/builtin/files/renderer/files-quick-open-mru.ts`
- 修改 `src/plugins/builtin/files/renderer/index.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- 删除或收缩 `src/plugins/builtin/files/renderer/files-tree-search-loader.ts`
- 修改 `src/plugins/builtin/files/renderer/use-files-tree-search.ts`
- 修改 `src/shared/keybindings.ts`
- 修改中英文 `locales`
- 新建 `tests/unit/renderer/files-path-ranking.test.ts`
- 新建 `tests/unit/renderer/files-quick-open-mru.test.ts`
- 修改 `tests/unit/renderer/files-tree-search-loader.test.ts`
- 新建 `tests/unit/renderer/plugin-async-quick-pick.test.tsx`
- 新建 `tests/component/command-palette-async-quick-pick.test.tsx`
- 新建 `tests/component/files-quick-open.test.tsx`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [ ] 注册 `pier.files.quickOpen` 和 `Cmd+P`。
- [ ] 扩展现有 quick pick facade：查询变化回调、AbortSignal、loading/error、`update` / `close` 会话句柄和释放语义；实现放独立适配模块，`host-context.ts` 只组合。
- [ ] 宿主使用现有 `replaceQuickPick` 保留输入与选择，并虚拟化结果行；不新增第二套全局键盘与焦点系统。
- [ ] 当前窗口按 root 维护最多 100 条内存 MRU，作为受 schema 限制的提示传给主进程；主进程在完整集合上合并得分后只返回 top 200。
- [ ] 不复用命令面板 action MRU；任务 8 明确不做跨窗口或跨重启 Files MRU。
- [ ] 选择结果后复用当前 group 的同源标签语义。
- [ ] 只加载目标祖先链并定位文件，不预载其它目录。
- [ ] 文件树内搜索改为独立、虚拟化的路径结果层；选择结果时才加载祖先链，不再递归加载整树。
- [ ] 无项目根、查询中、截断、无结果和失败状态全部可见。

**完成证据：**

- 10 万路径下输入后首批结果满足任务 0B 的独立性能预算；renderer 同时持有候选不超过 200。
- 文件树 store 的已加载节点数只增加目标祖先链。
- 连续快速输入时旧结果不会闪回。

### 任务 9：交付可持续浏览的项目内容搜索

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 7

**涉及文件：**

- 修改 `src/plugins/builtin/files/manifest.ts`
- 新建 `src/plugins/builtin/files/renderer/files-content-search-panel.tsx`
- 新建 `src/plugins/builtin/files/renderer/files-content-search-store.ts`
- 新建 `src/plugins/builtin/files/renderer/files-search-result-row.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-tree-actions.ts`
- 修改 `src/plugins/builtin/files/renderer/files-tree-context-menu.ts`
- 修改 `src/plugins/builtin/files/renderer/index.tsx`
- 修改 `src/shared/keybindings.ts`
- 按需新增 `packages/ui` 通用展示组件
- 修改中英文 `locales`
- 新建 `tests/unit/renderer/files-content-search-store.test.ts`
- 新建 `tests/component/files-content-search.test.tsx`
- 新建 `tests/e2e/files-core.spec.ts`

**工作项：**

- [ ] 注册 `pier.files.searchContents` 和 `Cmd+Shift+F`。
- [ ] manifest 声明 `pier.files.searchPanel`；重复命令激活已有实例，panel params 只持久化 root 与查询条件。
- [ ] 支持大小写、整词、正则、包含和排除。
- [ ] 增加文件树“在文件夹中查找”；第一阶段只接受单个目录，把 canonical relative directory 作为结构化 scope 传入同一搜索 panel。
- [ ] 分批、虚拟化展示结果；同文件结果分组。
- [ ] renderer 只保留有限结果窗口，显示“已返回 N 条”和截断状态，不承诺搜索提前停止后仍能得到精确总命中，不把结果全集写入 panel params。
- [ ] 点击结果在既有或相邻文件 group 打开并按 UTF-16 行列定位，搜索面板保持可见。
- [ ] 支持是否使用搜索排除和忽略文件；根切换取消旧查询，面板恢复时重新搜索。
- [ ] scoped 目录移动或不存在时停止旧查询并提示重新选择；无权限有明确错误，多选目录入口第一阶段禁用并说明。
- [ ] 提供停止、重试和复制结果操作。
- [ ] 任务 9 不提供项目范围替换入口。

**完成证据：**

- 搜索条件、取消、截断、错误、空态、面板恢复、连续打开多个结果、目录范围和 Unicode 定位均有组件测试。
- Electron 开发构建端到端测试覆盖真实临时项目；安装包搜索由任务 6 的独立冒烟验证覆盖，不混为一类测试。

### 任务 10：大目录分页和监听治理

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 1、任务 7、任务 8

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 修改 `src/shared/contracts/commands.ts`
- 修改 `src/main/services/file-service.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/command-router.ts`
- 修改 `src/main/app-core/client-registry.ts`
- 修改 `src/main/app-core/app-core.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/main/services/file-watch-service.ts`
- 修改 `src/main/ipc/file-watch.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 修改 `src/plugins/builtin/files/renderer/files-tree-store.ts`
- 修改 `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-watch-hub.ts`
- 修改 `src/plugins/builtin/files/renderer/files-tree-watch.ts`
- 修改 `src/plugins/builtin/files/settings.ts`
- 修改中英文 `locales`
- 修改 `tests/unit/main/file-service.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/app-core/command-router.test.ts`
- 修改 `tests/unit/app-core/services.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 修改 `tests/unit/main/file-watch-service.test.ts`
- 修改 `tests/unit/renderer/files-tree-store.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [ ] 保留插件 API v1 的 `file.list` 数组结果；新增 `file.listPage`，请求包含有限的 `sortBy: name | type | modified`、`order`、`directoriesFirst`，结果返回 `entries + nextCursor + snapshotId`。
- [ ] 服务端按全部目录项稳定排序后再分页；排序参数属于 snapshot 身份。目录变化或切换排序使旧 cursor 返回 `stale-cursor`，调用方从第一页重建。
- [ ] 快照 registry 按 client owner + root + path + sort 作用域，默认 TTL 30 秒、最多 16 个快照、总计最多 250,000 entries；LRU 淘汰返回 `snapshot-expired`。
- [ ] nextCursor 结束、目录 watcher 变化、root / client 释放和 service dispose 都清理快照；假时钟测试锁定 TTL、LRU 和总量上限。
- [ ] command router 把 main 解析的 client identity 传给 `file.listPage`；插件不能自报 owner。
- [ ] app core 显式装配 `FileWatchService → FileService.invalidateDirectorySnapshots`，client registry 注销时调用 `releaseOwner`；file command 不使用模块级全局快照。
- [ ] 单目录过大时显示“加载更多”，不得一次创建上万个 React 节点。
- [ ] tree、search、watch 共用 glob parser 与路径规范化，但使用独立策略和设置来源。
- [ ] watcher 保留根级原始变化流，不把各订阅者 exclude 合并成并集；树在消费侧过滤，打开文档始终收到隐藏文件变化。
- [ ] watch noise 支持多段 glob，而不只是不含斜杠的目录名。
- [ ] 暴露 watcher 当前是原生监听还是轮询退化，用于诊断和状态提示。
- [ ] 根级 `"."` 失效事件只触发必要重载，避免每次轮询刷新整棵展开树。
- [ ] 目录列举携带祖先真实目录身份，阻断符号链接循环。

**完成证据：**

- 2 万直接子项不会一次性进入 DOM。
- name/type/modified、升降序和 directories-first 均为全目录排序，不出现逐页排序跳动。
- 三类排除共享语法但策略可解释：隐藏文件仍可按搜索开关命中，也始终能触发已打开文档冲突。
- 轮询退化状态可测试、可观测，不造成周期性全树抖动。
- watcher 变化、client 释放和 owner 隔离都有 service / IPC 测试，不残留主进程快照。

### 任务 11：补常见图片预览和二进制摘要

**优先级：** P2
**状态：** 待实施
**依赖：** 任务 2

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 修改 `src/shared/contracts/commands.ts`
- 修改 `src/main/services/file-service.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 修改 `src/main/csp.ts`
- 新建 `src/plugins/builtin/files/renderer/file-viewer-selection.ts`
- 新建 `src/plugins/builtin/files/renderer/file-image-viewer.tsx`
- 新建 `src/plugins/builtin/files/renderer/file-binary-summary.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-panel.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-panel-body.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-document-loader.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改中英文 `locales`
- 修改 `tests/unit/main/file-service.test.ts`
- 新建 `tests/unit/main/csp.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [ ] 用集中、可判别的选择函数决定 text、markdown、image 或 binary-summary；任务 11 不提前建设第三方 viewer registry。
- [ ] 固定 `readPreviewBytes({root,path,expectedRevision})` 窄接口；结果为 `bytes + actualRevision + mime + width/height`、`revision-mismatch` 或明确拒绝，不得暴露任意 `file://`。
- [ ] renderer 创建并释放 Blob URL；生产 CSP 显式允许 `blob:`，治理测试锁定只新增图片来源。
- [ ] 主进程在返回字节、renderer 创建 Blob URL 之前解析受支持图片头并执行编码字节、像素面积和 SVG 文本大小上限；revision 不匹配时重新分类，不显示旧字节。
- [ ] 支持 PNG、JPEG、GIF、WebP、BMP、ICO、AVIF、SVG；SVG 只能经 `<img>` 隔离路径显示，禁止把内容插入 DOM。
- [ ] 图片提供缩放、适应、原始尺寸和棋盘透明背景。
- [ ] 二进制摘要显示类型、大小、修改时间和“在系统中显示”。
- [ ] 加载、空、错状态使用共享组件。

**完成证据：**

- 常见图片、损坏图片、超大字节/像素图片、恶意 SVG、revision 变化和普通二进制均有 service / CSP / 组件测试；CSP 测试锁定只扩张 `img-src blob:`，不改变 script/connect。
- 文本与 Markdown 现有行为无回归。

### 任务 12：补齐编辑器文件级基础能力

**优先级：** P1
**状态：** 待实施
**依赖：** 任务 2

**涉及文件：**

- 修改 `src/plugins/builtin/files/renderer/files-document-types.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-reducers.ts`
- 修改 `src/plugins/builtin/files/renderer/file-editor-view-session.ts`
- 修改 `src/plugins/builtin/files/renderer/file-editor-adapter.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-editor-actions.ts`
- 修改 `src/plugins/builtin/files/renderer/files-group-view.tsx`
- 修改 `src/plugins/builtin/files/settings.ts`
- 修改 `src/plugins/builtin/files/manifest.ts`
- 修改 `src/shared/keybindings.ts`
- 修改中英文 `locales`
- 修改 `tests/unit/renderer/file-editor-controller.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [ ] 注册 `pier.files.goToLine` 及非冲突默认快捷键；增加自动换行、Tab 大小、缩进方式和语言模式覆盖。
- [ ] 增加换行符和支持编码切换；转换必须使文档 dirty，并在保存前可撤销。
- [ ] 保持编辑器 session 复用，不因状态栏变化重建 CodeMirror。
- [ ] 设置按“工作区默认 + 文档覆盖”建模；文档覆盖不写入 panel params 正文。

**完成证据：**

- 跳转行、换行、缩进、语言、编码和 EOL 控制均有组件测试。
- 文件级设置切换不会丢选区、滚动位置、撤销栈或重建 CodeMirror session。

### 任务 13：补齐文件树高频操作

**优先级：** P1
**状态：** 待实施；当前数据安全轮只完成任务 5 所需的路径保护，不代表本任务完成
**依赖：** 任务 5、任务 8、任务 10

**涉及文件：**

- 修改 `src/shared/contracts/file.ts`
- 修改 `src/shared/contracts/file-commands.ts`
- 修改 `src/shared/contracts/commands.ts`
- 新建 `src/main/services/file-transfer-service.ts`
- 修改 `src/main/app-core/app-core.ts`
- 修改 `src/main/app-core/command-router-services.ts`
- 修改 `src/main/app-core/file-commands.ts`
- 修改 `src/main/app-core/permissions.ts`
- 修改 `src/preload/file-api.ts`
- 修改 `src/plugins/api/renderer-facades.ts`
- 修改 `src/renderer/lib/plugins/host-files-context.ts`
- 修改 `src/plugins/builtin/files/renderer/file-tree-actions.ts`
- 修改 `src/plugins/builtin/files/renderer/file-tree-sidebar.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-tree-store.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改中英文 `locales`
- 修改 `tests/component/files-file-panel.test.tsx`
- 修改 `tests/component/ui-file-tree.test.tsx`
- 修改 `tests/e2e/files-core.spec.ts`
- 新建 `tests/unit/main/file-transfer-service.test.ts`
- 修改 `tests/unit/app-core/permissions.test.ts`
- 修改 `tests/unit/app-core/services.test.ts`
- 修改 `tests/unit/shared/file-contract.test.ts`
- 修改依赖巡检和打包验证测试

**工作项：**

- [ ] 保留现有多选、批量移动和批量回收站；新增全部折叠、排序方式、复制、剪切和粘贴。
- [ ] 现有批量破坏性操作接入任务 5 的 dirty 守卫；结果列表变化作为强自然反馈，不重复 toast。
- [ ] 剪贴板冲突提供跳过、替换、重命名选择。
- [ ] main 侧批量 transfer request 为每项返回结果；普通文件替换必须携带目标 revision 并做提交前复检，目录冲突第一阶段只允许跳过或自动重命名，禁止“先回收目标再 copy”模拟替换。
- [ ] `FileTransferService` 由 app core 注入 `PierCoreServices`，显式复用 `FilePathIdentity` / `FileSafeWriter`；`file-commands.ts` 只做授权后的路由转发，不临时实例化服务。
- [ ] cut 的跨设备降级只有在目标提交成功后才删除源；部分失败保留未完成源项和剪贴板状态。
- [ ] 批量操作部分失败时显示详细结果，不把多行详情塞入 toast。
- [ ] 补 dependency-cruiser 规则，继续禁止插件绕过 facade 访问主进程或 dockview。
- [ ] 完成中英文术语检查和无障碍检查。

**完成证据：**

- 现有多选/批量能力无回归；剪切粘贴和排序有成功、取消、冲突、部分失败和权限失败测试。

### 任务 14：统一通用差异视图

**优先级：** P2
**状态：** 待实施；P0 继续使用现有冲突比较，不阻塞数据安全
**依赖：** 任务 2、任务 4

**涉及文件：**

- 新建 `src/plugins/builtin/files/renderer/file-diff-view.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-line-diff.tsx`
- 修改 `src/plugins/builtin/files/renderer/file-document-saver.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-body.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-document-types.ts`
- 修改 `src/plugins/builtin/files/renderer/files-document-reducers.ts`
- 修改 `src/plugins/builtin/files/renderer/file-panel-actions.tsx`
- 修改 `src/plugins/builtin/files/renderer/files-editor-actions.ts`
- 修改 `src/plugins/builtin/files/renderer/files-group-view.tsx`
- 修改 `src/plugins/builtin/files/manifest.ts`
- 修改 `package.json`
- 修改 `pnpm-lock.yaml`
- 修改中英文 `locales`
- 修改 `tests/unit/renderer/file-editor-controller.test.ts`
- 修改 `tests/component/files-file-panel.test.tsx`

**工作项：**

- [ ] 固定采用 `@codemirror/merge`，替换只服务冲突的简化 LCS 展示，不保留开放选型。
- [ ] “与已保存内容比较”和“从 quick pick 选择第二个已打开文本标签比较”复用同一组件。
- [ ] 保存冲突继续提供重新加载、保留并覆盖、另存为、取消；P0 阶段现有比较必须保持正确，不能等待本任务才修冲突。
- [ ] 增加空白差异显示；大文件设置大小门槛和降级摘要。
- [ ] 比较视图只读，不改变两个源文档的撤销栈和 dirty 状态。

**完成证据：**

- 普通两文件比较、与已保存内容比较和保存冲突共用差异核心。
- 大文件降级、空白差异、源文档关闭和任一源 revision 变化均有测试。

## 后续独立方案入口：本地文件历史

本地文件历史是明确差距，但不纳入当前数据安全轮，避免与异常退出恢复草稿、路径操作和通用差异视图形成第二套未收敛的持久化系统。后续必须单独通过架构门槛，至少覆盖：

- 保存、覆盖和回收前快照的触发时机。
- 与草稿完全独立的目录、schema、配额、保留期和清理入口。
- 本机敏感内容权限、同内容去重、索引重建和损坏隔离。
- 路径移动、canonical alias、revision 冲突、比较和恢复。
- “本地尽力恢复，不是备份、版本控制或跨设备同步”的产品边界。

## 实施顺序和依赖

| 工作流 | 依赖链 |
| --- | --- |
| 数据安全 | 任务 0A → 任务 1 → 任务 2 → 任务 3 → 任务 4；任务 3 → 任务 5 |
| 查询与导航 | 任务 0B → 任务 6 → 任务 7 → 任务 8；任务 7 → 任务 9 |
| 大目录与树操作 | 任务 1 + 任务 7 + 任务 8 → 任务 10；任务 5 + 任务 8 + 任务 10 → 任务 13 |
| 基础编辑 | 任务 2 → 任务 12 |
| 查看与比较 | 任务 2 → 任务 11；任务 2 + 任务 4 → 任务 14 |

建议按三轮交付：

1. 数据安全轮：任务 0A、1–5。完成后才能宣称“编辑、保存、回收和恢复不静默丢数据”。
2. 发现与规模轮：任务 6–10、任务 12、任务 13。完成后交付快速打开、持久搜索面板、大目录治理和基础编辑控制。
3. 查看与比较轮：任务 11、14。图片和普通两文件比较属于 P2 增强；本地历史另开独立方案。

每轮都必须是可发布状态，不允许把旧读写路径删除后等待下一轮补恢复或搜索。

## 验收矩阵

### P0 当前验收台账

| 需求 | 当前状态 | 已有证据 | 缺失证据或阻断项 |
| --- | --- | --- | --- |
| 编码、BOM、换行和文件分类 | 单元闭环 | `file-document-codec.test.ts`、`file-safe-writer.test.ts`、`file-service.test.ts` | 安装包真实文件抽样 |
| 修订冲突、安全写入和层级路径互斥 | 部分闭环 | `file-safe-writer.test.ts`、`file-path-transaction-lock.test.ts`、`file-service.test.ts` | 路径操作规范身份锁、最终链接语义、macOS 元数据和跨进程并发验证 |
| 草稿按窗口隔离、代际回执和配额失败可见 | 部分闭环 | `file-drafts-service.test.ts`、`files-draft-lifecycle.test.ts`、文件面板组件测试 | 损坏条目诊断、真实双窗口、真实 8 MiB 重开和强杀恢复 |
| 关闭、退出、插件停用/重载屏障 | 部分闭环 | `plugin-lifecycle-barriers.test.ts`、`window-close-coordinator.test.ts`、`window-service.test.ts`、`plugin-disable-transition.test.ts`、`startup-stability.spec.ts` 的草稿故障关闭否决/单次提示/修复后重试 | 8 MiB 强杀恢复、真实双窗口同键草稿隔离和应用退出失败反馈 |
| 保存冲突交互 | 部分闭环 | `file-editor-controller.test.ts`、现有冲突比较组件 | 重新加载、覆盖、另存为、取消的完整交互矩阵 |
| 另存为写盘回执与可恢复身份迁移 | 部分闭环 | `file-save-as-state-machine.test.ts`、文件面板布局刷新组件测试、`file-save-target-ipc.test.ts` | 启动全局判别、无未保存修改目标的共享文档合并、项目外重启和各提交后强杀点 |
| 全部保存与部分失败汇总 | 部分闭环 | `file-save-all-action.test.ts`、`files-file-panel.test.tsx` | 分类结果、取消剩余、跨 group 组合与未编辑临时文档三入口 Electron 测试 |
| 回收/移动/重命名 dirty 保护 | 部分闭环 | `files-dirty-path-guard.test.ts`、`file-tree-actions.test.ts`、`files-document-store.test.ts` | main 操作令牌、目标规范身份、失败 `abortPathMutation`、转临时文档后的布局耐久提交、持久日志、启动恢复和强杀点 |
| 外部删除保留内存与草稿 | 状态已落地 | `file-editor-controller.test.ts`、文件状态组件 | 原路径重新创建动作及其冲突、失败和重启测试 |
| CodeMirror 编辑器决策 | 已冻结 | `file-editor-view-session.ts` 与本方案“固定技术决策” | 无 Monaco 迁移任务，也不预留替换工作包 |
| 文件到 Agent 上下文桥 | 明确后置 | 本方案范围和末尾独立入口 | 后续单独解决 Agent 身份、会话路由、权限和回执；当前数据安全轮不实现 |

“单元闭环”只表示结构和确定性分支已有自动化证据，不等于发布完成；对应行只要还有“缺失证据或阻断项”，P0 就不能转为完成。

### 目标验收矩阵

| 需求 | 主要证据 | 通过标准 |
| --- | --- | --- |
| 支持编码往返 | `file-document-codec.test.ts`、`file-service.test.ts` | 四种受支持文件格式在非混合换行符下字节级往返；无 BOM UTF-16 不误判 |
| 未知编码安全 | codec 测试、文件面板组件测试 | 默认只读，不能直接保存 |
| 修订冲突可靠 | `file-safe-writer.test.ts`、`file-service.test.ts` | 相同 mtime、不同内容冲突；提交前复检；明确记录跨进程 CAS 边界 |
| 权限、特殊文件与链接安全 | safe writer / service 测试 | mode 保持；根外链接拒绝；根内链接不被替换；特殊文件不阻塞读取 |
| 提交与耐久状态 | safe writer / 组件测试 | 提交后目录同步失败显示“已写入、耐久未知”，不盲目重试 |
| 耐久未知恢复 | drafts service、重启测试 | unknown 不删草稿；重启确认 revision 后才清理恢复条目 |
| 8 MiB 草稿恢复 | drafts service、SIGKILL 端到端测试 | 等待“已保护”后强杀并重启可完整恢复 |
| 草稿失败与代际 | controller 与组件测试 | 未收到同 generation 的耐久 `stored` 不显示已保护 |
| 多窗口草稿隔离 | service、store、双窗口测试 | 同名 untitled 和同文件 dirty 草稿互不覆盖 |
| 插件停用不删除草稿 | store 与插件运行态测试 | 停用再启用仍恢复 |
| dirty 路径操作 | dirty guard、store、组件测试 | 回收/覆盖/外部删除只有明确丢弃才删除 buffer 与草稿 |
| 另存为闭环 | state machine、context resolver、组件测试 | 所有可编辑文本可另存；项目外重启可恢复；提交后迁移失败不丢源 |
| 全部保存 | controller、跨 group 组件测试 | 当前窗口跨 group 汇总，untitled 和部分失败有确定结果 |
| 搜索运行时可打包 | 验证脚本、双架构包检查 | 空 `PATH` 仍可搜索 |
| 查询隔离与取消 | query service / IPC 测试 | sender 定向、唯一终态、取消后无 batch 和遗留进程 |
| 快速打开不加载整树 | async quick pick、quick open、tree store 测试 | top 200、列表虚拟化、只增加目标祖先链 |
| 内容搜索持续浏览 | service、搜索 panel、端到端测试 | 恢复重查、连续打开多个结果、截断、错误和 Unicode 定位可验证 |
| 大目录受控 | service、tree、组件性能测试 | 2 万子项分页且 DOM 有上限 |
| 排除策略正确 | service、watch、query 测试 | 共享 glob 语法但三域策略独立；隐藏文档仍收到变化 |
| 图片与二进制安全查看 | service、CSP、文件面板组件测试 | 预览字节有界、Blob 释放、SVG 不进 DOM、二进制不进编辑器 |
| 差异视图统一 | 文件面板组件测试 | 普通比较与冲突共用实现 |
| 操作反馈合规 | 组件测试、治理测试 | 无静默失败、无重复反馈、文案全部 i18n |
| 架构边界闭环 | dependency-cruiser、host context 测试 | 插件不直连 Electron、Node、dockview |

## 验证命令

### 本次工作区验证结果

- 完整检查：类型检查、lint、依赖边界和文件硬上限通过。标准 `pnpm check` 在本机 CPU 持续高负载时有两个既有 5 秒测试发生超时，单独复跑均通过；随后以 `--maxWorkers=4` 降低并发执行全量测试，351 个单元测试文件、3267 项测试，以及 27 个组件测试文件、372 项测试全部通过。
- `pnpm build`：通过。main、preload、renderer 三端生产构建成功；preload 产物 167.36 kB，构建后边界检查通过。
- Electron 沙箱 preload 已改为自包含 CommonJS；标准构建校验最终产物不含 `electron` 以外的外部 `require()`。空白页根因 `module not found: zod` 已由产物级检查锁定，不再只检查构建配置。
- renderer 在任何异步初始化前先渲染启动页、安装生命周期命令监听器，并记录启动壳已挂载；工作区完成初始化保留为独立状态，不再阻塞窗口可见。核心初始化失败时保留带错误链详情和重新加载入口的错误页，两种页面都挂载统一应用弹窗宿主。renderer 尚未能运行时，main 对入口加载失败、preload 失败、显示前界面进程退出和完整导航启动超时提供本地化原生重试/关窗兜底，并忽略正常导航取消和退出期加载；15 秒截止时间从初次加载或重试发起即开始，重试只接受主框架、非同页导航，每次新文档由 main 在 `dom-ready` 下发唯一挑战值，当前 preload 同时满足启动壳已挂载后才能回执。终端调试窗口也复用同一所有权、真实退出状态和挑战回执，不再静默吞加载错误或在退出期启动恢复。app core 惰性构造与 scheme 注册均进入受控启动 Promise，managed plugin 初始化拒绝不会被吞掉；主进程启动失败清理有 5 秒上限，不会因悬挂任务阻止退出。首屏只等待内置插件，Files 等核心面板在工作区恢复前完成注册；外部插件在 `App` 首次渲染后的下一帧独立启动。
- 外部插件加载具备逐插件超时、取消、迟到结果作废、故障诊断和激活作用域回滚。外部面板使用稳定槽位：加载、失败、重载实现都在同一 Dockview 实例内切换，参数、分组和位置不丢失；实现提供的标题和图标会同步到已打开面板。
- 插件停用与重载通过代际门禁和最新清单重新协调，覆盖“清单广播早于最终确认”“任一窗口提交收尾失败后补偿全部已准备窗口”“忽略取消信号的旧准备不得与新准备重叠”“main `transitionId` 精确授权、获取和消费”“跨原因及参与者注销后的插件级历史回执先补偿”“本地提交失败先回滚且需求回退不误销毁”“本地租约过期时最后复核并补偿”“部分 disposer 失败后完成清理再全量重激活”“准备/收尾排空后自动补偿或重试”“终态销毁循环等待派生排空且插件间隔离”“完成历史淘汰后仍按未消费回执补偿”。插件清理失败会同时保留 runtime 所有权和提交回执，并通过 finalize 命令返回主进程，不静默显示为卸载成功。全局插件标识、宿主保留 action/panel、核心终端状态项和核心指挥中心物料均校验内置与官方外部插件；治理测试保证全部核心 action 与 main 保留集双向相等，运行时注册表拒绝重复并按对象身份释放。
- `tests/e2e/startup-stability.spec.ts` 的构建态 Electron 回归连续两轮共 6 项全部通过：启动页仍在显示且工作区从未挂载时可关闭；草稿持久化真实失败会否决关闭、保留窗口并只显示一个应用弹窗，修复故障后重试可关闭；两个窗口重启后按最后聚焦记录恢复，后台窗口不抢占焦点。启动错误页本体、聚合错误详情和弹窗宿主由组件测试覆盖；主进程启动失败的原生提示、全量清理和确定退出由单元测试覆盖，尚未人为注入构建态致命启动错误。
- lint 仍报告 8 个既有的无效 suppression 警告，但没有 error；它们不属于当前工作区新增错误，也不改变检查退出状态。
- 当前定向单元、组件测试还覆盖文件安全写入、读写编解码、草稿分片与迁移、另存为状态机、全部保存、dirty 路径守卫、关闭协调、preload 边界、外部插件生命周期和稳定面板热更新；这些测试通过不代表后文发布级故障注入完成。
- 尚未完成本方案要求的同 `userData` 8 MiB 强杀恢复、真实双窗口同键草稿隔离、性能、双架构安装包和签名验证，因此文件核心发布门槛仍未通过。

每个任务先运行自身定向测试，再运行所属轮次测试。每轮结束至少执行：

```bash
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test:unit
pnpm test:component
pnpm build
```

发现与规模轮和最终收口额外执行：

```bash
pnpm test:e2e
pnpm test:performance:files
pnpm check
node scripts/verify-file-search-runtime.mjs
```

正式发布前还要在对应架构 CI 执行机运行 `pnpm build:dist --no-notarize`，解包 `arm64` / `x64` 应用并执行真实内容搜索冒烟验证。搜索二进制、可执行位、架构、asar 路径或签名任一未通过，均视为发现与规模轮未完成。

### 发布门槛

- 数据安全发布门槛依赖任务 0A、1–5 全部完成。
- 文件核心功能发布门槛额外依赖任务 0B、6–10、12、13 全部完成。
- 任务 11、14 是查看和比较增强。若纳入某个版本，则同样必须通过各自验收，不能以 P2 为由半交付；本地历史不在当前目标版本的发布范围。
- 最终门槛统一执行 `pnpm check`、`pnpm build`、开发构建端到端测试和目标架构安装包冒烟验证；任何阻断级验收失败都停止发布。

## 风险与控制

### 编码检测误判

只支持可确定识别的 BOM 和严格 UTF-8。无 BOM 的其它本地编码第一阶段返回“不支持的编码”，不要引入概率检测后自动写回。后续如需 `GB18030` 等编码，应增加显式选择和字节级测试。

### 内容摘要成本

编辑上限当前为 10 MiB，保存冲突前读取并摘要可接受。若未来提高上限，再引入分块摘要或文件句柄级比较；不要提前用 `mtime` 换性能。

### 搜索二进制供应链

搜索运行时属于正式包的一部分，必须锁版本、校验来源并走双架构签名验证。不能在运行时下载，也不能从任意 registry 或本地路径动态发现。

### watcher 平台差异

`fs.watch` 在不同文件系统上的递归和丢事件行为不同。文件监听只负责提示失效，保存前 revision 校验才是最终一致性边界。

### 外部写入与文件元数据

revision 只能提供乐观并发保护，不能承诺跨进程强 CAS。macOS hardlink、owner、ACL 和 xattr 的保存策略必须通过任务 1 的技术验证后写入实现说明；无法保留时必须拒绝或显式降级，不能静默。

### 草稿恢复边界

只有已经显示“已保护”的 generation 承诺异常恢复。“保护中”的最后防抖窗口在进程被强杀时可能丢失；有序退出、关窗和插件停用则必须通过刷新屏障完成或被取消。

### 范围膨胀

遇到符号、诊断、代码补全、Agent 附件或多根工作区需求时，只记录后续入口，不在本方案任务中实现。它们需要新的所有权和验收矩阵。

## 各交付轮完成时应删除或收缩的旧路径

- 删除“为搜索递归加载完整文件树”的实现；文件树搜索改用查询结果。
- 删除 renderer 的 NUL 字符二进制猜测。
- 删除草稿写入超限后静默返回。
- 删除插件停用时删除持久草稿的耦合。
- 文件插件不再使用 `expectedMtimeMs` 作为保存冲突依据。
- `pier.files` 内删除旧 `readText` / `writeText` 调用，并以治理测试锁定；兼容 facade 仅按 v1 原语义留给旧调用方，等待独立版本化废弃。

## 后续：文件到 Agent 的上下文桥

本方案只预留稳定输入，不实现桥接。未来开始该能力前，必须另写架构方案并回答：

- Agent 身份来自活动终端、前台活动、显式选择还是会话注册表。
- 同一窗口多个 Agent、同一 Agent 多会话、Agent 已退出时如何路由。
- 发送的是路径、选区、当前修订内容、差异还是持久快照。
- 发送后由谁回执“已进入哪个 Agent 的上下文”，失败如何重试。
- 文件权限、未保存内容、敏感文件和大小限制如何处理。

本方案的文档读写接口提供 `root + path + revision`，查询结果提供位置；这些是未来桥接可复用的稳定输入，但不会反向把 Agent 身份放进 Files 文档模型。
