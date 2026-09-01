/** relay 进程入口：读环境配置 → 监听；SIGINT/SIGTERM 优雅退出。 */
import { loadRelayConfig } from "./config.ts";
import { createRelayServer } from "./server.ts";

const config = loadRelayConfig();
const server = createRelayServer(config, {
  log: (event, fields) => {
    // 日志红线：只含伪匿名 id、事件与计数（服务端设计 §9）。
    console.log(JSON.stringify({ ts: Date.now(), event, ...fields }));
  },
});

const { port } = await server.listen();
console.log(
  JSON.stringify({
    ts: Date.now(),
    event: "relay.ready",
    port,
    publicUrl: config.publicUrl,
  })
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().then(() => process.exit(0));
  });
}
