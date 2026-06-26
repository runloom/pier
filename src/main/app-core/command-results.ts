import type {
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";

export function commandSuccess(
  requestId: string,
  data: unknown
): PierCommandResult {
  return { data, ok: true, requestId };
}

export function commandFailure(
  requestId: string,
  code: PierCommandErrorCode,
  message: string
): PierCommandResult {
  return {
    error: { code, message },
    ok: false,
    requestId,
  };
}
