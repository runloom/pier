import type { Mermaid } from "mermaid";
import {
  type MermaidDirection,
  type MermaidEdge,
  type MermaidNode,
  nodeNeedsSlot,
  SLOT_ATTR,
  SLOT_CLASS,
  SLOT_WIDTH_PX,
  slotHeightPx,
} from "./model.ts";

export const MERMAID_THEME_CSS = `
  .node, .cluster, .actor, .classGroup, .er.entityBox, .mindmap-node {
    filter: none !important;
  }
  .flowchart-link, .edge-thickness-normal, .relation, .transition, .messageLine0, .messageLine1, .actor-line, .loopLine {
    stroke: var(--muted-foreground) !important;
  }
  marker path, .arrowMarkerPath, .marker {
    fill: var(--muted-foreground) !important;
    stroke: var(--muted-foreground) !important;
  }
  .nodeLabel, .edgeLabel, .label, .actor, .messageText, .labelText, .loopText, .noteText, .entityLabel, .classTitle, .titleText, .taskText, .legendText {
    color: var(--foreground) !important;
    fill: var(--foreground) !important;
    font-family: inherit !important;
  }
  .edgeLabel, .labelBkg {
    background-color: var(--background) !important;
  }
  .actor, .actor-man, .classGroup rect, .er.entityBox, .statediagram-state rect, .statediagram-cluster rect, .mindmap-node > * {
    fill: var(--card) !important;
    stroke: var(--border) !important;
  }
  .activation0, .activation1, .activation2 {
    fill: var(--muted) !important;
    stroke: var(--border) !important;
  }
  .note {
    fill: var(--muted) !important;
    stroke: var(--border) !important;
  }
  .${SLOT_CLASS} > rect,
  .${SLOT_CLASS} > polygon,
  .${SLOT_CLASS} > circle,
  .${SLOT_CLASS} .label-container,
  .${SLOT_CLASS} .basic {
    fill: transparent !important;
    stroke: none !important;
    filter: none !important;
  }
  .${SLOT_CLASS} .label {
    padding: 0 !important;
    overflow: visible !important;
  }
  .${SLOT_CLASS} .nodeLabel,
  .${SLOT_CLASS} foreignObject,
  .${SLOT_CLASS} foreignObject > div {
    overflow: visible !important;
    white-space: normal !important;
    /* mermaid paints labels with color/fill !important; slotted Pier
       cards must keep status/kind tokens (and Lucide currentColor). */
    color: initial !important;
    fill: none !important;
  }
  /* mermaid flowchart CSS fills node paths with a pale yellow. Lucide
     icons in htmlLabels are descendants of g.node, so that rule turns
     kind/status glyphs into pale yellow blobs unless we isolate them. */
  .${SLOT_CLASS} foreignObject svg {
    color: inherit;
    height: unset;
    max-width: none;
    overflow: visible;
  }
  .${SLOT_CLASS} foreignObject path,
  .${SLOT_CLASS} foreignObject circle,
  .${SLOT_CLASS} foreignObject ellipse,
  .${SLOT_CLASS} foreignObject line,
  .${SLOT_CLASS} foreignObject polyline,
  .${SLOT_CLASS} foreignObject polygon,
  .${SLOT_CLASS} foreignObject rect {
    fill: none !important;
    stroke: currentColor !important;
    stroke-width: 2px !important;
  }
  .${SLOT_CLASS} foreignObject [data-slot="mermaid-node-content"] [data-slot="button"][data-variant="outline"] {
    background-color: transparent !important;
    border-color: inherit !important;
  }
  svg {
    max-width: 100%;
    height: auto;
    overflow: visible;
  }
`;

