import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Restricted SKILL.md frontmatter parsing (design v8 §6.1), extracted from the
 * import service so snapshot widening and the global read-only enumeration can
 * share it without coupling read paths to the import module. Exact port of the
 * S1 parser semantics: max 64 KiB, depth 16, no anchors/aliases/custom tags,
 * no flow collections, plain maps/lists/scalars only.
 */

export const SKILL_FRONTMATTER_LIMITS = {
  maxBytes: 64 * 1024,
  maxDepth: 16,
  /** Cap for whole-file reads on metadata-only paths (snapshot/global view). */
  maxSkillMdBytes: 1024 * 1024,
} as const;

export class SkillFrontmatterError extends Error {
  readonly code = "frontmatter-invalid" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SkillFrontmatterError";
  }
}

export function parseSafeSkillFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!markdown.startsWith("---")) {
    return { frontmatter: {}, body: markdown };
  }
  const rest = markdown.slice(3);
  // Allow optional BOM / newline after opening fence.
  const afterOpen = rest.replace(/^\r?\n/, "");
  const closeIdx = afterOpen.search(/\r?\n---[ \t]*\r?\n/);
  if (closeIdx < 0) {
    // No closing fence — treat whole file as body.
    return { frontmatter: {}, body: markdown };
  }
  const rawFm = afterOpen.slice(0, closeIdx);
  const bodyStartMatch = afterOpen
    .slice(closeIdx)
    .match(/^\r?\n---[ \t]*\r?\n/);
  const body = bodyStartMatch
    ? afterOpen.slice(closeIdx + bodyStartMatch[0].length)
    : afterOpen.slice(closeIdx);

  const fmBytes = Buffer.byteLength(rawFm, "utf8");
  if (fmBytes > SKILL_FRONTMATTER_LIMITS.maxBytes) {
    throw new SkillFrontmatterError(
      `YAML frontmatter exceeds ${SKILL_FRONTMATTER_LIMITS.maxBytes} bytes`
    );
  }

  // Reject anchors, aliases, custom tags.
  if (/(^|[\s[{,])[&*!]/.test(rawFm) || /!!/.test(rawFm)) {
    throw new SkillFrontmatterError(
      "YAML anchors, aliases, and custom tags are not allowed"
    );
  }

  try {
    const parsed = parseRestrictedYaml(rawFm, 0);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new SkillFrontmatterError("YAML frontmatter must be a mapping");
    }
    return { frontmatter: parsed as Record<string, unknown>, body };
  } catch (error) {
    if (error instanceof SkillFrontmatterError) throw error;
    throw new SkillFrontmatterError("failed to parse YAML frontmatter", {
      cause: error,
    });
  }
}

/** Metadata-only view of a SKILL.md; never throws (degrades to empty strings). */
export interface SkillMetadataPeek {
  description: string;
  name: string;
}

/**
 * Read `<skillDir>/SKILL.md` and extract name/description best-effort.
 * Used by snapshot widening and the global read-only view: parse failures and
 * oversized files degrade to empty strings — read paths never block on
 * untrusted content.
 */
export async function peekSkillMetadata(
  skillDir: string
): Promise<SkillMetadataPeek> {
  try {
    const raw = await readFile(join(skillDir, "SKILL.md"));
    if (raw.byteLength > SKILL_FRONTMATTER_LIMITS.maxSkillMdBytes) {
      return { name: "", description: "" };
    }
    const { frontmatter } = parseSafeSkillFrontmatter(raw.toString("utf8"));
    const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "";
    return { name, description };
  } catch {
    return { name: "", description: "" };
  }
}

interface YamlLine {
  indent: number;
  text: string;
}

function splitYamlLines(source: string): YamlLine[] {
  return source.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      return [];
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return [{ indent, text: line.slice(indent) }];
  });
}

