# Pier 会合云（relay）：无 volume、无密钥材料的无状态盲转发容器。
# 服务端设计 §10.2/§10.3：TLS 由前置层（Caddy 等）终结；重启即全忘，
# 宿主重拨自动重建在线态与名册。
#
# 只装 @pier/relay 的运行时依赖（ws + zod），装到 /app/node_modules：
# src/shared 与 apps/relay 都从这里解析 zod。不要 COPY 仓库根 package.json，
# 根包是 Electron 工作台，pnpm --filter 仍会把宿主依赖装进镜像。
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY apps/relay/package.json ./package.json
RUN npm install --omit=dev
COPY apps/relay ./apps/relay
COPY src/shared ./src/shared
COPY tsconfig.json ./tsconfig.json
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "--import", "./apps/relay/register-shared.mjs", "apps/relay/src/main.ts"]
