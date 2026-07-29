function normalized(value: string | undefined): string | undefined {
  const result = value?.trim().toLowerCase().replaceAll("_", "-");
  return result || undefined;
}

/**
 * Convert Claude's broad subscription labels and precise rate-limit tiers
 * into one stable display tier. Precise rate-limit evidence always wins.
 */
export function normalizeClaudeMembershipTier(options: {
  organizationType?: string | undefined;
  rateLimitTier?: string | undefined;
  subscriptionType?: string | undefined;
}): string | undefined {
  const rateLimitTier = normalized(options.rateLimitTier);
  if (rateLimitTier) {
    if (rateLimitTier.includes("max-20x")) return "max-20x";
    if (rateLimitTier.includes("max-5x")) return "max-5x";
    if (rateLimitTier.includes("max")) return "max";
    if (rateLimitTier.includes("pro")) return "pro";
    if (rateLimitTier.includes("team")) return "team";
    if (rateLimitTier.includes("enterprise")) return "enterprise";
  }

  const subscriptionType = normalized(options.subscriptionType);
  if (subscriptionType) return subscriptionType;

  const organizationType = normalized(options.organizationType);
  if (!organizationType) return;
  if (organizationType.startsWith("claude-")) {
    return organizationType.slice("claude-".length);
  }
  return organizationType;
}
