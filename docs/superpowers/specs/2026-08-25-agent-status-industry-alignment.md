# Agent 状态检测：业界实现对齐调研与清单

日期：2026-08-25。背景：omp 面板「仍在处理却显示等待输入」事故（见 git log `PIER_HOOK_COMMAND_GENERATION = 12`）。
本文回答两个问题：业界如何检测 coding agent 状态；Pier 逐家对齐还差什么。全部结论有一手来源（官方文档 / 协议 spec / 本机安装的 agent 源码与二进制）。

## 1. 结论（TL;DR）

1. 业界没有统一的 agent 状态协议；存在**四种权威模型**，可靠性依次下降：
   - **A 协议边界权威**：宿主驱动 turn（ACP），busy = 请求在途，零推断。
   - **B provider 官方状态枚举**：agent 直接给出状态机（Codex app-server `thread.status`、OpenCode `session.status`、MCP Tasks 扩展）。
   - **C provider 推事件 + 宿主聚合**（Pier 现状；Claude/Cursor/Codex hooks、omp 扩展、Warp OSC 777）。
   - **D 宿主抓屏/轮询**（claude-squad 硬编码审批文案、Conductor 15s 轮询）——业界公认最脆弱，仅作反面教材。
2. 「**stop ≠ idle**」是全行业共同陷阱：Cursor（`followup_message` + `loop_limit` 默认 5）、Codex（`Stop.stop_hook_active` + `turn/steer`）、Claude（`stop_hook_active` + `background_tasks[]`）、omp（`willContinue` + 静默续跑）都有官方一级的自动续跑语义。Pier 的 omp 事故是该陷阱的实例；修复模板（loop 启动事件 + `turnStartAuthority`）与业界消歧手段同构。
3. 通用终端层（OSC 133）只能给**命令级** busy/idle；agent 长输出期间无 D 标记，working/waiting/attention 必须由 agent 侧推送（Warp/iTerm2 私有协议存在的根本原因）。
4. Pier 的五态聚合器在 C 类里已属完备（scope 归属、advisory/trusted 双轨、子代理计数）；主要缺口是**逐 provider 续跑语义未经真实轨迹验证**与**缺轨迹回归库**。

## 2. 四种权威模型详析

### 2.1 A 类：协议边界权威 — ACP（Agent Client Protocol，Zed 主导）

- turn = 一次 `session/prompt` 请求-响应对。busy 判定零推断：请求在途即 processing。
- Agent 过程推 `session/update`（11 种：user/agent/thought chunk、tool_call(+update)、plan、available_commands、current_mode、config_option、session_info、usage_update）；tool_call 状态机 `pending(含等审批)→in_progress→completed|failed`。
- 终态：响应必带 `stopReason`（`end_turn|max_tokens|max_turn_requests|refusal|cancelled`）。取消：`session/cancel` 通知后 agent **必须**仍回 `stopReason:"cancelled"`（取消必须落终态——好约束）。
- attention = 挂起的 `session/request_permission`（allow_once/allow_always/reject_once/reject_always）或 `elicitation/create`。
- 子代理：协议无嵌套概念，多会话 = 多 sessionId；子代理编排在 agent 内部。
- 实现者 40+：Zed/JetBrains/Neovim/VS Code 扩展等客户端；agent 侧 Gemini CLI（原生）、Claude（zed-industries/claude-agent-acp 适配器）、Codex（codex-acp）、Cursor CLI（官方 acp 模式）、Cline、OpenCode、Goose、Qwen、Kimi、Kiro、Droid 等。
- 本机佐证：omp 自带 ACP server（`src/modes/acp/acp-agent.ts`），内部 `agent_end` 映射为封闭枚举 `cancelled|max_tokens|refusal|end_turn`，turn 占位用 `isPromptTurnInFlight`（settled + cleanup 双闸）。
- **对 Pier 的适用性：低**。ACP 要求宿主 spawn 并驱动 agent；Pier 形态是「用户自己的 CLI 已在终端里跑，Pier 旁观」，不满足 host-driven 前提。Cursor CLI 的 ACP 面同理。

