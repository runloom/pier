/**
 * Cmd/Ctrl+hover definition-link preflight (underline when jump targets exist).
 */

import { LSPPlugin } from "@codemirror/lsp-client";
import { cssImportAtOffset } from "@shared/css-import-at-position.ts";
import { cssImportDefinitionsForOffset } from "./css-import-definition.ts";
import {
  type FilesLspDefinitionTarget,
  parseFilesLspDefinitions,
} from "./definitions.ts";
import type { HoverControllerHost } from "./hover-controller-actions.ts";
import type { DefinitionAffordanceCache } from "./hover-controller-base.ts";
import { clientHasCapability } from "./hover-controller-base.ts";
import {
  type FilesLspHoverCandidate,
  filesLspHoverParams,
  sameFilesLspHoverCandidate,
} from "./hover-data.ts";

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

  runDefinitionAffordancePreflight(host, candidate, token).catch(
    () => undefined
  );
}

async function runDefinitionAffordancePreflight(
  host: HoverControllerHost,
  candidate: FilesLspHoverCandidate,
  token: number
): Promise<void> {
  const stillCurrent = (): boolean =>
    !(
      host._destroyed ||
      token !== host._affordanceToken ||
      !host._affordanceCache ||
      !sameFilesLspHoverCandidate(host._affordanceCache.candidate, candidate)
    );

  // CSS package @import (no CSS LS required).
  const cssTargets = await cssImportDefinitionsForOffset({
    offset: candidate.position,
    view: host._view,
  });
  if (!stillCurrent()) {
    return;
  }
  if (cssTargets.length > 0) {
    const importHit = cssImportAtOffset(
      host._view.state.doc.toString(),
      candidate.position
    );
    const range = importHit
      ? { from: importHit.contentFrom, to: importHit.contentTo }
      : { from: candidate.from, to: candidate.to };
    setAffordanceCache(host, candidate, "ready", {
      range,
      targets: cssTargets,
      total: cssTargets.length,
      truncated: false,
    });
    host._syncAffordance(range);
    return;
  }

  const plugin = LSPPlugin.get(host._view);
  if (!(plugin && clientHasCapability(plugin.client, "definitionProvider"))) {
    setAffordanceCache(host, candidate, "unavailable");
    return;
  }

  plugin.client.sync();
  const params = filesLspHoverParams(plugin, candidate.position);
  const result = await host._requests.request(
    plugin.client,
    "textDocument/definition",
    params
  );
  if (!stillCurrent()) {
    return;
  }
  if (!result.ok) {
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
