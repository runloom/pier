# 智能体状态配置诊断 — 金标准

## 01 触发条件

某些智能体允许用户在自己的配置里关掉 Pier 写入的状态集成。以 pi 为例：
`settings.json` 的 `extensions` 覆盖可以用 `-extensions/pier-agent-status.ts`
强制排除托管扩展，排除后 pi 不加载扩展，Pier 收不到状态事件，智能体列表和
侧栏一直显示为 idle。这个配置决定不经过 Pier，宿主无法自动纠正，只能在设置页
把事实告诉用户并给出恢复动作。

只有同时满足以下条件才提示：

- 扩展文件存在，且内容是 Pier 托管写入的（`isPierManagedPluginContent`）；
- 用户配置可解析，且确实排除了该扩展；
- 只看全局 `settings.json`。项目级覆盖需要项目上下文，设置页没有，宁可少提示，
  也不误报（fail-open）。

## 02 展示

宿主设置 → 智能体 → 展开某个智能体详情，在版本检查失败提示之后显示一条
`Alert`（`variant="warning"`，`AlertDescription`）。诊断是当前事实而不是历史，
用户改完智能体配置后应立刻消失。

- 只在 `probe.statusHooksDisabledByConfig === true` 时显示。
- 不新增弹窗、通知中心消息或入口；不提供「帮用户改配置」按钮。
- 配置诊断只说明状态为什么缺失，不改变安装 / 更新 / 卸载动作。

## 03 文案

文案说用户看到的现象和下一步，不说「状态集成」这类实现概念：

- zh-CN：`Pi 现在的设置让 Pier 看不到它的运行状态。运行 pi config 重新开启即可恢复。`
- en：`Pi’s current settings hide its status from Pier. Run pi config to turn it back on.`
- ja：`Pi の現在の設定では Pier に実行状態が表示されません。pi config で再び有効にすると復元されます。`
- ko：`현재 Pi 설정에서는 Pier에 Pi의 실행 상태가 표시되지 않습니다. pi config에서 다시 켜면 복구됩니다.`

i18n key 是 `settings.agents.row.statusHooksDisabledByConfig`。不得在业务代码里
内联用户串。

**偏离记录**：方案讨论时拟定的文案是「状态集成已在 pi 设置中关闭……」，审阅指出
「状态集成」是实现词。上文改为用户可见结果（看不到运行状态）+ 恢复动作，满足
`docs/superpowers/specs/2026-09-09-user-copy-gold-standard.md`。

## 04 数据路径

- 共享契约：`src/shared/contracts/agent/lifecycle.ts` 的
  `agentLifecycleProbeSchema.statusHooksDisabledByConfig`（可选布尔），随既有
  catalog `details` 下发；不新增 IPC。
- 读取：`src/main/services/agents/integrations/pi.ts`
  `readStatusHooksDisabledByConfig` 负责文件与覆盖语序；分派在
  `src/main/services/agents/integrations/registry.ts`
  `readDisabledStatusHooks`，宿主 catalog provider 保持与具体 agent 无关。
- 覆盖语序与 pi 一致：默认启用 → `!glob` 排除 → `+path` 强制启用 → `-path`
  强制排除；匹配前归一化 `file://`、`~`、`./` 和反斜杠。`+` / `-` 只做精确路径
  匹配，`!` 才走 glob。
- 读取失败：文件缺失静默按「已开启」处理；其它读取 / 解析错误写日志后同样
  fail-open，不把坏文件伪装成诊断结论。

## 05 新鲜度

- local / derived / remote 三类 probe 都在同一批里读取一次配置诊断，挂到既有
  probe 详情上。
- 读取持久化快照时先剥掉旧 `statusHooksDisabledByConfig`，由本次探测结果重新
  决定是否挂回；智能体缺失时也不携带该字段。旧警告不得在重启或重新开启后复活。
- 设置页挂载时，如果当前快照里已有该诊断，强制一次 local probe 复核；用户运行
  `pi config` 重新开启后，提示立即消失。

## 06 检查点

- `tests/unit/agent-integrations/pi-status-settings.test.ts`：覆盖语序、路径归一化、
  托管扩展识别、缺失 / 损坏配置 fail-open。
- `tests/unit/main/host-catalog/agent-cli-provider.test.ts`：生产 remote probe 下发、
  local probe 清除旧标记、智能体缺失时丢弃标记。
- `tests/unit/renderer/settings/agent-row-details.test.tsx`：诊断行显示 / 隐藏。
