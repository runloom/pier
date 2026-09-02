/**
 * Renderer command handlers for cross-window panel transfer
 * (prepareSource / stageTarget / releaseSource / finalize) plus bootstrap.
 */

import type {
  PanelTransferPreparedSource,
  PanelTransferRendererSourceSnapshot,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import type { DockviewApi } from "dockview-react";
import { getPluginPanelRevision } from "@/lib/plugins/panel-registry.ts";
import { flushWorkspaceLayout } from "@/lib/workspace/layout-persistence.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { clearCurrentWindowLayout } from "@/stores/workspace-panel-helpers.ts";
import { panelKindOf } from "../panel-registry.ts";
import { type JsonValue, panelTransferRegistrationOf } from "./adapters.ts";
import { mergeDragStartPanelParams, takeFrozenOfferParams } from "./dnd.ts";
import { resolvePlacementFromClientPoint } from "./placement.ts";
import {
  clearFinalizeRecord,
  clearFrozenSourceSnapshot,
  getFrozenSourceSnapshot,
  getFrozenSourceSnapshotRevision,
  isFinalizeRecorded,
  recordFinalize,
  recordFinalizedGateTombstone,
  releaseWorkspaceBootstrapGate,
  setFrozenSourceSnapshot,
  setPanelRelocationSuppressed,
  setStagedTargetPanel,
  takeStagedTargetPanel,
} from "./runtime.ts";
import {
  type DockviewPanel,
  panelComponentOf,
  panelParamsOf,
  panelTitleOf,
  pierPanelTransfer,
} from "./shared.ts";
import {
  armPanelTransferTearOffClaim,
  clearPanelTransferTearOff,
  hidePanelTransferTearOff,
} from "./tear-off.ts";

function requireApi(): DockviewApi {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    throw new Error("workspace api not ready");
  }
  return api;
}

function findPanel(api: DockviewApi, panelId: string): DockviewPanel | null {
  return api.panels.find((p) => p.id === panelId) ?? null;
}

function buildRendererSourceSnapshot(
  panel: DockviewPanel,
  component: string,
  prepared: PanelTransferPreparedSource,
  resolvedParams: Readonly<Record<string, unknown>>
): PanelTransferRendererSourceSnapshot {
  return {
    panel: {
      componentId: component,
      panelId: panel.id,
      // Use the same live+freeze merge as prepareSource so stageTarget base
      // params keep context/pinned/source when dockview mid-drag drops keys.
      params: resolvedParams as Record<string, JsonValue>,
      title: panelTitleOf(panel),
    },
    runtimeKind: component === "terminal" ? "terminal" : "web",
    prepared,
  };
}

type PrepareSourceCommand = Extract<
  RendererCommandEnvelope["command"],
  { type: "panelTransfer.prepareSource" }
>;
type StageTargetCommand = Extract<
  RendererCommandEnvelope["command"],
  { type: "panelTransfer.stageTarget" }
>;
type ReleaseSourceCommand = Extract<
  RendererCommandEnvelope["command"],
  { type: "panelTransfer.releaseSource" }
>;
type FinalizeCommand = Extract<
  RendererCommandEnvelope["command"],
  { type: "panelTransfer.finalize" }
>;
type ResolvePlacementCommand = Extract<
  RendererCommandEnvelope["command"],
  { type: "panelTransfer.resolvePlacement" }
>;