### 2.2 B 类：provider 官方状态枚举

| Provider | 通道 | 状态词汇 |
|---|---|---|
| Codex app-server | JSON-RPC（IDE 同款；stdio/WS/Unix socket；`codex app-server generate-json-schema` 可产版本精确 schema） | `thread.status: notLoaded\|idle\|systemError\|active{activeFlags[]}`，`activeFlags:["waitingOnApproval"]`；`turn/completed{status: completed\|interrupted\|failed}`；`turn/steer` 官方排队语义 |
| OpenCode | `opencode serve` HTTP + SSE（`GET /global/event`） | `session.status: {type:"idle"}\|{type:"retry",attempt,message,next}\|{type:"busy"}`——唯一官方「运行态枚举」；`permission.updated/replied`；Session.parentID + `/children` 子会话 |
| MCP Tasks 扩展（2026-07-28，SEP-1686） | `tasks/get` 轮询或订阅 | `working\|input_required\|completed\|failed\|cancelled`——`input_required` 显式对应 attention |
| Amp | `thread.state.running/idle/error`（+`.resolved`）原生事件（Pier amp 插件已部分消费） | running/idle/error 三态 |

- **对 Pier 的适用性：可选增强，不作主路径**。官方枚举最权威，但要求 Pier 管理一条到 agent server 的常驻连接（端口发现、生命周期、多实例），而 hooks/扩展管线已在统一架构内带面板归属。符合产品哲学（AGENTS.md「拒绝二次封装」）的用法：hooks 为主，枚举通道按需评估。

### 2.3 C 类：provider 推事件 + 宿主聚合（Pier 所在类）

#### Claude Code（hooks 30 事件 + statusline + SDK + OSC）

- 事件全集（官方 hooks reference）：SessionStart(source: startup/resume/clear/compact/fork)、Setup、UserPromptSubmit、UserPromptExpansion、PreToolUse、PermissionRequest、PermissionDenied、PostToolUse、PostToolUseFailure、PostToolBatch、Notification、MessageDisplay、SubagentStart、SubagentStop、TaskCreated、TaskCompleted、Stop、StopFailure(error: rate_limit/overloaded/…)、TeammateIdle、InstructionsLoaded、ConfigChange、CwdChanged、DirectoryAdded、FileChanged、WorktreeCreate/Remove、PreCompact/PostCompact、Elicitation(+Result)。
- **stop ≠ idle 消歧（官方）**：Stop payload 带 `stop_hook_active`（hook 续命标记，连 block 8 次强制收尾）、`background_tasks[]`、`session_crons[]`（官方明示用于区分「真结束」vs「暂停等后台」）、`last_assistant_message`。
- **官方明示的坑：用户 Esc/Ctrl+C 中断不触发 Stop**（"Does not run if the stoppage occurred due to a user interrupt"）——中断只能靠 SDK `aborted:true`/UI 层。
- attention：`PermissionRequest`（decision: allow/deny + updatedInput/updatedPermissions/interrupt）、`Notification` matcher `permission_prompt`（权限框 ~6s）/`idle_prompt`（回复完 ~60s 无打字）/`elicitation_*`/`agent_needs_input`/`agent_completed`；SDK `canUseTool` 挂起（不超时）。
- 排队语义：工具调用间到达的消息同回合消化（无新回合边界）；回合末排队消息成为下一回合；Esc 立即放行队列。hook 层读不到队列。
- 子代理：SubagentStart/Stop 带 `agent_id/agent_type/agent_transcript_path`；SDK `parent_tool_use_id`；subagentStatusLine 一次给全部子代理状态行。
- 终端 OSC：Claude 自身发 **OSC 9;4 任务栏进度**（busy↔idle 原生信号，Ghostty≥1.2 消费，默认开）；hook 可代发 `terminalSequence`（白名单 OSC 0/1/2/9/99/777+BEL，**明确排除 133**——反证 Claude 不发 shell-integration 序列）。
- 本机佐证：claude 2.1.241 二进制 strings 命中全部 hook 名与 `stop_hook_active` 官方提示文案。

