import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Append-only JSON Lines audit log at `{userData}/plugins/operation-log.jsonl`
 * (design §6 / Global Constraint 12). Minimal audit trail, not a policy engine.
 * Never records auth tokens, safeStorage ciphertext, or other secret material.
 */

export type ManagedPluginOperationActorKind =
  | "desktop-renderer"
  | "cli-local"
  | "startup";

export type ManagedPluginOperation =
  | "install"
  | "install-from-bundle"
  | "update"
  | "rollback"
  | "uninstall"
  | "enable"
  | "disable"
  | "devOverride.set"
  | "devOverride.clear"
  | "seed-install"
  | "reconciliation";

export type ManagedPluginOperationResult = "success" | "denied" | "failed";

export interface ManagedPluginOperationLogRecord {
  actorKind: ManagedPluginOperationActorKind;
  assetUrl?: string;
  diagnosticId?: string;
  fromVersion?: string;
  officialIndexSequence?: number;
  operation: ManagedPluginOperation;
  pluginId: string;
  result: ManagedPluginOperationResult;
  sha256?: string;
  signingKeyId?: string;
  timestamp: number;
  toVersion?: string;
}

export interface ManagedPluginOperationLog {
  append(record: ManagedPluginOperationLogRecord): Promise<void>;
}

export function createManagedPluginOperationLog(
  filePath: string
): ManagedPluginOperationLog {
  return {
    async append(record: ManagedPluginOperationLogRecord): Promise<void> {
      if (!existsSync(dirname(filePath))) {
        await mkdir(dirname(filePath), { recursive: true });
      }
      await appendFile(filePath, `${JSON.stringify(record)}\n`);
    },
  };
}
