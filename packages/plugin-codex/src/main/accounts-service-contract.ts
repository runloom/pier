import type {
  AddAccountPayload,
  CodexAccountsSnapshot,
  RemoveAccountPayload,
  SelectAccountPayload,
} from "../shared/accounts.ts";
import type { CodexLegacyMigrationAdapter } from "./legacy-migration.ts";
import type { CodexAccountsStateStore } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

export interface CodexAccountsServiceOpts {
  ensureUsageEnv?: () => Promise<void>;
  hasVisibleTarget?: () => boolean;
  legacyMigration?: CodexLegacyMigrationAdapter;
  logger?: {
    warn(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
  };
  managedBaseDir: string;
  onChanged: (snapshot: CodexAccountsSnapshot) => void;
  provider: AgentAccountProvider;
  stateStore: CodexAccountsStateStore;
}

export interface CodexAccountsService {
  add(payload: AddAccountPayload): Promise<void>;
  cancelLogin(): Promise<void>;
  dispose(): void;
  flush(): Promise<void>;
  init(): Promise<void>;
  refreshAllUsage(options?: { force?: boolean }): Promise<void>;
  refreshUsage(options?: {
    accountId?: string;
    force?: boolean;
  }): Promise<void>;
  remove(payload: RemoveAccountPayload): Promise<void>;
  select(payload: SelectAccountPayload): Promise<void>;
  snapshot(): CodexAccountsSnapshot;
}
