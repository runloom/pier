import { asRecord, asString } from "./utils.ts";

export interface ProblemMatch {
  column?: number;
  file?: string;
  line?: number;
  message?: string;
}

export interface ProblemPattern {
  column?: number;
  file?: number;
  line?: number;
  message?: number;
  regexp: RegExp;
}

export interface ProblemMatcher {
  background?: {
    activeOnStart?: boolean;
    beginsPattern?: RegExp;
    endsPattern?: RegExp;
  };
  patterns: ProblemPattern[];
}

function numberField(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function patternFromRaw(raw: unknown): ProblemPattern | null {
  const record = asRecord(raw);
  const regexp = asString(record?.regexp);
  if (!(record && regexp)) {
    return null;
  }
  const pattern: ProblemPattern = { regexp: new RegExp(regexp) };
  const column = numberField(record, "column");
  const file = numberField(record, "file");
  const line = numberField(record, "line");
  const message = numberField(record, "message");
  if (column !== undefined) {
    pattern.column = column;
  }
  if (file !== undefined) {
    pattern.file = file;
  }
  if (line !== undefined) {
    pattern.line = line;
  }
  if (message !== undefined) {
    pattern.message = message;
  }
  return pattern;
}

function backgroundFromRaw(raw: unknown): ProblemMatcher["background"] {
  const record = asRecord(raw);
  if (!record) {
    return;
  }
  const beginsPattern = asString(record.beginsPattern);
  const endsPattern = asString(record.endsPattern);
  return {
    ...(typeof record.activeOnStart === "boolean"
      ? { activeOnStart: record.activeOnStart }
      : {}),
    ...(beginsPattern ? { beginsPattern: new RegExp(beginsPattern) } : {}),
    ...(endsPattern ? { endsPattern: new RegExp(endsPattern) } : {}),
  };
}

export function createProblemMatcher(raw: unknown): ProblemMatcher {
  const record = asRecord(raw);
  const pattern = record?.pattern;
  const patterns = (Array.isArray(pattern) ? pattern : [pattern])
    .map(patternFromRaw)
    .filter((item): item is ProblemPattern => item !== null);
  const matcher: ProblemMatcher = { patterns };
  const background = backgroundFromRaw(record?.background);
  if (background) {
    matcher.background = background;
  }
  return matcher;
}

function assignGroup(
  match: ProblemMatch,
  pattern: ProblemPattern,
  groups: RegExpMatchArray
): ProblemMatch {
  const file = pattern.file ? groups[pattern.file] : undefined;
  const line = pattern.line ? groups[pattern.line] : undefined;
  const column = pattern.column ? groups[pattern.column] : undefined;
  const message = pattern.message ? groups[pattern.message] : undefined;
  return {
    ...match,
    ...(file ? { file } : {}),
    ...(line ? { line: Number.parseInt(line, 10) } : {}),
    ...(column ? { column: Number.parseInt(column, 10) } : {}),
    ...(message ? { message } : {}),
  };
}

export function matchProblemLines(
  matcher: ProblemMatcher,
  lines: readonly string[]
): ProblemMatch[] {
  if (matcher.patterns.length === 0) {
    return [];
  }
  if (matcher.patterns.length === 1) {
    const pattern = matcher.patterns[0];
    return lines.flatMap((line) => {
      const groups = pattern?.regexp.exec(line);
      return groups && pattern ? [assignGroup({}, pattern, groups)] : [];
    });
  }
  const matches: ProblemMatch[] = [];
  for (
    let index = 0;
    index <= lines.length - matcher.patterns.length;
    index++
  ) {
    let current: ProblemMatch = {};
    let matched = true;
    for (let offset = 0; offset < matcher.patterns.length; offset++) {
      const pattern = matcher.patterns[offset];
      const line = lines[index + offset];
      const groups = pattern && line ? pattern.regexp.exec(line) : null;
      if (!(groups && pattern)) {
        matched = false;
        break;
      }
      current = assignGroup(current, pattern, groups);
    }
    if (matched) {
      matches.push(current);
    }
  }
  return matches;
}
