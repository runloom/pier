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
  message: string,
  extras?: { osCode?: string }
): PierCommandResult {
  return {
    error: extras?.osCode
      ? { code, message, osCode: extras.osCode }
      : { code, message },
    ok: false,
    requestId,
  };
}
