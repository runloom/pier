# AI 工作台能力评分清单

更新时间：2026-06-25

## 调研口径

本清单基于 5 个并行子 agent 的只读调研结果整合，覆盖：

- `stablyai/orca`：本地多 agent 编码工作台、工作树、浏览器、diff 审查、CLI 控制面。
- `omnigent-ai/omnigent`：统一 agent 运行外壳、策略治理、沙箱、远程 runner、跨设备协作。
- `pewdiepie-archdaemon/odysseus`：自托管个人 AI 工作区、工具系统、研究、模型运维、个人信息能力。
- Pier 本地仓库：`AGENTS.md`、`README.md`、终端契约、工作区布局、CLI 控制面、原生 Ghostty 桥。
- Codex App / CLI：线程 `019efa22-f7f7-78e1-a450-fa05d659ca37`、本机 `build-web-apps` 插件缓存、Codex 手册缓存。
- 本轮替代风险复核：OpenAI Codex App Review、Codex GitHub code review、Claude Code IDE integrations、Claude Code GitHub Actions、Claude Code Skills 官方文档。
- 本轮补充方向：开发知识资产管理，参考 GitBook Git Sync / Agent、Mintlify 协作编辑、Docusaurus versioning、Notion wiki / verified knowledge。

约束：

- 只纳入子 agent 通过官方文档、源码、本地仓库或指定线程确认过的能力。
- 未确认的运行稳定性不作为事实，只作为风险提示。
- 对 Pier 的判断以项目边界为准：本地 AI 开发工作台，核心是稳定终端、dockview panel 布局、代码变更预览、文件查看、多 agent 状态可见性；不做任务生命周期、SQLite 任务台账、看板、自动调度。

## 评分规则

每项使用 6 个 1-5 分：

| 维度 | 含义 |
|---|---|
| 场景 | 是否适合 Pier 的目标场景。 |
| 痛点 | 是否解决真实且高频的用户痛点。 |
| 效率 | 是否能减少切换、等待、重复说明和手工操作。 |
| 质量 | 是否能提升审查、验证、可恢复性、安全性或交付可信度。 |
| 模型替代风险 | 分数越高，越容易被单个强模型自身能力替代。 |
| Claude/Codex 替代风险 | 分数越高，越容易被 Claude Code、Codex App/CLI 或其官方能力替代。 |

总分公式：

```text
总分 = 场景 + 痛点 + 效率 + 质量 + (6 - 模型替代风险) + (6 - Claude/Codex 替代风险)
```

满分 30。替代风险越高，总分越低。

优先级不是总分排序。若 Claude/Codex 已经很好地覆盖某项能力，Pier 只有在能补齐本地开发闭环、跨 agent 状态、工作树隔离、终端现场、证据绑定或权限边界时才应实现；否则应标为后置集成或不做。能力总表中的“建设理由 / 改进点”用于区分：闭环补齐、差异化增强、后置集成和不做。

## 能力总表

表格使用 HTML 段落式单元格输出；每个评分格分为“分数”和“依据”两段，并在单元格上显式允许自动折行，避免 Markdown 预览把内容挤成一行。

