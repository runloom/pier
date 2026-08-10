import { LSPPlugin } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { navigateFilesLspDefinition } from "./definition-navigate.ts";
import {
  type FilesLspDefinitionTarget,
  parseFilesLspDefinitions,
} from "./definitions.ts";
import type { DefinitionAffordanceCache } from "./hover-controller-base.ts";
import { clientHasCapability } from "./hover-controller-base.ts";
import {
  createFilesLspHoverModel,
  extractFilesLspHoverRange,
  type FilesLspHoverCandidate,
  FilesLspOwnedMapping,
  filesLspHoverParams,
  prepareFilesLspDefinitions,
  sameFilesLspHoverCandidate,
} from "./hover-data.ts";
import type { FilesLspHoverCardSession } from "./hover-preview.ts";
import type { FilesLspHoverRequests } from "./hover-requests.ts";
import type {
  FilesLspHoverInput,
  FilesLspPreparedDefinition,
} from "./hover-types.ts";
import { filesLspHoverModelHasContent } from "./hover-types.ts";

export interface HoverControllerHost {
  _activateDefinition(target: FilesLspPreparedDefinition): Promise<void>;
  _affordanceCache: DefinitionAffordanceCache | null;
  _affordanceToken: number;
  _candidate: FilesLspHoverCandidate | null;
  _candidateFromLspRange(
    plugin: LSPPlugin,
    range: {
      end: { character: number; line: number };
      start: { character: number; line: number };
    },
    fallbackPosition: number
  ): FilesLspHoverCandidate;
  _card: FilesLspHoverCardSession;
  _clear(dispatch?: boolean, preserveManual?: boolean): void;
  _clearDefinitionAffordance(): void;
  _definitionJumpQueued: { candidate: FilesLspHoverCandidate } | null;
  _destroyed: boolean;
  _ensurePluginForDefinitionJump(
    candidate: FilesLspHoverCandidate
  ): Promise<boolean>;
  _epoch: number;
  _input: FilesLspHoverInput;
  _isCurrent(
    epoch: number,
    plugin: LSPPlugin,
    candidate: FilesLspHoverCandidate
  ): boolean;
  _mapping: FilesLspOwnedMapping | null;
  _mode: "definition" | "documentation" | "symbol" | null;
  _plugin: LSPPlugin | null;
  _preparedPlugin: LSPPlugin | null;
  _reportNavigateFailure(reason: string): void;
  _requests: FilesLspHoverRequests;
  _sticky: boolean;
  _syncAffordance(range: { from: number; to: number } | null): void;
  _view: EditorView;
}

function affordanceRangeForDefinitions(
  host: HoverControllerHost,
  plugin: LSPPlugin,
  candidate: FilesLspHoverCandidate,
  targets: FilesLspDefinitionTarget[]
): { from: number; to: number } | null {
  for (const target of targets) {
    if (!target.originSelectionRange) {
      continue;
    }
    const mapped = host._candidateFromLspRange(
      plugin,
      target.originSelectionRange,
      candidate.position
    );
    if (mapped.from < mapped.to) {
      return { from: mapped.from, to: mapped.to };
    }
  }
  if (candidate.from < candidate.to) {
    return { from: candidate.from, to: candidate.to };
  }
  return null;
}

function setAffordanceCache(
  host: HoverControllerHost,
  candidate: FilesLspHoverCandidate,
  status: DefinitionAffordanceCache["status"],
  fields?: {
    range?: { from: number; to: number } | null;
    targets?: FilesLspDefinitionTarget[];
    total?: number;
    truncated?: boolean;
  }
): void {
  host._affordanceCache = {
    candidate,
    range: fields?.range ?? null,
    status,
    targets: fields?.targets ?? [],
    total: fields?.total ?? 0,
    truncated: fields?.truncated ?? false,
  };
}

/**
 * Cmd/Ctrl+hover: request definition and underline only when targets exist.
 * Does not open a definition card (Scheme Z).
 */
export function beginDefinitionAffordance(
  host: HoverControllerHost,
  candidate: FilesLspHoverCandidate
): void {
  const existing = host._affordanceCache;
  if (existing && sameFilesLspHoverCandidate(existing.candidate, candidate)) {
    if (existing.status === "pending") {
      return;
    }
    if (existing.status === "ready" && existing.range) {
      host._syncAffordance(existing.range);
      return;
    }
    // empty / failed / unavailable: keep no underline; do not re-hammer.
    host._syncAffordance(null);
    return;
  }

  host._affordanceToken += 1;
  const token = host._affordanceToken;
  host._requests.cancel();
  setAffordanceCache(host, candidate, "pending");
  host._syncAffordance(null);

  const plugin = LSPPlugin.get(host._view);
  if (!(plugin && clientHasCapability(plugin.client, "definitionProvider"))) {
    setAffordanceCache(host, candidate, "unavailable");
    return;
  }

  runDefinitionAffordancePreflight(host, plugin, candidate, token).catch(
    () => undefined
  );
}

