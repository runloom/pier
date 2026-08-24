// @vitest-environment node

import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import {
  canvasTrustProjectLabel,
  ensureProjectCanvasTrusted,
  resetCanvasTrustGateForTests,
} from "@plugins/builtin/files/renderer/preview/canvas-trust-gate.ts";
import { describe, expect, it, vi } from "vitest";

function createStubs({
  trusted,
  accepted,
}: {
  trusted: boolean;
  accepted: boolean;
}) {
  const trustStatus = vi.fn(async () => ({
    grantedAt: null,
    trusted,
  }));
  const grantTrust = vi.fn(async () => undefined);
  const confirm = vi.fn(async () => accepted);
  const context = {
    dialogs: { confirm },
    liveModules: { grantTrust, trustStatus },
  } as unknown as RendererPluginContext;
  const t: FilesTranslate = (key, fallback) => fallback ?? key;
  return { confirm, context, grantTrust, t, trustStatus };
}

describe("canvas project trust gate", () => {
  it("passes through without a dialog when the project is already trusted", async () => {
    resetCanvasTrustGateForTests();
    const { confirm, context, grantTrust, t } = createStubs({
      accepted: false,
      trusted: true,
    });

    await expect(
      ensureProjectCanvasTrusted({ context, projectRootPath: "/tmp/proj", t })
    ).resolves.toBe("trusted");

    expect(confirm).not.toHaveBeenCalled();
    expect(grantTrust).not.toHaveBeenCalled();
  });

  it("grants and reports trusted after the user accepts", async () => {
    resetCanvasTrustGateForTests();
    const { confirm, context, grantTrust, t } = createStubs({
      accepted: true,
      trusted: false,
    });

    await expect(
      ensureProjectCanvasTrusted({ context, projectRootPath: "/tmp/proj", t })
    ).resolves.toBe("trusted");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(grantTrust).toHaveBeenCalledWith("/tmp/proj");
  });

  it("reports declined and never grants when the user declines", async () => {
    resetCanvasTrustGateForTests();
    const { context, grantTrust, t } = createStubs({
      accepted: false,
      trusted: false,
    });

    await expect(
      ensureProjectCanvasTrusted({ context, projectRootPath: "/tmp/proj", t })
    ).resolves.toBe("declined");

    expect(grantTrust).not.toHaveBeenCalled();
  });

  it("asks once for concurrent previews of the same project root", async () => {
    resetCanvasTrustGateForTests();
    const { confirm, context, t } = createStubs({
      accepted: true,
      trusted: false,
    });
    const input = { context, projectRootPath: "/tmp/proj/", t };

    // Trailing-slash variant must share the same decision as the plain path.
    const [first, second] = await Promise.all([
      ensureProjectCanvasTrusted(input),
      ensureProjectCanvasTrusted({
        context,
        projectRootPath: "/tmp/proj",
        t,
      }),
    ]);

    expect(first).toBe("trusted");
    expect(second).toBe("trusted");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("derives the project label from the leaf directory", () => {
    expect(canvasTrustProjectLabel("/home/u/demo")).toBe("demo");
    expect(canvasTrustProjectLabel("/home/u/demo/")).toBe("demo");
  });
});
