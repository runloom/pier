import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function posixSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function escapeOsascriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildAdminLinkCommand(
  sourcePath: string,
  linkPath: string
): string {
  const destDir = dirname(linkPath);
  return `mkdir -p ${posixSingleQuote(destDir)} && ln -Ffs ${posixSingleQuote(sourcePath)} ${posixSingleQuote(linkPath)}`;
}

export function buildAdminUnlinkCommand(linkPath: string): string {
  return `rm -f ${posixSingleQuote(linkPath)}`;
}

export function isAdminCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const stderr =
    err && typeof err === "object" && "stderr" in err
      ? String((err as { stderr?: unknown }).stderr)
      : "";
  const combined = `${message}\n${stderr}`;
  return combined.includes("-128") || /user canceled/i.test(combined);
}

export async function runMacAdminShell(command: string): Promise<void> {
  const script = `do shell script "${escapeOsascriptString(command)}" with administrator privileges`;
  await execFileAsync("osascript", ["-e", script]);
}
