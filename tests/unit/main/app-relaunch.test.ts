import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armIntentionalQuitAndInstall,
  armIntentionalRelaunch,
  consumeIntentionalQuitAction,
  disarmIntentionalRelaunch,
  isIntentionalRelaunchArmed,
  performProdQuitAndInstall,
  performProdRelaunch,
  resetIntentionalRelaunchForTests,
} from "../../../src/main/app-core/app-relaunch.ts";

const quitMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    quit: (...args: unknown[]) => quitMock(...args),
  },
}));

describe("app-relaunch intentional quit actions", () => {
  afterEach(() => {
    resetIntentionalRelaunchForTests();
    quitMock.mockReset();
  });

  it("arms relaunch without installing and requests app.quit for the flush path", async () => {
    await performProdRelaunch();

    expect(isIntentionalRelaunchArmed()).toBe(true);
    expect(consumeIntentionalQuitAction()).toBe("relaunch");
    expect(isIntentionalRelaunchArmed()).toBe(false);
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it("arms quitAndInstall without calling the updater, then requests app.quit so layout can flush first", async () => {
    await performProdQuitAndInstall();

    expect(isIntentionalRelaunchArmed()).toBe(true);
    expect(consumeIntentionalQuitAction()).toBe("quitAndInstall");
    expect(isIntentionalRelaunchArmed()).toBe(false);
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it("disarm clears both relaunch and quitAndInstall arms", () => {
    armIntentionalQuitAndInstall();
    expect(isIntentionalRelaunchArmed()).toBe(true);

    disarmIntentionalRelaunch();

    expect(isIntentionalRelaunchArmed()).toBe(false);
    expect(consumeIntentionalQuitAction()).toBeNull();
  });

  it("relaunch arm overwrites a prior quitAndInstall arm", () => {
    armIntentionalQuitAndInstall();
    armIntentionalRelaunch();

    expect(consumeIntentionalQuitAction()).toBe("relaunch");
  });
});
