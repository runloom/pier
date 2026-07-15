import { z } from "zod/mini";

/**
 * Plugin-local Grok account DTOs. Intentionally duplicated from any host
 * contracts so the plugin does not import host modules.
 */

export type GrokAccountKind = "oidc" | "api_key";

export type GrokAccountStatus =
  | "active"
  | "available"
  | "login-pending"
  | "error";

export interface GrokUsageWindow {
  id: string;
  limitId: string;
  limitName?: string | undefined;
  resetsAt?: number | undefined;
  usedPercent: number;
  windowMinutes?: number | undefined;
}

export interface GrokUsageSnapshot {
  error?: string | undefined;
  fetchedAt: number;
  raw?: unknown;
  status: "ok" | "error";
  windows: GrokUsageWindow[];
}

export interface GrokAccountSummary {
  email?: string | undefined;
  error?: string | null | undefined;
  id: string;
  kind: GrokAccountKind;
  label: string;
  status: GrokAccountStatus;
  teamId?: string | undefined;
  /** null = first usage request not finished; object = completed (ok or error). */
  usage?: GrokUsageSnapshot | null | undefined;
}

export interface GrokLoginState {
  mode: "oauth" | "device";
  provider: "grok";
  startedAt: number;
}

export interface GrokAccountsSnapshot {
  accounts: GrokAccountSummary[];
  activeAccountId: string | null;
  activeUsage?: GrokUsageSnapshot | null | undefined;
  lastLoginError?: { at: number; message: string } | null | undefined;
  login: GrokLoginState | null;
  revision: number;
  schemaVersion: 1;
}

export type AddAccountPayload =
  | { kind?: "oidc" | undefined; mode?: "oauth" | "device" | undefined }
  | { apiKey: string; kind: "api_key"; label?: string | undefined };

/**
 * Peer tools that can receive a mirrored Grok/xAI credential.
 * - `"grok"` is the primary switch (materialize), not a peer write target.
 * - opencode / pi / omp store xAI oauth or api_key under tool-specific keys.
 */
export type CrossToolSyncTarget = "grok" | "opencode" | "pi" | "omp";

export const ALL_SYNC_TARGETS: readonly Exclude<CrossToolSyncTarget, "grok">[] =
  ["opencode", "pi", "omp"];

export type PeerSyncTarget = (typeof ALL_SYNC_TARGETS)[number];

export interface SyncToPeersPayload {
  accountId?: string | undefined;
  syncTargets: readonly PeerSyncTarget[];
}

export interface SelectAccountPayload {
  accountId: string;
  /** Optional peer tools to mirror credentials into. Defaults to none. */
  syncTargets?: readonly PeerSyncTarget[] | undefined;
}

export interface RemoveAccountPayload {
  accountId: string;
}

export interface RefreshUsagePayload {
  accountId?: string | undefined;
  force?: boolean | undefined;
}

export interface UsagePollingPayload {
  consumerId: string;
}

const nonEmptyStringSchema = z.string().check(z.minLength(1));
const peerSyncTargetSchema = z.enum(["opencode", "pi", "omp"]);

export const addAccountPayloadSchema = z.union([
  z.strictObject({
    kind: z.optional(z.literal("oidc")),
    mode: z.optional(z.enum(["oauth", "device"])),
  }),
  z.strictObject({
    apiKey: nonEmptyStringSchema,
    kind: z.literal("api_key"),
    label: z.optional(z.string()),
  }),
]);

export const selectAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
  syncTargets: z.optional(z.array(peerSyncTargetSchema)),
});

export const syncToPeersPayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
  syncTargets: z.array(peerSyncTargetSchema).check(z.minLength(1)),
});

export const removeAccountPayloadSchema = z.strictObject({
  accountId: nonEmptyStringSchema,
});

export const refreshUsagePayloadSchema = z.strictObject({
  accountId: z.optional(nonEmptyStringSchema),
  force: z.optional(z.boolean()),
});

export const usagePollingPayloadSchema = z.strictObject({
  consumerId: z.string().check(z.minLength(1), z.maxLength(200)),
});

export const emptyRpcPayloadSchema = z.null();
