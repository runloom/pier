import { describe, expect, it, vi } from "vitest";
import {
  GROK_REMAINING_RESETS_URL,
  GROK_RESET_CREDITS_METRIC_ID,
  parseGrokRemainingResets,
} from "../../../../../packages/plugin-grok/src/main/reset-credits.ts";
import {
  createRemainingResetsOriginFetch,
  fetchGrokRemainingResetsSoft,
} from "../../../../../packages/plugin-grok/src/main/reset-credits-fetch.ts";
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

  it("rejects grpc-web data without a success trailer", () => {
    expect(
      parseGrokRemainingResets(firstGrpcWebFrame(LIVE_GRPC_WEB_PROTO), NOW)
    ).toEqual([]);
  });

  it("rejects a truncated grpc-web frame", () => {
    expect(
      parseGrokRemainingResets(LIVE_GRPC_WEB_PROTO.slice(0, 12), NOW)
    ).toEqual([]);
  });

  it("rejects data after the grpc-web trailer", () => {
    const data = firstGrpcWebFrame(LIVE_GRPC_WEB_PROTO);
    expect(
      parseGrokRemainingResets(concatBytes(data, grpcWebTrailer(0), data), NOW)
    ).toEqual([]);
  });

  it("rejects a nonzero trailer even when followed by a success trailer", () => {
    const data = firstGrpcWebFrame(LIVE_GRPC_WEB_PROTO);
    expect(
      parseGrokRemainingResets(
        concatBytes(data, grpcWebTrailer(7), grpcWebTrailer(0)),
        NOW
      )
    ).toEqual([]);
  });

  it("does not extract grpc-web text embedded in unrelated content", () => {
    expect(
      parseGrokRemainingResets(`<!--${LIVE_GRPC_WEB_TEXT}-->`, NOW)
    ).toEqual([]);
  });

  it("skips unknown protobuf tags instead of dropping the remaining-resets metric", () => {
    const payload = concatBytes(
      encodeGrpcWebFrame([
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
      ]),
      grpcWebTrailer(0)
    );
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

function encodeGrpcWebFrame(payload: number[], flag = 0): Uint8Array {
  const bytes = new Uint8Array(5 + payload.length);
  bytes[0] = flag;
  new DataView(bytes.buffer).setUint32(1, payload.length);
  bytes.set(payload, 5);
  return bytes;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function grpcWebTrailer(status: number): Uint8Array {
  return encodeGrpcWebFrame(
    [...new TextEncoder().encode(`grpc-status:${status}\r\n`)],
    128
  );
}

function firstGrpcWebFrame(bytes: Uint8Array): Uint8Array {
  const payloadLength = new DataView(
    bytes.buffer,
    bytes.byteOffset + 1,
    4
  ).getUint32(0);
  return bytes.slice(0, 5 + payloadLength);
}

describe("fetchGrokRemainingResetsSoft", () => {
  it("does not accept a successful JSON body without grpc-web framing", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ availableCount: 1 }),
    }));

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([]);
  });

  it("falls back to grok.com origin fetch when Cloudflare blocks Node fetch", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "<html>Just a moment</html>",
    }));
    const originFetch = vi.fn(async () => [
      {
        format: "count" as const,
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar" as const,
        value: 1,
      },
    ]);

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      originFetch,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
    expect(originFetch).toHaveBeenCalledOnce();
  });

  it("falls back to origin fetch when HTTP 200 is Cloudflare HTML", async () => {
    const html = new TextEncoder().encode("<html>Just a moment</html>");
    const fetchImpl = vi.fn(async () => ({
      arrayBuffer: async () =>
        html.buffer.slice(html.byteOffset, html.byteOffset + html.byteLength),
      ok: true,
      status: 200,
      text: async () => "<html>Just a moment</html>",
    }));
    const originFetch = vi.fn(async () => [
      {
        format: "count" as const,
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar" as const,
        value: 1,
      },
    ]);

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      originFetch,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
    expect(originFetch).toHaveBeenCalledOnce();
  });

  it("swallows origin-fetch failures so usage still succeeds", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "<html>Just a moment</html>",
    }));
    const originFetch = vi.fn(async () => {
      throw new Error("hidden window failed");
    });

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      originFetch,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([]);
  });

  it("does not origin-fetch after the caller aborts", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    });
    const originFetch = vi.fn(async () => []);
    const controller = new AbortController();
    controller.abort();

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      originFetch,
      sessionKey: "session-key",
      signal: controller.signal,
    });

    expect(result).toEqual([]);
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("returns no reset metric when the request is rejected", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "",
    }));

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([]);
  });

  it("returns no reset metric for a nonzero grpc-status trailer", async () => {
    const body = concatBytes(
      firstGrpcWebFrame(LIVE_GRPC_WEB_PROTO),
      grpcWebTrailer(7)
    );
    const fetchImpl = vi.fn(async () => ({
      arrayBuffer: async () => toArrayBuffer(body),
      ok: true,
      status: 200,
      text: async () => "",
    }));

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([]);
  });

  it("returns no reset metric for malformed HTTP 200 content", async () => {
    const body = new TextEncoder().encode("<html>challenge</html>");
    const fetchImpl = vi.fn(async () => ({
      arrayBuffer: async () => toArrayBuffer(body),
      ok: true,
      status: 200,
      text: async () => "",
    }));

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([]);
  });

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

    const result = await fetchGrokRemainingResetsSoft({
      fetchImpl,
      sessionKey: "session-key",
      signal: new AbortController().signal,
    });

    expect(result).toEqual([
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

  it("parses remaining resets from a host document-origin fetch", async () => {
    const documentOriginFetch = vi.fn(async () => ({
      body: LIVE_GRPC_WEB_PROTO,
      ok: true,
      status: 200,
    }));
    const originFetch = createRemainingResetsOriginFetch(documentOriginFetch);

    await expect(
      originFetch({
        sessionKey: "session-key",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual([
      {
        format: "count",
        id: GROK_RESET_CREDITS_METRIC_ID,
        kind: "scalar",
        value: 1,
      },
    ]);
    expect(documentOriginFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        origin: "https://grok.com/",
        signal: expect.any(AbortSignal),
        url: GROK_REMAINING_RESETS_URL,
      })
    );
  });

  it("returns no metrics when the host document-origin fetch fails", async () => {
    const originFetch = createRemainingResetsOriginFetch(async () => {
      throw new Error("cf");
    });
    await expect(
      originFetch({
        sessionKey: "session-key",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual([]);
  });
});

describe("withSoftSubscription remaining resets", () => {
  it("omits reset metadata when the reset-count probe is rejected", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_REMAINING_RESETS_URL) {
        return { ok: false, status: 403, text: async () => "" };
      }
      return { ok: false, status: 404, text: async () => "" };
    });

    const result = await withSoftSubscription(
      { metrics: [], status: "ok" },
      {
        caller: new AbortController().signal,
        fetchImpl,
        overall: null,
        sessionKey: "session-key",
      }
    );

    expect(result).toMatchObject({
      metrics: [],
      status: "ok",
    });
    expect(result).not.toHaveProperty("resetCreditsResolved");
  });

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
