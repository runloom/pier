/**
 * Layout rewrite for cross-window panel transfer.
 *
 * Two responsibilities:
 *
 * 1. `rewriteMissingComponentsToUnavailable(layout, role)` — when a transfer
 *    target window boots (or a source window's last panel was transferred out
 *    but its component is gone), rewrite every panel whose `contentComponent`
 *    is NOT in the registered component set into a permanent
 *    `panel-transfer-unavailable` placeholder. The original descriptor is
 *    embedded in the placeholder's params so it can be restored later.
 *
 *    Only the *authoritative side* is rewritten:
 *    - pre-commit (source still owns the panel) → role "source"
 *    - post-commit (target owns the panel) → role "target"
 *    Non-authoritative staged panels are deleted by main's recovery, not here.
 *
 * 2. `restoreEmbeddedTransferPanels(layout, knownComponents)` — on a normal
 *    load, scan for existing `panel-transfer-unavailable` placeholders whose
 *    embedded original component is now registered again, and restore the
 *    panel to its original component / params.
 *
 * Both functions return a new layout object (or the input unchanged when no
 * rewrite is needed) and never mutate the input.
 */

import { PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES } from "@shared/contracts/panel-transfer.ts";
import type { SerializedDockview } from "dockview-react";
import { PANEL_TRANSFER_UNAVAILABLE_COMPONENT_ID } from "./panel-transfer-unavailable-panel.tsx";

const PLACEHOLDER_COMPONENT = PANEL_TRANSFER_UNAVAILABLE_COMPONENT_ID;

interface PanelState {
  contentComponent?: string | undefined;
  id?: string | undefined;
  params?: Readonly<Record<string, unknown>> | undefined;
  title?: string | undefined;
}

