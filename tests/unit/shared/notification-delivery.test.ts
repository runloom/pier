import { routeDelivery } from "@shared/notification-delivery.ts";
import { describe, expect, it } from "vitest";

const UNMUTED = { dndEnabled: false, mutedKinds: [] as const };

describe("routeDelivery", () => {
  it("defaults: toast + inbox, no os notify (M1)", () => {
    expect(
      routeDelivery({ kind: "task-run.finished", severity: "success" }, UNMUTED)
    ).toEqual({ inbox: true, osNotify: false, toast: true });
  });

  it("suppressToast wins", () => {
    expect(
      routeDelivery(
        { kind: "app.update", severity: "warning", suppressToast: true },
        UNMUTED
      ).toast
    ).toBe(false);
  });

  it("mutedKinds silence toast but keep inbox", () => {
    const decision = routeDelivery(
      { kind: "app.update", severity: "info" },
      { dndEnabled: false, mutedKinds: ["app.update"] }
    );
    expect(decision).toEqual({ inbox: true, osNotify: false, toast: false });
  });

  it("DND silences non-error toast; error always toasts", () => {
    const dnd = { dndEnabled: true, mutedKinds: [] as const };
    expect(
      routeDelivery({ kind: "app.update", severity: "info" }, dnd).toast
    ).toBe(false);
    expect(
      routeDelivery({ kind: "app.update", severity: "warning" }, dnd).toast
    ).toBe(false);
    expect(
      routeDelivery({ kind: "agent.runtime", severity: "error" }, dnd).toast
    ).toBe(true);
  });
});
