export interface FilesLspDefinitionPosition {
  character: number;
  line: number;
}

export interface FilesLspDefinitionRange {
  end: FilesLspDefinitionPosition;
  start: FilesLspDefinitionPosition;
}

export interface FilesLspDefinitionTarget {
  originSelectionRange?: FilesLspDefinitionRange;
  range: FilesLspDefinitionRange;
  uri: string;
}

export interface FilesLspDefinitions {
  targets: FilesLspDefinitionTarget[];
  total: number;
  truncated: boolean;
}

type LspPosition = FilesLspDefinitionPosition;
type LspRange = FilesLspDefinitionRange;

export const FILES_LSP_DEFINITION_TARGET_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPosition(value: unknown): value is LspPosition {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.character) &&
    isNonNegativeInteger(value.line)
  );
}

function isRange(value: unknown): value is LspRange {
  if (!(isRecord(value) && isPosition(value.start) && isPosition(value.end))) {
    return false;
  }
  return (
    value.end.line > value.start.line ||
    (value.end.line === value.start.line &&
      value.end.character >= value.start.character)
  );
}

function normalizeDefinition(value: unknown): FilesLspDefinitionTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.uri === "string" &&
    value.uri !== "" &&
    isRange(value.range)
  ) {
    return { range: value.range, uri: value.uri };
  }

  if (
    typeof value.targetUri !== "string" ||
    value.targetUri === "" ||
    !isRange(value.targetRange)
  ) {
    return null;
  }
  if (
    value.targetSelectionRange !== undefined &&
    !isRange(value.targetSelectionRange)
  ) {
    return null;
  }

  return {
    ...(isRange(value.originSelectionRange)
      ? { originSelectionRange: value.originSelectionRange }
      : {}),
    range: isRange(value.targetSelectionRange)
      ? value.targetSelectionRange
      : value.targetRange,
    uri: value.targetUri,
  };
}

function definitionTargetKey(target: FilesLspDefinitionTarget): string {
  const { end, start } = target.range;
  return `${target.uri.length}:${target.uri}:${start.line}:${start.character}:${end.line}:${end.character}`;
}

export function parseFilesLspDefinitions(
  response: unknown
): FilesLspDefinitions {
  const entries = Array.isArray(response) ? response : [response];
  const targets: FilesLspDefinitionTarget[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const entry of entries) {
    const target = normalizeDefinition(entry);
    if (target === null) {
      continue;
    }

    const key = definitionTargetKey(target);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    total += 1;
    if (targets.length < FILES_LSP_DEFINITION_TARGET_LIMIT) {
      targets.push(target);
    }
  }

  return {
    targets,
    total,
    truncated: total > FILES_LSP_DEFINITION_TARGET_LIMIT,
  };
}
