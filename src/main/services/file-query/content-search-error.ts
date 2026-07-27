/**
 * Shared error type for content search runner / scope resolution.
 */
export class ContentSearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContentSearchError";
    this.code = code;
  }
}
