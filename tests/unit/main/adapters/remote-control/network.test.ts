// @vitest-environment node
import { createServer } from "node:net";
import type { NetworkInterfaceInfoIPv4 } from "node:os";
import * as os from "node:os";
import {
  LAN_PORT_MAX,
  LAN_PORT_MIN,
  listLanIPv4Addresses,
  pickPortInRange,
} from "@main/adapters/remote-control/network.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof os>();
  return { ...original, networkInterfaces: vi.fn(original.networkInterfaces) };
});

function fakeNic(address: string, internal: boolean): NetworkInterfaceInfoIPv4 {
  return {
    address,
    cidr: `${address}/24`,
    family: "IPv4",
    internal,
    mac: "00:00:00:00:00:00",
    netmask: "255.255.255.0",
    scopeid: 0,
  };
}

function expectInPortRange(port: number): void {
  expect(port).toBeGreaterThanOrEqual(LAN_PORT_MIN);
  expect(port).toBeLessThanOrEqual(LAN_PORT_MAX);
}

describe("listLanIPv4Addresses", () => {
  it("只返回非 internal 的 IPv4 地址", () => {
    const expected = Object.values(os.networkInterfaces())
      .flatMap((infos) => infos ?? [])
      .filter(
        (info) =>
          info.family === "IPv4" &&
          !info.internal &&
          !info.address.startsWith("169.254.")
      )
      .map((info) => info.address);
    const actual = listLanIPv4Addresses();
    expect(actual).toEqual(expected);
    for (const address of actual) {
      expect(address).toMatch(/^\d{1,3}(?:\.\d{1,3}){3}$/u);
    }
  });

  it("过滤 169.254.0.0/16 link-local 与 internal 地址", () => {
    vi.mocked(os.networkInterfaces).mockReturnValueOnce({
      en0: [
        fakeNic("192.168.1.10", false),
        fakeNic("169.254.8.9", false),
        fakeNic("10.0.0.3", false),
      ],
      lo0: [fakeNic("127.0.0.1", true)],
    });
    expect(listLanIPv4Addresses()).toEqual(["192.168.1.10", "10.0.0.3"]);
  });
});

describe("pickPortInRange", () => {
  it("返回固定区间 47000-47099 内的空闲端口", async () => {
    expectInPortRange(await pickPortInRange());
  });

  it("preferred 仅 127.0.0.1 占用时也回退", async () => {
    const preferred = await pickPortInRange();
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(preferred, "127.0.0.1", resolve);
    });
    try {
      const port = await pickPortInRange(preferred);
      expect(port).not.toBe(preferred);
      expectInPortRange(port);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  it("preferred 被占用时回退到区间内其他端口", async () => {
    const preferred = await pickPortInRange();
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(preferred, "0.0.0.0", resolve);
    });
    try {
      const port = await pickPortInRange(preferred);
      expect(port).not.toBe(preferred);
      expectInPortRange(port);
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      });
    }
  });

  it("preferred 空闲时优先返回 preferred", async () => {
    const preferred = await pickPortInRange();
    expect(await pickPortInRange(preferred)).toBe(preferred);
  });

  it("preferred 超出区间时忽略并随机选取", async () => {
    expectInPortRange(await pickPortInRange(12_345));
    expectInPortRange(await pickPortInRange(LAN_PORT_MAX + 1));
  });
});
