/** Allowlisted HTTPS hosts for remote latest-version probes. */

export const ALLOWED_LATEST_HOSTS = new Set([
  "api.github.com",
  "cursor.com",
  "www.cursor.com",
  "downloads.claude.ai",
  "code.kimi.com",
  "formulae.brew.sh",
]);

export function assertLatestHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid latest URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Latest URL must be https: ${url}`);
  }
  if (!ALLOWED_LATEST_HOSTS.has(parsed.hostname)) {
    throw new Error(`Latest host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}