async function handlePrepareSource(
  command: PrepareSourceCommand
): Promise<PanelTransferRendererSourceSnapshot> {
  const { transferId, sourcePanelId } = command;
  const api = requireApi();
  const panel = findPanel(api, sourcePanelId);
  if (!panel) {
    throw new Error(
      `panelTransfer.prepareSource: panel not found: ${sourcePanelId}`
    );
  }
  const component = panelComponentOf(panel);
  if (!component) {
    throw new Error(
      `panelTransfer.prepareSource: panel has no component: ${sourcePanelId}`
    );
  }
  const reg = panelTransferRegistrationOf(component);
  if (!reg) {
    throw new Error(
      `panelTransfer.prepareSource: component not movable: ${component}`
    );
  }
  const revision = computeAdapterRevision();
  const liveParams = panelParamsOf(panel);
  const frozenParams = takeFrozenOfferParams(transferId);
  const { params: resolvedParams, usedFrozenSource } =
    mergeDragStartPanelParams(liveParams, frozenParams);
  if (usedFrozenSource) {
    console.warn(
      "[panelTransfer] prepareSource using drag-start frozen source",
      `transferId=${transferId}`,
      `panelId=${sourcePanelId}`,
      `component=${component}`,
      `liveKeys=${Object.keys(liveParams).sort().join(",") || "(none)"}`,
      `frozenKeys=${
        frozenParams
          ? Object.keys(frozenParams).sort().join(",") || "(none)"
          : "(none)"
      }`
    );
  }
  let prepared: PanelTransferPreparedSource = { drafts: [] };
  if (reg.kind === "custom") {
    prepared = await reg.prepareSource({
      panelId: sourcePanelId,
      params: resolvedParams,
      transferId,
    });
  }
  const snapshot = buildRendererSourceSnapshot(
    panel,
    component,
    prepared,
    resolvedParams
  );
  setFrozenSourceSnapshot(transferId, snapshot, revision);
  setPanelRelocationSuppressed(true);
  hidePanelTransferTearOff(sourcePanelId, api);
  armPanelTransferTearOffClaim();
  return snapshot;
}

async function handleStageTarget(command: StageTargetCommand): Promise<void> {
  const { transferId, targetPanelId, panel, prepared, placement } = command;
  const api = requireApi();
  const component = panel.componentId;
  const reg = panelTransferRegistrationOf(component);
  if (!reg) {
    throw new Error(
      `panelTransfer.stageTarget: component not registered: ${component}`
    );
  }
  const frozenRevision = getFrozenSourceSnapshotRevision(transferId);
  if (frozenRevision !== null && frozenRevision !== computeAdapterRevision()) {
    throw new Error(
      `panelTransfer.stageTarget: adapter revision changed mid-transfer: ${transferId}`
    );
  }
  let stageParams: Readonly<Record<string, unknown>> | undefined =
    panel.params ?? undefined;
  if (reg.kind === "custom") {
    const stageResult = await reg.stageTarget({
      panelId: targetPanelId,
      params: panel.params ?? {},
      prepared,
      transferId,
    });
    if (stageResult?.params) {
      // Adapter params are a patch over the offered source params, not a
      // replacement — shared params like `context` (workspace anchor) and
      // `pinned` must survive the move or the target panel loses its
      // workspace identity (e.g. Files' outside-workspace guard).
      stageParams = { ...(panel.params ?? {}), ...stageResult.params };
    }
  }
  const addPanelOptions: {
    id: string;
    component: string;
    inactive: true;
    title?: string;
    params?: Readonly<Record<string, unknown>>;
    position?: {
      referenceGroup?: string;
      referencePanel?: string;
      direction?: "within" | "left" | "right" | "above" | "below";
      index?: number;
    };
  } = {
    component,
    id: targetPanelId,
    inactive: true,
    ...(panel.title ? { title: panel.title } : {}),
    ...(stageParams ? { params: stageParams } : {}),
  };
  if (placement.kind === "tab") {
    addPanelOptions.position = {
      direction: "within",
      index: placement.index,
      referenceGroup: placement.groupId,
    };
  } else if (placement.kind === "split") {
    // Placement contract carries `referenceGroupId` only; main-mediated
    // splits always target an existing group. A bare `direction` (no
    // reference) would let dockview pick the active group, which is not
    // what the cross-window drop promised.
    if (placement.referenceGroupId) {
      addPanelOptions.position = {
        direction: placement.direction,
        referenceGroup: placement.referenceGroupId,
      };
    } else {
      addPanelOptions.position = { direction: placement.direction };
    }
  }
  api.addPanel(addPanelOptions as Parameters<DockviewApi["addPanel"]>[0]);
  // Remember for finalize(target, commit): a moved panel must land active.
  setStagedTargetPanel(transferId, targetPanelId);
  await flushWorkspaceLayout();
}