<table class="ai-score-table" style="table-layout: fixed; width: 100%; border-collapse: collapse; white-space: normal;">
<thead>
<tr>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">优先级</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">功能</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">建设理由 / 改进点</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">场景</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">痛点</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">效率</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">质量</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">模型替代风险</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">Claude/Codex 替代风险</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">总分</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">Pier 判断</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">详细说明</th>
<th style="vertical-align: top; white-space: normal; word-break: break-word;">来源</th>
</tr>
</thead>
<tbody>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">稳定原生终端基础</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐 / 底座能力。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：解决本机 NSView、PTY 生命周期、焦点、布局和主题稳定性；这不是 Claude/Codex 可替代的模型能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier README 明确把终端列为本地 AI 开发工作台核心能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：终端不稳会直接中断所有 agent 工作，是基础阻塞。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：稳定分屏、滚动和焦点能减少重复打开、重新运行和复制输出。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：原生终端保留 PTY、屏幕缓冲、主题和字体热更新，能提升长任务可靠性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型无法替代本地 NSView、PTY 生命周期和键盘协议。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 可以运行在终端里，但不能替代 Pier 的原生终端桥和多面板承载。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">28</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：继续作为底座。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：Ghostty 原生终端、主题、字体、焦点、右键、尺寸同步是 AI 开发工作台底座。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：承载 Claude Code、Codex、OpenCode 等 CLI agent，并保证多面板场景下的本地交互稳定。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>README.md</code>；Pier <code>src/shared/contracts/terminal.ts</code>；Pier <code>native/Sources/GhosttyBridge/GhosttyBridge.swift</code>；Pier <code>native/src/addon.mm</code>；Orca terminal docs: <a href="https://www.onorca.dev/docs/terminal">https://www.onorca.dev/docs/terminal</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">本机控制面 / CLI 自动化</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：让外部 agent、脚本和未来 MCP 通过机器可读命令调用 Pier，同时保留本机权限、窗口和 <code>--no-focus</code> 控制。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier README 已明确 CLI 用于后续 MCP server、脚本和本机自动化。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：没有可脚本化控制面，agent 只能靠人工点 UI。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：CLI/JSON 让自动化和远程调用变成稳定路径。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：结构化命令比 UI 文本操作更可验证。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能替代本机 socket、窗口控制和权限执行。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex 已有 app-server、MCP server 和 CLI 自动化方向，但它们不能直接替代 Pier 自己的本机控制面。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">26</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：P0 只限 Pier 本机控制面。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：用 CLI、本机 socket、命令信封和权限，为脚本、后台 agent、未来 MCP 调用 Pier。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：只暴露 Pier 窗口、panel、终端、布局、权限相关动作；不重复做 Codex/Claude 通用 agent SDK。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>README.md</code>；Pier <code>src/main/adapters/cli/cli-parser.ts</code>；Pier <code>src/main/adapters/cli/local-control-server.ts</code>；Pier <code>src/shared/contracts/permissions.ts</code>；Orca CLI docs: <a href="https://www.onorca.dev/docs/cli/overview">https://www.onorca.dev/docs/cli/overview</a>；Codex App Server: <a href="https://developers.openai.com/codex/app-server">https://developers.openai.com/codex/app-server</a>；Codex MCP: <a href="https://developers.openai.com/codex/mcp">https://developers.openai.com/codex/mcp</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 能力注册与权限范围</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：把 Pier 外部可调用能力收进统一权限范围，避免插件、MCP 或脚本绕过本地安全边界。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 未来需要把本地控制面暴露给 MCP、后台 agent 和脚本。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：插件绕过权限和数据边界是高风险痛点。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：窄 API 能让外部 agent 复用工作台能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：scope、token、管理员门控能显著提升安全质量。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型无法替代协议、token 和权限执行层。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 都有 MCP、插件和权限能力；Pier 只应做本地能力的注册和授权。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">26</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：做 Pier 本地能力注册，不做通用插件平台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：定义哪些 Pier 动作可被外部调用，以及调用时的权限、审计和用户确认。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：panel、终端、文件查看、Git 面板、证据和通知等本地动作；通用 MCP 市场交给 Claude/Codex 生态。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Odysseus <code>codex_routes.py</code>；Odysseus threat model: <a href="https://github.com/pewdiepie-archdaemon/odysseus/blob/dev/THREAT_MODEL.md">https://github.com/pewdiepie-archdaemon/odysseus/blob/dev/THREAT_MODEL.md</a>；Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；Pier <code>README.md</code>；Codex plugins: <a href="https://developers.openai.com/codex/plugins">https://developers.openai.com/codex/plugins</a>；Claude Code settings/plugins: <a href="https://docs.anthropic.com/en/docs/claude-code/settings">https://docs.anthropic.com/en/docs/claude-code/settings</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">终端会话状态管理</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：统一 active、background、exited、恢复、停止和会话列表；Claude/Codex 只能管理自身会话，不能管理 Pier 的全部终端 panel。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 目标是让 AI 编程从会话走向项目连续性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多个终端跑不同任务后，很容易不知道哪个仍有效。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：会话列表、停止、恢复能显著减少人工找现场。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：状态机能减少误关、重复运行和坏路径恢复。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型无法可靠观察本地 panel 生命周期。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 有 thread/background task，Claude 有 session，但不能统一 Pier 内所有 CLI、普通 shell 和 panel 状态。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">25</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P0。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：让用户知道哪些终端还在跑、哪些退出、哪些可以恢复、哪些需要处理。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：跨 agent、跨普通 shell、跨 panel 的本地状态，而不是单一 agent 自身会话列表。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>src/main/state/terminal-session-state.ts</code>；Pier <code>src/main/ipc/terminal.ts</code>；Pier <code>src/shared/contracts/terminal.ts</code>；本地线程 <code>019ef936-4222-7383-a25f-e74bd166d836</code>；Orca session restore docs: <a href="https://www.onorca.dev/docs/model/session-restore">https://www.onorca.dev/docs/model/session-restore</a>；Codex app features: <a href="https://developers.openai.com/codex/app/features">https://developers.openai.com/codex/app/features</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Git 变更面板与外部审查入口</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐，不重复建设通用 AI 代码审查。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：P0 只做本地 Git 变更面板、跨工作树/跨 agent 可见性、终端会话与证据绑定、以及一键交给 Claude/Codex 审查的入口。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：代码变更预览仍是 Pier 核心场景，但范围应限定在本地变更可见性和审查入口。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：用户需要知道多个 agent 到底改了什么；AI 审查本身可直接交给 Claude/Codex。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：常驻 diff 和一键外部审查入口能减少切换，但不会比 Codex App 的 review pane 形成明显效率代差。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：本地 diff、证据和会话绑定提升可信度；通用审查质量不应作为 Pier 自研目标。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型可以直接审查 diff，但不能替代本地多工作树、终端和证据绑定。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 已有 review pane、inline comments、/review 和 PR review 流程；Claude Code 也有 IDE diff、GitHub Actions 和技能化 diff 总结。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">22</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断已修正：P0 是闭环补齐；AI 审查增强后置。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：展示当前 repo/工作树的 unstaged、staged、base branch、最近会话相关变更。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：把 diff 绑定 terminal session、transcript、测试证据和外部审查入口。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">不做范围：不重复做通用 AI code review；当用户要审查质量时，优先调用 Claude/Codex。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>README.md</code>；Pier <code>AGENTS.md</code>；OpenAI Codex App Review: <a href="https://developers.openai.com/codex/app/review">https://developers.openai.com/codex/app/review</a>；OpenAI Codex GitHub code review: <a href="https://developers.openai.com/codex/integrations/github">https://developers.openai.com/codex/integrations/github</a>；Claude Code IDE integrations: <a href="https://docs.anthropic.com/en/docs/claude-code/ide-integrations">https://docs.anthropic.com/en/docs/claude-code/ide-integrations</a>；Claude Code skills: <a href="https://docs.anthropic.com/en/docs/claude-code/skills">https://docs.anthropic.com/en/docs/claude-code/skills</a>；Claude Code GitHub Actions: <a href="https://docs.anthropic.com/en/docs/claude-code/github-actions">https://docs.anthropic.com/en/docs/claude-code/github-actions</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P1</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">工作树隔离</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐 / 差异化增强。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：不要把 worktree 当成独有能力；Pier 的差异在跨 Claude、Codex、OpenCode 和本机 panel 的工作树聚合与比较。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 的多 agent 本地工作台与工作树隔离高度一致。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：并行 agent 互相覆盖是核心痛点。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：同一任务可并行试解并比较结果，但 Codex/Claude 已经提供部分 worktree 流程。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：隔离降低误合并，但仍需要审查和测试。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：强模型不能替代文件系统隔离。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 已有内置 worktree，Claude Code 文档也覆盖 git worktrees；Pier 只有跨工具聚合时有差异。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">23</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：从 P0 调为 P1。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：每个任务或 agent 使用独立工作树和分支，避免多个 agent 同时改同一个 checkout。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：跨 agent 的工作树发现、状态聚合、diff/证据对比和清理。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca worktrees docs: <a href="https://www.onorca.dev/docs/model/worktrees">https://www.onorca.dev/docs/model/worktrees</a>；Orca README: <a href="https://raw.githubusercontent.com/stablyai/orca/main/README.md">https://raw.githubusercontent.com/stablyai/orca/main/README.md</a>；Pier <code>AGENTS.md</code>；Codex app: <a href="https://developers.openai.com/codex/app">https://developers.openai.com/codex/app</a>；Claude Code IDE integrations: <a href="https://docs.anthropic.com/en/docs/claude-code/ide-integrations">https://docs.anthropic.com/en/docs/claude-code/ide-integrations</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">多面板工作区布局</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：承载终端、diff、文件、证据、预览和状态，而不是把 Pier 做成另一个聊天窗口。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：AGENTS 明确 dockview panel 布局是核心能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多个 agent、多个终端和多个文件来回切换会丢现场。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：面板并置能减少窗口切换和上下文重建。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：布局持久化和固定承载边界能减少漏看状态和误操作。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型能建议布局，但不能管理 dockview 状态。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 和 IDE 也有多线程、多面板体验；Pier 的价值在本地跨工具工作台，而不是普通聊天分栏。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">23</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P0，但替代风险上调。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：tab、split、floating、drag 是承载 AI 开发现场的容器。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：多终端、多文件、多证据、多状态面板并置和持久化。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>AGENTS.md</code>；Pier <code>src/renderer/components/workspace/workspace-host.tsx</code>；Pier <code>src/renderer/stores/workspace.store.ts</code>；Pier <code>src/renderer/components/workspace/panel-registry.ts</code>；Orca panes / quick open docs: <a href="https://www.onorca.dev/docs">https://www.onorca.dev/docs</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P0</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">shell 状态与 agent 识别</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：跨 Claude、Codex、OpenCode 和普通 shell 显示 busy、idle、等待输入、权限等待和退出状态。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多 agent 状态可见性是 Pier 明确目标。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：用户不知道 agent 是否卡在确认、权限或失败状态。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：基于 title、cwd、进程名先做识别，就能减少人工点 tab。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：等待输入和退出码能减少漏处理和错误交付。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能直接感知本地进程忙闲。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：单个 CLI 能知道自己状态，但不能跨 agent 汇总。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">25</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P0。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：识别 terminal panel 里到底跑的是哪个 CLI agent，以及它是否需要用户处理。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：先用 title、cwd、进程名、退出码和终端事件建立近似状态，再逐步接 hooks/协议。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>src/shared/contracts/events.ts</code>；Pier <code>src/renderer/panel-kits/terminal/terminal-panel.tsx</code>；Pier <code>native/Sources/GhosttyBridge/GhosttyBridge.swift</code>；Orca agents / sessions docs: <a href="https://www.onorca.dev/docs/model/agents-sessions">https://www.onorca.dev/docs/model/agents-sessions</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P1</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">transcript 与现场回放</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：保留原始终端现场，用于回放、继续上下文和证据索引；摘要可以交给模型，但采集不能只靠模型。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：长任务、测试记录和 agent 输出都需要可恢复。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：只靠屏幕 scrollback 很难复盘。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：回放和检索能减少重新运行和人工复制日志。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：原始记录是证据、继续上下文和错误诊断的基础。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型可以总结粘贴内容，但不能补回丢失的本地输出。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 可能有自身日志，但不覆盖 Pier 多终端统一记录。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">24</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P1。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：按会话分段保存原始终端输出，用于回放、摘要、证据索引和继续上下文。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：采集和索引原始现场；摘要、归纳和压缩可以调用 Claude/Codex。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>AGENTS.md</code>；Pier <code>src/shared/contracts/terminal.ts</code>；Pier <code>src/shared/contracts/events.ts</code>；Orca session history / hibernation docs: <a href="https://www.onorca.dev/docs/model/session-restore">https://www.onorca.dev/docs/model/session-restore</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P1</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">证据与未验证项</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：把测试命令、退出码、截图、日志、diff 和未验证项放到同一交付现场，解决“到底验证过没有”。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：AI 开发现场恢复需要证据，而不只是聊天总结。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：用户无法快速判断交付是否可信。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：减少交付前重新问 agent、重新跑命令。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：证据列表直接提升审查和交付可信度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型能整理用户提供的证据，但不能自动采集本地证据。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 可输出测试总结，但 Pier 可统一跨面板证据。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">24</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P1。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：记录测试命令、退出码、截图、日志路径、相关 diff 和人工备注。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：做证据采集、关联和未验证项提示；不把模型生成的总结当作唯一事实。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>README.md</code>；Pier <code>AGENTS.md</code>；Pier <code>src/shared/contracts/events.ts</code>；本地线程 <code>019ef936-4222-7383-a25f-e74bd166d836</code></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P1</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">权限与策略治理</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐，但首版只做少量硬边界。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：优先做 shell、文件、网络、工具调用的可解释确认；暂不做完整策略引擎。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 需要安全边界，尤其是终端和文件操作。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：权限、成本、误操作是强痛点。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：审批会增加步骤，但能减少返工和事故。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：可审计闸门显著提高可靠性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：提示词无法稳定替代权限执行。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 已有 approvals、sandbox、permissions；Pier 只应覆盖本地跨工具统一权限。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">24</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：P1，不做重型策略引擎。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：对 shell、文件、网络、工具调用、成本等动作做允许、拒绝、人工确认。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：本地统一权限和审计；Claude/Codex 自身权限继续由它们自己处理。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Omnigent policies docs: <a href="https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md">https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md</a>；Omnigent OS sandbox docs: <a href="https://omnigent.ai/docs/policies/os-sandbox">https://omnigent.ai/docs/policies/os-sandbox</a>；Pier <code>src/shared/contracts/permissions.ts</code>；Codex config basics: <a href="https://developers.openai.com/codex/config-basic">https://developers.openai.com/codex/config-basic</a>；Claude SDK capabilities: <a href="https://docs.anthropic.com/en/docs/claude-code/sdk">https://docs.anthropic.com/en/docs/claude-code/sdk</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P1</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Agent 状态入口 / hooks / 通知</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：先做等待输入、完成、失败、需要确认的状态入口和桌面通知，hooks/ACP 等协议后置。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 目标包含多 agent 状态可见性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：用户不知道哪个 agent 需要处理。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：等待输入和完成通知减少轮询。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：能减少漏处理，但协议接入过早会扩大范围。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能观察所有本地 terminal tab。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude 有 hooks/subagents，Codex 有 automations/task 状态；Pier 的价值在跨 CLI 的统一入口。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">22</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：P1，但协议化后置。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：状态条、agent 列表、等待输入提醒、完成通知。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：跨 agent 状态入口；hooks 只作为未来增强，不作为首版前提。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>src/renderer/stores/panel-descriptor.store.ts</code>；Pier <code>README.md</code>；Orca notifications docs: <a href="https://www.onorca.dev/docs/mobile">https://www.onorca.dev/docs/mobile</a>；Claude hooks: <a href="https://docs.anthropic.com/en/docs/claude-code/hooks">https://docs.anthropic.com/en/docs/claude-code/hooks</a>；Codex automations: <a href="https://developers.openai.com/codex/app/automations">https://developers.openai.com/codex/app/automations</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">继续上下文生成</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：差异化增强。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：Claude/Codex 都擅长写摘要，Pier 的价值不是摘要文案，而是自动采集工作树、终端、diff、文件和证据后生成可继续的上下文。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 的目标是项目连续性，继续上下文承接这个目标。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：隔天恢复、切换模型、重开会话时人工拼提示成本很高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：能减少重复说明，但主要价值来自自动采集。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：减少漏项，但依赖 transcript、Git diff、上下文文件和证据完整性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型非常擅长摘要生成，替代风险高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 都能生成继续提示；Pier 的价值只在本地上下文采集。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">20</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P2，必须依赖 transcript/diff/证据后再做。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：基于任务、会话、diff、文件、证据生成给 agent 的继续提示。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：采集和组装本地开发现场；最终摘要和提示生成可以调用 Claude/Codex。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>README.md</code>；Pier <code>src/shared/contracts/renderer-command.ts</code>；Pier <code>src/main/services/renderer-command-service.ts</code>；Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；Codex best practices: <a href="https://developers.openai.com/codex/learn/best-practices">https://developers.openai.com/codex/learn/best-practices</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">任务引用与会话绑定</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：轻量闭环补齐。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：只把 terminal panel 绑定到手动标题、URL 和上下文文件；不扩展成任务系统、看板或调度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 不做任务生命周期和看板，只适合轻量绑定。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多个终端一多就不知道哪个对应哪个目标。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：panelId 可作为绑定锚点，但收益不如终端状态和证据直接。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：轻绑定提升追踪，但不应变成任务系统。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型能生成任务摘要，替代风险偏高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex threads 和 Claude sessions 已经承担很多任务绑定场景。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">16</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P2，只做轻绑定。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：把终端会话绑定到手动任务标题、URL、上下文文件。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：帮助用户识别 terminal-1 对应什么目标；不做任务生命周期。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>AGENTS.md</code>；Pier <code>src/main/state/terminal-session-state.ts</code>；Pier <code>src/renderer/stores/panel-descriptor.store.ts</code></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">浏览器 / UI 检查上下文</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：差异化增强。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：Codex App 已有浏览器和批注体验，Pier 只有在绑定本地工作树、终端会话、多 agent 和证据时才值得做。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：真实渲染验证对桌面工作台有价值，但不是 Pier 独有场景。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：UI 问题靠文字描述成本高且容易失真。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：点击页面元素、采集 DOM/CSS/截图能减少来回描述。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：视觉上下文能提高修复命中率。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：没有浏览器状态和截图，纯模型很难可靠判断。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 已有 in-app browser、页面批注、样式反馈和 Chrome extension；Pier 必须做本地工作树绑定差异。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">23</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P2，不做通用浏览器批注。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：内置浏览器、页面批注、DOM/CSS/截图采集能改善 UI bug 反馈。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：只做与本地 dev server、工作树、终端任务和证据链绑定的检查上下文。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca Design Mode docs: <a href="https://www.onorca.dev/docs/browser/design-mode">https://www.onorca.dev/docs/browser/design-mode</a>；Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；本机 <code>build-web-apps</code> 插件技能缓存；Codex in-app browser: <a href="https://developers.openai.com/codex/app/browser">https://developers.openai.com/codex/app/browser</a>；Codex Chrome extension: <a href="https://developers.openai.com/codex/app/chrome-extension">https://developers.openai.com/codex/app/chrome-extension</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">OS 沙箱</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：闭环补齐 / 后置实现。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：OS 级文件、网络和环境隔离无法由模型替代，但 native terminal 路径接入成本高，应先做确认和目录边界。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 需要安全边界，但 native terminal 接入成本高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：本机密钥和文件暴露风险很强。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：配置成本存在，但可安全放手运行。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：减少破坏性误操作。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型无法替代 OS 级隔离。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex/Claude 自带 sandbox 和 permissions 覆盖自身；Pier 只有跨工具本地隔离时有价值。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">23</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：P2，首版先做确认和目录边界。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：限制文件读写、网络、环境变量和工具调用。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：先把高风险动作做成可解释确认；完整 OS sandbox 后置。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Omnigent OS sandbox docs: <a href="https://omnigent.ai/docs/policies/os-sandbox">https://omnigent.ai/docs/policies/os-sandbox</a>；Pier <code>AGENTS.md</code>；Codex config basics: <a href="https://developers.openai.com/codex/config-basic">https://developers.openai.com/codex/config-basic</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">多 CLI agent 启动、profile、用量状态</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：首版优先识别和显示多 CLI agent 状态；账号、profile、用量看板容易被 Claude/Codex 官方能力吸收。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 有多 agent 可见性需求。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多种 CLI 各自散落、状态不透明。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：统一启动有帮助，但账号、profile、用量已被官方工具覆盖很多。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：主要提升操作可见性，不直接保证代码正确。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能替代进程状态管理。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 自身最容易补齐账号、用量和状态 UI。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">19</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P2，只保留状态集成。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：统一启动 Claude、Codex、OpenCode 等 CLI agent，并展示运行状态。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：启动模板和状态，不做账号/额度平台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca supported agents docs: <a href="https://www.onorca.dev/docs/agents/supported">https://www.onorca.dev/docs/agents/supported</a>；Orca usage docs: <a href="https://www.onorca.dev/docs">https://www.onorca.dev/docs</a>；Pier <code>src/shared/contracts/terminal.ts</code>；Claude costs/usage: <a href="https://docs.anthropic.com/en/docs/claude-code/costs">https://docs.anthropic.com/en/docs/claude-code/costs</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">自动错误诊断</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：差异化增强。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：错误解释可直接交给 Claude/Codex；Pier 只需要自动采集退出码、失败命令、transcript 片段、相关 diff 和环境。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：开发命令和检查命令是 Pier 工作流核心。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：失败后用户要手动复制错误。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：失败诊断可减少复制日志时间。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：将退出码、日志和 diff 绑定可提升修复准确性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型擅长解释错误文本，替代风险很高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 自身可做错误修复；Pier 价值是自动采集上下文。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">18</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：P2，不自研错误解释。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：捕捉失败命令、退出码、相关输出，生成可交给 agent 的修复上下文。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：采集和关联错误现场；分析和修复交给 Claude/Codex。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier <code>AGENTS.md</code>；Pier <code>src/shared/contracts/events.ts</code>；本地线程 <code>019ef936-4222-7383-a25f-e74bd166d836</code>；Codex overview: <a href="https://developers.openai.com/codex">https://developers.openai.com/codex</a>；Claude common workflows: <a href="https://docs.anthropic.com/en/docs/claude-code/common-workflows">https://docs.anthropic.com/en/docs/claude-code/common-workflows</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P2</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">多 agent 手动并行与对比</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：差异化增强。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：做手动并行、工作树隔离、diff/测试/证据对比；不做自动派发和调度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 要展示多 agent，但不做调度系统。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：复杂任务人工协调成本高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：并行工作树能提速，但 Codex/Claude 已有 threads/subagents。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多方案比较有助于发现遗漏。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：更强模型会减少多方案需求，但不能完全替代隔离比较。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex CLI 支持 subagents，Claude Code 支持 custom subagents；Pier 只有跨工具对比时有差异。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">20</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P2，强调手动并行和对比。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：同一任务让多个 agent 在不同工作树里并行试解，用户比较 diff、测试和证据。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：提供比较面板和状态聚合；不做自动编排。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca worktrees docs: <a href="https://www.onorca.dev/docs/model/worktrees">https://www.onorca.dev/docs/model/worktrees</a>；Omnigent Polly / multi-agent docs: <a href="https://github.com/omnigent-ai/omnigent">https://github.com/omnigent-ai/omnigent</a>；Pier <code>AGENTS.md</code>；Codex CLI: <a href="https://developers.openai.com/codex/cli">https://developers.openai.com/codex/cli</a>；Claude subagents: <a href="https://docs.anthropic.com/en/docs/claude-code/sub-agents">https://docs.anthropic.com/en/docs/claude-code/sub-agents</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">远程 / SSH / runner</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：本地闭环稳定后再做远程 PTY、工作树和 runner lease；首版不应优先。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 首版定位本地工作台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：远程算力和长任务是真痛点。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：远程跑重任务能释放本机。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：环境可复现改善稳定性，但远程复杂度增加失败面。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能替代远程运行环境。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex 已有 remote connections 和 cloud tasks；Pier 不应早期重复。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">19</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需收紧：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：远程创建工作树、远程跑 agent、本地保留 UI/diff，或 server/runner 分离。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：先稳本地 Electron/native terminal，再考虑远程。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca SSH docs: <a href="https://www.onorca.dev/docs/ssh">https://www.onorca.dev/docs/ssh</a>；Omnigent deploy docs: <a href="https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md">https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md</a>；Pier <code>README.md</code>；Codex remote connections: <a href="https://developers.openai.com/codex/remote-connections">https://developers.openai.com/codex/remote-connections</a>；Codex quickstart/cloud tasks: <a href="https://developers.openai.com/codex/quickstart">https://developers.openai.com/codex/quickstart</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">跨设备 / 移动端 / 多人协作</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：可保留事件总线接口，但手机接手和多人协作不应抢占本地工作台首版。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：对 Pier 有方向价值，但本地优先。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：长跑任务离开电脑后容易卡住。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：手机/浏览器接续减少等待。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：共享 review 改善反馈质量，但不直接保证代码正确。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能替代多端同步层。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex 已有 ChatGPT mobile 远程连接和任务审查路径，替代风险高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">18</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：手机查看 agent 状态、回复等待输入、多人观看或接手。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：后置事件同步；首版不做跨设备产品。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca mobile docs: <a href="https://www.onorca.dev/docs/mobile">https://www.onorca.dev/docs/mobile</a>；Omnigent mobile / pair programming docs: <a href="https://omnigent.ai/docs/interact/mobile">https://omnigent.ai/docs/interact/mobile</a>；Codex remote connections: <a href="https://developers.openai.com/codex/remote-connections">https://developers.openai.com/codex/remote-connections</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">模型 / 账号 / 端点运维</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：Pier 可显示端点健康和配置状态，但不做完整模型下载、serving 和账号平台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型端点状态与 Pier 弱相关，完整 serving 不适合。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：本地模型、API key、额度和端点配置容易出错，但不是 Pier 主线。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：端点健康和日志能减少试错。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：改善模型选择和可用性，但不直接提高代码质量。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型不能替代 GPU、serve、下载和端点编排。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 已有模型选择、账号、用量、配置和官方托管能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">16</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：模型端点发现、健康、用量、限额、日志、模型服务状态。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：最多做状态提示和配置入口，不承担模型平台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Odysseus setup docs: <a href="https://github.com/pewdiepie-archdaemon/odysseus/blob/dev/docs/setup.md">https://github.com/pewdiepie-archdaemon/odysseus/blob/dev/docs/setup.md</a>；Odysseus README: <a href="https://github.com/pewdiepie-archdaemon/odysseus">https://github.com/pewdiepie-archdaemon/odysseus</a>；Orca usage docs: <a href="https://www.onorca.dev/docs">https://www.onorca.dev/docs</a>；Codex config reference: <a href="https://developers.openai.com/codex/config-reference">https://developers.openai.com/codex/config-reference</a>；Claude costs/usage: <a href="https://docs.anthropic.com/en/docs/claude-code/costs">https://docs.anthropic.com/en/docs/claude-code/costs</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">研究 / 知识库 / RAG</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：只保留工程调研面板方向；通用研究和知识库能力容易被 Claude/Codex、浏览器和个人知识库替代。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：工程调研相关，但不是首版开发现场底座。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：长期上下文遗失和多来源调研是真问题。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：检索记忆和文档能减少重复说明，但通用研究工具很多。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：可审计来源和项目上下文能提高一致性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：长上下文模型和联网模型能部分替代记忆/RAG。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 已有项目上下文、web search、skills 和 MCP，替代风险很高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">16</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：深度研究、来源读取、报告生成、个人文档检索、记忆。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：只在与代码、终端证据、项目文件直接相关时考虑。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Odysseus README: <a href="https://github.com/pewdiepie-archdaemon/odysseus">https://github.com/pewdiepie-archdaemon/odysseus</a>；Odysseus <code>deep_research.py</code>；Odysseus setup docs；Codex CLI web search: <a href="https://developers.openai.com/codex/cli">https://developers.openai.com/codex/cli</a>；Claude MCP: <a href="https://docs.anthropic.com/en/docs/claude-code/mcp">https://docs.anthropic.com/en/docs/claude-code/mcp</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">开发知识资产管理</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后续迭代方向参考，当前不做完整产品。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：不是再做一个 Notion 或文档编辑器，而是把需求、决策、计划、终端证据、测试结果、diff、截图、PR 反馈和继续上下文做成可验证资产。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：AI 开发长期看需要项目记忆，但 Pier 首版应先补终端、diff、状态和证据闭环。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：AI 接力最大的痛点不是写文档，而是事实散落、上下文丢失、文档过期和验证状态不清。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：自动生成上下文包、运行记录和文档更新建议能减少重复说明和人工整理。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：资产绑定来源、版本、证据和过期状态后，能显著提升 AI 修改、人工审查和交付可信度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型能生成、总结和改写文档，但无法凭空保证资产与代码、测试和终端事实一致。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 已有项目上下文、skills、artifacts、file previews 和代码审查；Pier 只有在做“开发现场绑定和可信状态”时才有差异。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">22</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断新增：当前不做，作为后续迭代方向参考。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：管理可验证的开发知识资产，包括需求、架构决策、实现计划、运行手册、调试记录、测试证据、截图、终端输出、PR 反馈、上下文包和未验证项。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：短期不做完整文档管理、协作编辑或发布站；后续只围绕代码、worktree、terminal session、diff、测试证据和上下文包建立资产层。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建议路径：先有证据资产，再有上下文资产，最后再做文档资产预览、过期检测和从代码变更生成文档更新建议。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">GitBook Git Sync: <a href="https://gitbook.com/docs/getting-started/git-sync">https://gitbook.com/docs/getting-started/git-sync</a>；GitBook AI knowledge layer: <a href="https://www.gitbook.com/">https://www.gitbook.com/</a>；Mintlify collaborative editor: <a href="https://www.mintlify.com/blog/editor">https://www.mintlify.com/blog/editor</a>；Docusaurus versioning: <a href="https://docusaurus.io/docs/versioning">https://docusaurus.io/docs/versioning</a>；Notion wiki / verified knowledge: <a href="https://www.notion.com/help/guides/build-a-docs-first-culture-with-a-beautiful-team-wiki-powered-by-a-database">https://www.notion.com/help/guides/build-a-docs-first-culture-with-a-beautiful-team-wiki-powered-by-a-database</a>；Codex app features: <a href="https://developers.openai.com/codex/app">https://developers.openai.com/codex/app</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">文档编辑 / 非代码产物预览</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：优先做工程文件查看；PDF、表格、演示稿和长文编辑可通过外部工具或 Codex/Claude 能力完成。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：适合部分工程文档，但弱于终端/diff。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：长文和交付物审查有痛点，但不是 Pier 主线。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：减少切换到外部应用，但替代工具成熟。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：建议式编辑和预览能提升文档交付质量。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：强模型可直接生成/修改文档。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Claude/Codex 对文档编辑、artifacts、file previews、skills 已很强。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">13</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：文档编辑、PDF、表格、演示稿、报告预览。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：工程文件查看优先；非代码产物不进入首版闭环。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Odysseus README；Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；Codex app features/sidebar and artifacts: <a href="https://developers.openai.com/codex/app">https://developers.openai.com/codex/app</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">图片输入、图片生成、多媒体工具</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：后置集成。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：适合设计稿和视觉参考，但不是终端、diff、证据闭环的底座。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：适合 Pier 设计稿和视觉方向，不是终端稳定性核心。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：视觉方向难描述时有用。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：快速产出图标、设计概念和参考图。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：减少空泛 UI 设计，但仍需浏览器核对。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多模态模型本身可替代大部分能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex CLI 和 App 已支持图片输入、图片生成和编辑。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">13</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需降级：P3。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：图片输入、图片生成、图片编辑、语音、PDF/Office 提取等。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：只在设计稿或截图反馈进入工程闭环时接入。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；Odysseus README；Codex CLI image inputs/generation: <a href="https://developers.openai.com/codex/cli">https://developers.openai.com/codex/cli</a>；Codex app image generation: <a href="https://developers.openai.com/codex/app">https://developers.openai.com/codex/app</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">多 agent 自动编排 / 任务 DAG</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：不做 / 后置观察。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：与 Pier “不做任务生命周期、看板、自动调度”的边界冲突；最多保留手动并行和状态可见性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：和 Pier 首版定位冲突。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：多 worker 汇报确实痛，但可先用轻量状态解决。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：成熟后能提升并行协作，但会把 Pier 拉向调度系统。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：任务记录有助于收敛，但也引入流程复杂度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：更强模型可能减少人工拆分需求。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex/Claude 的 subagents、hooks、automations 会直接竞争。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">12</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需明确：不做首版能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：自动派发、调度、多 agent 工作流编排、decision gate、worker_done 等。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：不做任务 DAG；只保留手动并行和状态可见性。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Orca orchestration docs: <a href="https://www.onorca.dev/docs/cli/orchestration">https://www.onorca.dev/docs/cli/orchestration</a>；Omnigent docs: <a href="https://omnigent.ai/">https://omnigent.ai/</a>；Pier <code>AGENTS.md</code>；Codex CLI subagents: <a href="https://developers.openai.com/codex/cli">https://developers.openai.com/codex/cli</a>；Claude subagents: <a href="https://docs.anthropic.com/en/docs/claude-code/sub-agents">https://docs.anthropic.com/en/docs/claude-code/sub-agents</a>；Claude hooks: <a href="https://docs.anthropic.com/en/docs/claude-code/hooks">https://docs.anthropic.com/en/docs/claude-code/hooks</a></p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">个人信息工作区</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：不做。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：邮件、日历、笔记、待办是个人 AI 工作区能力，不属于 Pier 的本地 AI 开发工作台。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：不符合 Pier 首版定位。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：邮件和日程助理对个人用户痛点强。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>4</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：摘要、triage、草稿、提醒能省时间。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>3</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：质量依赖协议、同步和个人风格。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：模型加邮箱/日历连接器可替代很多功能。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：通过插件、MCP 或专门个人助理很容易覆盖该场景。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">14</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断正确：不做。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：邮箱、日历、笔记、待办、联系人、提醒。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：不进入产品边界。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Odysseus README；Odysseus setup docs；Odysseus threat model</p>
</td>
</tr>
<tr>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">P3</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">自动化 / thread automation</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">建设理由：不做 / 后置观察。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">改进点：定时复查和线程自动化已经更适合 Codex App 或专门自动化系统，Pier 只保留本地事件能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>1</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Pier 明确不做自动调度。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：不是当前核心用户痛点。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：定期复查有用，但容易扩大产品边界。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：自动化本身不直接保证终端和工作台质量。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>2</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：纯模型无法定时保持线程上下文。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;"><strong>5</strong></p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">依据：Codex App 已有 automations 和 thread wakeup，替代风险很高。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">12</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">判断需明确：不做首版能力。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">能力说明：定时任务、线程自动化、周期复查。</p>
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Pier 范围：不做调度；只保留本地事件和通知。</p>
</td>
<td style="vertical-align: top; white-space: normal; word-break: break-word;">
<p style="margin: 0 0 6px 0; white-space: normal; word-break: break-word;">Codex App/CLI 线程 <code>019efa22-f7f7-78e1-a450-fa05d659ca37</code>；Orca CLI automation docs；Pier <code>AGENTS.md</code>；Codex app automations: <a href="https://developers.openai.com/codex/app/automations">https://developers.openai.com/codex/app/automations</a></p>
</td>
</tr>
</tbody>
</table>
