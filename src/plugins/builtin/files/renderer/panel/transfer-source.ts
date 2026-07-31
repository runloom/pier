import {
  type FilesDocumentPanelSource,
  parseFilesDocumentPanelSource,
} from "../document/types.ts";

function hasRawPanelSource(params: Readonly<Record<string, unknown>>): boolean {
  return (
    "source" in params && params.source !== null && params.source !== undefined
  );
}

/**
 * Safe diagnostic for transfer failures — structure only, never document body.
 * Paths are redacted by main's `sanitizePanelTransferMessage` before UI.
 */
export function describeFilesPanelSourceParams(
  params: Readonly<Record<string, unknown>>
): string {
  const keys = Object.keys(params).sort().join(",") || "(none)";
  if (!("source" in params)) {
    return `paramsKeys=${keys}; source=missing`;
  }
  const raw = params.source;
  if (raw === null || raw === undefined) {
    return `paramsKeys=${keys}; source=${raw === null ? "null" : "undefined"}`;
  }
  if (typeof raw !== "object") {
    return `paramsKeys=${keys}; sourceType=${typeof raw}`;
  }
  const record = raw as Record<string, unknown>;
  const kind =
    typeof record.kind === "string" ? record.kind : typeof record.kind;
  if (kind === "disk") {
    const pathOk =
      typeof record.path === "string" && record.path.length > 0
        ? "set"
        : `bad(${typeof record.path})`;
    const rootOk =
      typeof record.root === "string" && record.root.length > 0
        ? "set"
        : `bad(${typeof record.root})`;
    const documentId = typeof record.documentId === "string" ? "set" : "absent";
    const parsed = parseFilesDocumentPanelSource(params);
    return `paramsKeys=${keys}; kind=disk; path=${pathOk}; root=${rootOk}; documentId=${documentId}; schema=${parsed ? "ok" : "fail"}`;
  }
  if (kind === "untitled") {
    const idOk =
      typeof record.id === "string" && record.id.length > 0
        ? "set"
        : `bad(${typeof record.id})`;
    const nameOk =
      typeof record.name === "string" && record.name.length > 0
        ? "set"
        : `bad(${typeof record.name})`;
    const parsed = parseFilesDocumentPanelSource(params);
    return `paramsKeys=${keys}; kind=untitled; id=${idOk}; name=${nameOk}; schema=${parsed ? "ok" : "fail"}`;
  }
  return `paramsKeys=${keys}; kind=${String(kind)}; schema=fail`;
}

export type FilesPanelTransferSourceResolution =
  | { kind: "params"; source: FilesDocumentPanelSource }
  | { kind: "registry"; source: FilesDocumentPanelSource }
  | { kind: "empty" }
  | { kind: "invalid"; detail: string };

/**
 * Resolve the document source for a files panel transfer.
 *
 * Prefer dockview params; fall back to the live panel registry when params
 * are empty/corrupt so an acquired editor tab still moves. Panels that never
 * had a source (project shell / empty file tab) return empty without error.
 */
export function resolveFilesPanelTransferSource(input: {
  getPanelSource?: (panelId: string) => FilesDocumentPanelSource | null;
  panelId: string;
  params: Readonly<Record<string, unknown>>;
}): FilesPanelTransferSourceResolution {
  const fromParams = parseFilesDocumentPanelSource(input.params);
  if (fromParams) {
    return { kind: "params", source: fromParams };
  }
  const fromRegistry = input.getPanelSource?.(input.panelId) ?? null;
  if (fromRegistry) {
    return { kind: "registry", source: fromRegistry };
  }
  if (!hasRawPanelSource(input.params)) {
    return { kind: "empty" };
  }
  return {
    kind: "invalid",
    detail: describeFilesPanelSourceParams(input.params),
  };
}

export function logFilesPanelTransfer(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, string | number | boolean | undefined>
): void {
  const suffix = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const line = suffix
    ? `[files.panelTransfer] ${message} ${suffix}`
    : `[files.panelTransfer] ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
