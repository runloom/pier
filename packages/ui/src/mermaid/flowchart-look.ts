const INIT_OPEN_RE = /%%\{\s*(?:init|initialize)\s*:/iu;
/** Same `^---` scan mermaid uses; YAML must stay at the start of the source. */
const FRONTMATTER_RE =
  /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/su;
const DIRECTIVE_RE =
  /%%\{\s*(?:\w+\s*:|\w+)\s*(?:\w+|(?:(?!\}%%).|\r?\n)*)?\s*(?:\}%%)?/giu;
const DIAGRAM_HEADER_RE =
  /^(graph|flowchart|stateDiagram(?:-v2)?|classDiagram|erDiagram|sequenceDiagram|mindmap)\b/iu;
const YAML_LOOK_RE = /(?:^|[\n{,\s])look:\s*["']?([A-Za-z]+)/u;
const YAML_CURVE_RE = /(?:^|[\n{,\s])curve:\s*["']?([A-Za-z]+)/u;

/**
 * Flowcharts default to mermaid neo + rounded orthogonal corners.
 * Other families stay classic. Author `look` in `%%{init}%%` or YAML wins.
 */
export function applyFlowchartLook(source: string): string {
  const yaml = yamlAuthorConfig(source);
  const flowchart = isFlowchartSource(source);
  return mergeInit(source, (parsed) => {
    if (typeof parsed.look !== "string" && yaml.look === undefined) {
      parsed.look = flowchart ? "neo" : "classic";
    }
    if (!flowchart) {
      return;
    }
    const next = isJsonObject(parsed.flowchart) ? parsed.flowchart : {};
    if (typeof next.curve !== "string" && yaml.curve === undefined) {
      next.curve = "rounded";
    }
    if (isJsonObject(parsed.flowchart) || typeof next.curve === "string") {
      parsed.flowchart = next;
    }
  });
}

function mergeInit(
  source: string,
  patch: (parsed: Record<string, unknown>) => void
): string {
  const directive = findInitDirective(source);
  if (directive) {
    const parsed = parseInitJson(directive.json);
    if (parsed === null || !isJsonObject(parsed)) {
      return source;
    }
    patch(parsed);
    const next = `%%{init: ${JSON.stringify(parsed)}}%%`;
    return (
      source.slice(0, directive.start) + next + source.slice(directive.end)
    );
  }
  const parsed: Record<string, unknown> = {};
  patch(parsed);
  if (Object.keys(parsed).length === 0) {
    return source;
  }
  return insertAfterFrontmatter(
    source,
    `%%{init: ${JSON.stringify(parsed)}}%%`
  );
}

function isFlowchartSource(source: string): boolean {
  const kind = DIAGRAM_HEADER_RE.exec(
    detectBody(source).trimStart()
  )?.[1]?.toLowerCase();
  return kind === "graph" || kind === "flowchart";
}

function detectBody(source: string): string {
  DIRECTIVE_RE.lastIndex = 0;
  return source
    .replace(FRONTMATTER_RE, "")
    .replace(DIRECTIVE_RE, "")
    .replace(/^\s*%%(?!\{)[^\n]+\n?/gmu, "\n");
}

function yamlAuthorConfig(source: string): {
  curve: string | undefined;
  look: string | undefined;
} {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return { curve: undefined, look: undefined };
  }
  const body = match[2] ?? "";
  return {
    curve: YAML_CURVE_RE.exec(body)?.[1],
    look: YAML_LOOK_RE.exec(body)?.[1],
  };
}

function insertAfterFrontmatter(source: string, directive: string): string {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return `${directive}\n${source}`;
  }
  return `${source.slice(0, match[0].length)}${directive}\n${source.slice(match[0].length)}`;
}

function findInitDirective(
  source: string
): { start: number; end: number; json: string } | null {
  const open = INIT_OPEN_RE.exec(source);
  if (!open) {
    return null;
  }
  const brace = source.indexOf("{", open.index + open[0].length - 1);
  if (brace < 0) {
    return null;
  }
  const json = sliceBalancedObject(source, brace);
  if (json === null) {
    return null;
  }
  const after = source.slice(brace + json.length).match(/^\s*\}%%/u);
  if (!after) {
    return null;
  }
  return {
    end: brace + json.length + after[0].length,
    json,
    start: open.index,
  };
}

function sliceBalancedObject(source: string, start: number): string | null {
  if (source[start] !== "{") {
    return null;
  }
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return null;
}

function parseInitJson(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    try {
      return JSON.parse(json.replaceAll("'", '"')) as unknown;
    } catch {
      return null;
    }
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
