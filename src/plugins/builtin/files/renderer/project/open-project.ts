import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { stableFileIdentityHash } from "../document/stable-hash.ts";

export function createProjectFilesInstanceId(root: string): string {
  return `${FILES_FILE_PANEL_ID}:project:${stableFileIdentityHash(root)}`;
}
