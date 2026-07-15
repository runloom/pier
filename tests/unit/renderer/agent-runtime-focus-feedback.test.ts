import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  invokeAgentRuntimeFocus,
  reportAgentRuntimeFocusResult,
} from "@/lib/agent-runtime/focus-feedback.ts";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  fn: vi.fn(),
}));
const showAppAlert = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("sonner", () => ({
  toast: Object.assign(toast.fn, { error: toast.error }),
}));
vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert,
}));

describe("agent runtime focus feedback", () => {
  beforeEach(async () => {
    await initI18n();
    toast.fn.mockClear();
    toast.error.mockClear();
    showAppAlert.mockClear();
  });

  it("maps all non-ok focus results to user-visible feedback", () => {
    reportAgentRuntimeFocusResult({ status: "ok" });
    expect(toast.fn).not.toHaveBeenCalled();

    reportAgentRuntimeFocusResult({ status: "empty" });
    expect(toast.fn).toHaveBeenCalled();

    reportAgentRuntimeFocusResult({ status: "panel_gone" });
    expect(toast.error).toHaveBeenCalled();

    reportAgentRuntimeFocusResult({ status: "window_gone" });
    expect(toast.error).toHaveBeenCalledTimes(2);

    reportAgentRuntimeFocusResult({ message: "boom", status: "error" });
    expect(showAppAlert).toHaveBeenCalledWith(
      expect.objectContaining({ body: "boom" })
    );
  });

  it("surfaces thrown IPC errors via showAppAlert", async () => {
    await invokeAgentRuntimeFocus(async () => {
      throw new Error("ipc down");
    });
    expect(showAppAlert).toHaveBeenCalledWith(
      expect.objectContaining({ body: "ipc down" })
    );
  });
});
