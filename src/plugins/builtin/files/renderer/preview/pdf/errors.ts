import type { DocumentRenderError } from "../document/types.ts";

function errorName(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof (error as { name?: unknown }).name === "string"
  ) {
    return (error as { name: string }).name;
  }
  return "";
}

export function pdfLoadError(error: unknown): DocumentRenderError {
  return errorName(error) === "PasswordException"
    ? "encrypted"
    : "parse-failed";
}
