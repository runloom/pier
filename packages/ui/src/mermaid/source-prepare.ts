/**
 * Mermaid source preparation shared by every render path (markdown inline,
 * fullscreen preview, canvas visualizations) so all of them render the same
 * bytes on the single official engine:
 *
 * - normalizeMermaidStatements: accept compact AI-authored statements
 *   (semicolon-separated statements, dense operators) that line-based
 *   grammars reject — official mermaid does not accept `;` inside
 *   classDiagram braces, for example. Pure statement-boundary rewrite:
 *   well-formed sources pass through unchanged. Leading `%%{init:...}%%`
 *   directives are preserved (they carry per-diagram config such as the
 *   ELK renderer opt-in); other leading comments are stripped.
 * - optimizeMermaidSource: opt-in LR/RL → TD rewrite for pure path
 *   flowcharts (`%%{pier: layout=auto-td}%%`). The directive comment is
 *   consumed here and stripped by the normalize pass before rendering.
 */

export function prepareMermaidSource(source: string): string {
  return normalizeMermaidStatements(optimizeMermaidSource(source).source);
}

export function normalizeMermaidStatements(source: string): string {
  // Leading comment/blank lines are stripped so diagram-kind detection sees
  // the header. `%%{init:...}%%` directives carry per-diagram config (e.g. the
  // ELK renderer opt-in) and must still reach the engine, so they are moved
  // ahead of the stripped body instead of being dropped.
  const body = source.replace(/^(?:(?:\s*%%[^\n]*(?:\n|$))|(?:\s*\n))*/u, "");
  const keptDirectives = source
    .slice(0, source.length - body.length)
    .split("\n")
    .filter((line) => /^\s*%%\s*\{\s*init[\s:}]/u.test(line))
    .join("\n");
  const withoutLeadingComments = keptDirectives
    ? `${keptDirectives}\n${body}`
    : body;
  const diagramKind =
    /^(graph|flowchart|stateDiagram(?:-v2)?|classDiagram|erDiagram|sequenceDiagram)\b/iu
      .exec(body.trimStart())?.[1]
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

/**
 * Optional flowchart layout helpers (not applied by the default render path).
 *
 * Automatic LR→TD rewrites are **opt-in** only. Prefer natural-capped viewport
 * sizing in the preview shell over silently changing diagram direction.
 *
 * Enable rewrite with:
 *   %%{pier: layout=auto-td}%%
 * or
 *   %% pier-layout: auto-td
 *
 * Force keep (no-op when auto-td is absent; documented for authors):
 *   %%{pier: layout=keep}%%
 */
export const MIN_LINEAR_CHAIN_NODES = 6;

export interface LayoutOptimizeResult {
  rewroteDirection: boolean;
  source: string;
}

/** Opt in to automatic LR/RL → TD for pure path graphs. */
const AUTO_TD_LAYOUT_RE =
  /%%\s*(?:\{[^%\n]*\blayout\s*[:=]\s*auto-td\b[^%\n]*\}\s*%%|pier-layout\s*:\s*auto-td\b)/iu;

/** Explicit keep (disables rewrite even if auto-td were combined). */
const KEEP_LAYOUT_RE =
  /%%\s*(?:\{[^%\n]*\blayout\s*[:=]\s*keep\b[^%\n]*\}\s*%%|pier-layout\s*:\s*keep\b)/iu;

const FLOWCHART_HEADER_RE =
  /(^|\n)([ \t]*)(graph|flowchart)([ \t]+)(LR|RL|TD|TB|BT)\b/iu;

const ARROW_RE = /<-\.->|<-->|<==>|-\.->|-->|==>|-\.-|---|===/u;

const SKIP_STATEMENT_RE =
  /^\s*(?:classDef|class\s|style\s|linkStyle|subgraph|end\b|click\s|direction\s)/iu;

/**
 * Rewrite pure LR/RL path flowcharts to TD when the author opts in via
 * `layout=auto-td`. Default render path does not call this.
 */
export function optimizeMermaidSource(source: string): LayoutOptimizeResult {
  if (
    !source.trim() ||
    KEEP_LAYOUT_RE.test(source) ||
    !AUTO_TD_LAYOUT_RE.test(source)
  ) {
    return { rewroteDirection: false, source };
  }

  const header = FLOWCHART_HEADER_RE.exec(source);
  if (!header) {
    return { rewroteDirection: false, source };
  }

  const direction = (header[5] ?? "").toUpperCase();
  if (direction === "TD" || direction === "TB" || direction === "BT") {
    return { rewroteDirection: false, source };
  }

  const headerEnd = (header.index ?? 0) + header[0].length;
  const body = source.slice(headerEnd);
  if (/\bsubgraph\b/iu.test(body)) {
    return { rewroteDirection: false, source };
  }

  const edges = extractFlowchartEdges(body);
  if (!isDirectedPath(edges, MIN_LINEAR_CHAIN_NODES)) {
    return { rewroteDirection: false, source };
  }

  const dirToken = header[5];
  if (!dirToken) {
    return { rewroteDirection: false, source };
  }
  // header[5] is the direction token; locate it inside the full match.
  const absoluteDirStart =
    (header.index ?? 0) + header[0].lastIndexOf(dirToken);
  const rewritten =
    source.slice(0, absoluteDirStart) +
    "TD" +
    source.slice(absoluteDirStart + dirToken.length);

  return { rewroteDirection: true, source: rewritten };
}

/** @internal exported for unit tests */
export function extractFlowchartEdges(body: string): [string, string][] {
  const edges: [string, string][] = [];
  const statements = splitStatements(body);
  for (const statement of statements) {
    if (SKIP_STATEMENT_RE.test(statement)) {
      continue;
    }
    edges.push(...edgesFromStatement(statement));
  }
  return edges;
}

/** @internal exported for unit tests */
export function isDirectedPath(
  edges: ReadonlyArray<readonly [string, string]>,
  minNodes: number
): boolean {
  if (edges.length < minNodes - 1) {
    return false;
  }

  const nodes = new Set<string>();
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const undirected = new Set<string>();

  for (const [from, to] of edges) {
    if (from === to) {
      return false;
    }
    const pairKey = from < to ? `${from}\0${to}` : `${to}\0${from}`;
    if (undirected.has(pairKey)) {
      // Parallel / repeated edge — not a simple path for our purposes.
      return false;
    }
    undirected.add(pairKey);
    nodes.add(from);
    nodes.add(to);
    outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  if (nodes.size < minNodes || nodes.size !== edges.length + 1) {
    return false;
  }

  let sources = 0;
  let sinks = 0;
  for (const node of nodes) {
    const out = outDegree.get(node) ?? 0;
    const inn = inDegree.get(node) ?? 0;
    if (out > 1 || inn > 1) {
      return false;
    }
    if (inn === 0 && out === 1) {
      sources += 1;
    } else if (out === 0 && inn === 1) {
      sinks += 1;
    } else if (!(inn === 1 && out === 1)) {
      return false;
    }
  }

  return sources === 1 && sinks === 1;
}

function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: '"' | null = null;
  let escaped = false;

  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ";" || character === "\n") {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += character;
  }
  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

/**
 * Node ids may contain hyphens (`my-node`) but must not swallow arrow dashes
 * (`A-->B` must not tokenize as node `A--`).
 */
const NODE_ID_RE = /[A-Za-z_][\w]*(?:-[\w]+)*/u;

function edgesFromStatement(statement: string): [string, string][] {
  // Strip labels / shapes so `A["x"] -->|go| B --> C` becomes tokenizable.
  const cleaned = statement
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/gu, '""')
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\([^)]*\)/gu, "")
    .replace(/\{[^}]*\}/gu, "")
    .replace(/\|[^|]*\|/gu, "")
    .trim();
  if (!cleaned) {
    return [];
  }

  // Prefer arrows over node ids at each position so `-->` wins over trailing `-`.
  const tokenRe = new RegExp(
    `(${ARROW_RE.source})|(${NODE_ID_RE.source})`,
    "gu"
  );
  const edges: [string, string][] = [];
  let lastNode: string | null = null;
  let expectNodeAfterArrow = false;
  for (const match of cleaned.matchAll(tokenRe)) {
    const arrow = match[1];
    const nodeId = match[2];
    if (arrow) {
      expectNodeAfterArrow = true;
      continue;
    }
    if (nodeId) {
      if (expectNodeAfterArrow && lastNode) {
        edges.push([lastNode, nodeId]);
        expectNodeAfterArrow = false;
      }
      lastNode = nodeId;
    }
  }
  return edges;
}