#### Cursor（hooks.json + CLI stream-json）

- 事件：sessionStart/sessionEnd(reason: completed|aborted|error|window_close|user_close)、beforeSubmitPrompt、pre/postToolUse、postToolUseFailure(failure_type: error|timeout|permission_denied + **is_interrupt**)、before/afterShellExecution、before/afterMCPExecution、beforeReadFile/afterFileEdit、subagentStart/Stop(status + summary + modified_files)、preCompact、afterAgentResponse/Thought、stop(status: completed|aborted|error + **loop_count**)。
- **stop ≠ idle 消歧（官方一级语义）**：`stop`/`subagentStop` 输出 `followup_message` 会被自动作为下一条用户消息提交；`loop_limit` 默认 5。**因此 stop ≠ idle 是 Cursor 的官方设计**。
- 归属：`conversation_id`（跨 turn）+ `generation_id`（每条用户消息）双层；subagentStart 带 `parent_conversation_id/is_parallel_worker/git_branch`。
- 缺口：**无权限等待专事件**（`permission:"ask"` schema 接受但 preToolUse 不执行）——attention 只能宿主合成。
- CLI：`--output-format json|stream-json`（system/init、user、assistant、tool_call started/completed、result）；headless 无审批流。
- Pier 现状：cursor.ts 消费 stop.status 三态分发 trusted 终态；未装 followup 返回（无 hook 驱动的静默续跑）；**Cursor TUI 自身 auto-continue 是否触发新 beforeSubmitPrompt 未验证**。

#### OpenAI Codex CLI（notify + exec JSONL + hooks + app-server 四层）

- notify：仅 `agent-turn-complete`（thread-id/turn-id/input-messages/last-assistant-message）；项目级 config 忽略 notify。
- exec `--json`：`thread.started→turn.started→item.started/completed×N→turn.completed|turn.failed|error`；item 类型 agent_message/reasoning/command_execution/file_change/mcp_tool_call/web_search/plan；审批在非交互模式无事件。
- hooks（Claude Code 兼容形状，11 事件）：SessionStart/SessionEnd(仅 other)/UserPromptSubmit(turn_id)/PreToolUse/PermissionRequest（审批前，可免弹窗）/PostToolUse/PreCompact/PostCompact/SubagentStart/SubagentStop/Stop(`stop_hook_active`；decision:block → reason 作为新提示自动续跑)。
- app-server：`thread.status: notLoaded|idle|systemError|active{activeFlags:["waitingOnApproval"]}`；`turn/steer`、`turn/interrupt`；item 级 requestApproval RPC 族；`collabToolCall(senderThreadId,receiverThreadId)` 多代理互调；`thread/list.sourceKinds` 含 subAgent* 七种。
- Pier 现状：codex.ts 用 hooks + transcript 对账补 task_complete→TurnCompleted、turn_aborted→TurnInterrupted；**未消费 stop_hook_active**（核对项）。

#### omp / pi（扩展 API）

- omp：`session_start/before_agent_start/tool_execution_start(.ask)/tool_execution_end(.ask)/tool_approval_requested/resolved/agent_end/session_stop/session_shutdown` + `agent_start`；`agent_end.willContinue` 仅覆盖 auto-retry/empty-stop 续跑（上游 AgentEndEvent 文档）；**静默续跑三路径**：abort 后 steer/follow-up drain（`#drainStrandedQueuedMessages`）、IRC peer 唤醒（`#resumeStrandedIrcAsides`）、后台任务让位（`agent_end` stopReason=`toolUse`）——均不发 `before_agent_start`。
- pi（上游）：事件更少，`agent_settled`→advisory Stop（天然无封账假 idle，代价是 settle 后无「等待输入」文案）。
- Warp 集成（本机 omp 源码 `modes/warp-events.ts`）：OSC 777 `warp://cli-agent` 推 `session_start/prompt_submit/permission_request/permission_replied/question_asked/tool_complete/stop/stop_failure`，attention 集 = {stop, stop_failure, permission_request, question_asked}；`tool_complete` 的官方注释即「把 Blocked 翻回 Running」——与 Pier ToolComplete→processing 同构。
#### 其它（hooks 兼容族）