async function handleReleaseSource(
  command: ReleaseSourceCommand
): Promise<void> {
  const { transferId, sourcePanelId } = command;
  const api = requireApi();
  const panel = findPanel(api, sourcePanelId);
  if (!panel) {
    // Already removed (idempotent re-send).
    return;
  }
  const component = panelComponentOf(panel);
  const reg = component ? panelTransferRegistrationOf(component) : undefined;
  const remainingParams = collectRemainingParams(api, sourcePanelId);
  setPanelRelocationSuppressed(true);
  api.removePanel(panel);
  clearPanelTransferTearOff();
  if (reg?.kind === "custom" && reg.releaseSource) {
    await reg.releaseSource({
      panelId: sourcePanelId,
      remainingParams,
      transferId,
    });
  }
  if (api.totalPanels === 0) {
    await clearCurrentWindowLayout();
  } else {
    await flushWorkspaceLayout();
  }
}

function collectRemainingParams(
  api: DockviewApi,
  excludedPanelId: string
): Readonly<Record<string, unknown>>[] {
  const result: Record<string, unknown>[] = [];
  for (const p of api.panels) {
    if (p.id === excludedPanelId) {
      continue;
    }
    const component = panelComponentOf(p);
    if (
      component &&
      panelTransferRegistrationOf(component)?.kind === "custom"
    ) {
      const params = panelParamsOf(p);
      if (Object.keys(params).length > 0) {
        result.push(params as Record<string, unknown>);
      }
    }
  }
  return result;
}

async function handleFinalize(command: FinalizeCommand): Promise<void> {
  const { transferId, role, outcome } = command;
  if (isFinalizeRecorded(transferId, "finalize", role, outcome)) {
    return;
  }
  const record = recordFinalize(transferId, "finalize", role, outcome);
  if (record.conflictingOutcome) {
    throw new Error(
      `panelTransfer.finalize: conflicting outcome for ${transferId}: already ${record.conflictingOutcome}`
    );
  }
  const api = useWorkspaceStore.getState().api;
  let component: string | undefined;
  let panelId: string | undefined;
  // 先取 staged target（下方激活用）；跨窗口时也用它反解 finalize 注册。
  const stagedPanelId = takeStagedTargetPanel(transferId) ?? undefined;
  if (api) {
    const snapshot = getFrozenSourceSnapshot(transferId);
    if (snapshot) {
      component = snapshot.panel.componentId;
      panelId = snapshot.panel.panelId;
    } else if (role === "target" && stagedPanelId) {
      // 跨窗口 transfer：目标窗口没有 frozen source snapshot，从 staged
      // target panel 反解注册，让自定义注册的 finalize（abort 清理等）对称执行。
      const panel = findPanel(api, stagedPanelId);
      if (panel) {
        component = panelComponentOf(panel) ?? undefined;
        panelId = stagedPanelId;
      }
    }
  }
  if (component && panelId) {
    const reg = panelTransferRegistrationOf(component);
    if (reg?.kind === "custom") {
      await reg.finalize({
        outcome,
        panelId,
        role,
        transferId,
      });
    }
  }
  if (role === "target" && outcome === "commit" && stagedPanelId && api) {
    // Moved panels land active (VS Code targetGroup.focus() semantics).
    // Without this, the sole panel of a fresh transfer window stays
    // inactive and the window renders blank.
    activateWorkspacePanel(api, stagedPanelId, {
      kindOfComponent: panelKindOf,
      reveal: "always",
    });
  }
  clearFrozenSourceSnapshot(transferId);
  setPanelRelocationSuppressed(false);
  if (outcome === "abort") {
    clearPanelTransferTearOff();
  }
  clearFinalizeRecord(transferId);
  // Guard the async transfer-startup boot path: a late gate set for this
  // transfer must not resurrect after release.
  recordFinalizedGateTombstone(transferId);
  // Live transfer + cold bootstrap both may hold the mutation gate.
  releaseWorkspaceBootstrapGate();
}

