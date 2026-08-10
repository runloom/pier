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
  // Strip labels / shapes so `A["x"] --> B --> C` becomes tokenizable.
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
