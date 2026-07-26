/**
 * Opaque `pier-live://` URLs for compiled modules and host runtime shims.
 *
 * Contract rules (C0 / design §0.1):
 * - Module URLs carry only a ticket — never a filesystem path.
 * - Runtime URLs are a fixed whitelist (react / react-dom / jsx) for host
 *   singletons. `pier/canvas` is compiled as an inlined globalThis stub — not a
 *   protocol runtime id.
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
] as const;

export type LiveModuleRuntimeId = (typeof LIVE_MODULE_RUNTIME_IDS)[number];

const LIVE_MODULE_RUNTIME_ID_SET = new Set<string>(LIVE_MODULE_RUNTIME_IDS);

export function liveModuleUrlForTicket(ticket: string): string {
  if (!LIVE_MODULE_TICKET_PATTERN.test(ticket)) {
    throw new Error("Invalid live module ticket");
  }
  return `${LIVE_MODULE_SCHEME}://module/${ticket}`;
}

export function liveModuleTicketFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${LIVE_MODULE_SCHEME}:` ||
      url.hostname !== "module" ||
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
