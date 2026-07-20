# Pier 官方插件开发与发布指南

发布通道总览与流程图：[`release.md`](./release.md)。本文侧重范围、开发、打包与运行时校验。


## 当前支持范围

Pier 当前只接受两类插件：

- 内置插件：位于 `src/plugins/builtin/*`，随 Pier 一起构建。
- 官方受管理外部插件：位于 `packages/plugin-*`，通过签名官方索引、包校验、不可变版本目录和启动时运行态快照加载，例如 `pier.claude`、`pier.codex`、`pier.grok`。

当前不支持第三方插件、任意 local / git / registry 来源、自建索引或 marketplace。源码中的预留枚举不等于产品已经开放对应安装路径。

## 信任模型

内置插件和官方受管理外部插件都属于可信代码：

- renderer 插件与宿主运行在同一个页面环境。
- external main 是由 Pier main 进程加载的普通 Node ESM，可以使用 Node 能力。
- manifest capability、`pluginId` RPC 作用域、贡献点声明校验和包扫描是工程纪律，不是恶意代码隔离。
- main 侧 `authorizeCommand` 当前按客户端类型授权，不按插件主体身份授权。

因此，官方索引只承载 Pier 官方维护和签名的插件。不得把当前体系描述成第三方安全沙箱。

## 受管理插件链路

~~~text
packages/plugin-<id>/
        │
        ▼  构建与打包
plugin-<id>-<version>.tgz
plugin-<id>-<version>.tgz.sha256
        │
        ▼  官方 GitHub Release
plugins/index.v1.json
        │  Ed25519 签名、sha256、size、Pier 版本范围
        ▼
Pier 拉取并验证官方索引
        │
        ▼  下载、校验、解压、包检查、原子提升
{userData}/plugins/installed/<id>/<version>/
        │
        ▼  下次启动读取不可变运行态快照
official managed external plugin
~~~

官方索引不可达时，Pier 使用磁盘中的最近有效缓存；装机资源可以为官方插件提供离线兜底包。

## 官方插件目录

~~~text
packages/
  plugin-<id>/
    plugin.json
    package.json
    src/
      main/
      renderer/
      shared/
    vite.config.main.ts
    vite.config.renderer.ts
    tsconfig.json
~~~

关键规则：

- 插件 id 必须唯一，官方插件使用 `pier.<name>`，例如 `pier.codex`。
- `plugin.json` 的 `main` 和 `renderer` 指向打包后的 `dist/` 文件。
- main bundle 只允许 Node 内置模块和 `@pier/plugin-api` 作为外部依赖；其它纯 JavaScript 依赖必须内联。
- renderer bundle 只允许 `@pier/plugin-api/*` 作为外部依赖。
- 插件只能注册 manifest 已声明的贡献点和权限。
- 完整官方样例见 `packages/plugin-codex/`；Claude / Grok 同结构样例见 `packages/plugin-claude/`、`packages/plugin-grok/`。

## 本地开发

常用命令：

~~~bash
pnpm plugin:claude:build  # 构建 Claude 官方插件
pnpm plugin:claude:pack   # 构建并生成 tgz 与 sha256
pnpm plugin:codex:build   # 构建 Codex 官方插件
pnpm plugin:codex:pack    # 构建并生成 tgz 与 sha256
pnpm plugin:grok:build    # 构建 Grok 官方插件
pnpm plugin:grok:pack     # 构建并生成 tgz 与 sha256
pnpm plugins:pack         # 依次打包所有官方插件
pnpm plugins:index        # 重新生成 plugins/index.v1.json
pnpm dev                  # 启动 Pier 开发环境
~~~

开发态可以使用 dev override 从本地包目录加载官方插件：

- 只允许 development / test 运行时使用。
- 修改源码或 manifest 后需要重新构建或打包。
- 生产包不显示 dev override 入口，相关命令返回拒绝结果。
- 生产运行时忽略历史 `index.json` 中保存的本地 dev override 路径。
- 本地目录不得被标记为 official 来源。

## 打包规范

`scripts/pack-plugin.mjs` 生成 tgz 和对应的 sha256 文件。

包必须包含：

- `plugin.json`
- `package.json`
- manifest 指向的 `dist/main.js`
- manifest 指向的 `dist/renderer.js`

包不得包含：

- `node_modules/`
- `src/`
- `.git/`
- 符号链接
- 绝对路径或包含 `..` 的归档条目

归档限制由 `MANAGED_PLUGIN_PACKAGE_LIMITS` 统一定义，包括单文件大小、总大小、目录深度和路径长度。打包脚本会统一 mtime，保证相同输入生成可复现结果。

## 运行时校验

Pier 安装官方插件时依次执行：

| 阶段 | 校验 |
|---|---|
| 官方索引 | canonical JSON、Ed25519 签名、已知 key id、sequence 防回滚、严格 schema |
| 下载 | asset 来源、HTTP 跳转目标、声明 size、sha256 |
| 解压前 | 归档路径、单条目大小、总大小、深度、路径长度、符号链接 |
| 解压后 | `package.json`、`plugin.json`、id、version、Pier 版本范围 |
| bundle | 允许的外部依赖、禁止 `eval(...)` 和 `new Function(...)` |
| 提升 | staging 到同文件系统临时目录，再原子 rename 到不可变版本目录 |
| 启动 | main / renderer 激活结果、data schema 兼容、last-known-good |

任一校验失败都会拒绝安装或激活，并保留最近有效版本用于恢复。

## 官方索引约束

- 默认索引地址为 `https://runloom.github.io/pier/plugins/index.v1.json`。
- Ed25519 公钥固定在 Pier 应用中，未知 key id 无法通过验证。
- 官方 Release asset 的 GitHub owner allowlist 当前只允许 `runloom`。
- 生产环境无条件忽略 `PIER_OFFICIAL_PLUGIN_INDEX_URL`。
- 被拒绝的网络索引不会覆盖磁盘中的最近有效缓存。
- 索引回滚、同版本 hash 漂移和非允许来源都会被拒绝。

## 发布官方插件

步骤、prerelease 规则、索引 Pages 与维护者命令见 [`release.md`](./release.md)「官方插件」。

合入前建议：

~~~bash
pnpm plugin:<id>:pack
pnpm plugins:index
pnpm check:plugin-index
~~~

- `package.json` 与 `plugin.json` 的 version 必须一致。
- 仅含 `plugin.json` 的包会进发布队列；`plugin-api` 等共享包不会。
- 发布权限仅限官方维护者，不是第三方上架入口。

## 安装、更新与回滚

- 安装目录固定为 `{userData}/plugins/installed/<id>/<version>`，已安装版本不可原地修改。
- 下载内容先进入 staging，校验完成后原子提升。
- 更新、回滚、卸载和 dev override 变更都通过受管理插件服务执行。
- 需要重启的变更保存在 pending restart 状态，并在下次启动形成运行态快照。
- 激活失败时记录诊断结果，并优先保留 last-known-good 版本。

## 尚未支持的来源

当前明确不支持：

- 独立第三方仓库直接上架。
- 任意本地目录扫描或生产态本地插件。
- 任意 Git URL 或 registry 安装。
- 用户自定义官方索引地址。
- 第三方 marketplace。

未来如决定开放第三方插件，必须先完成：

- 独立 realm 或进程隔离。
- 每插件主体身份。
- main 侧按插件主体授权。
- 最小权限 host API。
- 权限撤销和脱敏审计。
- 供应链签名、版本回滚和紧急撤回策略。
- 崩溃、资源占用和退出生命周期隔离。

在这些条件满足前，不得把官方可信插件运行时复用为第三方加载路径。
