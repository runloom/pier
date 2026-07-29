/**
 * 仓库内同时存在多个 esbuild host 版本。已安装 Pier 为打包态动态编译设置的
 * ESBUILD_BINARY_PATH 只能留在对应加载器内，不能泄漏给仓库工具进程。
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [baseEnv]
 */
export function withoutEsbuildBinaryOverride(baseEnv = process.env) {
  const env = { ...baseEnv };
  Reflect.deleteProperty(env, "ESBUILD_BINARY_PATH");
  return env;
}
