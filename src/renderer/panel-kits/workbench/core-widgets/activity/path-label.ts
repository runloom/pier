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

/**
 * 身份副行：标题可以缺席或重名，身份不能。把「哪个智能体 · 哪个项目 ·
 * 是否隶属别的会话」拼成一行，缺席的部分直接不出现，不补占位。
 */
export function activityIdentityMetaText(
  parts: readonly (string | undefined)[]
): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}
