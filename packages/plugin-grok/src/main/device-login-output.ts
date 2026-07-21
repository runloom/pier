/**
 * Heuristic parser for Grok CLI `login --device-auth` output.
 *
 * A GUI-launched Electron app has no visible stdout, so the verification URL
 * and user code the CLI prints must be captured and surfaced in the waiting
 * dialog. The exact CLI wording may change; parse defensively.
 */

export interface DeviceLoginInfo {
  deviceCode?: string | undefined;
  deviceVerificationUrl?: string | undefined;
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/;

/** Dashed user codes like `ABCD-1234` (most device-auth flows). */
const DASHED_CODE_PATTERN = /\b([A-Z0-9]{3,8}-[A-Z0-9]{3,8})\b/;

/** `code: XYZ123` / `enter the code XYZ123` style lines. */
const LABELED_CODE_PATTERN = /\bcode\b[^A-Za-z0-9]{0,5}([A-Z0-9-]{4,24})\b/i;

export function parseDeviceLoginOutput(output: string): DeviceLoginInfo {
  const info: DeviceLoginInfo = {};

  const urlMatch = output.match(URL_PATTERN);
  if (urlMatch) {
    // Trim trailing punctuation that often follows URLs in prose.
    info.deviceVerificationUrl = urlMatch[0].replace(/[.,;:!?]+$/, "");
  }

  const withoutUrls = output.replace(new RegExp(URL_PATTERN.source, "g"), " ");
  const dashed = withoutUrls.match(DASHED_CODE_PATTERN);
  if (dashed?.[1]) {
    info.deviceCode = dashed[1];
    return info;
  }
  const labeled = withoutUrls.match(LABELED_CODE_PATTERN);
  if (labeled?.[1]) {
    info.deviceCode = labeled[1];
  }
  return info;
}
