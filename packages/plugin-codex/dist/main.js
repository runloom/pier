import { fileURLToPath as __pierFURL } from "node:url";
import { dirname as __pierDir } from "node:path";
const __filename = __pierFURL(import.meta.url);
__pierDir(__filename);
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, watch } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
//#region ../../node_modules/.pnpm/signal-exit@4.1.0/node_modules/signal-exit/dist/cjs/signals.js
var require_signals = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.signals = void 0;
	/**
	* This is not the set of all possible signals.
	*
	* It IS, however, the set of all signals that trigger
	* an exit on either Linux or BSD systems.  Linux is a
	* superset of the signal names supported on BSD, and
	* the unknown signals just fail to register, so we can
	* catch that easily enough.
	*
	* Windows signals are a different set, since there are
	* signals that terminate Windows processes, but don't
	* terminate (or don't even exist) on Posix systems.
	*
	* Don't bother with SIGKILL.  It's uncatchable, which
	* means that we can't fire any callbacks anyway.
	*
	* If a user does happen to register a handler on a non-
	* fatal signal like SIGWINCH or something, and then
	* exit, it'll end up firing `process.emit('exit')`, so
	* the handler will be fired anyway.
	*
	* SIGBUS, SIGFPE, SIGSEGV and SIGILL, when not raised
	* artificially, inherently leave the process in a
	* state from which it is not safe to try and enter JS
	* listeners.
	*/
	exports.signals = [];
	exports.signals.push("SIGHUP", "SIGINT", "SIGTERM");
	if (process.platform !== "win32") exports.signals.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
	if (process.platform === "linux") exports.signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
}));
//#endregion
//#region ../../node_modules/.pnpm/signal-exit@4.1.0/node_modules/signal-exit/dist/cjs/index.js
var require_cjs = /* @__PURE__ */ __commonJSMin(((exports) => {
	var _a;
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.unload = exports.load = exports.onExit = exports.signals = void 0;
	var signals_js_1 = require_signals();
	Object.defineProperty(exports, "signals", {
		enumerable: true,
		get: function() {
			return signals_js_1.signals;
		}
	});
	var processOk = (process) => !!process && typeof process === "object" && typeof process.removeListener === "function" && typeof process.emit === "function" && typeof process.reallyExit === "function" && typeof process.listeners === "function" && typeof process.kill === "function" && typeof process.pid === "number" && typeof process.on === "function";
	var kExitEmitter = Symbol.for("signal-exit emitter");
	var global = globalThis;
	var ObjectDefineProperty = Object.defineProperty.bind(Object);
	var Emitter = class {
		emitted = {
			afterExit: false,
			exit: false
		};
		listeners = {
			afterExit: [],
			exit: []
		};
		count = 0;
		id = Math.random();
		constructor() {
			if (global[kExitEmitter]) return global[kExitEmitter];
			ObjectDefineProperty(global, kExitEmitter, {
				value: this,
				writable: false,
				enumerable: false,
				configurable: false
			});
		}
		on(ev, fn) {
			this.listeners[ev].push(fn);
		}
		removeListener(ev, fn) {
			const list = this.listeners[ev];
			const i = list.indexOf(fn);
			/* c8 ignore start */
			if (i === -1) return;
			/* c8 ignore stop */
			if (i === 0 && list.length === 1) list.length = 0;
			else list.splice(i, 1);
		}
		emit(ev, code, signal) {
			if (this.emitted[ev]) return false;
			this.emitted[ev] = true;
			let ret = false;
			for (const fn of this.listeners[ev]) ret = fn(code, signal) === true || ret;
			if (ev === "exit") ret = this.emit("afterExit", code, signal) || ret;
			return ret;
		}
	};
	var SignalExitBase = class {};
	var signalExitWrap = (handler) => {
		return {
			onExit(cb, opts) {
				return handler.onExit(cb, opts);
			},
			load() {
				return handler.load();
			},
			unload() {
				return handler.unload();
			}
		};
	};
	var SignalExitFallback = class extends SignalExitBase {
		onExit() {
			return () => {};
		}
		load() {}
		unload() {}
	};
	var SignalExit = class extends SignalExitBase {
		/* c8 ignore start */
		#hupSig = process.platform === "win32" ? "SIGINT" : "SIGHUP";
		/* c8 ignore stop */
		#emitter = new Emitter();
		#process;
		#originalProcessEmit;
		#originalProcessReallyExit;
		#sigListeners = {};
		#loaded = false;
		constructor(process) {
			super();
			this.#process = process;
			this.#sigListeners = {};
			for (const sig of signals_js_1.signals) this.#sigListeners[sig] = () => {
				const listeners = this.#process.listeners(sig);
				let { count } = this.#emitter;
				/* c8 ignore start */
				const p = process;
				if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") count += p.__signal_exit_emitter__.count;
				/* c8 ignore stop */
				if (listeners.length === count) {
					this.unload();
					const ret = this.#emitter.emit("exit", null, sig);
					/* c8 ignore start */
					const s = sig === "SIGHUP" ? this.#hupSig : sig;
					if (!ret) process.kill(process.pid, s);
				}
			};
			this.#originalProcessReallyExit = process.reallyExit;
			this.#originalProcessEmit = process.emit;
		}
		onExit(cb, opts) {
			/* c8 ignore start */
			if (!processOk(this.#process)) return () => {};
			/* c8 ignore stop */
			if (this.#loaded === false) this.load();
			const ev = opts?.alwaysLast ? "afterExit" : "exit";
			this.#emitter.on(ev, cb);
			return () => {
				this.#emitter.removeListener(ev, cb);
				if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) this.unload();
			};
		}
		load() {
			if (this.#loaded) return;
			this.#loaded = true;
			this.#emitter.count += 1;
			for (const sig of signals_js_1.signals) try {
				const fn = this.#sigListeners[sig];
				if (fn) this.#process.on(sig, fn);
			} catch (_) {}
			this.#process.emit = (ev, ...a) => {
				return this.#processEmit(ev, ...a);
			};
			this.#process.reallyExit = (code) => {
				return this.#processReallyExit(code);
			};
		}
		unload() {
			if (!this.#loaded) return;
			this.#loaded = false;
			signals_js_1.signals.forEach((sig) => {
				const listener = this.#sigListeners[sig];
				/* c8 ignore start */
				if (!listener) throw new Error("Listener not defined for signal: " + sig);
				/* c8 ignore stop */
				try {
					this.#process.removeListener(sig, listener);
				} catch (_) {}
				/* c8 ignore stop */
			});
			this.#process.emit = this.#originalProcessEmit;
			this.#process.reallyExit = this.#originalProcessReallyExit;
			this.#emitter.count -= 1;
		}
		#processReallyExit(code) {
			/* c8 ignore start */
			if (!processOk(this.#process)) return 0;
			this.#process.exitCode = code || 0;
			/* c8 ignore stop */
			this.#emitter.emit("exit", this.#process.exitCode, null);
			return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
		}
		#processEmit(ev, ...args) {
			const og = this.#originalProcessEmit;
			if (ev === "exit" && processOk(this.#process)) {
				if (typeof args[0] === "number") this.#process.exitCode = args[0];
				/* c8 ignore start */
				const ret = og.call(this.#process, ev, ...args);
				/* c8 ignore start */
				this.#emitter.emit("exit", this.#process.exitCode, null);
				/* c8 ignore stop */
				return ret;
			} else return og.call(this.#process, ev, ...args);
		}
	};
	var process = globalThis.process;
	_a = signalExitWrap(processOk(process) ? new SignalExit(process) : new SignalExitFallback()), exports.onExit = _a.onExit, exports.load = _a.load, exports.unload = _a.unload;
}));
//#endregion
//#region src/main/codex-usage.ts
var import_lib = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = writeFile;
	module.exports.sync = writeFileSync;
	module.exports._getTmpname = getTmpname;
	module.exports._cleanupOnExit = cleanupOnExit;
	var fs = __require("fs");
	var crypto = __require("node:crypto");
	var { onExit } = require_cjs();
	var path = __require("path");
	var { promisify } = __require("util");
	var activeFiles = {};
	/* istanbul ignore next */
	var threadId = (function getId() {
		try {
			return __require("worker_threads").threadId;
		} catch (e) {
			return 0;
		}
	})();
	var invocations = 0;
	function getTmpname(filename) {
		return filename + "." + crypto.createHash("sha1").update(__filename).update(String(process.pid)).update(String(threadId)).update(String(++invocations)).digest().readUInt32BE(0);
	}
	function cleanupOnExit(tmpfile) {
		return () => {
			try {
				fs.unlinkSync(typeof tmpfile === "function" ? tmpfile() : tmpfile);
			} catch {}
		};
	}
	function serializeActiveFile(absoluteName) {
		return new Promise((resolve) => {
			if (!activeFiles[absoluteName]) activeFiles[absoluteName] = [];
			activeFiles[absoluteName].push(resolve);
			if (activeFiles[absoluteName].length === 1) resolve();
		});
	}
	function isChownErrOk(err) {
		if (err.code === "ENOSYS") return true;
		if (!process.getuid || process.getuid() !== 0) {
			if (err.code === "EINVAL" || err.code === "EPERM") return true;
		}
		return false;
	}
	async function writeFileAsync(filename, data, options = {}) {
		if (typeof options === "string") options = { encoding: options };
		let fd;
		let tmpfile;
		/* istanbul ignore next -- The closure only gets called when onExit triggers */
		const removeOnExitHandler = onExit(cleanupOnExit(() => tmpfile));
		const absoluteName = path.resolve(filename);
		try {
			await serializeActiveFile(absoluteName);
			const truename = await promisify(fs.realpath)(filename).catch(() => filename);
			tmpfile = getTmpname(truename);
			if (!options.mode || !options.chown) {
				const stats = await promisify(fs.stat)(truename).catch(() => {});
				if (stats) {
					if (options.mode == null) options.mode = stats.mode;
					if (options.chown == null && process.getuid) options.chown = {
						uid: stats.uid,
						gid: stats.gid
					};
				}
			}
			fd = await promisify(fs.open)(tmpfile, "w", options.mode);
			if (options.tmpfileCreated) await options.tmpfileCreated(tmpfile);
			if (ArrayBuffer.isView(data)) await promisify(fs.write)(fd, data, 0, data.length, 0);
			else if (data != null) await promisify(fs.write)(fd, String(data), 0, String(options.encoding || "utf8"));
			if (options.fsync !== false) await promisify(fs.fsync)(fd);
			await promisify(fs.close)(fd);
			fd = null;
			if (options.chown) await promisify(fs.chown)(tmpfile, options.chown.uid, options.chown.gid).catch((err) => {
				if (!isChownErrOk(err)) throw err;
			});
			if (options.mode) await promisify(fs.chmod)(tmpfile, options.mode).catch((err) => {
				if (!isChownErrOk(err)) throw err;
			});
			await promisify(fs.rename)(tmpfile, truename);
		} finally {
			if (fd) await promisify(fs.close)(fd).catch(
				/* istanbul ignore next */
				() => {}
			);
			removeOnExitHandler();
			await promisify(fs.unlink)(tmpfile).catch(() => {});
			activeFiles[absoluteName].shift();
			if (activeFiles[absoluteName].length > 0) activeFiles[absoluteName][0]();
			else delete activeFiles[absoluteName];
		}
	}
	async function writeFile(filename, data, options, callback) {
		if (options instanceof Function) {
			callback = options;
			options = {};
		}
		const promise = writeFileAsync(filename, data, options);
		if (callback) try {
			const result = await promise;
			return callback(result);
		} catch (err) {
			return callback(err);
		}
		return promise;
	}
	function writeFileSync(filename, data, options) {
		if (typeof options === "string") options = { encoding: options };
		else if (!options) options = {};
		try {
			filename = fs.realpathSync(filename);
		} catch (ex) {}
		const tmpfile = getTmpname(filename);
		if (!options.mode || !options.chown) try {
			const stats = fs.statSync(filename);
			options = Object.assign({}, options);
			if (!options.mode) options.mode = stats.mode;
			if (!options.chown && process.getuid) options.chown = {
				uid: stats.uid,
				gid: stats.gid
			};
		} catch (ex) {}
		let fd;
		const cleanup = cleanupOnExit(tmpfile);
		const removeOnExitHandler = onExit(cleanup);
		let threw = true;
		try {
			fd = fs.openSync(tmpfile, "w", options.mode || 438);
			if (options.tmpfileCreated) options.tmpfileCreated(tmpfile);
			if (ArrayBuffer.isView(data)) fs.writeSync(fd, data, 0, data.length, 0);
			else if (data != null) fs.writeSync(fd, String(data), 0, String(options.encoding || "utf8"));
			if (options.fsync !== false) fs.fsyncSync(fd);
			fs.closeSync(fd);
			fd = null;
			if (options.chown) try {
				fs.chownSync(tmpfile, options.chown.uid, options.chown.gid);
			} catch (err) {
				if (!isChownErrOk(err)) throw err;
			}
			if (options.mode) try {
				fs.chmodSync(tmpfile, options.mode);
			} catch (err) {
				if (!isChownErrOk(err)) throw err;
			}
			fs.renameSync(tmpfile, filename);
			threw = false;
		} finally {
			if (fd) try {
				fs.closeSync(fd);
			} catch (ex) {}
			removeOnExitHandler();
			if (threw) cleanup();
		}
	}
})))(), 1);
var RPC_TIMEOUT_MS = 15e3;
/**
* 构造 JSON-RPC 2.0 请求消息（换行分隔协议）。
*/
function buildRpcMessage(id, method, params) {
	return `${JSON.stringify({
		id,
		jsonrpc: "2.0",
		method,
		params: params ?? {}
	})}\n`;
}
function mapRpcWindow(raw) {
	if (!raw || typeof raw.usedPercent !== "number") return;
	const result = { usedPercent: raw.usedPercent };
	if (typeof raw.resetsAt === "number") result.resetsAt = raw.resetsAt * 1e3;
	if (typeof raw.windowDurationMins === "number") result.windowMinutes = raw.windowDurationMins;
	return result;
}
/**
* 解析 account/rateLimits/read 的 result 字段。纯函数，单测主体。
* primary → session（5h 窗口），secondary → weekly（7d 窗口）。
*/
function parseRateLimitsResult(result) {
	if (result === null || result === void 0 || typeof result !== "object") return {
		status: "error",
		error: "Empty RPC result"
	};
	const rateLimits = result.rateLimits;
	if (!rateLimits || typeof rateLimits !== "object") return {
		status: "error",
		error: "Missing rateLimits in RPC result"
	};
	const rl = rateLimits;
	const out = { status: "ok" };
	const session = mapRpcWindow(rl.primary);
	if (session) out.session = session;
	const weekly = mapRpcWindow(rl.secondary);
	if (weekly) out.weekly = weekly;
	return out;
}
/**
* spawn `codex app-server` 走 JSON-RPC 协议获取活跃账号用量。
*
* 协议序列（本机 codex-cli 0.142.5 实测）：
* 1. 发 `initialize` 请求（clientInfo: { name: "pier", version: "1.0.0" }），等响应
* 2. 发 `initialized` 通知
* 3. 发 `account/rateLimits/read` 请求，读响应
* 消息为换行分隔 JSON-RPC 2.0；服务端会发无 id 的通知，跳过即可。
*/
function fetchCodexUsage(signal, opts) {
	if (signal.aborted) return Promise.resolve({
		status: "error",
		error: "Aborted"
	});
	const spawnImpl = opts?.spawnImpl ?? spawn;
	return new Promise((resolve) => {
		let buffer = "";
		let resolved = false;
		let rpcId = 0;
		const child = spawnImpl("codex", [
			"-s",
			"read-only",
			"-a",
			"untrusted",
			"app-server"
		], {
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			],
			windowsHide: true,
			env: process.env
		});
		let timeout = null;
		function cleanupListeners() {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			signal.removeEventListener("abort", onAbort);
			child.stdout?.off("data", onStdoutData);
			child.on?.("error", () => {});
		}
		function settle(result, opts) {
			if (resolved) return;
			resolved = true;
			cleanupListeners();
			if (opts?.kill) child.kill();
			resolve(result);
		}
		function onAbort() {
			settle({
				status: "error",
				error: "Aborted"
			}, { kill: true });
		}
		signal.addEventListener("abort", onAbort, { once: true });
		child.stdin?.on("error", () => {
			settle({
				status: "error",
				error: "stdin write failed"
			}, { kill: true });
		});
		timeout = setTimeout(() => {
			settle({
				status: "error",
				error: "RPC timeout"
			}, { kill: true });
		}, RPC_TIMEOUT_MS);
		function sendRpc(method, params) {
			const id = ++rpcId;
			child.stdin?.write(buildRpcMessage(id, method, params));
			return id;
		}
		function sendNotification(method) {
			child.stdin?.write(`${JSON.stringify({
				jsonrpc: "2.0",
				method,
				params: {}
			})}\n`);
		}
		let rateLimitsId = null;
		const initId = sendRpc("initialize", { clientInfo: {
			name: "pier",
			version: "1.0.0"
		} });
		function handleInitResponse(error) {
			if (error) {
				settle({
					status: "error",
					error: error.message
				}, { kill: true });
				return;
			}
			sendNotification("initialized");
			rateLimitsId = sendRpc("account/rateLimits/read");
		}
		function handleRateLimitsResponse(error, result) {
			if (error) {
				settle({
					status: "error",
					error: error.message
				}, { kill: true });
				return;
			}
			settle(parseRateLimitsResult(result), { kill: true });
		}
		function processLine(line) {
			if (!line) return;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg.id == null) return;
			if (msg.id === initId) {
				handleInitResponse(msg.error);
				return;
			}
			if (rateLimitsId !== null && msg.id === rateLimitsId) handleRateLimitsResponse(msg.error, msg.result);
		}
		function onStdoutData(chunk) {
			buffer += chunk.toString();
			for (;;) {
				const idx = buffer.indexOf("\n");
				if (idx === -1) break;
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				processLine(line);
			}
		}
		child.stdout?.on("data", onStdoutData);
		child.on("error", (err) => {
			settle({
				status: "error",
				error: err.code === "ENOENT" ? "Codex CLI not found" : err.message
			});
		});
		child.on("close", () => {
			settle({
				status: "error",
				error: "RPC process exited unexpectedly"
			});
		});
	});
}
//#endregion
//#region src/main/identity.ts
var OPENAI_AUTH_NS = "https://api.openai.com/auth";
/**
* 从 codex id_token JWT（不校验签名——本地已存文件）解析身份声明。
* 返回 null 表示 token 格式不可用或缺少 email。
*/
function parseIdTokenClaims(idToken) {
	const parts = idToken.split(".");
	if (parts.length !== 3) return null;
	const payloadSegment = parts[1];
	if (!payloadSegment) return null;
	try {
		const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf-8"));
		const email = payload.email;
		if (typeof email !== "string" || email.length === 0) return null;
		const authNs = typeof payload[OPENAI_AUTH_NS] === "object" && payload[OPENAI_AUTH_NS] !== null ? payload[OPENAI_AUTH_NS] : void 0;
		return {
			email,
			planType: typeof authNs?.chatgpt_plan_type === "string" ? authNs.chatgpt_plan_type : void 0,
			providerAccountId: typeof authNs?.chatgpt_account_id === "string" ? authNs.chatgpt_account_id : void 0
		};
	} catch {
		return null;
	}
}
/**
* 读取指定 CODEX_HOME 目录下的 auth.json，解析 id_token 身份。
* 返回 null 表示文件不存在 / 损坏 / 缺少 id_token。
*/
async function readCodexIdentity(homeDir) {
	try {
		const raw = await readFile(join(homeDir, "auth.json"), "utf-8");
		const idToken = JSON.parse(raw)?.tokens?.id_token;
		if (typeof idToken !== "string" || idToken.length === 0) return null;
		return parseIdTokenClaims(idToken);
	} catch {
		return null;
	}
}
//#endregion
//#region src/main/codex-provider.ts
var PIER_MANAGED_HOME_MARKER = ".pier-managed-home";
function defaultRealCodexHome() {
	return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}