- Gemini CLI：hooks（BeforeTool/AfterTool/BeforeAgent/AfterAgent/BeforeModel/AfterModel/BeforeToolSelection/SessionStart/SessionEnd(reason: exit|clear|logout|prompt_input_exit|other)/Notification(ToolPermission)/PreCompress）；**子代理 hook 未实现**（官方 issue #18278，P3）；实验性 ACP。
- Goose：Open Plugins hooks（SessionStart/SessionEnd/Stop(可 block 续跑，GOOSE_STOP_HOOK_BLOCK_CAP)/UserPromptSubmit/PreToolUse(+Result)/PostToolUse(+Failure)/BeforeReadFile/AfterFileEdit/Before/AfterShellExecution）+ `goose acp` ACP server。
- Cline：SDK 三层事件（run-started/finished、turn-*、tool-started/updated/finished、ended{finishReason: completed|max_iterations|aborted|mistake_limit|error}、team_progress）+ CLI `--json` + `--acp`。
- RooCode：2026-05-15 关停，不适配。

### 2.4 D 类：抓屏/轮询（反面教材）

- claude-squad：tmux capture-pane + 内容 hash 变化 = updated；attention 靠**硬编码审批文案**（"No, and tell Claude what to do differently" 等）；autoyes 直接写 `\r`。
- Conductor：REST 轮询 `sessions/{id}/status → idle|working|errored`，官方 cookbook 明确要求「**wait for working before trusting idle**」（排队期误报 idle）——与 Pier advisory→trusted 双轨意图相同。
- 结论：Pier 的 transcript 对账 + hooks 管线严格优于该类；不采纳。

### 2.5 终端通用层（OSC）

- **OSC 133**（FinalTerm；iTerm2/Kitty/Ghostty/WezTerm 消费）：A(prompt 起)/B(命令起)/C(输出起)/D(结束，带 exit；**B 后无 C 收 D = abort**，无参合法)。扩展提案（freedesktop semantic-prompts）：`aid=`（应用标识配对闭合）、`err=`（REPL 错误码）、`N/I/L/P` 序列；Ghostty 1.3 实现 `cl=` 点击回传 + `notify-on-command-finish`。
- **根本局限**：agent 这类长输出进程期间无 D，终端只能停在 busy；waiting/attention 无法表达——Warp 777 / iTerm2 1337;RequestAttention 存在的根本原因。嵌套场景（shell 里跑 agent）内层标记污染外层，`aid` 提案主流终端不消费。
- iTerm2 私有：OSC 9（通知）、OSC 9;4（进度条：st 0 清除/1 进行/2 错误/3 不确定/4 警告）、OSC 1337;RequestAttention（dock 弹跳）、1337;SetUserVar（base64 变量上报）。
- VS Code：OSC 633（A/B/E+nonce/C/D/P;Cwd=/F/G/Env 系列；nonce 防伪造）；扩展 API onDidStart/EndTerminalShellExecution；无 agent 会话语义。
- Kitty：OSC 99（自有通知协议）；Ghostty：OSC 9/9;4/133（1.3 完整化）。两家都无 agent 级词汇。
- Pier 现状：command 层已消费 OSC 133 C/D 作 shell 命令层；agent 层不依赖 133（正确——业界共识 133 表达不了 agent 状态）。

## 3. Pier 现状逐项对照

