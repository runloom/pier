/**
 * Repo-relative path order matching `@pierre/trees` **path-store** default
 * (`comparePreparedEntries` / segment natural sort) when expanded to a DFS
 * file list (directories first at each level).
 *
 * This is **not** the older trees `utils/sortChildren` helper (dotfiles-first +
 * localeCompare). Pin parity in unit tests against path-store semantics.
 *
 * Used so git review CodeView / demand / comment nav stay aligned with the
 * sidebar tree. Do not use plain `localeCompare` on full paths — root files
 * would jump above directories (e.g. AGENTS.md before src/).
 *
 * @see @pierre/trees path-store compareSiblingNodesDefault / comparePreparedEntries
 */

interface SegmentSortKey {
  readonly lowerValue: string;
  readonly tokens: readonly (number | string)[];
}

function isDigitCode(characterCode: number): boolean {
  return characterCode >= 48 && characterCode <= 57;
}

function splitIntoNaturalTokens(value: string): Array<number | string> {
  const tokens: Array<number | string> = [];
  let tokenStart = 0;
  let index = 0;
  while (index < value.length) {
    while (index < value.length && !isDigitCode(value.charCodeAt(index))) {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }
    if (index > tokenStart) {
      tokens.push(value.slice(tokenStart, index));
    }
    let numberValue = 0;
    while (index < value.length && isDigitCode(value.charCodeAt(index))) {
      numberValue = numberValue * 10 + (value.charCodeAt(index) - 48);
      index += 1;
    }
    tokens.push(numberValue);
    tokenStart = index;
  }
  if (tokenStart < value.length || tokens.length === 0) {
    tokens.push(value.slice(tokenStart));
  }
  return tokens;
}

function createSegmentSortKey(value: string): SegmentSortKey {
  const lowerValue = value.toLowerCase();
  return {
    lowerValue,
    tokens: splitIntoNaturalTokens(lowerValue),
  };
}

function compareNaturalTokens(
  leftTokens: readonly (number | string)[],
  rightTokens: readonly (number | string)[]
): number {
  const tokenCount = Math.min(leftTokens.length, rightTokens.length);
  for (let index = 0; index < tokenCount; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === rightToken) {
      continue;
    }
    if (typeof leftToken === "number" && typeof rightToken === "number") {
      return leftToken < rightToken ? -1 : 1;
    }
    const leftString = String(leftToken);
    const rightString = String(rightToken);
    if (leftString !== rightString) {
      return leftString < rightString ? -1 : 1;
    }
  }
  if (leftTokens.length !== rightTokens.length) {
    return leftTokens.length < rightTokens.length ? -1 : 1;
  }
  return 0;
}

function compareSegmentSortKeys(
  leftKey: SegmentSortKey,
  rightKey: SegmentSortKey
): number {
  if (
    leftKey.tokens.length === 1 &&
    rightKey.tokens.length === 1 &&
    typeof leftKey.tokens[0] === "string" &&
    typeof rightKey.tokens[0] === "string"
  ) {
    if (leftKey.lowerValue === rightKey.lowerValue) {
      return 0;
    }
    return leftKey.lowerValue < rightKey.lowerValue ? -1 : 1;
  }
  const tokenComparison = compareNaturalTokens(leftKey.tokens, rightKey.tokens);
  if (tokenComparison !== 0) {
    return tokenComparison;
  }
  if (leftKey.lowerValue !== rightKey.lowerValue) {
    return leftKey.lowerValue < rightKey.lowerValue ? -1 : 1;
  }
  return 0;
}

function compareSegmentValues(left: string, right: string): number {
  const comparison = compareSegmentSortKeys(
    createSegmentSortKey(left),
    createSegmentSortKey(right)
  );
  if (comparison !== 0) {
    return comparison;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Kind at depth for a file path entry: intermediate segments act as
 * directories (1); the final segment is a file (0). Matches pierre
 * `getKindAtDepth` for non-directory leaf paths.
 */
function fileKindAtDepth(segmentCount: number, depth: number): 0 | 1 {
  return depth === segmentCount - 1 ? 0 : 1;
}

/**
 * Compare two repo-relative **file** paths in `@pierre/trees` default order.
 */
export function compareReviewTreePaths(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const sharedDepth = Math.min(leftSegments.length, rightSegments.length);
  for (let depth = 0; depth < sharedDepth; depth += 1) {
    const leftSegment = leftSegments[depth];
    const rightSegment = rightSegments[depth];
    if (leftSegment === undefined || rightSegment === undefined) {
      break;
    }
    if (leftSegment === rightSegment) {
      continue;
    }
    const leftKind = fileKindAtDepth(leftSegments.length, depth);
    const rightKind = fileKindAtDepth(rightSegments.length, depth);
    if (leftKind !== rightKind) {
      return leftKind === 1 ? -1 : 1;
    }
    return compareSegmentValues(leftSegment, rightSegment);
  }
  if (leftSegments.length !== rightSegments.length) {
    return leftSegments.length < rightSegments.length ? -1 : 1;
  }
  return 0;
}