function parseRestrictedYaml(source: string, depth: number): unknown {
  if (depth > SKILL_FRONTMATTER_LIMITS.maxDepth) {
    throw new SkillFrontmatterError(
      `YAML nesting exceeds depth ${SKILL_FRONTMATTER_LIMITS.maxDepth}`
    );
  }
  const lines = splitYamlLines(source);
  if (lines.length === 0) return {};
  return parseYamlBlock(lines, 0, lines[0]!.indent, depth).value;
}

function parseYamlBlock(
  lines: YamlLine[],
  start: number,
  indent: number,
  depth: number
): { value: unknown; next: number } {
  if (depth > SKILL_FRONTMATTER_LIMITS.maxDepth) {
    throw new SkillFrontmatterError(
      `YAML nesting exceeds depth ${SKILL_FRONTMATTER_LIMITS.maxDepth}`
    );
  }
  if (start >= lines.length) return { value: {}, next: start };
  const first = lines[start]!;
  if (first.indent !== indent) {
    throw new SkillFrontmatterError("inconsistent YAML indentation");
  }
  if (first.text.startsWith("- ")) {
    return parseYamlSequence(lines, start, indent, depth);
  }
  return parseYamlMapping(lines, start, indent, depth);
}

function parseYamlMapping(
  lines: YamlLine[],
  start: number,
  indent: number,
  depth: number
): { value: Record<string, unknown>; next: number } {
  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SkillFrontmatterError("unexpected indented YAML line");
    }
    if (line.text.startsWith("- ")) {
      throw new SkillFrontmatterError("sequence entry where mapping expected");
    }
    const colon = findMappingColon(line.text);
    if (colon < 0) {
      throw new SkillFrontmatterError(`expected key: value, got: ${line.text}`);
    }
    const key = parseYamlScalar(line.text.slice(0, colon).trim());
    if (typeof key !== "string") {
      throw new SkillFrontmatterError("mapping keys must be strings");
    }
    const rest = line.text.slice(colon + 1).trim();
    i += 1;
    if (rest.length > 0) {
      out[key] = parseYamlScalar(rest);
      continue;
    }
    // Nested block
    if (i >= lines.length || lines[i]!.indent <= indent) {
      out[key] = null;
      continue;
    }
    const nestedIndent = lines[i]!.indent;
    if (nestedIndent <= indent) {
      out[key] = null;
      continue;
    }
    const nested = parseYamlBlock(lines, i, nestedIndent, depth + 1);
    out[key] = nested.value;
    i = nested.next;
  }
  return { value: out, next: i };
}

function parseYamlSequence(
  lines: YamlLine[],
  start: number,
  indent: number,
  depth: number
): { value: unknown[]; next: number } {
  const out: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SkillFrontmatterError(
        "unexpected indented YAML line in sequence"
      );
    }
    if (!line.text.startsWith("- ")) {
      break;
    }
    const rest = line.text.slice(2).trim();
    i += 1;
    if (rest.length > 0) {
      out.push(parseYamlScalar(rest));
      // consume nested block under this list item if present
      if (i < lines.length && lines[i]!.indent > indent) {
        throw new SkillFrontmatterError(
          "nested YAML under inline sequence items is not supported"
        );
      }
      continue;
    }
    if (i >= lines.length || lines[i]!.indent <= indent) {
      out.push(null);
      continue;
    }
    const nestedIndent = lines[i]!.indent;
    const nested = parseYamlBlock(lines, i, nestedIndent, depth + 1);
    out.push(nested.value);
    i = nested.next;
  }
  return { value: out, next: i };
}

function findMappingColon(text: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) {
      if (i === 0 || text[i - 1] !== "\\") inDouble = !inDouble;
    } else if (ch === ":" && !inSingle && !inDouble) {
      return i;
    }
  }
  return -1;
}

function parseYamlScalar(text: string): unknown {
  if (text === "~" || text === "null" || text === "Null" || text === "NULL") {
    return null;
  }
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  // Reject flow collections / explicit tags; plain commas in scalars are fine.
  if (/[{}[\]]/.test(text)) {
    throw new SkillFrontmatterError(`unsupported YAML flow value: ${text}`);
  }
  return text;
}