| # | 业界机制 | Pier 现状 | 判定 |
|---|---|---|---|
| 1 | stop≠idle 消歧：Cursor followup/loop_count、Codex/Claude stop_hook_active、omp willContinue | omp：agent_start 重开 + toolUse→processing（gen 12）✅；claude：Stop advisory + idle_prompt→trusted ✅（有意设计，60s 延迟换不谎报）；cursor：无原生自动续跑（bundle 证据）✅；codex：advisory + turn_id 认账 ✅；amp：agent.start 重开 ✅；copilot：stop_hook_active→Stop ✅；aug：已降级 advisory ✅ | 对齐 |
| 2 | attention 显式事件（PermissionRequest/permission.updated/waitingOnApproval） | Pier `InteractionRequested`→waiting 五态齐备；claude/codex/omp/opencode 有源事件；**cursor 无源事件（provider 缺口）**；kimi/qodercli 等待核对 | 部分 |
| 3 | 中断表达（aborted 落 ready；ACP「取消必须落终态」） | TurnInterrupted→ready ✅；claude「中断不发 Stop」由 transcript 对账（claude-style-interrupt.ts）补 ✅ | 对齐 |
| 4 | 子代理归属（agent_id/parent_id/parent_tool_use_id） | isSubagentHookEvent 单一判据（SubagentStart/Stop + actorHint + parentSessionId）；omp 无子代理事件 → sessionId 分 scope（本次实证可用）✅ | 对齐 |
| 5 | 多会话/多代理同面板（scope 归属） | session:/process:/panel 三级 scope + 状态优先级投影；omp 四进程同面板实证 ✅ | 对齐 |
| 6 | turn 身份（conversation_id+generation_id / turn_id） | claimed-turns 按 turnId 认账；omp 无 turnId → 认账失效（本次 bug 放大器）⚠️ provider 侧无解，靠 agent_start 重开兜底 | 部分 |
| 7 | 官方状态枚举直读（Codex thread.status / OpenCode session.status） | 未消费；hooks 管线为主。评估项，非缺口 | 待决策 |
| 8 | 终端 OSC 兜底（Claude 自发 OSC 9;4 进度；OSC 133 命令层） | command 层已用 133；agent 层 133 无法表达 waiting（业界共识）；OSC 9;4 未消费（Ghostty 消费，Pier native 可读，评估项） | 待决策 |
| 9 | 「wait for working before trusting idle」（Conductor） | advisory Stop（completionObserved）+ trusted 双轨 + agent_start 重开 ✅ | 对齐 |
| 10 | 轨迹回归（真实事件序列 fixture） | status-traces harness 已有；omp 事故序列已固化（B1）✅；aug 解冻回归已固化 ✅；mimo-code 留一条真实轨迹（B7） | 部分 |
| 11 | 抓屏/轮询 | 不采纳（transcript 对账严格更优）✅ | 决策 |
| 12 | ACP 宿主化 | 不适用（Pier 非 host-driven 形态）；omp/cursor 等自带 ACP 面是它们服务别的宿主用的 | 决策 |

## 4. 对齐清单（按优先级可执行）

### P0 已完成（gen 12）

- [x] A1 omp：订阅 `agent_start` → processing + `turnStartAuthority:"authoritative"`（封账 scope 重开）。
- [x] A2 omp：`agent_end` stopReason=`toolUse` → `agent_end.toolUseDeferred`→processing，不落 TurnCompleted。
- [x] A3 omp：`agent_end.willContinue` 声明 authoritative（TTSR abort 续命场景）。
- [x] A4 世代 bump 11→12 + 行为测试（abort 续跑 / toolUse 让位，走真实聚合器断言）。

### P1 已执行（2026-08-25 同日）

