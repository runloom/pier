# 智能体状态：证据与回合归属

状态栏必须表达当前主会话仍在做什么。Kimi 0.41.0 的子智能体 Stop 与主会话 Stop 共用会话号，且新回合不一定发出 UserPromptSubmit；把 Stop 当完成、或收到候选就清空工作集，都会让仍在执行的主会话丢失状态。

## 统一规则

1. 有未完成的用户交互显示 waiting；否则有工具执行显示 tool；其余已知进行中的工作显示 processing。
2. advisory Stop 仅记录候选，不清除工具、交互、子智能体，不隐藏已有状态，也不把会话视作已结束。工具结束只结算该工具，不能证明主回合完成。
3. 当前主回合的可信完成、中断或失败证据才可封账，并退休该回合残余工作。`ready` 表示当前空闲；`turnResult` 只承载该投影所属回合的可信 completed / interrupted / failed，完成通知不能仅凭变成 ready 触发。
4. 子智能体事件只更新自己的计数，不能制造父会话空闲或完成事实，也不能延长主状态的可信期限。若父会话已有原生空闲事实，最后一个子工作结束后可据既有事实展示 ready。候选同样不能恢复已过期的状态。
5. 旧回合消息不能结算新回合。适配器保留并验证原生回合身份；没有身份的旧格式仍遵循 owner 与 PromptSubmit 文件水位。恢复执行建立原生时间下界，拒绝下界之前的迟到终态。对账等待被工具超越时，同一活跃 ID 的迟到 Prompt 只确认主身份，不清工具、不回退时间。已有 transcript 软封解封规则继续适用。
6. 静默超时只令状态失去置信度，绝不推断完成。启动时尚无证据的状态仍可缺席。

### 当前空闲与维护动作

- OpenCode `session.idle` / `session.status(idle)` 映射为 `ActivityIdle`。归属有效且不早于主会话进展时，记录当前空闲；已有工具、交互和子工作仍优先展示。后续新鲜进展可继续同一回合，不能因此封账或伪造成功。MiMo 等共享生成器的其他适配器须独立核验，不自动升级其 Stop 权限。
- `MaintenanceStarted` / `MaintenanceCompleted` 的原生 `turnId` 属于维护动作，只在独立的配对记录中使用，不写入用户 `currentTurnId`、settled/abandoned 回合集合。Claude 仅成对 manual 完成可提供空闲事实；自动压缩保持原回合，孤立 PreCompact 不制造忙碌。新提问/工具进展使旧维护结束失效，子会话和外来会话不能配对主会话。
- 维护事件也不能改写 transcript owner 或 Prompt 水位；Claude `SessionStart(source=compact)` 同样不能替换用户回合。压缩之后没有工具或 Stop 时，匿名 assistant 完成仍归原用户提问。
- 快照同时投影当前状态与可信结果，二者必须来自同一 scope。原生空闲不通知；先空闲、后收到可信结果时，即使状态仍为 ready 也通知一次。

检查点：`tests/unit/main/panel/turn-status/native-idle.test.ts`、`tests/unit/main/agents/claude/manual-compaction.test.ts`、通知分类与跨层轨迹测试。

### Kimi 原生取消

- `Interrupt` 只触发提供方私有对账，沿用无结算权限的控制事件。其主/子共用 session_id，不能直接映射为主回合中断。
- 数字回合 ID（包括 0）保留在筛选后的身份元数据中，必须与当前观察边界之后的 main wire 取消记录核对；未经核对的 hook ID 不得写入 transcript owner。取消早于首次工具甚至 step.begin 时，仍可由新 main prompt 与匹配的 turn.ended.cancelled 建立关联。
- 取消记录延迟落盘时，沿用已有尾读监听重新对账；关闭、新提问和跨窗迁移仍遵循原有 scope 生命周期。旧回合、恢复时的历史记录以及子智能体取消不能结束新主回合。

