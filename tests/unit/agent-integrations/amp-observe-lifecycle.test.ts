import { describe, expect, it } from "vitest";
import { buildAmpPluginSource } from "../../../src/main/services/agents/integrations/amp.ts";
import { runAmpPluginScenario } from "./amp-test-runtime.ts";

function eventThread(id: string) {
  return { thread: { id } };
}

async function flushPromiseCallbacks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Amp ThreadState 观察生命周期", () => {
  it("subscribe 同步异常不会拒绝 session.start", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        const thread = {
          id: "subscribe-error",
          state: {
            subscribe() {
              throw new Error("subscribe unavailable");
            },
          },
        };
        await expect(
          Promise.resolve(
            handlers.get("session.start")?.(eventThread(thread.id), { thread })
          )
        ).resolves.toBeUndefined();
      }
    );

    expect(rows).toMatchObject([
      {
        event: "SessionStart",
        nativeEvent: "session.start",
        sessionId: "subscribe-error",
      },
    ]);
  });

  it("未完成的 get 不阻塞 agent.start 与 agent.end 返回", async () => {
    await runAmpPluginScenario(buildAmpPluginSource(), async (handlers) => {
      const cases = [
        {
          event: {
            id: "turn-start",
            message: "continue",
            ...eventThread("never-block-start"),
          },
          name: "agent.start",
        },
        {
          event: {
            id: "turn-end",
            message: "done",
            messages: [],
            status: "done",
            ...eventThread("never-block-end"),
          },
          name: "agent.end",
        },
      ] as const;
      for (const testCase of cases) {
        let resolveSnapshot: (state: string) => void = () => {};
        const snapshot = new Promise<string>((resolve) => {
          resolveSnapshot = resolve;
        });
        const thread = {
          id: testCase.event.thread.id,
          state: {
            get: () => snapshot,
            subscribe() {
              return { unsubscribe() {} };
            },
          },
        };
        const result = handlers.get(testCase.name)?.(testCase.event, {
          thread,
        });
        try {
          expect(result).toBeUndefined();
        } finally {
          resolveSnapshot("idle");
          await Promise.resolve(result);
        }
      }
    });
  });

  it("get Promise 拒绝不产生 ThreadState 事件", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        const thread = {
          id: "get-reject",
          state: {
            get: () => Promise.reject(new Error("state unavailable")),
            subscribe() {
              return { unsubscribe() {} };
            },
          },
        };
        const result = handlers.get("session.start")?.(eventThread(thread.id), {
          thread,
        });
        expect(result).toBeUndefined();
        await flushPromiseCallbacks();
      }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: "SessionStart",
      nativeEvent: "session.start",
    });
  });

  it("dispose 后旧 get 快照完成也不产生 ThreadState 事件", async () => {
    let resolveSnapshot: (state: string) => void = () => {};
    const snapshot = new Promise<string>((resolve) => {
      resolveSnapshot = resolve;
    });
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers, lifecycle) => {
        const thread = {
          id: "disposed-snapshot",
          state: {
            get: () => snapshot,
            subscribe() {
              return { unsubscribe() {} };
            },
          },
        };
        const result = handlers.get("session.start")?.(eventThread(thread.id), {
          thread,
        });
        lifecycle.dispose();
        resolveSnapshot("awaiting-approval");
        await Promise.resolve(result);
        await flushPromiseCallbacks();
      }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: "SessionStart",
      nativeEvent: "session.start",
    });
  });

  it("一个 unsubscribe 抛错时仍清理其余订阅", async () => {
    const unsubscribed: string[] = [];
    await runAmpPluginScenario(
      buildAmpPluginSource(),
      (handlers, lifecycle) => {
        const makeThread = (id: string, shouldThrow: boolean) => ({
          id,
          state: {
            subscribe() {
              return {
                unsubscribe() {
                  unsubscribed.push(id);
                  if (shouldThrow) {
                    throw new Error("unsubscribe failed");
                  }
                },
              };
            },
          },
        });
        const first = makeThread("first", true);
        const second = makeThread("second", false);
        handlers.get("session.start")?.(eventThread(first.id), {
          thread: first,
        });
        handlers.get("session.start")?.(eventThread(second.id), {
          thread: second,
        });

        expect(() => lifecycle.dispose()).not.toThrow();
      }
    );

    expect(unsubscribed).toEqual(["first", "second"]);
  });

  it("重复 session.start 对同一 thread 只订阅一次", async () => {
    let subscriptions = 0;
    await runAmpPluginScenario(buildAmpPluginSource(), (handlers) => {
      const thread = {
        id: "same-thread",
        state: {
          subscribe() {
            subscriptions += 1;
            return { unsubscribe() {} };
          },
        },
      };
      handlers.get("session.start")?.(eventThread(thread.id), { thread });
      handlers.get("session.start")?.(eventThread(thread.id), { thread });
    });

    expect(subscriptions).toBe(1);
  });
});