function computeAdapterRevision(): number {
  // Adapter revision = plugin panel registry revision. A hot-reload / enable /
  // disable of a plugin panel bumps this, so a transfer that started against
  // revision N and reaches stageTarget after the registry moved to N+1 fails
  // fast instead of staging against a stale adapter. Core panel registrations
  // are static (set at module load) and don't bump the plugin registry, which
  // is fine: core `kind: "params"` / `kind: "terminal"` have no adapter state
  // to drift. Plugin `kind: "custom"` (Git/Files) declare `transfer` on
  // `panels.register`, so enable/disable/hot-reload bumps this revision.
  return getPluginPanelRevision();
}

// --- bootstrap --------------------------------------------------------------

export interface BootstrapPendingTransfer {
  snapshot: PanelTransferSourceSnapshot;
  transferId: string;
}

/**
 * Fetch main's pending transfers and filter to the ones this renderer must
 * restore: target-role, non-inert (inert staged panels are deleted by main's
 * recovery, not restored here). Returns `{ transferId, snapshot }` so the
 * caller can drive `ready(transferId)` after laying out the target panel.
 */
export async function bootstrapPendingTransfers(): Promise<
  BootstrapPendingTransfer[]
> {
  const state = await pierPanelTransfer().bootstrap();
  return state.pending
    .filter((p) => p.role === "target" && !p.inert)
    .map((p) => ({ snapshot: p.snapshot, transferId: p.transferId }));
}

// --- renderer command router ------------------------------------------------

/**
 * Run a `panelTransfer.*` renderer command envelope. Resolves the renderer
 * command channel with the result (`prepareSource` returns the snapshot;
 * other commands resolve `data: null` on success). Returns true if the
 * command type was a panelTransfer command.
 */
export async function runPanelTransferRendererCommand(
  envelope: RendererCommandEnvelope
): Promise<boolean> {
  const resolve = (
    result:
      | { ok: true; data: unknown }
      | { ok: false; error: { message: string } }
  ) => {
    globalThis.window?.pier?.rendererCommand?.resolve(
      result.ok
        ? { data: result.data, ok: true, requestId: envelope.requestId }
        : { error: result.error, ok: false, requestId: envelope.requestId }
    );
  };
  try {
    switch (envelope.command.type) {
      case "panelTransfer.prepareSource": {
        const snapshot = await handlePrepareSource(envelope.command);
        resolve({ data: snapshot, ok: true });
        return true;
      }
      case "panelTransfer.stageTarget":
        await handleStageTarget(envelope.command);
        resolve({ data: null, ok: true });
        return true;
      case "panelTransfer.releaseSource":
        await handleReleaseSource(envelope.command);
        resolve({ data: null, ok: true });
        return true;
      case "panelTransfer.finalize":
        await handleFinalize(envelope.command);
        resolve({ data: null, ok: true });
        return true;
      case "panelTransfer.resolvePlacement": {
        const command = envelope.command as ResolvePlacementCommand;
        const api = requireApi();
        const placement = resolvePlacementFromClientPoint(
          api,
          command.clientX,
          command.clientY
        );
        resolve({ data: placement, ok: true });
        return true;
      }
      case "panelTransfer.resolveDefaultPlacement": {
        const api = requireApi();
        const group = api.activeGroup;
        if (group) {
          const panels = (group as { panels?: ReadonlyArray<{ id: string }> })
            .panels;
          const index = Array.isArray(panels) ? panels.length : 0;
          resolve({
            data: {
              groupId: group.id,
              index,
              kind: "tab" as const,
            },
            ok: true,
          });
          return true;
        }
        resolve({ data: { kind: "root" as const }, ok: true });
        return true;
      }
      case "panelTransfer.probeWorkspace": {
        resolve({
          data: { ready: useWorkspaceStore.getState().api !== null },
          ok: true,
        });
        return true;
      }
      default:
        return false;
    }
  } catch (error) {
    resolve({
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
    });
    return true;
  }
}
