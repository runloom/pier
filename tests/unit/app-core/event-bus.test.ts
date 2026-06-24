import { createPierEventBus } from "@main/app-core/event-bus.ts";
import { describe, expect, it } from "vitest";

describe("createPierEventBus", () => {
  it("按订阅顺序发送事件", () => {
    const bus = createPierEventBus();
    const seen: string[] = [];

    bus.subscribe((event) => seen.push(`a:${event.type}`));
    bus.subscribe((event) => seen.push(`b:${event.type}`));
    bus.publish({ type: "window.changed", windows: [] });

    expect(seen).toEqual(["a:window.changed", "b:window.changed"]);
  });

  it("取消订阅后不再接收事件", () => {
    const bus = createPierEventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe((event) => seen.push(event.type));

    unsubscribe();
    bus.publish({ panels: [], type: "panel.changed" });

    expect(seen).toEqual([]);
  });
});
