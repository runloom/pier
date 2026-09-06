# 智能体状态源码审查：实施结果

依据：[2026-09-06 源码审查](../specs/2026-09-06-agent-status-industry-audit.md)。用户已确认实施；本轮修改在工作区，未提交或发布。

## 已完成的行为

| 问题 | 修复后的行为 | 主要验收 |
|---|---|---|
| F1 原生空闲丢失 | OpenCode 主会话 idle 更新当前忙闲，工具、交互、子工作仍有各自结束条件；同回合可继续执行。可信结果单独进入 `turnResult`，空闲不误发完成通知 | 生成插件跨层轨迹、`native-idle.test.ts`、通知服务测试 |
| F2 Claude 手动压缩 | 手动维护事件按独立 ID 配对；正常结束可提供空闲，提前中止不制造忙碌，自动压缩保留用户回合。旧维护、其他会话或子会话不能完成主会话 | 实际生成 hook 命令驱动的 `manual-compaction.test.ts` |
| F3 文件替换漏读 | 用实际打开文件的 dev/ino/birthtime 识别换代，安全回扫。Prompt 水位同时保留自己的文件身份，既不重放旧匿名历史，也不丢新文件中新提问之后的结束记录 | 相同尺寸/更大文件 rename；读失败→换文件→新 Prompt→匿名结束组合轨迹 |
| F4 读取失败 | 在私有尾读边界捕获 open/read 等异步错误，记录脱敏诊断，250ms 起退避至 5s；每文件一个计时器，关闭后取消 | 禁用 watcher 回调的恢复用例；普通用户真实 chmod 000 的 EACCES 探针 |
| F5 监听满额 | 维持 32 文件上限，独占 owner 等量换绑可直接进行；共享文件保留其他 owner，真正超额的等待随容量释放自动恢复，支持取消和跨窗迁移 | `capacity-recovery.test.ts` 与独立真实文件探针 |

公共归约器没有增加提供方名称判断；会话记录仍是适配器内部输入。未增加任务台账、公共 Transcript 服务或新的界面状态源。

## 补充审查修正

- **维护 ID 覆盖 transcript owner**：实际生成钩子与 transcript 混合回放复现 `foreign-turn`。尾读器排除维护事件，Claude 适配器额外识别 `SessionStart(source=compact)`，保留用户回合与 Prompt 水位。新增 4 条用例覆盖自动/手动压缩、没有后续工具或 Stop，以及旧维护晚于新提问收尾。
- **Kimi 首次工具前原生取消漏报**：接入仅触发对账的 Interrupt，保留数字回合 ID（包括 0）的私有元数据；由新 main prompt/step 与匹配的 main cancellation 确认身份。复用原监听处理延迟落盘，未经验证的 hook ID 不进入 owner。新增 10 条真实生成命令的用例覆盖首次步骤之前取消、数字/字符串 ID、子智能体、旧回合、历史恢复、重复取消、关闭与跨窗迁移。
- **维护 ID 绕入用户回合路由**：补出失败用例后，明确排除 Maintenance 事件的跨会话回合认领。即使原生载荷复用了用户 prompt ID，也不能把外来会话的 PostCompact 路由回主会话。
- **新文件水位被误清**：只读审查发现了读失败期间换文件、新 Prompt 先看到新文件的顺序。新增用例先失败，再将水位与其文件身份一起登记、迁移和释放；换代时只废弃旧身份的水位。已通过。
- **普通异步顺序风险**：审查了真实生成插件→JSONL observer→hook pipeline→总对账器。OpenCode 无延迟注入时顺序正确、最终 ready；人为给 Prompt 的 observe 增加 100ms 延迟时可构造回退 processing。暂未证明当前 OpenCode 原生 observe 存在该慢路径，保留为后续调查项，未为此加入全局串行队列。

## 验证记录

- 上述两条 review 修复后重新运行：`tests/unit/main/agents`、`tests/unit/main/panel`、`tests/unit/agent-integrations`，**189 文件、2318 项全部通过**；宿主类型检查、构建（含 preload 边界）、依赖边界、变更 TypeScript 的 Biome、文件大小、目录密度及 `git diff --check` 均通过。新增回归在修复前已观察到状态无法结束的失败。
- 首轮完整相关目录：`tests/unit/main/agents`、`tests/unit/main/panel`、`tests/unit/agent-integrations`，187 文件共 2299 项；2298 通过，唯一失败为历史审计表仍列旧事件映射。已同步 Claude/OpenCode 表格并在随后定向运行验证该文件全部通过。
- 表格与初轮边界修正后：31 文件、218 项通过。
- 最终两个组合场景修正后：`tests/unit/main/agents/transcript`、`claude`、`kimi` 与 `tests/unit/main/panel`，49 文件、611 项通过。以上分轮有重叠，不相加为测试总数。
- `pnpm typecheck` 全部通过，含宿主、插件/移动包与 Canvas 类型。
- `pnpm build` 通过，preload 沙箱依赖检查通过。构建保留现有两项 dynamic import 分包提示，与本轮状态行为无关。
- 依赖边界检查通过；变更 TypeScript 文件的 Biome 检查通过；单文件硬上限与目录密度检查通过；`git diff --check` 通过。
- 独立 Node 24 文件探针：829→829、829→1085 字节 inode 替换均立即读到当前回合终态，重复追加不重发；真实 EACCES 没有未处理 rejection；32 个独占文件的等量换绑无需释放其他面板或再发 hook。

## 生效与范围

钩子命令代际已升至 21；新宿主及其安装的命令/插件需要被实际加载。构建不会替用户重启当前正在工作的 Pier 或智能体会话，本轮没有执行用户会话里的 `/compact`，也没有重新测试截图中的那一回合。当前结论是源码修复、生产输入形状回放和隔离文件系统验证完成，不能宣称全部 CLI 版本或所有操作系统均实机验收。

状态之外的周期审查仍**尚未启用**：完整提示词与每周一 10:00（Asia/Shanghai）配置已准备，但当前没有可调用的任务创建接口；应用控制初始化失败，备用应用查询亦未返回结果。没有平台任务 ID、启用状态或下次运行时间的读回证明。具体接入步骤和 Pier 独立功能范围见 [周期审查接入范围](2026-09-06-pier-scheduled-review-scope.md)。

后续审查应优先跟踪已安装 CLI 的真实版本变化、Claude 普通权限闭环、Codex 原生 Interrupt 与异步事件排序，继续以原生证据和可复现轨迹判断，不把本轮全绿当作状态实现永远完备。
