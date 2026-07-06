import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { agentAccountSchema } from "@shared/contracts/agent-accounts.ts";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const agentAccountsFileStateSchema = z.object({
  accounts: z.array(agentAccountSchema),
  activeAccountId: z.string().min(1).nullable(),
  version: z.literal(1),
});

export type AgentAccountsFileState = z.infer<
  typeof agentAccountsFileStateSchema
>;

const DEFAULTS: AgentAccountsFileState = {
  accounts: [],
  activeAccountId: null,
  version: 1,
};

export interface AgentAccountsStateStore {
  flush(): Promise<void>;
  get(): AgentAccountsFileState;
  init(): Promise<AgentAccountsFileState>;
  mutate(
    fn: (state: AgentAccountsFileState) => AgentAccountsFileState
  ): AgentAccountsFileState;
}

/**
 * 工厂——单测注入临时路径，生产走 getDefaultStore。
 * 对齐 terminal-status-bar-prefs.ts 的 createTerminalStatusBarPrefsStore 模式。
 */
export function createAgentAccountsStateStore(
  filePath: string
): AgentAccountsStateStore {
  const store: DebouncedJsonStore<AgentAccountsFileState> = debouncedJsonStore({
    defaults: DEFAULTS,
    filePath,
  });

  return {
    async init(): Promise<AgentAccountsFileState> {
      const raw = await store.init();
      // Zod 校验——schema 不符（如未来版本 version:2、字段损坏）时回退默认值。
      const result = agentAccountsFileStateSchema.safeParse(raw);
      if (!result.success) {
        // 直接 replace(DEFAULTS) 会把空注册表原子写覆盖磁盘，账号记录永久丢失，
        // 而托管凭据目录 agent-accounts/codex/<id> 成孤儿无从恢复。
        // 先把原文件改名备份（保留可恢复的账号记录），再重置内存态。
        if (existsSync(filePath)) {
          const backupPath = `${filePath}.corrupt-${Date.now()}`;
          try {
            await rename(filePath, backupPath);
            console.error(
              `[agent-accounts] 状态文件 schema 校验失败，已备份到 ${backupPath} 并重置；托管凭据目录保留，可手动恢复`
            );
          } catch (err) {
            console.error(
              "[agent-accounts] 状态文件损坏且备份失败，仍将重置为默认值：",
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        store.replace(DEFAULTS);
        return DEFAULTS;
      }
      return result.data;
    },
    get: () => store.get(),
    mutate: (fn) => store.mutate(fn),
    flush: () => store.flush(),
  };
}

// 刻意不提供模块级默认单例：唯一 store 实例由 app-core 创建并注入服务。
// 双实例（各自独立 dirty/flush 状态）写同一磁盘文件是隐性数据竞争。
