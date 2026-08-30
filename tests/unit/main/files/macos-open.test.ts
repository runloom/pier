import { openMacWithOpenCommand } from "@main/services/macos-open.ts";
import { describe, expect, it, vi } from "vitest";

describe("openMacWithOpenCommand", () => {
  it("stops at the first successful candidate", async () => {
    const execFileImpl = vi.fn(async () => undefined);
    await expect(
      openMacWithOpenCommand([["first"], ["second"]], { execFileImpl })
    ).resolves.toBe(true);
    expect(execFileImpl).toHaveBeenCalledTimes(1);
    expect(execFileImpl).toHaveBeenCalledWith("open", ["first"]);
  });

  it("falls through candidates and reports failure when all fail", async () => {
    const execFileImpl = vi.fn(async () => {
      throw new Error("open failed");
    });
    const onCandidateFailed = vi.fn();
    await expect(
      openMacWithOpenCommand([["first"], ["second"]], {
        execFileImpl,
        onCandidateFailed,
      })
    ).resolves.toBe(false);
    expect(execFileImpl).toHaveBeenCalledTimes(2);
    expect(onCandidateFailed).toHaveBeenCalledTimes(2);
  });
});
