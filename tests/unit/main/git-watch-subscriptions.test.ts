import { createGitWatchSubscriptions } from "@main/ipc/git-watch-subscriptions.ts";
import { describe, expect, it, vi } from "vitest";

describe("createGitWatchSubscriptions", () => {
  it("同 (wc, root) 两次 start → subscribe 只调用一次；第一次 stop 不 dispose，第二次 stop 才 dispose 且仅一次", () => {
    const subs = createGitWatchSubscriptions();
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);

    expect(subs.start(1, "/repo", subscribe)).toBe(true);
    expect(subs.start(1, "/repo", subscribe)).toBe(true);

    expect(subscribe).toHaveBeenCalledTimes(1);

    subs.stop(1, "/repo");
    expect(dispose).not.toHaveBeenCalled();

    subs.stop(1, "/repo");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("限制每窗口根、全局根和同根引用，拒绝时不建立底层订阅", () => {
    const subs = createGitWatchSubscriptions({
      maxActiveRoots: 2,
      maxReferencesPerRoot: 2,
      maxRootsPerWebContents: 2,
    });
    const subscribe = vi.fn(() => vi.fn());

    expect(subs.start(1, "/repo-a", subscribe)).toBe(true);
    expect(subs.start(1, "/repo-a", subscribe)).toBe(true);
    expect(subs.start(1, "/repo-a", subscribe)).toBe(false);
    expect(subs.start(1, "/repo-b", subscribe)).toBe(true);
    expect(subs.start(1, "/repo-c", subscribe)).toBe(false);
    expect(subs.start(2, "/repo-c", subscribe)).toBe(false);
    expect(subs.start(2, "/repo-a", subscribe)).toBe(true);

    expect(subscribe).toHaveBeenCalledTimes(3);
  });

  it("未 start 过的 stop → 不抛错、dispose 不被调用", () => {
    const subs = createGitWatchSubscriptions();
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);

    expect(() => subs.stop(99, "/nonexistent")).not.toThrow();
    expect(dispose).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("start → stop 归零销毁 → 再 start → subscribe 第二次被调用（重新建立底层订阅）", () => {
    const subs = createGitWatchSubscriptions();
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);

    subs.start(1, "/repo", subscribe);
    subs.stop(1, "/repo");
    expect(dispose).toHaveBeenCalledTimes(1);

    subs.start(1, "/repo", subscribe);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("同 wc 两个不同 gitRoot 相互独立：stop 其一只 dispose 其一", () => {
    const subs = createGitWatchSubscriptions();
    const disposeA = vi.fn();
    const subscribeA = vi.fn(() => disposeA);
    const disposeB = vi.fn();
    const subscribeB = vi.fn(() => disposeB);

    subs.start(1, "/repoA", subscribeA);
    subs.start(1, "/repoB", subscribeB);

    subs.stop(1, "/repoA");
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).not.toHaveBeenCalled();
  });

  it("dropAll：同 wc 多 root（其中一个计数 >1）全部 dispose；另一个 wc 的订阅不受影响", () => {
    const subs = createGitWatchSubscriptions();
    const disposeX = vi.fn();
    const subscribeX = vi.fn(() => disposeX);
    const disposeY = vi.fn();
    const subscribeY = vi.fn(() => disposeY);
    const disposeOther = vi.fn();
    const subscribeOther = vi.fn(() => disposeOther);

    // wc=1: two roots, /repoX has refcount 2
    subs.start(1, "/repoX", subscribeX);
    subs.start(1, "/repoX", subscribeX);
    subs.start(1, "/repoY", subscribeY);

    // wc=2: independent subscription
    subs.start(2, "/repoZ", subscribeOther);

    subs.dropAll(1);

    expect(disposeX).toHaveBeenCalledTimes(1);
    expect(disposeY).toHaveBeenCalledTimes(1);
    expect(disposeOther).not.toHaveBeenCalled();
  });

  it("dropAll 之后再 start 同 (wc, root) → subscribe 重新被调用（注册表状态已清空）", () => {
    const subs = createGitWatchSubscriptions();
    const dispose = vi.fn();
    const subscribe = vi.fn(() => dispose);

    subs.start(1, "/repo", subscribe);
    expect(subscribe).toHaveBeenCalledTimes(1);

    subs.dropAll(1);
    expect(dispose).toHaveBeenCalledTimes(1);

    subs.start(1, "/repo", subscribe);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("一个 disposer 抛错时仍释放其余 root，且 STOP 保持幂等", () => {
    const subs = createGitWatchSubscriptions();
    const disposeA = vi.fn(() => {
      throw new Error("dispose failed");
    });
    const disposeB = vi.fn();

    expect(subs.start(1, "/repo-a", () => disposeA)).toBe(true);
    expect(subs.start(1, "/repo-b", () => disposeB)).toBe(true);
    expect(() => subs.dropAll(1)).not.toThrow();
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(subs.stop(1, "/repo-a")).toBe(false);

    expect(subs.start(2, "/repo-a", () => disposeA)).toBe(true);
    expect(subs.stop(2, "/repo-a")).toBe(true);
    expect(subs.stop(2, "/repo-a")).toBe(false);
  });
});
