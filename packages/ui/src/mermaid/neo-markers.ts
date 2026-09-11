const POINT_START_MARGIN_RE = /-pointStart-margin(?:_.+)?$/u;
const POINT_END_MARGIN_RE = /-pointEnd-margin(?:_.+)?$/u;
const MARKER_URL_RE = /#([^)'"\s]+)['"]?\)$/u;
const NEO_EDGE_SELECTOR = 'path[data-edge][data-look="neo"].edge-pattern-solid';

/**
 * Neo solid edges park the stroke with a 4-value dasharray so the barb
 * does not sit on the path. Host only nudges point-margin markers' refX
 * and the dash gaps — never the path `d` or marker box.
 */
export function tuneNeoFlowchartMarkers(svg: Element): void {
  if (!svg.classList.contains("flowchart")) {
    return;
  }
  const markers = new Map(
    [...svg.querySelectorAll("marker")].flatMap((marker) =>
      marker.id ? [[marker.id, marker] as const] : []
    )
  );
  const tuned = new Set<Element>();
  for (const path of svg.querySelectorAll(NEO_EDGE_SELECTOR)) {
    if (!(path instanceof SVGElement)) {
      continue;
    }
    const dashes = path.style.strokeDasharray
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (
      dashes.length !== 4 ||
      dashes.some((value) => !Number.isFinite(value))
    ) {
      continue;
    }
    const start = inspectEnd(path, "start", markers, tuned);
    const end = inspectEnd(path, "end", markers, tuned);
    const reserved = start.gap + end.gap;
    const body = dashes[2] ?? 0;
    if (body < reserved) {
      continue;
    }
    for (const side of [start, end]) {
      if (side.marker && !tuned.has(side.marker)) {
        const current = Number(side.marker.getAttribute("refX"));
        if (Number.isFinite(current)) {
          side.marker.setAttribute("refX", String(current + side.offset));
        }
        tuned.add(side.marker);
      }
    }
    path.style.strokeDasharray = `0 ${
      (dashes[1] ?? 0) + start.gap
    } ${body - reserved} ${(dashes[3] ?? 0) + end.gap}`;
  }
}

function inspectEnd(
  path: SVGElement,
  end: "start" | "end",
  markers: Map<string, Element>,
  tuned: Set<Element>
): { gap: number; marker: Element | null; offset: number } {
  const raw = path.getAttribute(`marker-${end}`);
  if (!raw) {
    return { gap: 0, marker: null, offset: 0 };
  }
  const id = MARKER_URL_RE.exec(raw)?.[1];
  const marker = id ? (markers.get(id) ?? null) : null;
  if (!marker) {
    return { gap: 0, marker: null, offset: 0 };
  }
  const nameOk =
    end === "start"
      ? POINT_START_MARGIN_RE.test(marker.id)
      : POINT_END_MARGIN_RE.test(marker.id);
  const expectedRefX = end === "start" ? 1 : 11.5;
  const refX = Number(marker.getAttribute("refX"));
  if (!nameOk || (!tuned.has(marker) && refX !== expectedRefX)) {
    return { gap: 0, marker: null, offset: 0 };
  }
  return {
    gap: 4,
    marker,
    offset: end === "start" ? -4 : 4,
  };
}
