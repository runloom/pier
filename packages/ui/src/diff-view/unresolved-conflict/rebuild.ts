import type { ConflictGeometry, ConflictResolution } from "./types.ts";

/** Rebuild resolved text for one conflict region (Pierre line surgery). */
export function applyConflictResolution(
  contents: string,
  conflict: ConflictGeometry,
  resolution: ConflictResolution
): string {
  const lines = splitPreserveNewlines(contents);
  const currentLines = lines.slice(
    conflict.startLineIndex + 1,
    conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex
  );
  const incomingLines = lines.slice(
    conflict.separatorLineIndex + 1,
    conflict.endLineIndex
  );
  let replacement: string[];
  if (resolution === "current") {
    replacement = currentLines;
  } else if (resolution === "incoming") {
    replacement = incomingLines;
  } else {
    replacement = [...currentLines, ...incomingLines];
  }
  return [
    ...lines.slice(0, conflict.startLineIndex),
    ...replacement,
    ...lines.slice(conflict.endLineIndex + 1),
  ].join("");
}

export function splitPreserveNewlines(contents: string): string[] {
  return contents === "" ? [] : contents.split(/(?<=\n)/u);
}

export function countUnresolvedMarkers(contents: string): number {
  let count = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (line.startsWith("<<<<<<<")) {
      count += 1;
    }
  }
  return count;
}
