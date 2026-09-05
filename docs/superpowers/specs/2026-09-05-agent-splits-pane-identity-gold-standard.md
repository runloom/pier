# 智能体分屏 pane 身份金标准

日期：2026-09-05

状态：修订设计稿（未实现；完成本文验收后方可冻结）

范围：`pier.agent-splits` 桥接面板的创建身份、命令分类、稳定实例编号、创建来源、并发映射、respawn、恢复与跨窗呈现。

不包含：协作会话列表的父子聚合视图、屏幕内容识别、prompt 派生标题、各智能体原生 hook 扩展、新的智能体执行 API。tmux 命令、参数和成功输出格式保持原有适配语义。

## 1. 目标与现有约束

用户应能区分同一项目里的多个同类智能体，记住刚才查看的是哪一个分屏，并找到它的创建来源。身份信息不能挡住进程提供的标题，也不能把“准备启动”呈现成“已经就绪”。

遵守以下现有真源：

- 标题优先级与用户钉名：[AGENTS.md「终端 tab 标题与 Agent 身份」](../../../AGENTS.md)。catalog 名称不写入终端标题。
- tab 几何：[工作台面板 Tab 铬金标准](./2026-08-29-panel-tab-chrome-gold-standard.md)。该文管外观，不是标题身份规则的来源。
- 窗口名：[窗口系统标题金标准](./2026-09-04-window-os-title-gold-standard.md)。新增编号、创建来源和启动先验都不进入 `menuLabel` 或 `NSWindow.title`。
- 命令身份：[agent-command-detection.ts](../../../src/shared/agent-command-detection.ts) 的 `matchAgentCommand`；原生父子会话身份：[agent-session-actor.ts](../../../src/shared/agent-session-actor.ts)。
- 共同体验：[PRODUCT.md](../../../PRODUCT.md)。已有桌面与移动会话表面消费相同事实，交互按平台适配。

**终态：主标题保持用户钉名 / OSC / cwd 规则；每个桥接分屏另有稳定编号，已确认的启动种类显示图标，状态只消费前台活动，创建来源可查看和定位。**

编号只回答“哪一个分屏”。没有原生标题时，不承诺从命令、prompt 或编号推知具体任务，也不要求用户先逐个改名才能区分实例。

## 2. 已核实的实现事实

2026-09-05 对当前代码的定向验证发现：

| 现状 | 对设计的约束 |
|---|---|
| `paneLaunchFields` 经 `shellInvokedCommand` 生成 `/bin/sh -c '…'` | `launch.command` 不是未经包装的 `ctx.rest`；分类必须覆盖真实上传值 |
| `matchAgentCommand("claude")` 命中，包装后的同命令返回 `null` | 只增加 main 调用点不能完成识别 |
| `launch.agentId` 会触发 `agentLaunched`，消抖后产生 `source: "launch"` 的活动，无需 hook | 不得以“出现 agent 活动”代表“首次 hook”或“标题已准备好” |
| 活体路径会剥掉非用户 chrome title | 不能用裸 `tab.title = catalog.label` 保存冷启动身份 |
| 两次并发 shim 调用可都返回 `%1`，实际创建两个面板而 map 只保留一个 | 原子 rename 只能防半文件，不能防读改写覆盖 |
| `ONE_SHOT_RE` 位于 launch wrapper，仅返回空装饰结果 | 它既不拦截 shim 的 `terminal.open`，也不决定是否可建立交互式启动先验 |
| 结构化 `tab.tooltip.lines` 非空时，现有 tooltip 不再自动加入标题 / 路径 fallback | 来源信息必须追加到完整 tooltip，不能覆盖原有内容 |

现有测试通过只证明现状基线；本文的实现与可用性验收尚未完成。

## 3. 身份分层与单一真源

