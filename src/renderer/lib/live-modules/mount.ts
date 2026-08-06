/**
 * Re-export multi-framework mount helpers for host code / unit tests.
 * Canonical implementation lives in `@plugins/api` so builtin plugins can import it.
 */
export {
  LiveModuleMountError,
  type LiveModuleMountErrorCode,
  type LiveModuleUnmount,
  type MountLiveModuleOptions,
  mountLiveModule,
  mountLiveModuleExport,
} from "@plugins/api/live-module-mount.ts";
