/**
 * Shared localStorage plumbing for column-width memory (CSV and XLSX).
 * Keys are built by each surface; validation and failure containment live
 * here so a hardening fix cannot land on one grid but miss the other.
 */

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredColumnWidths(
  storageKey: string
): Record<string, number> | null {
  const raw = preferenceStorage()?.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const widths: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        widths[key] = Math.round(value);
      }
    }
    return Object.keys(widths).length > 0 ? widths : null;
  } catch {
    return null;
  }
}

export function writeStoredColumnWidths(
  storageKey: string,
  widths: Record<string, number>
): void {
  try {
    preferenceStorage()?.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Preference persistence never breaks the grid.
  }
}
