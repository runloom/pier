import { describe, expect, it, vi } from "vitest";

const protocolMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  protocol: protocolMocks,
}));

import { registerAssetScheme } from "@main/fonts/asset-protocol.ts";

describe("registerAssetScheme", () => {
  it("registers pier-asset with stream privilege for HTMLAudio playback", () => {
    registerAssetScheme();

    expect(protocolMocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        privileges: {
          corsEnabled: true,
          secure: true,
          standard: true,
          // stream:true 是媒体元素（提示音 HTMLAudio）经自定义协议
          // 播放的硬性要求；缺失时 play() 恒 NotSupportedError。
          stream: true,
          supportFetchAPI: true,
        },
        scheme: "pier-asset",
      },
    ]);
  });
});