- [x] B1 **omp 事故轨迹 fixture**：`extension-plugin-traces.ts` ompActions 增补事故序列（TurnInterrupted 封账 → `agent_start` 续跑重开 → tool → `agent_end.toolUseDeferred` 保持 processing → TurnCompleted 收口）；矩阵行同步新映射（治理测试「矩阵 facts 与 runtime mappings 严格等集」锁定）。
- [x] B2 **codex**：结论「无需消费 stop_hook_active」——hook Stop 是 advisory（不封账）；trusted 终态只来自 transcript 对账，而对账事件携带 `turn_id`，续跑回合的新 turn_id 走 `canAdoptUnsettledTurn` 认账重开，冻结结构性不可达。结论沉淀在 codex.ts 头注释。
- [x] B3 **amp**：结论「结构性安全」——续跑（SDK continue / 新 execute）必经 `agent.start`→PromptSubmit 重开；`steer:true` 是忙时插队（run 内，无 agent.end）；官方 `thread.state.*` 已全量消费（含 awaiting-approval→waiting）。结论沉淀在 amp.ts 头注释。
- [x] B4 **cursor**：结论「无原生自动续跑」（一手 bundle 证据 cursor-agent 2026.08.11）——`followup_message` 只从 hook 响应消费，`{decision:"block",reason}` shim 也转 followup；`loop_limit` 是 per-hook 配置。Pier hook 发完即退 → `stop` 即真停，trusted TurnCompleted 诚实。结论沉淀在 cursor.ts。
- [x] B5 **逐家核查**（trusted 终态来源 × 重开路径）：
  - copilot：已实现 `agentStop.stop_hook_active=true→Stop` 消歧（业界正确姿势范本）✅
  - hermes：`pre_llm_call→PromptSubmit` 每次 LLM 调用重开 ✅
  - cline：TaskComplete trusted + TaskStart authoritative 重开 ✅
  - kimi/qodercli/codebuddy：trusted 仅注释，实际 advisory/对账 ✅
  - grok/droid/devin/gemini/goose/opencode/kilo/kiro/crush：无 trusted 终态 ✅
  - **aug：发现同类冻结 bug 并已修复**——官方 hook 面无任何 per-turn 信号，`Stop(interrupted|max_iterations)`→trusted TurnInterrupted 封账后同会话整轮工具事件被 sealed-turn 拒绝；已降级为 advisory `Stop`（矩阵 ready/interrupted → host-Esc reconciled，fixture 增补「解冻后同会话继续工作」回归动作）。
  - mimo-code：authoritative trusted（`session.post=completed`）+ `chat.message→PromptSubmit` 重开；opencode 语义下每条用户消息触发 chat.message，残余风险低；**留一条真实轨迹验证**（下批）。
- [x] B6 **claude idle_prompt**：确认为有意设计——Stop advisory（Claude 有 stop_hook_active 续命 + 排队语义），`idle_prompt`（60s 无打字）才是 trusted ready 主路径；claude.ts 注释已完整记录，无需改动。

### P1 残留（下批）

- [ ] B7 mimo-code 真实轨迹一条（session.post=completed 后是否有无 chat.message 的续跑）。
- [ ] B8 host-Esc 乐观 TurnInterrupted 的封账窗口：所有 agent 在 Esc 后若 provider 未真停，工具事件被拒至下一 prompt 事件（产品「乐观 ready」决策的已知代价，omp 现由 agent_start 兜底；其余 agent 维持现状）。

### P2 结构性增强（需小决策）

- [ ] C1 **OSC 9;4 进度信号消费评估**：Claude Code 默认发任务栏进度（OSC 9;4，Ghostty 消费）。Pier native（GhosttyBridge）若能上报该序列到 FA，可作为 claude busy/idle 的免 hook 兜底与交叉验证源。成本：native 层序列拦截 + 归属（当前面板）。
- [ ] C2 **官方枚举直读（opencode SSE / codex app-server）**：仅在对应 agent 用户已开 server/连接时作为增强置信源；不做主路径（连接管理成本 > 收益，符合最小封装哲学）。
- [ ] C3 **Pier OSC sentinel 通道（Warp 模式）评估**：`OSC 777;notify;pier://agent` 结构化事件作为扩展未安装时的免安装兜底。注意：OSC 通道无 panelId，归属靠「当前聚焦面板」推断，弱于现有 JSONL（env 注入 panelId）；仅当扩展管线失效时有价值。