interface RewriteOptions {
  /** Registered dockview component names. Panels whose component is NOT here
   *  get rewritten. The placeholder component itself is always treated as
   *  known. */
  knownComponents: ReadonlySet<string>;
  /** Role to stamp on newly-created placeholders. */
  role: "source" | "target";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readParamsField(
  record: Record<string, unknown>
): Readonly<Record<string, unknown>> | undefined {
  const params = record.params;
  if (isRecord(params)) {
    return params as Readonly<Record<string, unknown>>;
  }
  return;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length; // fallback (tests without TextEncoder)
}

function clampDescriptorBytes(descriptor: unknown): unknown {
  const json = JSON.stringify(descriptor ?? null);
  if (utf8ByteLength(json) <= PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES) {
    return descriptor;
  }
  // Over-cap: keep identity but drop params (heaviest). Title + ids remain so
  // the user still sees which panel is unavailable.
  if (isRecord(descriptor) && "params" in descriptor) {
    const { params: _drop, ...rest } = descriptor;
    return clampDescriptorBytes(rest);
  }
  return { truncated: true };
}

function buildPlaceholderParams(
  panel: PanelState,
  role: "source" | "target"
): Record<string, unknown> {
  const originalDescriptor = clampDescriptorBytes({
    componentId: panel.contentComponent ?? "",
    panelId: panel.id ?? "",
    title: panel.title ?? panel.id ?? "",
    ...(panel.params ? { params: panel.params } : {}),
  });
  return {
    originalDescriptor,
    transferRole: role,
  };
}

function toPanelState(state: unknown): PanelState {
  if (!isRecord(state)) {
    return {};
  }
  return {
    id: readStringField(state, "id"),
    contentComponent: readStringField(state, "contentComponent"),
    title: readStringField(state, "title"),
    params: readParamsField(state),
  };
}

function readPanelsMap(layout: unknown): Record<string, unknown> | null {
  if (!isRecord(layout)) {
    return null;
  }
  const panels = layout.panels;
  if (!isRecord(panels)) {
    return null;
  }
  return panels;
}

/**
 * Rewrite every panel whose `contentComponent` is missing from
 * `knownComponents` into a `panel-transfer-unavailable` placeholder carrying
 * the original descriptor + role. Panels already using the placeholder
 * component are preserved as-is (their embedded descriptor is kept).
 *
 * Returns `{ rewritten: boolean, layout }`. `rewritten` is true if any panel
 * was changed. The input is never mutated.
 */
export function rewriteMissingComponentsToUnavailable(
  layout: SerializedDockview,
  options: RewriteOptions
): { layout: SerializedDockview; rewritten: boolean } {
  const panels = readPanelsMap(layout);
  if (!panels) {
    return { layout, rewritten: false };
  }
  const known = new Set(options.knownComponents);
  known.add(PLACEHOLDER_COMPONENT);
  let rewritten = false;
  const nextPanels: Record<string, unknown> = {};
  for (const [panelId, state] of Object.entries(panels)) {
    const panel = toPanelState(state);
    const component = panel.contentComponent;
    if (typeof component === "string" && known.has(component)) {
      nextPanels[panelId] = state;
      continue;
    }
    // Missing component → rewrite to placeholder.
    const placeholderParams = buildPlaceholderParams(panel, options.role);
    const original = isRecord(state) ? state : {};
    nextPanels[panelId] = {
      ...original,
      contentComponent: PLACEHOLDER_COMPONENT,
      params: placeholderParams,
      ...(typeof panel.title === "string" ? { title: panel.title } : {}),
    };
    rewritten = true;
  }
  if (!rewritten) {
    return { layout, rewritten: false };
  }
  return {
    layout: { ...layout, panels: nextPanels } as SerializedDockview,
    rewritten: true,
  };
}

interface EmbeddedDescriptor {
  componentId: string;
  panelId: string;
  params?: Readonly<Record<string, unknown>> | undefined;
  title?: string | undefined;
}

function readEmbeddedDescriptor(params: unknown): EmbeddedDescriptor | null {
  if (!(isRecord(params) && isRecord(params.originalDescriptor))) {
    return null;
  }
  const desc = params.originalDescriptor;
  const componentId = readStringField(desc, "componentId");
  const panelId = readStringField(desc, "panelId");
  if (!(componentId && panelId)) {
    return null;
  }
  return {
    componentId,
    panelId,
    title: readStringField(desc, "title"),
    params: readParamsField(desc),
  };
}

/**
 * On a normal load, scan for existing `panel-transfer-unavailable` placeholders
 * whose embedded original component is now registered again, and restore the
 * panel to its original component / params / title.
 *
 * Returns `{ restored: boolean, layout }`. The input is never mutated.
 */
export function restoreEmbeddedTransferPanels(
  layout: SerializedDockview,
  knownComponents: ReadonlySet<string>
): { layout: SerializedDockview; restored: boolean } {
  const panels = readPanelsMap(layout);
  if (!panels) {
    return { layout, restored: false };
  }
  let restored = false;
  const nextPanels: Record<string, unknown> = {};
  for (const [panelId, state] of Object.entries(panels)) {
    const panel = toPanelState(state);
    if (panel.contentComponent !== PLACEHOLDER_COMPONENT) {
      nextPanels[panelId] = state;
      continue;
    }
    const embedded = readEmbeddedDescriptor(
      isRecord(state) ? state.params : undefined
    );
    if (!(embedded && knownComponents.has(embedded.componentId))) {
      // Component still missing — keep the placeholder.
      nextPanels[panelId] = state;
      continue;
    }
    // Restore the original panel.
    const original = isRecord(state) ? state : {};
    const restoredState: Record<string, unknown> = {
      ...original,
      contentComponent: embedded.componentId,
      ...(embedded.params ? { params: embedded.params } : {}),
      ...(typeof embedded.title === "string" ? { title: embedded.title } : {}),
    };
    nextPanels[panelId] = restoredState;
    restored = true;
  }
  if (!restored) {
    return { layout, restored: false };
  }
  return {
    layout: { ...layout, panels: nextPanels } as SerializedDockview,
    restored: true,
  };
}

/**
 * Whether a panel state is a `panel-transfer-unavailable` placeholder.
 */
export function isPanelTransferUnavailablePlaceholder(state: unknown): boolean {
  if (!isRecord(state)) {
    return false;
  }
  return readStringField(state, "contentComponent") === PLACEHOLDER_COMPONENT;
}
