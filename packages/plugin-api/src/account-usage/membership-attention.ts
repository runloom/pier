import type { AccountMembershipSnapshot } from "./membership-cache.ts";

const MEMBERSHIP_ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountMetadataBadgeMode = "all" | "attention" | "hidden" | "tier";

/**
 * True when the *period* (expiry / trial end) itself needs visual emphasis.
 *
 * Does **not** treat `cancelAtPeriodEnd` as inherently urgent: when cancel is
 * set with a known end date, badges merge into one "cancels on …" chip whose
 * color still follows this window (far-away = neutral, within window =
 * warning). Folding cancel into period color used to make far-away "expires
 * in 35 days" read as urgent even when the real signal was only "won't renew".
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
