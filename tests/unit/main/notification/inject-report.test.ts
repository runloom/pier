import { resolveAttentionLocale } from "@main/services/agent-attention/locale.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@main/services/agent-attention/locale.ts", () => ({
  resolveAttentionLocale: vi.fn(async (): Promise<"en" | "zh-CN"> => "en"),
}));

import { wireAgentCommandInjectFailedReporter } from "@main/ipc/notification-center-inject-report.ts";
import {
  reportAgentCommandInjectFailed,
  setAgentCommandInjectFailedReporter,
} from "@main/ipc/terminal/create-post-actions.ts";

describe("wireAgentCommandInjectFailedReporter", () => {
  afterEach(() => {
    setAgentCommandInjectFailedReporter(undefined);
    vi.mocked(resolveAttentionLocale).mockReset();
    vi.mocked(resolveAttentionLocale).mockResolvedValue("en");
  });

  it("still ingests when locale resolution rejects", async () => {
    vi.mocked(resolveAttentionLocale).mockRejectedValueOnce(
      new Error("prefs unavailable")
    );
    const ingest = vi.fn();
    wireAgentCommandInjectFailedReporter(ingest);
    reportAgentCommandInjectFailed("panel-inject-1");
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalledTimes(1);
    });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "operation.result",
        panelRef: { panelId: "panel-inject-1" },
        severity: "error",
        trigger: "user-action",
      })
    );
  });
});
