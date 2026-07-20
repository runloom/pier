import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import writeFileAtomic from "write-file-atomic";

const execFileAsync = promisify(execFile);

/**
 * Claude Code stores its active OAuth credential differently per platform
 * (verified across claude-switch / cc-switch / ccswitch / ccm and the official
 * docs, 2026):
 *
 * - macOS: encrypted login Keychain, generic-password service
 *   `Claude Code-credentials`, account = `$USER`. File-swapping alone does not
 *   switch accounts on macOS — the Keychain entry must be rewritten.
 * - Linux / Windows: `~/.claude/.credentials.json` (mode 0600), or
 *   `$CLAUDE_CONFIG_DIR/.credentials.json`.
 *
 * The payload is a JSON envelope: `{ "claudeAiOauth": { accessToken, ... } }`
 * (plus an optional `mcpOAuth`). This module abstracts the read/write of that
 * envelope behind a single backend so the provider is platform-agnostic.
 */
export interface ClaudeCredentialBackend {
  /** Human label for diagnostics ("keychain" / file path). */
  readonly kind: "file" | "keychain";
  /** Returns the raw credential envelope JSON, or null when absent. */
  read(): Promise<string | null>;
  /** Overwrites the active credential envelope with `content`. */
  write(content: string): Promise<void>;
}

export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface KeychainRunner {
  /** Runs `security` with args; resolves stdout, rejects on non-zero exit. */
  run(args: string[]): Promise<string>;
}

export function createSecurityKeychainRunner(): KeychainRunner {
  return {
    async run(args) {
      const { stdout } = await execFileAsync("security", args, {
        maxBuffer: 1024 * 1024,
      });
      return stdout;
    },
  };
}

/** `security` exits 44 (errSecItemNotFound) when the entry does not exist. */
const SECURITY_EXIT_ITEM_NOT_FOUND = 44;

function isKeychainItemNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  if (code === SECURITY_EXIT_ITEM_NOT_FOUND) {
    return true;
  }
  return (
    error instanceof Error &&
    /could not be found|errSecItemNotFound/i.test(error.message)
  );
}

/**
 * macOS Keychain backend. Reads/writes the generic-password entry Claude Code
 * itself uses. Note: on write the token is briefly visible as a process
 * argument — an unavoidable limitation of the `security` CLI shared by every
 * account-switcher tool.
 */
export function createKeychainBackend(options: {
  account: string;
  runner?: KeychainRunner;
  service?: string;
}): ClaudeCredentialBackend {
  const service = options.service ?? CLAUDE_KEYCHAIN_SERVICE;
  const account = options.account;
  const runner = options.runner ?? createSecurityKeychainRunner();
  return {
    kind: "keychain",
    async read() {
      try {
        const stdout = await runner.run([
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        const value = stdout.replace(/\n$/, "");
        return value.length > 0 ? value : null;
      } catch (error) {
        // Only "item not found" is a legitimate absent state. Locked
        // keychain / ACL denials must throw: callers (materialize pre-read)
        // rely on distinguishing "absent" from "cannot read" to avoid
        // skipping the torn-write rollback.
        if (isKeychainItemNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async write(content) {
      // `-U` updates the entry in place when it already exists.
      await runner.run([
        "add-generic-password",
        "-U",
        "-s",
        service,
        "-a",
        account,
        "-w",
        content,
      ]);
    },
  };
}

/** Linux/Windows (and macOS keychain-unavailable) file backend. */
export function createFileBackend(path: string): ClaudeCredentialBackend {
  return {
    kind: "file",
    async read() {
      try {
        return await readFile(path, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async write(content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, content, { mode: 0o600 });
    },
  };
}

export interface ResolveCredentialBackendOptions {
  /** OS username for the keychain account field (default: resolved from env). */
  account?: string | undefined;
  /** `~/.claude/.credentials.json` path for the file backend. */
  credentialsFilePath: string;
  /** Force a backend (tests / non-standard installs). */
  forceKind?: "file" | "keychain" | undefined;
  platform?: NodeJS.Platform;
  /** Hydrated login-shell env from the host (preferred over process.env). */
  processEnv?: Readonly<Record<string, string | undefined>> | undefined;
  runner?: KeychainRunner | undefined;
}

/**
 * Resolve the keychain account (OS username). An empty account would silently
 * target a generic-password entry Claude Code never reads, so failing loudly
 * is safer than returning "".
 */
function resolveKeychainAccount(
  options: ResolveCredentialBackendOptions
): string {
  const account =
    options.account ??
    options.processEnv?.USER ??
    process.env.USER ??
    userInfo().username;
  if (!account) {
    throw new Error(
      "Could not resolve the OS username for the Claude Code keychain entry"
    );
  }
  return account;
}

/**
 * Pick the backend Claude Code actually reads from: Keychain on macOS,
 * `.credentials.json` elsewhere. A present credentials file always wins (some
 * macOS installs run keychain-less), matching Claude Code's own fallback.
 */
export function resolveCredentialBackend(
  options: ResolveCredentialBackendOptions
): ClaudeCredentialBackend {
  if (options.forceKind === "file") {
    return createFileBackend(options.credentialsFilePath);
  }
  if (options.forceKind === "keychain") {
    return createKeychainBackend({
      account: resolveKeychainAccount(options),
      ...(options.runner ? { runner: options.runner } : {}),
    });
  }
  const platform = options.platform ?? process.platform;
  if (platform === "darwin" && !existsSync(options.credentialsFilePath)) {
    return createKeychainBackend({
      account: resolveKeychainAccount(options),
      ...(options.runner ? { runner: options.runner } : {}),
    });
  }
  return createFileBackend(options.credentialsFilePath);
}
