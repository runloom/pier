import { createLogger } from "@shared/logger.ts";
import { createAgentUsageCollectorRunner } from "../services/agents/usage-collectors/index.ts";
import {
  createUsageDataService,
  type UsageDataService,
} from "../services/usage-data/usage-data-service.ts";
import { requireAppCoreInitialization } from "./app-core-readiness.ts";

interface AppCoreUsageData {
  ready: Promise<void>;
  usageData: UsageDataService;
}

/** 组装宿主用量服务，并在持久化初始化完成后启动内置 AI CLI 采集器。 */
export function createAppCoreUsageData(userDataDir: string): AppCoreUsageData {
  const usageData = createUsageDataService({ userDataDir });
  const collectors = createAgentUsageCollectorRunner({
    logger: createLogger("usage-data.agent-collectors"),
    usageData,
    userDataDir,
  });
  const ready = requireAppCoreInitialization(
    usageData.init().then(() => collectors.start()),
    (error) => console.error("[usage-data] init failed:", error)
  );
  return { ready, usageData };
}
