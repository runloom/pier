# 智能体最新版本检测与更新金标准

日期：2026-08-29  
状态：现行权威（设置页「智能体」列表更新可用 / 一键更新）  
范围：`src/main/services/agents/lifecycle/` 的 latest 探测、更新计划、host-catalog 刷新；设置页详情失败提示。  
不包含：安装首选命令生成（已按官方顺序，见各 tier spec `install[]`）；agent 运行态 / 通知。

## 一句话终态

「可更新」只比较**同一安装渠道上的权威远端最新版**与本机当前版；强制刷新必须穿透全部缓存；brew 更新失败不得经 npm 双装。

## 四条原则

1. **latest 一律来自权威远端源**，禁止把本机包管理器过期索引当「最新」（唯一例外：第三方 tap 无 `formulae.brew.sh` 条目时回退本地 `brew info`，须文档化）。核心 brew 远端 miss 视为探测失败（`latestCheckFailed`），禁止再读本地 `brew info`。
2. **latest 源与安装渠道同一条版本线**（brew token 级：`claude-code` ≠ `claude-code@latest`；Claude native `autoUpdatesChannel` stable/latest；uv/PyPI 与 npm 不交叉）。
3. **force 刷新穿透所有缓存层**；探测失败负缓存 ≤ 60s，且 `latestCheckFailed` 对用户可见。
4. **更新命令与官方文档一致**；同一安装源内回退；**禁止跨生态回退造成双装**（brew 计划不含 `npm-latest`）。

## 数据源表

| 安装源 | latest 权威源 | 备注 |
|--------|---------------|------|
| brew（core cask/formula） | `https://formulae.brew.sh/api/cask|formula/<token>.json` | 已装 token 优先（`@latest` 变体）；远端 miss 返回 null，不回退 `brew info` |
| brew（第三方 tap） | 本地 `brew info --json=v2` | 远端 API 无 tap 包 |
| npm / nvm / fnm / volta / pnpm / yarn / bun | `npm view <pkg> version` | 实时 registry |
| uv / pipx | PyPI JSON | 不与 npm 交叉比较 |
| path / script + `latestProbe` | HTTP / GitHub Releases / Cursor 安装脚本 | Claude / Cursor / Kimi / Goose |
| Claude path + `stableUrl` | `downloads.claude.ai/.../latest` 或 `/stable` | 读 `CLAUDE_CONFIG_DIR/settings.json` 的 `autoUpdatesChannel`（未设则 `~/.claude/settings.json`），缺省 latest |

## 缓存与刷新

| 层 | TTL | force |
|----|-----|-------|
| host-catalog `agent-cli` remote | 10 min（`freshness.ts`） | `ensureFresh({ force: true })` 重跑 `probeRemote` |
| `fetchLatestVersion` 成功 | 10 min（与 catalog 对齐） | `force: true` 跳过读缓存 |
| `fetchLatestVersion` 失败（null） | 60 s | 同上 |

打开设置页 = soft refresh（尊重 TTL）。工具栏「刷新」= force，必须带 `checkLatest` + `force` 进 lifecycle probe。

## 更新计划（brew）

`UPDATE_PRIORITY.brew` = `brew-upgrade` → `self` → `reinstall`（**无** `npm-latest`）。  
`reinstall` 展开仍按安装源过滤为 brew / 脚本步骤。过滤结果为空时：spec 里有对应 install 渠道（Linux 上 brew cask 被丢掉）则跳过，禁止回退全部渠道把 npm 双装进来；spec 没有该安装源渠道（如 kimi 遗留的 uv `kimi-cli`）才回退其余 install 步骤以迁移。

**执行端新鲜度**：检测端用远端索引，执行端 brew 必须允许 auto-update（短节流
`HOMEBREW_AUTO_UPDATE_SECS=300`，`runner/child-env.ts`），禁止注入
`HOMEBREW_NO_AUTO_UPDATE=1` 把执行钉死在过期本地索引上——否则 `brew upgrade`
会对已检测到的更新报「已是最新」退出 0，落到 `version_unchanged` 假失败。
auto-update 对坏 tap 的报错不致命，brew 会继续执行主命令。

## 禁止

1. 对 core brew 包用本机 `brew info` 当 latest（含远端 miss 后回退；本地 API 缓存可滞后数日）。
2. path/native Claude 与 deprecated npm `@anthropic-ai/claude-code` 比较。
3. brew 源更新计划包含 `npm i -g …`（双装）。
4. force 刷新仍命中 20 分钟级 latest 内存缓存。
5. versioned agent 无任何同线 latest 源（goose 类须有 `latestProbe` 或 brew/npm/PyPI）。
6. lifecycle runner 注入 `HOMEBREW_NO_AUTO_UPDATE=1`（检测新、执行旧 → 更新恒报「版本未变化」）。

## 检查点

- 单元：`tests/unit/main/agents/lifecycle/latest-source.test.ts`、`latest-http.test.ts`、`latest-governance.test.ts`、`latest-probe.test.ts`、`plan.test.ts`、`child-env.test.ts`
- 契约：`AgentLifecycleProbe.latestCheckFailed`、`AgentLifecycleProbeRequest.force`
- 文档：本文件；AGENTS.md「智能体 CLI 版本检测与更新」引用