原生次序依据：[Kimi 0.41.0 external hooks](https://github.com/MoonshotAI/kimi-code/blob/af81bb92215dca2f933579ce0119f7add452bc96/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts) 与 [turnOps](https://github.com/MoonshotAI/kimi-code/blob/af81bb92215dca2f933579ce0119f7add452bc96/packages/agent-core-v2/src/agent/loop/turnOps.ts)。检查点：`tests/unit/main/agents/kimi/native-cancellation.test.ts`、`tests/unit/main/agents/claude/compaction-transcript.test.ts`，均执行真实生成钩子、宿主消费管线、私有对账器与归约器。

### 会话记录晚创建

Claude Code 2.1.261 实机出现了 PromptSubmit 已在 Pier 入账、31ms 后才创建会话记录的顺序。无工具直答时，下一条 hook 已是 Stop；若这时才开始监听，完成行会被首次历史区过滤，状态持续 processing。

- 显式 transcriptPath 暂不存在时，沿用现有有界 watcher 与 owner 生命周期等待创建，不阻塞 PromptSubmit 入账。
- PromptSubmit 确认 ENOENT 才保存该 owner 的文件水位 0；权限或其它读取失败不能当作空文件。
- 缺失路径先按现存祖先归一，防止创建前后的路径别名导致另开 watcher 丢失水位。首次出现后重新校验真实路径属于提供方根目录，注册后立即读取以覆盖注册间隙。
- 只有当前真实目标相同才可复用已注册路径；符号链接改指另一文件后重新建立对应监听，不能沿用旧文件水位。
- 晚创建文件的首次区间只有明确 Prompt 水位、唯一 owner 时才可回退认领；SessionStart 自身不能重放历史。带原生回合身份的行仍须精确匹配。
- 关闭、释放、换会话和跨窗迁移继续使用同一套 owner 清理与转移规则，不另建待办队列；异步路径读取后重新确认 owner 有效，避免关闭后创建残留监听。

检查点：`tests/unit/main/agents/claude/late-transcript.test.ts`、`tests/unit/main/agents/transcript/late-file-registration.test.ts`、`tests/unit/main/agents/transcript/late-file-cancellation.test.ts`。

### 会话文件替换与读取恢复

- 字节水位受实际打开文件的 dev/ino/birthtime 约束；替换或截断后重建解析状态与历史边界。Prompt 水位必须记录自己的文件身份，换代时保留已属于新文件的边界，只废弃旧文件边界；确认不存在的水位 0 仅授权随后首次文件。保留已投递原生 ID 的防重，旧文件的匿名水位不得授权新文件历史；精确当前回合 ID 仍可回扫匹配。
- 读取失败在私有尾读边界捕获，只记录不含会话正文或路径的诊断。每文件最多一个重试计时器，250ms 起退避至 5s；释放时取消，不伪造智能体 error 或完成。
- 保持 32 文件上限；已有独占 owner 换文件先释放旧配额，共享文件不强制释放。真正超额时复用 pending observation，最多保留 64 个等待；容量释放自动重试，原始 Prompt 水位、关闭与跨窗迁移语义保持有效。

检查点：`tests/unit/main/agents/transcript/file-generation.test.ts`、`read-recovery.test.ts`、`capacity-recovery.test.ts`。

## 所有权与范围

- 提供方适配器负责原生事件、主/子会话与回合关联；公共状态引擎不认识提供方名称。
- `foreground-activity/` 负责一次归约，快照与广播共用结果；界面直接消费广播。
- transcript 继续是提供方内部输入，不增加公共读取、存储、索引或回放能力。
- 复用现有生命周期诊断，不增加任务台账、调度器或第二套状态服务。

## 验收

- 候选与工具、问答、子智能体交错时不出现假空白、假完成；只有当前可信终态可收尾。
- 原生输入经实际 hook 命令、解析、适配器、归约器后，快照和广播状态一致。
- Kimi 覆盖无 PromptSubmit 的连续回合、两个匿名子智能体、助手先结束/失败、问答继续、正常完成与取消。StopFailure 也没有主/子身份，只触发观察；主失败由 `main turn.ended.failed` 确认，允许先落盘后通知，但记录不得早于当前观察周期。
- 所有声明可支持的状态维度必须有可执行轨迹；移除已知缺口容忍清单，不靠扩大例外通过检查。

本规格替代历史审计中“advisory Stop 清空状态/工作集、候选视为已结算”的规则，其余身份、软封与进程边界纪律不变。
