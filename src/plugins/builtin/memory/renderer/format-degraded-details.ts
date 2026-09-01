import type { MemoryStatusSnapshot } from "@shared/contracts/agent/memory.ts";

type Translate = (
  key: string,
  values?: Record<string, number | string>,
  fallback?: string
) => string;

export function connectedMemoryAgentCount(
  targets: MemoryStatusSnapshot["targets"]
): number {
  const names = new Set<string>();
  for (const row of targets) {
    if (row.outcome !== "written") {
      continue;
    }
    for (const consumer of row.consumers) {
      names.add(consumer);
    }
  }
  return names.size;
}

export function foldHomePath(
  abs: string,
  storePath: string,
  storePathDisplay: string
): string {
  if (!storePathDisplay.startsWith("~")) {
    return abs;
  }
  const suffix = storePathDisplay.slice(1);
  if (!storePath.endsWith(suffix)) {
    return abs;
  }
  const home = storePath.slice(0, storePath.length - suffix.length);
  if (abs === home) {
    return "~";
  }
  if (abs.startsWith(`${home}/`)) {
    return `~${abs.slice(home.length)}`;
  }
  return abs;
}

export function humanizeMemoryTargetDetail(
  detail: string | undefined,
  t: Translate
): string {
  if (detail === undefined || detail === "") {
    return t(
      "degraded.failedUnknown",
      undefined,
      "Could not update this config."
    );
  }
  if (detail.includes("already defined")) {
    return t(
      "degraded.alreadyDefined",
      undefined,
      "This config already has a project memory server Pier did not write. Remove that entry, then turn project memory on again."
    );
  }
  if (detail.includes("not configured yet")) {
    return t(
      "degraded.notConfigured",
      undefined,
      "Pier has not written this config yet. Turn project memory off and on to retry."
    );
  }
  if (detail.includes("missing or changed on disk")) {
    return t(
      "degraded.changedOnDisk",
      undefined,
      "This config changed on disk. Turn project memory off and on to retry."
    );
  }
  return detail;
}

/** sm alert copy: failures first, then a count of connected agents. */
export function formatMemoryDegradedDetails(
  snapshot: Pick<
    MemoryStatusSnapshot,
    "storePath" | "storePathDisplay" | "targets"
  >,
  t: Translate
): string {
  const failed = snapshot.targets.filter((row) => row.outcome === "failed");
  const lines = failed.map((row) => {
    const path = foldHomePath(
      row.configPath,
      snapshot.storePath,
      snapshot.storePathDisplay
    );
    return `${path}\n${humanizeMemoryTargetDetail(row.detail, t)}`;
  });
  const connected = connectedMemoryAgentCount(snapshot.targets);
  if (connected > 0) {
    lines.push(
      t(
        "degraded.othersConnected",
        { count: connected },
        `Other agents connected: ${connected}`
      )
    );
  }
  if (lines.length === 0) {
    return t(
      "degraded.failedUnknown",
      undefined,
      "Could not update this config."
    );
  }
  return lines.join("\n\n");
}
