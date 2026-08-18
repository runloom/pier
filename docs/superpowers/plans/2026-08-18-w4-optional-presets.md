# W4 可选预设（默认关）

> **For agentic workers:** 在 W3 适配器金路径之上加预设糖。禁止改金标准 spec 正文。禁止 commit。失败不得阻断启动。

**Goal:** 金标准 §7.5 / §8 / §12 预设。用户不勾选时，启动 Claude / OpenCode **不得**带 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、`--teammate-mode`、`OPENCODE_CONFIG_DIR`、`--port 4096`。勾选后 T1 额外注入；写 shadow 失败仍保留适配器 PATH 前插。

## 锁什么

| 项 | 做法 |
|---|---|
| 默认关 | `pier.tmux.preset.claudeTeams` / `pier.tmux.preset.opencodeOmo` default **false** |
| 只在适配器已开且该 agent 勾选时生效 | 复用 W3 wrap 判定后再加糖 |
| 不写用户家目录 | omo 只写 `{workDir}/omo-config/` |
| 失败不阻断 | try/catch，返回无预设的 adapter wrap |
| locale | 禁止 teams / omo / TMUX / shim / PATH；中文用「多智能体会话」「oh-my-openagent 分屏」 |

## Claude Teams

- env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- command 尚无 `--teammate-mode` 时追加 `--teammate-mode auto`

## OpenCode / omo

- `{workDir}/omo-config/opencode.json`：`plugin` 含 `oh-my-openagent`
- `{workDir}/omo-config/oh-my-openagent.jsonc`（及 legacy `oh-my-opencode.jsonc`）：`team_mode.enabled` + `tmux_visualization`
- `OPENCODE_CONFIG_DIR` 指向 shadow
- 未指定 `--port` 时追加 `--port 4096` + `OPENCODE_PORT=4096`

设置页：即时偏好、垂直 Field、无 footer；总开关关时 extras 开关 disabled。
