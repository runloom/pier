import { afterEach, describe, expect, it } from "vitest";
import {
  NOTIFICATION_CENTER_ACTION_CONTRIBUTIONS,
  registerNotificationCenterActions,
} from "@/lib/actions/notification-center-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useNotificationCenterPopoverStore } from "@/stores/notification-center-popover.store.ts";

describe("registerNotificationCenterActions", () => {
  afterEach(() => {
    actionRegistry.clearForTests();
    useNotificationCenterPopoverStore.setState({ open: false });
  });

  it("registers open / dnd / mark-all-read into the action registry", () => {
    const dispose = registerNotificationCenterActions();
    for (const contribution of NOTIFICATION_CENTER_ACTION_CONTRIBUTIONS) {
      expect(actionRegistry.get(contribution.id)?.id).toBe(contribution.id);
    }
    dispose();
    for (const contribution of NOTIFICATION_CENTER_ACTION_CONTRIBUTIONS) {
      expect(actionRegistry.get(contribution.id)).toBeUndefined();
    }
  });

  it("toggles the notification center popover from pier.notifications.open", () => {
    registerNotificationCenterActions();
    const open = actionRegistry.get("pier.notifications.open");
    expect(open).toBeDefined();
    open?.handler();
    expect(useNotificationCenterPopoverStore.getState().open).toBe(true);
    open?.handler();
    expect(useNotificationCenterPopoverStore.getState().open).toBe(false);
  });
});
