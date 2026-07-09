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