| 对象 | 真源与寿命 | 不承担的语义 |
|---|---|---|
| 面板实例 | 宿主 `panelId`；移动、重载、原地 respawn 保持，复制 / 新建产生新值 | 不是智能体原生会话号 |
| 可见编号 | 宿主为桥接面板分配的 `paneNumber`；与面板同寿命 | 不是列表位置，不是 tmux 的 `%N` |
| 创建来源 | 创建时发起终端的宿主引用；同一面板内不可被 respawn 改写 | 不是布局锚点，不是 provider 父会话证明 |
| 运行身份 | 当前 `launchId`，创建成功后关联既有 `spawnGeneration`；复用宿主生命周期 | 不能沿用上一轮命令的分类 |
| 智能体种类 | 显式 launcher `agentId` 或宿主分类得到的启动先验；hook 事实按现有规则接管 | 种类不区分实例，也不证明 ready / working |
| 原生会话关系 | provider 上报的 session / actor / parentSession 字段，走既有判据 | 不能从分屏布局或创建来源合成 |

宿主终端 session JSON 是面板身份的持久化真源。renderer params、descriptor、命令返回值和插件 session map 都是投影或缓存。不得新增状态服务、任务台账或插件自己的 agent catalog。

### 3.1 稳定编号

- 在同一 userData 内为桥接面板分配单调递增的正整数，显示为 `#17`。各窗口共享分配域，关闭面板不重排、不回收号码；允许失败创建留下空号。
- 分配由 main 完成。使用宿主状态目录内一个序列文件 `terminal-pane-sequence.json` 保存高水位；串行完成高水位写入后才下发号码。持久化的面板 identity 保存已分配号码。
- 启动期先核对序列与所有已保存面板中的最大号码，再允许分配；序列缺失或损坏时，从可恢复记录中的最大值重建，保证不与这些面板撞号。序列健康时不回收号码；无法恢复的已删除历史不承担永久号码唯一性承诺。此模块只管理一个数值，不另建面板注册表。
- `#17` 在用户改名、OSC 更新、状态变化、相邻面板关闭、拖动、跨窗移动与原地 respawn 时保持；复制面板分配新号码，复制不沿用原创建来源。
- 桥接出的裸 shell 与未知命令同样有号码，但没有虚构的智能体图标或“未知智能体”标签。普通非桥接终端不因此新增编号 UI。
- 不使用按当前同名集合重新排序的序号。现有 `disambiguateAgentSessionTitles` 会在关闭面板后前移序号，不适合充当此处的持久身份。

### 3.2 创建来源

`referencePanelId` 继续只负责布局。新增来源请求使用 `paneOrigin.originPanelId`；shim 从发起进程的 `PIER_PANEL_ID` 取值，缺席时才从调用方 `TMUX_PANE` 的已绑定记录取值。**不得读取 `-t` 作为创建来源。**

例如 A 执行 `split-window -t B` 创建 C：C 的布局锚点是 B，创建来源是 A。原地 respawn 只替换 C 的运行，既不写 C→C，也不把操作者变成新的创建来源。

main 验证来源唯一对应当前存在的终端，并保存其窗口 record id、panel id、可用的运行代次及当前可读名称快照。不存在、多处匹配、自引用或证据矛盾时舍弃该来源引用，保留“来源未确认”，不猜另一面板。窗口 record id 是创建时位置记录；跨窗后的定位须查询该 panel 的当前位置。布局锚点失效仍按既有创建错误处理。

来源元数据只用于解释“此分屏由哪里创建”。即使存在，也不得据此写入 `actorHint`、`parentSessionId`、子会话计数或通知归属。

## 4. 命令分类与启动先验

### 4.1 分类位置

在 `src/main/app-core/commands/panel.ts` 的 `executeTerminalOpenCommand` 中，解析 profile 与有效 command 后、`wrapAndRegisterLaunch` 和 renderer 下发之前分类。结果保留在同一 launch registry 记录中；后续 create handler 只消费该结果，不第二次猜测。

显式 launcher `launch.agentId` 保留现有契约。缺省时，只有同时满足以下条件才填入自动 `launch.agentId`：

1. `matchAgentCommand` 确认实际可执行体属于已知智能体。
2. 共享启动模式规则确认该形态是交互式运行。

命令仍按原样执行；未知分类、非交互模式或不支持的 shell 表达式都不阻止打开普通终端。

### 4.2 Shell 包装

扩展共享解析器，使 `commandExecutableText` 与 `matchAgentCommand` 复用同一剥壳逻辑：

