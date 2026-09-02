/**
 * Opaque `pier-live://` URLs for compiled modules, binary assets, and host
 * runtime shims.
 *
 * Contract rules (C0 / design §0.1):
 * - Module and asset URLs carry only a ticket — never a filesystem path.
 * - Runtime URLs are a fixed whitelist (react / react-dom / jsx) for host
 *   singletons plus the realm bootstrap. `pier/canvas` is compiled as an
 *   inlined globalThis stub — not a protocol runtime id.
 */

export const LIVE_MODULE_SCHEME = "pier-live";

/** Same shape as file-preview tickets: opaque, non-path, URL-safe. */
export const LIVE_MODULE_TICKET_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;

export const LIVE_MODULE_RUNTIME_IDS = [
  "react",
  "react-dom",
  "react-dom-client",
  "jsx-runtime",
  "jsx-dev-runtime",
  /** Realm bootstrap script. Production CSP has no unsafe-inline/unsafe-eval. */
  "realm-bootstrap",
] as const;

export type LiveModuleRuntimeId = (typeof LIVE_MODULE_RUNTIME_IDS)[number];

/** Host calls this on the realm window before dropping the iframe. */
export const LIVE_MODULE_REALM_TEARDOWN_NAME = "__pierLiveRealmTeardown";

const LIVE_MODULE_RUNTIME_ID_SET = new Set<string>(LIVE_MODULE_RUNTIME_IDS);

function opaqueTicketUrl(hostname: "module" | "asset", ticket: string): string {
  if (!LIVE_MODULE_TICKET_PATTERN.test(ticket)) {
    throw new Error("Invalid live module ticket");
  }
  return `${LIVE_MODULE_SCHEME}://${hostname}/${ticket}`;
}

function ticketFromOpaqueUrl(
  value: string,
  hostname: "module" | "asset"
): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${LIVE_MODULE_SCHEME}:` ||
      url.hostname !== hostname ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const ticket = url.pathname.slice(1);
    return !ticket.includes("/") && LIVE_MODULE_TICKET_PATTERN.test(ticket)
      ? ticket
      : null;
  } catch {
    return null;
  }
}

export function liveModuleUrlForTicket(ticket: string): string {
  return opaqueTicketUrl("module", ticket);
}

export function liveModuleTicketFromUrl(value: string): string | null {
  return ticketFromOpaqueUrl(value, "module");
}

export function liveModuleAssetUrlForTicket(ticket: string): string {
  return opaqueTicketUrl("asset", ticket);
}

export function liveModuleAssetTicketFromUrl(value: string): string | null {
  return ticketFromOpaqueUrl(value, "asset");
}

export function liveModuleRuntimeUrl(id: LiveModuleRuntimeId): string {
  if (!LIVE_MODULE_RUNTIME_ID_SET.has(id)) {
    throw new Error(`Invalid live module runtime id: ${id}`);
  }
  return `${LIVE_MODULE_SCHEME}://runtime/${id}`;
}

export function liveModuleRuntimeIdFromUrl(
  value: string
): LiveModuleRuntimeId | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${LIVE_MODULE_SCHEME}:` ||
      url.hostname !== "runtime" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const id = url.pathname.slice(1);
    if (id.includes("/") || !LIVE_MODULE_RUNTIME_ID_SET.has(id)) {
      return null;
    }
    return id as LiveModuleRuntimeId;
  } catch {
    return null;
  }
}
