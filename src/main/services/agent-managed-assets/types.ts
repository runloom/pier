import type { AssetRootRef } from "@shared/contracts/agent/assets.ts";

export type ProjectRoot = Extract<AssetRootRef, { scope: "project" }>;

export interface TargetRow {
  configPath: string;
  consumers: string[];
  detail?: string;
  outcome: "written" | "removed" | "failed" | "skipped";
}

export interface ReconcileReport {
  kind: "report";
  state: "disabled" | "enabled" | "degraded";
  targets: TargetRow[];
}

export interface NeedsConfirmation {
  kind: "needsConfirmation";
  trackedTargets: string[];
}

export interface StatusSnapshot {
  desiredState: "enabled" | "disabled";
  state: "disabled" | "enabled" | "degraded";
  storePath: string;
  targets: TargetRow[];
}
