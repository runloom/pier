# Pier 授权说明

Pier 采用 **AGPLv3 + 商业授权**。

这份说明用于解释项目的授权边界；正式条款以 `LICENSE`、`NOTICE`、第三方资产自己的许可证和双方签署的商业协议为准。文档索引见 [`../README.md`](../README.md)；商标见 [`../../TRADEMARKS.md`](../../TRADEMARKS.md)。

## 开源版

Pier 源码默认使用 `AGPL-3.0-only`。

这意味着用户可以：

- 使用、复制、修改和分发 Pier；
- 商业使用 Pier；
- 为分发副本收费；
- 发布自己的修改版本。

同时，AGPLv3 要求：

- 分发 Pier 或修改版时，必须按 AGPLv3 提供对应源码；
- 如果修改版通过网络与用户交互，必须向这些网络用户提供对应源码；
- 不能对 AGPLv3 授予的权利增加额外限制，例如禁止再分发、禁止修改或用闭源 NDA 覆盖；
- 必须保留许可证、版权声明、无担保声明和源码获取方式。

## 商业授权

如果使用方需要 AGPLv3 之外的权利，应联系维护者取得单独商业授权。典型场景包括：

- 闭源分发或闭源集成；
- 白标发布；
- 企业内部定制但不希望承担 AGPLv3 对外源码义务；
- 需要官方支持、担保、赔偿、SLA 或安全审计条款；
- 使用高级会员、官方云服务、团队服务、托管服务或企业功能。

商业授权只通过单独书面协议生效。仓库中的 AGPLv3 不自动授予商业授权。

## 高级会员和官方服务

AGPLv3 允许用户修改源码。因此，高级会员权益不应只依赖本地源码里的开关。

推荐把付费权益放在：

- 官方账号和云服务；
- 同步、托管、团队协作、模型额度等服务端能力；
- 官方签名构建、更新通道、技术支持和企业服务；
- 需要商业协议才能获得的闭源集成或企业部署权利。

## 第一方包

`packages/` 下的第一方包（如 `@pier/ui`、`@pier/plugin-api`、官方插件包）是本仓库的一部分，默认与 Pier 使用相同的 `AGPL-3.0-only` 条款，除非某个包显式声明了不同许可证。

基于 shadcn/ui 封装本身不是问题。shadcn/ui 使用 MIT 许可证，MIT 与 AGPLv3 兼容；但复制或改写的 shadcn/ui 代码应保留必要版权和 MIT 许可说明。

## 字体和资产

源码许可证不自动覆盖所有资产。

- JetBrains Mono / Nerd Font Mono：见 `resources/fonts/JetBrainsMono-OFL.txt`。
- HarmonyOS Sans SC：见 `resources/fonts/HarmonyOS-Sans-SC-LICENSE.txt`。

HarmonyOS Sans Fonts License Agreement 允许将未修改的 HarmonyOS Sans Fonts 随软件嵌入、打包、再分发和销售，但要求在软件中显著声明使用了 HarmonyOS Sans Fonts，保留版权和许可证，不得修改字体或其组件，也不得把字体作为独立字体产品再分发或销售。Pier 只随软件打包未修改的 SC TTF 文件，并在 `NOTICE` 中声明使用。

## 贡献者授权

Pier 计划保留商业授权能力。为了避免未来无法对贡献者代码进行商业再授权，非平凡贡献需要贡献者授权流程。当前规则见 `CONTRIBUTING.md`。
