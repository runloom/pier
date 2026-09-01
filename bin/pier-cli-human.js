const PATH_NOT_FOUND_PREFIX = "path not found: ";
const PATH_NOT_FOUND_SUFFIX =
  ". Pier does not create files. Create it first, then retry.";

/**
 * Human stderr (no `--json`). Packed CLI has no i18n catalog (no i18next,
 * cannot import `src/`), so copy stays English — the product fallback locale.
 * Path-open missing files drop the `not_found:` code prefix; the protocol
 * message already has the next step. Other errors stay `code: message`.
 */
export function formatCliHumanError(code, message) {
  if (
    typeof message === "string" &&
    message.startsWith(PATH_NOT_FOUND_PREFIX) &&
    message.endsWith(PATH_NOT_FOUND_SUFFIX)
  ) {
    return message;
  }
  return `${code ?? "error"}: ${message ?? "command failed"}`;
}
