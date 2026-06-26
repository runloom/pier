import { z } from "zod";

export const pierClientKindSchema = z.enum([
  "desktop-renderer",
  "cli-local",
  "mcp-local",
  "mobile-paired",
]);

export const pierCapabilitySchema = z.enum([
  "app:read",
  "preferences:read",
  "preferences:write",
  "workspace:read",
  "workspace:write",
  "workspace:open",
  "worktree:read",
  "worktree:write",
  "window:read",
  "window:control",
  "window:create",
  "window:focus",
  "window:close",
  "panel:read",
  "panel:control",
  "terminal:read",
  "terminal:control",
]);

export type PierClientKind = z.infer<typeof pierClientKindSchema>;
export type PierCapability = z.infer<typeof pierCapabilitySchema>;

export const pierClientSchema = z.object({
  id: z.string().min(1),
  kind: pierClientKindSchema,
  capabilities: z.array(pierCapabilitySchema),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

export type PierClient = z.infer<typeof pierClientSchema>;

export const DEFAULT_CAPABILITIES_BY_CLIENT_KIND: Record<
  PierClientKind,
  PierCapability[]
> = {
  "desktop-renderer": [
    "app:read",
    "preferences:read",
    "preferences:write",
    "workspace:read",
    "workspace:write",
    "workspace:open",
    "worktree:read",
    "worktree:write",
    "window:read",
    "window:control",
    "window:create",
    "window:focus",
    "window:close",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
  ],
  "cli-local": [
    "app:read",
    "preferences:read",
    "workspace:read",
    "workspace:open",
    "worktree:read",
    "worktree:write",
    "window:read",
    "window:focus",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
  ],
  "mcp-local": [
    "app:read",
    "preferences:read",
    "workspace:read",
    "workspace:open",
    "worktree:read",
    "window:read",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
  ],
  "mobile-paired": [
    "app:read",
    "preferences:read",
    "workspace:read",
    "worktree:read",
    "window:read",
    "window:control",
    "window:create",
    "window:focus",
    "window:close",
    "panel:read",
    "panel:control",
    "terminal:read",
    "terminal:control",
  ],
};
