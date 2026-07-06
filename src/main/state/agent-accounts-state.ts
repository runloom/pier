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
      // Zod 校验——损坏/版本不匹配时回退默认值
      const result = agentAccountsFileStateSchema.safeParse(raw);
      if (!result.success) {
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
