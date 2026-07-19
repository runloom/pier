/**
 * Panel transfer registration type for plugin panels.
 *
 * Extracted from `renderer-panels.ts` so the workspace can import the type
 * without pulling the full plugin panel surface (and vice versa). The
 * workspace re-exports a richer `CorePanelTransferRegistration` (adds
 * `kind: "terminal"` for core-internal use) from
 * `src/renderer/components/workspace/panel-transfer-adapters.ts`.
 *
 * External plugins MUST NOT declare `kind: "terminal"`; the workspace
 * resolver rejects it.
 */

import type {
  JsonValue,
  PanelTransferPhase,
  PanelTransferPreparedSource,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";

export interface PluginPanelTransferParamsSourceInput {
  panelId: string;
  params: Readonly<Record<string, unknown>>;
  transferId: string;
}

export interface PluginPanelTransferCustomRestoreInput {
  panelId: string;
  phase: PanelTransferPhase;
  role: "source" | "target";
  snapshot: PanelTransferSourceSnapshot;
  transferId: string;
}

export interface PluginPanelTransferCustomReleaseInput {
  panelId: string;
  remainingParams: readonly Readonly<Record<string, unknown>>[];
  transferId: string;
}

export interface PluginPanelTransferCustomFinalizeInput {
  outcome: "commit" | "abort";
  panelId: string;
  role: "source" | "target";
  transferId: string;
}

export type PanelTransferRegistration =
  | { kind: "params" }
  | {
      kind: "custom";
      prepareSource(
        input: PluginPanelTransferParamsSourceInput
      ): Promise<PanelTransferPreparedSource>;
      stageTarget(input: {
        transferId: string;
        panelId: string;
        params: Readonly<Record<string, unknown>>;
        prepared: PanelTransferPreparedSource;
      }): Promise<{ params?: Readonly<Record<string, JsonValue>> } | undefined>;
      restore(input: PluginPanelTransferCustomRestoreInput): Promise<void>;
      releaseSource?(
        input: PluginPanelTransferCustomReleaseInput
      ): Promise<void>;
      finalize(input: PluginPanelTransferCustomFinalizeInput): Promise<void>;
    };
