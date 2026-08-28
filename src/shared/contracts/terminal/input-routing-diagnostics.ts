import { z } from "zod";

const terminalDragActionSchema = z.enum([
  "started",
  "ended",
  "fallback-timeout",
  "disposed",
]);

const terminalTabDragReasonSchema = z.enum([
  "dockview-will-drop",
  "dockview-did-drop",
  "window-dragend",
  "escape",
  "fallback-timeout",
  "superseded",
  "dispose",
]);

/** sash 是 pointer 会话，结束原因与 tab drop 语义互斥。 */
const terminalSashDragReasonSchema = z.enum([
  "pointerup",
  "pointercancel",
  "window-blur",
  "dispose",
]);

const terminalKeybindingActionSchema = z.enum([
  "dispatched",
  "text-input-suppressed",
  "overlay-blocked",
  "disabled",
  "missing-action",
  "handler-rejected",
]);

const terminalFocusKindSchema = z.enum(["terminal", "web"]);

const sessionIdSchema = z.string().min(1).max(96);
const elapsedMsSchema = z.number().int().nonnegative().max(60_000).optional();
const webOwnerCountSchema = z.number().int().nonnegative().max(64).optional();

export const terminalInputRoutingDiagnosticSchema = z.discriminatedUnion(
  "source",
  [
    z
      .object({
        action: terminalDragActionSchema,
        elapsedMs: elapsedMsSchema,
        panelId: z.string().min(1).max(128).optional(),
        reason: terminalTabDragReasonSchema.optional(),
        sessionId: sessionIdSchema,
        source: z.literal("workspace-tab-drag"),
        webOwnerCount: webOwnerCountSchema,
      })
      .strict(),
    z
      .object({
        action: terminalDragActionSchema,
        elapsedMs: elapsedMsSchema,
        reason: terminalSashDragReasonSchema.optional(),
        sessionId: sessionIdSchema,
        source: z.literal("workspace-sash-drag"),
        webOwnerCount: webOwnerCountSchema,
      })
      .strict(),
    z
      .object({
        action: terminalKeybindingActionSchema,
        activePanelComponent: z.string().max(80).optional(),
        commandId: z.string().min(1).max(160),
        overlayCount: z.number().int().nonnegative().max(32),
        route: z.enum(["menu", "native-forward", "web-keydown"]),
        source: z.literal("keybinding"),
      })
      .strict(),
    // stuckOwnerId / ownerIds 为静态种类或 kind:panelId，不含用户文本。
    z
      .object({
        action: z.literal("owner-stuck"),
        basePanelKind: terminalFocusKindSchema,
        effectiveKind: terminalFocusKindSchema,
        heldMs: z.number().int().nonnegative().max(86_400_000),
        ownerIds: z.array(z.string().min(1).max(96)).max(16),
        source: z.literal("input-owner-watch"),
        stuckOwnerId: z.string().min(1).max(96),
      })
      .strict(),
  ]
);

export type TerminalInputRoutingDiagnosticInput = z.infer<
  typeof terminalInputRoutingDiagnosticSchema
>;
