import type {
  AddAccountPayload,
  GrokAccountsSnapshot,
  RemoveAccountPayload,
  SelectAccountPayload,
  SyncToPeersPayload,
} from "../shared/accounts.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import type { GrokAccountsStateStore } from "./state.ts";

export interface GrokAccountsServiceOpts {
  hasVisibleTarget?: () => boolean;
  logger?: {
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  managedBaseDir: string;
  onChanged: (snapshot: GrokAccountsSnapshot) => void;
  provider: GrokAccountProvider;
  stateStore: GrokAccountsStateStore;
}

export interface GrokAccountsService {
  add(payload: AddAccountPayload): Promise<void>;
  /** Import the current local CLI login into managed accounts and activate it. */
  adoptCurrent(): Promise<void>;
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
  snapshot(): GrokAccountsSnapshot;
  /** Mirror the managed account credential into peer tools without switching Grok. */
  syncToPeers(payload: SyncToPeersPayload): Promise<void>;
}
