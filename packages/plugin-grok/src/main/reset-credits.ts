import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";

export const GROK_RESET_CREDITS_METRIC_ID = "grok:reset-credits";

interface RemainingResetsParseResult {
  metrics: AccountUsageMetric[];
  valid: boolean;
}

function invalidRemainingResets(): RemainingResetsParseResult {
  return { metrics: [], valid: false };
}

/** Official ConsumerUi remaining-resets RPC (grpc-web). */
export const GROK_REMAINING_RESETS_URL =
  "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets";

/** Empty protobuf framed as grpc-web+proto. A base64 text body is rejected. */
export const GROK_REMAINING_RESETS_REQUEST_BODY = new Uint8Array([
  0, 0, 0, 0, 0,
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
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
  const direct = asNonNegativeInt(
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
    const count = asNonNegativeInt(
      nested?.availableCount ?? nested?.available_count
    );
    if (count !== undefined) return count;
  }
  return;
}

function parseJsonResets(
  payload: unknown,
  now: number
): RemainingResetsParseResult | null {
  const root = asRecord(payload);
  if (!root) return null;
  const config = asRecord(root?.config);
  const sources = [root, config].filter(
    (value): value is Record<string, unknown> => value !== null
  );
  for (const source of sources) {
    const tokens = tokensFromRecord(source);
    if (tokens !== undefined) {
      return {
        metrics: metricFromCount(countValidTokens(tokens, now)),
        valid: true,
      };
    }
    const available = availableCountFromRecord(source);
    if (available !== undefined) {
      return { metrics: metricFromCount(available), valid: true };
    }
  }
  return null;
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
): { metrics: AccountUsageMetric[]; valid: boolean } {
  let offset = 0;
  const tokens: Array<{ tokenId: string; validityEnd: number }> = [];
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) return { metrics: [], valid: false };
    const { field, wire } = protoField(key.value);
    if (wire !== 2) {
      const skipped = skipProtoField(bytes, key.offset, wire);
      if (!skipped) return { metrics: [], valid: false };
      offset = skipped;
      continue;
    }
    const nested = readLengthDelimited(bytes, key.offset);
    if (!nested) return { metrics: [], valid: false };
    offset = nested.offset;
    if (field === 10) {
      const token = parseResetTokenProto(nested.value);
      if (token) tokens.push(token);
    }
  }
  return {
    metrics: metricFromCount(countValidTokens(tokens, now)),
    valid: true,
  };
}

function grpcStatusFromTrailer(bytes: Uint8Array): number | undefined {
  const trailer = new TextDecoder().decode(bytes);
  const match = trailer.match(/(?:^|\r?\n)grpc-status:\s*(\d+)(?:\r?\n|$)/i);
  if (!match?.[1]) return;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : undefined;
}

function parseGrpcWebBinary(
  bytes: Uint8Array,
  now: number
): RemainingResetsParseResult | null {
  let offset = 0;
  let metrics: AccountUsageMetric[] = [];
  let sawData = false;
  let sawFrame = false;
  let sawTrailer = false;
  let trailerStatus: number | undefined;
  while (offset + 5 <= bytes.length) {
    const flag = bytes[offset];
    if (flag === undefined) {
      return sawFrame ? invalidRemainingResets() : null;
    }
    if (flag !== 0 && flag !== 128) {
      return sawFrame ? invalidRemainingResets() : null;
    }
    sawFrame = true;
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 1,
      4
    ).getUint32(0);
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length) return invalidRemainingResets();
    if (flag === 0) {
      sawData = true;
      const parsed = parseRemainingResetsProto(bytes.subarray(start, end), now);
      if (!parsed.valid) return invalidRemainingResets();
      if (parsed.metrics.length > 0) metrics = parsed.metrics;
    } else {
      if (sawTrailer || end !== bytes.length) {
        return invalidRemainingResets();
      }
      sawTrailer = true;
      trailerStatus = grpcStatusFromTrailer(bytes.subarray(start, end));
      if (trailerStatus === undefined) return invalidRemainingResets();
    }
    offset = end;
  }
  if (!sawFrame) return null;
  if (
    offset !== bytes.length ||
    !sawData ||
    !sawTrailer ||
    trailerStatus !== 0
  ) {
    return invalidRemainingResets();
  }
  return { metrics, valid: true };
}

function parseGrpcWebText(
  text: string,
  now: number
): RemainingResetsParseResult | null {
  const compact = text.replace(/\s+/g, "");
  const frames = compact.match(/[A-Za-z0-9+/]+={0,2}/g) ?? [];
  if (frames.join("") !== compact) return null;
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (const frame of frames) {
    const bytes = decodeBase64(frame);
    if (!bytes) return null;
    chunks.push(bytes);
    totalLength += bytes.length;
  }
  if (chunks.length === 0) return null;
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return parseGrpcWebBinary(bytes, now);
}

/**
 * Map official Grok remaining-resets JSON, grpc-web-text, or binary
 * grpc-web+proto into a Codex-shaped reset-credits scalar. Zero / expired
 * tokens stay off the metric list.
 */
function parseGrokRemainingResetsResult(
  payload: unknown,
  now = Date.now()
): RemainingResetsParseResult {
  if (payload instanceof Uint8Array) {
    const fromBinary = parseGrpcWebBinary(payload, now);
    if (fromBinary) return fromBinary;
    return parseGrokRemainingResetsResult(
      new TextDecoder().decode(payload),
      now
    );
  }
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return (
          parseJsonResets(JSON.parse(trimmed), now) ?? invalidRemainingResets()
        );
      } catch {
        return invalidRemainingResets();
      }
    }
    return parseGrpcWebText(trimmed, now) ?? invalidRemainingResets();
  }
  return parseJsonResets(payload, now) ?? invalidRemainingResets();
}

export function parseGrokRemainingResetsRpcResult(
  payload: string | Uint8Array,
  now = Date.now()
): RemainingResetsParseResult {
  if (payload instanceof Uint8Array) {
    const fromBinary = parseGrpcWebBinary(payload, now);
    if (fromBinary) return fromBinary;
    return (
      parseGrpcWebText(new TextDecoder().decode(payload), now) ??
      invalidRemainingResets()
    );
  }
  return parseGrpcWebText(payload.trim(), now) ?? invalidRemainingResets();
}

export function parseGrokRemainingResets(
  payload: unknown,
  now = Date.now()
): AccountUsageMetric[] {
  return parseGrokRemainingResetsResult(payload, now).metrics;
}
