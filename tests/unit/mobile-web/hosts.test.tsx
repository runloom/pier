/**
 * H1 主机列表：空态（无已配对宿主）与列表投影（状态/进入/移除）。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PierMobileClientError } from "../../../apps/mobile-web/src/lib/client-types.ts";
import {
  type StoredHost,
  saveHost,
} from "../../../apps/mobile-web/src/lib/paired-hosts.ts";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";

const { activeKeyRef, connectHostMock, fetchHostsStatusMock, resumeMock } =
  vi.hoisted(() => ({
    activeKeyRef: { value: null as string | null },
    connectHostMock: vi.fn(),
    fetchHostsStatusMock: vi.fn(),
    resumeMock: vi.fn(async () => undefined),
  }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  activeHostKey: () => activeKeyRef.value,
  connectHost: connectHostMock,
  resumeActiveHost: resumeMock,
}));

vi.mock("../../../apps/mobile-web/src/lib/relay-api.ts", () => ({
  fetchHostsStatus: fetchHostsStatusMock,
}));

describe("HostsPage（H1 主机列表）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    activeKeyRef.value = null;
    fetchHostsStatusMock.mockReset();
    fetchHostsStatusMock.mockResolvedValue(new Map());
    connectHostMock.mockReset();
    useMobileWebStore.getState().setConnection("idle");
    window.location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("无已配对宿主 → 空态文案 + 去配对入口", async () => {
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    expect(screen.getByTestId("hosts-empty").textContent).toContain(
      "还没有已配对的设备"
    );
    expect(screen.getByTestId("hosts-empty-add").textContent).toContain(
      "去配对"
    );
  });

  it("有已配对宿主 → 列表展示并可移除", async () => {
    const host: StoredHost = {
      deviceToken: "tok-1",
      deviceId: "dev-1",
      host: "192.168.1.10",
      pairedAt: 0,
      port: 4455,
    };
    saveHost(host);
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    expect(screen.queryByTestId("hosts-empty")).toBeNull();
    const items = screen.getAllByTestId("host-item");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("192.168.1.10:4455");
    fireEvent.click(screen.getByTestId("host-remove-192.168.1.10:4455"));
    await Promise.resolve();
    expect(screen.getByTestId("hosts-empty")).toBeDefined();
  });

  it("connect 失败 → 行内错误提示，不跳转 H2", async () => {
    const host: StoredHost = {
      deviceToken: "tok-1",
      deviceId: "dev-1",
      host: "192.168.1.10",
      pairedAt: 0,
      port: 4455,
    };
    saveHost(host);
    connectHostMock.mockRejectedValueOnce(new Error("connection refused"));
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    fireEvent.click(screen.getByTestId("host-enter-192.168.1.10:4455"));
    await waitFor(() => {
      expect(screen.getByTestId("host-error-192.168.1.10:4455")).toBeDefined();
    });
    expect(
      screen.getByTestId("host-error-192.168.1.10:4455").textContent
    ).toContain("connection refused");
    expect(window.location.hash).not.toBe("#/host");
  });

  it("活跃台重连中但会合明确离线 → 显示「离线」而非连接中空转", async () => {
    const relayHost: StoredHost = {
      deviceId: "dev-1",
      deviceToken: "tok-1",
      fingerprint: "abcdef0123456789",
      host: "relay.pier.codes",
      hostId: "h1",
      pairedAt: 0,
      port: 443,
      relayUrl: "wss://relay.pier.codes",
    };
    saveHost(relayHost);
    activeKeyRef.value = "h1";
    fetchHostsStatusMock.mockResolvedValue(new Map([["h1", false]]));
    useMobileWebStore.getState().setConnection("reconnecting");
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("host-item")[0]?.textContent).toContain(
        "离线"
      );
    });
    expect(screen.getAllByTestId("host-item")[0]?.textContent).not.toContain(
      "连接中"
    );
  });

  it("页面隐藏时停掉在线态轮询，回前台才再刷", async () => {
    const relayHost: StoredHost = {
      deviceId: "dev-1",
      deviceToken: "tok-1",
      fingerprint: "abcdef0123456789",
      host: "relay.pier.codes",
      hostId: "h1",
      pairedAt: 0,
      port: 443,
      relayUrl: "wss://relay.pier.codes",
    };
    saveHost(relayHost);
    fetchHostsStatusMock.mockResolvedValue(new Map([["h1", true]]));
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    await waitFor(() => {
      expect(fetchHostsStatusMock.mock.calls.length).toBeGreaterThan(0);
    });
    const afterMount = fetchHostsStatusMock.mock.calls.length;
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchHostsStatusMock.mock.calls.length).toBe(afterMount);
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => {
      expect(fetchHostsStatusMock.mock.calls.length).toBeGreaterThan(
        afterMount
      );
    });
  });

  it("会合报活跃台在线且本机仍断线 → 立即重拨（不等退避周期）", async () => {
    const relayHost: StoredHost = {
      deviceId: "dev-1",
      deviceToken: "tok-1",
      fingerprint: "abcdef0123456789",
      host: "relay.pier.codes",
      hostId: "h1",
      pairedAt: 0,
      port: 443,
      relayUrl: "wss://relay.pier.codes",
    };
    saveHost(relayHost);
    activeKeyRef.value = "h1";
    fetchHostsStatusMock.mockResolvedValue(new Map([["h1", true]]));
    useMobileWebStore.getState().setConnection("reconnecting");
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    await waitFor(() => {
      expect(resumeMock).toHaveBeenCalled();
    });
  });

  it("connect 成功 → 跳转 H2，无错误提示", async () => {
    const host: StoredHost = {
      deviceToken: "tok-1",
      deviceId: "dev-1",
      host: "192.168.1.10",
      pairedAt: 0,
      port: 4455,
    };
    saveHost(host);
    connectHostMock.mockResolvedValueOnce(undefined);
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    fireEvent.click(screen.getByTestId("host-enter-192.168.1.10:4455"));
    await waitFor(() => {
      expect(window.location.hash).toBe("#/host");
    });
    expect(screen.queryByTestId("host-error-192.168.1.10:4455")).toBeNull();
    connectHostMock.mockReset();
  });

  it("会合进入失败且令牌吊销 → 提示重新扫码，不掩盖为暂时不可用", async () => {
    const relayHost: StoredHost = {
      deviceId: "dev-1",
      deviceToken: "tok-1",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      hostId: "h1",
      pairedAt: 0,
      port: 4455,
      relayUrl: "wss://relay.pier.codes",
    };
    saveHost(relayHost);
    connectHostMock.mockRejectedValueOnce(
      new PierMobileClientError("device_revoked", "paired device revoked")
    );
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    fireEvent.click(screen.getByTestId("host-enter-h1"));
    await waitFor(() => {
      expect(screen.getByTestId("host-error-h1")).toBeDefined();
    });
    const text = screen.getByTestId("host-error-h1").textContent ?? "";
    expect(text).toContain("重新扫码配对");
    expect(text).toContain("吊销");
    expect(text).not.toContain("暂时不可用");
    expect(text).not.toContain("device_revoked");
    expect(text).not.toContain("paired device revoked");
    expect(window.location.hash).not.toBe("#/host");
  });

  it("会合进入失败（非鉴权）→ 展示错误详情，不丢弃 Error.message", async () => {
    const relayHost: StoredHost = {
      deviceId: "dev-1",
      deviceToken: "tok-1",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      hostId: "h1",
      pairedAt: 0,
      port: 4455,
      relayUrl: "wss://relay.pier.codes",
    };
    saveHost(relayHost);
    connectHostMock.mockRejectedValueOnce(new Error("connection closed"));
    const { HostsPage } = await import(
      "../../../apps/mobile-web/src/pages/hosts.tsx"
    );
    render(<HostsPage />);
    fireEvent.click(screen.getByTestId("host-enter-h1"));
    await waitFor(() => {
      expect(screen.getByTestId("host-error-h1")).toBeDefined();
    });
    expect(screen.getByTestId("host-error-h1").textContent).toContain(
      "connection closed"
    );
    expect(screen.getByTestId("host-error-h1").textContent).not.toBe(
      "远程连接暂时不可用，请稍后重试"
    );
  });
});
