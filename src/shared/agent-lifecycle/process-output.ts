/**
 * Helpers for CLI install/update process output.
 * Package managers often redraw progress on stderr with CR + `#` bars —
 * those must not become user-facing error details.
 */

const MAX_ERROR_CHARS = 720;
const MAX_ERROR_LINES = 10;

/** True when the line is npm echoing our SIGTERM / --force, not a real error. */
export function isInstallerKillRattleLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) {
    return false;
  }
  if (/^npm warn using --force\b/i.test(t)) {
    return true;
  }
  if (/^npm error process terminated$/i.test(t)) {
    return true;
  }
  if (/^npm error signal SIG(TERM|KILL|INT)$/i.test(t)) {
    return true;
  }
  if (/^npm error Exit handler never called!$/i.test(t)) {
    return true;
  }
  if (/^npm error This is an error with npm itself\b/i.test(t)) {
    return true;
  }
  if (/^npm error Please report this error at:$/i.test(t)) {
    return true;
  }
  if (/^<?https?:\/\/github\.com\/npm\//i.test(t)) {
    return true;
  }
  if (/^npm error\s+<?https?:\/\/github\.com\/npm\//i.test(t)) {
    return true;
  }
  if (/^npm error A complete log of this run can be found in:/i.test(t)) {
    return true;
  }
  if (/\.npm\/_logs\//i.test(t)) {
    return true;
  }
  return false;
}

/** True for uv/pip/npm-style progress redraw lines (not real errors). */
export function isProgressNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) {
    return true;
  }
  // "99.2%####################" / pure hash bars
  if (/^\d{1,3}(\.\d+)?%\s*[#█▓▒░.=+-]*$/.test(t)) {
    return true;
  }
  if (/^[#█▓▒░]{6,}$/.test(t)) {
    return true;
  }
  // percent + mostly bar glyphs (mixed width redraw leftovers)
  const hashCount = (t.match(/[#█▓▒░]/g) ?? []).length;
  if (hashCount >= 8 && /^\d{0,3}(\.\d+)?%?[\s#█▓▒░.=+\-|/\\]*$/.test(t)) {
    return true;
  }
  // spinner-only / bare percent
  if (/^\d{1,3}(\.\d+)?%\s*$/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Last meaningful lines of tool output for error dialogs.
 * Splits on CR and LF so progress redraws become separate lines that can drop.
 */
export function sanitizeProcessOutput(
  text: string,
  options: { maxLines?: number; maxChars?: number } = {}
): string {
  const maxLines = options.maxLines ?? MAX_ERROR_LINES;
  const maxChars = options.maxChars ?? MAX_ERROR_CHARS;
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(
      (l) =>
        l.length > 0 && !isProgressNoiseLine(l) && !isInstallerKillRattleLine(l)
    );

  let out = lines.slice(-maxLines).join("\n").trim();
  if (out.length > maxChars) {
    out = `…${out.slice(-(maxChars - 1))}`;
  }
  return out;
}

/**
 * Best-effort percent from a process chunk (uv/pip progress bars).
 * Returns null when the chunk has no parseable progress.
 */
export function parseProgressPercent(chunk: string): number | null {
  // Prefer the last percent in the chunk (redraws accumulate).
  const matches = chunk.match(/(\d{1,3}(?:\.\d+)?)%/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  const last = matches.at(-1);
  if (!last) {
    return null;
  }
  const n = Number.parseFloat(last);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return null;
  }
  return Math.min(100, Math.max(0, n));
}
