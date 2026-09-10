import { SLOT_ATTR, SLOT_CLASS } from "./model.ts";

/**
 * Paper-token overlay for official mermaid `theme: "base"`.
 * khroma rejects CSS variables in `themeVariables`, so every default chrome
 * surface in the closed set is remapped here with `!important`.
 * Author `classDef` rules are appended after this block and still win.
 */
export const MERMAID_THEME_CSS = `
  .node, .cluster, .actor, .classGroup, .entityBox, .mindmap-node,
  [data-look="neo"].node rect, [data-look="neo"].cluster rect, [data-look="neo"].node polygon, [data-look="neo"].node path, [data-look="neo"].node circle, [data-look="neo"].node .outer-path, [data-look="neo"].icon-shape .icon {
    filter: none !important;
  }
  .flowchart-link, .edgePath .path, .edge-thickness-normal, .relation, .relationshipLine, .transition, .messageLine0, .messageLine1, .actor-line, .loopLine, .edge, [class^="section-edge-"] {
    fill: none !important;
    stroke: var(--muted-foreground) !important;
  }
  .arrowheadPath, .arrowMarkerPath, marker path, .composition, .composition path, .dependency, .dependency path {
    fill: var(--muted-foreground) !important;
    stroke: var(--muted-foreground) !important;
  }
  /* mermaid 11.16 puts class="marker" on every marker, including filled
     neo point barbs. Hollow types must beat marker path by name. */
  .extension, .extension path, .extension polygon, .aggregation, .aggregation path, .onlyOne, .onlyOne path, .zeroOrOne, .zeroOrOne path, .zeroOrOne circle, .oneOrMore, .oneOrMore path, .zeroOrMore, .zeroOrMore path, .zeroOrMore circle {
    fill: none !important;
    stroke: var(--muted-foreground) !important;
  }
  .lollipop {
    fill: var(--card) !important;
    stroke: var(--muted-foreground) !important;
  }
  .root .anchor path {
    fill: var(--muted-foreground) !important;
    stroke: var(--muted-foreground) !important;
  }
  .nodeLabel, .edgeLabel, .label, .messageText, .labelText, .loopText, .noteText, .entityLabel, .classTitle, .titleText, .taskText, .legendText, .flowchartTitleText, .statediagramTitleText, .classTitleText,
  .cluster-label, .cluster-label span, .cluster-label text, .cluster text, .cluster span,
  .messageText > tspan, .labelText > tspan, .loopText > tspan, .noteText > tspan,
  text.actor > tspan, .sequenceNumber, .classLabel .label, g.classGroup text, .stateLabel text,
  .statediagram-note text, .statediagram-note .nodeLabel, .mindmap-node-label, .section-root text, .section-root span,
  [class^="section-"] text, [class^="section-"] span {
    color: var(--foreground) !important;
    fill: var(--foreground) !important;
    font-family: var(--font-sans) !important;
  }
  /* mermaid base theme paints edge-label pills pink through its own
     ".edgeLabel p" / ".edgeLabel rect" rules; neutralize every layer so a
     label reads as plain foreground text floating on the surface. */
  .edgeLabel, .labelBkg, .edgeLabel p {
    background-color: var(--background) !important;
  }
  .edgeLabel rect {
    fill: transparent !important;
    opacity: 1 !important;
  }
  /* Parent fill does not inherit onto sequence tspans. --muted on
     --background is ~0.09 L in dark, so notes use --secondary. */
  .note, .labelBox, rect.actor {
    fill: var(--secondary) !important;
    stroke: var(--border) !important;
  }
  .cluster rect, .cluster path, .statediagram-cluster .inner, .statediagram-cluster.statediagram-cluster-alt .inner, .relationshipLabelBox, .statediagram-note rect, .classLabel .box, .stateLabel .box, .statediagram-state rect.divider {
    fill: var(--secondary) !important;
    stroke: var(--border) !important;
  }
  .relationshipLabelBox {
    background-color: var(--secondary) !important;
    opacity: 1 !important;
  }
  #sequencenumber {
    fill: var(--secondary) !important;
    stroke: var(--border) !important;
  }
  .actor-man, .actor-man circle, .actor-man line, .classGroup rect, .entityBox, .statediagram-state rect, .statediagram-cluster rect, .mindmap-node rect, .mindmap-node circle, .mindmap-node ellipse, .mindmap-node polygon, .mindmap-node path, .section-root rect, .section-root path, .section-root circle, .section-root polygon {
    fill: var(--card) !important;
    stroke: var(--border) !important;
  }
  .activation0, .activation1, .activation2 {
    fill: var(--muted) !important;
    stroke: var(--border) !important;
  }
  g.classGroup line, .divider, .statediagram-state .divider {
    stroke: var(--border) !important;
  }
  /* Default flowchart nodes: mermaid.js paints a cream nodeBkg after this
     block. !important beats that fill so dark-theme labels (foreground)
     stay readable. classDef rules are also !important and are appended
     after themeCSS, so author fills still win. Slotted Pier rects stay
     transparent below. ellipse / path cover stadium variants mermaid
     does not draw as rect. */
  .node rect, .node polygon, .node circle, .node ellipse, .node path, .node .label-container, .node .basic {
    fill: var(--card) !important;
    stroke: var(--border) !important;
  }
  .node[data-look="neo"] rect {
    rx: var(--radius) !important;
    ry: var(--radius) !important;
  }
  .node circle.state-start, .node .fork-join {
    fill: var(--foreground) !important;
    stroke: var(--foreground) !important;
  }
  .node circle.state-end {
    fill: var(--foreground) !important;
    stroke: var(--foreground) !important;
  }
  .end-state-inner {
    fill: var(--background) !important;
    stroke: none !important;
  }
  .node .katex path {
    fill: currentColor !important;
    stroke: currentColor !important;
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
  /* mermaid htmlLabels wrap the slot in span.nodeLabel + table-cell
     (vertical-align middle, line-height 1.5). A centered card shorter
     than that cell leaves a transparent band at the top of the node.
     Pin the wrapper to the top and keep overflow visible so the status
     surface can cover every title line. Leftover htmlLabel text (vertex
     id) stays invisible without collapsing the box. Do not set height
     100% on [data-pier-slot]: that would override the measured px box. */
  .${SLOT_CLASS} .label {
    fill: none !important;
    overflow: visible !important;
    padding: 0 !important;
  }
  .${SLOT_CLASS} foreignObject,
  .${SLOT_CLASS} foreignObject > div {
    color: initial !important;
    display: block !important;
    fill: none !important;
    line-height: normal !important;
    overflow: visible !important;
    vertical-align: top !important;
    white-space: normal !important;
  }
  .${SLOT_CLASS} .nodeLabel,
  .${SLOT_CLASS} .nodeLabel p {
    color: transparent !important;
    display: block !important;
    fill: none !important;
    font-size: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .${SLOT_CLASS} .nodeLabel [${SLOT_ATTR}] {
    color: initial !important;
    font-size: 1rem !important;
    line-height: normal !important;
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
    overflow: visible;
  }
`;
