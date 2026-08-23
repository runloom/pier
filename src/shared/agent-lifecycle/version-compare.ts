/**
 * Lightweight version compare for agent CLIs (not full semver ranges).
 * Strips common prefixes (`v`, package name noise) and compares numeric dots.
 */

/** At least major.minor — avoid matching CLI flags like `[--4]` in help text. */
const VERSION_TOKEN_RE = /\d+\.\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?/;

function normalizeVersionToken(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("v") || s.startsWith("V")) {
    s = s.slice(1);
  }
  // Prefer first semver-ish token in noisy --version output.
  const match = VERSION_TOKEN_RE.exec(s);
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

/** Git-style build metadata (`-gabc1234`), not semver precedence. */
function isBuildMetadataPre(pre: string): boolean {
  return /^g[0-9a-f]{6,}$/i.test(pre);
}

/** Cursor CLI: `2026.08.11-e8db854`. */
const DATE_HASH_RE = /^(\d{4})\.(\d{2})\.(\d{2})-([0-9a-f]+)$/i;

interface DateHashVersion {
  day: number;
  hash: string;
  month: number;
  year: number;
}

function parseDateHash(version: string): DateHashVersion | null {
  const match = DATE_HASH_RE.exec(version.trim());
  if (!match) {
    return null;
  }
  return {
    day: Number(match[3]),
    hash: (match[4] ?? "").toLowerCase(),
    month: Number(match[2]),
    year: Number(match[1]),
  };
}

function compareDateHash(
  left: DateHashVersion,
  right: DateHashVersion
): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareAgentVersions(a: string, b: string): number {
  const leftDate = parseDateHash(a);
  const rightDate = parseDateHash(b);
  if (leftDate && rightDate) {
    return compareDateHash(leftDate, rightDate);
  }
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
  // Same numeric core.
  if (left.pre === right.pre) {
    return 0;
  }
  // amp-style `-g<sha>` is build metadata, not semver precedence.
  if (isBuildMetadataPre(left.pre) || isBuildMetadataPre(right.pre)) {
    return 0;
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
  const currentDate = parseDateHash(c);
  const latestDate = parseDateHash(l);
  if (currentDate && latestDate) {
    const byDate = compareDateHash(currentDate, latestDate);
    if (byDate !== 0) {
      return byDate < 0;
    }
    // Hashes are not ordered; the remote latest is canonical.
    return c !== l;
  }
  return compareAgentVersions(c, l) < 0;
}

/** Best-effort parse of CLI --version stdout. */
export function extractVersionFromOutput(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    const match = VERSION_TOKEN_RE.exec(line);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}
