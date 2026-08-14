import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import type { FetchImpl } from "./grok-usage-types.ts";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "./usage-fetch-timeouts.ts";

export const GROK_RESET_CREDITS_METRIC_ID = "grok:reset-credits";

/** Official ConsumerUi remaining-resets RPC (grpc-web). */
export const GROK_REMAINING_RESETS_URL =
  "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets";

/** Empty protobuf framed as grpc-web+proto. A base64 text body is rejected. */
export const GROK_REMAINING_RESETS_REQUEST_BODY = new Uint8Array([
  0, 0, 0, 0, 0,
]);

const CLI_USER_AGENT = "grok-cli/1.0.0";
const REMAINING_RESETS_HOP_TIMEOUT_MS = 8000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return;
  }
  return value;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const record = asRecord(value);
  if (!record) return;
  const seconds = record.seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  if (typeof seconds === "string" && seconds.length > 0) {
    const n = Number(seconds);
    if (Number.isFinite(n)) return n * 1000;
  }
  return;
}

function tokenIdOf(row: Record<string, unknown>): string | undefined {
  const tokenId = row.tokenId ?? row.token_id;
  return typeof tokenId === "string" && tokenId.length > 0
    ? tokenId
    : undefined;
}

function validityEndOf(row: Record<string, unknown>): number | undefined {
  return parseTimestampMs(
    row.validityEnd ?? row.validity_end ?? row.expiresAt ?? row.expires_at
  );
}

function countValidTokens(tokens: unknown, now: number): number {
  if (!Array.isArray(tokens)) return 0;
  let count = 0;
  for (const item of tokens) {
    const row = asRecord(item);
    if (!row) continue;
    if (!tokenIdOf(row)) continue;
    const end = validityEndOf(row);
    if (end === undefined || end <= now) continue;
    count += 1;
  }
  return count;
}

function metricFromCount(count: number): AccountUsageMetric[] {
  if (count <= 0) return [];
  return [
    {
      format: "count",
      id: GROK_RESET_CREDITS_METRIC_ID,
      kind: "scalar",
      value: count,
    },
  ];
}

function tokensFromRecord(root: Record<string, unknown>): unknown {
  if (Array.isArray(root.tokens)) return root.tokens;
  if (Array.isArray(root.stillRedeemable)) return root.stillRedeemable;
  const nested =
    asRecord(root.remainingResets) ??
    asRecord(root.remaining_resets) ??
    asRecord(root.resetCredits) ??
    asRecord(root.reset_credits) ??
    asRecord(root.rateLimitResetCredits) ??
    asRecord(root.rate_limit_reset_credits);
  if (nested && Array.isArray(nested.tokens)) return nested.tokens;
  return;
}

function availableCountFromRecord(
  root: Record<string, unknown>
): number | undefined {
  const direct = asPositiveInt(
    root.availableCount ?? root.available_count ?? root.resetCount
  );
  if (direct !== undefined) return direct;
  for (const key of [
    "resetCredits",
    "reset_credits",
    "rateLimitResetCredits",
    "rate_limit_reset_credits",
    "remainingResets",
    "remaining_resets",
  ]) {
    const nested = asRecord(root[key]);
    const count = asPositiveInt(
      nested?.availableCount ?? nested?.available_count
    );
    if (count !== undefined) return count;
  }
  return;
}

function parseJsonResets(payload: unknown, now: number): AccountUsageMetric[] {
  const root = asRecord(payload);
  const config = asRecord(root?.config);
  const sources = [root, config].filter(
    (value): value is Record<string, unknown> => value !== null
  );
  for (const source of sources) {
    const tokens = tokensFromRecord(source);
    if (tokens !== undefined) {
      return metricFromCount(countValidTokens(tokens, now));
    }
    const available = availableCountFromRecord(source);
    if (available !== undefined) return metricFromCount(available);
  }
  return [];
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return;
  }
}

function readVarint(
  bytes: Uint8Array,
  offset: number
): { offset: number; value: number } | undefined {
  let result = 0;
  let magnitude = 1;
  let pos = offset;
  let steps = 0;
  while (pos < bytes.length && steps <= 5) {
    const byte = bytes[pos];
    if (byte === undefined) return;
    pos += 1;
    steps += 1;
    result += (byte % 128) * magnitude;
    if (byte < 128) return { offset: pos, value: result };
    magnitude *= 128;
  }
  return;
}

function readLengthDelimited(
  bytes: Uint8Array,
  offset: number
): { offset: number; value: Uint8Array } | undefined {
  const length = readVarint(bytes, offset);
  if (!length) return;
  const end = length.offset + length.value;
  if (end > bytes.length) return;
  return { offset: end, value: bytes.subarray(length.offset, end) };
}

function protoField(key: number): { field: number; wire: number } {
  return { field: Math.floor(key / 8), wire: key % 8 };
}

function skipProtoField(
  bytes: Uint8Array,
  offset: number,
  wire: number
): number | undefined {
  if (wire === 0) {
    return readVarint(bytes, offset)?.offset;
  }
  if (wire === 1) {
    return offset + 8 <= bytes.length ? offset + 8 : undefined;
  }
  if (wire === 2) {
    return readLengthDelimited(bytes, offset)?.offset;
  }
  if (wire === 5) {
    return offset + 4 <= bytes.length ? offset + 4 : undefined;
  }
  return;
}

