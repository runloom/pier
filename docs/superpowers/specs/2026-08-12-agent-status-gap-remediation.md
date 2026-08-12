# Agent 状态缺口修复结案（2026-08-12）

## 目标

修掉 Pier **能诚实修复**的状态洞（尤其 Esc/取消后卡「思考中」），对上游无可靠事实的维度保持 `unsupported`，不伪造 ready/error。

## 架构（最佳实践）

```text
用户发送 → hook PromptSubmit → processing
用户裸 Esc（终端 passthrough）
  ├─ Ghostty → agent TUI（进程侧取消）
  └─ host observe → pier.terminal.user_escape → TurnInterrupted（权威）
      → 底栏 ready；sealed-turn 防乱序 transcript 再抬状态

辅轨（可缺失、可晚到）
  ├─ provider hooks（Stop / idle_prompt / agentStop…）
  └─ transcript reconcilers（Ice / abort / turn_end…）
```

| 原则 | 落地 |
|------|------|
| UI 跟用户手势 | 忙态裸 Esc → 立即 ready，不依赖上游 Stop/Ice |
| 权威边界 | host Esc / 可信 transcript 终态 = authoritative；Claude Stop 仍 advisory |
| 不吞键 | Esc 仍 passthrough；搜索/composer allowlist Escape **不**观察取消 |
| 不改用户全局 Claude 阈值 | 不再写 `messageIdleNotifThresholdMs`；install 清除历史 800/2500 |
| 证据单一来源 | `host-terminal-escape` 由 `evidence/host-terminal-escape.ts` 合并进矩阵，不在 rows 粘贴 |
| 无证据不硬造 | gemini 等无 cancel 落盘则 completed 等维保持 unsupported |

**诚实边界**：Pier ready ≠ 保证 agent 进程已停模型；产品状态乐观对齐手势。

## 对账器覆盖（终态安全网）

| Agent | 路径 | 中断 | 完成 | 说明 |
|-------|------|------|------|------|
| claude | `~/.claude/projects/**/*.jsonl` + `Notification`/`idle_prompt` | `user_interrupt` + host Esc | `assistant_stop`；idle_prompt（默认 60s） | host Esc 主路径 |
| codex | `~/.codex/sessions/**` | `turn_aborted` + host Esc | `task_complete` | 既有 |
| grok | `~/.grok/sessions/**/updates.jsonl` | `cancelled` + host Esc | `end_turn` | 既有 |
| **qodercli** | `~/.qoder/projects/**/*.jsonl` | Claude 同款 + host Esc | — | Esc 常不发 Stop |
| **codebuddy** | `~/.codebuddy/projects/**/*.jsonl` | 同左 + host Esc | — | 同左 |
| **copilot** | `~/.copilot/session-state/<id>/events.jsonl` | abort 白名单 + host Esc | `assistant.turn_end` | reason 精确匹配 |
| **kimi** | `~/.kimi/sessions/*/*/wire.jsonl` | host Esc | `TurnEnd` | wire 无法区分取消 |

共享：`transcript/claude-style-interrupt.ts`、`projects-jsonl-path.ts`、`terminal-escape-cancel.ts`。

凡 **active 且 processing≠unsupported** 的 agent，矩阵自动挂 `host-terminal-escape`（见 `withHostTerminalEscapeEvidence`）。

## 诚实天花板（(C) 上游无磁盘/无事件 — 不硬造）

以下 active agent **本轮不新增**「上游 cancel 落盘」对账；矩阵 completed 等可仍 `unsupported`，但 **busy 时 host Esc 仍可 ready**：

| Agent | 原因 |
|-------|------|
| openclaude | 本机仅 settings，无 projects JSONL 语料 |
| qwen-code | 无可用 session 日志语料 |
| gemini | chats JSONL 无稳定取消/完成终态标记 |
| droid / goose / devin | session/hook 无可信 cancel 标记 |
| command-code / mistral-vibe / antigravity | 事件面极薄（矩阵已标） |
| waiting / subagent 大面积 unsupported | 缺 Request+Resolved 或子代理身份对，见矩阵 |

not-integrated / cleanup-only / retired：不装空 hook。

## 验收

- 单元：`agent-status-evidence-matrix` + 各 `transcript-reconciler` + `terminal-escape-cancel` + `agent-escape-cancel-register`
- 手测：发送 → Esc → 底栏离开「思考中」（主路径 host 裸 Esc；需新 native）
- 纪律：
  - abort ≠ error
  - Claude 允许 transcript `assistant.stop_reason` 终态 → `TurnCompleted`；Qoder/Codebuddy **仅** interrupt，不用 `end_turn` 伪造 completed
  - 取消主路径：`pier.terminal.user_escape`；allowlist Escape 不观察

## 相关代码

- `src/main/services/agents/terminal-escape-cancel.ts`
- `src/main/ipc/terminal/agent-escape-cancel.ts`
- `native/Sources/GhosttyBridge/GhosttyBridge.swift`（passthrough 才观察）
- `src/main/services/agents/integrations/terminal-reconciliation.ts`
- `src/main/services/agents/integrations/transcript/*`
- `src/main/services/agents/integrations/evidence/host-terminal-escape.ts`
- `src/main/services/agents/integrations/evidence/matrix*.ts`

一次性 expect 采集脚本已删除；结论见下文「远程/本机实采」。

---

## 远程空闲机 + 本机实采结案（2026-08-12）

### 远程 `pier-e2e`

| 步骤 | 结果 |
|------|------|
| SSH | 可达（x86_64 Mac） |
| 初始 CLI | **无** agent 二进制（仅 claude/codex/gemini 配置残片） |
| 安装 | npm 全局装上 gemini / droid / qodercli / codebuddy / claude / copilot |
| expect Esc 采集 | 进程 exit=0，但**多数未进入有效推理回合** |
| 产物 | 本地 `~/agent-cancel-*`（分析后归档结论） |

远程缺口：**无完整登录态 / API 可用态**，TUI expect 无法复现「思考中 + Esc」完整路径。  
**不作为 CI 回归。**

### 本机补充（有登录的 CLI）

| Agent | 操作 | 磁盘终态 | 结论 |
|-------|------|----------|------|
| **gemini** | 长 prompt + Esc | 无 cancel 字段 | **(C)** |
| **droid** / **goose** | 鉴权/密钥不足 | 无可用终态 | **(C)** |

### 仍依赖上游的 completed/cancel 落盘

`gemini, droid, goose, openclaude, qwen-code, command-code, mistral-vibe, antigravity, devin` 等 **completed** 仍可能 unsupported。  
**busy 时 Esc 清思考中**由 host 路径覆盖，不依赖上表落盘。

### 已对账安全网（可修面）

claude · codex · grok · qodercli · codebuddy · copilot · kimi（+ 全局 host Esc）
