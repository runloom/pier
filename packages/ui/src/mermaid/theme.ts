import type { Mermaid } from "mermaid";
import { applyFlowchartLook } from "./flowchart-look.ts";
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
import { MERMAID_THEME_CSS } from "./theme-css.ts";

export { MERMAID_THEME_CSS } from "./theme-css.ts";

let mermaidPromise: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= Promise.all([
    import("mermaid"),
    import("@mermaid-js/layout-elk"),
  ]).then(([mod, elkLayouts]) => {
    const mermaid = mod.default;
    // layout-elk's core is a small registry; its loader lazy-imports the
    // heavy ELK engine chunk on first elk-rendered diagram. Enables the
    // `flowchart-elk` diagram type and `%%{init: {"flowchart":
    // {"defaultRenderer": "elk"}}}%%` per-diagram opt-in.
    mermaid.registerLayoutLoaders(elkLayouts.default);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "antiscript",
      logLevel: "fatal",
      htmlLabels: true,
      theme: "base",
      themeCSS: MERMAID_THEME_CSS,
      // khroma parses themeVariables colors and rejects CSS vars; font
      // family passes through. Diagram text always uses the UI font, never
      // the markdown paper/reading font.
      themeVariables: {
        fontFamily: "var(--font-sans)",
      },
      // Keep failed renders from injecting mermaid's error graphic into the
      // document; callers surface the rejection instead.
      suppressErrorRendering: true,
      flowchart: {
        diagramPadding: 24,
        htmlLabels: true,
        nodeSpacing: 48,
        // mermaid uses `padding || 8`, so 0 becomes 8. 1 keeps the hidden
        // node rect flush with the htmlLabel (Pier card); 16 left a gap
        // between arrowheads and the visible card.
        padding: 1,
        rankSpacing: 56,
        useMaxWidth: false,
      },
      sequence: {
        actorMargin: 48,
        boxMargin: 6,
        messageMargin: 28,
        mirrorActors: false,
        useMaxWidth: false,
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
  return mermaid.render(id, applyFlowchartLook(source));
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
  for (const edge of options.edges) {
    const from = ids.get(edge.source) ?? edge.source;
    const to = ids.get(edge.target) ?? edge.target;
    const label = edgeLabel(edge.label);
    // Neo look's generateDashArray throws on dotted mermaid edges
    // (`RangeError: Invalid array length`). External/artifact stay dashed
    // on the slotted card, not the connector.
    if (label) {
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
