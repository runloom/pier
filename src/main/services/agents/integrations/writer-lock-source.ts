/** 注入第三方 JavaScript 插件的跨语言原子 JSONL 写锁协议。 */
export const JAVASCRIPT_LOCKED_APPEND_SOURCE = `
function pierAppend(log, line) {
	const lock = log + ".lock";
	const token = String(process.pid) + "." + Date.now() + "." + Math.random();
	const candidate = lock + "." + token;
	if (typeof process.getBuiltinModule === "function") {
		const fs = process.getBuiltinModule("node:fs");
		try { fs.writeFileSync(candidate, token, { flag: "wx" }); } catch { return; }
		try {
			for (let attempt = 0; attempt < 500; attempt += 1) {
				try {
					fs.linkSync(candidate, lock);
					fs.rmSync(candidate, { force: true });
					try { fs.appendFileSync(log, line); }
					finally {
						try { if (fs.readFileSync(lock, "utf8") === token) fs.rmSync(lock); } catch {}
					}
					return;
				} catch (error) {
					if (error?.code !== "EEXIST") return;
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
				}
			}
		} finally { try { fs.rmSync(candidate, { force: true }); } catch {} }
		return;
	}
	import("node:fs/promises").then(async (fs) => {
		try { await fs.writeFile(candidate, token, { flag: "wx" }); } catch { return; }
		try {
			for (let attempt = 0; attempt < 500; attempt += 1) {
				try {
					await fs.link(candidate, lock);
					await fs.rm(candidate, { force: true });
					try { await fs.appendFile(log, line); }
					finally { if (await fs.readFile(lock, "utf8").catch(() => "") === token) await fs.rm(lock, { force: true }); }
					return;
				} catch (error) {
					if (error?.code !== "EEXIST") return;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
		} finally { await fs.rm(candidate, { force: true }); }
	}).catch(() => {});
}`;