let mermaidPromise: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "antiscript",
      logLevel: "fatal",
      htmlLabels: true,
      theme: "base",
      themeCSS: MERMAID_THEME_CSS,
      // khroma parses themeVariables and rejects CSS vars. Paint follows
      // Pier tokens through themeCSS `var(--*)` overrides instead.
      themeVariables: {
        fontFamily: "inherit",
      },
      flowchart: {
        diagramPadding: 24,
        htmlLabels: true,
        nodeSpacing: 48,
        // mermaid uses `padding || 8`, so 0 becomes 8. 1 keeps the hidden
        // node rect flush with the htmlLabel (Pier card); 16 left a gap
        // between arrowheads and the visible card.
        padding: 1,
        rankSpacing: 56,
        useMaxWidth: true,
      },
      sequence: {
        actorMargin: 48,
        boxMargin: 6,
        messageMargin: 28,
        mirrorActors: false,
        useMaxWidth: true,
      },
      dompurifyConfig: {
        ADD_ATTR: ["data-pier-slot"],
      },
    });
    return mermaid;
  });
  return mermaidPromise;
}

export async function renderMermaid(
  id: string,
  source: string
): Promise<{ svg: string }> {
  const mermaid = await loadMermaid();
  return mermaid.render(id, source);
}

/** `nodes`/`edges` → mermaid flowchart text. Other families pass `source`. */
export function mermaidFlowchart(options: {
  direction?: MermaidDirection | undefined;
  edges: readonly MermaidEdge[];
  nodes: readonly MermaidNode[];
}): string {
  const direction = options.direction ?? "left-to-right";
  const ids = mermaidIds(options.nodes);
  const dir = direction === "top-to-bottom" ? "TB" : "LR";
  const lines = [
    `flowchart ${dir}`,
    `  classDef ${SLOT_CLASS} fill:transparent,stroke:none`,
  ];
  for (const node of options.nodes) {
    lines.push(`  ${flowchartNode(node, ids.get(node.id) ?? node.id)}`);
  }
  const kinds = new Map(options.nodes.map((node) => [node.id, node.kind]));
  for (const edge of options.edges) {
    const from = ids.get(edge.source) ?? edge.source;
    const to = ids.get(edge.target) ?? edge.target;
    const dashed =
      kinds.get(edge.source) === "external" ||
      kinds.get(edge.target) === "external";
    const label = edgeLabel(edge.label);
    if (dashed && label) {
      lines.push(`  ${from} -.->|${label}| ${to}`);
    } else if (dashed) {
      lines.push(`  ${from} -.-> ${to}`);
    } else if (label) {
      lines.push(`  ${from} -->|${label}| ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }
  return lines.join("\n");
}

function mermaidIds(nodes: readonly MermaidNode[]): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const node of nodes) {
    let id = /^[A-Za-z][\w-]*$/.test(node.id)
      ? node.id
      : `n_${node.id.replace(/[^\w]/g, "_")}`;
    if (id.length === 0 || !/^[A-Za-z]/.test(id)) {
      id = `n_${id}`;
    }
    let unique = id;
    let n = 2;
    while (used.has(unique)) {
      unique = `${id}_${n}`;
      n += 1;
    }
    used.add(unique);
    map.set(node.id, unique);
  }
  return map;
}

function flowchartNode(node: MermaidNode, id: string): string {
  if (nodeNeedsSlot(node)) {
    const height = slotHeightPx(node);
    const html = `<div ${SLOT_ATTR}='${escapeAttr(node.id)}' style='width:${SLOT_WIDTH_PX}px;height:${height}px'></div>`;
    return `${id}["${html}"]:::${SLOT_CLASS}`;
  }
  const title = node.title.replace(/"/g, "'");
  switch (node.shape) {
    case "diamond":
      return `${id}{${title.replace(/[{}]/g, "")}}`;
    case "circle":
      return `${id}((${title}))`;
    case "round":
      return `${id}(${title})`;
    default:
      return `${id}["${title}"]`;
  }
}

function edgeLabel(label: string | undefined): string | undefined {
  if (!label) {
    return;
  }
  return label.replace(/\|/g, "/").replace(/"/g, "'");
}

function escapeAttr(value: string): string {
  return value.replace(/'/g, "");
}