async function runDefinitionAffordancePreflight(
  host: HoverControllerHost,
  plugin: LSPPlugin,
  candidate: FilesLspHoverCandidate,
  token: number
): Promise<void> {
  plugin.client.sync();
  const params = filesLspHoverParams(plugin, candidate.position);
  const result = await host._requests.request(
    plugin.client,
    "textDocument/definition",
    params
  );
  if (
    host._destroyed ||
    token !== host._affordanceToken ||
    !host._affordanceCache ||
    !sameFilesLspHoverCandidate(host._affordanceCache.candidate, candidate)
  ) {
    return;
  }
  if (!result.ok) {
    // Distinct from empty: click must re-request and can report failure.
    setAffordanceCache(host, candidate, "failed");
    host._syncAffordance(null);
    return;
  }
  const definitions = parseFilesLspDefinitions(result.value);
  if (definitions.targets.length === 0) {
    setAffordanceCache(host, candidate, "empty");
    host._syncAffordance(null);
    return;
  }
  const range = affordanceRangeForDefinitions(
    host,
    plugin,
    candidate,
    definitions.targets
  );
  setAffordanceCache(host, candidate, "ready", {
    range,
    targets: definitions.targets,
    total: definitions.total,
    truncated: definitions.truncated,
  });
  host._syncAffordance(range);
}

export async function requestTransient(
  host: HoverControllerHost,
  mode: "definition" | "documentation",
  candidate: FilesLspHoverCandidate
): Promise<void> {
  const plugin = LSPPlugin.get(host._view);
  if (!plugin) {
    host._clear();
    return;
  }
  // Scheme Z: pointer path only opens documentation tooltips.
  if (mode !== "documentation") {
    return;
  }
  if (!clientHasCapability(plugin.client, "hoverProvider")) {
    return;
  }
  plugin.client.sync();
  const params = filesLspHoverParams(plugin, candidate.position);
  const epoch = host._epoch;
  const result = await host._requests.request(
    plugin.client,
    "textDocument/hover",
    params
  );
  if (!host._isCurrent(epoch, plugin, candidate)) {
    return;
  }
  if (!result.ok) {
    return;
  }
  const model = createFilesLspHoverModel({
    definitions: [],
    definitionsTruncated: false,
    definitionsTotal: 0,
    error: false,
    hoverInput: host._input,
    hoverResult: result,
    mode: "documentation",
    plugin,
  });
  if (!filesLspHoverModelHasContent(model)) {
    return;
  }
  const range = extractFilesLspHoverRange(result.value);
  const anchor = range
    ? host._candidateFromLspRange(plugin, range, candidate.position)
    : candidate;
  host._candidate = anchor;
  host._card.show(model, anchor, plugin, epoch);
}

export async function runManual(
  host: HoverControllerHost,
  plugin: LSPPlugin,
  candidate: FilesLspHoverCandidate
): Promise<void> {
  const position = candidate.position;
  host._mode = "symbol";
  host._candidate = candidate;
  host._sticky = true;
  plugin.client.sync();
  const hoverParams = filesLspHoverParams(plugin, position);
  const definitionParams = filesLspHoverParams(plugin, position);
  const mapping = new FilesLspOwnedMapping(plugin.client.workspaceMapping());
  host._mapping = mapping;
  host._preparedPlugin = plugin;
  const epoch = host._epoch;
  const canHover = clientHasCapability(plugin.client, "hoverProvider");
  const canDefine = clientHasCapability(plugin.client, "definitionProvider");
  const [hoverResult, definitionResult] = await Promise.all([
    canHover
      ? host._requests.request(plugin.client, "textDocument/hover", hoverParams)
      : Promise.resolve({ ok: false as const }),
    canDefine
      ? host._requests.request(
          plugin.client,
          "textDocument/definition",
          definitionParams
        )
      : Promise.resolve({ ok: false as const }),
  ]);
  if (!host._isCurrent(epoch, plugin, candidate)) {
    mapping.destroy();
    return;
  }
  const definitions = definitionResult.ok
    ? parseFilesLspDefinitions(definitionResult.value)
    : parseFilesLspDefinitions(null);
  if (definitions.targets.length === 0) {
    mapping.destroy();
    host._mapping = null;
  }
  const prepared = prepareFilesLspDefinitions({
    targets: definitions.targets,
  });
  const finalModel = createFilesLspHoverModel({
    definitions: prepared,
    definitionsTruncated: definitions.truncated,
    definitionsTotal: definitions.total,
    error: (canHover && !hoverResult.ok) || (canDefine && !definitionResult.ok),
    hoverInput: host._input,
    hoverResult: hoverResult.ok ? hoverResult : null,
    mode: "symbol",
    plugin,
  });
  const range = hoverResult.ok
    ? extractFilesLspHoverRange(hoverResult.value)
    : null;
  const anchor = range
    ? host._candidateFromLspRange(plugin, range, candidate.position)
    : candidate;
  host._candidate = anchor;
  host._card.show(finalModel, anchor, plugin, epoch);
}

