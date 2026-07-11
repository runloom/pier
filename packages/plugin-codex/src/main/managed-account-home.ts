import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";

export function codexAccountHomeDir(
  managedBaseDir: string,
  accountId: string
): string {
  return join(managedBaseDir, "codex", accountId);
}

export async function ensureManagedAccountDir(
  managedBaseDir: string,
  accountId: string
): Promise<string> {
  const dir = codexAccountHomeDir(managedBaseDir, accountId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PIER_MANAGED_HOME_MARKER), "", { mode: 0o600 });
  return dir;
}
