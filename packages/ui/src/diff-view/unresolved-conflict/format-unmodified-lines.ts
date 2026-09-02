const DEFAULT_UNMODIFIED_LINE = "{{count}} unmodified line";
const DEFAULT_UNMODIFIED_LINES = "{{count}} unmodified lines";

/**
 * Build `CodeViewOptions.formatUnmodifiedLines` from host i18n templates.
 *
 * Plural selection is `count === 1` only (matches en/zh product needs). Callers
 * that need ICU few/many/zero must pass a pre-resolved formatter themselves via
 * `CodeViewOptions.formatUnmodifiedLines` instead of these templates.
 */
export function createFormatUnmodifiedLines(labels: {
  readonly unmodifiedLine?: string | undefined;
  readonly unmodifiedLines?: string | undefined;
}): (lines: number) => string {
  const singular = labels.unmodifiedLine ?? DEFAULT_UNMODIFIED_LINE;
  const plural = labels.unmodifiedLines ?? DEFAULT_UNMODIFIED_LINES;
  return (lines: number) => {
    const safe = Number.isFinite(lines) && lines >= 0 ? Math.floor(lines) : 0;
    const template = safe === 1 ? singular : plural;
    return template.replaceAll("{{count}}", String(safe));
  };
}
