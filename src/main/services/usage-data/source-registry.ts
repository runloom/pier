import { createLogger } from "@shared/logger.ts";

const log = createLogger("usage-data.source-registry");

/**
 * 注册到宿主 usage-data 域的采集源。id 在 registry 层被 pluginId 前缀作用域化，
 * 由 host facade 保证：外部只能覆盖自己 pluginId 下的 sourceId。
 */
export interface UsageSource {
  readonly id: string;
  rescan(): Promise<void>;
}

export interface UsageSourceRegistry {
  list(): readonly UsageSource[];
  refreshAll(): Promise<void>;
  register(source: UsageSource): () => void;
}

/**
 * 内存态源注册表。fan-out `refreshAll` 到全部源并等待任意一个失败向上抛，
 * 但不因一个源失败短路其他源（Promise.allSettled）。所有源 rescan 完成后
 * 若存在失败，则以第一个失败构造错误抛出——rescan 是幂等 IO 调用。
 */
export function createUsageSourceRegistry(): UsageSourceRegistry {
  const sources = new Map<string, UsageSource>();
  return {
    list: () => [...sources.values()],
    register(source) {
      if (sources.has(source.id)) {
        log.warn("duplicate usage source id, ignoring", { id: source.id });
        return () => undefined;
      }
      sources.set(source.id, source);
      return () => {
        if (sources.get(source.id) === source) {
          sources.delete(source.id);
        }
      };
    },
    async refreshAll() {
      const results = await Promise.allSettled(
        [...sources.values()].map((source) => source.rescan())
      );
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        }
      }
    },
  };
}
