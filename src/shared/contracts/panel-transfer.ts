import { z } from "zod";

export const PANEL_TRANSFER_MIME = "application/x-pier-panel-transfer";
export const PANEL_TRANSFER_TEXT_PREFIX = "pier-panel-transfer:";

/** UTF-8 byte cap for transfer descriptors (params/state payloads). */
export const PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES = 256 * 1024;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x7f) {
      byteLength += 1;
    } else if (codePoint <= 0x7_ff) {
      byteLength += 2;
    } else if (codePoint <= 0xff_ff) {
      byteLength += 3;
    } else {
      byteLength += 4;
    }
  }
  return byteLength;
}

function hasUtf8JsonByteLengthAtMost(
  value: unknown,
  maxBytes: number
): boolean {
  try {
    return utf8ByteLength(JSON.stringify(value)) <= maxBytes;
  } catch {
    return false;
  }
}

const transferIdSchema = z.uuid();
const panelIdSchema = z.string().min(1).max(256);
const componentIdSchema = z.string().min(1).max(256);
const groupIdSchema = z.string().min(1).max(256);
const titleSchema = z.string().min(0).max(1024);
const draftKeySchema = z.string().min(1).max(512);

const panelParamsSchema = z
  .record(z.string(), jsonValueSchema)
  .superRefine((params, context) => {
    if (
      !hasUtf8JsonByteLengthAtMost(params, PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES)
    ) {
      context.addIssue({
        code: "custom",
        message: `panel params exceed ${PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES} UTF-8 bytes`,
      });
    }
  });

const movablePanelSchema = z
  .object({
    componentId: componentIdSchema,
    panelId: panelIdSchema,
    title: titleSchema,
    params: panelParamsSchema.optional(),
  })
  .strict();

const unsupportedPanelSchema = z
  .object({
    componentId: componentIdSchema,
    panelId: panelIdSchema,
    title: titleSchema,
  })
  .strict();

export const panelTransferOfferSchema = z.discriminatedUnion("capability", [
  z
    .object({
      version: z.literal(1),
      transferId: transferIdSchema,
      capability: z.literal("movable"),
      panel: movablePanelSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      transferId: transferIdSchema,
      capability: z.literal("unsupported"),
      panel: unsupportedPanelSchema,
    })
    .strict(),
]);
export type PanelTransferOffer = z.infer<typeof panelTransferOfferSchema>;

export const panelTransferPlacementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tab"),
      groupId: groupIdSchema,
      index: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("split"),
      referenceGroupId: groupIdSchema.optional(),
      direction: z.enum(["left", "right", "above", "below"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("root"),
    })
    .strict(),
]);
export type PanelTransferPlacement = z.infer<
  typeof panelTransferPlacementSchema
>;

const draftMappingSchema = z
  .object({
    sourceKey: draftKeySchema,
    targetKey: draftKeySchema,
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.sourceKey === draft.targetKey) {
      context.addIssue({
        code: "custom",
        message: "draft sourceKey and targetKey must differ",
        path: ["targetKey"],
      });
    }
  });

export const panelTransferPreparedSourceSchema = z
  .object({
    state: jsonValueSchema.optional().superRefine((state, context) => {
      if (
        state !== undefined &&
        !hasUtf8JsonByteLengthAtMost(state, PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES)
      ) {
        context.addIssue({
          code: "custom",
          message: `prepared state exceeds ${PANEL_TRANSFER_DESCRIPTOR_MAX_BYTES} UTF-8 bytes`,
        });
      }
    }),
    drafts: z.array(draftMappingSchema).max(16).optional(),
  })
  .strict();
export type PanelTransferPreparedSource = z.infer<
  typeof panelTransferPreparedSourceSchema
>;

export const panelTransferRuntimeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("terminal"),
      lifecycleId: z.string().min(0).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("web"),
    })
    .strict(),
]);

export const panelTransferSourceSnapshotSchema = z
  .object({
    panel: movablePanelSchema,
    runtime: panelTransferRuntimeSchema,
    prepared: panelTransferPreparedSourceSchema,
  })
  .strict();
export type PanelTransferSourceSnapshot = z.infer<
  typeof panelTransferSourceSnapshotSchema
>;

export const panelTransferRendererSourceSnapshotSchema = z
  .object({
    panel: movablePanelSchema,
    runtimeKind: z.enum(["terminal", "web"]),
    prepared: panelTransferPreparedSourceSchema,
  })
  .strict();
export type PanelTransferRendererSourceSnapshot = z.infer<
  typeof panelTransferRendererSourceSnapshotSchema
>;

export const panelTransferPhaseSchema = z.enum([
  "offered",
  "claimed",
  "source-prepared",
  "target-durable",
  "commit-intent",
  "runtime-moved",
  "source-durable",
  "target-active",
  "committed",
  "rolling-back",
  "aborted",
]);
export type PanelTransferPhase = z.infer<typeof panelTransferPhaseSchema>;

