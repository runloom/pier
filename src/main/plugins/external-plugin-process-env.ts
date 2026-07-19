/**
 * Host-facing env slice for external main plugins.
 *
 * PATH/HOME/*_HOME must read live process.env so login-shell PATH hydration
 * (agentDetection.ensurePath) is visible after plugin activate — GUI Electron
 * starts with a thin PATH that often omits ~/.grok/bin and similar bins.
 */
export function createExternalPluginProcessEnv(): Readonly<
  Record<string, string | undefined>
> {
  return {
    get CODEX_HOME() {
      return process.env.CODEX_HOME;
    },
    get GROK_HOME() {
      return process.env.GROK_HOME;
    },
    get HOME() {
      return process.env.HOME;
    },
    get PATH() {
      return process.env.PATH;
    },
  };
}
