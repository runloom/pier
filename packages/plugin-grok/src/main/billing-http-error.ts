export type BillingHttpErrorKind = "auth" | "access" | "generic";

export interface BillingHttpErrorClassification {
  detail: string;
  kind: BillingHttpErrorKind;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeErrorToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function compactErrorToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

const AUTH_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_token",
  "expired_token",
  "token_expired",
  "unauthorized",
  "unauthenticated",
  "permissiondenied",
  "permission_denied",
  "no_auth_context",
  "noauthcontext",
]);

const ACCESS_ERROR_CODES = new Set([
  "access_denied",
  "insufficient_permissions",
  "insufficient_scope",
  "not_entitled",
  "entitlement_required",
  "forbidden",
]);

function extractStructuredErrorTokens(bodyText: string): string[] {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const root = asRecord(parsed);
    if (!root) return [];
    const tokens: string[] = [];
    for (const key of ["code", "error", "error_code", "errorCode"]) {
      const value = root[key];
      if (typeof value === "string" && value.trim().length > 0) {
        tokens.push(value.trim());
      }
    }
    return tokens;
  } catch {
    return [];
  }
}

export function isAuthFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("invalid or expired credentials") ||
    lower.includes("refresh token") ||
    lower.includes("no auth context") ||
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    lower.includes("permissiondenied") ||
    lower.includes("permission_denied") ||
    /\b401\b/.test(lower)
  );
}

function isAccessFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("access_denied") ||
    lower.includes("access denied") ||
    lower.includes("insufficient_permissions") ||
    lower.includes("insufficient permissions") ||
    lower.includes("insufficient_scope") ||
    lower.includes("not entitled") ||
    lower.includes("entitlement")
  );
}

function tokenMatchesAuth(token: string): boolean {
  const normalized = normalizeErrorToken(token);
  const compact = compactErrorToken(token);
  return (
    AUTH_ERROR_CODES.has(normalized) ||
    AUTH_ERROR_CODES.has(compact) ||
    isAuthFailureMessage(token)
  );
}

function tokenMatchesAccess(token: string): boolean {
  const normalized = normalizeErrorToken(token);
  const compact = compactErrorToken(token);
  return (
    ACCESS_ERROR_CODES.has(normalized) ||
    ACCESS_ERROR_CODES.has(compact) ||
    isAccessFailureMessage(token)
  );
}

/**
 * Classify billing HTTP failures:
 * - auth: re-login (401, or structured/session auth codes)
 * - access: authenticated but not allowed (structured 403 codes)
 * - generic: plain 403/5xx/etc without auth semantics
 */
export function classifyBillingHttpError(
  status: number,
  bodyText: string
): BillingHttpErrorClassification {
  const structured = extractStructuredErrorTokens(bodyText);
  for (const token of structured) {
    if (tokenMatchesAuth(token)) {
      return { kind: "auth", detail: token };
    }
    if (tokenMatchesAccess(token)) {
      return { kind: "access", detail: token };
    }
  }

  const plain =
    bodyText.trim().length > 0 &&
    bodyText.trim().length < 200 &&
    !bodyText.trim().startsWith("{")
      ? bodyText.trim()
      : null;

  if (status === 401 || (plain !== null && isAuthFailureMessage(plain))) {
    return {
      kind: "auth",
      detail: plain ?? `Grok billing request failed (${status})`,
    };
  }

  if (plain !== null && isAccessFailureMessage(plain)) {
    return { kind: "access", detail: plain };
  }

  if (status === 403) {
    // Plain Forbidden / empty body: not enough signal for re-login.
    return {
      kind: "generic",
      detail: "Grok billing request failed (403)",
    };
  }

  if (plain !== null) {
    return { kind: "generic", detail: plain };
  }

  return {
    kind: "generic",
    detail: `Grok billing request failed (${status})`,
  };
}