export const panelTransferBootstrapPendingSchema = z
  .object({
    transferId: transferIdSchema,
    role: z.enum(["source", "target"]),
    panelId: panelIdSchema,
    phase: panelTransferPhaseSchema,
    snapshot: panelTransferSourceSnapshotSchema,
    inert: z.boolean(),
  })
  .strict();

export const panelTransferBootstrapStateSchema = z
  .object({
    pending: z.array(panelTransferBootstrapPendingSchema),
  })
  .strict();
export type PanelTransferBootstrapState = z.infer<
  typeof panelTransferBootstrapStateSchema
>;

export const panelTransferErrorCodeSchema = z.enum([
  "already_claimed",
  "expired",
  "invalid_offer",
  "not_supported",
  "source_unavailable",
  "target_conflict",
  "target_unavailable",
  "transfer_failed",
]);
export type PanelTransferErrorCode = z.infer<
  typeof panelTransferErrorCodeSchema
>;

export const panelTransferResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      targetPanelId: panelIdSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: panelTransferErrorCodeSchema,
      message: z.string(),
    })
    .strict(),
]);
export type PanelTransferResult = z.infer<typeof panelTransferResultSchema>;

// --- PierCommand schemas (main-mediated claim path; no window identities) ---

export const panelTransferOfferCommandSchema = z
  .object({
    type: z.literal("panelTransfer.offer"),
    offer: panelTransferOfferSchema,
  })
  .strict();

export const panelTransferDropCommandSchema = z
  .object({
    type: z.literal("panelTransfer.drop"),
    transferId: transferIdSchema,
    placement: panelTransferPlacementSchema,
  })
  .strict();

export const panelTransferFinishDragCommandSchema = z
  .object({
    type: z.literal("panelTransfer.finishDrag"),
    transferId: transferIdSchema,
  })
  .strict();

export const panelTransferCancelCommandSchema = z
  .object({
    type: z.literal("panelTransfer.cancel"),
    transferId: transferIdSchema,
  })
  .strict();

export const panelTransferBootstrapCommandSchema = z
  .object({
    type: z.literal("panelTransfer.bootstrap"),
  })
  .strict();

export const panelTransferReadyCommandSchema = z
  .object({
    type: z.literal("panelTransfer.ready"),
    transferId: transferIdSchema,
  })
  .strict();

export const panelTransferPierCommandSchemas = [
  panelTransferOfferCommandSchema,
  panelTransferDropCommandSchema,
  panelTransferFinishDragCommandSchema,
  panelTransferCancelCommandSchema,
  panelTransferBootstrapCommandSchema,
  panelTransferReadyCommandSchema,
] as const;

// --- Renderer command schemas (main → renderer transaction steps) ---

export const panelTransferPrepareSourceCommandSchema = z
  .object({
    type: z.literal("panelTransfer.prepareSource"),
    transferId: transferIdSchema,
    sourcePanelId: panelIdSchema,
  })
  .strict();

export const panelTransferStageTargetCommandSchema = z
  .object({
    type: z.literal("panelTransfer.stageTarget"),
    transferId: transferIdSchema,
    targetPanelId: panelIdSchema,
    panel: movablePanelSchema,
    prepared: panelTransferPreparedSourceSchema,
    placement: panelTransferPlacementSchema,
  })
  .strict();

export const panelTransferReleaseSourceCommandSchema = z
  .object({
    type: z.literal("panelTransfer.releaseSource"),
    transferId: transferIdSchema,
    sourcePanelId: panelIdSchema,
  })
  .strict();

export const panelTransferFinalizeCommandSchema = z
  .object({
    type: z.literal("panelTransfer.finalize"),
    transferId: transferIdSchema,
    role: z.enum(["source", "target"]),
    outcome: z.enum(["commit", "abort"]),
  })
  .strict();

/** Path B: main asks target renderer for drop placement from client coordinates. */
export const panelTransferResolvePlacementCommandSchema = z
  .object({
    type: z.literal("panelTransfer.resolvePlacement"),
    transferId: transferIdSchema,
    clientX: z.number().finite(),
    clientY: z.number().finite(),
  })
  .strict();

/** Lightweight readiness probe — returns quickly whether Dockview api is set. */
export const panelTransferProbeWorkspaceCommandSchema = z
  .object({
    type: z.literal("panelTransfer.probeWorkspace"),
  })
  .strict();

export const panelTransferRendererCommandSchemas = [
  panelTransferPrepareSourceCommandSchema,
  panelTransferStageTargetCommandSchema,
  panelTransferReleaseSourceCommandSchema,
  panelTransferFinalizeCommandSchema,
  panelTransferResolvePlacementCommandSchema,
  panelTransferProbeWorkspaceCommandSchema,
] as const;
