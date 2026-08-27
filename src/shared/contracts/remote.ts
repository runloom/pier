import type { PierCapability, PierClientKind } from "./permissions.ts";

export type PierCompanionShell = "app" | "miniprogram" | "web";

export interface PierPairedDevice {
  capabilities: PierCapability[];
  createdAt: number;
  deviceId: string;
  lastSeenAt: number;
  name: string;
  shell: PierCompanionShell;
  tokenEpoch: number;
  tokenHash: string;
}

export interface PierRemoteSession {
  capabilities: PierCapability[];
  clientId: string;
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  kind: PierClientKind;
  tokenEpoch: number;
}

export interface PierPairingRequest {
  code: string;
  requestedCapabilities: PierCapability[];
  shell?: PierCompanionShell;
}
