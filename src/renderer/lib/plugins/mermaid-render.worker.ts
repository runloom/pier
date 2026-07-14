import { renderMermaidSVG } from "beautiful-mermaid";

interface RenderRequest {
  source: string;
}

function normalizeMermaidStatements(source: string): string {
  const withoutLeadingComments = source.replace(
    /^(?:(?:\s*%%[^\n]*(?:\n|$))|(?:\s*\n))*/u,
    ""
  );
  const diagramKind =
    /^(graph|flowchart|stateDiagram(?:-v2)?|classDiagram|erDiagram|sequenceDiagram)\b/iu
      .exec(withoutLeadingComments.trimStart())?.[1]
      ?.toLowerCase() ?? "unknown";
  const flowchart = diagramKind === "graph" || diagramKind === "flowchart";
  let compactOperators: readonly string[] = [];
  if (flowchart) {
    compactOperators = [
      "<-.->",
      "<-->",
      "<==>",
      "-.->",
      "-->",
      "==>",
      "-.-",
      "---",
      "===",
    ];
  } else if (
    diagramKind === "statediagram" ||
    diagramKind === "statediagram-v2"
  ) {
    compactOperators = ["-->"];
  }
  const nodeDelimiters: readonly [string, string][] = [
    ["(((", ")))"],
    ["([", "])"],
    ["((", "))"],
    ["[[", "]]"],
    ["[(", ")]"],
    ["[/", "\\]"],
    ["[\\", "/]"],
    ["{{", "}}"],
    ["[", "]"],
    ["(", ")"],
    ["{", "}"],
    [">", "]"],
  ];
  let flowNodeState: "expect-node" | "node-id" | "other" = "expect-node";
  let inComment = false;
  let inPipeLabel = false;
  let nodeCloser: string | null = null;
  let quote: '"' | null = null;
  let escaped = false;
  let statementStart = 0;
  let normalized = "";
  for (let index = 0; index < withoutLeadingComments.length; index += 1) {
    const character = withoutLeadingComments[index] ?? "";
    if (inComment) {
      normalized += character;
      if (character === "\n") {
        inComment = false;
        statementStart = index + 1;
      }
      continue;
    }
    if (nodeCloser) {
      if (withoutLeadingComments.startsWith(nodeCloser, index)) {
        normalized += nodeCloser;
        index += nodeCloser.length - 1;
        nodeCloser = null;
        flowNodeState = "other";
      } else {
        normalized += character;
      }
      continue;
    }
    if (inPipeLabel) {
      normalized += character;
      if (character === "|") {
        inPipeLabel = false;
        const next = withoutLeadingComments[index + 1];
        if (next && !/\s/u.test(next)) normalized += " ";
      }
      continue;
    }
    if (escaped) {
      normalized += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      normalized += character;
      escaped = true;
      continue;
    }
    if (quote) {
      normalized += character;
      if (character === quote) quote = null;
      continue;
    }
    if (
      character === "%" &&
      withoutLeadingComments[index + 1] === "%" &&
      withoutLeadingComments.slice(statementStart, index).trim() === ""
    ) {
      normalized += "%%";
      index += 1;
      inComment = true;
      continue;
    }
    if (character === '"') {
      quote = character;
      normalized += character;
      continue;
    }
    const nodeDelimiter =
      flowchart && flowNodeState === "node-id"
        ? nodeDelimiters.find(([opener]) =>
            withoutLeadingComments.startsWith(opener, index)
          )
        : undefined;
    if (nodeDelimiter) {
      normalized += nodeDelimiter[0];
      nodeCloser = nodeDelimiter[1];
      index += nodeDelimiter[0].length - 1;
      continue;
    }
    if (
      character === "|" &&
      flowchart &&
      compactOperators.some((operator) =>
        normalized.trimEnd().endsWith(operator)
      )
    ) {
      inPipeLabel = true;
      normalized += character;
      continue;
    }

    const operator = compactOperators.find((candidate) =>
      withoutLeadingComments.startsWith(candidate, index)
    );
    if (operator) {
      if (normalized && !/\s$/u.test(normalized)) normalized += " ";
      normalized += operator;
      index += operator.length - 1;
      const next = withoutLeadingComments[index + 1];
      if (next && next !== "|" && !/\s/u.test(next)) normalized += " ";
      flowNodeState = "expect-node";
      continue;
    }

    if (character === ";") {
      normalized += "\n";
      statementStart = index + 1;
      flowNodeState = "expect-node";
    } else {
      normalized += character;
      if (character === "\n") {
        statementStart = index + 1;
        flowNodeState = "expect-node";
      } else if (flowchart) {
        if (flowNodeState === "expect-node" && /[\w-]/u.test(character)) {
          flowNodeState = "node-id";
        } else if (flowNodeState === "node-id" && !/[\w-]/u.test(character)) {
          flowNodeState = "other";
        }
      }
    }
  }
  return normalized;
}

export function renderMermaidInWorker(request: RenderRequest): string {
  return renderMermaidSVG(normalizeMermaidStatements(request.source), {
    bg: "var(--background)",
    fg: "var(--foreground)",
    line: "var(--border)",
    muted: "var(--muted-foreground)",
    transparent: true,
  });
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  try {
    self.postMessage({ ok: true, svg: renderMermaidInWorker(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    });
  }
};
