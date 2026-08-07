# Pier CLI 多智能体体验补丁实施计划（方案 v2）

> **版本：** v2（吸收 Codex「有条件采纳」审查）  
> **权威展示：** `.pier/canvases/multi-agent-orchestration-gold/` →「CLI 体验」页（`data.json`：`outputPolicy` / `waitSemantics` / `uxPatch`）  
> **工作区：** 当前 worktree（`feature-comment-support`）  
> **执行要求：** 每任务先写失败测试 → 实现 → 指定命令绿；未经用户确认不 commit。

---

## 0. 相对 v1 的收敛点（Codex → 方案）

| Codex 意见 | v2 落地 |
|---|---|
| 输出无总政策 | `outputPolicy` + **C0** + **U1** |
| window 非一等公民 | 摘要强制 `window=`；**C10** + **U2** |
| 双 wait 只在超时教人 | `waitSemantics` 进 help/docs；**U3** 提前教育 |
| U6 只定义不给下一步 | **可执行配方** `next: pier terminal screen/read …` |
| U7 心跳格式摇摆 | 固定 **`pier:heartbeat elapsed=… command=…`** |
| blocker：方案未落地 | **U8** 含 parser/usage/docs 契约切片回归 |

**总判定（方案层）：** 纪律正确 → **采纳**；实现须完成 U1–U8 后才能宣称最佳实践落地。

---

## 1. 输出总政策（强制）

| 类型 | 命令 | 无 `--json` | `--json` |
|---|---|---|---|
| **会话 / 观察** | `agents catalog\|list\|status\|start\|wait`；`terminal list\|show\|screen\|read` | stdout 短摘要或表；**含 window（有则必出）** | stdout **仅** envelope |
| **动作** | `agents focus`；`terminal send\|key\|interrupt\|close`；`panels focus` | 成功静默；失败 stderr `code: message` | 仅 envelope |
| **长等待进度** | `agents wait`；`terminal wait` | stderr：`pier:heartbeat elapsed=<ms> command=<type>` | **默认无心跳** |

禁止：摘要 / hint / heartbeat 写入 `--json` 的 stdout。

---

## 2. 两个 wait（须进 help，不能只靠超时）

| 命令 | 含义 | 不是 | 下一步 |
|---|---|---|---|
| `agents wait --until ready\|…` | FA/hook 语义 | 任务成功 / 最终答案 | `terminal screen` 或 `read` |
| `terminal wait --until output` | cursor 后新提交行 | agent ready | `terminal read --cursor` |
| `terminal wait --until quiet` | 一阵无变化 | ready / 完成 | `screen` 或 `agents wait` |
| `terminal wait --until exit` | childExited | 回合完成 | `show` / `screen` |

---

## 3. 目标与完成标准

### 目标

1. `start` 后可直接抄 `panel` / `window` / `ts` 接龙  
2. 第一次用就能分清两个 wait（help + docs，不只超时）  
3. 长 wait 有可过滤心跳  
4. 空态 / show 给出 **可执行下一步**  
5. 输出行为可预测（会话型 vs 动作型）

### 完成标准

| # | 标准 |
|---|---|
| C0 | 输出总政策有单测矩阵 |
| C1 | start：`started … panel=… window=… ts=…` |
| C2 | wait 成功：命中状态 + panel + window + ts |
| C3 | `wait_timeout` 含 last status + 下一步 hint |
| C4 | start 默认 CLI cwd；cwd/worktree 互斥 |
| C5 | list 空 → `pier agents catalog` |
| C6 | show 含 `next: pier terminal screen …` 与 read 配方 |
| C7 | `pier:heartbeat …` 仅 stderr；json 无心跳 |
| C8 | `docs/cli.md`：总政策 + 双 wait 表 + 黄金路径 |
| C9 | CLI 单测矩阵绿；不扩大 allowlist |
| C10 | 会话型输出稳定带 `windowId`（有则必出） |

### 非目标

- 写操作猜当前 panel  
- 合并 wait / screen·read  
- native / output-ledger  
- 内建编排、agents.read/transcript  

---

## 4. 实施 DAG

```text
波次 1                         波次 2                              波次 3
U1 format+输出总政策 ─────┬──→ U2 start 摘要(window) ──────┬──→ U8 docs+契约回归
U4 start 默认 cwd ────────┤    U3 wait+双wait 提前教育 ────┤
                          ├──→ U5 list 空态 ───────────────┤
                          ├──→ U6 show 可执行配方 ──────────┤
                          └──→ U7 pier:heartbeat ──────────┘
```

**关键路径：** `U1 → U2 → U3 → U8`

---

## 5. 任务（可验证）

### U1 — format 层 + 输出总政策

- 新建 `bin/pier-cli-format.js`（或等价），`pier.mjs` 只编排  
- 单测：`tests/unit/cli/output-policy.test.ts` + `human-format.test.ts`  
- **完成：** 会话型/动作型/`--json` 矩阵锁定  

### U2 — start 接龙摘要

```text
started <agentId> panel=<panelId> window=<windowId> ts=<ts>
```

- **完成：** 字段顺序固定；无 window 时不得静默省略（无则打印 `window=?` 或失败策略与实现一致并测死）

### U3 — wait 摘要 + 双 wait 提前教育

- 成功一行：`<status> panel=… window=… ts=…`  
- usage/help 含对照短文案（可测字符串）  
- timeout hint 含 `--after` / `--allow-current` / `terminal wait`  

### U4 — 默认 cwd

- 未传 `--cwd`/`--worktree` → `cwd=process.cwd()`  
- 同时传两者 → 失败  

### U5 — list 空态

```text
(no running agents)
hint: pier agents catalog
```

### U6 — show 可执行配方

```text
next: pier terminal screen <panelId>
next: pier terminal read <panelId> --cursor <outputCursor>
```

（无 cursor 时第二行写「先 show 取 outputCursor」）

### U7 — 固定心跳

```text
pier:heartbeat elapsed=15000 command=agents.wait
```

- 默认 interval 15s；可用 env 注入测试  
- `--json` 默认关闭心跳  

### U8 — docs + 契约切片回归

- 更新 `docs/cli.md`（总政策 + 双 wait + 黄金路径）  
- 若本仓 parser 仍无 `agents`/新 `terminal` 子命令：**同 PR 接上 usage/parser 最小切片**（Codex blocker），否则只做 format 无法宣称落地  
- Canvas `uxPatch.tasks[].status` 回写 `done`  

**验证命令矩阵：**

```bash
pnpm vitest run \
  tests/unit/cli/ \
  tests/unit/app-core/cli-bin.test.ts \
  tests/unit/app-core/cli-adapter.test.ts \
  tests/unit/shared/cli/
```

（路径按仓库实际存在文件调整。）

---

## 6. 任务状态板

| ID | 状态 |
|---|---|
| U1–U8 | pending（方案 v2 已收敛，待实现） |

---

## 7. 明确不要做

- Orca 式 task/mailbox/gate  
- quiet/标题 → ready  
- 写操作猜当前终端  
- agents.read/transcript  
- heartbeat 进 `--json` stdout  
- tmux session 树替换 panel/window  
