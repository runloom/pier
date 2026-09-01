export type Translate = (key: string, fallback?: string) => string;

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
