export const LOGIN_TIMEOUT_MINUTES = 5;
export const LOGIN_TIMEOUT_MS = LOGIN_TIMEOUT_MINUTES * 60 * 1000;
export const DATA_SCHEMA_ID = "grok.accounts" as const;
export const WATCH_SUPPRESS_MS = 1500;

/**
 * Machine marker for transient usage failures (network blip, 5xx, credential
 * read errors). Main composes it as `${MARKER} (detail)`; renderer matches on
 * this full marker — never on loose substrings like "temporarily
 * unavailable", which can also appear inside genuine auth-failure details
 * (e.g. an OAuth `temporarily_unavailable` description).
 */
export const USAGE_TEMPORARILY_UNAVAILABLE_ERROR =
  "Grok usage temporarily unavailable";
