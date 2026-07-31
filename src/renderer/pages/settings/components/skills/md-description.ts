/**
 * Replace the YAML `description:` value in a SKILL.md frontmatter block.
 * Matches the template writer (`JSON.stringify(description)`).
 */
export function replaceSkillMdDescription(
  skillMd: string,
  description: string
): string {
  const trimmed = description.replace(/\r?\n/g, " ").trim();
  const encoded = JSON.stringify(trimmed);
  if (!skillMd.startsWith("---")) {
    return skillMd;
  }
  const end = skillMd.indexOf("\n---", 3);
  if (end < 0) {
    return skillMd;
  }
  const header = skillMd.slice(0, end + 1);
  const rest = skillMd.slice(end + 1);
  if (/^description:\s*/m.test(header)) {
    return `${header.replace(/^description:\s*.*$/m, `description: ${encoded}`)}${rest}`;
  }
  return `${header}description: ${encoded}\n${rest}`;
}

/**
 * Read the YAML `description:` value from a SKILL.md frontmatter block.
 * Supports JSON-encoded strings (template writer) and plain scalars.
 */
export function extractSkillMdDescription(skillMd: string): string | null {
  if (!skillMd.startsWith("---")) {
    return null;
  }
  const end = skillMd.indexOf("\n---", 3);
  if (end < 0) {
    return null;
  }
  const header = skillMd.slice(0, end + 1);
  const match = /^description:\s*(.*)$/m.exec(header);
  if (!match) {
    return null;
  }
  return parseYamlStringScalar(match[1] ?? "");
}

/**
 * Replace the YAML `name:` value in a SKILL.md frontmatter block.
 * Always JSON-quotes the value so numeric ids (e.g. `333`) stay strings in YAML.
 * Also syncs the first ATX heading when it still mirrors the previous name.
 */
export function replaceSkillMdName(skillMd: string, name: string): string {
  const trimmed = name.trim();
  const encoded = JSON.stringify(trimmed);
  if (!skillMd.startsWith("---")) {
    return skillMd;
  }
  const end = skillMd.indexOf("\n---", 3);
  if (end < 0) {
    return skillMd;
  }
  const header = skillMd.slice(0, end + 1);
  let rest = skillMd.slice(end + 1);
  const previousRaw = /^name:\s*(.*)$/m.exec(header)?.[1] ?? "";
  const previousName = parseYamlStringScalar(previousRaw);
  const nextHeader = /^name:\s*/m.test(header)
    ? header.replace(/^name:\s*.*$/m, `name: ${encoded}`)
    : `${header}name: ${encoded}\n`;
  if (previousName && previousName !== trimmed) {
    const heading = new RegExp(`^#\\s+${escapeRegExp(previousName)}\\s*$`, "m");
    if (heading.test(rest)) {
      rest = rest.replace(heading, `# ${trimmed}`);
    }
  }
  return `${nextHeader}${rest}`;
}

/** True when frontmatter has a string `name` matching `skillId` (quoted or plain). */
export function skillMdNameMatchesId(
  skillMd: string,
  skillId: string
): boolean {
  if (!skillMd.startsWith("---")) {
    return false;
  }
  const end = skillMd.indexOf("\n---", 3);
  if (end < 0) {
    return false;
  }
  const header = skillMd.slice(0, end + 1);
  const match = /^name:\s*(.*)$/m.exec(header);
  if (!match) {
    return false;
  }
  const name = parseYamlStringScalar(match[1] ?? "");
  return name === skillId.trim();
}

function parseYamlStringScalar(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") {
        const trimmed = parsed.replace(/\r?\n/g, " ").trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    } catch {
      return value.slice(1, -1).replace(/\r?\n/g, " ").trim() || null;
    }
    return null;
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    const trimmed = value.slice(1, -1).replace(/\r?\n/g, " ").trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return value.replace(/\r?\n/g, " ").trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
