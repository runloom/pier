import { describe, expect, it, vi } from "vitest";
import { createExternalRendererActivationScope } from "@/lib/plugins/external-activation-scope.ts";

describe("external renderer activation scope", () => {
  it("runs every disposer in reverse order when one fails", () => {
    const events: string[] = [];
    const scope = createExternalRendererActivationScope();
    scope.add(() => events.push("first"));
    scope.add(() => {
      events.push("second");
      throw new Error("second failed");
    });
    scope.add(() => events.push("third"));

    expect(() => scope.dispose()).toThrow(
      "external renderer plugin activation cleanup failed"
    );
    expect(events).toEqual(["third", "second", "first"]);
  });

  it("is idempotent", () => {
    const dispose = vi.fn();
    const scope = createExternalRendererActivationScope();
    scope.add(dispose);

    scope.dispose();
    scope.dispose();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("retries only the disposers that failed", () => {
    const stable = vi.fn();
    const flaky = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("first cleanup failed");
      })
      .mockImplementationOnce(() => undefined);
    const scope = createExternalRendererActivationScope();
    scope.add(stable);
    scope.add(flaky);

    expect(() => scope.dispose()).toThrow(
      "external renderer plugin activation cleanup failed"
    );
    expect(() => scope.dispose()).not.toThrow();

    expect(stable).toHaveBeenCalledOnce();
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("immediately disposes registrations added after scope shutdown", () => {
    const dispose = vi.fn();
    const scope = createExternalRendererActivationScope();
    scope.dispose();

    scope.add(dispose);

    expect(dispose).toHaveBeenCalledOnce();
  });
});
