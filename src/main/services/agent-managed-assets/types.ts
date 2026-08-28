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

export interface StatusSnapshot {
  derivedState: "disabled" | "enabled" | "degraded";
  desiredState: "enabled" | "disabled";
  enginePackage: string;
  entityCount: number | null;
  observationCount: number | null;
  storePath: string;
  /** 面向展示的路径(家目录折叠为 `~`);打开/定位仍用 storePath。 */
  storePathDisplay: string;
  targets: TargetRow[];
}