- 支持字面量 `sh/bash/zsh -c`、`-lc`、`-lic` 及绝对路径写法；递归解析其单个 command string。限制最多 10 层，越界返回未知。
- 保留现有 env、赋值、exec、sudo、包运行器等前缀规则。shim 不剥壳、不导入 catalog、不增加可执行体词表。
- 内层若含不能静态确定的可执行体、命令替换、管道、后台运行、控制流或多条命令，返回未知。v1 不承诺识别 `cd /repo && claude`；该面板仍有稳定编号，后续 hook 可提供事实。
- 引号和转义必须按词元处理，不执行 shell，不用“全字符串包含 claude / codex”识别。提示词里的工具名称与参数名不能成为分类证据。
- 原命令只保留一份，剥壳结果只用于判断；不能把解析结果重组后替换实际执行命令。

### 4.3 交互式与一次性运行

身份匹配与启动模式判定是两个问题。`matchAgentCommand` 的既有返回契约不变，不通过让其对所有 one-shot 返回空来修改其它调用方语义。

启动模式判定放在同一个共享模块，复用解析后的 argv 和 catalog 的声明式模式数据；结果为 `interactive` / `one-shot` / `unknown`。catalog 未声明、参数结构无法确认的形态返回 `unknown`。不得从 `oneShotArgs` 生成函数反推出完整 CLI 语法，也不得在 shim 复制 flag 正则。

首批自动先验覆盖至少 Claude、Codex 与 OpenCode 的普通交互式启动；对应已知非交互入口必须有用例，包括 Claude 的 `-p` / `--print`、Codex 的 `exec`、OpenCode 的 `run`。新增模式需对齐其原生 CLI，并测试 flag 值和 prompt 中出现相同词元时不误判。

对于自动分类的 one-shot / unknown：不建立交互式启动先验、不显示虚构的活动状态，不另造 Pier 执行封装。native 退出与真实 hook 仍按既有规则处理。`ONE_SHOT_RE` 是否给启动增加 tmux 装饰不承担本节职责。

## 5. 标题、图标、编号与来源交互

### 5.1 标题与图标独立

终端主标题的既有规则保持：

`显式 chrome（含用户钉名、任务、结果）→ OSC（路径型按现有规则收短）→ cwd 叶子名 → Terminal`

活体智能体继续执行既有非用户 chrome 让位纪律。本方案不写 catalog title、不增加 titleSource、不新增等待 hook 才换标题的状态机。

- OSC 到达即按现有规则显示，不等待 hook。hook 先到但没有 OSC 时，主标题仍为 cwd；实例由编号区分。
- 当前启动的种类图标在首个可见面板帧即可显示。renderer 的 `launchAgentId` 只是当前 `launchId` 的只读投影，不写进持久 `params.tab.icon` 充当永不失效的 fallback。
- 成功创建后由当前代次的 session / FA 接管图标；`source: "launch"` 没有 status，不能画等待点、运行点或声称就绪。hook 不上报时，仅保留有效启动种类的图标。
- 新 launch 开始立即失效旧启动投影；退出进入既有结果查看态，返回 shell 后清除旧运行种类。旧代次的 OSC、hook、异步写入不能改新运行的标题、图标或状态。
- 用户钉名始终保留，包括无 hook、respawn 与恢复；来源和编号不写入用户标题。

### 5.2 可见编号与同一呈现来源

编号显示在主标题之后、关闭按钮之前的独立文本槽，不拼入 `display.short`、`display.long` 或 `tab.title`。所有桥接面板从首次显示起持续展示编号，避免重复消失后重新编号或出现 / 隐藏造成跳动。

沿用现有 tab 高度、字号、颜色 token 和 focus ring。编号用等宽数字、不可压缩槽位，主标题承担省略；不增加彩色 pill、状态色、按钮或额外 Tab 停靠点。窄到无法保留编号与既有操作区时按现有 tab 条规则滚动，不把身份截成相同残片。

`PanelDescriptor` 增加只读 `paneIdentity` 投影。本窗 tab、已有会话列表 / quickpick、跨窗与移动端现有会话条目共同消费这份身份数据；主标题仍走 `resolveAgentListTitle`，不能为列表另算名称。列表中的编号独立显示在元信息区。

