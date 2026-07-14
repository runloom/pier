import type {
  ExternalNavigationRequest,
  ExternalNavigationResult,
} from "@shared/contracts/external-navigation.ts";
import { externalNavigationRequestSchema } from "@shared/contracts/external-navigation.ts";

const ACTIVATION_TTL_MS = 1000;
const REPLAY_RETENTION_MS = 60_000;
function hasForbiddenUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      character === "\\" ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

interface ExternalNavigationDependencies {
  now(): number;
  openExternal(url: string): Promise<void>;
}

export interface ExternalNavigationService {
  open(request: ExternalNavigationRequest): Promise<ExternalNavigationResult>;
}

function strictHttpsUrl(value: string): string | null {
  if (
    value.length > 2048 ||
    value.trim() !== value ||
    hasForbiddenUrlCharacter(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    const serialized = url.toString();
    return serialized.length <= 2048 ? serialized : null;
  } catch {
    return null;
  }
}

export function createExternalNavigationService(
  dependencies: ExternalNavigationDependencies
): ExternalNavigationService {
  const consumedNonces = new Map<string, number>();

  return {
    async open(request) {
      const parsedRequest = externalNavigationRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return { opened: false, reason: "invalid-request" };
      }

      const now = dependencies.now();
      for (const [nonce, consumedAt] of consumedNonces) {
        if (now - consumedAt > REPLAY_RETENTION_MS) {
          consumedNonces.delete(nonce);
        }
      }
      if (
        parsedRequest.data.issuedAt > now ||
        now - parsedRequest.data.issuedAt > ACTIVATION_TTL_MS
      ) {
        return { opened: false, reason: "expired" };
      }
      if (consumedNonces.has(parsedRequest.data.nonce)) {
        return { opened: false, reason: "replayed" };
      }

      const url = strictHttpsUrl(parsedRequest.data.url);
      if (!url) {
        return { opened: false, reason: "invalid-url" };
      }

      consumedNonces.set(parsedRequest.data.nonce, now);
      try {
        await dependencies.openExternal(url);
        return { opened: true };
      } catch {
        return { opened: false, reason: "open-failed" };
      }
    },
  };
}
