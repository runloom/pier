import {
  type AppQuitConfirmationRequest,
  type AppQuitDecisionPayload,
  appQuitDecisionPayloadSchema,
  type QuitActivitySummary,
} from "@shared/contracts/app-quit.ts";

export const APP_QUIT_RENDERER_RESPONSE_TIMEOUT_MS = 30_000;
export const DEFAULT_APP_QUIT_CONFIRMATION_TIMEOUT_MS =
  APP_QUIT_RENDERER_RESPONSE_TIMEOUT_MS + 500;

export type RendererQuitConfirmationSendRequest = (
  request: AppQuitConfirmationRequest
) => Promise<unknown> | unknown;

export interface AppQuitConfirmationArgs {
  createQuitId?: () => string;
  sendRequest: RendererQuitConfirmationSendRequest;
  summaries: readonly QuitActivitySummary[];
  timeoutMs?: number;
}

let nextQuitIdSequence = 0;

function createDefaultQuitId(): string {
  nextQuitIdSequence += 1;
  return `quit-${Date.now()}-${nextQuitIdSequence}`;
}

function parseRendererDecision(
  quitId: string,
  payload: unknown
): AppQuitDecisionPayload | null {
  const parsed = appQuitDecisionPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.quitId !== quitId) {
    return null;
  }

  return parsed.data;
}

async function requestRendererDecision(
  request: AppQuitConfirmationRequest,
  sendRequest: RendererQuitConfirmationSendRequest,
  timeoutMs: number
): Promise<unknown> {
  const timeout = Promise.withResolvers<null>();
  let timeoutHandle: NodeJS.Timeout | undefined;
  timeoutHandle = setTimeout(() => timeout.resolve(null), timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => sendRequest(request)),
      timeout.promise,
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function showAppQuitConfirmation(
  args: AppQuitConfirmationArgs
): Promise<boolean> {
  const quitId = (args.createQuitId ?? createDefaultQuitId)();
  const request: AppQuitConfirmationRequest = {
    quitId,
    summaries: args.summaries,
  };
  const payload = await requestRendererDecision(
    request,
    args.sendRequest,
    args.timeoutMs ?? DEFAULT_APP_QUIT_CONFIRMATION_TIMEOUT_MS
  );
  const decision = parseRendererDecision(quitId, payload);

  return decision?.decision === "quit";
}