| 时刻 | 主标题示例 | 独立编号 | 图标 / 状态 |
|---|---|---|---|
| 同项目四个 Claude 创建 | 四个 `pier` | `#17`、`#18`、`#19`、`#20` | 已确认启动种类的图标；无状态点 |
| `#18` 先收到 OSC | `审查变更` | 仍为 `#18` | 不等待 hook |
| `#18` 收到工作中 hook | `审查变更` | 仍为 `#18` | 只更新真实活动状态 |
| 用户将 `#18` 改名 | `检查提交` | 仍为 `#18` | 后续 OSC 不覆盖钉名 |
| `#17` 关闭 | 其余标题不变 | 保留 `#18`、`#19`、`#20` | 不前移编号 |
| `#18` 改跑普通 shell | 沿用钉名；无钉名则按新 shell 标题 | 仍为 `#18` | 不保留旧 Claude 活动身份 |

### 5.3 详情与键盘

- Tooltip 顺序：当前完整名称、绝对 cwd、已有状态 / 任务详情、分屏编号、创建来源。合并后去重；添加来源行不能挤掉标题和路径。
- 不把来源当前标题预先拼成静态 `tab.tooltip` 并永久保存。持久化引用和创建时名称快照，展示时优先解析仍然对应的来源，已关闭则标为历史来源；源面板运行代次不同须明确“来源分屏已开始新的会话”。
- 来源不明时显示“创建来源未确认”，不得用分屏锚点或同目录面板代替。
- 现有 aria-label 合并完整详情，包括种类、编号、真实状态和来源；编号文本不单独进入 Tab 序。
- 提供终端上下文菜单及命令面板动作“查看分屏信息”，只读详情走 `showAppAlert`，保持现有单按钮、固定 sm 规范。hover 不是唯一的可见详情入口。
- 提供“转到来源分屏”，调用既有 `panel.focus`，支持跨窗。仅当来源仍可定位时可执行；点击时再次核对位置，失败有用户可读反馈。来源换过运行仍可定位该分屏，但不宣称新运行就是原父会话。
- 这些动作位于既有查看 / 定位分组，不能抢占复制粘贴的右键首项，不新增默认全局快捷键。移动端使用现有会话详情 / 更多动作，禁止依赖 hover 或另造会话管理页。
- 查看或聚焦已有强 UI 反馈，不追加成功 toast；含技术详情的失败走宿主 alert。

## 6. 契约与数据流

下列均为待实施契约，现有 main / preload / renderer 进程边界不变：

| 位置 | 变更与所有权 |
|---|---|
| `terminal.open` 输入 | 新增 `paneOrigin?: { creationId: string; originPanelId?: string }`；表示派生面板创建请求。creationId 是本次创建关联键，重试保持；没有来源仍可请求稳定身份。沿用 referencePanelId 的纯布局语义 |
| main terminal session | 新增 `paneIdentity?: { creationId: string; paneNumber: number; origin?: { panelId: string; windowRecordId: string; spawnGeneration?: number; titleAtCreation: string } }`；严格校验正整数和非空字符串 |
| main session 的最近启动回执 | 新增 `launchReceipt?: { requestId: string; launchId: string; phase: "creating" / "created" / "failed" }`，只保留本面板最近一次启动请求；创建副作用前记 creating，确定结果后更新。经 terminal.get 投影，不另存操作历史 |
| renderer `terminal.open` | 新增只读 `paneIdentity?` 与 `launchAgentId?`；后者绑定已有 launchId，不能缓存为永久 tab chrome |
| create / relaunch / session snapshot / transfer | 透传 paneIdentity，首帧可用；运行信息复用既有 launchId、spawnGeneration 与 agent metadata |
| `PanelDescriptor` / panel snapshot | 投影 paneIdentity，供 tab、已有列表、移动与跨窗查询复用；不改变 short / long |
| `terminal.open` 成功结果 | 明确返回 `{ panelId, windowId, paneIdentity?, launchAgentId?, launchReceipt }`，保留已有 context；分类缺席就不返回 launchAgentId，不返回冗余 catalog label |
| plugin session map | 保存 paneId→panel/window 映射、创建关联键、原命令和宿主回填 identity 缓存；运行分类由宿主决定，不以缓存 agentId 作为重开先验 |

