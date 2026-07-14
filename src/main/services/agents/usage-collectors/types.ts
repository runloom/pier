import type { UsageDataPublishInput } from "@pier/plugin-api/main";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { Logger } from "@shared/logger.ts";

/**
 * Agent 会话用量采集器统一接口。
 *
 * 定位：宿主内置的 agent-usage 数据源，读用户本机的 AI CLI 会话日志
 * （`~/.codex/sessions`、`~/.claude/projects` 等），把原始 token 观测发布进
 * `usage-data-service`。设计约束（对齐 `integrations/AgentHookIntegration`）：
 * - 每个 agent 一个模块（`<agent-id>.ts`）+ registry 一行。
 * - factory 拿 host context 返回 collector；host 负责 lifecycle。
 * - collector 无 agent 特定输出——所有 collector 都产出 `UsageDataPublishInput`,
 *   由 usage-data-service 统一存盘 + 计价。
 * - `rescan` 幂等；缺目录/无数据返回 `null`（不当异常）。
 *
 * 与 `AgentHookIntegration` 的区别：Hook 是 shell integration 层，负责生命
 * 周期事件（session start / tool use / stop）；Collector 是历史用量读取层，
 * 只读磁盘上的会话日志，不与 CLI 进程交互。二者互不依赖。
 */
export interface AgentUsageCollector {
  readonly agentId: AgentKind;
  /** 检测目标目录是否存在。用于诊断日志，不用于 rescan 决策（rescan 自身容错）。 */
  detect(): boolean;
  /** 扫描并组装 publish 输入；无数据（目录不存在 / 无观测）返回 null。 */
  rescan(): Promise<UsageDataPublishInput | null>;
  /** usage-data-service 上的 source id（scoped 前缀为 `pier.core/`）。 */
  readonly sourceId: string;
}

export interface AgentUsageCollectorFactoryContext {
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
  /** 通常是 electron `userData`；collector 用来放增量扫描缓存文件。 */
  readonly userDataDir: string;
}

/**
 * factory 形态：拿 host context 构造 collector。allow-per-agent 私有 state
 * （如 in-flight promise coalescing）驻留 factory 闭包。
 */
export type AgentUsageCollectorFactory = (
  context: AgentUsageCollectorFactoryContext
) => AgentUsageCollector;
