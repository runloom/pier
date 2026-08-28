/**
 * H0 配对页：解析失败、pair 失败路径（pairing_expired / pairing_invalid）
 * 与网络失败文案；成功路径写入 localStorage 并跳主机列表。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairPage } from "../../../apps/mobile-web/src/pages/pair.tsx";

const VALID_PAYLOAD = JSON.stringify({
  fingerprint: "fp-1",
  host: "192.168.1.10",
  pairingCode: "code-1",
  port: 4455,
  relayHint: null,
});

function typePayload(text: string): void {
  fireEvent.change(screen.getByTestId("pair-payload-input"), {
    target: { value: text },
  });
}

describe("PairPage（H0 配对）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("非 JSON / 载荷格式错误 → 解析失败提示，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PairPage />);
    typePayload("not-json");
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("pair-error").textContent).toContain(
        "不是有效的 JSON"
      );
    });
    typePayload(JSON.stringify({ foo: 1 }));
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("pair-error").textContent).toContain(
        "不符合 Pier 配对载荷格式"
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 pairing_expired → 过期文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ reason: "pairing_expired" }),
        ok: false,
        status: 403,
      })
    );
    render(<PairPage />);
    typePayload(VALID_PAYLOAD);
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("pair-error").textContent).toContain(
        "配对码已过期"
      );
    });
    expect(window.localStorage.getItem("pier.mobile.hosts")).toBeNull();
  });

  it("403 pairing_invalid → 无效文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ reason: "pairing_invalid" }),
        ok: false,
        status: 403,
      })
    );
    render(<PairPage />);
    typePayload(VALID_PAYLOAD);
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("pair-error").textContent).toContain(
        "配对码无效"
      );
    });
  });

  it("成功配对：请求体带十一能力/shell=web/name≤64，凭据入库并跳主机列表", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          deviceId: "dev-9",
          deviceToken: "tok-9",
          grantedCapabilities: [],
          tokenEpoch: 0,
        }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PairPage />);
    typePayload(VALID_PAYLOAD);
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/hosts");
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://192.168.1.10:4455/pair");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.code).toBe("code-1");
    expect(body.shell).toBe("web");
    expect(String(body.name).length).toBeLessThanOrEqual(64);
    expect(Array.isArray(body.requestedCapabilities)).toBe(true);
    expect(body.requestedCapabilities).toHaveLength(11);
    const stored = JSON.parse(
      window.localStorage.getItem("pier.mobile.hosts") ?? "[]"
    ) as Array<{ deviceId: string; deviceToken: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.deviceId).toBe("dev-9");
    expect(stored[0]?.deviceToken).toBe("tok-9");
  });

  it("网络失败 → 无法连接提示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<PairPage />);
    typePayload(VALID_PAYLOAD);
    fireEvent.click(screen.getByTestId("pair-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("pair-error").textContent).toContain(
        "无法连接宿主机"
      );
    });
  });
});
