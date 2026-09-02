import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADDON_PATH = join(process.cwd(), "native/src/addon.mm");

/**
 * ForwardChannel 是 swift → JS 唯一桥。Node `node_api.cc` 的 `Push()` 只在
 * `max_queue_size > 0` 且队列满时才等待，因此无界队列的 BlockingCall 从不阻塞
 * swift/AppKit 线程；而有界队列 + NonBlockingCall 会在 JS 忙时以 napi_queue_full
 * 静默丢掉 OSC 133 / ProcessClosed / ChildExited / Key 这类不可合并的一次性事件。
 */
describe("native Ghostty forward channel", () => {
  const source = readFileSync(ADDON_PATH, "utf8");

  it("keeps the swift→JS TSFN queue unbounded so no forward is ever dropped", () => {
    expect(source).toMatch(
      /ThreadSafeFunction::New\(\s*env,\s*jsFn,\s*debugName_,\s*0,\s*1\s*\)/u
    );
    expect(source).not.toMatch(/kForwardTsfnMaxQueue/u);
  });

  it("does not route forwards through a lossy NonBlockingCall", () => {
    expect(source).toMatch(/tsfn_\.BlockingCall\(/u);
    expect(source).not.toMatch(/tsfn_\.NonBlockingCall\(/u);
  });
});
