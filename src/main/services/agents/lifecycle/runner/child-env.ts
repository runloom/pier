/**
 * Force non-interactive package-manager / installer behavior.
 * Hangs are usually prompts, not missing wall-clock limits.
 */
export function mergeLifecycleChildEnv(
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return {
    ...env,
    CI: env.CI ?? "1",
    NONINTERACTIVE: env.NONINTERACTIVE ?? "1",
    npm_config_yes: env.npm_config_yes ?? "true",
    npm_config_fund: env.npm_config_fund ?? "false",
    npm_config_audit: env.npm_config_audit ?? "false",
    npm_config_progress: env.npm_config_progress ?? "false",
    HOMEBREW_NO_AUTO_UPDATE: env.HOMEBREW_NO_AUTO_UPDATE ?? "1",
    HOMEBREW_NO_ENV_HINTS: env.HOMEBREW_NO_ENV_HINTS ?? "1",
    HOMEBREW_NO_INSTALL_CLEANUP: env.HOMEBREW_NO_INSTALL_CLEANUP ?? "1",
    PIP_DISABLE_PIP_VERSION_CHECK: env.PIP_DISABLE_PIP_VERSION_CHECK ?? "1",
    // Avoid pagers blocking self-update CLIs that shell out to git/less.
    GIT_PAGER: env.GIT_PAGER ?? "cat",
    PAGER: env.PAGER ?? "cat",
  };
}
