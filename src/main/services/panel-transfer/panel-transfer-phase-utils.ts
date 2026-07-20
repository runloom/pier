import type {
  PanelTransferPhase,
  PanelTransferResult,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";
import type { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import type { PanelTransferJournalRecord } from "./panel-transfer-types.ts";

export function fail(
  code: Extract<PanelTransferResult, { ok: false }>["code"],
  message: string
): PanelTransferResult {
  return { code, message, ok: false };
}

export function requireOk(
  result: RendererCommandResult,
  message: string
): asserts result is Extract<RendererCommandResult, { ok: true }> {
  if (!result.ok) {
    // Keep the step context — renderer errors like "workspace api not ready"
    // are useless for diagnosis without knowing which step produced them.
    throw new Error(
      result.error.message ? `${message}: ${result.error.message}` : message
    );
  }
}

export function snapshotFromPrepare(
  result: Extract<RendererCommandResult, { ok: true }>,
  panelId: string,
  componentId: string,
  terminalLifecycleId = ""
): PanelTransferSourceSnapshot {
  const data = result.data;
  if (!data || typeof data !== "object") {
    throw new Error("prepareSource returned empty snapshot");
  }
  const record = data as Record<string, unknown>;
  const panel = record.panel;
  const prepared = record.prepared;
  if (!panel || typeof panel !== "object") {
    throw new Error("prepareSource missing panel");
  }
  const panelRecord = panel as Record<string, unknown>;
  if (
    panelRecord.panelId !== panelId ||
    panelRecord.componentId !== componentId
  ) {
    throw new Error("prepareSource panel identity mismatch");
  }

  // Renderer returns PanelTransferRendererSourceSnapshot (`runtimeKind`).
  // Main journals PanelTransferSourceSnapshot (`runtime`), filling terminal
  // lifecycleId from session/lifecycle storage (never forged by renderer).
  let runtime: PanelTransferSourceSnapshot["runtime"];
  if (record.runtime && typeof record.runtime === "object") {
    runtime = record.runtime as PanelTransferSourceSnapshot["runtime"];
  } else if (record.runtimeKind === "terminal") {
    runtime = { kind: "terminal", lifecycleId: terminalLifecycleId };
  } else {
    runtime = { kind: "web" };
  }

  return {
    panel: panel as PanelTransferSourceSnapshot["panel"],
    prepared: (prepared ?? {}) as PanelTransferSourceSnapshot["prepared"],
    runtime,
  };
}

export async function writePhase(
  journal: PanelTransferJournal,
  record: PanelTransferJournalRecord,
  phase: PanelTransferPhase,
  patch: Partial<PanelTransferJournalRecord> = {}
): Promise<PanelTransferJournalRecord> {
  const next: PanelTransferJournalRecord = {
    ...record,
    ...patch,
    phase,
    updatedAt: Date.now(),
  };
  await journal.upsert(next);
  return next;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("panel transfer aborted", "AbortError");
  }
}
