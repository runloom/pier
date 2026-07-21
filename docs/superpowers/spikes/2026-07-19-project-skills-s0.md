# 项目技能 S0：官方发现事实与探测基线

> 日期：2026-07-19  
> 对应设计：`docs/superpowers/specs/2026-07-14-project-skills-management-design.md` §2.1、§5（`ManagedAgentLaunchGate`）、§9 S0  
> 探测入口：`scripts/project-skills/probe-agent-skills.mjs`

本文件固化 Codex / Claude Code / Cursor / OpenCode 的项目级技能发现路径、符号链接（symlink）假设、重复发现（`duplicate-discovery`）语义，以及受管启动门 `ManagedAgentLaunchGate` 的 S0 证据边界。适配能力必须同时具备官方文档与版本化本机探测，不得从第三方管理器路径表推断，也不得在界面硬编码为健康。

## 1. 官方发现路径（设计 §2.1）

核验日期：2026-07-19。

| 智能体 | 已确认的项目发现路径 | 重要行为 | v1 决策 |
| --- | --- | --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md` | 从当前目录向仓库根扫描；支持技能目录符号链接；同名技能不会合并为单一条目，选择器中可同时出现；自动检测变化，必要时需重启 | 默认项目投影 |
| Claude Code | `.claude/skills/<name>/SKILL.md` | 官方支持技能目录符号链接；监听既有技能目录变化；会话启动时目录尚不存在则需重启；已调用内容保留在会话中。嵌套同名技能的限定名行为与 `v2.1.203+` 相关，**符号链接最低版本以本机探测为准**，不把该版本号直接写成官方符号链接门槛 | 显式开启 Claude 适配 |
| OpenCode | `.agents/skills`、`.claude/skills`、`.opencode/skills` | 同时扫描多个兼容路径；要求技能名唯一 | 开启 Claude 适配时检查重复发现 |
| Cursor | `.agents/skills`、`.cursor/skills`；兼容 `.claude/skills`、`.codex/skills` | 编辑器、CLI 和远程运行形态的发现与注入行为需按版本探测；开启 Claude 投影后也可能重复发现 | v1 不创建额外 `.cursor/skills` 投影；`.agents` 探测不通过时报告不支持；重复发现检查覆盖 Cursor |

官方依据：

- [Codex Skills](https://developers.openai.com/codex/skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Cursor Skills](https://cursor.com/docs/skills)
- [OpenCode Skills](https://opencode.ai/docs/skills)
- [Agent Skills 规范](https://agentskills.io/specification)

## 2. 本机 CLI 探测（允许缺装 skip）

运行：

```bash
node scripts/project-skills/probe-agent-skills.mjs
node scripts/project-skills/probe-agent-skills.mjs --json
```

脚本行为：

1. 对 `codex` / `claude` / `cursor`（及 `cursor-agent`）/ `opencode` 执行 `which` 与版本命令。
2. 未安装的二进制标记为 `skipped`，不导致整次探测失败。
3. 在临时目录创建「库目录 + `.agents/skills/<id>` 相对目录符号链接」fixture，记录链接是否相对、是否可 `realpath` 回到库、`SKILL.md` 是否经链接可读。
4. 打印 `ManagedAgentLaunchGate` 边界说明（启动门实现本身不在本 Task 范围）。

本机抽样（工作站探测，非 CI 承诺）：

| 智能体 | 二进制 | 版本输出摘要 |
| --- | --- | --- |
| Codex | `codex` | `codex-cli 0.144.4` |
| Claude Code | `claude` | `2.1.207 (Claude Code)` |
| Cursor | `cursor` | `3.2.16` |
| OpenCode | `opencode` | `1.18.1` |

CI 或未安装对应 CLI 的环境应看到 `skipped (not installed on PATH)`，这是预期行为。

## 3. 符号链接（symlink）探测说明

设计要求受管投影为**相对目录符号链接**：

- 默认：`.agents/skills/<skill-id>` → `../../.pier/skills/library/<skill-id>`
- Claude 适配开启后额外：`.claude/skills/<skill-id>` → 同上库目录

S0 结论与约束：

1. **官方文档**声明 Codex 与 Claude Code 支持技能目录符号链接；Cursor / OpenCode 以多根扫描兼容路径为主，v1 不另建 `.cursor/skills` 投影。
2. **最低可用版本以本机探测为准**。Claude 文档中与嵌套同名技能限定名相关的 `v2.1.203+` **不得**被写成“官方符号链接支持门槛”；符号链接是否在某版本可用，必须用当前主机上的 probe / 真机会话验证。
3. probe 脚本的 fixture 只证明宿主文件系统能创建相对目录链接、链接可解析且经链接可读 `SKILL.md`。它**不**代替各智能体 CLI 的真实发现集成测试（后者在后续适配器与集成探测任务中完成）。
4. 投影父目录（`.agents`、`.agents/skills`、`.claude`、`.claude/skills`）本身必须是真实目录，不能是符号链接（见设计路径安全规则）；链接只允许落在技能 id 这一级。

## 4. 重复发现（duplicate-discovery）

当 Claude 适配开启时，同一技能可能同时出现在：

- `.agents/skills/<id>`（默认 Codex / 通用投影）
- `.claude/skills/<id>`（Claude 适配投影）

OpenCode 会同时扫描 `.agents/skills`、`.claude/skills`、`.opencode/skills`；Cursor 在 `.agents/skills` 之外还兼容 `.claude/skills` 等路径。因此：

- 多活动根智能体在 Claude 适配开启后必须报告 `duplicate-discovery`；
- 不得把该状态显示为全绿健康；
- `duplicate-discovery` 阻断会保留该行为的计划与对应智能体启动；关闭 Claude 适配等能消解问题的计划仍允许应用（设计 §5 健康映射）。

v1 不创建额外 `.cursor/skills` 或 `.opencode/skills` 投影，以降低重复面；重复检查仍覆盖 Cursor 与 OpenCode。

## 5. ManagedAgentLaunchGate

S0 固定启动边界（实现与架构测试在后续 Task）：

- 唯一硬门是 main 侧 `ManagedAgentLaunchGate`：已解析 `agentId` 与规范化 `ProjectRootRef`，但尚未创建 native surface、spawn PTY 或启动一次性 CLI。
- 所有可能以项目目录为工作目录并消费项目技能的受管入口都必须汇入该门，包括交互终端与一次性 CLI（如 `AiService.generateText` 相关路径）。
- 校正失败默认不启动；按问题 `degradePolicy` 降级启动必须走 `agent.launch.continue` 一次性授权，禁止静默跳过。
- 技能硬门不放在只收到 `agentId` 的 `agents.prepareLaunch`，也不散落在 renderer 动作中。

本 spike 只记录该边界与命名，不实现门本体。

## 6. 证据清单（Task 1）

| 产物 | 路径 | 状态 |
| --- | --- | --- |
| 官方事实与探测说明 | `docs/superpowers/spikes/2026-07-19-project-skills-s0.md` | 本文件 |
| 本机 probe 脚本 | `scripts/project-skills/probe-agent-skills.mjs` | 可运行；缺装 skip |
| 存在性测试 | `tests/unit/main/project-skills-s0-evidence.test.ts` | 固化关键字符串与入口 |

后续 S0（Task 2）已在本文件 §7 追加文件系统原语结论。

## 7. Filesystem primitives（Task 2）

> 核验日期：2026-07-19（macOS Darwin / APFS 本机单元测试）。  
> 实现：`src/main/services/project-skills/fs-adapter.ts`  
> 测试：`tests/unit/main/project-skills-fs-adapter.test.ts`

### 7.1 目标原语

| 原语 | 行为 | 结果语义 |
| --- | --- | --- |
| `lstatIdentity` | `lstat`（优先 bigint）→ `dev/ino/mode/nlink/type[/birthtimeNs]` | 对象身份快照 |
| `publishSymlinkNoReplace` | 同父目录临时相对 symlink + 不覆盖发布到最终名 | `created` / `conflict(target-exists\|parent-invalid)` |
| `publishFileReplaceIfUnchanged` | 写临时文件并 fsync → 最终期望检查 → 原子 rename → 父目录 sync → 再读 identity/digest | `replaced(matched)` / `conflict` / `indeterminate` |
| `syncDirectory` | 打开目录句柄并 `fsync` | 抛错表示耐久不明 |
| `probeCapabilities` | 可写探测 + `O_NOFOLLOW` 排他创建 + 目录 sync | `local-reliable` 或 `unsupported` |

### 7.2 本机结论（通过 / 收窄）

1. **不覆盖 symlink 发布（通过）**  
   目标已存在时返回 `conflict: target-exists`，既有 `dev/ino` 与 `readlink` 目标不变。首次创建后 identity 稳定，`readlink` 保持相对目标字符串（例如 `../../.pier/skills/library/<id>`）。

2. **对象身份保留（通过，收窄到 Darwin）**  
   Node 的普通 `rename` / `mv -n` **不能**提供目录项级 no-clobber。macOS 上通过 `renamex_np(..., RENAME_EXCL)`（进程内缓存的一次性 `cc` 小助手）把临时 symlink 发布到最终名，并保留源对象 identity。v1 范围是 macOS 本地卷；非 Darwin 仅有“先 lstat 再 rename”的尽力回退，不宣称可靠。

3. **已有文件的保守替换（通过，明确非强 CAS）**  
   流程固定为：最终检查 → 原子 rename → 父目录 sync → 发布后复核 digest/identity。  
   - 外部在 final check 之后改写目标时，测试注入点可稳定得到 `conflict` 或 `indeterminate`，**不得**静默 `replaced/matched`。  
   - 父目录 sync 失败映射为 `indeterminate: sync-unknown`（提交可能已发生，耐久不明）。  
   - 发布后 digest/类型偏离映射为 `indeterminate: post-check-diverged`。  
   **不**声称对不合作外部写者提供文件系统级强 CAS；进程内锁与最终检查只收窄 Pier 自身竞态窗口。

4. **能力探测（通过）**  
   可写临时根上 `probeCapabilities` 返回 `kind: "local-reliable"`，并置位 `writable`、`supportsNoFollow`、`supportsDirSync`。网络盘 / 云盘 / 语义不可靠 FUSE 仍按设计只读诊断，本 Task 未扩展拒绝矩阵。

### 7.3 证据

| 产物 | 路径 | 状态 |
| --- | --- | --- |
| FS 适配器 | `src/main/services/project-skills/fs-adapter.ts` | 导出 brief 接口 |
| 单元测试 | `tests/unit/main/project-skills-fs-adapter.test.ts` | macOS 本机 5/5 通过 |
| 本结论 | 本节 | 通过 + Darwin 收窄 |

运行：

```bash
pnpm exec vitest run tests/unit/main/project-skills-fs-adapter.test.ts
```
