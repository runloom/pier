export function fileEditorErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

export function isFileConflictError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "file_conflict"
  );
}

export function isFileMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    "code" in error &&
    ((error as Error & { code?: unknown }).code === "ENOENT" ||
      (error as Error & { code?: unknown }).code === "not_found")
  ) {
    return true;
  }
  return /ENOENT|no such file|not found/i.test(error.message);
}
