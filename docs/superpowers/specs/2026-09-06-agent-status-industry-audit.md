# 智能体状态实现：源码对照审查

日期：2026-09-06。性质：现状审查与优化建议，本文没有实施修复。

后续进展：用户确认后已实施 F1–F5 的修复，详见 [实施结果与验证记录](../plans/2026-09-06-agent-status-audit-follow-up.md)。下文保留修复前的现象和源码基线，便于后续增量比较。

## 结论

仍有问题。本轮复现了五项缺口：OpenCode 已空闲仍显示处理中；Claude 手动压缩的结束缺少对应处理；会话文件原子替换后漏读；读文件失败产生未处理异步异常；监听达到上限时已有面板不能正常换会话。

最优先的调整是区分三个问题：**现在是否在忙、上一回合如何结束、观察通道是否正常**。当前原生 idle 被降为 advisory Stop 后，没有独立路径更新“现在空闲”，会把防止假完成的规则变成假忙。保留 advisory Stop、主/子身份及旧回合隔离规则，在适配器中保留原生空闲语义，再让公共归约器分别处理当前活动与回合结果。

Orca、Agent Deck、AgentAPI 各有可借鉴机制，也各有适用前提。本报告修订 [2026-08-25 调研](2026-08-25-agent-status-industry-alignment.md) 中“已属完备”“严格优于”“业界公认”等过强判断：协议、钩子与终端观察应按身份、覆盖、时延和恢复能力逐项比较，不能只按通道给项目排名。

## 审查范围与证据等级

- 本地检查覆盖适配器输入、事件权限、回合归属、工具/交互/子智能体归约、私有会话记录对账、快照广播及轨迹测试。
- 上游深查 Claude、Kimi、Codex、OpenCode；对照 stablyai/orca、asheshgoplani/agent-deck、coder/agentapi 的实际源码。其余提供方只检查共享链路与现有证据矩阵，**不表示已逐家验证最新版本**。
- A：实际 Pier 代码在隔离输入下复现；B：上游源码或官方契约直接支持，尚未本机端到端验证；C：待验证的改进机会。A 也不等于用户截图会话的直接根因。
- 没有向用户正在运行的智能体发送任务、执行 `/compact` 或重启进程；没有证明 Electron 崩溃，也没有用屏幕静止判定完成。
- 本地基线为本次工作区快照，包含前轮已暂存的 Kimi、Claude 晚创建文件及状态归属修复；不能用单独 HEAD 替代它。前轮规则见 [证据与回合归属](2026-09-06-agent-status-evidence-gold-standard.md)。

## 版本与一手来源

已实际执行本机四个 CLI 的 `--version`。比较“已安装版本”和“上游 HEAD”时分别记录，不能混为同一行为。

