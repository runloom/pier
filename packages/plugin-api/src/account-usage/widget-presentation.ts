import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import type { AccountMembershipSnapshot } from "./membership-cache.ts";

const MEMBERSHIP_ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountMetadataBadgeMode = "all" | "attention" | "hidden" | "tier";

export interface AccountWidgetPresentation {
  metadataMode: AccountMetadataBadgeMode;
  showAvatar: boolean;
  showHeader: boolean;
  showSwitcher: boolean;
}

export function membershipNeedsAttention(
  membership: AccountMembershipSnapshot | undefined,
  now = Date.now()
): boolean {
  if (!membership) return false;
  if (
    membership.status === "canceled" ||
    membership.status === "expired" ||
    membership.cancelAtPeriodEnd
  ) {
    return true;
  }
  const attentionBefore = now + MEMBERSHIP_ATTENTION_WINDOW_MS;
  return (
    (membership.trialEndsAt !== undefined &&
      membership.trialEndsAt <= attentionBefore) ||
    (membership.expiresAt !== undefined &&
      membership.expiresAt <= attentionBefore)
  );
}

/**
 * Cross-provider account widget priority policy.
 *
 * Compact widgets reserve space for quota, except when identity is needed to
 * switch accounts or account/membership state needs attention.
 */
export function resolveAccountWidgetPresentation(options: {
  accountCount: number;
  density: WidgetDensity;
  hasAccountError: boolean;
  hasActiveAccount: boolean;
  membership?: AccountMembershipSnapshot;
  now?: number;
}): AccountWidgetPresentation {
  const attention =
    options.hasAccountError ||
    membershipNeedsAttention(options.membership, options.now);
  const showSwitcher = options.accountCount > 1;

  if (options.density === "compact") {
    return {
      metadataMode: attention ? "attention" : "hidden",
      showAvatar: false,
      showHeader:
        !options.hasActiveAccount || showSwitcher || Boolean(attention),
      showSwitcher,
    };
  }

  if (options.density === "medium") {
    return {
      metadataMode: attention ? "all" : "tier",
      showAvatar: true,
      showHeader: true,
      showSwitcher,
    };
  }

  return {
    metadataMode: "all",
    showAvatar: true,
    showHeader: true,
    showSwitcher,
  };
}