新建与原地重开必须区分：无 `panelId` 时，creationId 去重的是创建动作；有 `panelId` 时执行本次新 launch，沿用已有 paneIdentity，不能因旧 creationId 命中而跳过 respawn。已有 identity 的重开不发送 paneOrigin；旧桥接面板尚无 identity 时，可在明确的重开请求中只发送新的 creationId，main 为其登记一次号码，来源保持未知。复用面板请求不接受 originPanelId，也不允许替换已存在的 creationId / 号码 / 来源。

respawn token 使用已有 local-control envelope 的 requestId。control-client 接受调用方指定这一次 requestId，并在通信重试时保持；新的一次用户重开产生新 requestId。main 将 requestId 与 launchId 关联，重复请求返回同次回执，不再次终止 / 启动进程。旧请求只有在请求关联和既有运行代次都匹配时才能提交回执。

创建时序：

1. shim 在会话锁内预留 `%N` 与 creationId，记录原命令，释放锁。
2. shim 原样上送 launch，并分别传布局 reference 与调用方来源。不得向 terminal.open 发送伪造的“新 panelId”；其 panelId 字段仍只表示复用已有面板。
3. main 解析有效 launch、分类、核验来源、持久化分配号码，登记 launchId；同一 creationId 并发请求合并，已成功的重试返回原面板，不重复创建。
4. main 下发 renderer 命令；renderer 创建面板并带首帧 identity，再经现有 create IPC 创建终端。identity 写入宿主 session 后才报告创建成功。
5. renderer 回传 panelId 与现有结果；main 从本次已确认的宿主状态补齐 paneIdentity / launchAgentId，并验证与 launchId 关联，不信任 renderer 重算分类。
6. shim 在会话锁内重读最新 map，完成自己 reservation 的绑定，保持 tmux `-P / -F` 输出格式。

只保存一种类型的号码真源和一种运行分类。catalog label 在显示时由 agentId 查询；不得分别落在 main、renderer、plugin 三处后再设计同步协议。

## 7. 并发与失败恢复

### 7.1 Session map 的读改写

