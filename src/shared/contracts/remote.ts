import type { PierCapability, PierClientKind } from "./permissions.ts";

export interface PierRemoteSession {
  capabilities: PierCapability[];
  clientId: string;
  createdAt: number;
  expiresAt?: number;
  kind: PierClientKind;
}

export interface PierPairingRequest {
  code: string;
  requestedCapabilities: PierCapability[];
}
