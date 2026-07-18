# 智能体会话重进恢复

日期：2026-07-18  
状态：待审查  
范围：**全部**已接入 Pier 的智能体（不单 omp）

## 0. 历史：已有实现

| 提交 | 内容 |
|---|---|
| **`#65` / `3f36cd2e`** | 全 agent 恢复骨架：`resume.sessionId` 落盘、`AGENT_RESUME_ADAPTERS`、`resolveAgentResumeLaunch`、running 才 create、exited 才结果卡 |
| **`9c29041c`** | omp / pi 的 sessionId 从 `sessionManager` 补读（事件体常只有 `{type}`） |

当前问题是 **关窗把 `running` 误标 `exited` 的回归**，不是从零做恢复。

## 1. 问题

关窗再进 → `Status exited` 静态卡，未 resume。

链路：关窗拆 PTY → `command_finished` / 进程死亡 / `SessionEnd` 写 `exited` → 重进不 create。

## 2. 金标准

> **会话属于各 agent 自己。** Pier 只存恢复索引；重进走该 agent 的 resume 协议；不支持或无 id 则打开该智能体界面。关窗可拆 PTY，不得把可恢复会话标终态。

对 **每一种** agent 同一套宿主策略；差异只在 adapter / 能否拿到 sessionId。

## 3. Agent 覆盖（#65 已表）

**支持 session resume（有 adapter）：**

| 家族 | agent | 命令形态（示意） |
|---|---|---|
| flag `--resume` | claude, codebuddy, gemini, omp, openclaude, pi, qodercli | `… --resume <id>` |
| codex | codex | `codex … resume <id>` |
| opencode 系 | opencode, kilo, mimo-code | `… --session <id>` |
| 其他 | amp, kiro | `continue <id>` / `--resume-id <id>` |

**暂不支持 resume（`unsupported`）：**  
aider, ante, antigravity, aug, autohand, cline, codebuff, command-code, continue, copilot, crush, cursor, devin, droid, goose, grok, hermes, kimi, mistral-vibe, openclaw, qwen-code, rovo 等。

- 支持者：有 id → resume；无 id → **原始 launch 打开该智能体**  
- 不支持者：一律 **原始 launch 打开该智能体**（诚实说明，不装 resume）  
- 关窗误标 `exited` 的修复对 **所有** agent 一视同仁  

新增 agent：在 `AGENT_RESUME_ADAPTERS` 补一条；宿主关窗/重进逻辑不改。

## 4. 语义

### 关闭

| 动作 | 磁盘 | 进程 |
|---|---|---|
| 关 tab | 删 session | 拆 PTY |
| 关窗 / 退出 | 保持 `running` + `resume` | 尽量正常结束 → 超时硬拆；**禁止**因此写 `exited` |
| 窗内自退出 | `exited` | 终态卡 + 重新启动 |

### 重进（同 `windowRecordId`）

```text
running + sessionId + adapter 支持 → 该 agent 的 resume 命令
running 且 (无 id | unsupported | 失败) → 原始 launch 打开该智能体 + 说明
exited → 终态卡 + 重新启动
无 agent → 普通 shell
```

## 5. 实现要点

**关窗顺序：** flush → `armDetaching(electronId+recordId)` → 可选有界结束 → 保留 running/resume → detachWindow → FA 清 → disarm  

- quit 每窗同样 arm；reload / 关 tab 不 arm  
- 抑制：所有 agent 的 `command_finished` / `process-closed` / `SessionEnd` → exited  
- 悬挂码 145–148 与 FA 共用  

**重进：**

- resume argv **只**用于本次 create，不写回持久 `launch`  
- restore 失败禁止 `clearTerminalPanelAgent`  
- exited：显式 `skipNativeCreate`；重启 IPC 带原始 `{agentId,command,cwd}`  

**sessionId：** 运行中 hook 写盘；omp/pi 走 sessionManager；其它靠既有 hook 载荷。关窗时再问不可靠。

## 6. 验收

| # | 标准 |
|---|---|
| R1 | 任意 running agent 关窗后仍 `running`，已有 sessionId 保留 |
| R2 | 支持 resume 且有 id → create 为对应 adapter 命令（抽测 claude/codex/omp/opencode/pi） |
| R3 | 无 id 或 unsupported → 原始 launch，**不是** exited 卡 |
| R4 | 窗内自退出 → exited 卡 |
| R5 | 终态重启用原始 launch、清旧 resume |
| R6 | detaching 内不写 exited |
| R7 | restore create 失败保留元数据 |

手工：至少 omp + 另一支持者（如 claude/codex）+ 一 unsupported：关窗再进路径符合上表。

## 7. 切片

1. **S0** detaching 抑制 + 悬挂码（全 agent）  
2. **S1** flush + detachAgents + quit  
3. **S2** persist 合并 / 失败不清 / launch 不写 resume argv  
4. **S3** UI：skipNativeCreate、文案、重启 IPC  
5. **S4** 有界结束 + 无主 GC + 多 agent 测  

先 S0。

## 8. 锚点

- 全表 adapter：`agent-resume-adapters.ts`（`#65`）  
- create：`terminal-create-handler.ts` / `terminal-create-launch.ts`  
- sessionId：`foreground-activity.ts`；omp/pi：`integrations/omp.ts` / `pi.ts`  
- 误标：`terminal-task-lifecycle-wiring.ts`  
- 关窗：`window-manager.ts` / `window-service.ts`  
- UI：`terminal-restored-result-view.tsx`  

## 9. 验收句

支持 resume 且已有 sessionId 的智能体（含 omp/claude/codex/…）：关窗再进应走该 agent 的 resume；无 id 或不支持 resume：打开该智能体界面，而不是 `Status exited`。
