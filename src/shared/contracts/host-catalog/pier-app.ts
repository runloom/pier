import type { AppUpdateSnapshot } from "../app-update.ts";
import type { CatalogDomainSnapshot, CatalogItem } from "./runtime.ts";

export const PIER_APP_ITEM_ID = "pier";

export function pierAppItemFromStatus(
  status: AppUpdateSnapshot,
  persistedRemote: string | null
): CatalogItem {
  const remote =
    status.availableVersion ??
    (persistedRemote && persistedRemote !== status.currentVersion
      ? persistedRemote
      : null);
  const updateOffered =
    remote !== null &&
    (status.state === "available" ||
      status.state === "downloading" ||
      status.state === "downloaded" ||
      status.state === "idle");
  return {
    details: status,
    domain: "pier-app",
    id: PIER_APP_ITEM_ID,
    label: "Pier",
    localVersion: status.currentVersion,
    presence: "present",
    remoteVersion: remote,
    updateOffered: Boolean(remote) && updateOffered,
  };
}

export function remoteVersionFromDomain(
  snapshot: CatalogDomainSnapshot
): string | null {
  return (
    snapshot.items.find((item) => item.id === PIER_APP_ITEM_ID)
      ?.remoteVersion ?? null
  );
}
