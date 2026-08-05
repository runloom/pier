/**
 * Lightweight version compare for agent CLIs (not full semver ranges).
 * Strips common prefixes (`v`, package name noise) and compares numeric dots.
 */

function normalizeVersionToken(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("v") || s.startsWith("V")) {
    s = s.slice(1);
  }
  // Prefer first semver-ish token in noisy --version output.
  const match = /\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?/.exec(s);
  return match?.[0] ?? s;
}

function splitParts(version: string): { nums: number[]; pre: string } {
  const normalized = normalizeVersionToken(version);
  const segments = normalized.split("-");
  const core = segments[0] ?? normalized;
  const pre = segments.slice(1).join("-");
  const nums = core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (nums.length < 3) {
    nums.push(0);
  }
  return { nums, pre };
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareAgentVersions(a: string, b: string): number {
  const left = splitParts(a);
  const right = splitParts(b);
  const len = Math.max(left.nums.length, right.nums.length);
  for (let i = 0; i < len; i += 1) {
    const lv = left.nums[i] ?? 0;
    const rv = right.nums[i] ?? 0;
    if (lv !== rv) {
      return lv - rv;
    }
  }
  // No prerelease beats prerelease (1.0.0 > 1.0.0-beta).
  if (left.pre && !right.pre) {
    return -1;
  }
  if (!left.pre && right.pre) {
    return 1;
  }
  return left.pre.localeCompare(right.pre);
}

export function isAgentUpdateAvailable(
  current: string | null | undefined,
  latest: string | null | undefined
): boolean {
  if (!(current && latest)) {
    return false;
  }
  const c = current.trim();
  const l = latest.trim();
  if (!(c && l)) {
    return false;
  }
  return compareAgentVersions(c, l) < 0;
}

/** Best-effort parse of CLI --version stdout. */
export function extractVersionFromOutput(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) {
    return null;
  }
  const match = /\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?/.exec(line);
  return match?.[0] ?? null;
}
