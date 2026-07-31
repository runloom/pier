import {
  buildRendererRecoveryCopy,
  buildRendererRecoveryHtml,
  isRendererRecoveryCloseUrl,
  isRendererRecoveryReloadUrl,
  isRendererRecoveryUrl,
  loadRendererRecoveryPage,
  PIER_RECOVERY_CLOSE_URL,
  PIER_RECOVERY_RELOAD_URL,
} from "@main/windows/renderer-recovery-page.ts";
import { describe, expect, it, vi } from "vitest";

describe("renderer-recovery-page", () => {
  it("classifies recovery action URLs", () => {
    expect(isRendererRecoveryUrl(PIER_RECOVERY_RELOAD_URL)).toBe(true);
    expect(isRendererRecoveryUrl(PIER_RECOVERY_CLOSE_URL)).toBe(true);
    expect(isRendererRecoveryReloadUrl(PIER_RECOVERY_RELOAD_URL)).toBe(true);
    expect(isRendererRecoveryCloseUrl(PIER_RECOVERY_CLOSE_URL)).toBe(true);
    expect(isRendererRecoveryUrl("https://example.com")).toBe(false);
  });

  it("embeds reload and close actions in the recovery document", () => {
    const copy = buildRendererRecoveryCopy({
      detail: "crashed (exit 9)",
      isChinese: true,
      kind: "crash",
    });
    const html = buildRendererRecoveryHtml(copy);
    expect(html).toContain("重新加载");
    expect(html).toContain("关闭窗口");
    expect(html).toContain(PIER_RECOVERY_RELOAD_URL);
    expect(html).toContain(PIER_RECOVERY_CLOSE_URL);
    expect(html).toContain("crashed (exit 9)");
  });

  it("loads the recovery page as a data URL", async () => {
    const loadURL = vi.fn<(url: string) => Promise<void>>(
      async () => undefined
    );
    await loadRendererRecoveryPage(
      { isDestroyed: () => false, loadURL },
      buildRendererRecoveryCopy({
        detail: "hung",
        isChinese: false,
        kind: "unresponsive",
      })
    );
    expect(loadURL).toHaveBeenCalledOnce();
    const url = String(loadURL.mock.calls[0]?.[0] ?? "");
    expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Reload");
  });
});
