# W5 fixture + 治理扫描

> **For agentic workers:** 锁金标准 §10 fixture 与治理。禁止改金标准 spec 正文。禁止 commit。

## Fixture（假 invoke，不起 Electron）

1. **Claude：** `split-window -t %0 -v -d` → `send-keys hello Enter` → `capture-pane -p` → `kill-pane`（剩余 1 pane 不 equalize）
2. **omo：** `-V`（不打 socket）→ `split-window -t %0 -P -F #{pane_id}` 打印 `%1` → 对 `%1` 再 `-v` → `resize-pane -x 30%` → `kill-pane` 后对剩余 sibling `panel.equalize`

## 治理

- `packages/plugin-tmux` locale 无 shim / PATH / TMUX / teams / omo / 选区 / Agent / worktree
- 插件源码不 import dockview，不出现 `pier.mjs` / `bin/pier`
- renderer 只注册 settings page
- `pier.claude` 无动词表（无 `split-window` / `capture-pane` / `TMUX_PANE`）
- 宿主 TMUX API governance 继续绿
- 适配器默认开、预设默认关
