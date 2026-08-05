/**
 * Allowlist for official installer URLs. Runner downloads then executes;
 * plan preview uses the same host check via assertAllowedScriptUrl.
 */

const ALLOWED_SCRIPT_HOSTS = new Set([
  "claude.ai",
  "www.claude.ai",
  "x.ai",
  "www.x.ai",
  "opencode.ai",
  "www.opencode.ai",
  "cursor.com",
  "www.cursor.com",
  "code.kimi.com",
  "raw.githubusercontent.com",
  "mistral.ai",
  "www.mistral.ai",
  "omp.sh",
  "www.omp.sh",
  "cli.kiro.dev",
  "autohand.ai",
  "www.autohand.ai",
  "www.codebuddy.cn",
  "codebuddy.cn",
  "www.codebuddy.ai",
  "codebuddy.ai",
  "mimo.xiaomi.com",
  "antigravity.google",
  "cli.devin.ai",
  "static.devin.ai",
  "aider.chat",
  "www.aider.chat",
  // Official standalone installers (researched 2026-08)
  "chatgpt.com",
  "www.chatgpt.com",
  "pi.dev",
  "www.pi.dev",
  "ampcode.com",
  "www.ampcode.com",
  "app.factory.ai",
  "hermes-agent.nousresearch.com",
  "openclaw.ai",
  "www.openclaw.ai",
  "gh.io",
  "qoder.com",
  "www.qoder.com",
  "kilo.ai",
  "www.kilo.ai",
  "github.com",
  "www.github.com",
  // Qwen Code standalone installer (Aliyun OSS)
  "qwen-code-assets.oss-cn-hangzhou.aliyuncs.com",
]);

export function assertAllowedScriptUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid installer URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Installer URL must be https: ${url}`);
  }
  if (!ALLOWED_SCRIPT_HOSTS.has(parsed.hostname)) {
    throw new Error(`Installer host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}
