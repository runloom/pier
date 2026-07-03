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
      comment: "preload 只能 import shared + electron + preload 内部",
      from: { path: "^src/preload" },
      to: {
        pathNot: [
          "^src/shared",
          "^src/preload",
          "node_modules/.*electron(/|$)",
          "^node:",
        ],
      },
    },
    {
      name: "plugins-not-import-host-implementations",
      severity: "error",
      comment:
        "插件包不能 import main/renderer 宿主实现, 必须通过 src/plugins/api 或 shared 契约接入",
      from: { path: "^src/plugins" },
      to: { path: "^src/(main|renderer)" },
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
      name: "packages-ui-not-import-app",
      severity: "error",
      comment:
        "共享 UI 包 packages/ui 是叶子层, 不能 import 任何 app 代码 (src)",
      from: { path: "^packages/ui" },
      to: { path: "^src" },
    },
    {
      name: "foreground-activity-narrow-imports",
      severity: "error",
      comment:
        "foreground-activity 模块只应依赖 shared 契约与 node builtin; 不依赖 services/agents 或 ipc 层, 保 activity 广播路径独立",
      from: { path: "^src/main/services/foreground-activity" },
      to: {
        pathNot: [
          "^src/main/services/foreground-activity",
          "^src/shared",
          "^node:",
          "node_modules",
          // depcruise 解析 node builtin 为裸名 (fs, path, crypto, ...); 允许它们
          "^(assert|buffer|crypto|events|fs|http|https|net|os|path|stream|url|util|zlib)(/|$)",
        ],
      },
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
