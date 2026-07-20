import { existsSync, type FSWatcher, mkdirSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import {
  type ClaudeCredentialBackend,
  resolveCredentialBackend,
} from "./credential-store.ts";
import {
  type AccountIdentity,
  type ManagedClaudeCredential,
  parseIdentityFromOauthAccount,
  parseManagedCredential,
  parseManagedIdentity,
  readOauthAccountFromClaudeJson,
  serializeManagedCredential,
} from "./identity.ts";
import { parseCredentialEnvelope } from "./oauth.ts";

/**
 * Claude account provider. Mirrors the Codex/Grok provider contract, with the
 * "real CLI home auth file" substituted by the active credential store
 * (Keychain on macOS / `.credentials.json` elsewhere) plus the `oauthAccount`
 * identity cache in `~/.claude.json`.
 *
 * Accounts are added via the browser OAuth (PKCE) flow (`importAccount`) or
 * by importing the current CLI login (`readCurrentIdentity` + `syncBack`).
 * Switching restores a saved credential into the active store and rewrites
 * `oauthAccount`; Claude sessions must be restarted to pick it up.
 */
export interface ClaudeAccountProvider {
  deleteCredential(accountHomeDir: string): Promise<void>;
  /**
   * True when this device is deliberately configured for API-key auth
   * (ANTHROPIC_API_KEY in the login-shell env, or `primaryApiKey` in
   * `~/.claude.json`) — Claude sessions may then ignore the OAuth account.
   */
  detectApiKeyMode(): Promise<boolean>;
  /** Store an OAuth-login result (envelope + identity) as a managed account. */
  importAccount(
    accountHomeDir: string,
    envelope: string,
    oauthAccount: Record<string, unknown>
  ): Promise<void>;
  materialize(accountHomeDir: string): Promise<void>;
  /** Raw envelope currently in the active store (freshness comparison). */
  readCurrentCredentialRaw(): Promise<string | null>;
  readCurrentIdentity(): Promise<AccountIdentity | null>;
  readIdentity(accountHomeDir: string): Promise<AccountIdentity | null>;
  /** Raw credential envelope for one managed account (usage fetch input). */
  readManagedCredentialRaw(accountHomeDir: string): Promise<string | null>;
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "no-login" | "ok">;
  watchExternalAuth(cb: () => void): () => void;
  /** Mirror a rotated envelope into the active store (token refresh path). */
  writeCurrentCredentialRaw(envelope: string): Promise<void>;
  /** Persist a rotated envelope, keeping the stored oauthAccount intact. */
  writeManagedCredentialRaw(
    accountHomeDir: string,
    envelope: string
  ): Promise<void>;
}

export interface CreateClaudeProviderOpts {
  backend?: ClaudeCredentialBackend;
  claudeJsonPath?: string;
  credentials: {
    delete(key: string): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  credentialsFilePath?: string;
  logger?: { warn(message: string, ...args: unknown[]): void };
  /** Hydrated login-shell env from the host (mirrors the Grok provider). */
  processEnv?: Readonly<Record<string, string | undefined>>;
}

function resolveConfigDirOverride(
  processEnv: Readonly<Record<string, string | undefined>> | undefined
): string | undefined {
  return processEnv?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
}

function defaultConfigDir(
  processEnv: Readonly<Record<string, string | undefined>> | undefined
): string {
  return resolveConfigDirOverride(processEnv) ?? join(homedir(), ".claude");
}

function defaultClaudeJsonPath(
  processEnv: Readonly<Record<string, string | undefined>> | undefined
): string {
  const configDir = resolveConfigDirOverride(processEnv);
  return configDir
    ? join(configDir, ".claude.json")
    : join(homedir(), ".claude.json");
}

export function createClaudeProvider(
  opts: CreateClaudeProviderOpts
): ClaudeAccountProvider {
  const credentials = opts.credentials;
  const logger = opts.logger;
  const claudeJsonPath =
    opts.claudeJsonPath ?? defaultClaudeJsonPath(opts.processEnv);
  const credentialsFilePath =
    opts.credentialsFilePath ??
    join(defaultConfigDir(opts.processEnv), ".credentials.json");
  const backend =
    opts.backend ??
    resolveCredentialBackend({
      credentialsFilePath,
      ...(opts.processEnv ? { processEnv: opts.processEnv } : {}),
    });

  // Per-home-dir credential lock (identical shape to Codex/Grok providers):
  // serializes read-modify-write of the same account's stored credential.
  const credentialTails = new Map<string, Promise<void>>();
  async function withCredentialLock<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = credentialTails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    credentialTails.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (credentialTails.get(key) === current) {
        credentialTails.delete(key);
      }
    }
  }

  function credentialKey(accountHomeDir: string): string {
    return `accounts/${accountHomeDir.split(/[\\/]/).at(-1)}/credential`;
  }

  async function readManagedCredential(
    accountHomeDir: string
  ): Promise<ManagedClaudeCredential | null> {
    const stored = await credentials.get(credentialKey(accountHomeDir));
    return stored ? parseManagedCredential(stored) : null;
  }

  async function readClaudeJson(): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(claudeJsonPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* missing or corrupt → start fresh */
    }
    return {};
  }

  /** Restore an account's `oauthAccount` block into `~/.claude.json`, keeping
   *  all other fields (settings, history, MCP config) untouched. */
  async function writeOauthAccount(
    oauthAccount: Record<string, unknown> | null
  ): Promise<void> {
    const root = await readClaudeJson();
    if (oauthAccount) {
      root.oauthAccount = oauthAccount;
    } else {
      root.oauthAccount = undefined;
    }
    const dir = dirname(claudeJsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await writeFileAtomic(claudeJsonPath, JSON.stringify(root, null, 2), {
      mode: 0o600,
    });
  }

  async function readCurrentManagedCredential(): Promise<ManagedClaudeCredential | null> {
    const credential = await backend.read();
    if (!credential) {
      return null;
    }
    // Only a usable claude.ai OAuth envelope counts as a login. The store can
    // hold non-OAuth content (API-key-mode installs) and `~/.claude.json`
    // keeps a stale `oauthAccount` cache after logout — trusting that cache
    // without a valid envelope surfaces the wrong account.
    const parsed = parseCredentialEnvelope(credential);
    if (!parsed) {
      return null;
    }
    if (
      parsed.expiresAt !== undefined &&
      parsed.expiresAt <= Date.now() &&
      !parsed.refreshToken
    ) {
      return null;
    }
    const oauthAccount = readOauthAccountFromClaudeJson(
      await readFile(claudeJsonPath, "utf-8").catch(() => "{}")
    );
    return { credential, oauthAccount };
  }

  return {
    async detectApiKeyMode(): Promise<boolean> {
      // The hydrated env replaces (not overlays) process.env when provided.
      const envSource = opts.processEnv ?? process.env;
      const envKey = envSource.ANTHROPIC_API_KEY;
      if (envKey && envKey.length > 0) {
        return true;
      }
      const root = await readClaudeJson();
      // `primaryApiKey` is a deliberate API-key configuration; historical
      // `customApiKeyResponses` approvals are intentionally NOT a signal
      // (they persist after switching back to subscription auth).
      return (
        typeof root.primaryApiKey === "string" && root.primaryApiKey.length > 0
      );
    },

    async readCurrentIdentity(): Promise<AccountIdentity | null> {
      const current = await readCurrentManagedCredential();
      if (!current) {
        return null;
      }
      return parseManagedIdentity(current);
    },

    async readIdentity(
      accountHomeDir: string
    ): Promise<AccountIdentity | null> {
      const managed = await readManagedCredential(accountHomeDir);
      if (!managed) {
        return null;
      }
      return parseManagedIdentity(managed);
    },

    async materialize(accountHomeDir: string): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        const managed = await readManagedCredential(accountHomeDir);
        if (!managed) {
          throw new Error("No stored Claude credential for this account");
        }
        // Two-store write (credential store + ~/.claude.json). If the second
        // write fails, restore the first so the stores never disagree — a
        // torn state would let the next drift capture bind the new token to
        // the old account's identity (silent cross-account corruption).
        // A failing pre-read must abort before any write: without the
        // previous value a torn write could not be rolled back.
        const previousCredential = await backend.read();
        await backend.write(managed.credential);
        try {
          await writeOauthAccount(managed.oauthAccount);
        } catch (error) {
          if (previousCredential !== null) {
            await backend.write(previousCredential).catch(() => undefined);
          }
          throw error;
        }
      });
    },

    async syncBack(
      accountHomeDir: string,
      expectedProviderAccountId: string | undefined
    ): Promise<"identity-mismatch" | "no-login" | "ok"> {
      return await withCredentialLock(accountHomeDir, async () => {
        const current = await readCurrentManagedCredential();
        if (!current) {
          return "no-login";
        }
        // Validate identity from the same read to avoid binding the wrong
        // account's credential (a login could change between reads).
        if (expectedProviderAccountId !== undefined) {
          const identity = parseIdentityFromOauthAccount(
            current.oauthAccount,
            current.credential
          );
          if (identity?.providerAccountId !== expectedProviderAccountId) {
            return "identity-mismatch";
          }
        }
        await credentials.set(
          credentialKey(accountHomeDir),
          serializeManagedCredential(current)
        );
        return "ok";
      });
    },

    async deleteCredential(accountHomeDir: string): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        await credentials.delete(credentialKey(accountHomeDir));
      });
    },

    async importAccount(
      accountHomeDir: string,
      envelope: string,
      oauthAccount: Record<string, unknown>
    ): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        await credentials.set(
          credentialKey(accountHomeDir),
          serializeManagedCredential({ credential: envelope, oauthAccount })
        );
      });
    },

    async readCurrentCredentialRaw(): Promise<string | null> {
      return await backend.read();
    },

    async readManagedCredentialRaw(
      accountHomeDir: string
    ): Promise<string | null> {
      const managed = await readManagedCredential(accountHomeDir);
      return managed?.credential ?? null;
    },

    async writeManagedCredentialRaw(
      accountHomeDir: string,
      envelope: string
    ): Promise<void> {
      await withCredentialLock(accountHomeDir, async () => {
        const managed = await readManagedCredential(accountHomeDir);
        if (!managed) {
          throw new Error("No stored Claude credential for this account");
        }
        await credentials.set(
          credentialKey(accountHomeDir),
          serializeManagedCredential({
            credential: envelope,
            oauthAccount: managed.oauthAccount,
          })
        );
      });
    },

    async writeCurrentCredentialRaw(envelope: string): Promise<void> {
      await backend.write(envelope);
    },

    watchExternalAuth(cb: () => void): () => void {
      // Watch ~/.claude.json (or CLAUDE_CONFIG_DIR/.claude.json): Claude Code
      // rewrites its oauthAccount cache on every launch/login, so this
      // reliably fires on external `/login` / `/logout` even when the actual
      // credential lives in the (unwatchable) macOS Keychain.
      let watcher: FSWatcher | null = null;
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const dir = dirname(claudeJsonPath);
      const filename = claudeJsonPath.split(/[\\/]/).at(-1);
      try {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        watcher = watch(dir, (_eventType, changed) => {
          if (changed !== filename) {
            return;
          }
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(cb, 500);
        });
      } catch (error) {
        logger?.warn(
          "[pier.claude] watchExternalAuth failed, auth drift detection disabled until restart",
          error
        );
      }
      return () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        watcher?.close();
        watcher = null;
      };
    },
  };
}
