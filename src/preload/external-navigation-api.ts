import type {
  ExternalNavigationRequest,
  ExternalNavigationResult,
} from "@shared/contracts/external-navigation.ts";
import { externalNavigationResultSchema } from "@shared/contracts/external-navigation.ts";

export interface PierExternalNavigationApi {
  open(url: string): Promise<ExternalNavigationResult>;
}

export interface ExternalNavigationApiDependencies {
  invoke(request: ExternalNavigationRequest): Promise<unknown>;
  isUserActivationActive(): boolean;
  now(): number;
  randomNonce(): string;
}

export function createExternalNavigationApi(
  dependencies: ExternalNavigationApiDependencies
): PierExternalNavigationApi {
  let inFlight = false;

  return {
    async open(url) {
      if (!dependencies.isUserActivationActive()) {
        return { opened: false, reason: "user-activation-required" };
      }
      if (inFlight) {
        return { opened: false, reason: "busy" };
      }

      inFlight = true;
      try {
        const result = await dependencies.invoke({
          issuedAt: dependencies.now(),
          nonce: dependencies.randomNonce(),
          url,
        });
        const parsed = externalNavigationResultSchema.safeParse(result);
        return parsed.success
          ? parsed.data
          : { opened: false, reason: "open-failed" };
      } catch {
        return { opened: false, reason: "open-failed" };
      } finally {
        inFlight = false;
      }
    },
  };
}
