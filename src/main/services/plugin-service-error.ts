export type PluginServiceErrorCode =
  | "invalid_manifest"
  | "not_found"
  | "unsupported";

export class PluginServiceError extends Error {
  readonly code: PluginServiceErrorCode;

  constructor(code: PluginServiceErrorCode, message: string) {
    super(message);
    this.name = "PluginServiceError";
    this.code = code;
  }
}