| 对象 | 本机 / 比较基线 | 固定源码 |
|---|---|---|
| Claude Code | 2.1.261；本次未取得对应版本官方核心源码，按公开钩子文档和事件轨迹评估 | [官方 hooks](https://code.claude.com/docs/en/hooks)；Orca 的 Claude 适配及测试见下文 |
| Kimi Code | 0.41.0；`kimi-code` HEAD 包版本也为 0.41.0，但未证明与本机发行物逐字节相同 | [af81bb9 / package.json](https://github.com/MoonshotAI/kimi-code/blob/af81bb92215dca2f933579ce0119f7add452bc96/apps/kimi-code/package.json) |
| Codex | 0.153.4；发行 tag `rust-v0.153.4` | [3d2ee51 / thread_status.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/thread_status.rs) |
| OpenCode | 1.18.29；发行 tag `v1.18.29` | [1674747 / status.ts](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/session/status.ts) |
| Orca | 本次 GitHub HEAD，未运行其桌面端重现全部场景 | [adcc30b](https://github.com/stablyai/orca/tree/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407) |
| Agent Deck | 本次 GitHub HEAD | [498cd25](https://github.com/asheshgoplani/agent-deck/tree/498cd25f5e75502f20d86a6434ebe6b233349997) |
| AgentAPI | 本次 GitHub HEAD | [9ff117e](https://github.com/coder/agentapi/tree/9ff117e231822f670305254ef24f6389f75953f4) |

另核对 Codex HEAD `ac192cd7937b0d73edc6dffe009940ae53782dd4`、OpenCode HEAD `337fd144d2ba144743368f78d9579a99cce175bd` 的相关文件；现状结论优先使用上表发行版本。

Kimi 必须特别记录仓库族：旧 [MoonshotAI/kimi-cli README](https://github.com/MoonshotAI/kimi-cli/blob/86f136422a0aae6b217ea49e7ea1d2e8a1defcd2/README.md) 已说明向 `kimi-code` 迁移。旧仓库此次 `pyproject.toml` 为 1.50.0，不能拿它解释本机 0.41.0 的全部行为。

## 已复现的问题

优先级：P1 为常规路径状态失真，P2 为特定生命周期或恢复场景缺口。这里按用户影响排序，不代表已测得发生频率。

| ID | 优先级 | 触发与实际结果 | 证据边界 |
|---|---|---|---|
| F1 | P1 | OpenCode 正常聊天、工具完成、主会话 idle 后，仍为 processing | A：生成插件 → 解析 → 实际聚合器；两种 idle 都复现 |
| F2 | P2 | Claude 手动压缩结束后仍保留 processing，压缩 prompt ID 还可能被旧主回合拒绝 | A：实际钩子命令链回放；真实原生顺序依据 Orca 测试，未操作本机 Claude 验证 |
| F3 | P2 | 会话文件被同尺寸或更大的新文件原子替换，新文件前部的当前回合完成行漏读 | A：真实文件系统 + 共享尾读器；尚未确认各提供方活跃会话发生此替换的频率 |
| F4 | P2 | 文件存在且 stat 成功，但 open 返回 EACCES，产生 unhandledRejection | A：普通用户真实权限失败，非 mock；没有验证 Electron 是否退出 |
| F5 | P2 | 同一对账器已有 32 个文件，已有 owner 换文件被容量门槛拒绝，之后释放容量也不自动恢复 | A：真实文件 + 共享尾读器；是每个对账器的文件上限，不是整个应用只能开 32 个面板 |

### F1：原生“空闲”在归一化时丢失

OpenCode 原生 `SessionStatus` 明确有 busy/retry/idle，idle 会发布状态事件。Pier 的 [opencode.ts](../../../src/main/services/agents/integrations/opencode.ts) 208、212 行将两种 idle 都改成 Stop，460 行配置 advisory；[turn-bookkeeping.ts](../../../src/main/services/foreground-activity/turn-bookkeeping.ts) 343–347 行只记候选，479–481 行保留旧状态。[终态对账器列表](../../../src/main/services/agents/integrations/terminal-reconciliation.ts) 没有 OpenCode，也没有正常 idle 的其他收口路径。

复现顺序：`session.created → chat.message(message-1) → session.status(busy) → tool.execute.before(tool-1) → tool.execute.after(tool-1) → session.idle`。另用 `session.status(idle)` 重复一次。两个序列最后都接受 Stop，但快照仍为 processing；此时没有未结束的工具、交互或子智能体。[当前 fixture](../../../tests/unit/agent-integrations/status-traces/hosted-plugin-traces.ts) 327–339 行甚至明确断言这一结果。主证据静默 30 分钟后才失去具体状态，依据 [entry.ts](../../../src/main/services/foreground-activity/entry.ts) 的 TTL；不是永久 processing。

**修复方向：**让有可靠会话归属和顺序的原生 idle 更新当前活动，不封回合、不推断成功、不发送完成通知。旧 idle 不能盖过更新的 busy，主会话 idle 不能抹掉仍活跃的交互和子智能体。保留普通 advisory Stop 的现有规则，不把所有 Stop 改为完成。

### F2：Claude 压缩是单独的生命周期

[claude.ts](../../../src/main/services/agents/integrations/claude.ts) 129–139 行把 PreCompact、PostCompact 都映射为 processing，没有区分 manual/auto。官方 [PostCompact 文档](https://code.claude.com/docs/en/hooks#postcompact) 提供 trigger；Orca 的 [compact 判定源码](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/shared/claude-compact-completion.ts) 记录了实际成功顺序：`PreCompact → summarizer SubagentStop → SessionStart(source=compact) → PostCompact`。它还记录“内容不足”可能只有 PreCompact，并针对手动完成、自动续跑及过期归属作不同处理。

本轮先输入 `UserPromptSubmit(turn-A)`，再按上述顺序回放 `compact-B`，使用实际生成的钩子命令、schema、enrichment 和 aggregator。结果 Pre/PostCompact 被拒为 foreign-turn，SessionStart 被接受但不改变 processing；因此存在无额外完成证据时无法及时反映压缩结束的路径。即使 ID 相同，PostCompact 的固定 processing 映射也不表达手动压缩结束。

**修复方向：**在 Claude 适配器保留 trigger、source 及压缩归属，单独处理手动维护动作的结束；自动压缩后仍可继续原回合。压缩完成不能无条件结算旧任务，不能通过放松全局 foreign-turn 校验实现。补成功、提前中止、自动续跑、迟到/重复压缩、换会话及后台工作轨迹。本轮没有证明这就是用户所附普通问答截图的原因。

### F3：文件水位只识别“变小”，不识别“换了文件”

[tail-reconciler.ts](../../../src/main/services/agents/integrations/transcript/tail-reconciler.ts) 95 行只在 `current.size < entry.offset` 时重置。已读完 829 字节后，用另一 inode 的 829 或 1085 字节文件原子替换，将带**精确当前 turnId** 的完成行放在新文件前部。两次都收到 0 条完成事件；把相同完成行追加到尾部，立即收到 1 条，排除了分类器和身份不匹配。

**修复方向：**以实际文件代际（如 dev/ino，兼顾平台能力）约束字节水位；重开后从同一文件句柄校验身份和大小，避免 stat/open 间竞态。代际变化时安全重置解析状态、水位和去重，但继续执行原生回合身份与历史防重放规则，不能把新文件的历史全部认成当前回合。

### F4：观察失败没有在异步边界接住

同文件 108 行开始执行 open/read/close，172 行 `scheduleDrain` 只接 finally，没有 catch。隔离文件 chmod 000 后 stat 仍成功，普通用户 uid 501 的实际 open 抛 EACCES；探针捕获一条未处理 rejection。探针为继续其他用例临时安装了进程监听器，产品没有因此获得错误处理。

**修复方向：**在观察任务边界接住异常，记录路径类别、阶段及错误码，通过既有诊断表达观察退化，并有界重试；恢复权限后即使没有新钩子也能重读。观察失败不是智能体执行失败，不应伪造 error 终态或完成。不要只缩短 TTL 掩盖漏读。

### F5：容量检查阻止等量换绑

同文件 246 行在建立新 entry 前检查 `entries.size + entryCreations.size >= 32`，旧 owner 的释放在 372 行之后。已有 32 个独占文件时，owner-0 改绑第 33 个路径，最终本应仍为 32 个监听，却先被拒绝。新文件追加完成行后收到 0 条；释放 owner-1 后仍为 0；再补一条 Stop 才建立监听并收到 1 条。

**修复方向：**按换绑后的净资源占用决定准入，安全复用或释放旧独占 entry 的配额，处理失败回滚与异步 owner 失效；旧文件还有其他 owner 时不能强行释放。真正超额时保留有界的恢复机会与可查原因，不直接提高上限或静默放弃。

## 与业界源码逐项对照

| 对象与代码依据 | 实际机制 | 对 Pier 的意义及限制 |
|---|---|---|
| Orca [Claude 权限处理](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/main/agent-hooks/server/server-claude-status-rules.ts) | 维护等待归属，只有匹配工具/子智能体的结果才能清等待；在严格匹配条件下从前一 PreToolUse 关联缺失 ID 的权限请求 | 可探索补 Claude 普通权限等待；先证明允许、拒绝、取消、自动应答均闭环，不能仅收到 PermissionRequest 就一直 waiting |
| Orca [Claude 生命周期](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts)、[事件映射](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/shared/agent-hook-listener/providers/claude-events.ts) | 分开主会话完成、子智能体 roster、后台任务与定时工作；手动 compact 有专门分支 | 借鉴场景覆盖和活性证据，不复制第二套状态缓存。子智能体结束不能证明父任务完成，恢复出来的旧 roster 不能当当前活性 |
| Orca [authority fences](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/main/agent-hooks/server/server-authority-fences.ts) | 区分恢复快照、当前运行权、关闭/迁移后的旧别名 | Pier 已有 owner、generation、turn fences；应补恢复和迁移轨迹，不能收到旧快照就刷新主状态 |
| Orca [Kimi 事件映射](https://github.com/stablyai/orca/blob/adcc30be3bc2a0bae7bc0f6cdd1bf55c7815f407/src/shared/agent-hook-listener/providers/kimi-events.ts) | 该 normalizer 将 Stop、StopFailure 直接归为 done | 与 Kimi 主/子共享会话、Stop 可续跑的语义有冲突风险。未在 Orca 实机复现，不能宣布其完整链路一定误报；也不能直接照抄此映射 |
| Agent Deck [统一状态推导](https://github.com/asheshgoplani/agent-deck/blob/498cd25f5e75502f20d86a6434ebe6b233349997/internal/sessionstatus/sessionstatus.go) | CLI/TUI/web/daemon 复用推导；新鲜度按来源区分，用户显式停止有更高优先级 | 学习消费者一致性测试与来源新鲜度。其 Codex running 20 秒、waiting 2 分钟是自身策略，不能直接替换 Pier 的 TTL |
| Agent Deck [hook watcher](https://github.com/asheshgoplani/agent-deck/blob/498cd25f5e75502f20d86a6434ebe6b233349997/internal/session/hook_watcher.go) | 新增目录后立刻扫描；记录监听错误；fsnotify 溢出时重新扫描状态文件恢复镜像 | 借鉴“漏观察后能恢复”。Pier 用 watchFile 轮询与追加记录，不能直接移植 inotify/fsnotify 溢出处理或照搬整文件扫描 |
| AgentAPI [PTY conversation](https://github.com/coder/agentapi/blob/9ff117e231822f670305254ef24f6389f75953f4/lib/screentracker/pty_conversation.go) | 结合连续屏幕一致、提示符已就绪、发送队列为空及不在发送中判 stable；用户新消息使状态改变 | 可作无需修改 CLI 的兼容观察；屏幕 stable 不能单独证明语义上的成功或失败，不宜驱动可信完成通知 |

上述比较并不证明某项目总体更准确；没有对三款产品运行同一组真实交互来测误报率。

### 原生智能体的契约给出的方向

**Codex 已区分当前状态和回合结果。** 已安装 0.153.4 的 [thread_status.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/thread_status.rs) 用运行事实生成 active/idle，并单独保留等待批准和等待用户输入。官方 [app-server 文档](https://learn.chatgpt.com/docs/app-server) 的 `turn/completed` 则携带 completed/interrupted/failed。其 [Stop](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/stop.rs) 与 [Interrupt](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/interrupt.rs) 各有契约；Stop 本身仍能被阻塞继续。Pier 可评估补原生 Interrupt，但需验证实际钩子可用性、身份和重复输入，不能仅因上游有枚举就认定现有取消路径失效。

**Kimi 0.41.0 的新实现也分开 busy 与主回合结果。** [sessionActivityService.ts](https://github.com/MoonshotAI/kimi-code/blob/af81bb92215dca2f933579ce0119f7add452bc96/packages/agent-core-v2/src/session/sessionActivity/sessionActivityService.ts) 聚合各智能体的 busy，`lastTurnReason` 只读 MAIN；[agentExternalHooksService.ts](https://github.com/MoonshotAI/kimi-code/blob/af81bb92215dca2f933579ce0119f7add452bc96/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts) 仅用户来源触发 PromptSubmit，Stop 可阻塞续跑，取消与失败另有事件。这支持 Pier 前轮“主 wire 终态 + 原生回合身份”的方向。新的 Interrupt 名称也不能替代主/子身份检查。

**OpenCode 的 idle 可用于当前活动，不能直接当成功。** 当前发行版 [status.ts](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/session/status.ts) 和 [prompt.ts](https://github.com/anomalyco/opencode/blob/16747470f976aca3d362ad730bcd3fe82ecc2c9a/packages/opencode/src/session/prompt.ts) 应结合阅读；`idle` 是运行状态而非结果码。Pier 已在现有插件里收到它，修复 F1 不要求另起服务。[官方 server 文档](https://opencode.ai/docs/server/) 说明 TUI 有自己的 server，另跑 `opencode serve` 创建的是新服务，不能当作当前终端的恢复观察入口。

**ACP 给出宿主驱动回合的明确边界。** [prompt-turn 协议](https://agentclientprotocol.com/protocol/v1/prompt-turn) 以请求在途和响应 stopReason 表达回合。这适合宿主持有请求的入口；Pier 旁观用户已有 CLI 时，不应另建请求来假装已获得该回合的权威状态。同理，另启动 Codex app-server 也不会自然拥有原 TUI 的实时会话。

## 为什么修过多次仍会出现

1. **当前活动和回合结果仍部分耦合。** 防止 Stop 假完成是必要修复，但原生 idle 缺少单独语义，F1 因此成为常规路径的假忙。
2. **测试的期望主要来自现有实现。** [跨层覆盖测试](../../../tests/unit/agent-integrations/agent-status-trace-e2e.test.ts) 跳过矩阵中 unsupported 的维度；OpenCode 的原生 ready 被标为 unsupported，idle 后 processing 的断言能通过。测试证明实现符合所写规则，不能证明这些规则符合上游。
3. **恢复条件没有被完整建模。** “文件晚创建”已补，但“换 inode”“权限恢复”“等量换绑”是不同事件，不能由同一个 ENOENT 修复自动覆盖。
4. **上游版本与事件含义持续变化。** Kimi 仓库迁移、Claude manual/auto compact、Codex 新事件要求持续核对。只记录一个事件名称，不记录版本、身份与闭环，容易再次退化。

## 分步优化方案

以下为待实施方案。优先改现有模块，避免增加通用任务服务、公共 Transcript API、第二套广播或提供方名称分支。

### 第一批：纠正当前活动语义

- 补充现有状态契约：内部明确区分当前活动、最近可信回合结果、观察健康度。对外可继续使用既有状态与广播，不要求立刻增加三个公共状态 API。
- 在 OpenCode 适配器保留有归属的 native idle/busy；归约器更新当前活动，完成通知仍只读可信结果。不得降低普通 advisory Stop 的权限。
- Claude 的手动维护结束按自己的归属和 trigger 收口；自动压缩保留原回合。先补实际版本的成功/失败轨迹，再改映射。
- 验收：idle 后在正常事件处理周期内结束忙态；不出现假成功通知；idle→busy、重复/迟到 idle、并发交互、活跃子智能体、换会话均正确。不得用“静默 N 秒就完成”达标。

### 第二批：修复观察恢复

- F3 增加文件代际检查；F4 在异步边界捕获并有界重试；F5 以净占用处理 owner 换绑。
- 复用既有生命周期与诊断设施，记录最后成功观察时间及失败原因；这些是内部诊断，不把实现术语塞入状态栏。
- 置信度过期只能使具体状态缺席，符合现有产品契约；读取失败不能令任务成功或失败。
- 验收：同尺寸/更大原子替换、原地截断、权限恢复、读中关闭、上限换绑、共享 owner、迁移与迟到异步结果。保持内存/监听数有界，恢复无需等用户下一次输入。

### 第三批：让测试由外部事实约束

- 每条提供方轨迹附：CLI 版本、源码仓库与 commit、原生载荷来源、主/子身份规则、预期当前活动、是否有可信结果。
- 将“上游支持但尚未实现”与“上游无证据”分开记录。unsupported 不能自动免除已知可达场景；正常结束必须有明确验收结果。
- 轨迹覆盖直答、长工具、允许/拒绝/取消、静默续跑、压缩、并发子智能体、进程退出、窗口迁移、漏观察后恢复；快照与广播用同一预期。
- 为观察层补故障恢复测试；继续使用实际生成钩子/插件驱动，避免只给聚合器喂人工规范事件。
- Claude 普通权限等待、后台任务清单及 Codex 原生 Interrupt 列为后续 B/C 级调查项，取得可闭环证据后再扩覆盖。

不建议：缩短所有提供方 TTL、把全部 Stop 升权、以屏幕不动判成功、增加公共会话记录库、让每个界面自行猜状态、直接复制 Orca 的全部映射。

## 本轮复现记录与后续验收素材

探针均导入当前工作区实际 TS，通过 Node 24 的模块解析钩子处理本地别名；文件写入和生成钩子输出仅在独立临时目录。本轮脚本位于 `/tmp/pier-opencode-idle-audit.mjs`、`/tmp/pier-claude-compact-audit.mjs`、`/tmp/pier-transcript-audit-repro.mjs`；临时文件不作为以后审查的必需依赖，下面保留可重新构造的输入与结果。

| 探针 | 关键构造 | 观察值 |
|---|---|---|
| OpenCode | 用 [opencode-plugin-driver.ts](../../../tests/unit/agent-integrations/status-traces/opencode-plugin-driver.ts) 建生成插件；按 F1 顺序发主会话事件，再经 schema/enrichment/实际 ingest options 入聚合器 | 两种 idle 均被接受为 Stop，最终 processing |
| Claude compact | 用 [hook-command-driver.ts](../../../tests/unit/agent-integrations/status-traces/hook-command-driver.ts) 与 `CLAUDE_HOOK_EVENTS`；同 session、两个不同 UUID 分别为 turn-A/compact-B，按 F2 顺序执行 | Pre/PostCompact accepted=false，reason=foreign-turn；最后 processing |
| 原子替换 | 初始 JSONL 为 `{type:padding,text:800个x}` 加换行，共 829 字节；观察 Prompt(active) 后，rename 新 inode，首行 `{type:terminal,turnId:active}`，其余填充至 829/1085 字节 | 替换后完成数 0；尾部追加同一完成行的阳性对照为 1 |
| 真实权限 | 临时 JSONL chmod 000；普通用户调用实际尾读器；捕获进程 unhandledRejection 以让探针继续；清理时恢复权限 | EACCES，一条未处理 rejection；未模拟 Electron 退出 |
| 容量 | 同一尾读器登记 32 个 owner/独占空文件；owner-0 改指另一个文件并追加精确新 turnId 完成行；释放 owner-1；最后补 Stop | 新文件收到数 0 → 释放后仍 0 → 新 Stop 后 1 |

尾读探针使用最小分类器，只把精确的 `type=terminal` 行转为 TurnCompleted；这验证公共读取机制，不冒充某个提供方的原生记录格式。实际使用者与替换方式仍需逐家补集成轨迹。三个尾读问题均独立重跑得到相同结果；OpenCode 现有跨层 fixture 也通过，恰好证明需要修正期望。命令 `pnpm exec vitest run tests/unit/agent-integrations/agent-status-trace-e2e.test.ts -t 'opencode: 官方形状'` 的本轮结果为 1 passed、37 skipped；不是全套测试结果。**探针成功复现问题，不等于产品已修好。**

## 周期审查

建议每周一北京时间 10:00 做增量审查，每月首周扩展为深查。可执行任务提示词与输出约定见 [周期审查任务模板](../plans/agent-status-periodic-review.md)。本轮模板已准备，自动运行尚未启用。
