export const HTML_PREVIEW_SCHEME = "pier-html-preview";

const HTML_PREVIEW_TICKET_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;

const HTML_PREVIEW_HOST = "preview";

/**
 * URL 结构: `pier-html-preview://preview/<ticket>/<relPath 各段 encode>`.
 * relPath 各段分别 encodeURIComponent, 段间保持 `/` 分隔, 以便预览文档里的
 * 相对资源（href/src/fetch）按同源规则解析到同 scheme 的兄弟 URL。
 */
export function buildHtmlPreviewUrl(ticket: string, relPath: string): string {
  if (!HTML_PREVIEW_TICKET_PATTERN.test(ticket)) {
    throw new Error("Invalid html preview ticket");
  }
  const encodedPath = relPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  if (!encodedPath) {
    throw new Error("Invalid html preview relPath");
  }
  return `${HTML_PREVIEW_SCHEME}://${HTML_PREVIEW_HOST}/${ticket}/${encodedPath}`;
}

export function parseHtmlPreviewUrl(
  value: string
): { relPath: string; ticket: string } | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${HTML_PREVIEW_SCHEME}:` ||
      url.hostname !== HTML_PREVIEW_HOST ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const [ticketSegment, ...pathSegments] = segments;
    const ticket = ticketSegment ?? "";
    if (!HTML_PREVIEW_TICKET_PATTERN.test(ticket)) {
      return null;
    }
    const relPath = pathSegments
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    if (!relPath || relPath.split("/").some((segment) => segment === "..")) {
      return null;
    }
    return { relPath, ticket };
  } catch {
    return null;
  }
}
