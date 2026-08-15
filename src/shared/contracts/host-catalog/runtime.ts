import { z } from "zod";

export const catalogDomainIdSchema = z.enum([
  "agent-cli",
  "managed-plugin",
  "pier-app",
]);
export type CatalogDomainId = z.infer<typeof catalogDomainIdSchema>;

export const catalogClassSchema = z.enum(["local", "derived", "remote"]);
export type CatalogClass = z.infer<typeof catalogClassSchema>;

export const catalogItemPresenceSchema = z.enum([
  "missing",
  "present",
  "broken",
]);
export type CatalogItemPresence = z.infer<typeof catalogItemPresenceSchema>;

export const catalogItemSchema = z.object({
  details: z.unknown(),
  domain: catalogDomainIdSchema,
  id: z.string().min(1),
  label: z.string().min(1),
  localVersion: z.string().nullable(),
  presence: catalogItemPresenceSchema,
  remoteVersion: z.string().nullable(),
  updateOffered: z.boolean(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const catalogDomainSnapshotSchema = z.object({
  domain: catalogDomainIdSchema,
  fingerprint: z.string().nullable(),
  items: z.array(catalogItemSchema),
  localProbedAt: z.number().nullable(),
  remoteCheckedAt: z.number().nullable(),
  revision: z.number().int().nonnegative(),
});
export type CatalogDomainSnapshot = z.infer<typeof catalogDomainSnapshotSchema>;

export const catalogSnapshotSchema = z.object({
  domains: z.partialRecord(catalogDomainIdSchema, catalogDomainSnapshotSchema),
  version: z.literal(1),
});
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export const catalogChangedPayloadSchema = z.object({
  domain: catalogDomainIdSchema,
  snapshot: catalogDomainSnapshotSchema,
});
export type CatalogChangedPayload = z.infer<typeof catalogChangedPayloadSchema>;

export const catalogEnsureFreshRequestSchema = z.object({
  class: z.union([catalogClassSchema, z.literal("all")]).optional(),
  domain: catalogDomainIdSchema,
  force: z.boolean().optional(),
});
export type CatalogEnsureFreshRequest = z.infer<
  typeof catalogEnsureFreshRequestSchema
>;

export function emptyCatalogSnapshot(): CatalogSnapshot {
  return { domains: {}, version: 1 };
}

export function emptyDomainSnapshot(
  domain: CatalogDomainId
): CatalogDomainSnapshot {
  return {
    domain,
    fingerprint: null,
    items: [],
    localProbedAt: null,
    remoteCheckedAt: null,
    revision: 0,
  };
}
