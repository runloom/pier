export const FILES_LSP_HOVER_CONTENT_LIMIT = 128 * 1024;

type DocumentationKind = "markdown" | "plaintext";

interface HoverDocumentation {
  kind: DocumentationKind;
  value: string;
}

interface HoverSignature {
  language: string;
  value: string;
}

interface NormalizedLspHoverContents {
  documentation: HoverDocumentation[];
  signatures: HoverSignature[];
  totalCodeUnits: number;
  truncated: boolean;
}

interface ContentBudget {
  remaining: number;
  totalCodeUnits: number;
  truncated: boolean;
}

function isNonArrayObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeSliceEnd(value: string, maximumCodeUnits: number): number {
  const end = Math.min(value.length, maximumCodeUnits);
  if (end === 0 || end === value.length) {
    return end;
  }

  const preceding = value.charCodeAt(end - 1);
  const following = value.charCodeAt(end);
  const splitsSurrogatePair =
    preceding >= 0xd8_00 &&
    preceding <= 0xdb_ff &&
    following >= 0xdc_00 &&
    following <= 0xdf_ff;
  return splitsSurrogatePair ? end - 1 : end;
}

function retainWithinBudget(
  value: string,
  budget: ContentBudget
): string | null {
  budget.totalCodeUnits += value.length;
  if (budget.truncated) {
    return null;
  }
  if (value.length <= budget.remaining) {
    budget.remaining -= value.length;
    return value;
  }

  const end = safeSliceEnd(value, budget.remaining);
  budget.remaining = 0;
  budget.truncated = true;
  return end === 0 ? null : value.slice(0, end);
}

function isMarkupContent(
  value: object
): value is object & { kind: DocumentationKind; value: string } {
  return (
    "kind" in value &&
    (value.kind === "markdown" || value.kind === "plaintext") &&
    "value" in value &&
    typeof value.value === "string"
  );
}

function isMarkedStringObject(
  value: unknown
): value is object & { language: string; value: string } {
  return (
    isNonArrayObject(value) &&
    !("kind" in value) &&
    "language" in value &&
    typeof value.language === "string" &&
    "value" in value &&
    typeof value.value === "string"
  );
}

export function normalizeLspHoverContents(
  contents: unknown
): NormalizedLspHoverContents {
  const documentation: HoverDocumentation[] = [];
  const signatures: HoverSignature[] = [];
  const budget: ContentBudget = {
    remaining: FILES_LSP_HOVER_CONTENT_LIMIT,
    totalCodeUnits: 0,
    truncated: false,
  };

  const addDocumentation = (kind: DocumentationKind, value: string): void => {
    if (value.trim().length === 0) {
      return;
    }
    const retained = retainWithinBudget(value, budget);
    if (retained !== null) {
      documentation.push({ kind, value: retained });
    }
  };

  const addSignature = (language: string, value: string): void => {
    if (value.trim().length === 0) {
      return;
    }
    const retained = retainWithinBudget(value, budget);
    if (retained !== null) {
      signatures.push({ language, value: retained });
    }
  };

  if (typeof contents === "string") {
    addDocumentation("markdown", contents);
  } else if (Array.isArray(contents)) {
    for (const item of contents) {
      if (typeof item === "string") {
        addDocumentation("markdown", item);
      } else if (isMarkedStringObject(item)) {
        addSignature(item.language, item.value);
      }
    }
  } else if (isNonArrayObject(contents)) {
    if (isMarkupContent(contents)) {
      addDocumentation(contents.kind, contents.value);
    } else if (isMarkedStringObject(contents)) {
      addSignature(contents.language, contents.value);
    }
  }

  return {
    documentation,
    signatures,
    totalCodeUnits: budget.totalCodeUnits,
    truncated: budget.truncated,
  };
}
