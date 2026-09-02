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

/**
 * PierCommand `app.openExternal` — canvas chrome path for opening an https
 * URL in the system browser (issue links on task views). Renderer surfaces
 * keep using the activation-gated preload facade instead.
 */
export const appOpenExternalCommandSchema = z.object({
  type: z.literal("app.openExternal"),
  url: z.string().min(1).max(2048),
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
