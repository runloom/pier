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

/**
 * True when the *period* (expiry / trial end) itself needs visual emphasis.
 *
 * Does **not** include `cancelAtPeriodEnd`: that state has its own dedicated
 * warning badge. Folding it into period color made far-away "expires in 35
 * days" read as urgent even when the real signal was only "won't renew".
 */
export function membershipPeriodNeedsAttention(
  membership: AccountMembershipSnapshot | undefined,
  now = Date.now()
): boolean {
  if (!membership) return false;
  if (membership.status === "expired" || membership.status === "canceled") {
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

/** True when the account row should surface attention-mode metadata. */
export function membershipNeedsAttention(
  membership: AccountMembershipSnapshot | undefined,
  now = Date.now()
): boolean {
  if (!membership) return false;
  if (membership.cancelAtPeriodEnd) return true;
  return membershipPeriodNeedsAttention(membership, now);
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