### P3 明确决策（不做，记录理由）

- [x] D1 ACP 宿主化：不适用——Pier 是旁观者不是 driver；agent 自带 ACP 面服务的是 Zed 类宿主。
- [x] D2 抓屏/轮询/硬编码文案：不采纳（claude-squad 模式脆弱；transcript 对账严格更优）。
- [x] D3 RooCode 适配：已关停（2026-05-15）。
- [x] D4 OSC 133 作为 agent 状态源：不采纳——业界共识 133 只有命令级语义，agent 长输出无 D。

## 5. 五态映射对照总表

| Pier 五态 | ACP | Codex app-server | OpenCode | Claude hooks | Cursor hooks | omp 扩展 | OSC 133 |
|---|---|---|---|---|---|---|---|
| processing | prompt 在途 | status=active（flags 空） | session.status=busy | UserPromptSubmit..Stop 区间 | beforeSubmitPrompt..stop | agent_start/PromptSubmit..agent_end | B..C(D) |
| tool | tool_call in_progress | item.started | part tool state | PreToolUse..PostToolUse | preToolUse..postToolUse | tool_execution_start..end | — |
| waiting | request_permission 挂起 | activeFlags:[waitingOnApproval] | permission.updated | PermissionRequest/canUseTool | ❌ 无源事件 | tool_execution_start.ask/tool_approval_* | — |
| ready | 响应 stopReason=end_turn | status=idle | session.status=idle | Stop 且 background_tasks 空（中断不发 Stop！） | stop(completed) | agent_end(stop)（静默续跑由 agent_start 重开） | D;0 |
| error | stopReason=refusal 等 | status=systemError/turn failed | session.error | StopFailure | stop(error)/sessionEnd(error) | agent_end(error) | D;非零 |

## 6. 来源索引

- Claude Code：code.claude.com/docs/en/{hooks,hooks-guide,statusline,vs-code,agent-sdk/typescript,interactive-mode,settings-reference,terminal-config}
- Cursor：cursor.com/docs/{hooks,reference/third-party-hooks,cli/overview,cli/headless,cli/reference/output-format,cli/acp}
- Codex：learn.chatgpt.com/docs/{notifications,hooks,app-server,non-interactive-mode,config-file/config-reference}；github.com/openai/codex（hooks schema、app-server 源码）
- ACP：agentclientprotocol.com/protocol/v1/{overview,prompt-turn,tool-calls,schema}；github.com/zed-industries/{claude-agent-acp,codex-acp}
- AG-UI：docs.ag-ui.com/concepts/{events,interrupts}
- MCP：modelcontextprotocol.io/specification/{2025-06-18,2026-07-28}；extensions/tasks（SEP-1686）
- OpenCode：opencode.ai/docs/{server,sdk}；Gemini CLI：github.com/google-gemini/gemini-cli docs/hooks + issues #17760/#18278；Goose：goose-docs.ai + open-plugins.com；Amp：ampcode.com/manual/{cli-streaming-json,appendix/stream-json-output}；Cline：docs.cline.bot/cline-sdk
- 终端：iterm2.com/documentation-{escape-codes,shell-integration}.html；gitlab.freedesktop.org/Per_Bothner/specifications（semantic-prompts）；sw.kovidgoyal.net/kitty/{shell-integration,desktop-notifications}；ghostty.org/docs（1.3 release notes/VT reference）；wezterm.org/shell-integration；code.visualstudio.com/docs/terminal/shell-integration
- Warp：github.com/warpdotdev/{claude-code-warp,opencode-warp}；docs.warp.dev/agents/{cli-agents/overview,capabilities/agent-notifications}
- 编排工具：github.com/smtg-ai/claude-squad；conductor.build/docs/api；github.com/BloopAI/vibe-kanban
- 本机一手：omp 18.0.4 源码（modes/warp-events.ts、modes/acp/acp-agent.ts、session/agent-session.ts）；claude 2.1.241 二进制 strings；pi.ts/omp.ts Pier 集成注释
