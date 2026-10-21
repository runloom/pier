export type CsvDelimiter = "," | "\t" | ";" | "|";

export type CsvEol = "\r\n" | "\n" | "\r" | "";

export interface CsvCell {
  /** Raw offset after the closing quote / last value char. */
  end: number;
  quoted: boolean;
  /** Raw offset including the opening quote. */
  start: number;
  /** Decoded cell value (quotes removed, `""` unescaped). */
  value: string;
}

export interface CsvRow {
  cells: CsvCell[];
  /** Raw end of the last cell (before EOL). */
  end: number;
  eol: CsvEol;
  eolEnd: number;
  eolStart: number;
  /** First raw byte of the row. */
  start: number;
}

export interface CsvParseError {
  code: "trailing-after-quote" | "unclosed-quote";
  column: number;
  line: number;
  offset: number;
}

export interface CsvTable {
  bomLength: number;
  columnCount: number;
  delimiter: CsvDelimiter;
  /** Dominant row ending, used when appending rows/columns. */
  eol: CsvEol;
  error: CsvParseError | null;
  rows: CsvRow[];
  text: string;
}

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [",", "\t", ";", "|"];

const DELIMITER_SAMPLE_LINES = 200;
const DELIMITER_HINT_BONUS = 5;

export function delimiterHintForPath(path: string | undefined): CsvDelimiter {
  const lowered = path?.toLowerCase() ?? "";
  if (lowered.endsWith(".tsv") || lowered.endsWith(".tab")) {
    return "\t";
  }
  return ",";
}

function sampleDelimiterCounts(
  text: string,
  delimiter: CsvDelimiter,
  bomLength: number
): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let count = 0;
  let lastWasEol = false;
  for (let index = bomLength; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = false;
        }
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      lastWasEol = false;
      continue;
    }
    if (char === delimiter) {
      // A comma between digits is usually a decimal separator, not a field
      // delimiter. Ignoring it keeps semicolon CSVs with decimal commas
      // detectable even when the file has a comma extension hint.
      if (
        delimiter === "," &&
        /\d/u.test(text[index - 1] ?? "") &&
        /\d/u.test(text[index + 1] ?? "")
      ) {
        lastWasEol = false;
        continue;
      }
      count += 1;
      lastWasEol = false;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      counts.push(count);
      count = 0;
      lastWasEol = true;
      if (counts.length >= DELIMITER_SAMPLE_LINES) {
        return counts;
      }
      continue;
    }
    lastWasEol = false;
  }
  // Unterminated quoted sample: the last physical line is incomplete.
  if (!(inQuotes || lastWasEol)) {
    counts.push(count);
  }
  return counts;
}

/**
 * RFC 4180-ish delimiter sniffing. Consistency of fields-per-line beats raw
 * comma frequency, so prose with commas does not beat a real TSV tab.
 */
