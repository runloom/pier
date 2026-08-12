/**
 * v2 hello → principal 解析。
 * 产品终态：仅 cli-human（auth.method none）。
 */
import type {
  LocalControlClientHello,
  LocalControlServerFrame,
} from "@shared/contracts/local-control/frames.ts";
import { serverErrorFrame } from "./features.ts";

export type HelloPrincipalResult =
  | {
      ok: true;
      principalRef: string;
    }
  | { ok: false; errorFrame: LocalControlServerFrame };

export function resolveHelloPrincipal(args: {
  hello: LocalControlClientHello;
}): HelloPrincipalResult {
  const { hello } = args;

  if (hello.clientKind === "cli-human") {
    if (hello.auth.method !== "none") {
      return {
        ok: false,
        errorFrame: serverErrorFrame(
          "auth_failed",
          "cli-human requires auth.method none"
        ),
      };
    }
    return { ok: true, principalRef: "human:peer" };
  }

  return {
    ok: false,
    errorFrame: serverErrorFrame(
      "permission_denied",
      "principal not authorized"
    ),
  };
}
