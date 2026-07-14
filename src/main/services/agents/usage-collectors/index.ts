import { createLogger, type Logger } from "@shared/logger.ts";
import type { UsageDataService } from "../../usage-data/usage-data-service.ts";
import { AGENT_USAGE_COLLECTOR_FACTORIES } from "./registry.ts";
import type { AgentUsageCollector } from "./types.ts";

/**
 * Agent usage collector runner：把 registry 里的每个 collector 挂到宿主
 * `UsageDataService`，并在启动时异步 kickoff 一次首扫。
 *
 * lifecycle：
 * - `start()`：对每个 collector `registerBuiltInSource` + `setTimeout` 首扫。
 *   同 collector 重复 start 幂等（内部 disposer 保护）。
 * - `dispose()`：清所有 timer + 摘掉 registrations。
 *
 * 单个 collector rescan 失败不影响其他 collector（Promise.allSettled 语义
 * 由 `UsageSourceRegistry.refreshAll` 自身保证；本 runner 只负责 wire）。
 */

export interface AgentUsageCollectorRunnerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  readonly usageData: UsageDataService;
  readonly userDataDir: string;
}

export interface AgentUsageCollectorRunner {
  /** 已构造出的 collector 列表（测试与诊断可用）。 */
  readonly collectors: readonly AgentUsageCollector[];
  dispose(): void;
  start(): void;
}

/** 首次扫描的让出时间。让 renderer 就绪信号先跑完，避免拖慢 startup。 */
const INITIAL_SCAN_DELAY_MS = 1000;

export function createAgentUsageCollectorRunner(
  options: AgentUsageCollectorRunnerOptions
): AgentUsageCollectorRunner {
  const log = options.logger ?? createLogger("usage-data.agent-collectors");
  const env = options.env ?? process.env;
  const collectors: AgentUsageCollector[] = AGENT_USAGE_COLLECTOR_FACTORIES.map(
    (factory) =>
      factory({
        env,
        logger: log,
        userDataDir: options.userDataDir,
      })
  );
  const disposers = new Set<() => void>();
  const timers = new Set<NodeJS.Timeout>();

  async function rescanCollector(
    collector: AgentUsageCollector,
    kind: "initial" | "refresh"
  ): Promise<void> {
    try {
      const input = await collector.rescan();
      if (input) {
        options.usageData.publishBuiltIn(input);
      } else {
        options.usageData.clearBuiltIn(collector.sourceId, { kind: "machine" });
      }
    } catch (error: unknown) {
      log.warn(`agent usage scan failed [${kind}]`, {
        agentId: collector.agentId,
        error: error instanceof Error ? error.message : error,
      });
      if (kind === "refresh") throw error;
    }
  }

  return {
    collectors,
    dispose(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const dispose of disposers) dispose();
      disposers.clear();
    },
    start(): void {
      if (disposers.size > 0) return;
      for (const collector of collectors) {
        const dispose = options.usageData.registerBuiltInSource({
          id: collector.sourceId,
          rescan: () => rescanCollector(collector, "refresh"),
        });
        disposers.add(dispose);
        const timer = setTimeout(() => {
          timers.delete(timer);
          rescanCollector(collector, "initial").catch(() => {
            // rescanCollector 已日志；initial 阶段吞掉，避免污染 startup。
          });
        }, INITIAL_SCAN_DELAY_MS);
        timers.add(timer);
      }
    },
  };
}

export type { AgentUsageCollector } from "./types.ts";
