import { isAbsolute } from "node:path";
import type { FileOpenPathResult } from "@shared/contracts/file.ts";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export function isAbsoluteOpenPath(path: string): boolean {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return isAbsolute(trimmed) || WINDOWS_ABSOLUTE_PATH.test(trimmed);
}

export async function openPathWithOpener(
  path: string,
  openPath: (absolutePath: string) => Promise<string>
): Promise<FileOpenPathResult> {
  if (!isAbsoluteOpenPath(path)) {
    return { opened: false, reason: "invalid-path" };
  }
  try {
    const errorMessage = await openPath(path.trim());
    if (errorMessage) {
      return { opened: false, reason: "open-failed" };
    }
    return { opened: true };
  } catch {
    return { opened: false, reason: "open-failed" };
  }
}

export async function openPathViaElectronShell(
  path: string
): Promise<FileOpenPathResult> {
  const { shell } = await import("electron");
  return openPathWithOpener(path, (absolutePath) =>
    shell.openPath(absolutePath)
  );
}
