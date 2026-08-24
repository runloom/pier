/**
 * Classify electron-updater failures into user-facing error kinds.
 * Heuristics over the raw error message/code — electron-updater does not
 * expose structured error categories, so patterns cover the shapes it
 * actually emits (Electron net errors, Node fs/net codes, HttpError text,
 * GitHub provider messages).
 */
import type { AppUpdateErrorKind } from "@shared/contracts/app-update.ts";

const OFFLINE_PATTERN =
  /net::ERR_|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_PROXY|ERR_TUNNEL|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|EPIPE|getaddrinfo|network.*unavailable|Network request failed/i;

const RATE_LIMIT_PATTERN = /rate.?limit|\b403\b|\b429\b/i;

const NO_ARTIFACT_PATTERN =
  /latest-(mac|linux|windows)\.yml|latest\.yml|No published versions|ERR_UPDATER_NO_PUBLISHED_VERSIONS|Cannot find.*artifacts|\b404\b/i;

const SERVER_PATTERN =
  /\b5\d\d\b|Bad Gateway|Service Unavailable|Internal Server Error|Gateway Time-?out/i;

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if ("code" in err && typeof err.code === "string") {
      return `${err.message} ${err.code}`;
    }
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return err == null ? "" : String(err);
}

export function classifyAppUpdateError(err: unknown): AppUpdateErrorKind {
  const text = errorText(err);
  if (!text) {
    return "unknown";
  }
  if (OFFLINE_PATTERN.test(text)) {
    return "offline";
  }
  if (RATE_LIMIT_PATTERN.test(text)) {
    return "rate-limited";
  }
  if (NO_ARTIFACT_PATTERN.test(text)) {
    return "no-artifact";
  }
  if (SERVER_PATTERN.test(text)) {
    return "server";
  }
  return "unknown";
}
