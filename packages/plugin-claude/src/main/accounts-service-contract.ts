import type {
  ClaudeAccountsSnapshot,
  CompleteLoginPayload,
  RefreshUsagePayload,
  RemoveAccountPayload,
  SelectAccountPayload,
} from "../shared/accounts.ts";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import type { FetchImpl } from "./oauth.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";

export interface ClaudeAccountsServiceOpts {
  /** Test seam for OAuth/usage HTTP (defaults to global fetch). */
  fetchImpl?: FetchImpl | undefined;
  /** Returns false when no widget/settings lease is active (skip polling). */
  hasVisibleTarget?: (() => boolean) | undefined;
  logger?: {
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  managedBaseDir: string;
  onChanged: (snapshot: ClaudeAccountsSnapshot) => void;
  provider: ClaudeAccountProvider;
  stateStore: ClaudeAccountsStateStore;
}

export interface ClaudeAccountsService {
  /**
   * Start adding an account. `kind: "oauth"` (default) begins the browser
   * PKCE login — the snapshot's `login.authorizeUrl` appears and the login
   * completes via `completeLogin`. `kind: "import"` imports the current CLI
   * login immediately.
   */
  add(payload?: { kind?: "oauth" | "import" | undefined }): Promise<void>;
  /** Import the currently signed-in Claude CLI account into managed accounts. */
  adoptCurrent(): Promise<void>;
  cancelLogin(): Promise<void>;
  /** Finish the browser OAuth login with the pasted authorization code. */
  completeLogin(payload: CompleteLoginPayload): Promise<void>;
  dispose(): void;
  flush(): Promise<void>;
  init(): Promise<void>;
  refreshAllUsage(options?: { force?: boolean }): Promise<void>;
  refreshUsage(options?: RefreshUsagePayload): Promise<void>;
  remove(payload: RemoveAccountPayload): Promise<void>;
  select(payload: SelectAccountPayload): Promise<void>;
  snapshot(): ClaudeAccountsSnapshot;
}
