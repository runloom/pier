export function createFileEditorSessionId(ownerId: string): string {
  return JSON.stringify([ownerId]);
}

export function parseFileEditorSessionOwnerId(
  editorSessionId: string
): string | null {
  try {
    const value: unknown = JSON.parse(editorSessionId);
    return Array.isArray(value) &&
      value.length === 1 &&
      typeof value[0] === "string"
      ? value[0]
      : null;
  } catch {
    return null;
  }
}
