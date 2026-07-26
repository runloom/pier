/** 活动行次要 meta 用的短路径标签（取末段，避免实现词）。 */

export function shortProjectLabel(
  path: string | undefined
): string | undefined {
  if (!path) {
    return;
  }
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) {
    return;
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1);
}

export function activityRowMetaText(
  kindLabel: string,
  projectPath: string | undefined
): string {
  const short = shortProjectLabel(projectPath);
  return short ? `${kindLabel} · ${short}` : kindLabel;
}
