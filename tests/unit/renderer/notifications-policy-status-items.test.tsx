import { StatusStack } from "@pier/ui/status-stack.tsx";
import type { SystemNotificationPermissionSnapshot } from "@shared/contracts/notification.ts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationPolicyStatusItems } from "@/pages/settings/components/notifications-section.tsx";

const t = (key: string) => key;

function snapshot(
  status: SystemNotificationPermissionSnapshot["status"]
): SystemNotificationPermissionSnapshot {
  return {
    observedAt: 1,
    source: "cached",
    status,
  };
}

afterEach(() => cleanup());

describe("buildNotificationPolicyStatusItems", () => {
  it("returns empty when authorized and hooks on", () => {
    expect(
      buildNotificationPolicyStatusItems({
        snapshot: snapshot("authorized"),
        agentStatusHooks: true,
        t,
      })
    ).toEqual([]);
  });

  it("maps permission tones mutually exclusively", () => {
    expect(
      buildNotificationPolicyStatusItems({
        snapshot: snapshot("unsupported"),
        agentStatusHooks: true,
        t,
      })
    ).toEqual([
      {
        id: "notif-permission",
        tone: "warning",
        title: "settings.notifications.permission.unsupportedTitle",
        description: "settings.notifications.permission.unsupportedBody",
      },
    ]);

    expect(
      buildNotificationPolicyStatusItems({
        snapshot: snapshot("denied"),
        agentStatusHooks: true,
        t,
      })
    ).toEqual([
      {
        id: "notif-permission",
        tone: "warning",
        title: "settings.notifications.permission.deniedTitle",
        description: "settings.notifications.permission.deniedBody",
      },
    ]);

    expect(
      buildNotificationPolicyStatusItems({
        snapshot: snapshot("unknown"),
        agentStatusHooks: true,
        t,
      })
    ).toEqual([
      {
        id: "notif-permission",
        tone: "info",
        title: "settings.notifications.permission.unknownTitle",
        description: "settings.notifications.permission.unknownBody",
      },
    ]);
  });

  it("emits hooks-off as info without permission item", () => {
    expect(
      buildNotificationPolicyStatusItems({
        snapshot: null,
        agentStatusHooks: false,
        t,
      })
    ).toEqual([
      {
        id: "notif-hooks-off",
        tone: "info",
        title: "settings.notifications.hooksOffTitle",
        description: "settings.notifications.hooksOffBody",
      },
    ]);
  });

  it("stacks denied permission and hooks-off with hooks as info", () => {
    const items = buildNotificationPolicyStatusItems({
      snapshot: snapshot("denied"),
      agentStatusHooks: false,
      t,
    });

    expect(items).toEqual([
      {
        id: "notif-permission",
        tone: "warning",
        title: "settings.notifications.permission.deniedTitle",
        description: "settings.notifications.permission.deniedBody",
      },
      {
        id: "notif-hooks-off",
        tone: "info",
        title: "settings.notifications.hooksOffTitle",
        description: "settings.notifications.hooksOffBody",
      },
    ]);

    render(
      <StatusStack
        data-testid="notifications-policy-status-stack"
        items={items}
      />
    );

    const shells = document.querySelectorAll(
      '[data-testid="notifications-policy-status-stack"]'
    );
    expect(shells).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(2);

    const hooksItem = Array.from(
      document.querySelectorAll('[data-slot="status-stack-item"]')
    ).find((node) => node.textContent?.includes("hooksOffTitle"));
    expect(hooksItem).toBeTruthy();
    expect(hooksItem).toHaveAttribute("data-tone", "info");
  });
});
