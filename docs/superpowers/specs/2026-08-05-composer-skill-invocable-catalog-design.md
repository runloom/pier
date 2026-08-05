# 增强输入 Skill 可调用目录（L1）

日期：2026-08-05  
状态：已实现（P0 叙事 + P1 bundled MVP）

## 产品句

**增强输入 `/` 列表 = 当前前台智能体 force-invocable 入口（L1）**  
= 磁盘 discovery（managed + unmanaged + user-global）∪ **adapter bundled 内置**  
≠ 本机全部 SKILL.md，≠ 宿主 Grok skill（L3）。

| 层 | 名称 | 内容 | 增强输入 |
|----|------|------|----------|
| L1 | Invocable | 磁盘可调用 + bundled | **唯一数据源** |
| L2 | Inventory | 设置台账（含 disabled / not-projected） | 不直接等同 L1 |
| L3 | Host | `~/.grok/skills` 等宿主 skill | **永不**进入 agent `/` |

## 实现锚点

- 合并：`buildComposerSkillSuggestItems`（`composer-skill-suggest.ts`）
- Bundled 表：`src/shared/agent-bundled-skills.ts`（静态白名单，官方文档证据）
- 同 id 优先级：bundled < user-global < unmanaged < managed（磁盘覆盖内置）
- 插入：`skillInvokeText`（Claude `/`，Codex `$`）
- 触发：仍为 `/` 打开列表

## Bundled 证据规则

- 仅收录官方文档标明的 runtime bundled / system skill 子集（MVP 小白名单）。
- 禁止把 audit-only / 宿主根（含 `~/.grok/skills`）并入 L1。
- 后续可用 S0 probe 棘轮扩展，不阻塞 MVP。

## 非目标

- 宿主 slash 语义引擎
- 设置页列表与 `/` 强制同一集合
- 无证据全量镜像每个 agent 内建命令
