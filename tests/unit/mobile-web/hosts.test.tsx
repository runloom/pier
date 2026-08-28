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
import {
  type StoredHost,
  saveHost,
} from "../../../apps/mobile-web/src/lib/paired-hosts.ts";

const { connectHostMock } = vi.hoisted(() => ({ connectHostMock: vi.fn() }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  activeHostKey: () => null,
  connectHost: connectHostMock,
}));

describe("HostsPage（H1 主机列表）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
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
});
