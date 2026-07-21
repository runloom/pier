/**
 * Panel transfer registration types + resolver.
 *
 * Each dockview component (core or plugin) may declare a `transfer?`
 * registration that tells the workspace how to prepare / stage / restore /
 * release / finalize a cross-window move:
 *
 * - `kind: "params"` — stateless panel; only dockview params need to move.
 *   welcome / workbench.
 * - `kind: "custom"` — panel owns durable state (drafts, sessions, watchers).
 *   Git / Files. Provides the five lifecycle callbacks.
 * - `kind: "terminal"` — core-internal only. External plugins CANNOT declare
 *   this kind; the resolver rejects it. The terminal transfer path is owned by
 *   main (Task 6) and the workspace only marks the panel movable.
 *
 * `panelTransferRegistrationOf(component)` resolves core-first, then plugin.
 */

import type { PanelTransferRegistration } from "@plugins/api/panel-transfer-registration.ts";
import type {
  PanelTransferPhase,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import { getPluginPanelRegistrations } from "@/lib/plugins/plugin-panel-registry.ts";
import { panelKits } from "./panel-registry.ts";

export type { PanelTransferRegistration } from "@plugins/api/panel-transfer-registration.ts";
export type { JsonValue } from "@shared/contracts/panel-transfer.ts";

export interface PanelTransferParamsSourceInput {
  panelId: string;
  params: Readonly<Record<string, unknown>>;
  transferId: string;
}

export interface PanelTransferCustomRestoreInput {
  panelId: string;
  phase: PanelTransferPhase;
  role: "source" | "target";
  snapshot: PanelTransferSourceSnapshot;
  transferId: string;
}

export interface PanelTransferCustomReleaseInput {
  panelId: string;
  remainingParams: readonly Readonly<Record<string, unknown>>[];
  transferId: string;
}

export interface PanelTransferCustomFinalizeInput {
  outcome: "commit" | "abort";
  panelId: string;
  role: "source" | "target";
  transferId: string;
}

/**
 * Core-internal registration. `kind: "terminal"` is only resolvable for the
 * core terminal panel; external plugins declaring it are rejected.
 */
export type CorePanelTransferRegistration =
  | PanelTransferRegistration
  | { kind: "terminal" };

/**
 * Core transfer registrations. Core panels that are stateless (welcome,
 * workbench) use `kind: "params"`. Terminal is `kind: "terminal"` (core-only).
 * Git / Files register `kind: "custom"` from their own modules via
 * `registerCorePanelTransfer`.
 */
const coreTransferRegistrations = new Map<
  string,
  CorePanelTransferRegistration
>();

/**
 * Default core registrations. welcome / workbench are params-only; terminal is
 * core-only.
 */
coreTransferRegistrations.set("welcome", { kind: "params" });
coreTransferRegistrations.set("workbench", { kind: "params" });
coreTransferRegistrations.set("terminal", { kind: "terminal" });
coreTransferRegistrations.set("panel-transfer-unavailable", {
  kind: "params",
});

export function registerCorePanelTransfer(
  componentId: string,
  registration: PanelTransferRegistration
): () => void {
  if (coreTransferRegistrations.has(componentId)) {
    // Allow overwrite only for the same kind (idempotent re-register during
    // plugin reload). A kind flip is a programmer error.
    const existing = coreTransferRegistrations.get(componentId);
    if (existing && existing.kind !== registration.kind) {
      throw new Error(
        `core panel transfer registration kind mismatch for ${componentId}`
      );
    }
  }
  coreTransferRegistrations.set(componentId, registration);
  return () => {
    // Only delete if still our registration.
    if (coreTransferRegistrations.get(componentId) === registration) {
      coreTransferRegistrations.delete(componentId);
    }
  };
}

export function getCorePanelTransferRegistration(
  componentId: string
): CorePanelTransferRegistration | undefined {
  return coreTransferRegistrations.get(componentId);
}

/**
 * Resolve a transfer registration for a dockview component. Core first, then
 * plugin `transfer?`. External plugins cannot declare `kind: "terminal"`; if
 * they do, the resolver returns `undefined` (treated as unsupported).
 */
export function panelTransferRegistrationOf(
  component: string
): CorePanelTransferRegistration | undefined {
  const core = coreTransferRegistrations.get(component);
  if (core) {
    return core;
  }
  if (!(component in panelKits)) {
    const plugin = getPluginPanelRegistrations().get(component);
    const transfer = plugin?.transfer;
    // External plugins cannot own terminal transfer. The plugin-facing type
    // already excludes "terminal", but a hostile/buggy plugin can still pass
    // it at runtime; widen the kind for the guard.
    if (transfer && (transfer as { kind: string }).kind === "terminal") {
      return;
    }
    return transfer;
  }
  return;
}

/**
 * Whether a component is movable across windows. `kind: "terminal"` is
 * movable (core-owned). `kind: "params"` / `kind: "custom"` are movable.
 * `undefined` (no registration, or external `kind: "terminal"` rejected) is
 * not movable.
 */
export function isPanelTransferMovable(component: string): boolean {
  return panelTransferRegistrationOf(component) !== undefined;
}

export function clearCorePanelTransferForTests(): void {
  coreTransferRegistrations.clear();
  coreTransferRegistrations.set("welcome", { kind: "params" });
  coreTransferRegistrations.set("workbench", { kind: "params" });
  coreTransferRegistrations.set("terminal", { kind: "terminal" });
  coreTransferRegistrations.set("panel-transfer-unavailable", {
    kind: "params",
  });
}