插件为每个 session 文件使用跨进程文件锁，采用 [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile#design) 并在插件中显式声明依赖；不能依赖宿主的传递依赖，也不能自行删锁绕过库的续期 / 失效规则。所有写入者使用同一规范化锁路径及相同 stale / update 常量，锁损坏或丢失即停止本次写入。原子临时文件 + rename 继续用于提交完整文件；reservation 的 creationId 比对另外负责防止迟到写回，并不由文件锁替代。

map 升级为 version 2，pane entry 区分：

- `reserved`：paneId、creationId、预留时间、原命令、来源请求；**没有**假 panelId / windowId。
- `bound`：上述身份关联与真实 panelId / windowId、splitAxis、宿主 paneIdentity 缓存。

bound entry 可带一个在途 respawn token：在锁内认领、锁外调用宿主、在锁内按 token 提交 / 释放；其它 respawn 读取到该 token 就返回忙。超时保留 token，经 terminal.get 核对 launchReceipt.requestId 与 phase；不匹配或仍在 creating 时不能冒充成功，也不能按固定时间直接释放后再启动一轮。token 仅标识一次 pane 操作，不替代宿主 spawnGeneration，也不进入产品 UI。

约束：

1. 分配、绑定、respawn 更新、删除、失败清理、会话重建都必须经同一锁与“重读→修改→落盘”入口。禁止拿调用开始时的 ctx.map 整段覆盖磁盘。
2. 预留时递增 nextIndex，号码不回退、不复用。绑定时以 creationId 比对预留所有权，只合并自己的 entry；其它 pane 的新增、删除和身份不得被覆盖。
3. **锁不跨 IPC / 启动等待持有。** 在锁内分配，锁外调用宿主，重新加锁提交结果。两个子进程均可继续启动。
4. 子进程可能在创建回执前调用 tmux。读到自己或目标的 reserved entry 时，释放锁后有界等待绑定，最长不超过既有 25 秒 terminal.open 控制超时；超时明确失败，不把来源面板冒充新面板。
5. launch 装饰读取 inherited TMUX / TMUX_PANE 时必须兼容 reserved entry，保留已预留的 %N，禁止回落为 %0 或重建会话。
6. 已确认创建失败才清理自己仍持有的 reservation，不减少 nextIndex。回执迟到且 reservation 已失效时不得覆盖后来状态。

### 7.2 超时、崩溃与旧 map

- 通信超时不等于宿主未创建。保留 creationId，以既有 panel / terminal 查询按 paneIdentity.creationId 对账；确认已有面板则补绑定，不再次 spawn。
- 若宿主不可查询，保留 reservation 并返回明确错误；不要仅凭年龄删除，也不要关闭身份不确定的面板。后续恢复对账确认不存在后才能清理。
- main 也要按 creationId 串行化创建；在进程内合并进行中请求，在重启后查询已持久化的 terminal session，避免同一请求得到两个面板。
- 重启后残留 creating 回执是结果未确认，不能当作未执行再重放原命令。先由既有终端恢复 / 对账确认其可呈现结果；无法确认时报告未完成，由用户在现有终端重开路径发起新的请求。
- 创建中已分配编号但未生成真实面板时允许空号。失败不得使已存在的面板换号。
- v1 map 读取兼容；不能因缺少新字段整份重置。已有 pane 映射保持；宿主已存 identity 时，经既有终端 session 查询补齐插件缓存。宿主也无 identity 的旧面板保持旧行为，不在只读查询时生成身份，首次明确桥接重开按第 6 节登记号码。
- session TTL / leaderAlive 的失败不能直接覆盖仍有存活子 pane 的整份 map。先在锁外查询宿主、再在锁内核对最新版本与条目所有权；只清理已确认不存在的记录。
- 插件 map 是 tmux 适配索引，绝不成为 UI 恢复或活动状态的唯一真源。

## 8. Respawn、退出、恢复与移动

| 场景 | 必须执行的规则 |
|---|---|
| respawn 无新命令 | 使用该 pane 上次成功启动的原命令；不重新包两层 shell。没有可恢复命令时按既有裸 shell 语义处理 |
| respawn 有新命令 | 新命令优先，重新分类；不得从 map 带旧 agentId 覆盖。cwd / env 按本次 tmux 参数及既有规则生成，不因缓存命令恢复旧环境 |
| 新命令为另一智能体 / 非智能体 / one-shot | 当前运行分类随新命令替换 / 清空；编号与创建来源保持，用户钉名保持 |
| respawn 成功 / 失败 | 成功才更新 map 的“上次成功原命令”；失败若旧进程已结束，显示真实失败，不把旧会话当作仍在运行。下一次无参数重开仍使用最后成功命令 |
| 同 pane 并发 respawn | 插件只允许一个在途 respawn；第二个明确返回忙，不自动排队重启刚启动的进程。宿主既有 launch / generation 门禁拒绝旧完成事件 |
| renderer reload / 重挂 | 从 session snapshot 水合相同号码与来源；读取当前 FA，不重启仍存活的原生终端 |
| app 冷启动 | 从宿主 session 恢复号码、来源、用户钉名；只经既有 agent resume / 静态结果规则恢复运行。不得从 plugin map 原命令自动重放有副作用的命令 |
| 来源面板关闭 | 保留来源名称快照并显示“来源分屏已关闭”；关闭定位动作，不删除当前面板身份 |
| 跨窗移动 | identity 跟随既有 session transfer；保留号码，用当前 panel 所在窗口定位，不使用过期 Electron 数字 windowId |
| 复制 / 全新创建 | 新 panelId、新 creationId、新号码；不复制旧运行事实。若由复制动作创建，来源为被复制面板，宿主重新核验 |
| 插件禁用 / map 丢失 | 已存在面板仍可显示宿主持久化身份；适配功能不可用不等于面板身份丢失 |

恢复是本标准验收项：已登记的 identity 必须完整恢复。尚未登记 identity 的旧面板按第 6 节迁移；不能靠 cwd、catalog 或面板顺序猜桥接身份或创建来源。宿主冷启动并不承诺原生进程无损存活。

## 9. 用户文案

文案使用宿主四语 locale。下列编号和来源是面向用户的产品信息；不展示内部 creationId、spawnGeneration、tmux sessionId 或 plugin workDir。

| key | zh-CN | en | ja | ko |
|---|---|---|---|---|
| terminal.paneIdentity.number | 分屏 #{{number}} | Pane #{{number}} | ペイン #{{number}} | 분할 창 #{{number}} |
| terminal.paneIdentity.info | 查看分屏信息 | View pane details | ペイン情報を表示 | 분할 창 정보 보기 |
| terminal.paneIdentity.origin | 创建来源：{{name}} | Created from: {{name}} | 作成元：{{name}} | 생성 위치: {{name}} |
| terminal.paneIdentity.originUnknown | 创建来源未确认 | Creation source unavailable | 作成元を確認できません | 생성 위치를 확인할 수 없습니다 |
| terminal.paneIdentity.originClosed | 来源分屏已关闭 | Source pane is closed | 作成元のペインは閉じられています | 원본 분할 창이 닫혔습니다 |
| terminal.paneIdentity.originChanged | 来源分屏已开始新的会话 | Source pane has started a new session | 作成元のペインで新しいセッションが開始されています | 원본 분할 창에서 새 세션이 시작되었습니다 |
| terminal.paneIdentity.goToOrigin | 转到来源分屏 | Go to source pane | 作成元のペインへ移動 | 원본 분할 창으로 이동 |
| terminal.paneIdentity.focusFailed | 无法打开来源分屏，请在会话列表中查找。 | Unable to open the source pane. Find it in the session list. | 作成元のペインを開けません。セッション一覧で探してください。 | 원본 분할 창을 열 수 없습니다. 세션 목록에서 찾아보세요. |

tab 中的紧凑文字只有 `#{{number}}`；其完整可访问名称使用 number key。来源引用已关闭时仍能阅读创建时名称。catalog 标签沿用 catalog，不另做翻译副本。

## 10. 实现分工与顺序

1. **共享命令分类**：`src/shared/agent-command-detection.ts` 及 catalog 模式声明。覆盖包装、字面参数、已知一次性入口与未知表达式；维持既有 matcher 调用契约。
2. **宿主身份持久化**：`src/shared/contracts/terminal/panel-session.ts`、`src/main/state/terminal-session-*`、序列状态模块与 transfer。完成号码分配、来源快照、schema 迁移及副作用前后的失败规则。
3. **创建协议**：`src/shared/contracts/commands.ts`、`renderer-command.ts`、`src/main/app-core/commands/panel.ts`、`terminal-open-renderer-command.ts`。分类提前到 renderer 下发前；补齐结果 schema、creationId 去重和快照投影。
4. **Renderer 接入**：`renderer-commands.ts`、terminal kit 的 create / relaunch / descriptor / end-state 路径，`PanelTabHeader` 与 tooltip。身份不写标题；旧运行投影随 launch 失效；编号与来源动作复用宿主表面。
5. **插件并发与 respawn**：`session-map.ts`、`verbs.ts`、`verbs-open.ts`、`verbs-io.ts`、`wrap.ts`。统一带锁读改写、reservation、回执合并与迟到对账；不得只修 split 的分配而保留其它整表写入者。
6. **跨表面与治理**：已有 agent 列表 / quickpick、跨窗和移动 snapshot 消费、四语文案、本文检查点。所有行为验证通过后，再向 AGENTS.md 增加本标准摘要，不提前将未实现行为写成当前硬约束。

依赖顺序为 1–3 → 4–5 → 6。单目录密度、源码文件长度、插件包边界和进程边界沿用现有治理。

## 11. 验收与检查点

### 11.1 自动化行为矩阵

以下是实现验收要求，不是对当前代码的通过声明。现有文件扩展真实行为用例；新增测试文件按领域放置，不以“源码中出现函数名”代替调用链测试。

| 检查点 | 必须覆盖的行为 |
|---|---|
| `tests/unit/agent/command-detection.test.ts` | 真实 shim 包装值与直接命令命中一致；多层 shell、env / runner、转义；echo / prompt 中工具名不命中；不支持表达式与层数越界返回未知 |
| `tests/unit/main/terminal/` 创建协议测试 | 分类发生在登记 / renderer 命令之前；显式先验保持；自动 one-shot / unknown 不写先验；成功返回 identity；重复 creationId 仅一个面板 |
| `tests/unit/main/panel/foreground-activity-aggregator.test.ts` | 仅 launch 也有 agent 活动但无 status；hook / OSC 顺序不能成为标题显示门禁 |
| `tests/unit/renderer/panel-kits/` | OSC 先到、hook 先到、仅一个到、两个都不到；用户钉名；旧代次迟到；新 shell 清除旧图标；号码始终不变 |
| `tests/unit/plugins/agent-splits/` | 至少两个独立 shim 进程并发，%N 唯一且所有绑定保留；绑定与删除交错、打开失败、迟到回执、锁持有者崩溃、reserved 子进程读；无假父 panelId |
| plugin respawn 测试 | 无新命令 / 有新命令；Claude→Codex→shell；one-shot；失败后再次重开；并发 respawn；通信重试保持 requestId 且不再次重启，超时核对 launchReceipt；原创建来源和用户钉名保持 |
| `tests/unit/main/` session / transfer 测试 | 号码高水位损坏恢复、旧 schema 迁移、冷恢复、移动保号、复制换号、来源关闭 / 换代、map 缺失仍可恢复 |
| renderer tooltip / header component 测试 | 完整标题 / cwd / 状态 / 来源合并不丢；独立编号不进 short / long；四语 aria；键盘详情与来源动作；失败有反馈 |
| `tests/e2e/app/agent-splits.spec.ts` | 真实终端首帧编号与种类图标，4 个同类分屏、-d 焦点、标题更新、关闭不重排、来源跳转、respawn / reload 与跨窗 |
| 治理测试 | shim 无 catalog / agent 词表；无 catalog title；编号不进窗口名；不从来源合成 provider 父子关系；所有 map 写入走统一锁 |

### 11.2 人体工程学与可用性

- 在 1280×800 与 960×640 桌面窗口验证 4 个同项目、同种类、同标题分屏；编号始终可见，关闭一个后其余号码与相对顺序不变。
- 多组 tab、长 OSC、长路径、中英日韩和 UI 缩放场景中，编号不被标题挤没，关闭按钮与焦点指示不被挤出；遵守现有 tab 滚动与 28px 控件规则。
- 使用鼠标、纯键盘和屏幕阅读器分别完成“辨认当前分屏→查看创建来源→回到来源”；不能为了读来源而逐个打开终端，也不能在后台 `-d` 创建时丢失正在输入的焦点。
- 移动端已有会话列表 / 详情可读同一编号与来源，无 hover 依赖；不因此开放新的终端执行权限。
- 在实现后安排至少 5 位使用者完成“回到刚看过的分屏、找出需要处理的分屏、定位来源”任务，记录定位耗时、误选和误输入，和现有同名体验比较。任何因编号重排、标题遮挡或错误来源导致的误操作都阻止冻结。
- 以上是待执行验收。没有实机记录与使用者验证，不把“符合本设计”表述为“已经证实最佳体验”。

## 12. 参照证据与冻结条件

- [herdr Agent automation](https://herdr.dev/docs/agent-automation/) 区分 pane 位置、智能体种类与当前运行的名称别名；别名在退出、释放或替换后清除。本文借鉴其身份寿命区分，不引入同款执行 API，也不将其概括为“名称永久属于 pane”。
- [Orca issue #16693](https://github.com/stablyai/orca/issues/16693) 在 2026-09-05 核查时仍是开放的功能请求，讨论顶部布局标签。它能证明多会话标签存在识别需求，不能证明相关方案已经落地或具备最佳体验。

冻结需要同时满足：分类真实链路成立、并发不丢映射、标题与状态独立、编号跨生命周期稳定、创建来源准确、已有各表面呈现一致，以及第 11 节自动化与实机验收有记录。通过前继续标记“未实现 / 待验证”。

AGENTS.md 落地摘要应锁定：身份与标题分离、matchAgentCommand 单一分类入口、paneNumber 稳定且不进窗口名、来源不等于布局或原生父子会话、map 全写入者同锁、respawn 重新分类与冷恢复验收；不恢复旧稿的 catalog 占位与“FA 到达才让位”规则。
