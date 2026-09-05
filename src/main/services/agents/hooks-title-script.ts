/**
 * hooks 命令 + 共享运行时世代（只增不减）。
 * 2 = PromptSubmit 命名所需的 prompt → promptSnippet。
 * 3 = 世代标记改为赋值（禁止 `#` 注释，避免 `;` 拼接后整行被注释掉）。
 * 4 = stdin 身份字段补 camelCase（toolUseId / toolName / turnId / agentId /
 *     agentType / transcriptPath）；Grok 等 provider 官方 envelope 为 camelCase。
 * 5 = 全局 hooks 命令去掉 process.execPath 内联 fallback；只引用
 *     `${PIER_AGENT_HOOKS_DIR}/…`。共享运行时迁入 `~/.pier/hooks/vN`，
 *     只允许更高（或相等刷新）世代写入；旧客户端不得降级。
 * 6 = extract 改为 `#!/usr/bin/env node` 纯脚本，运行时不再绑定
 *     Electron 绝对路径（金标准：同 gen 多实例零路径互盖）。
 * 7–10 = 历史 derive 标题脚本世代（已下线，见 gen 11）。
 * 11 = 下线 derive-claude-session-title 双写；UserPromptSubmit 只 emit；
 *     终端 tab 标题主权归 OSC 0/2；产品 sessionTitle 仅 provider|user。
 * 12 = omp 扩展诚实化：订阅 agent_start（turnStartAuthority=authoritative，
 *     重开 abort/stop 后静默续跑封账的 scope）；agent_end stopReason=toolUse
 *     （后台工具让位）落 processing 不落 TurnCompleted。
 * 13 = hook helper 改由显式 node/sh 解释器读取；不再直接执行带 macOS
 *     provenance 的脚本，避免 Gatekeeper 检查异常拖到 provider timeout。
 * 14 = emit 等锁超时降级无锁 append；cursor Task 按 Subagent 分发；
 *     claude 命令加 CURSOR_VERSION 跳过守卫。
 * 15 = emit 等锁超时先回收已死锁主再降级无锁 append（活着的 rotation
 *     仍可能重叠，不保证原子）；JS/Python writer 超时仍写出。
 * 16 = v3 emit 附带 emit 进程控制终端（`"tty"`）：甄别从 Pier 终端启动、
 *     继承 PIER_* env 的 GUI 进程树（`cursor .` 开 IDE 后 IDE 内 agent
 *     触发共享 hook）冒充面板事件；判定在消费端（tty ≠ 面板 PTY 且未
 *     点亮该 agent 才拒），脚本侧只采集不拒发。
 * 17 = droid 官方 Stop 是回合可信终态（主 agent 完成回复；取消不发 Stop
 *     只发 Notification），pierEvent `Stop→TurnCompleted`——advisory
 *     候选让 droid 永远到不了 ready，turn-finished 通知与 Index ready
 *     桶失效。
 */
export const PIER_HOOK_COMMAND_GENERATION = 17;
