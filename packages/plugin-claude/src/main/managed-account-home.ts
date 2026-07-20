import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PIER_MANAGED_HOME_MARKER = ".pier-managed-home";

export function claudeAccountHomeDir(
  managedBaseDir: string,
  accountId: string
): string {
  return join(managedBaseDir, "claude", accountId);
}

export async function ensureManagedAccountDir(
  managedBaseDir: string,
  accountId: string
): Promise<string> {
  const dir = claudeAccountHomeDir(managedBaseDir, accountId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, PIER_MANAGED_HOME_MARKER), "", { mode: 0o600 });
  return dir;
}