async function navigateOrShowDefinitions(
  host: HoverControllerHost,
  plugin: LSPPlugin,
  candidate: FilesLspHoverCandidate,
  targets: FilesLspDefinitionTarget[],
  total: number,
  truncated: boolean,
  mapping: FilesLspOwnedMapping,
  epoch: number
): Promise<void> {
  if (targets.length === 0) {
    mapping.destroy();
    host._mapping = null;
    return;
  }
  if (targets.length === 1 && targets[0]) {
    const target = prepareFilesLspDefinitions({ targets: [targets[0]] })[0];
    if (!target) {
      mapping.destroy();
      return;
    }
    host._mapping = null;
    host._clear();
    try {
      const nav = await navigateFilesLspDefinition({
        mapping: mapping.value,
        plugin,
        sourceView: host._view,
        target,
      });
      if (!nav.ok) {
        host._reportNavigateFailure(nav.reason);
      }
    } finally {
      mapping.destroy();
    }
    return;
  }
  const prepared = prepareFilesLspDefinitions({ targets });
  const model = createFilesLspHoverModel({
    definitions: prepared,
    definitionsTruncated: truncated,
    definitionsTotal: total,
    error: false,
    hoverInput: host._input,
    hoverResult: null,
    mode: "definition",
    plugin,
  });
  host._sticky = true;
  host._card.show(model, candidate, plugin, epoch);
}

export async function clickDefinition(
  host: HoverControllerHost,
  candidate: FilesLspHoverCandidate
): Promise<void> {
  if (!(await host._ensurePluginForDefinitionJump(candidate))) {
    return;
  }
  const plugin = LSPPlugin.get(host._view);
  if (!(plugin && clientHasCapability(plugin.client, "definitionProvider"))) {
    host._reportNavigateFailure("unavailable");
    return;
  }

  // Reuse prepared single-target card if already showing for this candidate.
  if (
    host._mode === "definition" &&
    sameFilesLspHoverCandidate(host._candidate, candidate) &&
    host._mapping &&
    host._preparedPlugin
  ) {
    const model = host._card.currentModel?.();
    if (model?.definitions.length === 1 && model.definitions[0]) {
      await host._activateDefinition(model.definitions[0]);
      return;
    }
    if (model && model.definitions.length > 1) {
      host._sticky = true;
      return;
    }
  }

  // Reuse Cmd/Ctrl+hover preflight when it already confirmed targets.
  const preflight = host._affordanceCache;
  if (
    preflight &&
    sameFilesLspHoverCandidate(preflight.candidate, candidate) &&
    preflight.status === "ready" &&
    preflight.targets.length > 0
  ) {
    // Capture before _clear destroys affordance cache and any prior mapping.
    const targets = preflight.targets;
    const total = preflight.total;
    const truncated = preflight.truncated;
    host._clear();
    host._mode = "definition";
    host._candidate = candidate;
    plugin.client.sync();
    const mapping = new FilesLspOwnedMapping(plugin.client.workspaceMapping());
    host._mapping = mapping;
    host._preparedPlugin = plugin;
    const epoch = host._epoch;
    await navigateOrShowDefinitions(
      host,
      plugin,
      candidate,
      targets,
      total,
      truncated,
      mapping,
      epoch
    );
    return;
  }
  if (
    preflight &&
    sameFilesLspHoverCandidate(preflight.candidate, candidate) &&
    preflight.status === "empty"
  ) {
    // Only proven-empty short-circuits. "failed" falls through to re-request.
    return;
  }

  host._clear();
  host._mode = "definition";
  host._candidate = candidate;
  plugin.client.sync();
  const params = filesLspHoverParams(plugin, candidate.position);
  const mapping = new FilesLspOwnedMapping(plugin.client.workspaceMapping());
  host._mapping = mapping;
  host._preparedPlugin = plugin;
  const epoch = host._epoch;
  const result = await host._requests.request(
    plugin.client,
    "textDocument/definition",
    params
  );
  if (!host._isCurrent(epoch, plugin, candidate)) {
    mapping.destroy();
    return;
  }
  if (!result.ok) {
    mapping.destroy();
    host._mapping = null;
    host._reportNavigateFailure("request-failed");
    return;
  }
  const definitions = parseFilesLspDefinitions(result.value);
  if (definitions.targets.length === 0) {
    mapping.destroy();
    host._mapping = null;
    // No toast for empty: matches VS Code (no-op).
    return;
  }
  await navigateOrShowDefinitions(
    host,
    plugin,
    candidate,
    definitions.targets,
    definitions.total,
    definitions.truncated,
    mapping,
    epoch
  );
}
