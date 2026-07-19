import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playImpl: () => Promise<void> = () => Promise.resolve();
  currentTime = 99;
  loop = true;
  src = "";
  volume = 0;
  play = vi.fn(() => FakeAudio.playImpl());

  constructor() {
    FakeAudio.instances.push(this);
  }
}

async function importFreshModule() {
  vi.resetModules();
  return await import("@/lib/attention/play-attention-sound.ts");
}

describe("playAttentionSound", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    FakeAudio.playImpl = () => Promise.resolve();
    vi.stubGlobal("Audio", FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays the builtin id via the pier-asset protocol on a reused element", async () => {
    const { playAttentionSound } = await importFreshModule();

    await playAttentionSound("rooster");
    expect(FakeAudio.instances).toHaveLength(1);
    const audio = FakeAudio.instances[0];
    expect(audio?.src).toBe("pier-asset://sounds/rooster.wav");
    expect(audio?.loop).toBe(false);
    expect(audio?.volume).toBe(1);
    expect(audio?.currentTime).toBe(0);

    await playAttentionSound("fahhhhh");
    // 单例：不再创建第二个元素，换 src 复播。
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio?.src).toBe("pier-asset://sounds/fahhhhh.wav");
    expect(audio?.play).toHaveBeenCalledTimes(2);
  });

  it("drops overlapping business plays while inflight, force bypasses", async () => {
    const { playAttentionSound } = await importFreshModule();
    const releases: Array<() => void> = [];
    FakeAudio.playImpl = () =>
      new Promise((resolve) => {
        releases.push(resolve);
      });

    const first = playAttentionSound("rooster");
    // inflight 中的普通请求被丢弃。
    await playAttentionSound("cow-mooing");
    expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(1);

    // force（试听）不受 inflight 约束。
    const forced = playAttentionSound("cow-mooing", { force: true });
    expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(2);

    for (const release of releases) {
      release();
    }
    await first;
    await forced;
  });

  it("logs only soundId and error name on failure, then rethrows", async () => {
    const { playAttentionSound } = await importFreshModule();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    FakeAudio.playImpl = () =>
      Promise.reject(
        Object.assign(new Error("denied"), {
          name: "NotAllowedError",
        })
      );

    await expect(playAttentionSound("rooster")).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith("[attention-sound] play failed", {
      name: "NotAllowedError",
      soundId: "rooster",
    });
    // 日志载荷禁止路径 / agentRef / 标题正文。
    const payload = warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["name", "soundId"]);
  });
});
