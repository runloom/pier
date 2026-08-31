/**
 * 全局连接横幅：断线时投影页明示「内容可能不是最新」；H0/H1 不显示；
 * closed 提供返回主机列表动作。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionBanner } from "../../../apps/mobile-web/src/components/connection-banner.tsx";
import type { MobileConnectionStatus } from "../../../apps/mobile-web/src/lib/client-types.ts";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";

function setup(hash: string, connection: MobileConnectionStatus) {
  window.location.hash = hash;
  useMobileWebStore.setState({ connection });
  return render(<ConnectionBanner />);
}

describe("ConnectionBanner", () => {
  afterEach(() => {
    cleanup();
    useMobileWebStore.setState({ connection: "idle" });
    window.location.hash = "";
  });

  it("重连中：工作台/会话/变更页显示断线横幅", () => {
    for (const hash of ["#/host", "#/session?panel=p1", "#/changes?cwd=/r"]) {
      const view = setup(hash, "reconnecting");
      expect(screen.getByTestId("connection-banner").textContent).toContain(
        "连接已断开"
      );
      expect(screen.getByTestId("connection-banner").textContent).toContain(
        "可能不是最新"
      );
      view.unmount();
    }
  });

  it("已连接 / 空闲不显示；H0 配对页与 H1 主机列表不显示", () => {
    for (const [hash, connection] of [
      ["#/host", "connected"],
      ["#/host", "idle"],
      ["#/hosts", "reconnecting"],
      ["#/pair", "reconnecting"],
    ] as const) {
      const view = setup(hash, connection);
      expect(screen.queryByTestId("connection-banner")).toBeNull();
      view.unmount();
    }
  });

  it("连接关闭：红色警示 + 返回主机列表", () => {
    setup("#/session?panel=p1", "closed");
    expect(screen.getByRole("alert").textContent).toContain("重新扫码配对");
    fireEvent.click(screen.getByTestId("connection-banner-hosts"));
    expect(window.location.hash).toBe("#/hosts");
  });

  it("首次连接中显示中性提示", () => {
    setup("#/host", "connecting");
    expect(screen.getByRole("status").textContent).toContain(
      "正在连接这台电脑"
    );
  });
});
