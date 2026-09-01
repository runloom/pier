/**
 * 设置页「远程访问」卡（Task 10）：开关调用 remoteAccess.setEnabled、
 * 生成配对码渲染 QR canvas + 6 位码 + 倒计时、吊销走 showAppConfirm
 * destructive、边界提示 Alert 在 Card 内。文案全部 i18n，测试经
 * i18next.t 取期望串，不内联任何语言文本。
 */
import type { RemoteAccessState } from "@preload/remote-access/api.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { RemoteAccessSection } from "@/pages/settings/components/remote-access/section.tsx";

const toCanvasMock = vi.fn(
  (..._args: unknown[]): Promise<void> => Promise.resolve()
);

vi.mock("qrcode", () => ({
  toCanvas: (...args: unknown[]) => toCanvasMock(...args),
}));

const showAppConfirmMock = vi.fn(
  async (_opts?: unknown): Promise<boolean> => true
);
const showAppAlertMock = vi.fn(
  async (_opts?: unknown): Promise<void> => undefined
);

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert: (opts: unknown) => showAppAlertMock(opts),
    showAppConfirm: (opts: unknown) => showAppConfirmMock(opts),
  };
});

const remoteAccess = {
  beginPairing: vi.fn(),
  cancelPairing: vi.fn(),
  getState: vi.fn(),
  revokeDevice: vi.fn(),
  setEnabled: vi.fn(),
};

function makeState(overrides?: Partial<RemoteAccessState>): RemoteAccessState {
  return {
    boundaryNote: true,
    remote: { configured: false, connectionState: "stopped" },
    devices: [],
    enabled: false,
    host: null,
    pendingPairing: null,
    port: null,
    ...overrides,
  };
}

const ENABLED_STATE = makeState({
  enabled: true,
  host: "192.168.1.5",
  port: 47_320,
});

function t(key: string, options?: Record<string, unknown>): string {
  return options === undefined ? i18next.t(key) : i18next.t(key, options);
}

describe("RemoteAccessSection", () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { remoteAccess },
    });
    remoteAccess.getState.mockResolvedValue(makeState());
    remoteAccess.setEnabled.mockResolvedValue({ enabled: true });
    remoteAccess.revokeDevice.mockResolvedValue({ revoked: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("未开启：开关渲染为关，无边界提示 Alert；打开开关调用 setEnabled(true)", async () => {
    render(<RemoteAccessSection />);

    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.queryByText(t("settings.remoteAccess.boundaryTitle"))
    ).toBeNull();

    remoteAccess.getState.mockResolvedValue(ENABLED_STATE);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(remoteAccess.setEnabled).toHaveBeenCalledWith(true);
    });
    // 开启后同步最新状态：边界提示 Alert 出现在 Card 内
    await screen.findByText(t("settings.remoteAccess.boundaryTitle"));
  });

  it("已开启：渲染同网地址与「生成配对码」按钮", async () => {
    remoteAccess.getState.mockResolvedValue(ENABLED_STATE);
    render(<RemoteAccessSection />);

    await screen.findByText("http://192.168.1.5:47320");
    expect(
      screen.getByText(t("settings.remoteAccess.boundaryTitle"))
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: t("settings.remoteAccess.generateCode"),
      })
    ).toBeTruthy();
  });

  it("生成配对码：调用 beginPairing，渲染 QR canvas、6 位数字码与倒计时", async () => {
    remoteAccess.getState.mockResolvedValue(ENABLED_STATE);
    const expiresAt = Date.now() + 300_000;
    remoteAccess.beginPairing.mockResolvedValue({
      code: "123456",
      expiresAt,
      qrPayload: "pier://pair?code=123456",
    });
    render(<RemoteAccessSection />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: t("settings.remoteAccess.generateCode"),
      })
    );

    await waitFor(() => {
      expect(remoteAccess.beginPairing).toHaveBeenCalledTimes(1);
    });
    const canvas = await screen.findByTestId("remote-access-qr");
    expect(canvas.tagName).toBe("CANVAS");
    expect(toCanvasMock).toHaveBeenCalledWith(
      canvas,
      "pier://pair?code=123456",
      expect.objectContaining({ margin: 1 })
    );
    expect(screen.getByText("123456")).toBeTruthy();
    expect(
      screen.getByText(
        t("settings.remoteAccess.codeExpiresIn", { time: "05:00" })
      )
    ).toBeTruthy();
  });

  it("倒计时随秒针递减", async () => {
    vi.useFakeTimers();
    remoteAccess.getState.mockResolvedValue(ENABLED_STATE);
    remoteAccess.beginPairing.mockResolvedValue({
      code: "654321",
      expiresAt: Date.now() + 30_000,
      qrPayload: "pier://pair?code=654321",
    });
    render(<RemoteAccessSection />);
    await act(async () => {});

    fireEvent.click(
      screen.getByRole("button", {
        name: t("settings.remoteAccess.generateCode"),
      })
    );
    await act(async () => {});

    expect(
      screen.getByText(
        t("settings.remoteAccess.codeExpiresIn", { time: "00:30" })
      )
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(
        t("settings.remoteAccess.codeExpiresIn", { time: "00:29" })
      )
    ).toBeTruthy();
  });

  it("吊销设备：showAppConfirm destructive → revokeDevice → 列表自然刷新", async () => {
    const device = {
      capabilities: [],
      createdAt: 1,
      deviceId: "dev-1",
      lastSeenAt: Date.now(),
      name: "Pixel 8",
      shell: "web" as const,
      tokenEpoch: 1,
    };
    remoteAccess.getState
      .mockResolvedValueOnce(makeState({ ...ENABLED_STATE, devices: [device] }))
      .mockResolvedValue(ENABLED_STATE);
    render(<RemoteAccessSection />);

    const revokeButton = await screen.findByRole("button", {
      name: t("settings.remoteAccess.revoke"),
    });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(showAppConfirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "destructive" })
      );
    });
    await waitFor(() => {
      expect(remoteAccess.revokeDevice).toHaveBeenCalledWith("dev-1");
    });
    // 列表刷新：设备从视图消失（自然 UI 反馈，无额外 toast）
    await waitFor(() => {
      expect(screen.queryByText("Pixel 8")).toBeNull();
    });
  });

  it("吊销取消：确认框返回 false 时不调用 revokeDevice", async () => {
    showAppConfirmMock.mockResolvedValue(false);
    const device = {
      capabilities: [],
      createdAt: 1,
      deviceId: "dev-2",
      lastSeenAt: Date.now(),
      name: "iPhone 16",
      shell: "app" as const,
      tokenEpoch: 1,
    };
    remoteAccess.getState.mockResolvedValue(
      makeState({ ...ENABLED_STATE, devices: [device] })
    );
    render(<RemoteAccessSection />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: t("settings.remoteAccess.revoke"),
      })
    );
    await waitFor(() => {
      expect(showAppConfirmMock).toHaveBeenCalled();
    });
    expect(remoteAccess.revokeDevice).not.toHaveBeenCalled();
  });

  it("setEnabled 失败：showAppAlert 报错误详情", async () => {
    remoteAccess.setEnabled.mockRejectedValue(new Error("boom-detail"));
    render(<RemoteAccessSection />);

    fireEvent.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(showAppAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: "boom-detail" })
      );
    });
  });
});