function timestampMsFromProto(bytes: Uint8Array): number | undefined {
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) return;
    const { field, wire } = protoField(key.value);
    if (wire === 0) {
      const value = readVarint(bytes, key.offset);
      if (!value) return;
      offset = value.offset;
      if (field === 1 && value.value > 0) return value.value * 1000;
      continue;
    }
    const skipped = skipProtoField(bytes, key.offset, wire);
    if (!skipped) return;
    offset = skipped;
  }
  return;
}

function parseResetTokenProto(
  bytes: Uint8Array
): { tokenId: string; validityEnd: number } | undefined {
  let offset = 0;
  let tokenId: string | undefined;
  let validityEnd: number | undefined;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) return;
    const { field, wire } = protoField(key.value);
    if (wire !== 2) {
      const skipped = skipProtoField(bytes, key.offset, wire);
      if (!skipped) return;
      offset = skipped;
      continue;
    }
    const nested = readLengthDelimited(bytes, key.offset);
    if (!nested) return;
    offset = nested.offset;
    if (field === 10) {
      tokenId = new TextDecoder().decode(nested.value);
    } else if (field === 30) {
      validityEnd = timestampMsFromProto(nested.value);
    }
  }
  if (!(tokenId && tokenId.length > 0 && validityEnd !== undefined)) return;
  return { tokenId, validityEnd };
}

function parseRemainingResetsProto(
  bytes: Uint8Array,
  now: number
): AccountUsageMetric[] {
  let offset = 0;
  const tokens: Array<{ tokenId: string; validityEnd: number }> = [];
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) return [];
    const { field, wire } = protoField(key.value);
    if (wire !== 2) {
      const skipped = skipProtoField(bytes, key.offset, wire);
      if (!skipped) return [];
      offset = skipped;
      continue;
    }
    const nested = readLengthDelimited(bytes, key.offset);
    if (!nested) return [];
    offset = nested.offset;
    if (field === 10) {
      const token = parseResetTokenProto(nested.value);
      if (token) tokens.push(token);
    }
  }
  return metricFromCount(countValidTokens(tokens, now));
}

function parseGrpcWebBinary(
  bytes: Uint8Array,
  now: number
): AccountUsageMetric[] {
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset];
    if (flag === undefined) return [];
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 1,
      4
    ).getUint32(0);
    const start = offset + 5;
    const end = start + length;
    if (length < 0 || end > bytes.length) return [];
    if (flag < 128 && length > 0) {
      const parsed = parseRemainingResetsProto(bytes.subarray(start, end), now);
      if (parsed.length > 0) return parsed;
    }
    offset = end;
  }
  return [];
}

function parseGrpcWebText(text: string, now: number): AccountUsageMetric[] {
  const frames = text.match(/[A-Za-z0-9+/]+={0,2}/g) ?? [];
  for (const frame of frames) {
    const bytes = decodeBase64(frame);
    if (!bytes || bytes.length < 5) continue;
    const parsed = parseGrpcWebBinary(bytes, now);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

/**
 * Map official Grok remaining-resets JSON, grpc-web-text, or binary
 * grpc-web+proto into a Codex-shaped reset-credits scalar. Zero / expired
 * tokens stay off the metric list.
 */
export function parseGrokRemainingResets(
  payload: unknown,
  now = Date.now()
): AccountUsageMetric[] {
  if (payload instanceof Uint8Array) {
    const fromBinary = parseGrpcWebBinary(payload, now);
    if (fromBinary.length > 0) return fromBinary;
    return parseGrokRemainingResets(new TextDecoder().decode(payload), now);
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return parseJsonResets(JSON.parse(trimmed), now);
      } catch {
        return [];
      }
    }
    return parseGrpcWebText(trimmed, now);
  }
  return parseJsonResets(payload, now);
}

export async function fetchGrokRemainingResetsSoft(options: {
  fetchImpl: FetchImpl;
  sessionKey: string;
  signal: AbortSignal;
  userId?: string | null;
}): Promise<AccountUsageMetric[]> {
  try {
    const response = await options.fetchImpl(GROK_REMAINING_RESETS_URL, {
      body: GROK_REMAINING_RESETS_REQUEST_BODY,
      headers: {
        Accept: "application/grpc-web+proto",
        Authorization: `Bearer ${options.sessionKey}`,
        "Content-Type": "application/grpc-web+proto",
        "User-Agent": CLI_USER_AGENT,
        "x-grpc-web": "1",
        "x-grok-client-mode": "cli",
        "x-xai-token-auth": "xai-grok-cli",
        ...(options.userId ? { "x-userid": options.userId } : {}),
      },
      method: "POST",
      signal: mergeAbortSignals([
        options.signal,
        createTimeoutSignal(REMAINING_RESETS_HOP_TIMEOUT_MS),
      ]),
    });
    if (!response.ok || options.signal.aborted) return [];
    if (typeof response.arrayBuffer === "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 0) {
        return parseGrokRemainingResets(bytes);
      }
    }
    return parseGrokRemainingResets(await response.text());
  } catch {
    return [];
  }
}
