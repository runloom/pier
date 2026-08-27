# CHANGELOG

按 [Keep a Changelog](https://keepachangelog.com/) 与 Conventional Commits 组织。日期用 ISO 8601。

## [Unreleased]

### Changed

- **Canvas 用通用插件通道组合。** 画布经 `pluginData` 投影、`pluginAction.invoke`、`settings.open` 与宿主聚合 hook 自拼界面；不提供官方账号组件或第二套 widget 贡献点。
- **Git Review Z2 批摘录主路径。** content 正文默认走 `git.getReviewExcerptBatch`
  （单世代、16–32 文件一批）；`getReviewFileDocument` 只用于选中 boost、失败重试
  和 discard 令牌。金标准 G5 闭合，不再逐文件 IPC 取号。
- **评论导航图标。** git 审查、Markdown、Canvas 共用的底部评论条改为
  `MessageCircle`，与正文里的评论标记一致。

### Removed

- **工作台面板。** 去掉新建工作台命令、旧 layout 中的工作台 / dashboard / mission-control 标签，以及插件 `workbenchWidgets` 贡献点。账号添加、删除、OAuth 仍在设置页。

### Fixed

- **终端 resize / 长会话闪烁。** `fitToSize` 在像素未变时跳过刷新，并把
  scrollbar 与 surface 尺寸解耦，切断「用久了一直闪」的反馈环；统一
  点→像素公式；图层改不透明并下推主题底色；host resize flush 同步呈现。
  分栏 sash 拖拽接入与窗口拖拽相同的 surface suppress；presentation cover
  增加 500ms 强揭超时；Cursor 视口轮询按窗口在 resize 期间让路，zoom / 关窗
  / 1s 兜底恢复，慢 dump 退避，sync 失败不中断轮询。
- **Git Review 搜索栏 Esc。** 从搜索结果打开文件时 reveal 保留输入框焦点，
  按 Esc 能关掉搜索栏。
- **Git Review pending 骨架。** 未水合文件只占文件头 + 5 条骨架，不再按
  git 行数拉高空白占位；+N/−M 仍在文件头。树跳转仍靠一次校正钉顶。
- **Git Review 树点选正文。** 先钉选中文件再批摘录，避免点中文件进最多
  32 文件的批次；加载卡住时再点会取消重试。选中正文 24s 仍未就绪才超时，
  邻项仍 8s。
- **Git Review 目录树跳转贴顶。** 文件头高度取整到 CSS 像素，分隔线改画在
  文件底边内侧，点树 align:start 不再空出 1px。
- **Git Review 评论导航定位。** 在目录树点到其他文件后再点 n/N，会走树导航 +
  正文就绪后再滚到评论行，不再用一次估高滚动打偏、连点才准。行级定位在
  paint 前完成，避免先闪文件头再跳到评论。
- **评论计数气泡数字居中。** 序号用 grid 叠在气泡同一格里居中，不再用像素 translate 微调。
- **Cursor 空闲后仍显示思考中。** 子智能体独立 conversation 只发工具、无
  stop；主会话可信终态时封掉未见过提问的衍生账本，状态栏回到等待输入。

## [0.1.32] - 2026-08-26

### Changed

- **增强输入附件轨改为识别优先。** 全部 **48×48** 等格：图 contain；文本/粘贴露出开头缩略；其它文件只显示类型图标，名字在悬停提示；轨上无 `#n`；附件过多时横滑不折行。
- **输入芯片胶囊形。** 增强输入里 @ 路径、命令、技能、附件与 review 芯片统一为全圆角胶囊样式。
- **程序化聚焦光标置尾。** 重新打开或切回增强输入时，光标落在草稿末尾而不是开头，对齐主流聊天输入框惯例；点击正文内仍按点击位置定位。
- **增强输入关开保留编排。** 切换关闭再打开时，命令 / 技能 / @ / 附件 / review 芯片连同顶部附件轨原样恢复，不再退化成裸文本；发送成功后照常清空。

### Fixed

- **增强输入 Esc 分层。** 命令 / 技能 / @ / # 列表打开时按 Esc 只收起列表，不再连带关闭整张输入卡片；列表收起后再按一次 Esc 才关闭。

## [0.1.31] - 2026-08-22

### Added

- **未安装智能体一键安装。** 探测完成后同时显示未安装徽章和安装按钮；只能从网站安装的智能体不提供一键安装。
- **账号剩余重置次数。** Codex 与 Grok 账号行在有剩余重置时显示次数。

## [0.1.30] - 2026-08-20

### Added

- **Astro / GraphQL / Terraform 语言服务。** 打开这些文件会启用对应语言服务器；Astro 会带上本机 TypeScript 工具。
- **Less / Sass / Stylus 高亮。** 样式方言和 Markdown 代码块共用同一套语法高亮。
- **系统技能改存用户目录。** 产品技能安装到用户数据目录，打开项目后即可在技能建议里用到，不再把技能树写进仓库。

### Changed

- **终端历史。** 终端里能看到的输出就是全部历史，上限仍由设置控制；去掉状态栏「查看完整历史」。

### Fixed

- **智能体回合状态。** Cursor 把同一提问拆到两个会话时会并成一次回合，状态栏不再在空闲后仍显示思考中。新提问会开启新回合。
- **macOS 屏幕录制提示。** 启动时不再弹出用不到的屏幕录制权限。
- **开发版图标。** PierDev 在程序坞和活动监视器里显示同一套图标。

## [0.1.29] - 2026-08-19

### Added

- **日语与韩语界面。** 设置可切换日本語 / 한국어，也可跟随系统语言。
- **工作台分屏。** 官方插件把智能体打开的分屏接到工作台面板。
- **终端完整历史。** 状态栏可查看含重启前的完整输出；过长时显示最近一段。
- **Markdown 预览 HTML。** 预览支持消毒后的 GitHub 风格 HTML。
- **审查图片对比。** Git 审查对图片文件提供并排和滑动对比。

### Changed

- **滚动条外观。** 目录树、文件正文和工作台共用同一套不透明滑块；内容渐隐不再盖住滚动条。
- **窄屏审查对比。** 审查区域变窄时自动改为单栏对比，加宽后再回到左右分栏。

## [0.1.28] - 2026-08-16

### Added

- **复制路径与所选行。** 可用快捷键复制当前文件路径，并带上所选行号；设置页支持搜索快捷键。
- **工作树语言服务。** 新工作树默认开启语言服务，设置页会安全列出本机已安装的工具。
- **画布画框。** 支持钉住物料发现，并提供画板画框。

### Changed

- **终端首条输入。** 启动后第一条内容先粘贴，再单独回车发送，避免和会话启动抢输入。
- **未聚焦标签运行态。** 未聚焦的终端标签恢复顶部运行轨道。
- **账号用量展示。** 标量用量改由徽章展示，只有紧凑模式才留在用量条上。

### Fixed

- **预览与宿主弹层。** 预览层会让出确认框、设置和命令面板，全屏顶栏仍可拖动窗口。
- **评论导航与 Markdown 评论。** 评论导航条钉在预览视口；Markdown 评论改为块旁徽标，不再挤开正文。
- **Grok 用量周期。** 周期交界缺少百分比时按新窗口 0% 展示。
- **变更与冲突。** 切换变更页签时聚焦对应目录树分组；去掉重复的冲突文件头。
- **智能体等待态。** Cursor / Grok / OMP 在缺少状态回传时也能正确结束等待。

## [0.1.27] - 2026-08-15

### Added

- **宿主目录统一。** 集中管理智能体 CLI、官方插件与 Pier 应用的安装和版本信息，设置页可稳定刷新并展示最新状态。
- **未命名文件与编辑模式。** 文件面板支持直接新建未命名文档，并记住编辑器的文档模式选择。

### Changed

- **增强输入建议。** 技能斜杠建议与行内芯片对齐更自然，附件、技能和审查评论在输入框中保持一致布局。
- **智能体等待状态。** 询问与计划确认会准确显示为“需要你处理”，完成后及时恢复运行状态。

### Fixed

- **终端启动兼容性。** 避免环境采集输出与带 shebang 的输入破坏 Ghostty 会话启动。
- **智能体更新与重装。** 只统计真实更新，并将重装操作与普通更新明确区分。
- **Git 审查恢复。** 刷新后会重试此前超时的审查正文，不再停留在空白或加载态。
- **发布门禁。** 修复类型、测试夹具与目录密度约束，保证完整发布检查通过。

## [0.1.26] - 2026-08-14

### Added

- **Git 审查远距跳转钉住。** 目录树点到较远文件时先按估算高度落地，目标真实高度出来后再一次校正；加载中冻结目标以上条目，避免骨架屏把落点顶偏。
- **画布外链。** 修饰键点击画布链接走系统浏览器，不再被预览内部吃掉。
- **Grok 剩余重置。** 账号用量展示剩余重置次数（remaining-resets）。
- **命令注入失败上报。** shebang / 失败的智能体命令会写入消息中心，不再静默吞掉。
- **Pier Home 系统技能与 L1 发现。** 设置里可浏览系统技能；技能建议面扩大。
- **pier-canvas 决策模板。** 新增 decision 呈现包与决策向画布模板。

### Changed

- **Tab 顶缘指示器。** 三态权重对齐，最大化后横向滚动仍可用。
- **dockview-core 直依赖。** 声明后 tab 滚动补丁能打进安装树。

### Fixed

- **审查文档加载。** 当前选中条目失败时不再静默重试掩盖错误。
- **preflight 类型。** Grok fetch 与审查导航的 typecheck 对齐，合 main 一次绿。

## [0.1.25] - 2026-08-12

### Added

- **Git 审查冲突接受。** 合并冲突文件走 UnresolvedFile 宿主：Accept 写回磁盘、stage 与 digest 对齐，冲突标记文案可 i18n。
- **Local-control 终态收口。** 人类 CLI 控制平面（会话/快照/runtime fence）与终端/工作树/通知命令面落地；`agents self` 产品路径明确拒绝。
- **语言服务 L0 矩阵与双轨 language modes。** PATH 工具目录 + 插件 languageModes/languageServers 贡献；Files 设置下挂语言服务策略。
- **评论与 Markdown 预览。** 多 kind 锚点、blob 防挂死、HoverCard 语言服务态、大纲与阅读偏好复用。
- **Tab 条滚动所有权。** dockview 最大化后保留横向滚动；文件 tab 重名消歧。

### Changed

- **宿主/内置插件边界。** 语言模式与 LSP 安装指引同步只经 builtin-catalog；设置 Files 段不再直接 import 插件 manifest。
- **目录密度。** project-skills store、markdown comments、editor language、contracts 等领域按 feature 分子目录。

### Fixed

- **合并后 preflight。** typecheck/lint/depcruise/组件测与治理单测对齐合并债，保证一次绿合 main。
- **终端 Esc。** 忙态智能体裸 Esc 清 busy 并对账为中断。

## [0.1.24] - 2026-08-11

### Added

- **产品 CLI 用户手册画布 SSOT。** `pier-cli-user-manual` Canvas 为唯一 CLI 手册真源；删除双维护的 `docs/cli.md`，并加 inventory / surface 治理门禁。
- **Local-control v2 架构闭环。** agent 控制通道 v1/v2 会话、peer 身份、凭据与 receipt 路径落地。
- **智能体会话恢复。** Pier 重启后扩展 resume adapters 与终端会话 resume 索引，尽量接回进行中的 agent 会话。

### Changed

- **全区域失败态统一 ErrorEmpty。** 画布 runtime、文件面板、技能详情、传输不可用等从软 Alert 改为 ErrorEmpty/统一空态。
- **产品 CLI 保持 cli-human。** 不把 agent-caller 绑定写进产品 CLI 主路径；agents self 在解析期拒绝。

### Fixed

- **应用更新下载失败可重试。** 下载失败后保留可重试错误态，而非卡死。
- **preflight 本地 FS 稳定性。** 限制 worker、renamex 重试、生命周期升级用例超时，降低 project-skills 误红。

## [0.1.23] - 2026-08-10

### Added

- **增强输入粘贴分档。** 短文本仍全文插入；中/大段纯文本粘贴走附件轨（与文件同款 56×56 tile），点击可编辑；中档发送展开正文，大档仍按路径附件。
- **文件树滚动所有权金标准。** 单一滚动意图 owner：用户滚优先；path-sync 条件补偿；reveal settle 与菜单钉滚对齐；治理扫描锁定写路径。
- **Markdown 预览增强。** 图示视口、阅读字体与大纲滚动手感改进；短代码块默认不限高。

### Changed

- **消息中心 Header 操作不再关 Popover。** 「全部已读 / 勿扰」成功后保持列表展开，便于继续浏览；卡片导航 action 仍关闭。
- **多智能体金标画布。** 重写为 agent-first CLI 呈现与协作分区。
- **文档部分归档。** 已落地 superpowers 过程文档迁入 `docs/archive/`，活文档与历史规格边界写清。

### Fixed

- **终端打开路径。** 路径点击优先 Pier Files；`.ts` 等不误走系统应用。
- **Composer 光标与芯片。** 恢复 chip 旁跳转；粘贴分档编辑动作可用。
- **LSP 悬停。** 仅在存在定义时显示 Cmd+hover 下划线。
- **评论与审查。** 提交后隐藏孤儿评论；评论操作可见性与居中导航；reveal 跳转更稳。
- **对话框焦点。** alert 确认键与 prompt 输入在打开时正确聚焦。
- **设置智能体探测。** 打开设置时带 TTL 的 SWR lifecycle probe。

## [0.1.22] - 2026-08-08

### Added

- **项目级画布预览目录。** 设置 → 项目 → 常规可编辑 Live Modules 内容根列表（默认 `.pier/canvases` 与 `docs`），保存后已开画布面板会刷新；附带 pier-canvas 内容/呈现/UI 方法论包与多智能体金标总览样例。
- **SCM 装订线跳转变更。** 编辑器 Git 装订线可点击，打开或聚焦「变更」面板并滚到对应行；回到文件时尽量保留滚动位置。

### Fixed

- **长提示弹窗滚动条。** 正文过长时滚动条贴内容区右缘，文案仍与标题左齐。
- **插件边界。** Live Modules 项目配置缓存迁入 `plugins/api`，避免内置插件直接依赖宿主 renderer 模块。

## [0.1.21] - 2026-08-07

### Changed

- **画布图与 Markdown 全屏统一。** NodeGraph / Mermaid 全屏走宿主 ContentPreviewHost：共享顶栏关闭、底中缩放条、标题安全区与纯色纸面；页内仅右上全屏入口，去掉自定义 immersive portal 与网格背景。
- **节点标签完整展示。** 关系图节点标题/元信息不再省略号截断，高度按文案估算布局。

### Fixed

- **全屏与顶栏重叠。** ContentPreview 舞台预留顶栏安全区，图片/流程图/节点图均不再压住标题。
- **Stage 缩放控件。** 缩放上下限与 Fit 语义对齐图片预览；滚轮后比例文案正确离开 Fit。

## [0.1.20] - 2026-08-07

### Added

- **节点图全屏展开。** 工作台 / 画布节点图支持展开到全屏表面，便于大图浏览。
- **多智能体 CLI 金标画布。** 附带 multi-agent orchestration gold canvas 样例与数据。

### Fixed

- **差异选区复制。** Diff 字符选区与右键复制更可靠；指针命中支持 client 坐标回退。
- **Git 工作树占用提示。** 切换分支时若目标在另一工作树，给出可读错误说明。
- **Mermaid SVG 消毒。** 预览 SVG sanitize 收紧，降低恶意/畸形图风险。
- **CI 覆盖率超时。** pier-canvas SDK 类型检查在 coverage job 下延长超时。

## [0.1.19] - 2026-08-07

### Added

- **行内审查评论。** Git 变更预览支持行内评论、漂移提示与智能体交接回路。
- **Shell 环境与任务运行控制。** VS Code 风格 shell dump、TaskRuns 窗口归属与终端运行条右锚定。

### Fixed

- **Shell dump 污染与超时。** 剥离 ELECTRON_*/PIER dump 键，fallback 共享一次超时预算。
- **后台任务可见性。** 后台任务要求 windowId，避免运行条丢失；诊断 ctx 有界。
- **智能体探测注入。** 测试用 probe 不再被真实 PATH which 干扰。

## [0.1.18] - 2026-08-05

### Fixed

- **Git 远端超时与错误分类。** 推送/拉取/发布/同步超时放宽到 20 分钟，避免推送前检查被 60 秒掐断；超时与本地钩子失败给出可读说明，而非半截命令回显。
- **工作树创建。** 避免创建时上游跟踪与路径不一致。
- **插件设置入口。** 统一插件设置链接是否可点的判定。

## [0.1.17] - 2026-08-05

### Added

- **智能体 CLI 安装与更新。** 设置页可探测、安装与更新各智能体 CLI（含 brew/npm/自更新与 fallback 链）。
- **计划阻塞工具 waiting。** Claude / Grok / OpenClaude 等对 EnterPlanMode / ExitPlanMode / AskUserQuestion 等阻塞工具经 toolUseId 闭环上报 Interaction*。
- **可调用技能目录。** 终端 composer 技能建议接入智能体 bundled skills 目录。
- **Git 远端工作流收口。** 发布分支、fetch、跟踪切换与 gone upstream 再发布；差异头路径 Cmd/Ctrl+点击打开文件。
- **文件磁盘冲突与热更新。** 打开文档实时跟磁盘；冲突横幅支持加载磁盘版/保留本地/对比。
- **路径面包屑右键。** 复制绝对路径与相对路径（去掉文件面板前进/后退历史）。

### Fixed

- **文件树展开与滚动。** 路径 remint 后恢复展开；树垂直内边距与 scroll-fade 统一。
- **CI / 类型与治理。** exactOptional 与 Linux 下 brew cask 计划测试、目录密度棘轮对齐。

## [0.1.16] - 2026-08-04

### Fixed

- **面板标签与溢出。** 标签 tooltip、溢出菜单 chrome 与关闭文案 i18n 对齐。
- **Git Review 打开上下文。** 保留审查文件路径上下文；文件组视图认领失败时对用户可见。
- **设置弹窗滚动。** 技能详情与 max-h 设置弹窗恢复可滚动内容区。
- **终端 OSC 路径标签。** 路径型 OSC 标签 short 显示目录 basename，完整 cwd 进入 long/tooltip。
- **测试稳定性。** SQLite reader 在 V8 coverage 下不再误报 closed；Cmd+P 复用已开文件标签时刷新 panel context。

## [0.1.15] - 2026-08-04

### Added

- **登录 shell 环境对齐。** 任务、智能体与插件 spawn 可复用登录 shell 环境（可关、可调超时），
  设置终端页展示主机状态与刷新。
- **面板跨窗口移动/复制。** 标签菜单支持移到新窗口、复制到新窗口、移到/复制到已有窗口。
- **多 worktree 开发端口。** 多 worktree 同时 `pnpm dev` 时自动分配端口并清理外 worktree 继承绑定。
- **目录树快捷键。** 文件树与变更树支持 Mod+B 折叠/展开侧栏。
- **从变更跳到源码。** Review 差异右键可按指针行跳转到磁盘文件对应行。

### Fixed

- **Markdown / 磁盘热更新。** 原子写盘后预览与磁盘文档保持可重载、不卡住旧内容。
- **侧栏文案。** 文件树与变更树使用 Hide/Show 语义标签，并补齐 Tooltip 宿主测试。
- **插件环境。** Claude / Codex / Grok 账号与登录 spawn 接入宿主进程环境解析。

## [0.1.14] - 2026-08-03

### Added

- **前台活动回合语义硬化。** 统一权威回合起点、中心分类与密封状态转移；智能体
  运行态证据与终态对账更稳。
- **面板未聚焦时的回合完成通知模式。** 可在智能体不在焦点时仍收到回合完成提醒。
- **终端标签拖拽输入路由与诊断。** 拖拽标签时接管输入路由，并落盘可排查的诊断痕迹。
- **Git 干净状态视图「查看变更」入口。** 从状态栏可进入 Changes 阅读面。

### Fixed

- **Git Review 折叠与虚拟高度。** 折叠全部覆盖后进窗口的文件；几何与 collapse-all
  布局对齐金标准。
- **状态栏与 UI 细节。** 变更行增删色、Tabs 暗色激活可读性、scroll-fade 菜单实底、
  自动隐藏滚动条与设置页底部渐隐、标签运行指示改为不定进度条。
- **SSH 主机快照。** 设置页重挂载时复用 hosts 快照，避免闪空。
- **Tooltip / 账号到期展示。** 默认不因焦点打开 tooltip；远端到期徽章在 cancel-at-period-end
  时保持中性。

## [0.1.13] - 2026-08-02

### Added

- **通知聚焦路由。** 消息中心通过统一 `DeliveryPlan` 在有 Pier 焦点窗时走应用内
  消息 toast，无焦点时对白名单事件走系统通知；智能体细粒度静音只关打断、仍落收件箱。
- **Markdown 跨模式阅读位置。** 源码与预览切换时用内容锚点恢复阅读位置；Mermaid 图
  跟随主题色并支持预览缩放。
- **Changes 按审查范围区分图标。** 未提交 / 分支 / 提交等范围在标签上使用不同图标。

### Fixed

- **技能与启动。** 磁盘技能内容为权威来源，去掉库漂移硬门；技能问题不再硬阻断智能体
  启动或设置主路径操作。
- **Git Review 背景失败面。** 持续同步路径不再弹出全局 error toast；保留 last-good 树与
  正文，失败仅在行内或整页无可展示时呈现。
- **终端焦点与 UI 细节。** 释放 durable web 焦点后清理残留 `pier.click`；短列表与弹窗
  增加滚动渐隐；运行中标签使用软 shimmer 顶边指示。

## [0.1.12] - 2026-08-02

### Added

- **Tokyo Night 主题配对。** 新增 Tokyo Night 深色与 Enkia Tokyo Night Light
  浅色配对，并支持在多窗口间同步主题预览。
- **工作台标签运行轨迹。** 活动标签以完整细轨持续显示运行状态；Markdown 预览大纲
  维持右侧细轨并在悬浮时展示长标题。

### Fixed

- **代码变更预览与 Git Review 稳定性。** 修复 CodeView 布局竞态、跨阅读面定位、
  空侧栏，以及文件树展开和导航的一致性。
- **终端与智能体状态。** 终端标签标题按 Ghostty 语义处理 OSC 与回退；OMP 正常回合
  结束会正确收敛为完成状态，工具调用期间不会过早显示就绪。
- **文件与技能交互。** 修复导入路径上的 LSP 悬浮范围；未托管技能路径冲突不再阻断
  智能体启动。

## [0.1.11] - 2026-08-01

### Added

- **本地 preflight 与精简 Quality Gate。** 默认 pre-push 跑 static+unit+component；
  path filter 跳过无关 native/windows job；coverage 文件并行以缩短 CI wall-clock。
- **Git Review 金标准（G0–G4 + G6 探针；G5 为 Z1 中间态）。** 正文仅
  content-bearing（pure rename / empty / binary 默认不进 CodeView）；pending
  骨架 5 行真实 DOM + **inline 几何**（防整宽灰板）；**estimate 仅 demand/seed
  窗口**（禁止全 content 灰条海）；window 出现后 seed 退居 buffered 继续水合
  （禁止 cancel 首批）；demand 内 8s 超时→error；导航 `pending_scroll`；
  `lineDiffType=none` 单源；并发默认 12。
- **G5 / 加载路径（Z1 达 DoD，Z2 批摘录未合入）。** 当前主路径仍为 content 子集
  上的有界 `getReviewFileDocument`。S1–S9 在 Z1 机测可证；**Z2 多文件批摘录流
  未完成**，超大仓仍可能有界排队。后续须补 Z2。

### Fixed

- **Coverage / 单测与 CI 对齐。** agent 配置路径 XDG 隔离、git symlink 省略理由、
  review stage long-task 预算、preflight 下 unit worker 上限，减少假红。

## [0.1.10] - 2026-07-27

### Added

- **Git Review 稳定账本与变更块 stage。** 阅读连续性（reading session / anchor）、
  稳定 ledger、hunk / change-block 级 stage·unstage·revert，以及 DiffView
  生命周期与 virtual-scroll 阅读稳定治理。
- **项目级内容搜索。** Files 插件 content search 面板与命令入口。
- **工作台对话框表单布局。** 统一 sticky footer / dialog form layout；自定义
  卡片编辑拆分为独立弹窗与区块编辑器。
- **Canvas 框架纠偏。** live-module 框架核与 sibling file API；样例与 dogfood
  路径收敛。
- **账号跨工具同步增强。** Claude OAuth 同步到 OpenCode / Pi / OMP；Grok OIDC
  同步到 Pi（版本感知 peer readiness）；切换确认对话框与 peer 可用性探测。
- **任务脚本 frecency 跨 worktree 共享。** package-script 最近使用排序按
  仓库身份共享。
- **面板标签活跃任务点。** tab 上显示进行中任务存在指示。

### Fixed

- **确认 toast 与消息 toast 位置分层。** 确认型 top-center，消息型 top-right。
- **命令面板共享 git 前缀排序。** 按命中字段长度排序，避免缩写抢位。
- **文件标签过早截断。** 停止过早 label truncation，精简 file palette 条目。
- **托管插件更新目标。** managed update 与 catalog bundled max 对齐。
- **终端 agent 发送误附剪贴板图。** 文本发送路径不再夹带 clipboard images。
- **Git review / coverage / e2e 门禁对齐。** 性能预算 CI slack、治理测试与
  覆盖率 floor 跟进 develop 大面。

### Plugins

- 官方插件 patch：`pier.claude` 1.3.5、`pier.codex` 1.4.6、`pier.grok` 1.1.6、
  `pier.ssh` 1.0.4。

## [0.1.9] - 2026-07-26

### Added

- **Live Modules（C-track）与 Canvas 预览。** 宿主侧 `live-modules` 编译管线
  （esbuild + 多框架插件）与 `pier-live://` 协议；Files 插件可预览
  `.canvas.*` 模块；`.pier/canvases` 样例与 fixtures 一并入库。
- **工作台「全部刷新」。** 统一 core/插件物料的 refresh action 与 token 刷新；
  账号用量物料（Claude / Codex / Grok）接入共享 refresh-all 路径。
- **消息中心快捷键与关闭策略。** `⌘⇧N` 切换消息中心 Popover；卡片导航与
  Header「全部已读 / 勿扰」成功后自动关闭。
- **标签页操作简洁提示。** 最大化 / 新建等 tab 动作使用短产品文案，并在
  tooltip 中附带快捷键。

### Fixed

- **宿主独占确认弹窗尺寸。** `alert` / `confirm` / `prompt` / `choice` 宽度由
  宿主按 kind 固定，调用方与插件 facade 不再传 `size`。
- **技能库漂移不再阻断智能体启动。** 与 launch gate 对齐，避免 library-drift
  误拦。
- **恢复的智能体结果空态。** 终端「已恢复结果」视图改为产品向空态文案与布局。

### Plugins

- 官方插件 patch：`pier.claude` 1.3.4、`pier.codex` 1.4.5、`pier.grok` 1.1.5、
  `pier.ssh` 1.0.3（账号物料 refresh-all 与清理）。

## [0.1.8] - 2026-07-26

### Added

- **统一消息中心。** main 侧 NotificationCenterService 统一接收系统/后台
  消息（去重合并、ring buffer 持久化、全窗广播）。入口为标题栏铃铛 + 未读
  徽标 + Popover 全量列表（滚动加载更多；无独立 dockview 面板、无筛选/
  搜索）。系统/后台事件经 `systemNotify` 双写：消息型 toast（形态 B）+
  收件箱；用户动作仍走确认型 toast（形态 A）。agent「需要你处理」/ 回合
  结束 / 出错、后台任务终态、应用更新、通道故障等可回看；卡片
  `NotificationCard` 与 action 分发在 popover 内统一。支持勿扰（仅 error
  弹出）、按类静音、7/30 天保留；设置页为「消息中心 → 提醒内容 → 提醒
  方式」三卡。旧 layout 中的 `notifications` panel 会在恢复时被剔除。
- **Agent Assets：MCP 发现（规则 UI defer）。** 设置 → 项目详情保留「MCP」
  只读发现；「规则」Tab 暂不展示（产品面收窄为 Skills + MCP，多会话 /
  Canvas 以技能为主）。本机工作台详情为技能 → MCP；仓库项目为
  环境 → 技能 → MCP → 常规。
- **Pier Home 技能库 + 项目 pierBindings（主链路）。** `{userData}/pier-home/skills/library`
  CRUD（`pierHome.skills.*`，含 `setAlwaysInclude`）；每项目
  `pier-bindings.json` 绑定/解绑（`skills.pierBindings.*`）；ensureReady 与系统
  技能共用投影通道。本机工作台 Skills：库编辑与智能体全局只读均二级弹窗
  （CodeMirror）；全局仅打开预览（无 Finder / 采纳）；库编辑可开关「始终包含」；
  行上展示可用智能体。项目：Pier badge、「从本机库添加」、「从本项目移除」。
  规则超限文件仍可在 Pier 中打开。

### Fixed

- **Pier Home 技能装入收敛。** 删除库技能 / 改「始终包含」/ 编辑库正文后会
  fan-out `ensureReady`，卸掉或刷新各项目的发布副本与发现根 symlink；手动绑定
  支持 per-bind delivery（可选 Claude）。ledger 升为 v2 `bindings[]`。
- **Pier Home fan-out / 投影可观测性。** 无已知项目时 converge 不再静默成功；
  `ensureReady` blocked 在 converge / bind / unbind 中按失败处理；打开项目技能
  snapshot 会 best-effort 自愈并把 blocked issues 并入 health；删除始终包含技能
  改为先删库再 converge（避免删前再投递）；始终包含默认投递 agents；错误软链
  校验目标后交给 repair；损坏的 `pier-bindings.json` 抛错而非静默清空。
- **增强输入图片/附件路径重复。** Lexical chip 已把绝对路径写进正文后，
  发送载荷不再无条件把附件轨路径再拼一遍前缀，避免智能体侧看到两份同一
  图片路径。
- **增强输入 Enter 对 Cursor 等 agent 只进输入框不提交。** `submit: true`
  时在 paste 文本后注入的 Return 键补上 `text="\\r"` 与
  `unshifted_codepoint`，避免 bracketed paste 后 synthetic keycode 单独
  不足以触发 TUI 提交。
- **增强输入 Enter 仍被部分 agent TUI 吞掉（paste 与回车同批到达）。**
  `submit: true` 时 paste 文本与合成 Return 之间加入 settle 延迟，把两次
  写入拆成 TUI 的两次 stdin read，避免其输入状态机仍停在 bracketed paste
  处理中吞掉回车（codex#28167 同款，cursor-agent 实测复现）；增强输入
  空草稿透传的 Enter 同步补上 `text="\\r"`。
- **终端点击激活失败可观测 + ⌘⇧I 无目标时有反馈。** main 侧
  `acceptNativeFocusIntent` 拒绝（not-ready/stale/hidden）写入 lastError，
  终端 debug 窗口可见；增强输入快捷键解析不到目标终端时 toast 提示先切换
  到目标终端标签页，不再静默。
- **打开增强输入瞬间向 TUI 发瞬时 focus-out，导致部分 agent 输入框失焦、
  Enter 不提交。** `applyTerminalWindowState` 原先先移交 first responder 再挂
  hostCursorHidden，转场间隙 surface 派生出 focused=false 并发出 `ESC[O`；
  cursor-agent 等依赖 mode 1004 上报的 TUI 输入框失焦后不会随随后的
  `ESC[I` 恢复，表现为 paste 进框但回车不提交。转场顺序改为按方向选择：
  打开浮层先挂 hidden 再移交 first responder，关闭浮层反之；ghostty focus
  改按逻辑键盘归属（hostKeyboardActive）派生，消除 FR 迁移竞态，全程零
  focus 事件。另新增 `PIER_TERMINAL_DEBUG_LOG=1|all` 环境变量开启
  TerminalDebugLog（input/lifecycle 等通道）用于输入链路诊断。
- **crush 等 TUI 输入框失焦时，切 tab / 增强输入发送被静默丢弃。** 新增
  ghostty patch `0104-cursor-visibility-probe`：`ghostty_surface_cursor_visible`
  只读探针暴露应用设置的 DECTCEM(?25) 光标模式位（现代 TUI 输入失焦即藏
  光标）。renderer 新增 `ensureTuiInputFocus` 恢复原语：探针三态
  （visible/hidden/unknown，unknown 禁止当作失焦）+ agent-catalog 白名单
  `inputFocusKey`（crush=Tab，已源码验证确定性）+ per-panel 互斥（防 toggle
  双击）+ waiting 态跳过；在 tab 激活、点终端内容、增强输入打开三个触发点
  自动恢复 TUI 输入聚焦，为后续多 agent 调度注入提供「输入可达性」基础。
- **增强输入提交门禁：TUI 无可输入的聚焦内容时拒绝提交，且阻断态前置为
  常驻 UI。** activity waiting（权限确认等 dialog 态，响应式）与
  cursor-visible 探针失焦（500ms 轮询，busy 态不探不注、unknown 不阻断、
  与白名单同口径只对声明 `inputFocusKey` 的 agent 启用、后台 tab 停轮询）
  都会使发送按钮禁用、回车不生效（含空草稿 Enter 透传同口径截住），并在
  发送按钮上方以受控 tooltip 常开展示精简原因（非 hover，复用
  @pier/ui/tooltip 能力）；探针恢复可见即自动解除。发送前再经
  `ensureTuiInputFocus` 最终确认（crush 失焦透传 Tab 恢复后送达）；确认
  失败且 UI 无法自解释时 toast 反馈并保留草稿，不再静默失败。发送链路
  防交错：renderer in-flight 守卫 + main 按 panel 串行发送队列，settle
  窗口内双击/键重复不会把两条消息揉成一团。
- **终端右键去掉「增强输入添加文件」。** 添加文件保留增强输入内回形针与
  ⌘⇧A；右键只留「切换增强输入」，避免入口重复。

### Changed

- **Pier Home → 项目装入语义钉死为发布副本。** 装入是复制进项目
  `.pier/skills/library` 再投影，不是指向本机库的实时链接；在技能库编辑后会
  更新已装入项目的副本。见 agent-assets 规格 §7.5。
- **项目设置 Skills/MCP IA 收敛为 v5。** 智能体全局 `~/` 默认只读（打开/
  Reveal，可选采纳到 Pier 库）；项目技能三来源用轻分组+badge；「始终包含」
  为 Pier 行锁定态而非第四来源；Pier 绑定文案为「从本项目移除」。见
  `docs/superpowers/specs/2026-07-23-agent-assets-home-and-instructions-design.md`
  §0 与原型 `pier-home-binding-proto-flows.canvas.tsx`。
- **增强输入升级为 Lexical 结构化编辑器（Phase A / B）。** 按需增强输入从
  `textarea` 换成 Lexical plain-text 编辑器：空草稿方向键/Tab/Enter 透传
  TUI、`[#n]` 合法/越界着色、Enter 发送由 Lexical 命令优先处理；大粘贴
  （≥10k）自动落盘为 `.txt` 附件；`@` 工作区文件/文件夹提及插入 chip，
  发送序列化为绝对路径。
- **增强输入后续方向确认。** 新增
  `docs/superpowers/specs/2026-07-22-rich-input-structured-composer-design.md`：
  Phase A/B 采用 Lexical 纯文本结构化编辑器、`@` 工作区提及、token 着色、
  空草稿键盘透传与大粘贴改附件；明确不做 WYSIWYG 与 Cursor 式扩展 `@` 上下文。
  附件规格中与编辑器 / `@` 冲突的非目标已交叉修订。
- **文档前门重整。** `README.md` 改为产品入口（功能 / 要求 / bootstrap /
  文档索引），冗长 CLI 细节迁至 `docs/cli.md`；新增 `docs/README.md`、
  `docs/development.md`、`SECURITY.md`，并扩充 `CONTRIBUTING.md`。发布 /
  插件文档补交叉链接；`AGENTS.md` 标明面向编码助手而非用户手册。

### Added

- **成本管理归宿主工作台。** 新增 core widget `core.cost-overview`（分类
  `analytics`，可搜索关键词包括 `cost` / `spending` / `tokens` / `成本` /
  `花费` / `令牌`），跨插件聚合 API 等价成本估算：4 KPI（今日 / 近 31 天 /
  tokens / 来源数）+ 堆叠 Bar chart（每源一层，走 `--chart-1..5` 语义色）
  + 未定价日数提示。三态齐全（loading / empty / error），响应式三档
  container query（<@14rem 只显今天；@22rem 3 列；@34rem 4 列），
  `refreshToken` 变化触发 `window.pier.usageData.refreshAll()`。
- **`window.pier.usageData` preload API** 暴露 `read` / `refreshAll` /
  `onChanged`，配套 renderer store `useUsageDataStore` + `initUsageDataBridge()`。
- **`UsageSourceRegistry`**（`src/main/services/usage-data/source-registry.ts`）
  + 插件 facade `context.usageData.registerSource({ id, rescan })`；
  `refreshAll` fan-out 到全部注册源，单源失败不短路其他源。
- **6 个 `core.cost.*` metrics** 注册到 workbench metric registry：
  `today` / `periodInstant` / `periodTokens` / `dailySeries` / `byModel` /
  `bySource`，供自定义卡片物料按指标组装。
- **定价目录扩展**：`src/main/services/usage-data/pricing-catalog.json` 抽出
  为独立 JSON，新增 Anthropic（Claude Haiku 4.5、Sonnet 4.5/4.6/4.7、Opus
  4.7、3.5 Sonnet/Haiku、3 Opus）、Google（Gemini 2.5 Pro/Flash/Flash-Lite、
  Gemini 3 Pro/Flash）、xAI（Grok 4、Grok Code）条目，支持精确 → 别名 →
  最长前缀通配三段匹配。文档见 `docs/model-pricing.md`。
- **`UsageAggregateSnapshot` 跨插件成本聚合契约**
  （`src/shared/contracts/usage-data.ts`）+ `aggregator.ts`。broadcast 通道
  `pier://usage-data:changed` 是 renderer 侧唯一数据源。
- `**ForegroundActivityAggregator**` (`src/main/services/foreground-activity/`)
统一 agent / task / shell / idle 四态活动模型，per-panel 单一 activity。
新广播通道 `pier://foreground-activity:changed`，新 preload API
`window.pier.foregroundActivity`，新 renderer store
`useForegroundActivityStore` + `<ForegroundActivityBridge />`。
- `**Project` 实体** (`src/shared/contracts/project.ts` + `src/main/state/project-store.ts`)
稳定 `id: uuid` + `rootPath` + `name` (派生自 package.json > deno.json >
Cargo.toml [package].name > basename)。`upsertProjectFromPath()` 提供
in-flight 去重防并发落两条记录。
- `**PanelContext.projectId` / `projectRootPath`** 附加可选字段，与老
`projectRoot` 并存渐进迁移。

### Changed

- **“指挥中心”统一更名为“工作台”。** 面板组件值、动作标识、国际化键、
  插件贡献点和运行时注册接口统一使用 `workbench` / `workbenchWidgets`；旧布局与
  已安装的 `apiVersion: 1` 官方插件只在读取边界做单向兼容。`pier.codex` 同步升级
  到 1.3.0。
- **`pier.codex` 插件版本 1.1.6 → 1.2.0。** Codex 只保留会话日志采集 + 账号
  管理；成本 UI / 定价 / 展示由宿主统一负责。历史布局中的 `pier.codex.cost`
  widget 会走宿主 unknown widget fallback（`workbench-merge.ts:101`），
  显示占位卡带移除按钮，用户可手工从物料库添加 `core.cost-overview`。
- **Path B agent hook 通路收敛为 emit 脚本 + JSONL 直写。**
  - emit 脚本升级为 `commandStart` / `commandFinished` / `agentEvent` 三 kind
  dispatch，`agentHookEventSchema` 变为 zod discriminated union。
  - 7 个 inline agent 插件 (amp / kilo / mimo-code / opencode / omp / pi /
  hermes) 从 HTTP `fetch(/agent-event)` 切换到本地 `appendFile` (JS/TS) 或
  `open(log, "a")` (Python)。
  - `pierHookCommand` 输出首位固定 `"agentEvent"` 位置参数。

### Removed

- `**pier.codex.cost` widget 三件套**（`cost-widget.tsx` / `cost-card.tsx` /
  `cost-usage-visualization.tsx`）+ `usage.refreshCost` RPC +
  `CodexCostUsageSnapshot` 类型 + `CodexAccountsSnapshot.costUsage` 字段 +
  `setCostUsage` 服务方法 + 15+ `pier.codex.accounts.settings.cost*` /
  `pier.codex.widget.cost*` / `pier.codex.widget.noCost*` i18n key。
  成本相关的 renderer refresh 分支（`refreshCost` / `costRefreshing`）从
  `use-accounts-refresh.ts` 移除。
- `**agent-hook-server`** (HTTP loopback) 与相关 test 文件删除。
- 环境变量 `PIER_AGENT_HOOK_PORT` / `PIER_AGENT_HOOK_TOKEN` 从 PTY hookEnv
中删除。`hookEnv()` 变同步（不再等 loopback server 启动）。
- `LEGACY_HOOK_MARK` 常量删除；`isPierHookCommand` 只识别新 marker
`PIER_AGENT_HOOKS_DIR`。

### Fixed

- **Codex 账号与配额物料完整展示。** 配额窗口改为按 `limitId` 排序的单一 CSS
  Grid；`auto-fit` / `minmax` 按内容宽度自动单列或多列，窄卡不再丢模型配额，
  宽卡左右排布，多余高度不再拉伸指标行。
- **Codex 账号切换菜单恢复可用布局。** 无其他账号时不再显示切换入口；多账号
  菜单只列出可切换目标，并以可用视口约束 16rem 最小宽度。切换期间按钮只显示
  单一 loading 指示，不再叠加切换图标。
- **成本物料 Tooltip 不再被卡片裁切。** 图表 hover 明细通过共享
  `ChartTooltipPortalContent` 渲染到卡片滚动层之外，按视口自动翻转并约束位置；
  浮层保持 `pointer-events: none`，不干扰图表 hover 命中。

- `**ForegroundActivityAggregator.acquireHookAgentEntry**` 迟到的
`Stop` / `ToolComplete` / `SubagentStop` / `error` 事件不再销毁已有 task /
shell activity（仅 `SESSION_CREATING_EVENTS` 才允许覆盖为 agent kind）。
- `**agentLaunched**` 覆盖已有 hook agent activity 时清 `hookTtlTimer`，防止
30min 后回落 ready 的旧 callback 触发。
- **Task tab 退出状态谎报**——任务结束后 tab 永久回落 "Running" 谎报运行中。
五处根因一并修复：
  - `taskFinished` 终态常驻：移除 5s linger 清理，task activity 保留最终
  status 直到 panelClosed / rerun / 新命令接管（tab 退出 chrome 的唯一
  live 来源，消失即回退 mount 时的陈旧 "Running" 基线）。
  - 新增 `ptyExited(panelId)`（native process-close 改走此入口）：pty 进程
  退出 ≠ 面板关闭——task 面板保留终态 activity，只清 hook 证据；其余面板
  等同 `panelClosed`。
  - `taskLaunched` 门面把内部 windowId（如 `"main"`）换算成 electron
  BrowserWindow.id 字符串——否则广播路由 `Number("main")=NaN`，task
  activity 永远到不了 renderer。
  - 新共享单源 `taskTabStateForActivityStatus`：renderer 活动 overlay 与
  main 持久化 `taskExitTabPatch` 输出同一份完整 tab state
  （指示器+label+色 token），修 label 停留 "Running" 的半更新。
  - `bin/pier-cli-parser.js` `run.list`/`run.spawn` 的 `projectRoot` 字段
  改回 schema 现名 `projectRootPath`（#53 迁移遗漏，CLI `tasks list/run`
  与 terminal-task-status e2e 因此全断）。
- **Task 面板 reload/restart 混淆**——renderer reload（main 进程未死）被当作
app restart 处理：running task 面板渲染静态 "Cancelled" 结果卡，活 pty 沦为
不可见僵尸（reconcile 按 layout 上报而保留）, 完成后 tab 又与卡片矛盾。
重设计为「活性单源 + 磁盘不说谎」：
  - 新契约字段 `TerminalPanelSessionSnapshot.taskLive`：main 以
  foreground-activity 的 task slot（终态常驻, 与面板同寿命）担保该 task
  面板寿命仍在本进程内；`read-session` 注入。
  - renderer 结果卡只给真死面板（`task && !taskLive`）；live 面板照常渲染
  终端 → `create` → swift 对已存在 panelId 纯 reattach（PTY/scrollback
  零销毁, 与 C 方案对齐）。`restoredTaskTabPatch` 推断层删除。
  - `resolveCreateTerminalLaunch` 增 `taskLive` 直通分支：reattach 时 task
  元数据原样保留, 不再把 running 强转 cancelled 落盘（否则真实退出时
  `patchTaskStatus` 的 running 守卫失败, 终态永久丢失）。
  - 新增启动孤儿清算 `reconcileOrphanedRunningTasks()`（`app.whenReady` 内
  先于窗口恢复）：上进程遗留的 running 一律 cancelled（exitReason/Source
  `"restore"`, 该枚举首个消费者）+ Cancelled tab chrome 落盘。
  - e2e 实证：reload 重挂（终端非卡片, 存活 pty 退出后 tab 仍正确翻
  succeeded）+ restart 清算（Cancelled 卡 + Cancelled tab）双场景 ×2 稳定。
- **上游漏更新的死测试修复**（均在 clean main 上失败）：
  - `workspace-host.test.tsx` 9 例：#53 preload API 改 `pier.window.getContext`
  命名空间后 mock 仍是平铺 `getWindowContext`。
  - `terminal-panel-lifecycle.test.tsx` 3 例：#56 状态栏恒挂载（自锁修复）与
  #57 删除运行时 tab-patch 通路后, 测试仍钉旧契约/不可能值
  （"old runtime tab" 等无 emitter 的死期望）。
- **Layout 保存 500ms debounce 空窗**——面板创建后 <500ms 内 reload 会恢复
旧 layout：新面板从 UI 消失, 其活 pty 被 reconcile 判孤儿回收。
`workspace-host` 增 `beforeunload` flush：有未落盘变更时立即补发
`saveLayout`（invoke 消息投递即达 main, renderer teardown 不影响写盘）。
- **e2e 无人值守可靠性**：
  - `command-palette.spec.ts` 用显式条件等待（`[cmdk-input]` 可见等）替代
  固定 `waitForTimeout` 睡眠——冷启动慢机上点击不再竞速 UI。
  - `native-terminal-focus.spec.ts` 五个 osascript System Events keystroke
  测试增加投递能力探测（首个门控测试内 6s 试写 marker, 模块级缓存判定）：
  无人值守/缺 Accessibility 权限时显式 SKIP 而非 3×retry 失败。
- `**pnpm check` 纳入 unit + component 测试套件**——此前门禁不含任何测试,
是 12 个死测试烂在 main 的直接原因（AGENTS.md 同步更新）。
- `**buildBroadcast`** 浅拷贝 `activity` 引用，防同进程 listener 意外
mutate 污染 aggregator 内部状态。
- `**Cargo.toml` name 派生** 用 `[package]` 段锚定正则，修复
`[[bin]] name` 排在 `[package] name` 之前时项目名错取的 bug。
- `**upsertProjectFromPath` 并发**——`Map<rootPath, Promise<Project>>` 去重
in-flight 请求 + `mutate` 回调内二次 find 兜底，防止同 rootPath 落两条
不同 UUID 的记录。
- `**resolvePanelContextForPath` 静默 catch**——加一次性 warn 让磁盘故障
等失败可见。
- **emit `commandStart` sed 转义链**——前置 `head -c 4096` 后置
`tr -d '\000-\037\177'` 剥控制字符再 sed 转义 `\` 与 `"`，防命令行含
换行/tab/NUL 破坏 JSONL 行结构。
- `**JsonlObserver.processLine` disposed 守卫**——dispose 后剩余行不派发。
- `**omp/pi` 生成插件** 从 `require("node:fs/promises")` 改为
`await import("node:fs/promises")`，兼容 ESM-only Node 20+ 宿主
（原 `require` 在 ESM 环境会 `ReferenceError` 被 catch 静默吞掉，事件全丢）。
- `**hermes` Python except** 收紧到 `except OSError`，不再宽泛 catch
`Exception` 掩盖内部 bug。

### Upgrade notes

⚠️ **HTTP → JSONL cutover 一次性代价（受影响：从 <此版本前的 pier 版本> 升级）**

老版本 pier 装到用户 `~/.claude/settings.json` / `~/.factory/settings.json` /
其他 hooks.json 里的 curl 条目（含 `PIER_AGENT_HOOK_PORT` 引用），在新版本
中**不再被 `isPierHookCommand` 识别为 pier-managed**，因此：

- 新 pier 的 `uninstallAllAgentHooks` 不会自动清理这些老条目。
- 老条目在新 pier 运行时 curl 会因 `PIER_AGENT_HOOK_PORT` 未设导致 EADDRNOTAVAIL
静默失败，agent 每次 hook trigger 浪费一次子进程（无功能影响，用户无感）。

**用户手动清理路径**（可选）：搜索 hooks.json 里包含
`PIER_AGENT_HOOK_PORT` 的行，手动删除。或者在关闭 pier 的
`agentStatusHooks` 偏好后再打开一次（新 pier 会走 install 幂等路径，不动
老条目，但用户可以在关闭态下手工清）。

### Removed (contract cutover)

以下老 API 已彻底删除，contract 单源：

- `AGENT_SESSIONS_CHANGED` 广播通道（→ `FOREGROUND_ACTIVITY_CHANGED`）
- `agentSessionsApi` preload API / `pier.agentSessions.*` renderer 入口（→ `pier.foregroundActivity.*`）
- `useAgentSessionStore` + `agentSessionCounts` (→ `useForegroundActivityStore` + `activityCounts`)
- `AgentSessionsBridge` component (→ `ForegroundActivityBridge`)
- `AgentSessionSnapshot` / `AgentSessionsBroadcast` / `agentSessionSourceSchema` / `agentRuntimeStatusSchema` / `runtimeStatusForHookEvent` / `tabStatusForAgentStatus` shared contract 全部删除（→ 新 `foreground-activity.ts` 契约）
- `createAgentSessionAggregator` + `agent-session-entry` + `agent-session-timers` main-side 模块（→ `foreground-activity/{aggregator,entry,types}.ts`）
- `agent-session-aggregator.test.ts` / `agent-session-store.test.ts` / `agent-tab-overlay.test.ts` 测试（→ `foreground-activity-aggregator.test.ts` 29 case）

`agentTabIconId` / `agentKindFromTabIconId` 保留在 `agent-session.ts` 契约（agent 图标命名工具，非 aggregator state）。

### Final migration (all done)

`Project` + task 层最后一里 6 项迁移全部完成，双源架构收? complete：

- ✅ task/run 契约 `projectRoot: string` 迁到 `projectId: uuid + projectRootPath: string`（TaskListResult / TaskLaunchPlan / TaskPanelMetadata / TaskRunSnapshot + PierCommand run.list/run.spawn + PierTasksAPI + PanelContext + 60+ callsite）
- ✅ Task 生命周期 wire：`task-service.startRun` / `completePanel` / `cancelRun` 走 `onTaskActivity` 回调转发 `foregroundActivityService.taskLaunched` / `taskFinished` → `ForegroundActivityAggregator`
- ✅ Project registry renderer 面：`pier://project:list` / `pier://project:changed` IPC + `PierProjectAPI` preload + `useProjectStore` + `ProjectBridge`（`pier://project:get` 早期实现，后续 hygiene sweep 因 0 caller 删除，见下）
- ✅ `panel-context-state.ts:keyForContext` 清 legacy `projectRoot` fallback 一层
- ✅ `PanelContext.projectRoot` 删（→ `projectId + projectRootPath`）
- ✅ `panel-context-resolver` 输出改产 `projectRootPath`；`upsertProjectFromPath` 兜底 catch 保留（Electron `app.getPath` 不可用时 project 保持 null，`projectRootPath` 从 gitRoot/cwd 派生）

### Cleanup (double-write collapse)

双写与 pragmatic 收敛清理，达 GREEN 终态：

- ✅ **删 `TERMINAL_TAB_CHROME_PATCHED` 广播**：main→renderer task exit chrome 通路统一走 `FOREGROUND_ACTIVITY_CHANGED` + `activityTabChromeOverlay`。删 `TerminalTabChromePatchEvent` contract、`onTabChromePatch` preload、`forwardTabPatch` wiring 依赖、renderer `mergeTabChrome` 4 层缩到 3 层（base → restore-patch → activity）。
- ✅ **删 `foreground-activity` aggregator 中孤儿 `ignoredNativeUserClosePanels` Set + `ignoreNextNativeUserClose` / `consumeIgnoreNativeUserClose` API**：该状态实际由 `terminal-task-lifecycle` 维护并消费（`terminal.ts` 唯一 caller）；aggregator 侧的副本 0 caller，双源同义 collapse 到单源。
- ✅ `**src/main/ipc/agent-session.ts` 改名 `foreground-activity.ts`**；`agentSessionService` → `foregroundActivityService`，`registerAgentSessionIpc` → `registerForegroundActivityIpc`，`closeAgentSessionResources` → `closeForegroundActivityResources`。5 处 callsite 全更名。共享契约 `src/shared/contracts/agent-session.ts` 保留（仍承担 `agentHookEventSchema` + `agentTabIconId` icon 工具函数）。
- ✅ `**terminal-task-lifecycle.ts` 职责 JSDoc 清晰化**：native shell 回调协调器（exit hint 排序 / dedupe / ignore-close / 持久化 patchTab+patchTaskStatus）。broadcast 责任明确外包给 `foregroundActivityService.taskFinished` → aggregator 单源。
- ✅ **删陈旧 sync 维护提醒**：`foreground-activity.ts:111-113` 老 `runtimeStatusForHookEvent` 与 `agent-session.ts` 同步注释（引用的函数已删）。`pi.ts:16` / `shared.ts:118` 相同注释同步更新为当前 `activityStatusForHookEvent`。

### Fixed

- `**task-service.cancelRun` 覆盖已 success activity → cancelled 的回归 bug**：
`taskRuns.cancel` 只把 pending/running 节点改状态，但 task-service 遍历 fire
`onTaskActivity.onFinished({ status: "cancelled" })` 时不看 `node.status`。
多 task DAG 部分完成后 restart 会让已 succeeded 的 tab 在 5s linger 内闪回
cancelled。修：filter 只对 `node.status === "cancelled"` 才 fire。
- **App quit 500ms debounce 窗口内 mutate 丢失**：`flushProjectStore` +
`flushPanelContextState` 从未在 `before-quit` 调用。加入
`window-service.flushOpenWindows` / `flushWindowBeforeClose` batch，与已有
flush 队列同步落盘。
- `**upsertProjectFromPath` 失败日志 flood**：`upsertWarned` 一次性 flag 换成
30s throttle 窗口，磁盘故障时不再首次 warn 后完全静默。

### Removed

- `PIER_BROADCAST.TERMINAL_TAB_CHROME_PATCHED` channel。
- `TerminalAPI.onTabChromePatch` preload API。
- `TerminalTabChromePatchEvent` contract type。
- `ForegroundActivityAggregator.ignoreNextNativeUserClose` / `consumeIgnoreNativeUserClose` API + 内部 `ignoredNativeUserClosePanels` Set（迁移到 `terminal-task-lifecycle` 单源）。

### Hygiene (best-practice terminal state)

达"最佳实践终态"的最后一波：

- **删死码**：
  - `ForegroundActivityAggregator.resetPanel` 全仓 0 caller 3 行删。
  - `pier://project:get` IPC + `pier.project.get` preload API + `useProjectById` renderer hook — 全套 forward-compat 0-caller trio 删。
  - `tests/component/terminal-panel-lifecycle.test.tsx` 里针对已删 `TERMINAL_TAB_CHROME_PATCHED` 广播的 stale mock + 相关未用 fixture 删。
- **回归测试**（覆盖 e40d01d8 的 3 项 bug fix）：
  - `task-service-activity.test.ts` — `cancelRun` fire onFinished 只对 `node.status === "cancelled"` 生效，守卫已成功任务的 activity 不被闪回 cancelled。
  - `window-service.test.ts` — flushOpenWindows / flushWindowBeforeClose 断言 `flushProjectStore` + `flushPanelContextState` 也在 flush 队列里。
  - `panel-context-resolver-upsert-warn.test.ts` — `upsertProjectFromPath` 失败的 30s 时间窗口 throttle（配合新导出的 `_resetUpsertWarnForTests` 测试重置）。
- **一致性打磨**：
  - `CollectTaskCandidatesOptions.projectRoot` / `ComposerSourceOptions` / `DenoSourceOptions` / `VscodeSourceOptions` 等所有内部 fs-path 字段全部改名 `projectRootPath`，与契约层 `TaskListResult.projectRootPath` / `TaskLaunchPlan.projectRootPath` 命名对齐；sources.ts 内部 destructure 与 utils.packageManagerFor 参数同步改名。
  - `window-service` flushOpenWindows / flushWindowBeforeClose 从 `Promise.all` 换成 `Promise.allSettled`，抽出 `flushAllStoresSettled` 单点，每一路失败独立 log 不再吞其他成功。
  - 抽 `recent-launcher.ts`（99 行）承接 recent-tasks 记忆 + 排序，`service.ts` 从 491 行降到 425 行（距硬帽 500 有 75 行缓冲，下一次 task lifecycle 变更空间充足）。
- **JSDoc + 陈旧注释**：`foreground-activity.ts` 门面 JSDoc 更新为"前台活动服务门面"（旧文本"agent-session facade 历史命名保留"删）。
