"use strict";
/** Pier dependency-cruiser config — 守护进程边界 + dockview 边界 DAG */
module.exports = {
  forbidden: [
    {
      name: "main-not-import-renderer",
      severity: "error",
      comment: "main 进程不能 import renderer (process boundary)",
      from: { path: "^src/main" },
      to: { path: "^src/renderer" },
    },
    {
      name: "renderer-not-import-main",
      severity: "error",
      comment: "renderer 进程不能 import main (必经 preload bridge)",
      from: { path: "^src/renderer" },
      to: { path: "^src/main" },
    },
    {
      name: "preload-narrow-imports",
      severity: "error",
      comment: "preload 只能 import shared + electron",
      from: { path: "^src/preload" },
      to: {
        pathNot: ["^src/shared", "node_modules/.*electron(/|$)", "^node:"],
      },
    },
    {
      name: "renderer-no-direct-dockview-core",
      severity: "error",
      comment:
        "renderer 业务代码不可直接 import dockview-core/dockview, 必经 components/workspace/ 边界",
      from: {
        path: "^src/renderer/(?!components/workspace/)",
      },
      to: {
        path: "node_modules/dockview-core|node_modules/dockview$",
      },
    },
    {
      name: "renderer-panels-not-cross-domain",
      severity: "warn",
      comment:
        "renderer 不同 panel-kits 不应跨域 import (走 components/common 或 stores 共享)",
      from: { path: "^src/renderer/panel-kits/([^/]+)" },
      to: { path: "^src/renderer/panel-kits/(?!$1)([^/]+)" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "严禁循环依赖",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "./tsconfig.json" },
  },
};