export function detectCsvDelimiter(
  text: string,
  hint: CsvDelimiter = ","
): CsvDelimiter {
  const bomLength = text.charCodeAt(0) === 0xfe_ff ? 1 : 0;
  let best: CsvDelimiter = hint;
  let bestScore = -1;
  for (const candidate of CSV_DELIMITERS) {
    const counts = sampleDelimiterCounts(text, candidate, bomLength);
    if (counts.length === 0) {
      const score = candidate === hint ? DELIMITER_HINT_BONUS : 0;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
      continue;
    }
    const frequencies = new Map<number, number>();
    let coveredLines = 0;
    for (const count of counts) {
      if (count > 0) {
        coveredLines += 1;
        frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
      }
    }
    if (coveredLines === 0) {
      const score = candidate === hint ? DELIMITER_HINT_BONUS : 0;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
      continue;
    }
    let modalCount = 0;
    let modalFrequency = 0;
    for (const [count, frequency] of frequencies) {
      if (
        frequency > modalFrequency ||
        (frequency === modalFrequency && count > modalCount)
      ) {
        modalCount = count;
        modalFrequency = frequency;
      }
    }
    const consistency = modalFrequency / coveredLines;
    const coverage = coveredLines / counts.length;
    const score = consistency * 100 + coverage * 40 + Math.min(modalCount, 32);
    // The extension hint is a tie-breaker, not evidence that can outweigh a
    // more consistent delimiter.
    if (score > bestScore || (score === bestScore && candidate === hint)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

interface FinalizeCellInput {
  cellStart: number;
  delimiterIndex: number;
  quoted: boolean;
  quoteEnd: number | null;
  text: string;
}

function finalizeCell(input: FinalizeCellInput): CsvCell {
  const { cellStart, delimiterIndex, quoted, quoteEnd, text } = input;
  if (!quoted) {
    return {
      end: delimiterIndex,
      quoted: false,
      start: cellStart,
      value: text.slice(cellStart, delimiterIndex),
    };
  }
  const innerEnd = quoteEnd ?? delimiterIndex;
  const rawInner = text.slice(cellStart + 1, innerEnd);
  return {
    end: quoteEnd === null ? delimiterIndex : quoteEnd + 1,
    quoted: true,
    start: cellStart,
    value: rawInner.includes('""') ? rawInner.replaceAll('""', '"') : rawInner,
  };
}

function positionAt(
  text: string,
  offset: number,
  start = 0
): { column: number; line: number } {
  let line = 1;
  let column = 1;
  for (let index = start; index < offset && index < text.length; index += 1) {
    const char = text[index];
    if (char === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      line += 1;
      column = 1;
    } else if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { column, line };
}

/**
 * Parse delimited text while retaining every cell's raw source span. Editing
 * only replaces the touched span, so untouched quoting/whitespace/EOL stays
 * byte-identical (important for Git diffs).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvTable {
  const bomLength = text.charCodeAt(0) === 0xfe_ff ? 1 : 0;
  const rows: CsvRow[] = [];
  const cells: CsvCell[] = [];
  let rowStart = bomLength;
  let cellStart = bomLength;
  let inQuotes = false;
  let quoted = false;
  let quoteStart = -1;
  let quoteEnd: number | null = null;
  let error: CsvParseError | null = null;
  const eolCounts = new Map<CsvEol, number>();

  const pushCell = (delimiterIndex: number) => {
    cells.push(
      finalizeCell({
        cellStart,
        delimiterIndex,
        quoted,
        quoteEnd,
        text,
      })
    );
    cellStart = delimiterIndex + 1;
    quoted = false;
    quoteStart = -1;
    quoteEnd = null;
  };

  const pushRow = (eol: CsvEol, eolStart: number, eolEnd: number) => {
    // A row with no cell start still owns one empty cell (blank line).
    if (cellStart <= eolStart) {
      pushCell(eolStart);
    }
    const lastCell = cells.at(-1);
    rows.push({
      cells: [...cells],
      end: lastCell?.end ?? eolStart,
      eol,
      eolEnd,
      eolStart,
      start: rowStart,
    });
    cells.length = 0;
    rowStart = eolEnd;
    cellStart = eolEnd;
    if (eol !== "") {
      eolCounts.set(eol, (eolCounts.get(eol) ?? 0) + 1);
    }
  };

  let index = bomLength;
  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          index += 2;
          continue;
        }
        inQuotes = false;
        quoteEnd = index;
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (char === '"' && index === cellStart) {
      inQuotes = true;
      quoted = true;
      quoteStart = index;
      index += 1;
      continue;
    }

    if (quoted && quoteEnd !== null && char !== "\r" && char !== "\n") {
      if (char === delimiter) {
        pushCell(index);
        index += 1;
        continue;
      }
      if (
        char !== undefined &&
        char !== "\r" &&
        char !== "\n" &&
        !/\s/u.test(char) &&
        error === null
      ) {
        const position = positionAt(text, index, bomLength);
        error = {
          code: "trailing-after-quote",
          column: position.column,
          line: position.line,
          offset: index,
        };
      }
      index += 1;
      continue;
    }

    if (char === delimiter) {
      pushCell(index);
      index += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      let eol: CsvEol = "\n";
      if (char === "\r") {
        eol = text[index + 1] === "\n" ? "\r\n" : "\r";
      }
      const eolStart = index;
      index += eol.length;
      pushRow(eol, eolStart, index);
      continue;
    }

    index += 1;
  }

  if (inQuotes) {
    const position = positionAt(text, quoteStart, bomLength);
    error = {
      code: "unclosed-quote",
      column: position.column,
      line: position.line,
      offset: quoteStart,
    };
  }

  // Final row without a trailing line ending. A file ending in EOL already
  // pushed its row and must not gain a phantom empty row.
  if (cellStart < text.length || cells.length > 0) {
    pushCell(text.length);
    const lastCell = cells.at(-1);
    rows.push({
      cells: [...cells],
      end: lastCell?.end ?? text.length,
      eol: "",
      eolEnd: text.length,
      eolStart: text.length,
      start: rowStart,
    });
  }

  let columnCount = 0;
  for (const row of rows) {
    columnCount = Math.max(columnCount, row.cells.length);
  }

  let dominantEol: CsvEol = "\n";
  let dominantCount = 0;
  for (const [eol, count] of eolCounts) {
    if (count > dominantCount) {
      dominantEol = eol;
      dominantCount = count;
    }
  }

  return {
    bomLength,
    columnCount,
    delimiter,
    eol: dominantEol,
    error,
    rows,
    text,
  };
}

export function parseCsvWithDetection(
  text: string,
  path?: string,
  delimiterOverride?: CsvDelimiter
): CsvTable {
  const hint = delimiterOverride ?? delimiterHintForPath(path);
  const delimiter = delimiterOverride ?? detectCsvDelimiter(text, hint);
  return parseCsv(text, delimiter);
}
