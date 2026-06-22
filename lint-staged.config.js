/** lint-staged config */
export default {
  "!(src/renderer/app/globals.css)*.{ts,tsx,js,jsx,json,jsonc,css}": [
    "ultracite fix",
  ],
  "src/shared/**/*.ts": [
    "bash -c 'echo \"⚠ shared/ 改动 (跨进程契约影响面大, PR review 强制)\"'",
  ],
};
