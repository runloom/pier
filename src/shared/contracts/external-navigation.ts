import { z } from "zod";

export const externalNavigationFailureReasonSchema = z.enum([
  "busy",
  "expired",
  "invalid-request",
  "invalid-url",
  "not-focused",
  "open-failed",
  "replayed",
  "user-activation-required",
]);

export const externalNavigationRequestSchema = z.object({
  issuedAt: z.number().int().nonnegative(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/u),
  url: z.string().min(1).max(16_384),
});

export const externalNavigationResultSchema = z.discriminatedUnion("opened", [
  z.object({ opened: z.literal(true) }),
  z.object({
    opened: z.literal(false),
    reason: externalNavigationFailureReasonSchema,
  }),
]);

export type ExternalNavigationRequest = z.infer<
  typeof externalNavigationRequestSchema
>;
export type ExternalNavigationResult = z.infer<
  typeof externalNavigationResultSchema
>;
