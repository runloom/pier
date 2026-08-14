import { describe, expect, it, vi } from "vitest";
import {
  fetchGrokRemainingResetsSoft,
  GROK_REMAINING_RESETS_URL,
  GROK_RESET_CREDITS_METRIC_ID,
  parseGrokRemainingResets,
} from "../../../../../packages/plugin-grok/src/main/reset-credits.ts";
import { withSoftSubscription } from "../../../../../packages/plugin-grok/src/main/subscription-fetch.ts";

const NOW = Date.parse("2026-08-14T00:00:00Z");

/** Live grpc-web-text body from prod_mc_billing.ConsumerUiSvc/GetRemainingResets. */
const LIVE_GRPC_WEB_TEXT =
  "AAAAACNSIVINcmVzdG9rX3ZwWURxb6IBBgicgPPTBvIBBgicvZbVBg==gAAAAA9ncnBjLXN0YXR1czowDQo=";

/** Same live payload as a raw grpc-web+proto frame. Node/Electron fetch only
 *  returns this when the request body is the 5-byte empty protobuf frame. */
const LIVE_GRPC_WEB_PROTO = Uint8Array.from(
  Buffer.from(
    "00000000235221520d726573746f6b5f76705944716fa20106089c80f3d306f20106089cbd96d506800000000f677270632d7374617475733a300d0a",
    "hex"
  )
);

describe("parseGrokRemainingResets", () => {
  it("counts unexpired official reset tokens as a Codex-shaped scalar", () => {
    expect(
      parseGrokRemainingResets(
        {
          tokens: [
            {
              tokenId: "restok_one",
              validityEnd: "2026-09-12T18:49:00Z",
            },
            {
              tokenId: "restok_two",
              validityEnd: "2026-10-01T00:00:00Z",
            },
          ],
        },
        NOW
      )
    ).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 2,
      },
    ]);
  });

  it("omits expired and empty tokens so the UI does not show a useless zero", () => {
    expect(
      parseGrokRemainingResets(
        {
          tokens: [
            { tokenId: "expired", validityEnd: "2026-08-01T00:00:00Z" },
            { tokenId: "", validityEnd: "2026-09-01T00:00:00Z" },
          ],
        },
        NOW
      )
    ).toEqual([]);
    expect(
      parseGrokRemainingResets(
        { rateLimitResetCredits: { availableCount: 0 } },
        NOW
      )
    ).toEqual([]);
  });

  it("maps the official grpc-web-text remaining-resets payload", () => {
    expect(parseGrokRemainingResets(LIVE_GRPC_WEB_TEXT, NOW)).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
  });

  it("maps the official binary grpc-web+proto frame Node fetch actually returns", () => {
    expect(parseGrokRemainingResets(LIVE_GRPC_WEB_PROTO, NOW)).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
  });

  it("skips unknown protobuf tags instead of dropping the remaining-resets metric", () => {
    const payload = encodeGrpcWebFrame([
      ...encodeKey(2, 0),
      ...encodeVarint(1),
      ...encodeLengthDelimited(10, [
        ...encodeKey(1, 0),
        ...encodeVarint(7),
        ...encodeLengthDelimited(10, textBytes("restok_extra")),
        ...encodeLengthDelimited(30, [
          ...encodeKey(1, 0),
          ...encodeVarint(Math.floor((NOW + 86_400_000) / 1000)),
        ]),
      ]),
    ]);
    expect(parseGrokRemainingResets(payload, NOW)).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
  });
});

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 128) {
    bytes.push((remaining % 128) + 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return bytes;
}

function encodeKey(field: number, wire: number): number[] {
  return encodeVarint(field * 8 + wire);
}

function textBytes(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

function encodeLengthDelimited(field: number, payload: number[]): number[] {
  return [...encodeKey(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeGrpcWebFrame(payload: number[]): Uint8Array {
  const bytes = new Uint8Array(5 + payload.length);
  bytes[0] = 0;
  new DataView(bytes.buffer).setUint32(1, payload.length);
  bytes.set(payload, 5);
  return bytes;
}

describe("fetchGrokRemainingResetsSoft", () => {
  it("posts a raw empty protobuf frame and reads the binary grpc-web body", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const body = init?.body;
      const isRawFrame =
        body instanceof Uint8Array &&
        body.length === 5 &&
        body[0] === 0 &&
        body[1] === 0 &&
        body[2] === 0 &&
        body[3] === 0 &&
        body[4] === 0;
      if (!isRawFrame) {
        return {
          arrayBuffer: async () => new Uint8Array().buffer,
          ok: true,
          status: 200,
          text: async () => "",
        };
      }
      return {
        arrayBuffer: async () =>
          LIVE_GRPC_WEB_PROTO.buffer.slice(
            LIVE_GRPC_WEB_PROTO.byteOffset,
            LIVE_GRPC_WEB_PROTO.byteOffset + LIVE_GRPC_WEB_PROTO.byteLength
          ),
        ok: true,
        status: 200,
        text: async () => "",
      };
    });

    const metrics = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(metrics).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      GROK_REMAINING_RESETS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/grpc-web+proto",
          "Content-Type": "application/grpc-web+proto",
        }),
        method: "POST",
      })
    );
  });
});

describe("withSoftSubscription remaining resets", () => {
  it("appends reset credits from the official remaining-resets RPC", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_REMAINING_RESETS_URL) {
        return { ok: true, status: 200, text: async () => LIVE_GRPC_WEB_TEXT };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const result = await withSoftSubscription(
      {
        metrics: [
          {
            groupId: "grok:period",
            id: "grok:period",
            kind: "quota",
            usedPercent: 44,
          },
        ],
        status: "ok",
      },
      {
        caller: new AbortController().signal,
        fetchImpl,
        overall: null,
        sessionKey: "session-key",
      }
    );

    expect(result.metrics).toContainEqual({
      format: "count",
      id: GROK_RESET_CREDITS_METRIC_ID,
      kind: "scalar",
      value: 1,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GROK_REMAINING_RESETS_URL,
      expect.objectContaining({ method: "POST" })
    );
  });
});