/**
* 默认 spawn login 实现——真 spawn `codex login`。
* 生产环境使用；单测通过 opts.spawnLogin 替换。
*/
function defaultSpawnLogin(cmd, args, opts) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			env: {
				...process.env,
				...opts.env
			},
			stdio: "inherit"
		});
		opts.signal.addEventListener("abort", () => {
			child.kill();
			reject(/* @__PURE__ */ new Error("Login cancelled"));
		}, { once: true });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(/* @__PURE__ */ new Error(`codex login exited with code ${code}`));
		});
	});
}
function createCodexProvider(opts) {
	const realCodexHome = opts?.realCodexHome ?? defaultRealCodexHome();
	const spawnLogin = opts?.spawnLogin ?? defaultSpawnLogin;
	return {
		id: "codex",
		async login(homeDir, signal) {
			await spawnLogin("codex", ["login"], {
				env: { CODEX_HOME: homeDir },
				signal
			});
		},
		readIdentity(homeDir) {
			return readCodexIdentity(homeDir);
		},
		async materialize(accountHomeDir) {
			const src = join(accountHomeDir, "auth.json");
			const dest = join(realCodexHome, "auth.json");
			const content = await readFile(src, "utf-8");
			await mkdir(realCodexHome, { recursive: true });
			await (0, import_lib.default)(dest, content, { mode: 384 });
		},
		async syncBack(accountHomeDir, expectedProviderAccountId) {
			const src = join(realCodexHome, "auth.json");
			if (!existsSync(src)) return "ok";
			if (expectedProviderAccountId !== void 0) {
				if ((await readCodexIdentity(realCodexHome))?.providerAccountId !== expectedProviderAccountId) return "identity-mismatch";
			}
			await (0, import_lib.default)(join(accountHomeDir, "auth.json"), await readFile(src, "utf-8"), { mode: 384 });
			return "ok";
		},
		watchExternalAuth(cb) {
			let watcher = null;
			let debounceTimer = null;
			try {
				if (!existsSync(realCodexHome)) mkdirSync(realCodexHome, { recursive: true });
				watcher = watch(realCodexHome, (_eventType, filename) => {
					if (filename !== "auth.json") return;
					if (debounceTimer) clearTimeout(debounceTimer);
					debounceTimer = setTimeout(cb, 500);
				});
			} catch {}
			return () => {
				if (debounceTimer) {
					clearTimeout(debounceTimer);
					debounceTimer = null;
				}
				watcher?.close();
				watcher = null;
			};
		},
		fetchUsage(signal) {
			return fetchCodexUsage(signal);
		}
	};
}
//#endregion
//#region src/main/login-error.ts
/**
* 登录错误分类：
* - 超时（aborted 且 timedOut）→ 设错误态 + 抛出，调用方报错。
* - 用户主动取消（aborted 非超时 / 原生 AbortError）→ 不设错误态，抛 name
*   "AbortError" 的哨兵错误，调用方据此静默处理（不弹失败 toast）。
* - 一般失败 → 设错误态 + 抛出。
*/
function classifyLoginError(err, ctx) {
	const e = err instanceof Error ? err : new Error(String(err));
	if (ctx.aborted && ctx.timedOut) {
		const message = "Login timed out after 5 minutes";
		return {
			errorState: {
				at: ctx.at,
				message
			},
			failure: /* @__PURE__ */ new Error(message)
		};
	}
	if (ctx.aborted || e.name === "AbortError") {
		const cancelled = /* @__PURE__ */ new Error("Login cancelled");
		cancelled.name = "AbortError";
		return {
			errorState: null,
			failure: cancelled
		};
	}
	return {
		errorState: {
			at: ctx.at,
			message: e.message
		},
		failure: e
	};
}
//#endregion
//#region src/main/accounts-service.ts
var USAGE_MIN_REFETCH_MS = 300 * 1e3;
var USAGE_POLL_INTERVAL_MS = 900 * 1e3;
var LOGIN_TIMEOUT_MS = 300 * 1e3;
var WATCH_SUPPRESS_MS = 1500;
function createCodexAccountsService(opts) {
	const { managedBaseDir, provider, stateStore, onChanged } = opts;
	const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);
	const ensureUsageEnv = opts.ensureUsageEnv ?? (() => Promise.resolve());
	let broadcastSeq = 0;
	let loginAbort = null;
	let loginPending = null;
	let watchDispose = null;
	const usageCache = {};
	let usagePollTimer = null;
	let lastLoginError = null;
	let suppressWatchUntil = 0;
	let mutationQueue = Promise.resolve();
	function enqueueMutation(fn) {
		const task = mutationQueue.then(fn, fn);
		mutationQueue = task.catch(() => {});
		return task;
	}
	function now() {
		return Date.now();
	}
	function accountHomeDir(accountId) {
		return join(managedBaseDir, "codex", accountId);
	}
	function realCodexHome() {
		return process.env.CODEX_HOME ?? join(homedir(), ".codex");
	}
	function toSummary(record) {
		const usage = usageCache[record.id];
		return {
			id: record.id,
			label: record.email ?? record.id,
			status: record.id === stateStore.get().activeAccountId ? "active" : "available",
			usage: usage ? {
				fetchedAt: usage.fetchedAt,
				raw: {
					session: usage.session,
					weekly: usage.weekly,
					status: usage.status,
					error: usage.error
				}
			} : null,
			error: lastLoginError && loginPending === null ? lastLoginError.message : null
		};
	}
	function buildSnapshot() {
		broadcastSeq += 1;
		const state = stateStore.get();
		return {
			accounts: state.accounts.map(toSummary),
			activeAccountId: state.activeAccountId,
			login: loginPending ? {
				provider: "codex",
				startedAt: now()
			} : null,
			revision: broadcastSeq,
			schemaVersion: state.schemaVersion
		};
	}
	function emitSnapshot() {
		onChanged(buildSnapshot());
	}
	async function ensureManagedDir(accountId) {
		const dir = accountHomeDir(accountId);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, PIER_MANAGED_HOME_MARKER), "", { mode: 384 });
		return dir;
	}
	async function doAdoptCurrent() {
		const identity = await provider.readIdentity(realCodexHome());
		if (!identity) throw new Error("No valid codex login found at ~/.codex/auth.json");
		const state = stateStore.get();
		const existing = identity.providerAccountId ? state.accounts.find((a) => a.providerAccountId === identity.providerAccountId) : null;
		if (existing) {
			const dir = await ensureManagedDir(existing.id);
			await provider.syncBack(dir, void 0);
			stateStore.mutate((s) => ({
				...s,
				accounts: s.accounts.map((a) => a.id === existing.id ? {
					...a,
					email: identity.email,
					planType: identity.planType,
					providerAccountId: identity.providerAccountId,
					updatedAt: now()
				} : a),
				activeAccountId: existing.id,
				revision: s.revision + 1
			}));
		} else {
			const id = randomUUID();
			const dir = await ensureManagedDir(id);
			await provider.syncBack(dir, void 0);
			const account = {
				createdAt: now(),
				email: identity.email,
				id,
				planType: identity.planType,
				provider: "codex",
				providerAccountId: identity.providerAccountId,
				updatedAt: now()
			};
			stateStore.mutate((s) => ({
				...s,
				accounts: [...s.accounts, account],
				activeAccountId: id,
				revision: s.revision + 1
			}));
		}
		emitSnapshot();
	}
	async function doAdd() {
		const id = randomUUID();
		const dir = await ensureManagedDir(id);
		lastLoginError = null;
		loginPending = "codex";
		emitSnapshot();
		const abort = new AbortController();
		loginAbort = abort;
		let timedOut = false;
		const loginTimeout = setTimeout(() => {
			timedOut = true;
			abort.abort();
		}, LOGIN_TIMEOUT_MS);
		let failure = null;
		try {
			await provider.login(dir, abort.signal);
			const identity = await provider.readIdentity(dir);
			if (!identity) throw new Error("Login completed but no identity found");
			const state = stateStore.get();
			const existing = identity.providerAccountId ? state.accounts.find((a) => a.providerAccountId === identity.providerAccountId) : null;
			if (existing) {
				const existingDir = accountHomeDir(existing.id);
				const freshAuth = await readFile(join(dir, "auth.json"), "utf-8");
				await (0, import_lib.default)(join(existingDir, "auth.json"), freshAuth, { mode: 384 });
				await rm(dir, {
					recursive: true,
					force: true
				});
				if (stateStore.get().activeAccountId === existing.id) {
					suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
					await provider.materialize(existingDir);
					suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
				}
				stateStore.mutate((s) => ({
					...s,
					accounts: s.accounts.map((a) => a.id === existing.id ? {
						...a,
						email: identity.email,
						lastAuthenticatedAt: now(),
						planType: identity.planType,
						providerAccountId: identity.providerAccountId,
						updatedAt: now()
					} : a),
					revision: s.revision + 1
				}));
			} else {
				const account = {
					createdAt: now(),
					email: identity.email,
					id,
					lastAuthenticatedAt: now(),
					planType: identity.planType,
					provider: "codex",
					providerAccountId: identity.providerAccountId,
					updatedAt: now()
				};
				stateStore.mutate((s) => ({
					...s,
					accounts: [...s.accounts, account],
					revision: s.revision + 1
				}));
			}
			lastLoginError = null;
		} catch (err) {
			await rm(dir, {
				recursive: true,
				force: true
			}).catch(() => {});
			const classified = classifyLoginError(err, {
				aborted: abort.signal.aborted,
				at: now(),
				timedOut
			});
			lastLoginError = classified.errorState;
			failure = classified.failure;
		} finally {
			clearTimeout(loginTimeout);
			loginAbort = null;
			loginPending = null;
			emitSnapshot();
		}
		if (failure) throw failure;
	}
	async function doSelect(accountId) {
		const state = stateStore.get();
		if (!state.accounts.find((a) => a.id === accountId)) throw new Error(`Account not found: ${accountId}`);
		if (state.activeAccountId === accountId) return;
		if (state.activeAccountId) {
			const activeAccount = state.accounts.find((a) => a.id === state.activeAccountId);
			suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
			const syncResult = await provider.syncBack(accountHomeDir(state.activeAccountId), activeAccount?.providerAccountId);
			suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
			if (syncResult === "identity-mismatch") await handleDrift();
		}
		suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
		await provider.materialize(accountHomeDir(accountId));
		suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
		stateStore.mutate((s) => ({
			...s,
			activeAccountId: accountId,
			revision: s.revision + 1
		}));
		emitSnapshot();
		doRefreshUsage(true).catch(() => {});
	}
	async function doRemove(accountId) {
		if (stateStore.get().activeAccountId === accountId) throw new Error("Cannot remove active account — select another first");
		const dir = accountHomeDir(accountId);
		if (existsSync(join(dir, ".pier-managed-home"))) await rm(dir, {
			recursive: true,
			force: true
		});
		stateStore.mutate((s) => ({
			...s,
			accounts: s.accounts.filter((a) => a.id !== accountId),
			revision: s.revision + 1
		}));
		delete usageCache[accountId];
		emitSnapshot();
	}
	async function doRefreshUsage(force = false) {
		const capturedId = stateStore.get().activeAccountId;
		if (!capturedId) return;
		const cached = usageCache[capturedId];
		if (!force && cached && now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS) return;
		await ensureUsageEnv();
		const abort = new AbortController();
		const result = await provider.fetchUsage(abort.signal);
		if (stateStore.get().activeAccountId !== capturedId) return;
		usageCache[capturedId] = {
			fetchedAt: now(),
			raw: result,
			status: result.status,
			error: result.error,
			session: result.session,
			weekly: result.weekly
		};
		emitSnapshot();
	}
	async function handleDrift() {
		const identity = await provider.readIdentity(realCodexHome());
		if (!identity) return;
		const state = stateStore.get();
		const match = identity.providerAccountId ? state.accounts.find((a) => a.providerAccountId === identity.providerAccountId) : null;
		if (match) {
			if (state.activeAccountId !== match.id) stateStore.mutate((s) => ({
				...s,
				activeAccountId: match.id,
				revision: s.revision + 1
			}));
			await provider.syncBack(accountHomeDir(match.id), match.providerAccountId);
		} else {
			await doAdoptCurrent();
			return;
		}
		emitSnapshot();
	}
	function setupWatch() {
		watchDispose = provider.watchExternalAuth(() => {
			if (now() < suppressWatchUntil) return;
			enqueueMutation(async () => {
				if (now() < suppressWatchUntil) return;
				await handleDrift();
			}).catch(() => {});
		});
	}
	return {
		async init() {
			await stateStore.init();
			if (stateStore.get().accounts.length === 0) {
				if (await provider.readIdentity(realCodexHome())) await enqueueMutation(doAdoptCurrent);
			} else await enqueueMutation(handleDrift);
			setupWatch();
			usagePollTimer = setInterval(() => {
				if (!hasVisibleTarget()) return;
				doRefreshUsage().catch(() => {});
			}, USAGE_POLL_INTERVAL_MS);
			doRefreshUsage(false).catch(() => {});
		},
		dispose() {
			watchDispose?.();
			watchDispose = null;
			clearInterval(usagePollTimer ?? void 0);
			usagePollTimer = null;
			loginAbort?.abort();
		},
		flush: () => stateStore.flush(),
		snapshot: () => buildSnapshot(),
		adoptCurrent: () => enqueueMutation(doAdoptCurrent),
		add: (_payload) => enqueueMutation(doAdd),
		cancelLogin: () => {
			loginAbort?.abort();
			return enqueueMutation(() => {
				loginAbort = null;
				loginPending = null;
				emitSnapshot();
				return Promise.resolve();
			});
		},
		select: (payload) => enqueueMutation(() => doSelect(payload.accountId)),
		remove: (payload) => enqueueMutation(() => doRemove(payload.accountId)),
		refreshUsage: (force) => doRefreshUsage(force)
	};
}
//#endregion
//#region src/main/state.ts
var DEFAULTS = {
	accounts: [],
	activeAccountId: null,
	revision: 0,
	schemaVersion: 1
};
function createCodexAccountsStateStore(filePath) {
	let state = DEFAULTS;
	let dirty = false;
	let flushInFlight = null;
	async function persist() {
		await mkdir(dirname(filePath), { recursive: true });
		const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
		await writeFile(tmp, JSON.stringify(state));
		await rename(tmp, filePath);
		dirty = false;
	}
	return {
		async flush() {
			if (!dirty) return;
			if (flushInFlight) {
				await flushInFlight;
				return;
			}
			flushInFlight = persist();
			try {
				await flushInFlight;
			} finally {
				flushInFlight = null;
			}
		},
		get: () => state,
		async init() {
			if (existsSync(filePath)) try {
				const raw = await readFile(filePath, "utf8");
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object" && Array.isArray(parsed.accounts)) state = {
					accounts: parsed.accounts,
					activeAccountId: parsed.activeAccountId ?? null,
					revision: parsed.revision ?? 0,
					schemaVersion: parsed.schemaVersion ?? 1
				};
			} catch {
				state = DEFAULTS;
			}
			return state;
		},
		mutate(fn) {
			state = fn(state);
			dirty = true;
			return state;
		}
	};
}
//#endregion
//#region src/main/index.ts
var plugin = {
	id: "pier.codex",
	activate(context) {
		const stateStore = createCodexAccountsStateStore(join(context.paths.workDir, "accounts.json"));
		const provider = createCodexProvider();
		const service = createCodexAccountsService({
			managedBaseDir: join(context.paths.workDir, "runtime-homes"),
			provider,
			stateStore,
			onChanged: (snapshot) => context.events.emit("accounts.changed", snapshot)
		});
		service.init().catch((err) => {
			context.logger.error("[pier.codex] service init failed", err);
		});
		context.rpc.handle("accounts.snapshot", async () => service.snapshot());
		context.rpc.handle("accounts.add", async (payload) => {
			await service.add(payload ?? {});
			return null;
		});
		context.rpc.handle("accounts.cancelLogin", async () => {
			await service.cancelLogin();
			return null;
		});
		context.rpc.handle("accounts.select", async (payload) => {
			await service.select(payload);
			return null;
		});
		context.rpc.handle("accounts.remove", async (payload) => {
			await service.remove(payload);
			return null;
		});
		context.rpc.handle("accounts.refreshUsage", async () => {
			await service.refreshUsage(true);
			return null;
		});
		context.rpc.handle("accounts.adoptCurrent", async () => {
			await service.adoptCurrent();
			return null;
		});
		context.lifecycle.onBeforeQuit(() => service.flush());
		context.logger.info("[pier.codex] activated");
		return () => {
			service.dispose();
		};
	}
};
//#endregion
export { plugin };
